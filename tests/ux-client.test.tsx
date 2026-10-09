// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { GuestInterface } from '../src/client/GuestInterface';
import { SongSearch } from '../src/client/SongSearch';
import { RequestBoard } from '../src/client/RequestBoard';
import { PartyCreation } from '../src/client/PartyCreation';
import { PlaybackPanel } from '../src/client/PlaybackPanel';
import { QueueBoard } from '../src/client/QueueBoard';
import { SongHistory } from '../src/client/SongHistory';
import { PartyStatisticsPanel } from '../src/client/PartyStatisticsPanel';
import { LeaderboardPanel } from '../src/client/LeaderboardPanel';
import { createPartySchema } from '../src/server/parties/contracts.js';
const token = 'g'.repeat(43);
const track = {
  id: 'a'.repeat(22),
  title: 'Crowd favorite',
  artists: ['Artist'],
  album: 'Album',
  artworkUrl: null,
  durationMs: 120000,
  explicit: false,
  spotifyUrl: `https://open.spotify.com/track/${'a'.repeat(22)}`,
};
const guest = {
  id: crypto.randomUUID(),
  displayName: 'Alex',
  expiresAt: new Date(Date.now() + 86400000).toISOString(),
};
const party = {
  name: 'Friday',
  status: 'ACTIVE' as const,
  settings: createPartySchema.parse({ name: 'Friday' }).settings,
};
const reply = (data: unknown, status = 200) => ({
  ok: status < 400,
  status,
  headers: new Headers(),
  json: async () => data,
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
const fallback = (url: string) =>
  url.includes('/requests?')
    ? reply({ requests: [], nextOffset: null })
    : url.includes('/queue?')
      ? reply({
          items: [],
          nextOffset: null,
          votingEnabled: true,
          status: 'ACTIVE',
        })
      : reply({
          status: 'ACTIVE',
          entries: [],
          yourEntry: null,
          participants: 0,
        });
it('gates the dashboard behind explicit anonymous joining and edits the name in a popup', async () => {
  let joined = false;
  const fetcher = vi.fn(async (url: string, opts?: RequestInit) => {
    if (!url.endsWith('/session')) return fallback(url);
    if (opts?.method === 'POST') {
      joined = true;
      return reply({
        guest: {
          ...guest,
          displayName: JSON.parse(opts.body as string).displayName,
        },
      });
    }
    return reply({ guest: joined ? guest : null });
  });
  vi.stubGlobal('fetch', fetcher);
  render(<GuestInterface party={party} token={token} />);
  await screen.findByRole('heading', { name: 'Welcome to Friday' });
  expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
  expect(screen.queryByRole('searchbox')).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Your name (optional)'), {
    target: { value: 'Ignored name' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Continue as guest' }));
  await screen.findByRole('navigation', { name: 'Guest menus' });
  expect(
    JSON.parse(
      fetcher.mock.calls.find((c) => c[1]?.method === 'POST')![1]!
        .body as string,
    ),
  ).toEqual({ displayName: null });
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Edit Guest Name' }));
  expect(screen.getByRole('dialog')).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Your name (optional)'), {
    target: { value: 'Alex' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Update' }));
  await waitFor(() =>
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
  );
  expect(screen.getByText('Joined as Alex.')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Live queue' }));
  expect(screen.getByRole('heading', { name: 'CrowdCue queue' })).toBeVisible();
  expect(screen.queryByRole('searchbox')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Edit Guest Name' }));
  expect(screen.getByLabelText('Your name (optional)')).toHaveValue('Alex');
});
it('requires a name when the host requires one, including restored anonymous sessions', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => reply({ guest: { ...guest, displayName: null } })),
  );
  render(
    <GuestInterface
      party={{
        ...party,
        settings: { ...party.settings, requireGuestNames: true },
      }}
      token={token}
    />,
  );
  await screen.findByRole('heading', { name: 'Welcome to Friday' });
  expect(
    screen.queryByRole('button', { name: 'Continue as guest' }),
  ).not.toBeInTheDocument();
  expect(screen.getByLabelText('Your name')).toBeRequired();
  fireEvent.submit(screen.getByLabelText('Your name').closest('form')!);
  expect(screen.getByRole('alert')).toHaveTextContent('Enter your name');
  expect(screen.queryByRole('searchbox')).not.toBeInTheDocument();
});
it('shows shared requested state until playback and asks Yes/No before a repeat', async () => {
  vi.useFakeTimers();
  let requested = true;
  let played = false;
  let posts = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, opts?: RequestInit) => {
      if (url.includes('/track-states?'))
        return reply({ tracks: [{ id: track.id, requested, played }] });
      if (opts?.method === 'POST') {
        posts++;
        requested = true;
        return reply({
          created: true,
          request: {
            id: crypto.randomUUID(),
            track,
            status: 'APPROVED',
            requestedBy: 'Alex',
            isOwn: true,
            createdAt: new Date().toISOString(),
          },
        });
      }
      return reply({ tracks: [track], nextOffset: null });
    }),
  );
  render(<SongSearch token={token} allowExplicit onExpired={vi.fn()} />);
  fireEvent.change(screen.getByRole('searchbox'), {
    target: { value: 'crowd' },
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(400);
  });
  expect(screen.getByRole('button', { name: 'Song Requested' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Song Requested' })).toHaveClass(
    'requested-button',
  );
  requested = false;
  played = true;
  await act(async () => {
    await vi.advanceTimersByTimeAsync(5000);
  });
  fireEvent.click(screen.getByRole('button', { name: 'Request song' }));
  expect(screen.getByRole('dialog')).toHaveTextContent(
    'This song has been played in this session already, are you sure?',
  );
  fireEvent.click(screen.getByRole('button', { name: 'No' }));
  expect(posts).toBe(0);
  fireEvent.click(screen.getByRole('button', { name: 'Request song' }));
  fireEvent.click(screen.getByRole('button', { name: 'Yes' }));
  await act(async () => {});
  expect(posts).toBe(1);
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Song Requested' })).toBeDisabled();
});
it('never exposes a vote control for the guest’s own request', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      reply({
        requests: [
          {
            id: crypto.randomUUID(),
            track,
            status: 'APPROVED',
            requestedBy: 'Alex',
            isOwn: true,
            createdAt: new Date().toISOString(),
          },
        ],
        nextOffset: null,
      }),
    ),
  );
  render(<RequestBoard role="guest" token={token} active />);
  await screen.findByText('Approved · Your request');
  expect(
    screen.queryByRole('button', { name: 'Vote' }),
  ).not.toBeInTheDocument();
});
it('closes only ended parties and keeps them absent after refreshing', async () => {
  const ended = {
    ...party,
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    endedAt: new Date().toISOString(),
    status: 'ENDED',
    links: {
      guest: `https://example.com/join/${token}`,
      admin: `https://example.com/admin/${token}`,
      display: `https://example.com/display/${token}`,
    },
  };
  let closed = false;
  const fetcher = vi.fn(async (url: string) => {
    if (url.endsWith('/close')) {
      closed = true;
      return reply({ closed: true });
    }
    return reply({ parties: closed ? [] : [ended], nextOffset: null });
  });
  vi.stubGlobal('fetch', fetcher);
  render(<PartyCreation />);
  await screen.findByRole('button', { name: 'Close Friday' });
  fireEvent.click(screen.getByRole('button', { name: 'Close Friday' }));
  await waitFor(() =>
    expect(
      screen.queryByRole('button', { name: 'Close Friday' }),
    ).not.toBeInTheDocument(),
  );
  await screen.findByRole('button', { name: 'Refresh parties' });
  fireEvent.click(screen.getByRole('button', { name: 'Refresh parties' }));
  await screen.findByText('No parties yet. Create your first one.');
  expect(fetcher.mock.calls.some(([url]) => url.endsWith('/close'))).toBe(true);
});
const panels = [
  ['Refresh Spotify status', PlaybackPanel, { active: true }],
  ['Refresh queue', QueueBoard, { role: 'guest' as const }],
  ['Refresh requests', RequestBoard, { role: 'guest' as const, active: true }],
  ['Refresh song history', SongHistory, {}],
  ['Refresh statistics', PartyStatisticsPanel, {}],
  ['Refresh leaderboard', LeaderboardPanel, { role: 'guest' as const }],
] as const;
it.each(panels)(
  'shows loading and disables %s until the request settles',
  async (label, Component, props) => {
    let resolve!: (value: ReturnType<typeof reply>) => void;
    let calls = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        ++calls === 1
          ? Promise.resolve(reply({}, 503))
          : new Promise<ReturnType<typeof reply>>((r) => {
              resolve = r;
            }),
      ),
    );
    render(
      <Component
        token={token}
        onExpired={vi.fn()}
        {...props}
        role="guest"
        active
      />,
    );
    await screen.findByRole('alert');
    fireEvent.click(screen.getByRole('button', { name: label }));
    expect(screen.getByRole('button', { name: 'Refreshing…' })).toBeDisabled();
    await act(async () => {
      resolve(reply({}, 503));
    });
    expect(screen.getByRole('button', { name: label })).toBeEnabled();
  },
);
