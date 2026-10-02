// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { QueueBoard } from '../src/client/QueueBoard';
const song = (title: string) => ({
  id: crypto.randomUUID(),
  status: 'APPROVED',
  requestedBy: 'Alex',
  isOwn: true,
  createdAt: new Date().toISOString(),
  voteCount: 1,
  hasVoted: true,
  track: {
    id: 'a'.repeat(22),
    title,
    artists: ['Artist'],
    album: 'Album',
    artworkUrl: null,
    durationMs: 120000,
    explicit: false,
    spotifyUrl: `https://open.spotify.com/track/${'a'.repeat(22)}`,
  },
});
const first = song('First song'),
  second = song('Second song');
const snapshot = (reversed = false) => ({
  items: (reversed ? [second, first] : [first, second]).map(
    (request, index) => ({ position: index + 1, request }),
  ),
  nextOffset: null,
  votingEnabled: true,
  status: 'ACTIVE',
});
const reply = (data: unknown, status = 200) => ({
  ok: status < 400,
  status,
  json: async () => data,
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
it('renders server ordering and polls new positions, aborting when unmounted', async () => {
  vi.useFakeTimers();
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(reply(snapshot()))
    .mockResolvedValue(reply(snapshot(true)));
  vi.stubGlobal('fetch', fetcher);
  const { unmount } = render(
    <QueueBoard role="guest" token={'g'.repeat(43)} />,
  );
  await act(async () => {});
  expect(screen.getAllByRole('link').map((x) => x.textContent)).toEqual([
    'First song',
    'Second song',
  ]);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(5000);
  });
  expect(screen.getAllByRole('link').map((x) => x.textContent)).toEqual([
    'Second song',
    'First song',
  ]);
  expect(screen.getByLabelText('Queue position 1')).toBeVisible();
  unmount();
  expect(fetcher.mock.calls[0][1].signal.aborted).toBe(true);
  await vi.advanceTimersByTimeAsync(10000);
  expect(fetcher).toHaveBeenCalledTimes(2);
});
it('clears a protected queue on expired authentication and allows retry', async () => {
  const expired = vi.fn();
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(reply(snapshot()))
    .mockResolvedValueOnce(reply({}, 401))
    .mockResolvedValue(
      reply({ ...snapshot(), status: 'ENDED', votingEnabled: false }),
    );
  vi.stubGlobal('fetch', fetcher);
  render(
    <QueueBoard role="guest" token={'g'.repeat(43)} onExpired={expired} />,
  );
  await screen.findByRole('link', { name: 'First song' });
  fireEvent.click(screen.getByRole('button', { name: 'Refresh queue' }));
  await screen.findByRole('alert');
  expect(screen.queryByRole('link')).not.toBeInTheDocument();
  expect(expired).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole('button', { name: 'Refresh queue' }));
  await screen.findByText(
    'This party has ended. Its saved queue is read-only.',
  );
  expect(
    screen.getByText('Voting is off. Guest songs follow request order.'),
  ).toBeVisible();
  expect(screen.queryByText('First in CrowdCue')).not.toBeInTheDocument();
});
it('offers host ordering and restoring votes, with one mutation at a time', async () => {
  let release!: (value: unknown) => void;
  const pending = new Promise((resolve) => {
    release = resolve;
  });
  const changed = vi.fn();
  const fetcher = vi
    .fn()
    .mockImplementation((_url, init) =>
      init?.method === 'POST' ? pending : Promise.resolve(reply(snapshot())),
    );
  vi.stubGlobal('fetch', fetcher);
  render(<QueueBoard role="admin" token={'a'.repeat(43)} onChange={changed} />);
  const up = await screen.findByRole('button', { name: 'Move Second song up' });
  expect(
    screen.getByRole('button', { name: 'Move First song up' }),
  ).toBeDisabled();
  fireEvent.click(up);
  fireEvent.click(up);
  expect(
    fetcher.mock.calls.filter(([, init]) => init?.method === 'POST'),
  ).toHaveLength(1);
  expect(JSON.parse(fetcher.mock.calls.at(-1)![1].body)).toEqual({
    action: 'move',
    requestId: second.id,
    neighborId: first.id,
    direction: 'up',
  });
  expect(up).toBeDisabled();
  fetcher.mockImplementation((_url, init) =>
    init?.method === 'POST'
      ? Promise.resolve(reply({ ok: true }))
      : Promise.resolve(reply({ ...snapshot(true), hostOrdered: true })),
  );
  await act(async () => {
    release(reply({ ok: true }));
  });
  expect(changed).toHaveBeenCalledOnce();
  const reset = await screen.findByRole('button', {
    name: 'Restore vote order',
  });
  fireEvent.click(reset);
  await act(async () => {});
  expect(
    JSON.parse(
      fetcher.mock.calls.findLast(([, init]) => init?.method === 'POST')![1]
        .body,
    ),
  ).toEqual({ action: 'reset' });
});
it('hides queue controls from guests and on locked, backup and ended songs', async () => {
  const data = {
    ...snapshot(),
    hostOrdered: true,
    items: [
      { position: 1, request: first, source: 'GUEST', locked: true },
      { position: 2, request: second, source: 'BACKUP', locked: false },
    ],
  };
  const fetcher = vi.fn().mockResolvedValue(reply(data));
  vi.stubGlobal('fetch', fetcher);
  const { rerender } = render(
    <QueueBoard role="guest" token={'g'.repeat(43)} />,
  );
  await screen.findByRole('link', { name: 'First song' });
  expect(
    screen.queryByRole('button', { name: /Move|Restore/ }),
  ).not.toBeInTheDocument();
  rerender(<QueueBoard role="admin" token={'a'.repeat(43)} />);
  await screen.findByRole('button', { name: 'Restore vote order' });
  expect(
    screen.queryByRole('button', { name: /Move/ }),
  ).not.toBeInTheDocument();
  fetcher.mockResolvedValue(reply({ ...data, status: 'ENDED' }));
  fireEvent.click(screen.getByRole('button', { name: 'Refresh queue' }));
  await screen.findByText(
    'This party has ended. Its saved queue is read-only.',
  );
  expect(
    screen.queryByRole('button', { name: /Move|Restore/ }),
  ).not.toBeInTheDocument();
});
it('reports stale actions, clears an expired host queue, and aborts pending changes on navigation', async () => {
  const expired = vi.fn();
  const fetcher = vi
    .fn()
    .mockImplementation((_url, init) =>
      Promise.resolve(
        init?.method === 'POST' ? reply({}, 409) : reply(snapshot()),
      ),
    );
  vi.stubGlobal('fetch', fetcher);
  const { unmount } = render(
    <QueueBoard role="admin" token={'a'.repeat(43)} onExpired={expired} />,
  );
  fireEvent.click(
    await screen.findByRole('button', { name: 'Move Second song up' }),
  );
  await screen.findByText(
    'The queue changed or the song locked. Refresh the queue before trying again.',
  );
  fetcher.mockImplementation((_url, init) =>
    Promise.resolve(
      init?.method === 'POST' ? reply({}, 401) : reply(snapshot()),
    ),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Move Second song up' }));
  await act(async () => {});
  expect(expired).toHaveBeenCalledOnce();
  expect(screen.queryByRole('link')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Refresh queue' }));
  await screen.findByRole('button', { name: 'Move Second song up' });
  fetcher.mockImplementation((_url, init) =>
    init?.method === 'POST'
      ? new Promise(() => {})
      : Promise.resolve(reply(snapshot())),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Move Second song up' }));
  const signal = fetcher.mock.calls.at(-1)![1].signal;
  unmount();
  expect(signal.aborted).toBe(true);
});
