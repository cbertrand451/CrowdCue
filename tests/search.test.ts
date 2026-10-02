import { expect, it, vi } from 'vitest';
import {
  SpotifyClient,
  type SpotifyFetch,
} from '../src/server/spotify/client.js';
import { searchQuerySchema } from '../src/server/search/contracts.js';
const track = {
  id: 'a'.repeat(22),
  name: 'Song',
  artists: [{ name: 'Artist' }],
  album: { name: 'Album', images: [{ url: 'https://i.scdn.co/image/test' }] },
  duration_ms: 185000,
  explicit: false,
};
it('sends encoded bounded Spotify searches and normalizes safe track data', async () => {
  const fetcher = vi.fn<SpotifyFetch>().mockResolvedValue(
    new Response(
      JSON.stringify({
        tracks: {
          items: [
            null,
            track,
            { ...track, id: 'b'.repeat(22), explicit: true },
            { ...track, id: 'c'.repeat(22), is_playable: false },
          ],
          next: 'https://api.spotify.com/next',
        },
      }),
    ),
  );
  const client = new SpotifyClient(
    {
      clientId: 'test',
      clientSecret: 'secret',
      redirectUri: 'https://example.com/callback',
    },
    fetcher,
  );
  const result = await client.search(
    'private-token',
    'song & artist',
    10,
    false,
  );
  expect(result.tracks).toEqual([
    {
      id: track.id,
      title: 'Song',
      artists: ['Artist'],
      album: 'Album',
      artworkUrl: 'https://i.scdn.co/image/test',
      durationMs: 185000,
      explicit: false,
      spotifyUrl: `https://open.spotify.com/track/${track.id}`,
    },
  ]);
  expect(result.nextOffset).toBe(20);
  const url = new URL(fetcher.mock.calls[0][0] as string);
  expect(Object.fromEntries(url.searchParams)).toEqual({
    q: 'song & artist',
    offset: '10',
    type: 'track',
    limit: '10',
  });
  expect(fetcher.mock.calls[0][1]?.headers).toEqual({
    authorization: 'Bearer private-token',
  });
  expect(JSON.stringify(result)).not.toContain('private-token');
});
it('drops unsafe artwork and propagates provider limits or malformed results safely', async () => {
  const fetcher = vi
    .fn<SpotifyFetch>()
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          tracks: {
            items: [
              {
                ...track,
                album: {
                  name: 'Album',
                  images: [{ url: 'http://evil.example/image' }],
                },
              },
            ],
            next: null,
          },
        }),
      ),
    )
    .mockResolvedValueOnce(
      new Response('private provider details', {
        status: 429,
        headers: { 'retry-after': '12' },
      }),
    )
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ private: 'bad shape' })),
    );
  const client = new SpotifyClient(
    {
      clientId: 'test',
      clientSecret: 'secret',
      redirectUri: 'https://example.com/callback',
    },
    fetcher,
  );
  expect(
    (await client.search('token', 'song', 0, true)).tracks[0].artworkUrl,
  ).toBeNull();
  await expect(client.search('token', 'song', 0, true)).rejects.toMatchObject({
    kind: 'rate_limited',
    retryAfter: 12,
  });
  await expect(client.search('token', 'song', 0, true)).rejects.toMatchObject({
    kind: 'unavailable',
  });
});
it('rejects invalid search input and ownership injection', () => {
  for (const value of [
    { q: 'a' },
    { q: 'x'.repeat(201) },
    { q: 'bad\nsearch' },
    { q: 'song', offset: -1 },
    { q: 'song', offset: 1000 },
    { q: 'song', hostId: 'private' },
  ])
    expect(searchQuerySchema.safeParse(value).success).toBe(false);
  expect(searchQuerySchema.parse({ q: ' song ', offset: '10' })).toEqual({
    q: 'song',
    offset: 10,
  });
});
