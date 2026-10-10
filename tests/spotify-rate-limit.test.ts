import { afterEach, expect, it, vi } from 'vitest';
import {
  createSpotifyFetch,
  SpotifyRequestDeferred,
  SpotifyRequestLimiter,
  SPOTIFY_REQUEST_POLICY,
} from '../src/server/spotify/rate-limit.js';
import { SpotifyClient } from '../src/server/spotify/client.js';

afterEach(() => vi.useRealTimers());
const setup = () => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
  const limiter = new SpotifyRequestLimiter();
  const starts: number[] = [];
  const fetcher = vi.fn<typeof fetch>(async () => {
    starts.push(Date.now());
    return new Response('{}');
  });
  return {
    limiter,
    fetcher,
    starts,
    limited: createSpotifyFetch(fetcher, limiter),
  };
};

it('paces concurrent requests across accounts and defers excess work without dispatching it', async () => {
  const { limited, starts } = setup();
  const results = Promise.allSettled(
    Array.from({ length: 6 }, (_, index) =>
      limited(`https://api.spotify.com/v1/me?account=${index}`),
    ),
  );
  await vi.advanceTimersByTimeAsync(2500);
  const outcomes = await results;
  expect(starts).toEqual([0, 500, 1000, 1500, 2000]);
  expect(outcomes[5]).toMatchObject({
    status: 'rejected',
    reason: { kind: 'unavailable' },
  });
});

it('bounds the rolling window while allowing the oldest request to expire', async () => {
  const { limited, starts } = setup();
  for (let i = 0; i < 65; i++) {
    const request = limited('https://api.spotify.com/v1/me');
    await vi.advanceTimersByTimeAsync(i === 0 ? 0 : 500);
    await request;
  }
  for (const time of starts) {
    expect(
      starts.filter(
        (start) =>
          start <= time && start > time - SPOTIFY_REQUEST_POLICY.windowMs,
      ).length,
    ).toBeLessThanOrEqual(60);
  }
  expect(starts[60]).toBe(30000);
});

it('shares Spotify cooldown with waiting requests and resumes after Retry-After', async () => {
  const { limited, fetcher } = setup();
  fetcher.mockResolvedValueOnce(
    new Response('{}', { status: 429, headers: { 'Retry-After': '5' } }),
  );
  const first = limited('https://api.spotify.com/v1/me');
  const waiting = limited('https://api.spotify.com/v1/search').catch(
    (error) => error,
  );
  await first;
  await vi.advanceTimersByTimeAsync(500);
  expect(await waiting).toBeInstanceOf(SpotifyRequestDeferred);
  expect(fetcher).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(4500);
  await limited('https://api.spotify.com/v1/search');
  expect(fetcher).toHaveBeenCalledTimes(2);
});

it('cancels queued work without consuming another API request', async () => {
  const { limited, fetcher } = setup();
  await limited('https://api.spotify.com/v1/me');
  const controller = new AbortController();
  const queued = limited('https://api.spotify.com/v1/me', {
    signal: controller.signal,
  }).catch((error) => error);
  controller.abort();
  expect(await queued).toMatchObject({ name: 'AbortError' });
  await vi.advanceTimersByTimeAsync(1000);
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it('uses the same budget for profile reads and playback writes and preserves unsent mutation certainty', async () => {
  const { limited, limiter, fetcher } = setup();
  fetcher.mockResolvedValueOnce(
    new Response(JSON.stringify({ id: 'host', display_name: 'Host' })),
  );
  const client = new SpotifyClient(
    {
      clientId: 'fixture',
      clientSecret: 'fixture',
      redirectUri: 'https://example.com/callback',
    },
    limited,
  );
  await client.profile('fixture-access');
  limiter.cooldown('10');
  await expect(
    client.playback.createPlaylist('fixture-access', 'Tonight', 'Credit'),
  ).rejects.toMatchObject({
    uncertain: false,
    kind: 'unavailable',
    retryAfter: 10,
  });
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it('does not replay a rate-limited playlist creation request', async () => {
  const { limited, fetcher } = setup();
  fetcher.mockResolvedValueOnce(
    new Response('{}', { status: 429, headers: { 'Retry-After': '10' } }),
  );
  const client = new SpotifyClient(
    {
      clientId: 'fixture',
      clientSecret: 'fixture',
      redirectUri: 'https://example.com/callback',
    },
    limited,
  );
  await expect(
    client.playback.createPlaylist('fixture-access', 'Tonight', 'Credit'),
  ).rejects.toMatchObject({
    uncertain: false,
    kind: 'rate_limited',
    retryAfter: 10,
  });
  await vi.advanceTimersByTimeAsync(10000);
  expect(fetcher).toHaveBeenCalledTimes(1);
});
