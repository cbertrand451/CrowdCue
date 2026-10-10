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
import { PartyCreation } from '../src/client/PartyCreation';
import { PartyPage } from '../src/client/PartyPage';
import { App } from '../src/client/App';
import {
  createPartySchema,
  type PartyDetails,
} from '../src/server/parties/contracts.js';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  window.history.replaceState(null, '', '/');
});
const party: PartyDetails = {
  id: crypto.randomUUID(),
  name: 'Friday party',
  status: 'ACTIVE',
  createdAt: new Date().toISOString(),
  endedAt: null,
  settings: createPartySchema.parse({ name: 'Friday party' }).settings,
  links: {
    guest: `https://crowdcue.example/join/${'g'.repeat(43)}`,
    admin: `https://crowdcue.example/admin/${'a'.repeat(43)}`,
    display: `https://crowdcue.example/display/${'d'.repeat(43)}`,
  },
};
const displayData = (status: 'ACTIVE' | 'ENDED' = 'ACTIVE') => ({
  party: { name: party.name, status, guestUrl: party.links.guest },
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
});
const reply = (data: unknown, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => data,
});

function stubActionFetch(
  fetcher: (url: string, options?: RequestInit) => unknown,
) {
  vi.stubGlobal('fetch', (url: string, options?: RequestInit) =>
    url.endsWith('/leaderboard')
      ? Promise.resolve(
          reply({
            status: 'ACTIVE',
            entries: [],
            yourEntry: null,
            participants: 0,
          }),
        )
      : url.endsWith('/statistics')
        ? Promise.resolve(
            reply({
              status: 'ACTIVE',
              durationSeconds: 0,
              guestSessions: 0,
              requests: {
                total: 0,
                pending: 0,
                approved: 0,
                queued: 0,
                played: 0,
                rejected: 0,
                removed: 0,
              },
              votes: 0,
              voters: 0,
              committed: { total: 0, guest: 0, backup: 0, observed: 0 },
              topSongs: [],
            }),
          )
        : url.includes('/history?')
          ? Promise.resolve(
              reply({
                items: [],
                committedCount: 0,
                observedCount: 0,
                nextOffset: null,
                status: 'ACTIVE',
              }),
            )
          : url.includes('/requests?')
            ? Promise.resolve(reply({ requests: [], nextOffset: null }))
            : url.includes('/queue?')
              ? Promise.resolve(
                  reply({
                    items: [],
                    nextOffset: null,
                    votingEnabled: true,
                    status: 'ACTIVE',
                  }),
                )
              : url.endsWith('/playback')
                ? Promise.resolve(
                    reply({
                      enabled: false,
                      mode: 'QUEUE',
                      playlistUrl: null,
                      playlistRemoved: false,
                      creation: 'NEW',
                      error: null,
                      retryAt: null,
                      syncedAt: null,
                      lockedCount: 0,
                      guestCount: 0,
                      backupCount: 0,
                      saveAtCreation: false,
                      saveAtClose: null,
                      closeDecided: false,
                      ended: false,
                    }),
                  )
                : fetcher(url, options),
  );
}

it('creates a party with chosen preferences and blocks double submission', async () => {
  let resolveCreation!: (value: ReturnType<typeof reply>) => void;
  const pending = new Promise<ReturnType<typeof reply>>((resolve) => {
    resolveCreation = resolve;
  });
  const fetcher = vi
    .fn()
    .mockImplementation((_url: string, options?: RequestInit) =>
      options?.method === 'POST'
        ? pending
        : Promise.resolve(reply({ parties: [], nextOffset: null })),
    );
  stubActionFetch(fetcher);
  render(<PartyCreation />);
  await screen.findByText('No parties yet. Create your first one.');
  const name = screen.getByLabelText('Party name');
  fireEvent.change(name, { target: { value: '  Friday party  ' } });
  fireEvent.click(screen.getByLabelText('Approve song requests'));
  const form = name.closest('form')!;
  fireEvent.submit(form);
  fireEvent.submit(form);
  expect(
    fetcher.mock.calls.filter((call) => call[1]?.method === 'POST'),
  ).toHaveLength(1);
  expect(name).toBeDisabled();
  const post = fetcher.mock.calls.find(
    (call) => call[1]?.method === 'POST',
  )![1];
  expect(JSON.parse(post.body)).toMatchObject({
    name: 'Friday party',
    settings: { approvalRequired: true, votingEnabled: true },
  });
  expect(post.headers['idempotency-key']).toMatch(/^[0-9a-f-]{36}$/);
  await act(async () => {
    resolveCreation(reply({ party }));
  });
  expect(
    await screen.findByText('Your party is ready. Share the guest link below.'),
  ).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Open admin' })).toHaveAttribute(
    'href',
    party.links.admin,
  );
  expect(screen.getByLabelText('Party name')).toHaveValue('');
  const clipboard = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: clipboard },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Copy guest link' }));
  expect(await screen.findByText('Guest link copied.')).toBeInTheDocument();
  expect(clipboard).toHaveBeenCalledWith(party.links.guest);
});

it('reuses the same creation key after an uncertain network failure', async () => {
  let attempts = 0;
  const fetcher = vi
    .fn()
    .mockImplementation((_url: string, options?: RequestInit) => {
      if (options?.method !== 'POST')
        return Promise.resolve(reply({ parties: [], nextOffset: null }));
      attempts++;
      return attempts === 1
        ? Promise.reject(new Error('offline'))
        : Promise.resolve(reply({ party }));
    });
  stubActionFetch(fetcher);
  render(<PartyCreation />);
  await screen.findByText('No parties yet. Create your first one.');
  fireEvent.change(screen.getByLabelText('Party name'), {
    target: { value: 'Friday party' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Create party' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Could not confirm party creation',
  );
  fireEvent.click(screen.getByRole('button', { name: 'Create party' }));
  await screen.findByText('Your party is ready. Share the guest link below.');
  const posts = fetcher.mock.calls.filter((call) => call[1]?.method === 'POST');
  expect(posts[0][1].headers['idempotency-key']).toBe(
    posts[1][1].headers['idempotency-key'],
  );
});

it('loads existing parties on refresh and renders names as text', async () => {
  const unsafeName = '<img src=x onerror=alert(1)>';
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockResolvedValue(
        reply({ parties: [{ ...party, name: unsafeName }], nextOffset: null }),
      ),
  );
  const { container } = render(<PartyCreation />);
  expect(await screen.findByText(unsafeName)).toBeInTheDocument();
  expect(container.querySelector('img')).toBeNull();
  expect(screen.getByRole('link', { name: 'Open display' })).toHaveAttribute(
    'rel',
    'noreferrer',
  );
});

it('shows useful recovery for list failures and expired create sessions', async () => {
  const fetcher = vi
    .fn()
    .mockImplementation((_url: string, options?: RequestInit) =>
      Promise.resolve(
        options?.method === 'POST' ? reply({}, 401) : reply({}, 503),
      ),
    );
  stubActionFetch(fetcher);
  render(<PartyCreation />);
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Unable to load your parties',
  );
  fireEvent.change(screen.getByLabelText('Party name'), {
    target: { value: 'Friday party' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Create party' }));
  await waitFor(() =>
    expect(screen.getByText(/Your session expired/)).toBeInTheDocument(),
  );
});

it('keeps creation behind host authentication and removes private links on sign-out', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation((url: string) =>
      Promise.resolve(
        url === '/api/health'
          ? reply({ status: 'ok' })
          : url === '/api/auth/spotify/status'
            ? reply({
                enabled: true,
                authenticated: true,
                connected: true,
                displayName: 'Host',
              })
            : url === '/api/parties'
              ? reply({ parties: [party], nextOffset: null })
              : reply({}, 204),
      ),
    ),
  );
  render(<App />);
  expect(await screen.findByText(party.name)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
  await screen.findByRole('button', { name: 'Connect Spotify' });
  expect(
    screen.queryByRole('button', { name: 'Create party' }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole('link', { name: 'Open admin' }),
  ).not.toBeInTheDocument();
});

it('shows guest/display pages without host controls and handles an ended party', async () => {
  window.history.replaceState(null, '', `/join/${'g'.repeat(43)}`);
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(
      reply({
        party: {
          name: party.name,
          status: 'ENDED',
          settings: party.settings,
        },
      }),
    ),
  );
  const guest = render(<App />);
  expect(await screen.findByText('This party has ended.')).toBeInTheDocument();
  expect(
    screen.queryByRole('button', { name: 'Create party' }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole('link', { name: 'Open admin' }),
  ).not.toBeInTheDocument();
  guest.unmount();
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(reply(displayData())));
  render(<PartyPage role="display" token={'d'.repeat(43)} />);
  expect(
    await screen.findByRole('link', {
      name: party.links.guest.replace(/^https?:\/\//, ''),
    }),
  ).toBeInTheDocument();
  expect(screen.queryByRole('button')).not.toBeInTheDocument();
});

it('requires the host to sign in before showing an admin party', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(reply({}, 401)));
  render(<PartyPage role="admin" token={'a'.repeat(43)} />);
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Sign in as this party’s host',
  );
  expect(
    screen.queryByRole('link', { name: 'Open display' }),
  ).not.toBeInTheDocument();
  expect(
    screen.getByRole('link', { name: 'Back to your parties' }),
  ).toHaveAttribute('href', '/');
});

it('polls public party state without overlapping requests and stops when unmounted', async () => {
  vi.useFakeTimers();
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(reply(displayData()))
    .mockResolvedValueOnce(reply(displayData('ENDED')));
  stubActionFetch(fetcher);
  const view = render(<PartyPage role="display" token={'d'.repeat(43)} />);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
  expect(
    screen.getByRole('heading', { name: 'Ready when you are' }),
  ).toBeInTheDocument();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(5000);
  });
  expect(screen.getByText('This party has ended.')).toBeInTheDocument();
  expect(fetcher).toHaveBeenCalledTimes(2);
  view.unmount();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(30000);
  });
  expect(fetcher).toHaveBeenCalledTimes(2);
});

it('saves admin preferences and requires confirmation before ending a party', async () => {
  const { AdminDashboard } = await import('../src/client/AdminDashboard');
  const onChange = vi.fn();
  const onExpired = vi.fn();
  const fetcher = vi
    .fn()
    .mockResolvedValue(reply({ party: { ...party, name: 'Saturday party' } }));
  stubActionFetch(fetcher);
  render(
    <AdminDashboard
      party={party}
      token={'a'.repeat(43)}
      onChange={onChange}
      onExpired={onExpired}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
  fireEvent.change(screen.getByLabelText('Party name'), {
    target: { value: 'Saturday party' },
  });
  fireEvent.click(screen.getByLabelText('Require guest names'));
  fireEvent.change(screen.getByLabelText('Request cooldown in seconds'), {
    target: { value: '30' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
  fireEvent.click(screen.getByRole('button', { name: 'Save settings' }));
  await screen.findByText('Settings saved.');
  expect(JSON.parse(fetcher.mock.calls[0][1].body)).toMatchObject({
    name: 'Saturday party',
    settings: { requireGuestNames: true, requestCooldownSeconds: 30 },
  });
  expect(onChange).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole('button', { name: 'End party' }));
  expect(fetcher).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole('button', { name: 'Keep party active' }));
  expect(screen.queryByText('Confirm end party')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'End party' }));
  fireEvent.click(screen.getByRole('button', { name: 'Confirm end party' }));
  await screen.findByText('Party ended.');
  expect(fetcher.mock.calls[1][0]).toMatch(/\/end$/);
  expect(fetcher.mock.calls[1][1].body).toBe('{}');
});

it('keeps ended dashboards read-only and clears access on an expired session', async () => {
  const { AdminDashboard } = await import('../src/client/AdminDashboard');
  const fetcher = vi.fn().mockResolvedValue(reply({}, 401));
  stubActionFetch(fetcher);
  const onExpired = vi.fn();
  const view = render(
    <AdminDashboard
      party={party}
      token={'a'.repeat(43)}
      onChange={vi.fn()}
      onExpired={onExpired}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
  fireEvent.click(screen.getByRole('button', { name: 'Save settings' }));
  await waitFor(() => expect(onExpired).toHaveBeenCalledOnce());
  view.rerender(
    <AdminDashboard
      party={{ ...party, status: 'ENDED' }}
      token={'a'.repeat(43)}
      onChange={vi.fn()}
      onExpired={onExpired}
    />,
  );
  expect(screen.getByRole('button', { name: 'Save settings' })).toBeDisabled();
  expect(
    screen.queryByRole('button', { name: 'End party' }),
  ).not.toBeInTheDocument();
});

it('cancels dashboard mutations on unmount without restoring private details', async () => {
  const { AdminDashboard } = await import('../src/client/AdminDashboard');
  let resolve!: (value: ReturnType<typeof reply>) => void;
  const pending = new Promise<ReturnType<typeof reply>>((done) => {
    resolve = done;
  });
  const fetcher = vi.fn().mockReturnValue(pending);
  stubActionFetch(fetcher);
  const onChange = vi.fn();
  const view = render(
    <AdminDashboard
      party={party}
      token={'a'.repeat(43)}
      onChange={onChange}
      onExpired={vi.fn()}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
  fireEvent.click(screen.getByRole('button', { name: 'Save settings' }));
  const signal = fetcher.mock.calls[0][1].signal as AbortSignal;
  view.unmount();
  expect(signal.aborted).toBe(true);
  await act(async () => {
    resolve(reply({ party }));
    await pending;
  });
  expect(onChange).not.toHaveBeenCalled();
});

it('animates only the end action while settings remain disabled and idle', async () => {
  const { AdminDashboard } = await import('../src/client/AdminDashboard');
  let complete!: (value: ReturnType<typeof reply>) => void;
  const pendingEnd = new Promise<ReturnType<typeof reply>>((resolve) => {
    complete = resolve;
  });
  stubActionFetch((url: string) =>
    url.endsWith('/end') ? pendingEnd : Promise.resolve(reply({})),
  );
  render(
    <AdminDashboard
      party={party}
      token={'a'.repeat(43)}
      onChange={vi.fn()}
      onExpired={vi.fn()}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
  fireEvent.click(screen.getByRole('button', { name: 'End party' }));
  fireEvent.click(screen.getByRole('button', { name: 'Confirm end party' }));
  const save = screen.getByRole('button', { name: 'Save settings' });
  expect(save).toBeDisabled();
  expect(save).toHaveAttribute('data-state', 'idle');
  expect(screen.getByRole('button', { name: 'Ending…' })).toHaveAttribute(
    'data-state',
    'loading',
  );
  await act(async () =>
    complete(reply({ party: { ...party, status: 'ENDED' } })),
  );
  expect(await screen.findByText('Party ended.')).toBeVisible();
});
