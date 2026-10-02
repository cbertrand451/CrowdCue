// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { LeaderboardPanel } from '../src/client/LeaderboardPanel';
const me = {
  rank: 1,
  name: 'Alex',
  points: 6,
  songsObserved: 1,
  votesReceived: 1,
  isYou: true,
};
const board = {
  status: 'ENDED',
  participants: 2,
  entries: [me, { ...me, name: 'Guest 2', isYou: false }],
  yourEntry: me,
};
const reply = (status = 200, data: unknown = board) => ({
  ok: status === 200,
  status,
  json: async () => data,
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
it('shows tied ranks, own score, breakdown and scoring rules without implying queue priority', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(reply()));
  render(
    <LeaderboardPanel
      role="guest"
      token={'g'.repeat(43)}
      onExpired={vi.fn()}
    />,
  );
  await screen.findByText('Your score: 6 points · Rank 1');
  expect(screen.getByText('Alex (you)')).toBeVisible();
  expect(screen.getByText('Guest 2')).toBeVisible();
  expect(screen.getAllByText('1', { exact: true })).toHaveLength(2);
  expect(screen.getByText('Final party leaderboard')).toBeVisible();
  expect(screen.getByText(/never affect the song queue/)).toBeVisible();
});
it('includes own score outside the first 50 and clears sensitive state on expired access', async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(
      reply(200, {
        ...board,
        participants: 60,
        entries: [{ ...me, name: 'Other', isYou: false }],
        yourEntry: { ...me, rank: 55, points: 0 },
      }),
    )
    .mockResolvedValueOnce(reply(503))
    .mockResolvedValueOnce(reply(401));
  vi.stubGlobal('fetch', fetcher);
  const expired = vi.fn();
  const view = render(
    <LeaderboardPanel
      role="guest"
      token={'g'.repeat(43)}
      onExpired={expired}
    />,
  );
  await screen.findByText('Your score: 0 points · Rank 55');
  expect(screen.getByText(/first 50 of 60/)).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Refresh leaderboard' }));
  await screen.findByRole('alert');
  expect(screen.getByText('Other')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Refresh leaderboard' }));
  await vi.waitFor(() => expect(expired).toHaveBeenCalledOnce());
  expect(screen.queryByText('Other')).not.toBeInTheDocument();
  view.unmount();
  expect(fetcher.mock.calls.at(-1)![1].signal.aborted).toBe(true);
});
it('shows an empty host leaderboard without personalized points', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(
      reply(200, {
        status: 'ACTIVE',
        participants: 0,
        entries: [],
        yourEntry: null,
      }),
    ),
  );
  render(
    <LeaderboardPanel
      role="admin"
      token={'a'.repeat(43)}
      onExpired={vi.fn()}
    />,
  );
  await screen.findByText('No guests have joined yet.');
  expect(screen.queryByText(/Your score:/)).toBeNull();
});
