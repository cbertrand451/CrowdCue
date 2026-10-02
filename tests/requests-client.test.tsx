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
import { SongSearch } from '../src/client/SongSearch';
import { RequestBoard } from '../src/client/RequestBoard';
const track = {
  id: 'a'.repeat(22),
  title: 'Song',
  artists: ['Artist'],
  album: 'Album',
  artworkUrl: null,
  durationMs: 185000,
  explicit: false,
  spotifyUrl: `https://open.spotify.com/track/${'a'.repeat(22)}`,
};
const request = {
  id: crypto.randomUUID(),
  track,
  status: 'REQUESTED' as const,
  requestedBy: 'Alex',
  isOwn: true,
  createdAt: new Date().toISOString(),
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
});
it('submits only track IDs, blocks double submission, and reuses the request key after an uncertain failure', async () => {
  let resolve!: (value: ReturnType<typeof reply>) => void;
  const pending = new Promise<ReturnType<typeof reply>>((done) => {
    resolve = done;
  });
  let posts = 0;
  const fetcher = vi.fn((_url: string, options?: RequestInit) =>
    options?.method === 'POST'
      ? ++posts === 1
        ? pending
        : Promise.resolve(reply({ request, created: true }, 201))
      : Promise.resolve(reply({ tracks: [track], nextOffset: null })),
  );
  vi.stubGlobal('fetch', fetcher);
  const onRequested = vi.fn();
  render(
    <SongSearch
      token={'g'.repeat(43)}
      allowExplicit
      onExpired={vi.fn()}
      onRequested={onRequested}
    />,
  );
  fireEvent.change(screen.getByRole('searchbox'), {
    target: { value: 'song' },
  });
  await screen.findByRole('button', { name: 'Request song' });
  fireEvent.click(screen.getByRole('button', { name: 'Request song' }));
  fireEvent.click(screen.getByRole('button', { name: 'Requesting…' }));
  expect(posts).toBe(1);
  await act(async () => {
    resolve(reply({ error: 'Try again' }, 503));
    await pending;
  });
  fireEvent.click(screen.getByRole('button', { name: 'Request song' }));
  await screen.findByText('Request sent for host approval.');
  const submissions = fetcher.mock.calls.filter(
    (call) => call[1]?.method === 'POST',
  );
  expect(submissions).toHaveLength(2);
  expect(JSON.parse(submissions[0][1]!.body as string)).toEqual({
    trackId: track.id,
  });
  expect(submissions[0][1]!.headers).toEqual(submissions[1][1]!.headers);
  expect(onRequested).toHaveBeenCalledOnce();
  expect(screen.getByRole('link', { name: 'View requests' })).toHaveAttribute(
    'href',
    '#song-requests',
  );
});
it('shows request status and lets the host approve, reject, or remove supported requests', async () => {
  let status = 'REQUESTED';
  const fetcher = vi.fn(async (_url: string, options?: RequestInit) => {
    if (options?.method === 'POST') {
      status =
        JSON.parse(options.body as string).action === 'approve'
          ? 'APPROVED'
          : 'REMOVED';
      return reply({ request: { ...request, status, isOwn: false } });
    }
    return reply({
      requests: [{ ...request, status, isOwn: false }],
      nextOffset: null,
    });
  });
  vi.stubGlobal('fetch', fetcher);
  const view = render(
    <RequestBoard role="admin" token={'a'.repeat(43)} active />,
  );
  await screen.findByText('Awaiting host approval');
  fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
  await screen.findByText('Approved');
  expect(
    screen.queryByRole('button', { name: 'Approve' }),
  ).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
  await screen.findByText('Removed');
  const submissions = fetcher.mock.calls.filter(
    (call) => call[1]?.method === 'POST',
  );
  expect(submissions[0][0]).toContain(`/requests/${request.id}`);
  expect(JSON.parse(submissions[0][1]!.body as string)).toEqual({
    action: 'approve',
  });
  view.rerender(
    <RequestBoard role="admin" token={'a'.repeat(43)} active={false} />,
  );
  expect(
    screen.queryByRole('button', { name: 'Remove' }),
  ).not.toBeInTheDocument();
});
it('keeps guest boards read-only and handles expired sessions', async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(reply({ requests: [request], nextOffset: null }))
    .mockResolvedValueOnce(reply({}, 401));
  vi.stubGlobal('fetch', fetcher);
  const expired = vi.fn();
  render(
    <RequestBoard
      role="guest"
      token={'g'.repeat(43)}
      active
      onExpired={expired}
    />,
  );
  await screen.findByText('Awaiting host approval · Your request');
  expect(
    screen.queryByRole('button', { name: 'Approve' }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole('button', { name: 'Remove' }),
  ).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Refresh requests' }));
  await waitFor(() => expect(expired).toHaveBeenCalledOnce());
  expect(screen.queryByRole('link', { name: 'Song' })).not.toBeInTheDocument();
});

it('adds and removes votes using idempotent desired states and respects the voting switch', async () => {
  let voted = false;
  const fetcher = vi.fn(async (_url: string, options?: RequestInit) => {
    if (options?.method === 'POST')
      voted = JSON.parse(options.body as string).voted;
    const row = { ...request, voteCount: voted ? 1 : 0, hasVoted: voted };
    return reply(
      options?.method === 'POST'
        ? { request: row }
        : { requests: [row], nextOffset: null },
    );
  });
  vi.stubGlobal('fetch', fetcher);
  const view = render(
    <RequestBoard role="guest" token={'g'.repeat(43)} active votingEnabled />,
  );
  await screen.findByText('0 votes');
  fireEvent.click(screen.getByRole('button', { name: 'Vote' }));
  await screen.findByText('1 vote');
  expect(screen.getByRole('button', { name: 'Remove vote' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  fireEvent.click(screen.getByRole('button', { name: 'Remove vote' }));
  await screen.findByText('0 votes');
  const mutations = fetcher.mock.calls.filter(
    (call) => call[1]?.method === 'POST',
  );
  expect(mutations[0][0]).toMatch(/\/vote$/);
  expect(JSON.parse(mutations[0][1]!.body as string)).toEqual({ voted: true });
  expect(JSON.parse(mutations[1][1]!.body as string)).toEqual({ voted: false });
  view.rerender(
    <RequestBoard
      role="guest"
      token={'g'.repeat(43)}
      active
      votingEnabled={false}
    />,
  );
  expect(screen.getByRole('button', { name: 'Vote' })).toBeDisabled();
  expect(
    screen.getByText('Voting is turned off. Existing votes are preserved.'),
  ).toBeInTheDocument();
  view.rerender(
    <RequestBoard
      role="guest"
      token={'g'.repeat(43)}
      active={false}
      votingEnabled
    />,
  );
  expect(
    screen.queryByRole('button', { name: 'Vote' }),
  ).not.toBeInTheDocument();
});

it('blocks double voting and aborts pending vote mutations when leaving a party', async () => {
  let resolve!: (value: ReturnType<typeof reply>) => void;
  const pending = new Promise<ReturnType<typeof reply>>((done) => {
    resolve = done;
  });
  const fetcher = vi.fn((_url: string, options?: RequestInit) =>
    options?.method === 'POST'
      ? pending
      : Promise.resolve(
          reply({
            requests: [{ ...request, voteCount: 0, hasVoted: false }],
            nextOffset: null,
          }),
        ),
  );
  vi.stubGlobal('fetch', fetcher);
  const view = render(
    <RequestBoard role="guest" token={'g'.repeat(43)} active />,
  );
  await screen.findByRole('button', { name: 'Vote' });
  fireEvent.click(screen.getByRole('button', { name: 'Vote' }));
  fireEvent.click(screen.getByRole('button', { name: 'Saving vote…' }));
  expect(
    fetcher.mock.calls.filter((call) => call[1]?.method === 'POST'),
  ).toHaveLength(1);
  const signal = fetcher.mock.calls.find(
    (call) => call[1]?.method === 'POST',
  )![1]!.signal as AbortSignal;
  view.unmount();
  expect(signal.aborted).toBe(true);
  await act(async () => {
    resolve(reply({ request: { ...request, voteCount: 1, hasVoted: true } }));
    await pending;
  });
  expect(screen.queryByText('1 vote')).not.toBeInTheDocument();
});
