import { expect, it, vi } from 'vitest';
import {
  SpotifyPlayback,
  SpotifyMutationError,
} from '../src/server/spotify/playback.js';
import { playlistIdFromInput } from '../src/server/playback/contracts.js';
import { AuthService } from '../src/server/auth/service.js';
import type { AuthStore } from '../src/server/auth/store.js';
import { SpotifyClient } from '../src/server/spotify/client.js';
import { readAuthConfig } from '../src/server/auth/config.js';
import { randomBytes } from 'node:crypto';
const id = 'a'.repeat(22),
  playlist = 'p'.repeat(22);
const response = (body: unknown, status = 200, headers?: HeadersInit) =>
  new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers,
  });
it('uses Spotify queue on the active device, handles 204, and starts playlist recovery without a device picker', async () => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response(null, 204));
  const api = new SpotifyPlayback(fetcher);
  await api.enqueue('fixture-access', id);
  expect(fetcher.mock.calls[0][0]).toBe(
    `https://api.spotify.com/v1/me/player/queue?uri=${encodeURIComponent(`spotify:track:${id}`)}`,
  );
  expect(fetcher.mock.calls[0][1]).toMatchObject({
    method: 'POST',
    redirect: 'error',
    headers: { authorization: 'Bearer fixture-access' },
  });
  await api.startPlaylist('fixture-access', playlist, 4);
  expect(JSON.parse(fetcher.mock.calls[1][1]!.body as string)).toEqual({
    context_uri: `spotify:playlist:${playlist}`,
    offset: { position: 4 },
  });
  expect(await api.player('fixture-access')).toBeNull();
});
it('creates a private playlist, writes ordered batches through current items endpoints, and removes only that playlist from the library', async () => {
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(response({ id: playlist }, 201))
    .mockResolvedValueOnce(response({ snapshot_id: 'snapshot' }))
    .mockResolvedValueOnce(response({ snapshot_id: 'snapshot-2' }))
    .mockResolvedValueOnce(response(null, 200));
  const api = new SpotifyPlayback(fetcher);
  expect(await api.createPlaylist('fixture-access', 'Tonight', 'Marker')).toBe(
    playlist,
  );
  expect(fetcher.mock.calls[0][0]).toBe(
    'https://api.spotify.com/v1/me/playlists',
  );
  expect(JSON.parse(fetcher.mock.calls[0][1]!.body as string)).toMatchObject({
    public: false,
    collaborative: false,
    description: 'Marker',
  });
  await api.writeItems(
    'fixture-access',
    playlist,
    [`spotify:track:${id}`],
    true,
  );
  await api.writeItems(
    'fixture-access',
    playlist,
    [`spotify:track:${'b'.repeat(22)}`],
    false,
  );
  expect(fetcher.mock.calls.slice(1, 3).map((x) => x[1]!.method)).toEqual([
    'PUT',
    'POST',
  ]);
  expect(fetcher.mock.calls[1][0]).toBe(
    `https://api.spotify.com/v1/playlists/${playlist}/items`,
  );
  await api.removePlaylist('fixture-access', playlist);
  expect(fetcher.mock.calls[3][0]).toBe(
    `https://api.spotify.com/v1/me/library?uris=${encodeURIComponent(`spotify:playlist:${playlist}`)}`,
  );
  expect(fetcher.mock.calls[3][1]!.method).toBe('DELETE');
});
it('distinguishes uncertain writes from rejected commands and honors Retry-After', async () => {
  const fetcher = vi
    .fn<typeof fetch>()
    .mockRejectedValueOnce(new Error('network'))
    .mockResolvedValueOnce(response({}, 503))
    .mockResolvedValueOnce(response({}, 429, { 'retry-after': '45' }))
    .mockResolvedValueOnce(response({}, 401))
    .mockResolvedValueOnce(response({}, 404));
  const api = new SpotifyPlayback(fetcher);
  await expect(api.enqueue('fixture-access', id)).rejects.toMatchObject({
    uncertain: true,
  });
  await expect(api.enqueue('fixture-access', id)).rejects.toMatchObject({
    uncertain: true,
  });
  await expect(api.enqueue('fixture-access', id)).rejects.toMatchObject({
    uncertain: false,
    kind: 'rate_limited',
    retryAfter: 45,
  });
  await expect(api.enqueue('fixture-access', id)).rejects.toMatchObject({
    uncertain: false,
    kind: 'reauthenticate',
  });
  await expect(api.enqueue('fixture-access', id)).rejects.toMatchObject({
    uncertain: false,
    kind: 'no_active_device',
  });
  await expect(api.enqueue('fixture-access', 'not-a-track')).rejects.toThrow();
  expect(fetcher).toHaveBeenCalledTimes(5);
});
it('filters unsafe/unplayable backup items and follows pagination without using remote next URLs', async () => {
  const item = (letter: string, extra: object = {}) => ({
    id: letter.repeat(22),
    name: 'Song',
    artists: [{ name: 'Artist' }],
    album: {
      name: 'Album',
      images: [
        { url: 'https://malicious.example/art' },
        { url: 'https://i.scdn.co/image/safe' },
      ],
    },
    duration_ms: 120000,
    explicit: false,
    ...extra,
  });
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(
      response({
        items: [
          { item: item('a') },
          { item: item('b', { explicit: true }) },
          { item: item('c', { is_playable: false }) },
          { item: null },
        ],
        next: 'https://malicious.example/private',
      }),
    )
    .mockResolvedValueOnce(
      response({ items: [{ item: item('d') }], next: null }),
    );
  const tracks = await new SpotifyPlayback(fetcher).backupTracks(
    'fixture-access',
    playlist,
    false,
  );
  expect(tracks.map((x) => x.id)).toEqual(['a', 'd'].map((x) => x.repeat(22)));
  expect(tracks[0].artworkUrl).toBe('https://i.scdn.co/image/safe');
  expect(fetcher.mock.calls[1][0]).toBe(
    `https://api.spotify.com/v1/playlists/${playlist}/items?limit=50&offset=50`,
  );
});
it('refreshes one rejected token before a safe 401 retry but never retries uncertain queue delivery', async () => {
  const config = readAuthConfig({
    NODE_ENV: 'test',
    SPOTIFY_AUTH_ENABLED: 'true',
    SPOTIFY_CLIENT_ID: 'fixture-client',
    SPOTIFY_CLIENT_SECRET: 'fixture-secret',
    SPOTIFY_REDIRECT_URI: 'https://crowdcue.example/api/auth/spotify/callback',
    DATABASE_URL: 'postgresql://test@127.0.0.1/test',
    TOKEN_ENCRYPTION_KEYS: JSON.stringify({
      v1: randomBytes(32).toString('base64'),
    }),
  })!;
  const accessToken = vi
    .fn()
    .mockResolvedValueOnce('old-token')
    .mockResolvedValueOnce('new-token')
    .mockResolvedValue('new-token');
  const store = { accessToken } as unknown as AuthStore;
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(response({}, 401))
    .mockResolvedValueOnce(response(null, 204))
    .mockRejectedValueOnce(new Error('network'));
  const service = new AuthService(
    config,
    store,
    new SpotifyClient(config, fetcher),
  );
  await service.enqueue('verified-host', id);
  expect(accessToken.mock.calls[1][2]).toBe('old-token');
  expect(fetcher.mock.calls[1][1]!.headers).toMatchObject({
    authorization: 'Bearer new-token',
  });
  await expect(service.enqueue('verified-host', id)).rejects.toBeInstanceOf(
    SpotifyMutationError,
  );
  expect(fetcher).toHaveBeenCalledTimes(3);
});
it('accepts only Spotify playlist links, URIs, or IDs', () => {
  expect(
    playlistIdFromInput(
      `https://open.spotify.com/playlist/${playlist}?si=share`,
    ),
  ).toBe(playlist);
  expect(playlistIdFromInput(`spotify:playlist:${playlist}`)).toBe(playlist);
  expect(playlistIdFromInput('')).toBeNull();
  expect(
    playlistIdFromInput(`https://attacker.example/playlist/${playlist}`),
  ).toBeUndefined();
  expect(
    playlistIdFromInput(
      `https://private@open.spotify.com/playlist/${playlist}`,
    ),
  ).toBeUndefined();
});
it('normalizes observed track metadata and filters unsafe artwork and private device fields', async () => {
  const raw = {
    id,
    uri: `spotify:track:${id}`,
    name: 'Current song',
    artists: [{ name: 'Current artist' }],
    album: {
      name: 'Current album',
      images: [
        { url: 'https://attacker.example/image' },
        { url: 'https://i.scdn.co/image/album' },
      ],
    },
    duration_ms: 180000,
    explicit: true,
  };
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
    response({
      is_playing: false,
      progress_ms: 45000,
      item: raw,
      context: null,
      device: { is_restricted: false, name: 'Private device' },
    }),
  );
  const api = new SpotifyPlayback(fetcher);
  const player = await api.player('fixture-access');
  expect(player?.track).toMatchObject({
    title: 'Current song',
    artists: ['Current artist'],
    artworkUrl: 'https://i.scdn.co/image/album',
    explicit: true,
  });
  expect(player?.device).not.toHaveProperty('name');
  fetcher.mockResolvedValue(
    response({
      is_playing: true,
      item: { id: null, uri: 'spotify:local:unsupported' },
      progress_ms: 1,
    }),
  );
  expect((await api.player('fixture-access'))?.track).toBeNull();
});
