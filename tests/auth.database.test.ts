import { randomBytes, randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createDatabase } from '../src/server/db/index.js';
import { migrate } from '../src/server/db/migrate.js';
import { TokenCipher, newToken, hashToken } from '../src/server/auth/crypto.js';
import { PostgresAuthStore } from '../src/server/auth/store.js';
import { readAuthConfig } from '../src/server/auth/config.js';
import { AuthService } from '../src/server/auth/service.js';
import {
  SpotifyClient,
  spotifyScopes,
  type SpotifyFetch,
  type TokenGrant,
} from '../src/server/spotify/client.js';
import { readConfig } from '../src/server/config.js';
import { buildApp } from '../src/server/app.js';

const url = process.env.TEST_DATABASE_URL;
describe.skipIf(!url)('persistent Spotify authentication', () => {
  const schema = `crowdcue_auth_${randomUUID().replaceAll('-', '')}`;
  const cipher = new TokenCipher('test', { test: randomBytes(32) });
  let admin: pg.Pool;
  let pool: pg.Pool;
  let store: PostgresAuthStore;
  const config = readAuthConfig({
    NODE_ENV: 'test',
    SPOTIFY_AUTH_ENABLED: 'true',
    SPOTIFY_CLIENT_ID: 'test-client',
    SPOTIFY_CLIENT_SECRET: 'test-secret',
    SPOTIFY_REDIRECT_URI: 'https://crowdcue.example/api/auth/spotify/callback',
    DATABASE_URL: 'postgresql://test@127.0.0.1/test',
    TOKEN_ENCRYPTION_KEYS: JSON.stringify({
      v1: randomBytes(32).toString('base64'),
    }),
  })!;
  const grant = (): TokenGrant => ({
    accessToken: 'test-access-' + randomUUID(),
    refreshToken: 'test-refresh-' + randomUUID(),
    expiresAt: new Date(Date.now() + 3600_000),
    scopes: spotifyScopes,
  });
  const mockRefresh = () => {
    const fetcher = vi.fn<SpotifyFetch>();
    const spotify = new SpotifyClient(config, fetcher);
    fetcher.mockResolvedValue(
      new Response(
        JSON.stringify({
          access_token: 'new-test-access',
          refresh_token: 'rotated-test-refresh',
          expires_in: 3600,
          token_type: 'Bearer',
          scope: spotifyScopes.join(' '),
        }),
      ),
    );
    return { spotify, fetcher };
  };
  async function login(tokens = grant()) {
    const sessionToken = newToken();
    const profile = { id: randomUUID(), displayName: 'Host' };
    await store.saveLogin(profile, tokens, hashToken(sessionToken));
    const host = await store.findSession(hashToken(sessionToken));
    return { sessionToken, host: host!, tokens, profile };
  }
  beforeAll(async () => {
    admin = createDatabase(url!);
    await admin.query(`CREATE SCHEMA "${schema}"`);
    pool = new pg.Pool({
      connectionString: url,
      options: `-c search_path=${schema}`,
    });
    await migrate(pool);
    store = new PostgresAuthStore(pool, cipher);
  });
  afterAll(async () => {
    await pool?.end();
    if (admin) {
      await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await admin.end();
    }
  });

  it('binds state to the browser and consumes callbacks once under concurrency', async () => {
    const stateHash = hashToken(newToken());
    const browserHash = hashToken(newToken());
    const verifier = newToken();
    await store.createAttempt(stateHash, browserHash, verifier);
    const row = (
      await pool.query(
        'SELECT * FROM spotify_oauth_attempts WHERE state_hash = $1',
        [stateHash],
      )
    ).rows[0];
    expect(row.verifier_ciphertext.includes(Buffer.from(verifier))).toBe(false);
    expect(
      await store.consumeAttempt(stateHash, hashToken(newToken())),
    ).toBeNull();
    const attempts = await Promise.all([
      store.consumeAttempt(stateHash, browserHash),
      store.consumeAttempt(stateHash, browserHash),
    ]);
    expect(attempts.filter((value) => value === verifier)).toHaveLength(1);
    expect(attempts.filter((value) => value === null)).toHaveLength(1);
    await store.createAttempt(stateHash, browserHash, verifier);
    await pool.query(
      "UPDATE spotify_oauth_attempts SET created_at = now() - interval '20 minutes', expires_at = now() - interval '10 minutes' WHERE state_hash = $1",
      [stateHash],
    );
    expect(await store.consumeAttempt(stateHash, browserHash)).toBeNull();
  });

  it('persists encrypted credentials and hashed sessions across store instances', async () => {
    const { sessionToken, host, tokens } = await login();
    const row = (
      await pool.query(
        'SELECT * FROM spotify_credentials WHERE account_id = $1',
        [host.accountId],
      )
    ).rows[0];
    expect(
      row.access_token_ciphertext.includes(Buffer.from(tokens.accessToken)),
    ).toBe(false);
    expect(
      row.refresh_token_ciphertext.includes(Buffer.from(tokens.refreshToken)),
    ).toBe(false);
    expect(
      cipher.decrypt(
        row.access_token_ciphertext,
        row.encryption_key_id,
        `account:${host.accountId}:access`,
      ),
    ).toBe(tokens.accessToken);
    const restartedPool = new pg.Pool({
      connectionString: url,
      options: `-c search_path=${schema}`,
    });
    try {
      const restarted = new PostgresAuthStore(restartedPool, cipher);
      expect(await restarted.findSession(hashToken(sessionToken))).toEqual(
        host,
      );
      expect(await restarted.findSession(sessionToken)).toBeNull();
      const { spotify, fetcher } = mockRefresh();
      expect(await restarted.accessToken(host.accountId, spotify)).toBe(
        tokens.accessToken,
      );
      expect(fetcher).not.toHaveBeenCalled();
    } finally {
      await restartedPool.end();
    }
  });

  it('updates the existing Spotify account and rotates the browser session atomically', async () => {
    const previous = await login();
    const replacement = newToken();
    await store.saveLogin(
      previous.profile,
      grant(),
      hashToken(replacement),
      hashToken(previous.sessionToken),
    );
    expect(
      await store.findSession(hashToken(previous.sessionToken)),
    ).toBeNull();
    expect((await store.findSession(hashToken(replacement)))?.accountId).toBe(
      previous.host.accountId,
    );
    expect(
      (
        await pool.query(
          'SELECT * FROM spotify_accounts WHERE spotify_user_id = $1',
          [previous.profile.id],
        )
      ).rowCount,
    ).toBe(1);
    // Force a session uniqueness failure; neither credentials nor account edits may commit.
    const before = (
      await pool.query(
        'SELECT * FROM spotify_credentials WHERE account_id = $1',
        [previous.host.accountId],
      )
    ).rows[0];
    await expect(
      store.saveLogin(
        { ...previous.profile, displayName: 'Changed' },
        grant(),
        hashToken(replacement),
      ),
    ).rejects.toMatchObject({ code: '23505' });
    expect(
      (
        await pool.query(
          'SELECT * FROM spotify_credentials WHERE account_id = $1',
          [previous.host.accountId],
        )
      ).rows[0].access_token_ciphertext,
    ).toEqual(before.access_token_ciphertext);
    expect((await store.findSession(hashToken(replacement)))?.displayName).toBe(
      'Host',
    );
  });

  it('serializes expired-token refreshes and saves a rotated refresh token', async () => {
    const tokens = grant();
    tokens.expiresAt = new Date(Date.now() - 1000);
    const { host } = await login(tokens);
    const { spotify, fetcher } = mockRefresh();
    const values = await Promise.all(
      Array.from({ length: 8 }, () =>
        store.accessToken(host.accountId, spotify),
      ),
    );
    expect(values).toEqual(Array(8).fill('new-test-access'));
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(
      new URLSearchParams(String(fetcher.mock.calls[0][1]?.body)).get(
        'refresh_token',
      ),
    ).toBe(tokens.refreshToken);
    const row = (
      await pool.query(
        'SELECT * FROM spotify_credentials WHERE account_id = $1',
        [host.accountId],
      )
    ).rows[0];
    expect(
      cipher.decrypt(
        row.refresh_token_ciphertext,
        row.encryption_key_id,
        `account:${host.accountId}:refresh`,
      ),
    ).toBe('rotated-test-refresh');
  });

  it('refreshes a rejected unexpired token once and shares the result across callers', async () => {
    const { host, tokens } = await login();
    const { spotify, fetcher } = mockRefresh();
    expect(
      await Promise.all([
        store.accessToken(host.accountId, spotify, tokens.accessToken),
        store.accessToken(host.accountId, spotify, tokens.accessToken),
      ]),
    ).toEqual(['new-test-access', 'new-test-access']);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('commits invalid-grant removal and avoids retrying revoked credentials', async () => {
    const tokens = grant();
    tokens.expiresAt = new Date(0);
    const { host } = await login(tokens);
    const { spotify, fetcher } = mockRefresh();
    fetcher.mockResolvedValue(
      new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 }),
    );
    await expect(
      store.accessToken(host.accountId, spotify),
    ).rejects.toMatchObject({ kind: 'reauthenticate' });
    expect(
      (
        await pool.query(
          'SELECT * FROM spotify_credentials WHERE account_id = $1',
          [host.accountId],
        )
      ).rowCount,
    ).toBe(0);
    await expect(
      store.accessToken(host.accountId, spotify),
    ).rejects.toMatchObject({ kind: 'reauthenticate' });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('preserves credentials on transient/rate-limit failures so a later refresh can succeed', async () => {
    const tokens = grant();
    tokens.expiresAt = new Date(0);
    const { host } = await login(tokens);
    const { spotify, fetcher } = mockRefresh();
    fetcher.mockResolvedValueOnce(
      new Response('{}', { status: 429, headers: { 'retry-after': '20' } }),
    );
    await expect(
      store.accessToken(host.accountId, spotify),
    ).rejects.toMatchObject({ kind: 'rate_limited' });
    expect(
      (
        await pool.query(
          'SELECT * FROM spotify_credentials WHERE account_id = $1',
          [host.accountId],
        )
      ).rowCount,
    ).toBe(1);
    expect(await store.accessToken(host.accountId, spotify)).toBe(
      'new-test-access',
    );
  });

  it('rejects expired host sessions and revokes only the signed-out browser', async () => {
    const { sessionToken, host, profile } = await login();
    const second = newToken();
    await store.saveLogin(profile, grant(), hashToken(second));
    await store.deleteSession(hashToken(sessionToken));
    expect(await store.findSession(hashToken(sessionToken))).toBeNull();
    expect((await store.findSession(hashToken(second)))?.accountId).toBe(
      host.accountId,
    );
    await pool.query(
      "UPDATE host_sessions SET created_at = now() - interval '2 days', expires_at = now() - interval '1 day' WHERE token_hash = $1",
      [hashToken(second)],
    );
    expect(await store.findSession(hashToken(second))).toBeNull();
  });

  it('completes the HTTP OAuth flow with durable storage and rejects callback replay', async () => {
    const { spotify, fetcher } = mockRefresh();
    fetcher.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          access_token: 'http-test-access',
          refresh_token: 'http-test-refresh',
          token_type: 'Bearer',
          expires_in: 3600,
          scope: spotifyScopes.join(' '),
        }),
      ),
    );
    fetcher.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ id: randomUUID(), display_name: 'HTTP Host' }),
      ),
    );
    const auth = new AuthService(config, store, spotify);
    const app = buildApp(readConfig({ NODE_ENV: 'test' }), {
      logger: false,
      auth,
    });
    try {
      const start = await app.inject({
        method: 'POST',
        url: '/api/auth/spotify/login',
        headers: { origin: config.appOrigin },
      });
      const state = new URL(start.headers.location!).searchParams.get('state')!;
      const cookies = { '__Host-crowdcue_oauth': start.cookies[0].value };
      const callbackUrl = `/api/auth/spotify/callback?state=${state}&code=http-test-code`;
      const completed = await app.inject({ url: callbackUrl, cookies });
      expect(completed.headers.location).toContain('spotify=connected');
      const hostCookie = completed.cookies.find(
        (item) => item.name === '__Host-crowdcue_host',
      )!;
      const status = await app.inject({
        url: '/api/auth/spotify/status',
        cookies: { '__Host-crowdcue_host': hostCookie.value },
      });
      expect(status.json()).toEqual({
        enabled: true,
        authenticated: true,
        connected: true,
        displayName: 'HTTP Host',
      });
      const replay = await app.inject({ url: callbackUrl, cookies });
      expect(replay.headers.location).toContain('spotify=invalid_state');
      expect(fetcher).toHaveBeenCalledTimes(2);
      expect(status.body).not.toContain('http-test-access');
      const signedOut = await app.inject({
        method: 'POST',
        url: '/api/auth/logout',
        headers: { origin: config.appOrigin },
        cookies: { '__Host-crowdcue_host': hostCookie.value },
      });
      expect(signedOut.statusCode).toBe(204);
      expect(await store.findSession(hashToken(hostCookie.value))).toBeNull();
    } finally {
      await app.close();
    }
  });
});
