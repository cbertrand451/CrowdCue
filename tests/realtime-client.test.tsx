// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import {
  act,
  cleanup,
  render,
  renderHook,
  screen,
} from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { usePartyRealtime } from '../src/client/realtime';
import { PartyPage } from '../src/client/PartyPage';

class FakeSocket {
  static sockets: FakeSocket[] = [];
  readyState = 1;
  onmessage?: (event: { data: string }) => void;
  onclose?: () => void;
  onerror?: () => void;
  close = vi.fn(() => {
    this.readyState = 3;
    this.onclose?.();
  });
  constructor(readonly url: URL) {
    FakeSocket.sockets.push(this);
  }
  message(data: string) {
    this.onmessage?.({ data });
  }
}
beforeEach(() => {
  vi.useFakeTimers();
  FakeSocket.sockets = [];
  vi.stubGlobal('WebSocket', FakeSocket);
  vi.spyOn(Math, 'random').mockReturnValue(0);
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
it('uses one same-origin socket, batches updates, and refreshes on every successful connection', async () => {
  const { result, unmount } = renderHook(() =>
    usePartyRealtime('guest', 'g'.repeat(43)),
  );
  const first = FakeSocket.sockets[0];
  expect(first.url.origin).toBe(window.location.origin.replace(/^http/, 'ws'));
  expect(first.url.pathname).toBe(
    `/api/party-links/guest/${'g'.repeat(43)}/live`,
  );
  act(() => first.message('{"type":"ready"}'));
  await advance(80);
  expect(result.current).toEqual({ revision: 1, connected: true });
  act(() => {
    first.message('{"type":"changed"}');
    first.message('{"type":"changed"}');
    first.message('{"type":"changed"}');
  });
  await advance(80);
  expect(result.current.revision).toBe(2);
  act(() => first.close());
  expect(result.current.connected).toBe(false);
  await advance(1000);
  expect(FakeSocket.sockets).toHaveLength(2);
  const second = FakeSocket.sockets[1];
  act(() => second.message('{"type":"ready"}'));
  await advance(80);
  expect(result.current.revision).toBe(3);
  unmount();
  expect(second.close).toHaveBeenCalledOnce();
  await advance(60000);
  expect(FakeSocket.sockets).toHaveLength(2);
});
it('ignores malformed messages and uses bounded reconnect backoff', async () => {
  const { result } = renderHook(() =>
    usePartyRealtime('display', 'd'.repeat(43)),
  );
  act(() => {
    FakeSocket.sockets[0].message('bad json');
    FakeSocket.sockets[0].message('{"type":"subscribe","room":"other"}');
  });
  await advance(80);
  expect(result.current.revision).toBe(0);
  act(() => FakeSocket.sockets[0].close());
  await advance(1000);
  act(() => FakeSocket.sockets[1].close());
  await advance(1999);
  expect(FakeSocket.sockets).toHaveLength(2);
  await advance(1);
  expect(FakeSocket.sockets).toHaveLength(3);
});
it('updates the display page immediately after remote settings and party-end notifications', async () => {
  let name = 'Before live change';
  let status = 'ACTIVE';
  const fetcher = vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      party: {
        name,
        status,
        guestUrl: `${window.location.origin}/join/${'g'.repeat(43)}`,
      },
      nowPlaying: {
        state: 'UNKNOWN',
        track: null,
        progressMs: null,
        observedAt: null,
      },
      queue: [],
      hasMore: false,
      votingEnabled: true,
      pendingCount: 0,
    }),
  }));
  vi.stubGlobal('fetch', fetcher);
  render(<PartyPage role="display" token={'d'.repeat(43)} />);
  await advance(0);
  expect(screen.getByRole('heading', { name })).toBeInTheDocument();
  act(() => FakeSocket.sockets[0].message('{"type":"ready"}'));
  await advance(80);
  name = 'After live change';
  status = 'ENDED';
  act(() => FakeSocket.sockets[0].message('{"type":"changed"}'));
  await advance(80);
  expect(screen.getByRole('heading', { name })).toBeInTheDocument();
  expect(screen.getByText('This party has ended.')).toBeInTheDocument();
  expect(screen.getByText('Live updates connected.')).toBeInTheDocument();
  expect(fetcher).toHaveBeenCalledTimes(3);
});
it('keeps periodic page reads when sockets are unavailable', async () => {
  vi.stubGlobal('WebSocket', undefined);
  const fetcher = vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      party: {
        name: 'Fallback party',
        status: 'ACTIVE',
        guestUrl: `${window.location.origin}/join/${'g'.repeat(43)}`,
      },
      nowPlaying: {
        state: 'UNKNOWN',
        track: null,
        progressMs: null,
        observedAt: null,
      },
      queue: [],
      hasMore: false,
      votingEnabled: true,
      pendingCount: 0,
    }),
  }));
  vi.stubGlobal('fetch', fetcher);
  render(<PartyPage role="display" token={'d'.repeat(43)} />);
  await advance(0);
  expect(fetcher).toHaveBeenCalledOnce();
  await advance(5000);
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(
    screen.getByText(
      'Live updates reconnecting. Checking for changes periodically.',
    ),
  ).toBeInTheDocument();
});
