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
function requireSavedRequest<T>(request: T | undefined): T {
  if (!request)
    throw new Error(
      'Expected a saved request, received a repeat-song confirmation.',
    );
  return request;
}

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
    context: string | null;

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
    provider = {
      createPlaylist: vi.fn(async () => createdId),
      findPlaylist: vi.fn(async () => createdId),
      backupTracks: vi.fn(async () => [track('a'), track('b'), track('c')]),
      playlistUris: vi.fn(async () => [...actual]),
      writeItems: vi.fn(async (_host, _id, uris, replace, position) => {
        if (replace) actual = [...uris];
        else actual.splice(position ?? actual.length, 0, ...uris);
      }),
      moveItem: vi.fn(async (_host, _id, from, to) => {
        actual.splice(to, 0, actual.splice(from, 1)[0]);
      }),
      removeItems: vi.fn<PlaybackProvider['removeItems']>(
        async (_host, _id, items) => {
          for (const position of items
            .flatMap((e) => e.positions)
            .sort((a, b) => b - a))
            actual.splice(position, 1);
        },
      ),
      player: vi.fn(async () => ({
        is_playing: true,
        progress_ms: progress,
        item: { id: current, uri: `spotify:track:${current}` },
        context: context ? { uri: context } : null,
        device: { is_restricted: false },
      })),
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
        requireSavedRequest(
          (
            await requests.create(
              join,
              guest.token,
              track(letter),
              randomUUID(),
            )
          ).request,
        ),
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
  it('creates only on Start, customizes a private session, seeds three random backups and never sends playback commands', async () => {
    const p = await create(),
      t = token(p.links.admin!);
    await service.tick();
    expect(provider.createPlaylist).not.toHaveBeenCalled();
    await service.action(host.id, t, {
      action: 'start',
      name: 'Dance floor',
      description: 'Birthday songs',
    });
    expect(provider.createPlaylist).toHaveBeenCalledWith(
      host.id,
      'Dance floor',
      expect.stringContaining('Birthday songs'),
    );
    expect(actual).toHaveLength(3);
    const q = await requests.adminQueue(host.id, t, 0);
    expect(q.items.map((e) => e.locked)).toEqual([true, true, false]);
    expect(q.items.every((e) => e.source === 'BACKUP')).toBe(true);
    const before = [...actual];
    await start(p);
    await new PlaybackService(store, provider).tick();
    expect(actual).toEqual(before);
    expect(provider.createPlaylist).toHaveBeenCalledTimes(1);
    expect(actual[0]).not.toBe(actual[1]);
  });
  it('replaces unlocked backup fillers, synchronizes votes/reordering, and locks only current + next', async () => {
    const p = await create(),
      t = token(p.links.admin!);
    await start(p);
    const first = actual[0],
      second = actual[1];
    const {
      join,
      guest,
      songs: [g, q, d],
    } = await addGuests(p);
    await requests.vote(join, guest.token, q.id, true);
    await service.tick();
    expect(actual).toEqual([
      first,
      second,
      ...[q, g, d].map((e) => `spotify:track:${e.track.id}`),
    ]);
    await requests.controlQueue(host.id, t, {
      action: 'move',
      requestId: d.id,
      neighborId: g.id,
      direction: 'up',
    });
    await service.tick();
    expect(actual).toEqual([
      first,
      second,
      ...[q, d, g].map((e) => `spotify:track:${e.track.id}`),
    ]);
    context = `spotify:playlist:${createdId}`;
    await advance(first.slice(-22)[0]);
    let snapshot = await requests.guestQueue(join, guest.token, 0);
    expect(snapshot.current?.track.id).toBe(first.slice(-22));
    expect(snapshot.current?.locked).toBe(true);
    expect(snapshot.items.filter((e) => e.locked)).toHaveLength(1);
    expect(snapshot.items[0].request.track.id).toBe(second.slice(-22));
    await advance(second.slice(-22)[0]);
    snapshot = await requests.adminQueue(host.id, t, 0);
    expect(snapshot.items[0]).toMatchObject({
      locked: true,
      request: { id: q.id },
    });
    await expect(
      requests.vote(join, guest.token, q.id, false),
    ).rejects.toMatchObject({ statusCode: 409 });
    await expect(
      requests.moderate(host.id, t, q.id, 'remove'),
    ).rejects.toMatchObject({ statusCode: 409 });
    await expect(
      requests.controlQueue(host.id, t, {
        action: 'move',
        requestId: q.id,
        neighborId: d.id,
        direction: 'down',
      }),
    ).rejects.toMatchObject({ statusCode: 409 });
    const display = await new PostgresDisplayStore(
      pool,
      config.appOrigin,
    ).snapshot(token(p.links.display!));
    expect(display.queue[0]).toMatchObject({
      locked: true,
      track: { id: q.track.id },
    });
    await advance(q.track.id[0]);
    await advance(d.track.id[0]);
    const history = await store.history(host.id, t, 0);
    expect(
      history.items.some((e) => e.track.id === q.track.id && e.observedAt),
    ).toBe(true);
  });
  it('refills to two upcoming songs without guests, including pauses and backend restarts', async () => {
    const p = await create(),
      t = token(p.links.admin!);
    await start(p);
    context = `spotify:playlist:${createdId}`;
    await advance(actual[0].slice(-22)[0]);
    for (let i = 0; i < 5; i++) {
      const queue = await requests.adminQueue(host.id, t, 0);
      expect(queue.items).toHaveLength(2);
      expect(queue.items.map((e) => e.locked)).toEqual([true, false]);
      await advance(queue.items[0].request.track.id[0]);
    }
    const before = [...actual];
    await new PlaybackService(store, provider).tick();
    expect(actual).toEqual(before);
    vi.mocked(provider.player).mockResolvedValue({
      is_playing: false,
      item: { id: current, uri: `spotify:track:${current}` },
      progress_ms: progress,
      context: { uri: context },
    });
    await service.tick();
    expect(actual).toEqual(before);
    expect((await requests.adminQueue(host.id, t, 0)).items).toHaveLength(2);
  });
  it('keeps the complete playlist after ending without deleting, clearing or rewriting it', async () => {
    const p = await create(false),
      t = token(p.links.admin!);
    await start(p);
    await addGuests(p);
    await service.tick();
    const before = [...actual];
    const calls = vi.mocked(provider.writeItems).mock.calls.length;
    await parties.end(host.id, t);
    await service.tick();
    expect(actual).toEqual(before);
    expect(provider.writeItems).toHaveBeenCalledTimes(calls);
    expect(await store.status(host.id, t)).toMatchObject({
      ended: true,
      playlistRemoved: false,
    });
    expect((await queueAction(p, { action: 'reset' })).statusCode).toBe(409);
  });
  it('recovers uncertain creation and writes by reading Spotify before retrying', async () => {
    const p = await create(),
      t = token(p.links.admin!);
    vi.mocked(provider.createPlaylist).mockRejectedValueOnce(
      new SpotifyMutationError(true),
    );
    await expect(start(p)).rejects.toBeInstanceOf(SpotifyMutationError);
    await service.tick();
    expect(provider.createPlaylist).toHaveBeenCalledTimes(1);
    expect(provider.findPlaylist).toHaveBeenCalled();
    expect(actual).toHaveLength(3);
    await addGuests(p, ['g']);
    vi.mocked(provider.writeItems).mockImplementationOnce(
      async (_h, _id, uris, replace, position) => {
        if (replace) actual = [...uris];
        else actual.splice(position ?? actual.length, 0, ...uris);
        throw new SpotifyMutationError(true);
      },
    );
    await service.tick();
    await service.action(host.id, t, { action: 'retry' });
    await service.tick();
    expect(actual.filter((e) => e.endsWith(track('g').id))).toHaveLength(1);
    expect(await store.status(host.id, t)).toMatchObject({ error: null });
  });
  it('blocks empty/missing backups, protects host actions and permits just one active host session', async () => {
    const p = await create(),
      t = token(p.links.admin!);
    vi.mocked(provider.backupTracks).mockResolvedValueOnce([]);
    await expect(start(p)).rejects.toMatchObject({ statusCode: 400 });
    expect(provider.createPlaylist).not.toHaveBeenCalled();
    await service.action(host.id, t, { action: 'refresh-backup' });
    await start(p);
    const second = await create();
    await expect(start(second)).rejects.toMatchObject({ statusCode: 409 });
    const url = `/api/party-links/admin/${t}/playback`;
    const send = (
      payload: unknown,
      cookie = host.cookie,
      origin = config.appOrigin,
    ) =>
      app.inject({
        method: 'POST',
        url,
        cookies: { '__Host-crowdcue_host': cookie },
        headers: { origin, 'content-type': 'application/json' },
        payload: JSON.stringify(payload),
      });
    expect((await send({ action: 'start' }, other.cookie)).statusCode).toBe(
      404,
    );
    expect(
      (await send({ action: 'start' }, '', config.appOrigin)).statusCode,
    ).toBe(401);
    expect(
      (await send({ action: 'start' }, host.cookie, 'https://foreign.example'))
        .statusCode,
    ).toBe(403);
    expect((await send({ action: 'fallback', confirm: true })).statusCode).toBe(
      400,
    );
    expect((await send({ action: 'close', save: false })).statusCode).toBe(400);
  });
  it('allows moving unlocked backup tracks, but not either seeded lock', async () => {
    const p = await create(),
      t = token(p.links.admin!);
    await start(p);
    let snapshot = await requests.adminQueue(host.id, t, 0);
    const filler = snapshot.items[2];
    await expect(
      requests.controlQueue(host.id, t, {
        action: 'move',
        requestId: filler.request.id,
        neighborId: snapshot.items[1].request.id,
        direction: 'up',
      }),
    ).rejects.toMatchObject({ statusCode: 409 });
    // An unlocked backup can be moved after a waiting guest if manually retained.
    await addGuests(p, ['g']);
    await pool.query(
      "INSERT INTO playback_entries(party_id,source,track) VALUES ($1,'BACKUP',$2)",
      [p.id, JSON.stringify(track('z'))],
    );
    snapshot = await requests.adminQueue(host.id, t, 0);
    await requests.controlQueue(host.id, t, {
      action: 'move',
      requestId: snapshot.items[3].request.id,
      neighborId: snapshot.items[2].request.id,
      direction: 'up',
    });
    expect((await requests.adminQueue(host.id, t, 0)).items[2].source).toBe(
      'BACKUP',
    );
  });
  it('retains requests awaiting approval and refills after moderation', async () => {
    const p = await create(),
      t = token(p.links.admin!);
    await parties.update(
      host.id,
      t,
      createPartySchema.parse({
        name: p.name,
        settings: { ...p.settings, approvalRequired: true },
      }),
    );
    await start(p);
    const {
      songs: [g],
    } = await addGuests(p, ['g']);
    await service.tick();
    expect(actual.some((e) => e.endsWith(g.track.id))).toBe(false);
    await requests.moderate(host.id, t, g.id, 'approve');
    await service.tick();
    expect(actual[2]).toBe(`spotify:track:${g.track.id}`);
    await requests.moderate(host.id, t, g.id, 'remove');
    await service.tick();
    expect(actual).toHaveLength(3);
    expect(actual.some((e) => e.endsWith(g.track.id))).toBe(false);
  });
  it('ignores playback outside the session and respects provider cooldowns', async () => {
    const p = await create(),
      t = token(p.links.admin!);
    await start(p);
    const before = [...actual];
    current = actual[0].slice(-22);
    context = 'spotify:playlist:unrelated';
    await service.tick();
    expect((await requests.adminQueue(host.id, t, 0)).current).toBeNull();
    vi.mocked(provider.playlistUris).mockRejectedValueOnce(
      new SpotifyError('rate_limited', 60),
    );
    await addGuests(p, ['g']);
    await service.tick();
    const calls = vi.mocked(provider.playlistUris).mock.calls.length;
    await service.tick();
    expect(provider.playlistUris).toHaveBeenCalledTimes(calls);
    expect(before).toHaveLength(3);
    expect(await store.status(host.id, t)).toMatchObject({
      error: 'rate_limited',
    });
  });
  it('recognizes repeated occurrences in a one-song backup and tracks skipped songs', async () => {
    vi.mocked(provider.backupTracks).mockResolvedValue([track('a')]);
    const p = await create(),
      t = token(p.links.admin!);
    await start(p);
    expect(actual).toHaveLength(3);
    context = `spotify:playlist:${createdId}`;
    await advance('a');
    progress = 50000;
    await service.tick();
    progress = 1000;
    await service.tick();
    expect((await requests.adminQueue(host.id, t, 0)).items).toHaveLength(2);
    const history = await store.history(host.id, t, 0);
    expect(history.observedCount).toBe(2);
    expect(history.items.filter((e) => e.observedAt)).toHaveLength(2);
  });
  it('serves locked current songs and history only through authorized role views', async () => {
    const p = await create(),
      t = token(p.links.admin!);
    await start(p);
    const {
      join,
      guest,
      songs: [g, q],
    } = await addGuests(p, ['g', 'q']);
    await service.tick();
    context = `spotify:playlist:${createdId}`;
    await advance(g.track.id[0]); // Spotify host can skip directly to an unlocked song.
    const snapshot = await requests.guestQueue(join, guest.token, 0);
    expect(snapshot.current).toMatchObject({
      id: g.id,
      locked: true,
      isOwn: true,
      requestedBy: 'Alex',
    });
    expect(snapshot.items[0]).toMatchObject({
      locked: true,
      request: { id: q.id },
    });
    const history = (cookie: string, link = t) =>
      app.inject({
        method: 'GET',
        url: `/api/party-links/admin/${link}/history`,
        cookies: { '__Host-crowdcue_host': cookie },
      });
    expect((await history(other.cookie)).statusCode).toBe(404);
    expect((await history(host.cookie, join)).statusCode).toBe(404);
    const response = await history(host.cookie);
    expect(response.statusCode).toBe(200);
    expect(response.body).not.toContain('fixture-access');
    expect(response.body).not.toContain(host.cookie);
    expect(response.body).not.toContain(t);
    expect(response.headers['cache-control']).toBe('no-store');
  });
  it('retains legacy commitment timestamps after extra buffer songs are unlocked', async () => {
    const p = await create(),
      t = token(p.links.admin!);
    await pool.query(
      "INSERT INTO playback_entries(party_id,source,track,legacy_committed_at) VALUES ($1,'BACKUP',$2,now())",
      [p.id, JSON.stringify(track('a'))],
    );
    const history = await store.history(host.id, t, 0);
    expect(history.committedCount).toBe(1);
    expect(history.items[0].committedAt).toBeTruthy();
    expect(
      (await requests.adminQueue(host.id, t, 0)).items.every((e) => !e.locked),
    ).toBe(true);
  });
});
