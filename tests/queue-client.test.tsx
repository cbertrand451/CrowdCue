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
