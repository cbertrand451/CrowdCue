import { randomBytes, createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { readAuthConfig } from '../src/server/auth/config.js';
import { TokenCipher, newToken, hashToken } from '../src/server/auth/crypto.js';
import { AuthService } from '../src/server/auth/service.js';
import type { AuthStore } from '../src/server/auth/store.js';
import {
  SpotifyClient,
  spotifyScopes,
  type SpotifyFetch,
  type TokenGrant,
} from '../src/server/spotify/client.js';
import { buildApp } from '../src/server/app.js';
import { readConfig } from '../src/server/config.js';

const env = () => ({
  NODE_ENV: 'test',
  SPOTIFY_AUTH_ENABLED: 'true',
  SPOTIFY_CLIENT_ID: 'test-client',
  SPOTIFY_CLIENT_SECRET: 'test-secret',
  SPOTIFY_REDIRECT_URI: 'https://crowdcue.example/api/auth/spotify/callback',
  DATABASE_URL: 'postgresql://test@127.0.0.1/test',
  TOKEN_ENCRYPTION_KEYS: JSON.stringify({
    v1: randomBytes(32).toString('base64'),
  }),
});
const config = () => readAuthConfig(env())!;
const tokenData = (overrides: Record<string, unknown> = {}) => ({
  access_token: 'test-access-token',
  refresh_token: 'test-refresh-token',
  token_type: 'Bearer',
  expires_in: 3600,
  scope: spotifyScopes.join(' '),
  ...overrides,
});
const response = (body: unknown, status = 200, headers = {}) =>
  new Response(JSON.stringify(body), { status, headers });
const grant = (): TokenGrant => ({
  accessToken: 'old-access',
  refreshToken: 'old-refresh',
  expiresAt: new Date(0),
  scopes: spotifyScopes,
});
function setup() {
  const settings = config();
  const fetcher = vi.fn<SpotifyFetch>();
  const store = {
    createAttempt: vi
      .fn<AuthStore['createAttempt']>()
      .mockResolvedValue(undefined),
    consumeAttempt: vi.fn<AuthStore['consumeAttempt']>(),
    saveLogin: vi.fn<AuthStore['saveLogin']>().mockResolvedValue(undefined),
    findSession: vi.fn<AuthStore['findSession']>().mockResolvedValue(null),
    deleteSession: vi
      .fn<AuthStore['deleteSession']>()
      .mockResolvedValue(undefined),
    accessToken: vi.fn<AuthStore['accessToken']>(),
  };
  const spotify = new SpotifyClient(settings, fetcher);
  const auth = new AuthService(settings, store, spotify);
  const app = buildApp(readConfig({ NODE_ENV: 'test' }), {
    logger: false,
    auth,
  });
  return { settings, store, fetcher, spotify, auth, app };
}

describe('authentication configuration and encryption', () => {
  it('is explicitly opt-in and reports configuration names without values', () => {
    expect(
      readAuthConfig({ SPOTIFY_CLIENT_SECRET: 'private-value' }),
    ).toBeUndefined();
    expect(() => readAuthConfig({ SPOTIFY_AUTH_ENABLED: 'maybe' })).toThrow(
      'SPOTIFY_AUTH_ENABLED',
    );
    expect(() =>
      readAuthConfig({
        SPOTIFY_AUTH_ENABLED: 'true',
        SPOTIFY_CLIENT_SECRET: 'private-value',
      }),
    ).toThrow('SPOTIFY_CLIENT_ID');
    try {
      readAuthConfig({ ...env(), TOKEN_ENCRYPTION_KEYS: 'private-key-value' });
    } catch (error) {
      expect(String(error)).toContain('TOKEN_ENCRYPTION_KEYS');
      expect(String(error)).not.toContain('private-key-value');
    }
  });
  it('accepts the configured redirect URL alias and rejects unsafe callback/origin settings', () => {
    const values = env();
    const { SPOTIFY_REDIRECT_URI, ...rest } = values;
    expect(
      readAuthConfig({ ...rest, SPOTIFY_REDIRECT_URL: SPOTIFY_REDIRECT_URI })
        ?.redirectUri,
    ).toBe(SPOTIFY_REDIRECT_URI);
    for (const uri of [
      'not-a-url',
      'http://localhost/api/auth/spotify/callback',
      'https://crowdcue.example/wrong',
      'https://user:pass@crowdcue.example/api/auth/spotify/callback',
    ]) {
      expect(() =>
        readAuthConfig({ ...values, SPOTIFY_REDIRECT_URI: uri }),
      ).toThrow();
    }
    expect(() =>
      readAuthConfig({ ...values, APP_ORIGIN: 'https://other.example' }),
    ).toThrow('APP_ORIGIN');
    expect(() =>
      readAuthConfig({
        ...values,
        NODE_ENV: 'production',
        SPOTIFY_REDIRECT_URI: 'http://127.0.0.1:5173/api/auth/spotify/callback',
      }),
    ).toThrow('HTTPS');
  });
  it('encrypts tokens with fresh nonces, rejects tampering/swaps, and supports old keys', () => {
    const old = randomBytes(32);
    const keys = { old, current: randomBytes(32) };
    const cipher = new TokenCipher('current', keys);
    const first = cipher.encrypt('test-token-value', 'host:access');
    const second = cipher.encrypt('test-token-value', 'host:access');
    expect(first.data.equals(second.data)).toBe(false);
    expect(first.data.includes(Buffer.from('test-token-value'))).toBe(false);
    expect(cipher.decrypt(first.data, first.keyId, 'host:access')).toBe(
      'test-token-value',
    );
    expect(() =>
      cipher.decrypt(first.data, first.keyId, 'host:refresh'),
    ).toThrow();
    const tampered = Buffer.from(first.data);
    tampered[tampered.length - 1] ^= 1;
    expect(() =>
      cipher.decrypt(tampered, first.keyId, 'host:access'),
    ).toThrow();
    expect(() =>
      cipher.decrypt(first.data, 'missing', 'host:access'),
    ).toThrow();
    const prior = new TokenCipher('old', { old }).encrypt(
      'old-value',
      'host:access',
    );
    expect(cipher.decrypt(prior.data, prior.keyId, 'host:access')).toBe(
      'old-value',
    );
  });
});

describe('Spotify client', () => {
  it('exchanges authorization codes with PKCE on the backend', async () => {
    const { spotify, fetcher, settings } = setup();
    fetcher.mockResolvedValueOnce(response(tokenData()));
    const tokens = await spotify.exchange('test-code', 'test-verifier');
    expect(tokens.refreshToken).toBe('test-refresh-token');
    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe('https://accounts.spotify.com/api/token');
    expect(init?.redirect).toBe('error');
    const form = new URLSearchParams(String(init?.body));
    expect(form.get('grant_type')).toBe('authorization_code');
    expect(form.get('code_verifier')).toBe('test-verifier');
    expect(form.get('redirect_uri')).toBe(settings.redirectUri);
  });
  it('retains a refresh token when Spotify omits it, and accepts rotated tokens', async () => {
    const { spotify, fetcher } = setup();
    fetcher.mockResolvedValueOnce(
      response(tokenData({ refresh_token: undefined, scope: undefined })),
    );
    expect((await spotify.refresh(grant())).refreshToken).toBe('old-refresh');
    fetcher.mockResolvedValueOnce(
      response(tokenData({ refresh_token: 'rotated-refresh' })),
    );
    expect((await spotify.refresh(grant())).refreshToken).toBe(
      'rotated-refresh',
    );
  });
  it('sanitizes denial, malformed replies, timeouts, rate limits, and server failures', async () => {
    const { spotify, fetcher } = setup();
    fetcher.mockResolvedValueOnce(
      response(
        { error: 'invalid_grant', error_description: 'private-details' },
        400,
      ),
    );
    await expect(spotify.refresh(grant())).rejects.toMatchObject({
      kind: 'reauthenticate',
    });
    fetcher.mockResolvedValueOnce(response({ error: 'private-details' }, 401));
    await expect(spotify.refresh(grant())).rejects.toMatchObject({
      kind: 'unavailable',
    });
    fetcher.mockResolvedValueOnce(
      response({ error: 'private-details' }, 429, { 'retry-after': '45' }),
    );
    await expect(spotify.refresh(grant())).rejects.toMatchObject({
      kind: 'rate_limited',
      retryAfter: 45,
    });
    fetcher.mockRejectedValueOnce(new Error('secret-network-details'));
    await expect(spotify.profile('test-access')).rejects.toThrow(
      'Spotify is unavailable',
    );
    fetcher.mockResolvedValueOnce(response(tokenData({ expires_in: 'bad' })));
    await expect(spotify.exchange('code', 'verifier')).rejects.toMatchObject({
      kind: 'unavailable',
    });
    fetcher.mockResolvedValueOnce(
      response(tokenData({ scope: 'user-read-private' })),
    );
    await expect(spotify.exchange('code', 'verifier')).rejects.toMatchObject({
      kind: 'permissions',
    });
    fetcher.mockResolvedValueOnce(response({ error: 'secret-details' }, 500));
    await expect(spotify.profile('test-access')).rejects.toThrow(
      'Spotify is unavailable',
    );
  });
  it('retries a rejected access token once after refresh through an authenticated host session', async () => {
    const { auth, store, fetcher } = setup();
    const sessionToken = newToken();
    store.findSession.mockResolvedValue({
      accountId: 'host-id',
      displayName: 'Host',
    });
    store.accessToken
      .mockResolvedValueOnce('old-access')
      .mockResolvedValueOnce('new-access');
    fetcher.mockResolvedValueOnce(response({}, 401));
    fetcher.mockResolvedValueOnce(
      response({ id: 'spotify-user', display_name: 'Host' }),
    );
    expect(await auth.hostProfile(sessionToken)).toEqual({
      id: 'spotify-user',
      displayName: 'Host',
    });
    expect(store.findSession).toHaveBeenCalledWith(hashToken(sessionToken));
    expect(store.accessToken.mock.calls[1][2]).toBe('old-access');
    await expect(auth.requireHost('guest-id')).rejects.toMatchObject({
      kind: 'reauthenticate',
    });
  });
});

describe('OAuth routes', () => {
  it('requires the app origin, creates a browser cookie, and sends PKCE/state to Spotify', async () => {
    const { app, store, settings } = setup();
    try {
      expect(
        (await app.inject({ method: 'POST', url: '/api/auth/spotify/login' }))
          .statusCode,
      ).toBe(403);
      const response = await app.inject({
        method: 'POST',
        url: '/api/auth/spotify/login',
        headers: {
          origin: settings.appOrigin,
          'content-type': 'application/x-www-form-urlencoded',
        },
        payload: '',
      });
      expect(response.statusCode).toBe(303);
      const url = new URL(response.headers.location!);
      expect(url.origin).toBe('https://accounts.spotify.com');
      expect(url.searchParams.get('code_challenge_method')).toBe('S256');
      const [stateHash, browserHash, verifier] =
        store.createAttempt.mock.calls[0];
      expect(stateHash).toBe(hashToken(url.searchParams.get('state')!));
      expect(url.searchParams.get('code_challenge')).toBe(
        createHash('sha256').update(verifier).digest('base64url'),
      );
      expect(browserHash).toBe(hashToken(response.cookies[0].value));
      expect(response.headers['set-cookie']).toEqual(
        expect.stringContaining('HttpOnly'),
      );
      expect(response.headers['set-cookie']).toEqual(
        expect.stringContaining('Secure'),
      );
      expect(response.headers['set-cookie']).toEqual(
        expect.stringContaining('SameSite=Lax'),
      );
      expect(response.headers['set-cookie']).toEqual(
        expect.stringContaining('__Host-crowdcue_oauth'),
      );
      expect(response.headers['cache-control']).toBe('no-store');
    } finally {
      await app.close();
    }
  });
  it('rejects missing cookies, malformed/repeated state, and unbound callbacks before exchange', async () => {
    const { app, fetcher, store } = setup();
    const state = newToken();
    try {
      const missing = await app.inject(
        `/api/auth/spotify/callback?state=${state}&code=test-code`,
      );
      expect(missing.headers.location).toContain('spotify=invalid_state');
      expect(store.consumeAttempt).not.toHaveBeenCalled();
      const repeated = await app.inject({
        url: `/api/auth/spotify/callback?state=${state}&state=${state}&code=test-code`,
        cookies: { '__Host-crowdcue_oauth': newToken() },
      });
      expect(repeated.headers.location).toContain('spotify=invalid_state');
      store.consumeAttempt.mockResolvedValue(null);
      const unbound = await app.inject({
        url: `/api/auth/spotify/callback?state=${state}&code=test-code`,
        cookies: { '__Host-crowdcue_oauth': newToken() },
      });
      expect(unbound.headers.location).toContain('spotify=invalid_state');
      expect(fetcher).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });
  it('consumes denial and handles Spotify failures without disclosing provider details', async () => {
    const { app, store, fetcher } = setup();
    store.consumeAttempt.mockResolvedValue(newToken());
    const cookies = { '__Host-crowdcue_oauth': newToken() };
    try {
      const denied = await app.inject({
        url: `/api/auth/spotify/callback?state=${newToken()}&error=access_denied`,
        cookies,
      });
      expect(denied.headers.location).toContain('spotify=denied');
      expect(fetcher).not.toHaveBeenCalled();
      fetcher.mockResolvedValueOnce(
        response(
          {
            error: 'invalid_grant',
            error_description: 'private-provider-value',
          },
          400,
        ),
      );
      const failed = await app.inject({
        url: `/api/auth/spotify/callback?state=${newToken()}&code=test-code`,
        cookies,
      });
      expect(failed.headers.location).toContain('spotify=reauthenticate');
      expect(JSON.stringify(failed.headers) + failed.body).not.toContain(
        'private-provider-value',
      );
      expect(store.saveLogin).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });
  it('creates a host cookie after successful exchange and returns only safe status fields', async () => {
    const { app, store, fetcher } = setup();
    store.consumeAttempt.mockResolvedValue(newToken());
    fetcher.mockResolvedValueOnce(response(tokenData()));
    fetcher.mockResolvedValueOnce(
      response({
        id: 'test-user',
        display_name: 'Host',
        email: 'private-email',
      }),
    );
    try {
      const callback = await app.inject({
        url: `/api/auth/spotify/callback?state=${newToken()}&code=test-code`,
        cookies: { '__Host-crowdcue_oauth': newToken() },
      });
      expect(callback.headers.location).toBe(
        'https://crowdcue.example/?spotify=connected',
      );
      const session = callback.cookies.find(
        (item) => item.name === '__Host-crowdcue_host',
      )!;
      expect(session).toBeDefined();
      expect(store.saveLogin.mock.calls[0][2]).toBe(hashToken(session.value));
      expect(JSON.stringify(callback.headers) + callback.body).not.toContain(
        'test-access-token',
      );
      store.findSession.mockResolvedValue({
        accountId: 'test-host',
        displayName: 'Host',
      });
      store.accessToken.mockResolvedValue('test-access-token');
      const status = await app.inject({
        url: '/api/auth/spotify/status',
        cookies: { '__Host-crowdcue_host': session.value },
      });
      expect(status.json()).toEqual({
        enabled: true,
        authenticated: true,
        connected: true,
        displayName: 'Host',
      });
      expect(status.body).not.toMatch(
        /test-access-token|test-refresh-token|test-host|private-email/,
      );
      const logout = await app.inject({
        method: 'POST',
        url: '/api/auth/logout',
        headers: { origin: 'https://evil.example' },
      });
      expect(logout.statusCode).toBe(403);
      expect(store.deleteSession).not.toHaveBeenCalled();
      const signedOut = await app.inject({
        method: 'POST',
        url: '/api/auth/logout',
        headers: { origin: 'https://crowdcue.example' },
        cookies: { '__Host-crowdcue_host': session.value },
      });
      expect(signedOut.statusCode).toBe(204);
      expect(store.deleteSession).toHaveBeenCalledWith(
        hashToken(session.value),
      );
    } finally {
      await app.close();
    }
  });
  it('rate-limits login attempts and keeps the base app usable when OAuth is disabled', async () => {
    const { app, settings } = setup();
    try {
      for (let i = 0; i < 10; i++)
        expect(
          (
            await app.inject({
              method: 'POST',
              url: '/api/auth/spotify/login',
              headers: { origin: settings.appOrigin },
            })
          ).statusCode,
        ).toBe(303);
      expect(
        (
          await app.inject({
            method: 'POST',
            url: '/api/auth/spotify/login',
            headers: { origin: settings.appOrigin },
          })
        ).statusCode,
      ).toBe(429);
    } finally {
      await app.close();
    }
    const disabled = buildApp(readConfig({ NODE_ENV: 'test' }), {
      logger: false,
    });
    try {
      expect(
        (await disabled.inject('/api/auth/spotify/status')).json(),
      ).toEqual({ enabled: false, authenticated: false, connected: false });
      expect(
        (
          await disabled.inject({
            method: 'POST',
            url: '/api/auth/spotify/login',
          })
        ).statusCode,
      ).toBe(503);
      expect((await disabled.inject('/api/health')).statusCode).toBe(200);
    } finally {
      await disabled.close();
    }
  });
});
