import sharp from 'sharp';
import { PostgresRequestStore } from '../src/server/requests/store.js';
import { PostgresGuestStore } from '../src/server/guests/store.js';
import { guestCookieName } from '../src/server/guests/routes.js';
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

function requireSavedRequest<T>(request: T | undefined): T {
  if (!request)
    throw new Error(
      'Expected a saved request, received a repeat-song confirmation.',
    );
  return request;
}

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
      guests: new PostgresGuestStore(pool),
      requests: new PostgresRequestStore(pool),
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

  it('archives ended and closed parties for their owner and removes only the gallery card', async () => {
    const party = await created();
    expect((await store.archive(host.id, 0)).parties).toEqual([]);
    await store.end(host.id, tokenFrom(party.links.admin!));
    await store.close(host.id, party.id);
    await pool.query(
      "UPDATE party_playback SET playlist_id=$2,playlist_creation='READY' WHERE party_id=$1",
      [party.id, 'p'.repeat(22)],
    );
    const list = await app.inject({
      url: '/api/parties/archive',
      cookies: { '__Host-crowdcue_host': host.token },
    });
    expect(list.statusCode).toBe(200);
    expect(list.json().parties).toEqual([
      expect.objectContaining({
        id: party.id,
        playlistUrl: `https://open.spotify.com/playlist/${'p'.repeat(22)}`,
      }),
    ]);
    expect(
      (
        await app.inject({
          url: '/api/parties/archive',
          cookies: { '__Host-crowdcue_host': other.token },
        })
      ).json().parties,
    ).toEqual([]);
    const remove = (cookie: string, origin = config.appOrigin) =>
      app.inject({
        method: 'POST',
        url: `/api/parties/${party.id}/archive/remove`,
        headers: { origin },
        cookies: { '__Host-crowdcue_host': cookie },
        payload: {},
      });
    expect((await remove(other.token)).statusCode).toBe(404);
    expect((await remove(host.token, 'https://evil.example')).statusCode).toBe(
      403,
    );
    expect((await remove(host.token)).json()).toEqual({ removed: true });
    expect((await remove(host.token)).json()).toEqual({ removed: true });
    expect((await store.archive(host.id, 0)).parties).toEqual([]);
    expect((await store.owned(host.id, party.id)).status).toBe('ENDED');
    expect(
      (
        await pool.query(
          'SELECT playlist_id FROM party_playback WHERE party_id=$1',
          [party.id],
        )
      ).rows[0].playlist_id,
    ).toBe('p'.repeat(22));
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('validates and persists normalized covers atomically with creation and protects image reads and writes', async () => {
    const png = await sharp({
      create: { width: 32, height: 16, channels: 3, background: '#65b32e' },
    })
      .png()
      .toBuffer();
    const key = randomUUID();
    const payload = { name: 'Covered party', cover: png.toString('base64') };
    const first = await create(payload, key);
    expect(first.statusCode).toBe(201);
    const p = first.json().party;
    expect((await create(payload, key)).json().party.id).toBe(p.id);
    expect(
      (
        await create(
          { ...payload, cover: Buffer.from('bad').toString('base64') },
          randomUUID(),
        )
      ).statusCode,
    ).toBe(400);
    const image = await app.inject({
      url: `/api/parties/${p.id}/cover`,
      cookies: { '__Host-crowdcue_host': host.token },
    });
    expect(image.statusCode).toBe(200);
    expect(image.headers['content-type']).toBe('image/jpeg');
    const metadata = await sharp(image.rawPayload).metadata();
    expect(metadata).toMatchObject({ format: 'jpeg', width: 512, height: 512 });
    expect(metadata.exif).toBeUndefined();
    expect(
      (
        await app.inject({
          url: `/api/parties/${p.id}/cover`,
          cookies: { '__Host-crowdcue_host': other.token },
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (await app.inject({ url: `/api/parties/${p.id}/cover` })).statusCode,
    ).toBe(401);
    const upload = (cookie: string, origin = config.appOrigin) =>
      app.inject({
        method: 'POST',
        url: `/api/parties/${p.id}/cover`,
        headers: { origin },
        cookies: { '__Host-crowdcue_host': cookie },
        payload: { cover: png.toString('base64') },
      });
    expect((await upload(other.token)).statusCode).toBe(404);
    expect((await upload(host.token, 'https://evil.example')).statusCode).toBe(
      403,
    );
    expect((await upload(host.token)).json()).toEqual({ saved: true });
    await store.end(host.id, tokenFrom(p.links.admin));
    expect((await upload(host.token)).statusCode).toBe(409);
    expect((await store.archive(host.id, 0)).parties[0].coverUrl).toBe(
      `/api/parties/${p.id}/cover`,
    );
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
        queueBehavior: 'BACKUP_PLAYLIST',
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
  it('creates hashed party-scoped guest sessions and recovers or renames the same identity', async () => {
    const party = await created();
    const join = tokenFrom(party.links.guest);
    const path = `/api/party-links/guest/${join}/session`;
    expect((await app.inject(path)).json()).toEqual({ guest: null });
    const entered = await app.inject({
      method: 'POST',
      url: path,
      headers: { origin: config.appOrigin },
      payload: {},
    });
    expect(entered.statusCode).toBe(201);
    const cookie = entered.cookies[0];
    expect(cookie.name).toBe(guestCookieName(join, true));
    expect(cookie.httpOnly).toBe(true);
    expect(cookie.secure).toBe(true);
    expect(cookie.sameSite).toBe('Lax');
    expect(cookie.path).toBe('/');
    expect(entered.body).not.toContain(cookie.value);
    const row = (
      await pool.query(
        'SELECT session_token_hash, display_name FROM guests WHERE id = $1',
        [entered.json().guest.id],
      )
    ).rows[0];
    expect(row.session_token_hash).toBe(hashToken(cookie.value));
    expect(row.display_name).toBeNull();
    const cookies = { [cookie.name]: cookie.value };
    expect((await app.inject({ url: path, cookies })).json()).toEqual(
      entered.json(),
    );
    const renamed = await app.inject({
      method: 'POST',
      url: path,
      headers: { origin: config.appOrigin },
      cookies,
      payload: { displayName: '  Alex  ' },
    });
    expect(renamed.statusCode).toBe(200);
    expect(renamed.json().guest.id).toBe(entered.json().guest.id);
    expect(renamed.json().guest.displayName).toBe('Alex');
    expect(
      (await new PostgresGuestStore(pool).session(join, cookie.value))
        ?.displayName,
    ).toBe('Alex');
    expect(
      (
        await app.inject({
          url: `/api/party-links/admin/${tokenFrom(party.links.admin!)}`,
          cookies,
        })
      ).statusCode,
    ).toBe(401);
    const second = await created();
    const secondJoin = tokenFrom(second.links.guest);
    expect(
      await new PostgresGuestStore(pool).session(secondJoin, cookie.value),
    ).toBeNull();
    expect(
      (
        await app.inject({
          url: `/api/party-links/guest/${secondJoin}/session`,
          cookies,
        })
      ).json(),
    ).toEqual({ guest: null });
    for (const response of [entered, renamed]) {
      expect(response.headers['cache-control']).toBe('no-store');
      expect(response.headers['referrer-policy']).toBe('no-referrer');
      expect(response.headers['x-robots-tag']).toContain('noindex');
      expect(response.body).not.toContain(host.id);
      expect(response.body).not.toContain(party.links.admin!);
    }
  });

  it('enforces guest name rules, Origin, token roles, ended state, and expired-session renewal', async () => {
    const party = (
      await create({
        name: 'Named party',
        settings: { requireGuestNames: true },
      })
    ).json<{ party: PartyDetails }>().party;
    const join = tokenFrom(party.links.guest);
    const path = `/api/party-links/guest/${join}/session`;
    const enter = (
      payload: unknown,
      cookies = {},
      origin = config.appOrigin,
      url = path,
    ) =>
      app.inject({
        method: 'POST',
        url,
        headers: { origin },
        cookies,
        payload: JSON.stringify(payload),
      });
    // inject needs a JSON content type when sending serialized data.
    const post = (
      payload: unknown,
      cookies = {},
      origin = config.appOrigin,
      url = path,
    ) =>
      app.inject({
        method: 'POST',
        url,
        headers: { origin, 'content-type': 'application/json' },
        cookies,
        payload: JSON.stringify(payload),
      });
    expect((await enter({})).statusCode).toBe(415);
    expect((await post({})).statusCode).toBe(400);
    expect((await post({ displayName: ' ' })).statusCode).toBe(400);
    expect((await post({ displayName: 'x'.repeat(81) })).statusCode).toBe(400);
    expect((await post({ displayName: 'bad\nname' })).statusCode).toBe(400);
    expect(
      (await post({ displayName: 'Alex', partyId: party.id })).statusCode,
    ).toBe(400);
    expect(
      (await post({ displayName: 'Alex' }, {}, 'https://foreign.example'))
        .statusCode,
    ).toBe(403);
    for (const link of [party.links.admin!, party.links.display!]) {
      expect(
        (
          await post(
            { displayName: 'Alex' },
            {},
            config.appOrigin,
            `/api/party-links/guest/${tokenFrom(link)}/session`,
          )
        ).statusCode,
      ).toBe(404);
    }
    const entered = await post({ displayName: 'Alex' });
    expect(entered.statusCode).toBe(201);
    const cookie = entered.cookies[0];
    const cookies = { [cookie.name]: cookie.value };
    expect((await post({ displayName: null }, cookies)).statusCode).toBe(400);
    expect((await post({}, cookies)).json().guest.id).toBe(
      entered.json().guest.id,
    );
    await pool.query(
      "UPDATE guests SET created_at = now() - interval '31 days', expires_at = now() - interval '1 day' WHERE id = $1",
      [entered.json().guest.id],
    );
    expect((await app.inject({ url: path, cookies })).json()).toEqual({
      guest: null,
    });
    const renewed = await post({ displayName: 'Alex' }, cookies);
    expect(renewed.statusCode).toBe(201);
    expect(renewed.json().guest.id).not.toBe(entered.json().guest.id);
    await store.end(host.id, tokenFrom(party.links.admin!));
    expect((await post({ displayName: 'Alex' })).statusCode).toBe(409);
    expect(
      (
        await post(
          { displayName: 'Alex' },
          { [cookie.name]: renewed.cookies[0].value },
        )
      ).statusCode,
    ).toBe(409);
    expect(
      (
        await app.inject({
          url: path,
          cookies: { [cookie.name]: renewed.cookies[0].value },
        })
      ).json().guest.id,
    ).toBe(renewed.json().guest.id);
  });
  it('authorizes party guest searches, filters explicit songs, and refreshes a rejected host token once', async () => {
    const party = (
      await create({
        name: 'Search party',
        settings: { allowExplicitTracks: false },
      })
    ).json<{ party: PartyDetails }>().party;
    const join = tokenFrom(party.links.guest);
    const path = `/api/party-links/guest/${join}/search?q=song`;
    expect((await app.inject(path)).statusCode).toBe(401);
    expect(fetcher).not.toHaveBeenCalled();
    const entered = await app.inject({
      method: 'POST',
      url: `/api/party-links/guest/${join}/session`,
      headers: { origin: config.appOrigin },
      payload: {},
    });
    const cookies = { [entered.cookies[0].name]: entered.cookies[0].value };
    const song = {
      id: 'a'.repeat(22),
      name: 'Song',
      artists: [{ name: 'Artist' }],
      album: { name: 'Album', images: [] },
      duration_ms: 120000,
      explicit: false,
    };
    const page = {
      tracks: {
        items: [song, { ...song, id: 'b'.repeat(22), explicit: true }],
        next: null,
      },
    };
    fetcher.mockResolvedValueOnce(new Response(JSON.stringify(page)));
    const results = await app.inject({ url: path, cookies });
    expect(results.statusCode).toBe(200);
    expect(results.json().tracks).toHaveLength(1);
    expect(results.body).not.toMatch(
      /test-access|test-refresh|host_account_id|ciphertext/,
    );
    expect(results.headers['cache-control']).toBe('no-store');
    const foreign = await created();
    expect(
      (
        await app.inject({
          url: `/api/party-links/guest/${tokenFrom(foreign.links.guest)}/search?q=song`,
          cookies,
        })
      ).statusCode,
    ).toBe(401);
    expect(
      (await app.inject({ url: path + '&hostId=' + other.id, cookies }))
        .statusCode,
    ).toBe(400);
    expect(
      (
        await app.inject({
          url: `/api/party-links/guest/${tokenFrom(party.links.display!)}/search?q=song`,
          cookies,
        })
      ).statusCode,
    ).toBe(404);
    fetcher
      .mockResolvedValueOnce(new Response('{}', { status: 401 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            access_token: 'fresh-search-token',
            refresh_token: 'fresh-refresh',
            expires_in: 3600,
            token_type: 'Bearer',
            scope: spotifyScopes.join(' '),
          }),
        ),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify(page)));
    expect((await app.inject({ url: path, cookies })).statusCode).toBe(200);
    expect(fetcher.mock.calls.at(-1)![1]!.headers).toEqual({
      authorization: 'Bearer fresh-search-token',
    });
    fetcher.mockResolvedValueOnce(
      new Response('secret provider error', {
        status: 429,
        headers: { 'retry-after': '15' },
      }),
    );
    const limited = await app.inject({ url: path, cookies });
    expect(limited.statusCode).toBe(429);
    expect(limited.headers['retry-after']).toBe('15');
    expect(limited.body).not.toContain('secret provider error');
    await store.update(
      host.id,
      tokenFrom(party.links.admin!),
      createPartySchema.parse({
        name: party.name,
        settings: { ...party.settings, requireGuestNames: true },
      }),
    );
    expect((await app.inject({ url: path, cookies })).statusCode).toBe(400);
    await store.end(host.id, tokenFrom(party.links.admin!));
    const calls = fetcher.mock.calls.length;
    expect((await app.inject({ url: path, cookies })).statusCode).toBe(409);
    expect(fetcher).toHaveBeenCalledTimes(calls);
  });
  it('stores canonical song requests, replays attempts, collapses concurrent duplicates, and moderates securely', async () => {
    const party = (
      await create({ name: 'Requests', settings: { approvalRequired: true } })
    ).json<{ party: PartyDetails }>().party;
    const join = tokenFrom(party.links.guest),
      adminLink = tokenFrom(party.links.admin!);
    const path = `/api/party-links/guest/${join}/requests`;
    const guest = await new PostgresGuestStore(pool).join(
      join,
      undefined,
      'Alex',
    );
    const another = await new PostgresGuestStore(pool).join(
      join,
      undefined,
      'Sam',
    );
    const cookies = { [guestCookieName(join, true)]: guest.token };
    const song = {
      id: 'a'.repeat(22),
      name: 'Canonical song',
      artists: [{ name: 'Artist' }],
      album: { name: 'Album', images: [] },
      duration_ms: 185000,
      explicit: false,
    };
    fetcher.mockImplementation(async () => new Response(JSON.stringify(song)));
    const key = randomUUID();
    const post = (
      trackId = song.id,
      attempt: string = key,
      browser = cookies,
      origin = config.appOrigin,
      payload: unknown = { trackId },
    ) =>
      app.inject({
        method: 'POST',
        url: path,
        headers: {
          origin,
          'idempotency-key': attempt,
          'content-type': 'application/json',
        },
        cookies: browser,
        payload: JSON.stringify(payload),
      });
    expect((await post(song.id, key, {})).statusCode).toBe(401);
    expect(
      (await post(song.id, key, cookies, 'https://foreign.example')).statusCode,
    ).toBe(403);
    expect(
      (
        await post(song.id, key, cookies, config.appOrigin, {
          trackId: song.id,
          title: 'Forged metadata',
        })
      ).statusCode,
    ).toBe(400);
    expect(fetcher).not.toHaveBeenCalled();
    const responses = await Promise.all([
      post(),
      post(song.id, key.toUpperCase()),
      post(song.id, randomUUID(), {
        [guestCookieName(join, true)]: another.token,
      }),
    ]);
    expect(responses.map((response) => response.statusCode).sort()).toEqual([
      200, 200, 201,
    ]);
    const saved = responses[0].json().request;
    for (const response of responses)
      expect(response.json().request.id).toBe(saved.id);
    expect(saved.track.title).toBe('Canonical song');
    expect(saved.status).toBe('REQUESTED');
    expect(
      (
        await pool.query('SELECT * FROM song_requests WHERE party_id = $1', [
          party.id,
        ])
      ).rowCount,
    ).toBe(1);
    const calls = fetcher.mock.calls.length;
    expect((await post()).statusCode).toBe(200);
    expect(fetcher).toHaveBeenCalledTimes(calls);
    expect((await post('b'.repeat(22))).statusCode).toBe(409);
    const list = await app.inject({ url: path, cookies });
    expect(list.json().requests[0]).toMatchObject({
      id: saved.id,
      isOwn: saved.isOwn,
    });
    expect(list.body).not.toMatch(
      /test-access|test-refresh|host_account_id|session_token_hash/,
    );
    expect(list.headers['cache-control']).toBe('no-store');
    const moderate = (
      action: string,
      owner = host,
      link = adminLink,
      id = saved.id,
    ) =>
      app.inject({
        method: 'POST',
        url: `/api/party-links/admin/${link}/requests/${id}`,
        headers: { origin: config.appOrigin },
        cookies: { '__Host-crowdcue_host': owner.token },
        payload: { action },
      });
    expect((await moderate('approve', other)).statusCode).toBe(404);
    expect((await moderate('approve', host, join)).statusCode).toBe(404);
    expect(
      (await moderate('approve', host, adminLink, randomUUID())).statusCode,
    ).toBe(404);
    expect((await moderate('approve')).json().request.status).toBe('APPROVED');
    expect((await moderate('approve')).statusCode).toBe(200);
    expect((await moderate('remove')).json().request.status).toBe('REMOVED');
    expect((await post()).json().request.status).toBe('REMOVED');
    expect((await moderate('approve')).statusCode).toBe(409);
    const restarted = new PostgresRequestStore(pool);
    expect(
      (await restarted.guestList(join, guest.token, 0)).requests.some(
        (row) => row.id === saved.id,
      ),
    ).toBe(saved.isOwn);
    expect(
      (await restarted.adminList(host.id, adminLink, 0)).requests[0].status,
    ).toBe('REMOVED');
  });

  it('requires guest confirmation before re-requesting a played song', async () => {
    const party = (
      await create({
        name: 'Played repeats',
        settings: { approvalRequired: false },
      })
    ).json<{ party: PartyDetails }>().party;
    const join = tokenFrom(party.links.guest);
    const guest = await new PostgresGuestStore(pool).join(
      join,
      undefined,
      'Alex',
    );
    const cookies = { [guestCookieName(join, true)]: guest.token };
    const path = `/api/party-links/guest/${join}/requests`;
    const song = {
      id: 'c'.repeat(22),
      name: 'Already played song',
      artists: [{ name: 'Artist' }],
      album: { name: 'Album', images: [] },
      duration_ms: 185000,
      explicit: false,
    };
    fetcher.mockImplementation(async () => new Response(JSON.stringify(song)));
    const post = (attempt = randomUUID(), confirmPlayedRepeat = false) =>
      app.inject({
        method: 'POST',
        url: path,
        headers: {
          origin: config.appOrigin,
          'idempotency-key': attempt,
          'content-type': 'application/json',
        },
        cookies,
        payload: JSON.stringify({
          confirmPlayedRepeat,
          trackId: song.id,
        }),
      });
    const first = await post();
    expect(first.statusCode).toBe(201);
    const firstRequest = first.json().request;
    await pool.query(
      "UPDATE song_requests SET status = 'PLAYED' WHERE id = $1",
      [firstRequest.id],
    );
    fetcher.mockClear();
    const repeatKey = randomUUID();
    const warning = await post(repeatKey);
    expect(warning.statusCode).toBe(200);
    expect(warning.json()).toEqual({
      confirmationRequired: true,
      message: 'Song already played...proceed?',
    });
    expect(fetcher).not.toHaveBeenCalled();
    expect(
      (
        await pool.query(
          'SELECT count(*)::int AS count FROM song_requests WHERE party_id = $1',
          [party.id],
        )
      ).rows[0].count,
    ).toBe(1);
    const confirmed = await post(repeatKey, true);
    expect(confirmed.statusCode).toBe(201);
    expect(confirmed.json().request.id).not.toBe(firstRequest.id);
    expect(fetcher).toHaveBeenCalledOnce();
    expect(
      (
        await pool.query(
          'SELECT count(*)::int AS count FROM song_requests WHERE party_id = $1',
          [party.id],
        )
      ).rows[0].count,
    ).toBe(2);
  });

  it('enforces request limits, cooldowns, explicit/name rules, session scope, and ended-party rejection', async () => {
    const party = (
      await create({
        name: 'Limited requests',
        settings: {
          maxActiveRequestsPerGuest: 1,
          requestCooldownSeconds: 60,
          allowExplicitTracks: false,
        },
      })
    ).json<{ party: PartyDetails }>().party;
    const join = tokenFrom(party.links.guest),
      adminLink = tokenFrom(party.links.admin!);
    const guest = await new PostgresGuestStore(pool).join(join, undefined);
    const cookies = { [guestCookieName(join, true)]: guest.token };
    const path = `/api/party-links/guest/${join}/requests`;
    fetcher.mockImplementation(
      async (input) =>
        new Response(
          JSON.stringify({
            id: new URL(String(input)).pathname.split('/').at(-1),
            name: 'Song',
            artists: [{ name: 'Artist' }],
            album: { name: 'Album', images: [] },
            duration_ms: 120000,
            explicit: String(input).endsWith('e'.repeat(22)),
          }),
        ),
    );
    const post = (trackId: string, browser = cookies) =>
      app.inject({
        method: 'POST',
        url: path,
        headers: { origin: config.appOrigin, 'idempotency-key': randomUUID() },
        cookies: browser,
        payload: { trackId },
      });
    expect((await post('e'.repeat(22))).statusCode).toBe(400);
    const accepted = await post('a'.repeat(22));
    expect(accepted.statusCode).toBe(201);
    expect(accepted.json().request.status).toBe('APPROVED');
    expect((await post('b'.repeat(22))).statusCode).toBe(409);
    await new PostgresRequestStore(pool).moderate(
      host.id,
      adminLink,
      accepted.json().request.id,
      'reject',
    );
    const cooled = await post('b'.repeat(22));
    expect(cooled.statusCode).toBe(429);
    expect(Number(cooled.headers['retry-after'])).toBeGreaterThan(0);
    const foreign = await created();
    expect(
      (
        await app.inject({
          url: `/api/party-links/guest/${tokenFrom(foreign.links.guest)}/requests`,
          cookies,
        })
      ).statusCode,
    ).toBe(401);
    const nameless = createPartySchema.parse({
      name: party.name,
      settings: { ...party.settings, requireGuestNames: true },
    });
    await store.update(host.id, adminLink, nameless);
    expect((await post('c'.repeat(22))).statusCode).toBe(400);
    await pool.query(
      "UPDATE guests SET created_at = now() - interval '31 days', expires_at = now() - interval '1 day' WHERE id = $1",
      [guest.guest.id],
    );
    expect((await post('c'.repeat(22))).statusCode).toBe(401);
    await store.end(host.id, adminLink);
    const otherGuest = await new PostgresGuestStore(pool).session(
      join,
      guest.token,
    );
    expect(otherGuest).toBeNull();
    expect(
      (
        await pool.query('SELECT * FROM song_requests WHERE party_id = $1', [
          party.id,
        ])
      ).rowCount,
    ).toBe(1);
  });
  it('revalidates party rules after Spotify metadata returns without holding a database lock across the call', async () => {
    const party = await created();
    const join = tokenFrom(party.links.guest),
      adminLink = tokenFrom(party.links.admin!);
    const guest = await new PostgresGuestStore(pool).join(join, undefined);
    let complete!: (value: Response) => void;
    const pending = () =>
      new Promise<Response>((resolve) => {
        complete = resolve;
      });
    fetcher.mockImplementation(() => pending());
    const submit = (trackId: string) =>
      app.inject({
        method: 'POST',
        url: `/api/party-links/guest/${join}/requests`,
        headers: { origin: config.appOrigin, 'idempotency-key': randomUUID() },
        cookies: { [guestCookieName(join, true)]: guest.token },
        payload: { trackId },
      });
    const song = {
      id: 'a'.repeat(22),
      name: 'Song',
      artists: [{ name: 'Artist' }],
      album: { name: 'Album', images: [] },
      duration_ms: 120000,
      explicit: true,
    };
    const first = submit(song.id);
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledOnce());
    await store.update(
      host.id,
      adminLink,
      createPartySchema.parse({
        name: party.name,
        settings: { allowExplicitTracks: false },
      }),
    );
    complete(new Response(JSON.stringify(song)));
    expect((await first).statusCode).toBe(400);
    const second = submit('b'.repeat(22));
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
    await store.end(host.id, adminLink);
    complete(
      new Response(
        JSON.stringify({ ...song, id: 'b'.repeat(22), explicit: false }),
      ),
    );
    expect((await second).statusCode).toBe(409);
    expect(
      (
        await pool.query('SELECT * FROM song_requests WHERE party_id = $1', [
          party.id,
        ])
      ).rowCount,
    ).toBe(0);
  });
  it('persists one vote per guest/request under concurrent retries and reports viewer-specific totals', async () => {
    const party = await created(),
      join = tokenFrom(party.links.guest);
    const guestStore = new PostgresGuestStore(pool),
      requests = new PostgresRequestStore(pool);
    const alex = await guestStore.join(join, undefined, 'Alex'),
      bea = await guestStore.join(join, undefined, 'Bea'),
      requester = await guestStore.join(join, undefined, 'Requester');
    const track = {
      id: 'v'.repeat(22),
      title: 'Vote song',
      artists: ['Artist'],
      album: 'Album',
      artworkUrl: null,
      durationMs: 120000,
      explicit: false,
      spotifyUrl: `https://open.spotify.com/track/${'v'.repeat(22)}`,
    };
    const song = requireSavedRequest(
      (await requests.create(join, requester.token, track, randomUUID()))
        .request,
    );
    const path = `/api/party-links/guest/${join}/requests/${song.id}/vote`;
    const vote = (
      voted: boolean,
      guest = alex,
      origin = config.appOrigin,
      url = path,
      body: unknown = { voted },
    ) =>
      app.inject({
        method: 'POST',
        url,
        headers: { origin, 'content-type': 'application/json' },
        cookies: { [guestCookieName(url.split('/')[4], true)]: guest.token },
        payload: JSON.stringify(body),
      });
    expect((await vote(true, requester)).statusCode).toBe(409);
    const concurrent = await Promise.all(
      Array.from({ length: 8 }, () => vote(true)),
    );
    for (const response of concurrent) {
      expect(response.statusCode).toBe(200);
      expect(response.json().request).toMatchObject({
        voteCount: 1,
        hasVoted: true,
        isOwn: false,
      });
    }
    expect(
      (await pool.query('SELECT * FROM votes WHERE request_id = $1', [song.id]))
        .rowCount,
    ).toBe(1);
    expect(
      (await requests.guestList(join, bea.token, 0)).requests[0],
    ).toMatchObject({ voteCount: 1, hasVoted: false });
    expect((await vote(true, bea)).json().request.voteCount).toBe(2);
    expect((await vote(false)).json().request).toMatchObject({
      voteCount: 1,
      hasVoted: false,
    });
    expect((await vote(false)).json().request.voteCount).toBe(1);
    const restarted = new PostgresRequestStore(pool);
    expect(
      (await restarted.guestList(join, bea.token, 0)).requests[0],
    ).toMatchObject({ voteCount: 1, hasVoted: true });
    expect(
      (await restarted.adminList(host.id, tokenFrom(party.links.admin!), 0))
        .requests[0],
    ).toMatchObject({ voteCount: 1, hasVoted: false });
    expect(fetcher).not.toHaveBeenCalled();
    expect((await vote(true, alex, 'https://foreign.example')).statusCode).toBe(
      403,
    );
    expect(
      (
        await vote(true, alex, config.appOrigin, path, {
          voted: true,
          guestId: bea.guest.id,
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (await vote(true, alex, config.appOrigin, path, { voted: 'true' }))
        .statusCode,
    ).toBe(400);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: path,
          headers: { origin: config.appOrigin },
          payload: { voted: true },
        })
      ).statusCode,
    ).toBe(401);
    const foreign = await created(),
      foreignJoin = tokenFrom(foreign.links.guest),
      foreignGuest = await guestStore.join(foreignJoin, undefined);
    expect(
      (
        await vote(
          true,
          foreignGuest,
          config.appOrigin,
          `/api/party-links/guest/${foreignJoin}/requests/${song.id}/vote`,
        )
      ).statusCode,
    ).toBe(404);
    for (const roleLink of [party.links.admin!, party.links.display!])
      expect(
        (
          await vote(
            true,
            alex,
            config.appOrigin,
            `/api/party-links/guest/${tokenFrom(roleLink)}/requests/${song.id}/vote`,
          )
        ).statusCode,
      ).toBe(404);
    expect(
      (await requests.guestList(join, bea.token, 0)).requests[0].voteCount,
    ).toBe(1);
  });

  it('blocks voting when disabled, unnamed, expired, ended, or closed while retaining historical votes', async () => {
    const party = await created(),
      join = tokenFrom(party.links.guest),
      adminLink = tokenFrom(party.links.admin!);
    const guests = new PostgresGuestStore(pool),
      requests = new PostgresRequestStore(pool);
    const guest = await guests.join(join, undefined);
    const track = {
      id: 'w'.repeat(22),
      title: 'Vote song',
      artists: ['Artist'],
      album: 'Album',
      artworkUrl: null,
      durationMs: 120000,
      explicit: false,
      spotifyUrl: `https://open.spotify.com/track/${'w'.repeat(22)}`,
    };
    const song = requireSavedRequest(
      (
        await requests.create(
          join,
          (await guests.join(join, undefined, 'Requester')).token,
          track,
          randomUUID(),
        )
      ).request,
    );
    const vote = (voted: boolean) =>
      app.inject({
        method: 'POST',
        url: `/api/party-links/guest/${join}/requests/${song.id}/vote`,
        headers: { origin: config.appOrigin },
        cookies: { [guestCookieName(join, true)]: guest.token },
        payload: { voted },
      });
    expect((await vote(true)).statusCode).toBe(200);
    await store.update(
      host.id,
      adminLink,
      createPartySchema.parse({
        name: party.name,
        settings: { votingEnabled: false },
      }),
    );
    expect((await vote(false)).statusCode).toBe(409);
    expect(
      (await requests.guestList(join, guest.token, 0)).requests[0].voteCount,
    ).toBe(1);
    await store.update(
      host.id,
      adminLink,
      createPartySchema.parse({
        name: party.name,
        settings: { requireGuestNames: true },
      }),
    );
    expect((await vote(false)).statusCode).toBe(400);
    await guests.join(join, guest.token, 'Alex');
    expect((await vote(false)).statusCode).toBe(200);
    expect((await vote(true)).statusCode).toBe(200);
    await requests.moderate(host.id, adminLink, song.id, 'remove');
    expect((await vote(false)).statusCode).toBe(409);
    const replacement = requireSavedRequest(
      (
        await requests.create(
          join,
          (await guests.join(join, undefined, 'Requester')).token,
          track,
          randomUUID(),
        )
      ).request,
    );
    expect(replacement).toMatchObject({ voteCount: 0, hasVoted: false });
    expect(
      (await requests.adminList(host.id, adminLink, 0)).requests.find(
        (row) => row.id === song.id,
      )?.voteCount,
    ).toBe(1);
    await store.end(host.id, adminLink);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: `/api/party-links/guest/${join}/requests/${replacement.id}/vote`,
          headers: { origin: config.appOrigin },
          cookies: { [guestCookieName(join, true)]: guest.token },
          payload: { voted: true },
        })
      ).statusCode,
    ).toBe(409);
    await pool.query(
      "UPDATE guests SET created_at = now() - interval '31 days', expires_at = now() - interval '1 day' WHERE id = $1",
      [guest.guest.id],
    );
    expect((await vote(true)).statusCode).toBe(401);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('dynamically ranks approved songs, preserves ties, and follows approval and voting settings', async () => {
    const party = (
      await create({
        name: 'Queue party',
        settings: { requestCooldownSeconds: 0, maxActiveRequestsPerGuest: 10 },
      })
    ).json<{ party: PartyDetails }>().party;
    const join = tokenFrom(party.links.guest),
      adminLink = tokenFrom(party.links.admin!);
    const guests = new PostgresGuestStore(pool),
      requests = new PostgresRequestStore(pool);
    const guest = await guests.join(join, undefined, 'Alex');
    const voter = await guests.join(join, undefined, 'Voter');
    const song = async (letter: string) =>
      requireSavedRequest(
        (
          await requests.create(
            join,
            guest.token,
            {
              id: letter.repeat(22),
              title: letter,
              artists: ['Artist'],
              album: 'Album',
              artworkUrl: null,
              durationMs: 120000,
              explicit: false,
              spotifyUrl: `https://open.spotify.com/track/${letter.repeat(22)}`,
            },
            randomUUID(),
          )
        ).request,
      );
    const first = await song('a'),
      second = await song('b');
    await pool.query(
      "UPDATE song_requests SET created_at = '2026-01-01' WHERE id = $1",
      [first.id],
    );
    const ids = async () =>
      (await requests.guestQueue(join, guest.token, 0)).items.map(
        (x) => x.request.id,
      );
    expect(await ids()).toEqual([first.id, second.id]);
    await requests.vote(join, voter.token, second.id, true);
    expect(await ids()).toEqual([second.id, first.id]);
    await requests.vote(join, voter.token, first.id, true);
    expect(await ids()).toEqual([first.id, second.id]);
    await requests.vote(join, voter.token, first.id, false);
    await store.update(
      host.id,
      adminLink,
      createPartySchema.parse({
        name: party.name,
        settings: {
          votingEnabled: false,
          approvalRequired: true,
          requestCooldownSeconds: 0,
          maxActiveRequestsPerGuest: 10,
        },
      }),
    );
    expect(await ids()).toEqual([first.id, second.id]);
    const pending = await song('c');
    await store.update(
      host.id,
      adminLink,
      createPartySchema.parse({
        name: party.name,
        settings: {
          approvalRequired: true,
          requestCooldownSeconds: 0,
          maxActiveRequestsPerGuest: 10,
        },
      }),
    );
    await requests.vote(join, voter.token, pending.id, true);
    expect(await ids()).toEqual([second.id, first.id]);
    await requests.moderate(host.id, adminLink, pending.id, 'approve');
    expect(await ids()).toEqual([second.id, pending.id, first.id]);
    await requests.moderate(host.id, adminLink, second.id, 'remove');
    expect(await ids()).toEqual([pending.id, first.id]);
    const restarted = new PostgresRequestStore(pool);
    expect(
      (await restarted.adminQueue(host.id, adminLink, 0)).items.map(
        (x) => x.request.id,
      ),
    ).toEqual(await ids());
    await store.end(host.id, adminLink);
    expect(await requests.guestQueue(join, guest.token, 0)).toMatchObject({
      status: 'ENDED',
      items: [
        { position: 1, request: { id: pending.id } },
        { position: 2, request: { id: first.id } },
      ],
    });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('protects queue snapshots by role and session and returns stable global page positions', async () => {
    const party = await created(),
      join = tokenFrom(party.links.guest),
      adminLink = tokenFrom(party.links.admin!);
    const guest = await new PostgresGuestStore(pool).join(
      join,
      undefined,
      'Alex',
    );
    await pool.query(
      `INSERT INTO song_requests (party_id,requested_by,spotify_track_id,track_name,artist_name,album_name,duration_ms,is_explicit,status,created_at)
      SELECT $1,$2,lpad(n::text,22,'0'),'Song '||n,'Artist','Album',120000,false,'APPROVED','2026-01-01'::timestamptz FROM generate_series(1,51) n`,
      [party.id, guest.guest.id],
    );
    const requests = new PostgresRequestStore(pool);
    const front = await requests.guestQueue(join, guest.token, 0),
      back = await requests.guestQueue(join, guest.token, 50);
    expect(front.items).toHaveLength(50);
    expect(front.nextOffset).toBe(50);
    expect(back.items).toHaveLength(1);
    expect(back.items[0].position).toBe(51);
    expect(back.nextOffset).toBeNull();
    const sorted = [...front.items, ...back.items].map((x) => x.request.id);
    expect(sorted).toEqual([...sorted].sort());
    const get = (
      role: string,
      token: string,
      cookies: Record<string, string> = {},
    ) =>
      app.inject({
        method: 'GET',
        url: `/api/party-links/${role}/${token}/queue?offset=0`,
        cookies,
      });
    expect((await get('guest', join)).statusCode).toBe(401);
    expect(
      (
        await get('guest', join, { [guestCookieName(join, true)]: guest.token })
      ).json().items,
    ).toHaveLength(50);
    expect(
      (await get('admin', adminLink, { '__Host-crowdcue_host': other.token }))
        .statusCode,
    ).toBe(404);
    expect(
      (await get('admin', adminLink, { '__Host-crowdcue_host': host.token }))
        .statusCode,
    ).toBe(200);
    expect(
      (
        await get('guest', adminLink, {
          [guestCookieName(adminLink, true)]: guest.token,
        })
      ).statusCode,
    ).toBe(404);
    await pool.query("UPDATE song_requests SET status='QUEUED' WHERE id=$1", [
      front.items[0].request.id,
    ]);
    expect(
      (await requests.guestQueue(join, guest.token, 0)).items,
    ).toHaveLength(50);
    await pool.query(
      "UPDATE guests SET created_at=now()-interval '31 days',expires_at=now()-interval '1 day' WHERE id=$1",
      [guest.guest.id],
    );
    expect(
      (await get('guest', join, { [guestCookieName(join, true)]: guest.token }))
        .statusCode,
    ).toBe(401);
  });
  it('closes ended parties idempotently for their owner while preserving history and private access', async () => {
    const party = await created();
    const close = (
      cookie = host.token,
      origin = config.appOrigin,
      body: unknown = {},
    ) =>
      app.inject({
        method: 'POST',
        url: `/api/parties/${party.id}/close`,
        cookies: { '__Host-crowdcue_host': cookie },
        headers: { origin, 'content-type': 'application/json' },
        payload: JSON.stringify(body),
      });
    expect((await close(other.token)).statusCode).toBe(404);
    expect(
      (await close(host.token, 'https://foreign.example')).statusCode,
    ).toBe(403);
    expect(
      (await close(host.token, config.appOrigin, { unexpected: true }))
        .statusCode,
    ).toBe(400);
    expect((await close()).statusCode).toBe(409);
    await store.end(host.id, tokenFrom(party.links.admin!));
    expect((await close()).statusCode).toBe(200);
    expect((await close()).statusCode).toBe(200);
    expect(
      (
        await new PostgresPartyStore(pool, cipher, config.appOrigin).list(
          host.id,
          0,
        )
      ).parties,
    ).toEqual([]);
    expect((await store.owned(host.id, party.id)).status).toBe('ENDED');
    expect(
      (
        await pool.query('SELECT closed_at FROM parties WHERE id=$1', [
          party.id,
        ])
      ).rows[0].closed_at,
    ).not.toBeNull();
  });
  it('shares catalog request states, validates guest access and preserves but ignores historical self-votes', async () => {
    const party = await created(),
      join = tokenFrom(party.links.guest);
    const guests = new PostgresGuestStore(pool),
      requests = new PostgresRequestStore(pool);
    const owner = await guests.join(join, undefined, 'Owner'),
      viewer = await guests.join(join, undefined, 'Viewer');
    const track = {
      id: 'x'.repeat(22),
      title: 'Shared song',
      artists: ['Artist'],
      album: 'Album',
      artworkUrl: null,
      durationMs: 120000,
      explicit: false,
      spotifyUrl: `https://open.spotify.com/track/${'x'.repeat(22)}`,
    };
    const song = requireSavedRequest(
      (await requests.create(join, owner.token, track, randomUUID())).request,
    );
    await expect(
      requests.vote(join, owner.token, song.id, true),
    ).rejects.toMatchObject({ statusCode: 409 });
    await pool.query(
      'INSERT INTO votes(party_id,request_id,guest_id) VALUES($1,$2,$3)',
      [party.id, song.id, owner.guest.id],
    );
    expect(
      (await requests.guestList(join, viewer.token, 0)).requests[0].voteCount,
    ).toBe(0);
    expect(
      (await pool.query('SELECT 1 FROM votes WHERE request_id=$1', [song.id]))
        .rowCount,
    ).toBe(1);
    await requests.vote(join, viewer.token, song.id, true);
    expect(
      (await requests.guestList(join, viewer.token, 0)).requests[0].voteCount,
    ).toBe(1);
    const states = (ids = track.id, cookie = viewer.token) =>
      app.inject({
        method: 'GET',
        url: `/api/party-links/guest/${join}/track-states?ids=${ids}`,
        cookies: { [guestCookieName(join, true)]: cookie },
      });
    expect((await states()).json()).toEqual({
      tracks: [{ id: track.id, requested: true, played: false }],
    });
    expect((await states('bad')).statusCode).toBe(400);
    expect((await states(Array(101).fill(track.id).join(','))).statusCode).toBe(
      400,
    );
    expect((await states(track.id, newToken())).statusCode).toBe(401);
    await pool.query("UPDATE song_requests SET status='PLAYED' WHERE id=$1", [
      song.id,
    ]);
    expect((await states()).json()).toEqual({
      tracks: [{ id: track.id, requested: false, played: true }],
    });
    expect(
      await requests.prepare(join, viewer.token, track.id, randomUUID()),
    ).toMatchObject({ result: { confirmationRequired: true } });
  });
});
