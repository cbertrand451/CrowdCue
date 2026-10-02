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
import { PostgresDisplayStore } from '../src/server/display/store.js';
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
  const addGuests = async (p: PartyDetails, letters = ['g', 'q', 'd']) => {
    const join = token(p.links.guest);
    const guest = await new PostgresGuestStore(pool).join(
      join,
      undefined,
      'Alex',
    );
    const songs = [];
    for (const letter of letters)
      songs.push(
        (await requests.create(join, guest.token, track(letter), randomUUID()))
          .request,
      );
    return { join, guest, songs };
  };
  const queueAction = (
    p: PartyDetails,
    payload: unknown,
    cookie = host.cookie,
    adminToken = token(p.links.admin!),
  ) =>
    app.inject({
      method: 'POST',
      url: `/api/party-links/admin/${adminToken}/queue`,
      cookies: { '__Host-crowdcue_host': cookie },
      headers: { origin: config.appOrigin, 'content-type': 'application/json' },
      payload: JSON.stringify(payload),
    });
  it('lets the host order guest slots, preserves backups/locked #1, and restores votes', async () => {
    const p = await create(),
      adminToken = token(p.links.admin!);
    await start(p);
    await service.tick();
    const {
      join,
      guest,
      songs: [g, q, d],
    } = await addGuests(p);
    const move = {
      action: 'move' as const,
      requestId: q.id,
      neighborId: g.id,
      direction: 'up' as const,
    };
    expect((await queueAction(p, move)).statusCode).toBe(200);
    // Retry after a lost response must not swap the songs back.
    await Promise.all([
      requests.controlQueue(host.id, adminToken, move),
      requests.controlQueue(host.id, adminToken, move),
    ]);
    await requests.vote(join, guest.token, g.id, true);
    const queue = await requests.guestQueue(join, guest.token, 0);
    expect(queue.hostOrdered).toBe(true);
    expect(queue.items.slice(0, 3).map((x) => [x.source, x.locked])).toEqual([
      ['BACKUP', true],
      ['BACKUP', false],
      ['BACKUP', false],
    ]);
    expect(queue.items.slice(3).map((x) => x.request.id)).toEqual([
      q.id,
      g.id,
      d.id,
    ]);
    const display = await new PostgresDisplayStore(
      pool,
      config.appOrigin,
    ).snapshot(token(p.links.display!));
    expect(display.queue.slice(3).map((x) => x.track.id)).toEqual([
      q.track.id,
      g.track.id,
      d.track.id,
    ]);
    const newer = (
      await requests.create(join, guest.token, track('e'), randomUUID())
    ).request;
    await requests.vote(join, guest.token, newer.id, true);
    expect(
      (await requests.adminQueue(host.id, adminToken, 0)).items
        .slice(3)
        .map((x) => x.request.id),
    ).toEqual([q.id, g.id, d.id, newer.id]);
    await requests.controlQueue(host.id, adminToken, { action: 'reset' });
    const reset = await requests.adminQueue(host.id, adminToken, 0);
    expect(reset.hostOrdered).toBe(false);
    expect(reset.items.slice(3).map((x) => x.request.id)).toEqual([
      g.id,
      newer.id,
      q.id,
      d.id,
    ]);
    expect(provider.enqueue).toHaveBeenCalledTimes(1);
  });
  it('uses host order before queue start, in playlist recovery, and when committing the next guest', async () => {
    const p = await create(),
      adminToken = token(p.links.admin!);
    const {
      songs: [g, q, d],
    } = await addGuests(p);
    await requests.controlQueue(host.id, adminToken, {
      action: 'move',
      requestId: q.id,
      neighborId: g.id,
      direction: 'up',
    });
    expect(
      (await requests.adminQueue(host.id, adminToken, 0)).items.map(
        (x) => x.request.id,
      ),
    ).toEqual([q.id, g.id, d.id]);
    const display = await new PostgresDisplayStore(
      pool,
      config.appOrigin,
    ).snapshot(token(p.links.display!));
    expect(display.queue[0].track.id).toBe(q.track.id);
    await start(p);
    await service.tick();
    await service.action(host.id, adminToken, {
      action: 'fallback',
      confirm: true,
    });
    expect(actual).toEqual(
      ['a', 'b', 'c', 'q', 'g', 'd'].map(
        (x) => `spotify:track:${x.repeat(22)}`,
      ),
    );
    await requests.controlQueue(host.id, adminToken, {
      action: 'move',
      requestId: d.id,
      neighborId: g.id,
      direction: 'up',
    });
    await service.tick();
    expect(actual).toEqual(
      ['a', 'b', 'c', 'q', 'd', 'g'].map(
        (x) => `spotify:track:${x.repeat(22)}`,
      ),
    );
    // Switch the fixture back to queue mode to verify delivery uses the same order.
    await pool.query(
      "UPDATE party_playback SET mode='QUEUE' WHERE party_id=$1",
      [p.id],
    );
    await advance('a');
    await advance('b');
    await advance('c');
    const queue = await requests.adminQueue(host.id, adminToken, 0);
    expect(queue.items[0]).toMatchObject({
      locked: true,
      request: { id: q.id },
    });
    expect(provider.enqueue).toHaveBeenLastCalledWith(host.id, q.track.id);
    await expect(
      requests.controlQueue(host.id, adminToken, {
        action: 'move',
        requestId: q.id,
        neighborId: d.id,
        direction: 'down',
      }),
    ).rejects.toMatchObject({ statusCode: 409 });
    await requests.controlQueue(host.id, adminToken, { action: 'reset' });
    expect(
      (await requests.adminQueue(host.id, adminToken, 0)).items[0].request.id,
    ).toBe(q.id);
  });
  it('restores request order with voting off and rejects backup and pending entries', async () => {
    const p = await create(),
      adminToken = token(p.links.admin!);
    await start(p);
    await service.tick();
    const {
      songs: [g, q],
    } = await addGuests(p, ['g', 'q']);
    const backup = (await requests.adminQueue(host.id, adminToken, 0)).items[1];
    await expect(
      requests.controlQueue(host.id, adminToken, {
        action: 'move',
        requestId: q.id,
        neighborId: backup.request.id,
        direction: 'up',
      }),
    ).rejects.toMatchObject({ statusCode: 409 });
    await parties.update(
      host.id,
      adminToken,
      createPartySchema.parse({
        name: p.name,
        settings: {
          ...p.settings,
          votingEnabled: false,
          approvalRequired: true,
        },
      }),
    );
    const {
      songs: [pending],
    } = await addGuests(p, ['e']);
    await expect(
      requests.controlQueue(host.id, adminToken, {
        action: 'move',
        requestId: pending.id,
        neighborId: q.id,
        direction: 'up',
      }),
    ).rejects.toMatchObject({ statusCode: 409 });
    await requests.controlQueue(host.id, adminToken, {
      action: 'move',
      requestId: q.id,
      neighborId: g.id,
      direction: 'up',
    });
    expect(
      (await requests.adminQueue(host.id, adminToken, 0)).items
        .slice(3)
        .map((x) => x.request.id),
    ).toEqual([q.id, g.id]);
    await requests.controlQueue(host.id, adminToken, { action: 'reset' });
    expect(
      (await requests.adminQueue(host.id, adminToken, 0)).items
        .slice(3)
        .map((x) => x.request.id),
    ).toEqual([g.id, q.id]);
  });
  it('rejects unauthorized, invalid, cross-party, stale and ended queue controls', async () => {
    const p = await create(),
      adminToken = token(p.links.admin!);
    const {
      songs: [g, q, d],
    } = await addGuests(p);
    const move = {
      action: 'move',
      requestId: q.id,
      neighborId: g.id,
      direction: 'up',
    };
    expect((await queueAction(p, move, other.cookie)).statusCode).toBe(404);
    expect((await queueAction(p, move, '')).statusCode).toBe(401);
    expect(
      (await queueAction(p, move, host.cookie, token(p.links.guest)))
        .statusCode,
    ).toBe(404);
    expect(
      (await queueAction(p, move, host.cookie, token(p.links.display!)))
        .statusCode,
    ).toBe(404);
    expect((await queueAction(p, { ...move, extra: true })).statusCode).toBe(
      400,
    );
    expect(
      (await queueAction(p, { ...move, requestId: 'invalid' })).statusCode,
    ).toBe(400);
    const forbidden = await app.inject({
      method: 'POST',
      url: `/api/party-links/admin/${adminToken}/queue`,
      headers: { origin: 'https://other.example' },
      cookies: { '__Host-crowdcue_host': host.cookie },
      payload: move,
    });
    expect(forbidden.statusCode).toBe(403);
    expect(
      (await queueAction(p, { ...move, requestId: d.id })).statusCode,
    ).toBe(409);
    const another = await create();
    const {
      songs: [foreign],
    } = await addGuests(another, ['e']);
    expect(
      (await queueAction(p, { ...move, requestId: foreign.id })).statusCode,
    ).toBe(409);
    await requests.moderate(host.id, adminToken, q.id, 'remove');
    expect((await queueAction(p, move)).statusCode).toBe(409);
    await parties.end(host.id, adminToken);
    expect((await queueAction(p, { action: 'reset' })).statusCode).toBe(409);
  });
  it('checks and refreshes backup contents without starting Spotify playback', async () => {
    const p = await create(),
      adminToken = token(p.links.admin!);
    let status = await service.action(host.id, adminToken, {
      action: 'refresh-backup',
    });
    expect(status).toMatchObject({
      enabled: false,
      backupTrackCount: 3,
      backupSourceUrl: `https://open.spotify.com/playlist/${'s'.repeat(22)}`,
    });
    expect(provider.enqueue).not.toHaveBeenCalled();
    expect(provider.startPlaylist).not.toHaveBeenCalled();
    vi.mocked(provider.backupTracks).mockResolvedValue([
      track('d'),
      track('e'),
    ]);
    status = await service.action(host.id, adminToken, {
      action: 'refresh-backup',
    });
    expect(status.backupTrackCount).toBe(2);
    expect(provider.backupTracks).toHaveBeenCalledTimes(2);
    vi.mocked(provider.backupTracks).mockResolvedValue([]);
    status = await service.action(host.id, adminToken, {
      action: 'refresh-backup',
    });
    expect(status).toMatchObject({
      backupTrackCount: 0,
      error: 'backup_empty',
      enabled: false,
    });
    await expect(start(p)).rejects.toMatchObject({ statusCode: 400 });
    await expect(
      service.action(other.id, adminToken, { action: 'refresh-backup' }),
    ).rejects.toMatchObject({ statusCode: 404 });
    await parties.end(host.id, adminToken);
    await expect(
      service.action(host.id, adminToken, { action: 'refresh-backup' }),
    ).rejects.toMatchObject({ statusCode: 409 });
  });
  it('cycles duplicate-heavy and single-song sources while keeping at least three upcoming tracks across restarts', async () => {
    const p = await create(),
      adminToken = token(p.links.admin!);
    vi.mocked(provider.backupTracks).mockResolvedValue([
      track('a'),
      track('a'),
      track('a'),
      track('b'),
    ]);
    await start(p);
    await service.tick();
    const restarted = new PlaybackService(store, provider);
    for (const letter of ['a', 'b', 'a', 'b', 'a', 'b']) {
      current = letter.repeat(22);
      progress = 1000;
      await restarted.tick();
      const queue = await requests.adminQueue(host.id, adminToken, 0);
      expect(queue.items).toHaveLength(3);
      expect(queue.items.filter((x) => x.locked)).toHaveLength(1);
      for (let i = 1; i < queue.items.length; i++)
        expect(queue.items[i].request.track.id).not.toBe(
          queue.items[i - 1].request.track.id,
        );
    }
    vi.mocked(provider.backupTracks).mockResolvedValue([track('e')]);
    await service.action(host.id, adminToken, { action: 'refresh-backup' });
    for (const letter of ['a', 'b', 'a', 'e']) await advance(letter);
    expect(
      (await requests.adminQueue(host.id, adminToken, 0)).items.map(
        (x) => x.request.track.id,
      ),
    ).toEqual(Array(3).fill(track('e').id));
  });
  it('preserves reserved songs on source changes and refreshes future refills from the new source', async () => {
    const p = await create(),
      adminToken = token(p.links.admin!);
    await start(p);
    await service.tick();
    const before = await requests.adminQueue(host.id, adminToken, 0);
    await parties.update(
      host.id,
      adminToken,
      createPartySchema.parse({
        name: p.name,
        settings: { ...p.settings, backupSourceId: 't'.repeat(22) },
      }),
    );
    expect((await store.status(host.id, adminToken)).backupTrackCount).toBe(0);
    expect((await requests.adminQueue(host.id, adminToken, 0)).items).toEqual(
      before.items,
    );
    vi.mocked(provider.backupTracks).mockResolvedValue([
      track('d'),
      track('e'),
    ]);
    await service.action(host.id, adminToken, { action: 'refresh-backup' });
    expect((await requests.adminQueue(host.id, adminToken, 0)).items).toEqual(
      before.items,
    );
    await advance('a');
    expect(
      (await requests.adminQueue(host.id, adminToken, 0)).items.map(
        (x) => x.request.track.id,
      ),
    ).toEqual(['b', 'c', 'd'].map((x) => x.repeat(22)));
    expect(provider.backupTracks).toHaveBeenLastCalledWith(
      host.id,
      't'.repeat(22),
      true,
    );
  });
  it('discards an in-flight worker read when backup settings change', async () => {
    const p = await create(),
      adminToken = token(p.links.admin!);
    await start(p);
    await service.tick();
    let release!: (tracks: ReturnType<typeof track>[]) => void,
      entered!: () => void;
    const reading = new Promise<void>((resolve) => {
      entered = resolve;
    });
    vi.mocked(provider.backupTracks).mockImplementationOnce(async () => {
      entered();
      return new Promise((resolve) => {
        release = resolve;
      });
    });
    const restarted = new PlaybackService(store, provider);
    const tick = restarted.tick();
    await reading;
    await parties.update(
      host.id,
      adminToken,
      createPartySchema.parse({
        name: p.name,
        settings: { ...p.settings, backupSourceId: 't'.repeat(22) },
      }),
    );
    release([track('x')]);
    await tick;
    expect((await store.status(host.id, adminToken)).backupTrackCount).toBe(0);
    vi.mocked(provider.backupTracks).mockResolvedValue([track('d')]);
    await restarted.tick();
    expect((await store.status(host.id, adminToken)).backupTrackCount).toBe(1);
    expect(provider.backupTracks).toHaveBeenLastCalledWith(
      host.id,
      't'.repeat(22),
      true,
    );
  });
  it('discards an in-flight manual refresh after an explicit-policy change', async () => {
    const p = await create(),
      adminToken = token(p.links.admin!);
    await service.action(host.id, adminToken, { action: 'refresh-backup' });
    let release!: (tracks: ReturnType<typeof track>[]) => void,
      entered!: () => void;
    const reading = new Promise<void>((resolve) => {
      entered = resolve;
    });
    vi.mocked(provider.backupTracks).mockImplementationOnce(async () => {
      entered();
      return new Promise((resolve) => {
        release = resolve;
      });
    });
    const refreshed = service.action(host.id, adminToken, {
      action: 'refresh-backup',
    });
    const rejected = expect(refreshed).rejects.toMatchObject({
      statusCode: 409,
    });
    await reading;
    await parties.update(
      host.id,
      adminToken,
      createPartySchema.parse({
        name: p.name,
        settings: { ...p.settings, allowExplicitTracks: false },
      }),
    );
    release([{ ...track('x'), explicit: true }]);
    await rejected;
    expect((await store.status(host.id, adminToken)).backupTrackCount).toBe(0);
    vi.mocked(provider.backupTracks).mockResolvedValue([track('d')]);
    await service.action(host.id, adminToken, { action: 'refresh-backup' });
    expect(provider.backupTracks).toHaveBeenLastCalledWith(
      host.id,
      's'.repeat(22),
      false,
    );
  });
  it('observes music before queue start and retains last-seen playback on provider failure', async () => {
    const party = await create();
    vi.mocked(provider.player).mockResolvedValue({
      is_playing: true,
      progress_ms: 12000,
      item: { id: track('h').id, uri: `spotify:track:${track('h').id}` },
      track: track('h'),
    });
    await service.tick();
    let state = (
      await pool.query(
        'SELECT display_track,display_state,display_progress_ms,enabled FROM party_playback WHERE party_id=$1',
        [party.id],
      )
    ).rows[0];
    expect(state).toMatchObject({
      display_track: { title: 'Song h' },
      display_state: 'PLAYING',
      display_progress_ms: 12000,
      enabled: false,
    });
    expect(provider.enqueue).not.toHaveBeenCalled();
    vi.mocked(provider.player).mockRejectedValue(
      new SpotifyError('unavailable'),
    );
    await service.tick();
    state = (
      await pool.query(
        'SELECT display_track,display_state FROM party_playback WHERE party_id=$1',
        [party.id],
      )
    ).rows[0];
    expect(state).toMatchObject({
      display_track: { title: 'Song h' },
      display_state: 'UNAVAILABLE',
    });
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
