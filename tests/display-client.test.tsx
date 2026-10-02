// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { TVDisplay } from '../src/client/TVDisplay';
import type { DisplaySnapshot } from '../src/server/display/contracts.js';
const track = (letter: string) => ({
  id: letter.repeat(22),
  title: `Song ${letter}`,
  artists: ['Artist'],
  album: 'Album',
  artworkUrl: 'https://i.scdn.co/image/art',
  durationMs: 120000,
  explicit: false,
  spotifyUrl: `https://open.spotify.com/track/${letter.repeat(22)}`,
});
const state = (): DisplaySnapshot => ({
  party: {
    name: 'Friday on screen',
    status: 'ACTIVE',
    guestUrl: `https://crowdcue.example/join/${'g'.repeat(43)}`,
  },
  nowPlaying: {
    state: 'PLAYING',
    track: track('a'),
    progressMs: 10000,
    observedAt: new Date().toISOString(),
  },
  queue: [
    {
      position: 1,
      track: track('b'),
      source: 'BACKUP',
      locked: true,
      voteCount: 0,
    },
    {
      position: 2,
      track: track('c'),
      source: 'GUEST',
      locked: false,
      voteCount: 3,
    },
  ],
  hasMore: false,
  votingEnabled: true,
  pendingCount: 1,
});
const response = (data: unknown, status = 200) => ({
  ok: status === 200,
  status,
  json: async () => data,
});
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('WebSocket', undefined);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});
const advance = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
it('shows observed music separately from locked upcoming songs and exposes only the guest joining link', async () => {
  const fetcher = vi.fn().mockResolvedValue(response(state()));
  vi.stubGlobal('fetch', fetcher);
  render(<TVDisplay token={'d'.repeat(43)} />);
  await advance(0);
  expect(screen.getByRole('heading', { name: 'Song a' })).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'Song b' })).toBeInTheDocument();
  expect(screen.getByText('Locked')).toBeInTheDocument();
  expect(screen.getByText('3 votes')).toBeInTheDocument();
  expect(
    screen.getByText('1 request awaits host approval.'),
  ).toBeInTheDocument();
  expect(
    screen.getByRole('img', { name: 'Guest join QR code' }),
  ).toBeInTheDocument();
  expect(screen.getByRole('link')).toHaveAttribute(
    'href',
    state().party.guestUrl,
  );
  expect(fetcher.mock.calls[0][0]).toMatch(/\/display\/d+\/snapshot$/);
  expect(screen.queryByRole('button')).not.toBeInTheDocument();
  await advance(1000);
  expect(screen.getByRole('progressbar')).toHaveAttribute('value', '11000');
});
it('freezes paused progress and marks observations stale instead of advancing the queue', async () => {
  const data = state();
  data.nowPlaying.state = 'PAUSED';
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(data)));
  render(<TVDisplay token={'d'.repeat(43)} />);
  await advance(10000);
  expect(screen.getByText('Paused on Spotify')).toBeInTheDocument();
  expect(screen.getByRole('progressbar')).toHaveAttribute('value', '10000');
  await advance(11000);
  expect(screen.getByText('Last seen on Spotify')).toBeInTheDocument();
  expect(screen.getByText(/Playback updates delayed/)).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'Song a' })).toBeInTheDocument();
});
it('retains the last snapshot on a connection failure and clears it when the display token stops resolving', async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(response(state()))
    .mockResolvedValueOnce(response({}, 503))
    .mockResolvedValueOnce(response({}, 404));
  vi.stubGlobal('fetch', fetcher);
  render(<TVDisplay token={'d'.repeat(43)} />);
  await advance(5000);
  expect(screen.getByRole('alert')).toHaveTextContent('Connection interrupted');
  expect(screen.getByRole('heading', { name: 'Song a' })).toBeInTheDocument();
  await advance(5000);
  expect(
    screen.queryByRole('heading', { name: 'Song a' }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole('img', { name: 'Guest join QR code' }),
  ).not.toBeInTheDocument();
  expect(screen.queryByRole('link')).not.toBeInTheDocument();
  expect(screen.getByRole('alert')).toHaveTextContent('Display not found');
});
it('handles missing artwork, idle playback, and an ended party without a misleading current song or join prompt', async () => {
  const data = state();
  data.nowPlaying.track!.artworkUrl = 'https://attacker.example/image';
  data.nowPlaying.state = 'UNAVAILABLE';
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(data)));
  const view = render(<TVDisplay token={'d'.repeat(43)} />);
  await advance(0);
  expect(
    screen.getByRole('region', { name: 'Now playing' }).querySelector('img'),
  ).toBeNull();
  expect(screen.getByText('Last seen on Spotify')).toBeInTheDocument();
  data.nowPlaying = {
    state: 'IDLE',
    track: null,
    observedAt: null,
    progressMs: null,
  };
  await advance(5000);
  expect(
    screen.getByRole('heading', { name: 'Ready when you are' }),
  ).toBeInTheDocument();
  data.party.status = 'ENDED';
  await advance(5000);
  expect(
    screen.getByRole('heading', { name: 'This party has ended.' }),
  ).toBeInTheDocument();
  expect(
    screen.getByRole('heading', { name: 'Saved queue' }),
  ).toBeInTheDocument();
  expect(
    screen.queryByRole('img', { name: 'Guest join QR code' }),
  ).not.toBeInTheDocument();
  expect(screen.queryByRole('link')).not.toBeInTheDocument();
  expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
  view.unmount();
});
it('supports presentation-only fullscreen and stops pending reads on unmount', async () => {
  const fullscreen = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(document.documentElement, 'requestFullscreen', {
    configurable: true,
    value: fullscreen,
  });
  const fetcher = vi.fn().mockResolvedValue(response(state()));
  vi.stubGlobal('fetch', fetcher);
  const view = render(<TVDisplay token={'d'.repeat(43)} />);
  await advance(0);
  fireEvent.click(screen.getByRole('button', { name: 'Full screen' }));
  await advance(0);
  expect(fullscreen).toHaveBeenCalledOnce();
  expect(fetcher.mock.calls.every((call) => !call[1].method)).toBe(true);
  const signal = fetcher.mock.calls[0][1].signal;
  view.unmount();
  expect(signal.aborted).toBe(true);
  await advance(60000);
  expect(fetcher).toHaveBeenCalledOnce();
  delete (document.documentElement as unknown as Record<string, unknown>)
    .requestFullscreen;
});
