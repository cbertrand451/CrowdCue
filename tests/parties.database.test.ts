import { randomBytes, randomUUID } from 'node:crypto';
import pg from 'pg';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { createDatabase } from '../src/server/db/index.js';
import { migrate } from '../src/server/db/migrate.js';
import { readAuthConfig } from '../src/server/auth/config.js';
import { AuthService } from '../src/server/auth/service.js';
import { PostgresAuthStore } from '../src/server/auth/store.js';
import { TokenCipher, newToken, hashToken } from '../src/server/auth/crypto.js';
import {
  SpotifyClient,
  spotifyScopes,
  type SpotifyFetch,
} from '../src/server/spotify/client.js';
import { PostgresPartyStore } from '../src/server/parties/store.js';
import {
  createPartySchema,
  type PartyDetails,
} from '../src/server/parties/contracts.js';
import { buildApp } from '../src/server/app.js';
import { readConfig } from '../src/server/config.js';

const url = process.env.TEST_DATABASE_URL;
describe.skipIf(!url)('party creation and authorization', () => {
  const schema = `crowdcue_party_${randomUUID().replaceAll('-', '')}`;
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
  const cipher = new TokenCipher(config.keyId, config.keys);
  const fetcher = vi.fn<SpotifyFetch>();
  let admin: pg.Pool;
  let pool: pg.Pool;
  let authStore: PostgresAuthStore;
  let store: PostgresPartyStore;
  let app: ReturnType<typeof buildApp>;
  let host: { id: string; token: string };
  let other: { id: string; token: string };

  async function signIn() {
    const token = newToken();
    await authStore.saveLogin(
      { id: randomUUID(), displayName: 'Host' },
      {
        accessToken: 'test-access',
        refreshToken: 'test-refresh',
        expiresAt: new Date(Date.now() + 3600_000),
        scopes: spotifyScopes,
      },
      hashToken(token),
    );
    return {
      token,
      id: (await authStore.findSession(hashToken(token)))!.accountId,
    };
  }
  function create(
    payload: unknown = { name: 'Launch party' },
    key: string = randomUUID(),
    owner = host,
  ) {
    return app.inject({
      method: 'POST',
      url: '/api/parties',
      headers: {
        origin: config.appOrigin,
        'idempotency-key': key,
        'content-type': 'application/json',
      },
      cookies: { '__Host-crowdcue_host': owner.token },
      payload: JSON.stringify(payload),
    });
  }
  async function created() {
    const response = await create();
    expect(response.statusCode).toBe(201);
    return response.json<{ party: PartyDetails }>().party;
  }
  const tokenFrom = (link: string) => new URL(link).pathname.split('/').at(-1)!;
  beforeAll(async () => {
    admin = createDatabase(url!);
    await admin.query(`CREATE SCHEMA "${schema}"`);
    pool = new pg.Pool({
      connectionString: url,
      options: `-c search_path=${schema}`,
    });
    await migrate(pool);
    authStore = new PostgresAuthStore(pool, cipher);
    store = new PostgresPartyStore(pool, cipher, config.appOrigin);
  });
  beforeEach(async () => {
    host = await signIn();
    other = await signIn();
    fetcher.mockClear();
    app = buildApp(readConfig({ NODE_ENV: 'test' }), {
      logger: false,
      auth: new AuthService(
        config,
        authStore,
        new SpotifyClient(config, fetcher),
      ),
      parties: store,
    });
  });
  afterEach(async () => {
    await app.close();
  });
  afterAll(async () => {
    await pool?.end();
    if (admin) {
      await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await admin.end();
    }
  });

  it('creates an active party, default settings, and independently generated encrypted links', async () => {
    const response = await create({ name: '  Launch party  ' });
    expect(response.statusCode).toBe(201);
    const party = response.json<{ party: PartyDetails }>().party;
    expect(party).toMatchObject({
      name: 'Launch party',
      status: 'ACTIVE',
      endedAt: null,
      settings: {
        votingEnabled: true,
        approvalRequired: false,
        requireGuestNames: false,
        allowExplicitTracks: true,
        maxActiveRequestsPerGuest: null,
        requestCooldownSeconds: 0,
        queueBehavior: 'SPOTIFY_QUEUE',
      },
    });
    expect(response.headers.location).toBe(`/api/parties/${party.id}`);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.headers['referrer-policy']).toBe('no-referrer');
    const tokens = [
      party.links.guest,
      party.links.admin!,
      party.links.display!,
    ].map(tokenFrom);
    expect(new Set(tokens).size).toBe(3);
    for (const token of tokens) expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const row = (
      await pool.query('SELECT * FROM parties WHERE id = $1', [party.id])
    ).rows[0];
    expect(row.host_account_id).toBe(host.id);
    expect(row.admin_token_hash).toBe(hashToken(tokens[1]));
    expect(row.display_token_hash).toBe(hashToken(tokens[2]));
    const secrets = (
      await pool.query('SELECT * FROM party_link_secrets WHERE party_id = $1', [
        party.id,
      ])
    ).rows[0];
    expect(secrets.tokens_ciphertext.includes(Buffer.from(tokens[1]))).toBe(
      false,
    );
    expect(secrets.tokens_ciphertext.includes(Buffer.from(tokens[2]))).toBe(
      false,
    );
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('requires an authenticated host, same-origin writes, and valid whitelisted input', async () => {
    const anonymous = await app.inject({
      method: 'POST',
      url: '/api/parties',
      headers: { origin: config.appOrigin, 'idempotency-key': randomUUID() },
      payload: { name: 'Party' },
    });
    expect(anonymous.statusCode).toBe(401);
    const crossOrigin = await app.inject({
      method: 'POST',
      url: '/api/parties',
      headers: {
        origin: 'https://evil.example',
        'idempotency-key': randomUUID(),
      },
      cookies: { '__Host-crowdcue_host': host.token },
      payload: { name: 'Party' },
    });
    expect(crossOrigin.statusCode).toBe(403);
    for (const payload of [
      { name: '   ' },
      { name: 'x'.repeat(121) },
      { name: 'Injected', hostAccountId: other.id },
      { name: 'Party', settings: { votingEnabled: 'false' } },
      { name: 'Party', settings: { maxActiveRequestsPerGuest: 0 } },
    ])
      expect((await create(payload)).statusCode).toBe(400);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/parties',
          headers: { origin: config.appOrigin },
          cookies: { '__Host-crowdcue_host': host.token },
          payload: { name: 'Party' },
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await pool.query('SELECT id FROM parties WHERE host_account_id = $1', [
          host.id,
        ])
      ).rowCount,
    ).toBe(0);
  });

  it('makes concurrent retries idempotent, normalizes UUID casing, and rejects changed details', async () => {
    const key = randomUUID();
    const responses = await Promise.all([
      create({ name: '  Retry party  ' }, key),
      create({ name: 'Retry party' }, key.toUpperCase()),
      create({ name: 'Retry party', settings: {} }, key),
    ]);
    expect(responses.map((response) => response.statusCode).sort()).toEqual([
      200, 200, 201,
    ]);
    const parties = responses.map(
      (response) => response.json<{ party: PartyDetails }>().party,
    );
    expect(parties[1]).toEqual(parties[0]);
    expect(parties[2]).toEqual(parties[0]);
    expect((await create({ name: 'Changed party' }, key)).statusCode).toBe(409);
    expect(
      (
        await create(
          { name: 'Retry party', settings: { approvalRequired: true } },
          key,
        )
      ).statusCode,
    ).toBe(409);
    expect(
      (await create({ name: 'Other host’s party' }, key, other)).statusCode,
    ).toBe(201);
    expect(
      (
        await pool.query('SELECT id FROM parties WHERE host_account_id = $1', [
          host.id,
        ])
      ).rowCount,
    ).toBe(1);
  });

  it('rolls back the entire creation when settings fail and permits a retry', async () => {
    const key = randomUUID();
    const input = createPartySchema.parse({ name: 'Rollback party' });
    await expect(
      store.create(
        host.id,
        {
          ...input,
          settings: { ...input.settings, maxActiveRequestsPerGuest: 0 },
        },
        key,
      ),
    ).rejects.toMatchObject({ code: '23514' });
    expect(
      (
        await pool.query('SELECT id FROM parties WHERE host_account_id = $1', [
          host.id,
        ])
      ).rowCount,
    ).toBe(0);
    expect(
      (
        await pool.query(
          'SELECT * FROM party_creation_requests WHERE host_account_id = $1',
          [host.id],
        )
      ).rowCount,
    ).toBe(0);
    const result = await store.create(host.id, input, key);
    expect(result.created).toBe(true);
    expect((await store.create(host.id, input, key)).party).toEqual(
      result.party,
    );
  });

  it('requires ownership for private details and admin links, regardless of which token is supplied', async () => {
    const party = await created();
    const ownerCookies = { '__Host-crowdcue_host': host.token };
    const otherCookies = { '__Host-crowdcue_host': other.token };
    const adminPath = `/api/party-links/admin/${tokenFrom(party.links.admin!)}`;
    expect((await app.inject(`/api/parties/${party.id}`)).statusCode).toBe(401);
    expect((await app.inject(adminPath)).statusCode).toBe(401);
    expect(
      (
        await app.inject({
          url: `/api/parties/${party.id}`,
          cookies: otherCookies,
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (await app.inject({ url: adminPath, cookies: otherCookies })).statusCode,
    ).toBe(404);
    expect(
      (await app.inject({ url: adminPath, cookies: ownerCookies })).json(),
    ).toEqual({ party });
    expect(
      (
        await app.inject({
          url: `/api/party-links/admin/${tokenFrom(party.links.guest)}`,
          cookies: ownerCookies,
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await app.inject({
          url: `/api/party-links/admin/${tokenFrom(party.links.display!)}`,
          cookies: ownerCookies,
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await app.inject({
          url: '/api/parties',
          cookies: { '__Host-crowdcue_host': tokenFrom(party.links.guest) },
        })
      ).statusCode,
    ).toBe(401);
    expect(
      (
        await app.inject({
          url: `/api/parties?hostId=${other.id}`,
          cookies: ownerCookies,
        })
      ).statusCode,
    ).toBe(400);
  });

  it('limits guest/display responses to public details and keeps roles isolated', async () => {
    const party = await created();
    const guest = tokenFrom(party.links.guest);
    const display = tokenFrom(party.links.display!);
    const adminToken = tokenFrom(party.links.admin!);
    const guestResponse = await app.inject(`/api/party-links/guest/${guest}`);
    const displayResponse = await app.inject(
      `/api/party-links/display/${display}`,
    );
    expect(guestResponse.statusCode).toBe(200);
    expect(guestResponse.json()).toEqual({
      party: {
        name: party.name,
        status: party.status,
        settings: party.settings,
      },
    });
    expect(displayResponse.json()).toEqual({
      party: {
        name: party.name,
        status: party.status,
        settings: party.settings,
        guestUrl: party.links.guest,
      },
    });
    for (const response of [guestResponse, displayResponse]) {
      expect(response.body).not.toContain(adminToken);
      expect(response.body).not.toContain(host.id);
      expect(response.body).not.toMatch(
        /ciphertext|token_hash|test-access|test-refresh/,
      );
      expect(response.headers['cache-control']).toBe('no-store');
      expect(response.headers['referrer-policy']).toBe('no-referrer');
      expect(response.headers['x-robots-tag']).toBe(
        'noindex, nofollow, noarchive',
      );
    }
    expect(
      (await app.inject(`/api/party-links/display/${guest}`)).statusCode,
    ).toBe(404);
    expect(
      (await app.inject(`/api/party-links/guest/${display}`)).statusCode,
    ).toBe(404);
    expect(
      (await app.inject(`/api/party-links/guest/${adminToken}`)).statusCode,
    ).toBe(404);
    expect(
      (await app.inject(`/api/party-links/display/${adminToken}`)).statusCode,
    ).toBe(404);
    expect(
      (await app.inject(`/api/party-links/guest/not-a-token`)).statusCode,
    ).toBe(404);
  });

  it('recovers the same links after a store restart and isolates each host’s parties', async () => {
    const party = await created();
    const foreign = (
      await create({ name: 'Other party' }, randomUUID(), other)
    ).json<{ party: PartyDetails }>().party;
    const restartedPool = new pg.Pool({
      connectionString: url,
      options: `-c search_path=${schema}`,
    });
    try {
      const restarted = new PostgresPartyStore(
        restartedPool,
        cipher,
        config.appOrigin,
      );
      expect(await restarted.owned(host.id, party.id)).toEqual(party);
      expect((await restarted.list(host.id, 0)).parties).toEqual([party]);
      await expect(restarted.owned(host.id, foreign.id)).rejects.toMatchObject({
        statusCode: 404,
      });
    } finally {
      await restartedPool.end();
    }
  });

  it('supports multiple simultaneous parties and stable pages without changing settings', async () => {
    const ids = [];
    for (let i = 0; i < 21; i++) {
      const result = await store.create(
        host.id,
        createPartySchema.parse({
          name: `Party ${i}`,
          settings: {
            approvalRequired: true,
            requireGuestNames: true,
            votingEnabled: false,
            allowExplicitTracks: false,
          },
        }),
        randomUUID(),
      );
      ids.push(result.party.id);
    }
    const first = await app.inject({
      url: '/api/parties',
      cookies: { '__Host-crowdcue_host': host.token },
    });
    const page = first.json<{ parties: PartyDetails[]; nextOffset: number }>();
    expect(page.parties).toHaveLength(20);
    expect(page.nextOffset).toBe(20);
    const last = (await store.list(host.id, 20)).parties;
    expect(last).toHaveLength(1);
    expect(
      new Set([...page.parties, ...last].map((party) => party.id)),
    ).toEqual(new Set(ids));
    for (const party of [...page.parties, ...last])
      expect(party.settings).toMatchObject({
        approvalRequired: true,
        requireGuestNames: true,
        votingEnabled: false,
        allowExplicitTracks: false,
      });
    expect(
      (
        await app.inject({
          url: '/api/parties?offset=-1',
          cookies: { '__Host-crowdcue_host': host.token },
        })
      ).statusCode,
    ).toBe(400);
  });

  it('keeps party creation independent of Spotify API availability and rejects expired sessions', async () => {
    await pool.query('DELETE FROM spotify_credentials WHERE account_id = $1', [
      host.id,
    ]);
    expect((await create()).statusCode).toBe(201);
    expect(fetcher).not.toHaveBeenCalled();
    await pool.query(
      "UPDATE host_sessions SET created_at = now() - interval '2 days', expires_at = now() - interval '1 day' WHERE token_hash = $1",
      [hashToken(host.token)],
    );
    expect((await create()).statusCode).toBe(401);
  });

  it('returns ended party state without exposing private data', async () => {
    const party = await created();
    await pool.query(
      "UPDATE parties SET status = 'ENDED', ended_at = now() WHERE id = $1",
      [party.id],
    );
    const publicResponse = await app.inject(
      `/api/party-links/guest/${tokenFrom(party.links.guest)}`,
    );
    expect(publicResponse.json().party.status).toBe('ENDED');
    expect(publicResponse.json().party.links).toBeUndefined();
    expect((await store.owned(host.id, party.id)).endedAt).not.toBeNull();
  });
  it('secures admin mutations, persists preferences, and ends a party idempotently', async () => {
    const party = await created();
    const token = tokenFrom(party.links.admin!);
    const mutation = (
      action: string,
      payload: unknown,
      owner = host,
      origin = config.appOrigin,
      link = token,
    ) =>
      app.inject({
        method: 'POST',
        url: `/api/party-links/admin/${link}/${action}`,
        headers: { origin, 'content-type': 'application/json' },
        cookies: { '__Host-crowdcue_host': owner.token },
        payload: JSON.stringify(payload),
      });
    const input = {
      name: 'Updated party',
      settings: {
        ...party.settings,
        approvalRequired: true,
        requestCooldownSeconds: 30,
        maxActiveRequestsPerGuest: 3,
      },
    };
    expect((await mutation('settings', input, other)).statusCode).toBe(404);
    expect(
      (await mutation('settings', input, host, 'https://foreign.example'))
        .statusCode,
    ).toBe(403);
    expect(
      (
        await mutation(
          'settings',
          input,
          host,
          config.appOrigin,
          tokenFrom(party.links.guest),
        )
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await mutation(
          'end',
          {},
          host,
          config.appOrigin,
          tokenFrom(party.links.display!),
        )
      ).statusCode,
    ).toBe(404);
    expect(
      (await mutation('settings', { ...input, hostId: other.id })).statusCode,
    ).toBe(400);
    expect((await mutation('end', { unexpected: true })).statusCode).toBe(400);
    const saved = await mutation('settings', input);
    expect(saved.statusCode).toBe(200);
    expect(saved.json().party).toMatchObject(input);
    expect((await store.owned(host.id, party.id)).name).toBe('Updated party');
    const ended = await mutation('end', {});
    expect(ended.statusCode).toBe(200);
    expect(ended.json().party.status).toBe('ENDED');
    expect(ended.json().party.endedAt).not.toBeNull();
    expect((await mutation('end', {})).json().party.endedAt).toBe(
      ended.json().party.endedAt,
    );
    expect((await mutation('settings', input)).statusCode).toBe(409);
    expect(
      (await store.public(tokenFrom(party.links.guest), 'guest')).status,
    ).toBe('ENDED');
  });
});
