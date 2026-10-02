// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { PartyStatisticsPanel } from '../src/client/PartyStatisticsPanel';
const statistics = {
  status: 'ENDED',
  durationSeconds: 7500,
  guestSessions: 3,
  requests: {
    total: 4,
    pending: 0,
    approved: 1,
    queued: 1,
    played: 1,
    rejected: 0,
    removed: 1,
  },
  votes: 2,
  voters: 1,
  committed: { total: 5, guest: 1, backup: 4, observed: 3 },
  topSongs: [
    {
      spotifyTrackId: 'a'.repeat(22),
      title: 'Popular song',
      artist: 'Artist',
      votes: 2,
    },
  ],
};
const reply = (status = 200) => ({
  ok: status === 200,
  status,
  json: async () => statistics,
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
it('shows final duration, correctly labeled totals and most-voted songs', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(reply()));
  render(<PartyStatisticsPanel token={'a'.repeat(43)} onExpired={vi.fn()} />);
  await screen.findByText(/Final session summary · Duration: 2h 5m/);
  expect(screen.getByRole('link', { name: 'Popular song' })).toHaveAttribute(
    'href',
    `https://open.spotify.com/track/${'a'.repeat(22)}`,
  );
  expect(
    within(screen.getByText('Backup songs committed').parentElement!).getByText(
      '4',
    ),
  ).toBeVisible();
  expect(screen.getByText('Departed playback')).toBeVisible();
  expect(screen.getByText(/do not confirm full listens/)).toBeVisible();
});
it('retains statistics on transient failures and clears them when authorization expires', async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(reply())
    .mockResolvedValueOnce(reply(503))
    .mockResolvedValueOnce(reply(401));
  vi.stubGlobal('fetch', fetcher);
  const expired = vi.fn();
  const view = render(
    <PartyStatisticsPanel token={'a'.repeat(43)} onExpired={expired} />,
  );
  await screen.findByRole('link', { name: 'Popular song' });
  fireEvent.click(screen.getByRole('button', { name: 'Refresh statistics' }));
  await screen.findByRole('alert');
  expect(screen.getByRole('link', { name: 'Popular song' })).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Refresh statistics' }));
  await vi.waitFor(() => expect(expired).toHaveBeenCalledOnce());
  expect(
    screen.queryByRole('link', { name: 'Popular song' }),
  ).not.toBeInTheDocument();
  view.unmount();
  expect(fetcher.mock.calls.at(-1)![1].signal.aborted).toBe(true);
});
