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
import { migrate } from '../src/server/db/migrate.js';
import { createDatabase } from '../src/server/db/index.js';
import { readAuthConfig } from '../src/server/auth/config.js';
import { TokenCipher, hashToken, newToken } from '../src/server/auth/crypto.js';
import { PostgresAuthStore } from '../src/server/auth/store.js';
import { AuthService } from '../src/server/auth/service.js';
import {
  SpotifyClient,
  SpotifyError,
  spotifyScopes,
} from '../src/server/spotify/client.js';
import { SpotifyMutationError } from '../src/server/spotify/playback.js';
import { PostgresPartyStore } from '../src/server/parties/store.js';
import {
  createPartySchema,
  type PartyDetails,
} from '../src/server/parties/contracts.js';
import { PostgresGuestStore } from '../src/server/guests/store.js';
import { PostgresRequestStore } from '../src/server/requests/store.js';
import { PlaybackStore } from '../src/server/playback/store.js';
import {
  PlaybackService,
  type PlaybackProvider,
} from '../src/server/playback/service.js';
import { buildApp } from '../src/server/app.js';
import { readConfig } from '../src/server/config.js';
const database = process.env.TEST_DATABASE_URL;
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
const track = (letter: string) => ({
  id: letter.repeat(22),
  title: `Song ${letter}`,
  artists: ['Artist'],
  album: 'Album',
  artworkUrl: null,
  durationMs: 120000,
  explicit: false,
  spotifyUrl: `https://open.spotify.com/track/${letter.repeat(22)}`,
});
const token = (url: string) => new URL(url).pathname.split('/').at(-1)!;
describe.skipIf(!database)('durable Spotify session playback', () => {
  const schema = `crowdcue_playback_${randomUUID().replaceAll('-', '')}`;
  let admin: pg.Pool,
    pool: pg.Pool,
    parties: PostgresPartyStore,
    requests: PostgresRequestStore,
    store: PlaybackStore,
    service: PlaybackService,
    authStore: PostgresAuthStore,
    auth: AuthService;
  let host: { id: string; cookie: string },
    other: { id: string; cookie: string };
  let provider: PlaybackProvider,
    actual: string[],
    createdId: string,
    current: string,
    progress: number,
    context: string | null,
    removed: boolean;
  let app: ReturnType<typeof buildApp>;
  const signIn = async () => {
    const cookie = newToken();
    await authStore.saveLogin(
      { id: randomUUID(), displayName: 'Host' },
      {
        accessToken: 'fixture-access',
        refreshToken: 'fixture-refresh',
        expiresAt: new Date(Date.now() + 3600000),
        scopes: spotifyScopes,
      },
      hashToken(cookie),
    );
    return {
      id: (await authStore.findSession(hashToken(cookie)))!.accountId,
      cookie,
    };
  };
  const create = async (save = false) =>
    (
      await parties.create(
        host.id,
        createPartySchema.parse({
          name: 'Night session',
          settings: { backupSourceId: 's'.repeat(22), saveRecapPlaylist: save },
        }),
        randomUUID(),
      )
    ).party;
  const start = async (party: PartyDetails) =>
    service.action(host.id, token(party.links.admin!), { action: 'start' });
  const advance = async (letter: string) => {
    current = letter.repeat(22);
    progress = 1000;
    await service.tick();
  };
  beforeAll(async () => {
    admin = createDatabase(database!);
    await admin.query(`CREATE SCHEMA "${schema}"`);
    pool = new pg.Pool({
      connectionString: database,
      options: `-c search_path=${schema}`,
    });
    await migrate(pool);
    const cipher = new TokenCipher(config.keyId, config.keys);
    parties = new PostgresPartyStore(pool, cipher, config.appOrigin);
    authStore = new PostgresAuthStore(pool, cipher);
    requests = new PostgresRequestStore(pool);
    store = new PlaybackStore(pool);
    auth = new AuthService(
      config,
      authStore,
      new SpotifyClient(config, vi.fn()),
    );
  });
  beforeEach(async () => {
    await pool.query('TRUNCATE spotify_accounts CASCADE');
    host = await signIn();
    other = await signIn();
    actual = [];
    createdId = 'n'.repeat(22);
    current = 'h'.repeat(22);
    progress = 1000;
    context = null;
    removed = false;
    provider = {
      createPlaylist: vi.fn(async () => createdId),
      findPlaylist: vi.fn(async () => createdId),
      backupTracks: vi.fn(async () => [track('a'), track('b'), track('c')]),
      playlistUris: vi.fn(async () => [...actual]),
      writeItems: vi.fn(async (_host, _id, uris, replace) => {
        actual = replace ? [...uris] : [...actual, ...uris];
      }),
      removePlaylist: vi.fn(async () => {
        removed = true;
      }),
      player: vi.fn(async () => ({
        is_playing: true,
        progress_ms: progress,
        item: { id: current, uri: `spotify:track:${current}` },
        context: context ? { uri: context } : null,
        device: { is_restricted: false },
      })),
      queueState: vi.fn(async () => ({
        currently_playing: { id: current },
        queue: [],
      })),
      enqueue: vi.fn(async () => {}),
      startPlaylist: vi.fn(async () => {
        context = `spotify:playlist:${createdId}`;
      }),
    };
    service = new PlaybackService(store, provider);
    app = buildApp(readConfig({ NODE_ENV: 'test' }), {
      logger: false,
      auth,
      parties,
      requests,
      guests: new PostgresGuestStore(pool),
      playback: service,
    });
  });
  afterEach(async () => {
    await app.close();
    await service.stop();
  });
  afterAll(async () => {
    await pool?.end();
    if (admin) {
      await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await admin.end();
    }
  });
  it('keeps three upcoming songs, appends guests in fourth place, and locks only the front across restarts', async () => {
    const p = await create(),
      join = token(p.links.guest),
      adminToken = token(p.links.admin!);
    await start(p);
    await service.tick();
    let queue = await requests.adminQueue(host.id, adminToken, 0);
    expect(queue.items).toHaveLength(3);
    expect(queue.items.map((x) => x.source)).toEqual([
      'BACKUP',
      'BACKUP',
      'BACKUP',
    ]);
    expect(queue.items[0]).toMatchObject({
      position: 1,
      locked: true,
      delivery: 'SENT',
    });
    expect(provider.enqueue).toHaveBeenCalledTimes(1);
    expect(actual).toEqual([`spotify:track:${'a'.repeat(22)}`]);
    const guest = await new PostgresGuestStore(pool).join(
      join,
      undefined,
      'Alex',
    );
    const g = (
      await requests.create(join, guest.token, track('g'), randomUUID())
    ).request;
    await service.tick();
    queue = await requests.guestQueue(join, guest.token, 0);
    expect(queue.items[3]).toMatchObject({
      position: 4,
      locked: false,
      request: { id: g.id },
    });
    await requests.vote(join, guest.token, g.id, true);
    expect(
      (await requests.guestQueue(join, guest.token, 0)).items[0].request.track
        .id,
    ).toBe('a'.repeat(22));
    const restarted = new PlaybackService(store, provider);
    await restarted.tick();
    expect(provider.enqueue).toHaveBeenCalledTimes(1);
    await advance('a');
    await advance('b');
    queue = await requests.guestQueue(join, guest.token, 0);
    expect(queue.items[0].request.track.id).toBe('c'.repeat(22));
    expect(queue.items[1].request.id).toBe(g.id);
    expect(queue.items).toHaveLength(3);
    await advance('c');
    queue = await requests.guestQueue(join, guest.token, 0);
    expect(queue.items[0]).toMatchObject({
      locked: true,
      request: { id: g.id, status: 'QUEUED', locked: true },
    });
    await expect(
      requests.vote(join, guest.token, g.id, false),
    ).rejects.toMatchObject({ statusCode: 409 });
    await expect(
      requests.moderate(host.id, adminToken, g.id, 'remove'),
    ).rejects.toMatchObject({ statusCode: 409 });
    expect(actual).toEqual(
      ['a', 'b', 'c', 'g'].map((x) => `spotify:track:${x.repeat(22)}`),
    );
    expect(await store.status(host.id, adminToken)).toMatchObject({
      lockedCount: 4,
      guestCount: 1,
      backupCount: 3,
    });
  });
  it('allows voting and host removal before #1 without displacing reserved backup slots', async () => {
    const p = await create(),
      join = token(p.links.guest),
      adminToken = token(p.links.admin!);
    await start(p);
    await service.tick();
    const guest = await new PostgresGuestStore(pool).join(
      join,
      undefined,
      'Alex',
    );
    const g = (
      await requests.create(join, guest.token, track('g'), randomUUID())
    ).request;
    const q = (
      await requests.create(join, guest.token, track('q'), randomUUID())
    ).request;
    await service.tick();
    await requests.vote(join, guest.token, q.id, true);
    expect(
      (await requests.guestQueue(join, guest.token, 0)).items.map(
        (x) => x.request.track.id,
      ),
    ).toEqual(['a', 'b', 'c', 'q', 'g'].map((x) => x.repeat(22)));
    await requests.moderate(host.id, adminToken, q.id, 'remove');
    expect(
      (await requests.guestQueue(join, guest.token, 0)).items[3].request.id,
    ).toBe(g.id);
    await parties.update(
      host.id,
      adminToken,
      createPartySchema.parse({
        name: p.name,
        settings: { ...p.settings, approvalRequired: true },
      }),
    );
    const pending = (
      await requests.create(join, guest.token, track('z'), randomUUID())
    ).request;
    await service.tick();
    expect(
      (await requests.guestQueue(join, guest.token, 0)).items.some(
        (x) => x.request.id === pending.id,
      ),
    ).toBe(false);
  });
  it('never blindly repeats an uncertain Spotify queue write and can switch to the nightly playlist', async () => {
    const p = await create(),
      adminToken = token(p.links.admin!);
    await start(p);
    vi.mocked(provider.enqueue).mockRejectedValueOnce(
      new SpotifyMutationError(true),
    );
    await service.tick();
    expect(
      (
        await pool.query(
          "SELECT delivery FROM playback_entries WHERE status='LOCKED'",
        )
      ).rows[0].delivery,
    ).toBe('UNKNOWN');
    await pool.query('UPDATE party_playback SET retry_at=null');
    await new PlaybackService(store, provider).tick();
    expect(provider.enqueue).toHaveBeenCalledTimes(1);
    expect(await store.status(host.id, adminToken)).toMatchObject({
      error: 'queue_unknown',
    });
    await service.action(host.id, adminToken, {
      action: 'fallback',
      confirm: true,
    });
    expect(provider.startPlaylist).toHaveBeenCalledWith(host.id, createdId, 0);
    expect(actual).toEqual(
      ['a', 'b', 'c'].map((x) => `spotify:track:${x.repeat(22)}`),
    );
    await service.tick();
    expect(provider.enqueue).toHaveBeenCalledTimes(1);
    const guest = await new PostgresGuestStore(pool).join(
      token(p.links.guest),
      undefined,
    );
    await requests.create(
      token(p.links.guest),
      guest.token,
      track('g'),
      randomUUID(),
    );
    await service.tick();
    expect(actual.at(-1)).toBe(`spotify:track:${'g'.repeat(22)}`);
    await parties.end(host.id, adminToken);
    await service.tick();
    expect(actual).toEqual([`spotify:track:${'a'.repeat(22)}`]);
  });
  it('recovers uncertain playlist creation without creating it again and reconciles interrupted playlist appends', async () => {
    const p = await create(),
      adminToken = token(p.links.admin!);
    vi.mocked(provider.createPlaylist).mockRejectedValueOnce(
      new SpotifyMutationError(true),
    );
    await service.tick();
    expect(await store.status(host.id, adminToken)).toMatchObject({
      creation: 'UNKNOWN',
    });
    await pool.query('UPDATE party_playback SET retry_at=null');
    await service.tick();
    expect(provider.createPlaylist).toHaveBeenCalledTimes(1);
    expect(provider.findPlaylist).toHaveBeenCalledWith(
      host.id,
      expect.stringContaining(p.id),
    );
    await start(p);
    await service.tick();
    vi.mocked(provider.writeItems).mockImplementationOnce(
      async (_h, _id, uris, replace) => {
        actual = replace ? [...uris] : [...actual, ...uris];
        throw new SpotifyMutationError(true);
      },
    );
    await advance('a');
    await pool.query('UPDATE party_playback SET retry_at=null');
    await service.tick();
    expect(actual).toEqual(
      ['a', 'b'].map((x) => `spotify:track:${x.repeat(22)}`),
    );
  });
  it('advances a delivered song that leaves Spotify between polls without sending it twice', async () => {
    const p = await create();
    await start(p);
    await service.tick();
    vi.mocked(provider.queueState).mockResolvedValueOnce({
      currently_playing: { id: current },
      queue: [{ id: 'a'.repeat(22) }],
    });
    await service.tick();
    expect(provider.enqueue).toHaveBeenCalledTimes(1);
    current = 'x'.repeat(22);
    await service.tick();
    expect(provider.enqueue).toHaveBeenCalledTimes(2);
    expect(
      (
        await pool.query(
          'SELECT track,status FROM playback_entries ORDER BY sequence LIMIT 2',
        )
      ).rows,
    ).toMatchObject([
      { track: { id: 'a'.repeat(22) }, status: 'PLAYED' },
      { track: { id: 'b'.repeat(22) }, status: 'LOCKED' },
    ]);
  });
  it('honors Spotify cooldowns and prevents duplicate workers from delivering twice', async () => {
    const p = await create();
    await start(p);
    vi.mocked(provider.enqueue).mockRejectedValueOnce(
      new SpotifyError('rate_limited', 60),
    );
    await service.tick();
    expect(provider.enqueue).toHaveBeenCalledTimes(1);
    await service.tick();
    expect(provider.enqueue).toHaveBeenCalledTimes(1);
    await pool.query('UPDATE party_playback SET retry_at=null');
    await Promise.all([
      service.tick(),
      new PlaybackService(store, provider).tick(),
    ]);
    expect(provider.enqueue).toHaveBeenCalledTimes(2);
    expect(
      (
        await pool.query(
          "SELECT delivery FROM playback_entries WHERE status='LOCKED'",
        )
      ).rows[0].delivery,
    ).toBe('SENT');
  });
  it.each([
    [false, false, true],
    [false, true, false],
    [true, false, false],
    [true, true, false],
  ])(
    'keeps/removes recap according to creation=%s close=%s',
    async (initial, close, shouldRemove) => {
      const p = await create(initial),
        adminToken = token(p.links.admin!);
      await start(p);
      await service.tick();
      await parties.end(host.id, adminToken);
      await service.tick();
      expect(removed).toBe(false);
      await service.action(host.id, adminToken, {
        action: 'close',
        save: close,
      });
      await service.action(host.id, adminToken, {
        action: 'close',
        save: close,
      });
      await service.tick();
      expect(removed).toBe(shouldRemove);
      expect(await store.status(host.id, adminToken)).toMatchObject({
        closeDecided: true,
        saveAtCreation: initial,
        saveAtClose: close,
        playlistRemoved: shouldRemove,
      });
      if (shouldRemove) expect(actual).toEqual([]);
    },
  );
  it('protects playback actions, prevents simultaneous host sessions, and stops writes after ending', async () => {
    const p = await create(),
      adminToken = token(p.links.admin!),
      url = `/api/party-links/admin/${adminToken}/playback`;
    const send = (
      payload: unknown,
      cookie = host.cookie,
      origin = config.appOrigin,
    ) =>
      app.inject({
        method: 'POST',
        url,
        headers: { origin, 'content-type': 'application/json' },
        cookies: { '__Host-crowdcue_host': cookie },
        payload: JSON.stringify(payload),
      });
    expect((await send({ action: 'start' }, 'invalid')).statusCode).toBe(401);
    expect((await send({ action: 'start' }, other.cookie)).statusCode).toBe(
      404,
    );
    expect(
      (await send({ action: 'start' }, host.cookie, 'https://foreign.example'))
        .statusCode,
    ).toBe(403);
    expect(
      (await send({ action: 'fallback', confirm: false })).statusCode,
    ).toBe(400);
    expect((await send({ action: 'close', save: true })).statusCode).toBe(409);
    expect((await send({ action: 'start' })).statusCode).toBe(200);
    const second = await create();
    await expect(start(second)).rejects.toMatchObject({ statusCode: 409 });
    await service.tick();
    const sends = vi.mocked(provider.enqueue).mock.calls.length;
    await parties.end(host.id, adminToken);
    await service.tick();
    expect(vi.mocked(provider.enqueue).mock.calls.length).toBe(sends);
    expect((await send({ action: 'start' })).statusCode).toBe(409);
    expect(
      (
        await app.inject({
          method: 'GET',
          url,
          cookies: { '__Host-crowdcue_host': host.cookie },
        })
      ).headers['cache-control'],
    ).toBe('no-store');
  });
});
