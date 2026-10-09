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
import { SongSearch } from '../src/client/SongSearch';
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
const reply = (data: unknown, status = 200, headers = {}) => ({
  ok: status < 400,
  status,
  headers: new Headers(headers),
  json: async () => data,
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
async function tick(ms = 400) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}
it('debounces query changes and renders Spotify metadata with paged results', async () => {
  vi.useFakeTimers();
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(reply({ tracks: [track], nextOffset: 10 }))
    .mockResolvedValueOnce(
      reply({
        tracks: [
          track,
          {
            ...track,
            id: 'b'.repeat(22),
            title: 'Second song',
            spotifyUrl: `https://open.spotify.com/track/${'b'.repeat(22)}`,
          },
        ],
        nextOffset: null,
      }),
    );
  vi.stubGlobal('fetch', (url: string, options?: RequestInit) =>
    url.includes('/track-states?')
      ? Promise.resolve(reply({ tracks: [] }))
      : fetcher(url, options),
  );
  render(
    <SongSearch
      token={'g'.repeat(43)}
      allowExplicit={false}
      onExpired={vi.fn()}
    />,
  );
  const input = screen.getByRole('searchbox');
  fireEvent.change(input, { target: { value: 's' } });
  await tick();
  expect(fetcher).not.toHaveBeenCalled();
  fireEvent.change(input, { target: { value: 'song' } });
  await tick(200);
  fireEvent.change(input, { target: { value: 'song artist' } });
  await tick(399);
  expect(fetcher).not.toHaveBeenCalled();
  await tick(1);
  expect(fetcher).toHaveBeenCalledOnce();
  expect(screen.getByRole('link', { name: 'Song' })).toHaveAttribute(
    'href',
    track.spotifyUrl,
  );
  expect(screen.getByText('Artist')).toBeInTheDocument();
  expect(screen.getByText('Album')).toBeInTheDocument();
  expect(screen.getByText('3:05')).toBeInTheDocument();
  expect(
    screen.getByText('Explicit songs are hidden for this party.'),
  ).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Load more songs' }));
  await tick(0);
  expect(fetcher.mock.calls[1][0]).toContain('offset=10');
  expect(screen.getAllByRole('listitem')).toHaveLength(2);
  expect(
    screen.queryByRole('button', { name: 'Load more songs' }),
  ).not.toBeInTheDocument();
});
it('aborts old searches and discards stale results even when the transport ignores abort', async () => {
  vi.useFakeTimers();
  let resolve!: (value: ReturnType<typeof reply>) => void;
  const pending = new Promise<ReturnType<typeof reply>>((done) => {
    resolve = done;
  });
  const fetcher = vi
    .fn()
    .mockReturnValueOnce(pending)
    .mockResolvedValueOnce(reply({ tracks: [], nextOffset: null }));
  vi.stubGlobal('fetch', (url: string, options?: RequestInit) =>
    url.includes('/track-states?')
      ? Promise.resolve(reply({ tracks: [] }))
      : fetcher(url, options),
  );
  const view = render(
    <SongSearch token={'g'.repeat(43)} allowExplicit onExpired={vi.fn()} />,
  );
  fireEvent.change(screen.getByRole('searchbox'), {
    target: { value: 'old song' },
  });
  await tick();
  fireEvent.change(screen.getByRole('searchbox'), {
    target: { value: 'new song' },
  });
  expect(fetcher.mock.calls[0][1].signal.aborted).toBe(true);
  await tick();
  await act(async () => {
    resolve(reply({ tracks: [track], nextOffset: 10 }));
    await pending;
  });
  expect(screen.queryByRole('link', { name: 'Song' })).not.toBeInTheDocument();
  expect(
    screen.getByText('No matching songs on this page. Try another search.'),
  ).toBeInTheDocument();
  view.unmount();
  expect(fetcher.mock.calls[1][1].signal.aborted).toBe(true);
});
it('shows Retry-After feedback, recovers on retry, and clears expired guest access', async () => {
  vi.useFakeTimers();
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(reply({}, 429, { 'retry-after': '12' }))
    .mockResolvedValueOnce(reply({ tracks: [track], nextOffset: null }))
    .mockResolvedValueOnce(reply({}, 401));
  vi.stubGlobal('fetch', (url: string, options?: RequestInit) =>
    url.includes('/track-states?')
      ? Promise.resolve(reply({ tracks: [] }))
      : fetcher(url, options),
  );
  const expired = vi.fn();
  render(
    <SongSearch token={'g'.repeat(43)} allowExplicit onExpired={expired} />,
  );
  fireEvent.change(screen.getByRole('searchbox'), {
    target: { value: 'song' },
  });
  await tick();
  expect(screen.getByRole('alert')).toHaveTextContent('Wait 12 seconds');
  fireEvent.click(screen.getByRole('button', { name: 'Retry search' }));
  await tick();
  expect(screen.getByRole('link', { name: 'Song' })).toBeInTheDocument();
  fireEvent.change(screen.getByRole('searchbox'), {
    target: { value: 'another song' },
  });
  await tick();
  expect(expired).toHaveBeenCalledOnce();
});
it('asks for confirmation before submitting a previously played song again', async () => {
  vi.useFakeTimers();
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(reply({ tracks: [track], nextOffset: null }))
    .mockResolvedValueOnce(
      reply({
        confirmationRequired: true,
        message: 'Song already played...proceed?',
      }),
    )
    .mockResolvedValueOnce(
      reply({
        confirmationRequired: true,
        message: 'Song already played...proceed?',
      }),
    )
    .mockResolvedValueOnce(
      reply(
        {
          created: true,
          request: {
            id: crypto.randomUUID(),
            track,
            status: 'APPROVED',
            requestedBy: 'Alex',
            isOwn: true,
            voteCount: 0,
            hasVoted: false,
            locked: false,
            createdAt: new Date().toISOString(),
          },
        },
        201,
      ),
    );
  vi.stubGlobal('fetch', (url: string, options?: RequestInit) =>
    url.includes('/track-states?')
      ? Promise.resolve(reply({ tracks: [] }))
      : fetcher(url, options),
  );
  render(
    <SongSearch token={'g'.repeat(43)} allowExplicit onExpired={vi.fn()} />,
  );
  fireEvent.change(screen.getByRole('searchbox'), {
    target: { value: 'song' },
  });
  await tick();
  fireEvent.click(screen.getByRole('button', { name: 'Request song' }));
  await act(async () => {});
  expect(screen.getByRole('dialog')).toHaveTextContent(
    'This song has been played in this session already, are you sure?',
  );
  expect(JSON.parse(fetcher.mock.calls[1][1].body as string)).toEqual({
    confirmPlayedRepeat: false,
    trackId: track.id,
  });
  fireEvent.click(screen.getByRole('button', { name: 'No' }));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Request song' }));
  await act(async () => {});
  fireEvent.click(screen.getByRole('button', { name: 'Yes' }));
  await act(async () => {});
  expect(JSON.parse(fetcher.mock.calls[3][1].body as string)).toEqual({
    confirmPlayedRepeat: true,
    trackId: track.id,
  });
  expect(screen.getByRole('status')).toHaveTextContent(
    'Your request is added.',
  );
});
