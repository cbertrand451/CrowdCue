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
import { SongHistory } from '../src/client/SongHistory';
const song = (
  id: string,
  position: number,
  observedAt: string | null = null,
) => ({
  id,
  position,
  source: 'BACKUP',
  requestedBy: null,
  committedAt: '2026-10-02T18:30:00.000Z',
  observedAt,
  delivery: 'SENT',
  track: {
    id: 'a'.repeat(22),
    title: 'Repeated song',
    artists: ['Artist'],
    album: 'Album',
    artworkUrl: null,
    durationMs: 180000,
    explicit: false,
    spotifyUrl: `https://open.spotify.com/track/${'a'.repeat(22)}`,
  },
});
const history = () => ({
  items: [
    song(crypto.randomUUID(), 1, '2026-10-02T18:31:00.000Z'),
    song(crypto.randomUUID(), 2),
  ],
  committedCount: 2,
  observedCount: 1,
  nextOffset: null,
  status: 'ACTIVE',
});
const reply = (data: unknown, status = 200) => ({
  ok: status === 200,
  status,
  json: async () => data,
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
it('renders repeated commitments, observations and uncertainty without claiming a full listen', async () => {
  const data = history();
  data.items[1].delivery = 'UNKNOWN';
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(reply(data)));
  render(<SongHistory token={'a'.repeat(43)} onExpired={vi.fn()} />);
  await screen.findByText('2 songs committed · 1 observed playing');
  expect(screen.getAllByRole('link', { name: 'Repeated song' })).toHaveLength(
    2,
  );
  expect(screen.getByText('Playback not observed')).toBeVisible();
  expect(screen.getByText('Spotify delivery unconfirmed')).toBeVisible();
  expect(
    screen.getByText(/Spotify observations do not confirm a full listen/),
  ).toBeVisible();
  expect(screen.getByLabelText('History position 2')).toBeVisible();
});
it('paginates with global positions and keeps ended history readable', async () => {
  const fetcher = vi.fn().mockImplementation((url: string) =>
    Promise.resolve(
      reply(
        url.endsWith('offset=50')
          ? {
              ...history(),
              items: [song(crypto.randomUUID(), 51)],
              committedCount: 51,
              status: 'ENDED',
            }
          : { ...history(), nextOffset: 50, committedCount: 51 },
      ),
    ),
  );
  vi.stubGlobal('fetch', fetcher);
  render(<SongHistory token={'a'.repeat(43)} onExpired={vi.fn()} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Later songs' }));
  await screen.findByLabelText('History position 51');
  expect(
    screen.getByText(
      /history remains available even if its Spotify playlist is removed/,
    ),
  ).toBeVisible();
  expect(
    screen.queryByRole('button', { name: 'Later songs' }),
  ).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Earlier songs' }));
  await screen.findByLabelText('History position 1');
});
it('preserves history on transient failures, clears private data on expiration, and cancels polling on navigation', async () => {
  vi.useFakeTimers();
  const expired = vi.fn();
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(reply(history()))
    .mockResolvedValueOnce(reply({}, 503))
    .mockResolvedValueOnce(reply({}, 401));
  vi.stubGlobal('fetch', fetcher);
  const view = render(
    <SongHistory token={'a'.repeat(43)} onExpired={expired} />,
  );
  await act(async () => {});
  await act(async () => {
    await vi.advanceTimersByTimeAsync(5000);
  });
  expect(screen.getAllByRole('link')).toHaveLength(2);
  expect(screen.getByRole('alert')).toBeVisible();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(5000);
  });
  expect(screen.queryByRole('link')).not.toBeInTheDocument();
  expect(expired).toHaveBeenCalledOnce();
  view.unmount();
  expect(fetcher.mock.calls[0][1].signal.aborted).toBe(true);
  await vi.advanceTimersByTimeAsync(10000);
  expect(fetcher).toHaveBeenCalledTimes(3);
});
it('shows meaningful empty ended history and clears an invalid/deleted party', async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(
      reply({
        items: [],
        committedCount: 0,
        observedCount: 0,
        nextOffset: null,
        status: 'ENDED',
      }),
    )
    .mockResolvedValue(reply({}, 404));
  vi.stubGlobal('fetch', fetcher);
  render(<SongHistory token={'a'.repeat(43)} onExpired={vi.fn()} />);
  await screen.findByText('No songs were committed during this event.');
  fireEvent.click(screen.getByRole('button', { name: 'Refresh song history' }));
  await screen.findByRole('alert');
  expect(
    screen.queryByText('No songs were committed during this event.'),
  ).not.toBeInTheDocument();
});
