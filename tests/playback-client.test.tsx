// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { PlaybackPanel } from '../src/client/PlaybackPanel';
const status = {
  enabled: true,
  mode: 'QUEUE',
  playlistUrl: `https://open.spotify.com/playlist/${'p'.repeat(22)}`,
  playlistRemoved: false,
  creation: 'READY',
  error: null,
  retryAt: null,
  syncedAt: null,
  lockedCount: 4,
  guestCount: 1,
  backupCount: 3,
  saveAtCreation: false,
  saveAtClose: null,
  closeDecided: false,
  ended: false,
};
const reply = (data: unknown, code = 200) => ({
  ok: code < 400,
  status: code,
  json: async () => data,
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
it('customizes the session playlist and instructs manual Spotify playback', async () => {
  const fetcher = vi
    .fn()
    .mockImplementation(async (_url, opts) =>
      reply(
        opts?.method === 'POST'
          ? status
          : { ...status, enabled: false, playlistUrl: null },
      ),
    );
  vi.stubGlobal('fetch', fetcher);
  render(<PlaybackPanel token={'a'.repeat(43)} active onExpired={vi.fn()} />);
  fireEvent.change(
    await screen.findByLabelText(
      'Session playlist name (defaults to party name)',
    ),
    { target: { value: 'Dance floor' } },
  );
  fireEvent.change(screen.getByLabelText('Playlist description'), {
    target: { value: 'Birthday' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Start session' }));
  await screen.findByRole('link', { name: 'Open session playlist in Spotify' });
  expect(
    JSON.parse(
      fetcher.mock.calls.find((x) => x[1]?.method === 'POST')![1].body,
    ),
  ).toEqual({ action: 'start', name: 'Dance floor', description: 'Birthday' });
  expect(
    screen.queryByRole('button', { name: 'Start playlist recovery' }),
  ).not.toBeInTheDocument();
});
it('keeps the playlist at closeout and shows manual deletion instructions without any write', async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValue(reply({ ...status, enabled: false, ended: true }));
  vi.stubGlobal('fetch', fetcher);
  render(
    <PlaybackPanel token={'a'.repeat(43)} active={false} onExpired={vi.fn()} />,
  );
  await screen.findByText('Your session playlist stays in Spotify.');
  expect(screen.getByText(/To delete it yourself/)).toBeVisible();
  expect(fetcher.mock.calls.every((x) => x[1]?.method !== 'POST')).toBe(true);
  expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
});
it('clears private session details on expired host authentication', async () => {
  const expired = vi.fn();
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(reply(status))
    .mockResolvedValue(reply({}, 401));
  vi.stubGlobal('fetch', fetcher);
  render(<PlaybackPanel token={'a'.repeat(43)} active onExpired={expired} />);
  await screen.findByRole('link', { name: 'Open session playlist in Spotify' });
  fireEvent.click(
    screen.getByRole('button', { name: 'Refresh Spotify status' }),
  );
  await screen.findByRole('alert');
  expect(expired).toHaveBeenCalledOnce();
  expect(screen.queryByRole('link')).not.toBeInTheDocument();
});

it('shows the backup source/count and checks it without starting playback', async () => {
  const checked = {
    ...status,
    enabled: false,
    backupSourceUrl: `https://open.spotify.com/playlist/${'s'.repeat(22)}`,
    backupTrackCount: 3,
  };
  const fetcher = vi
    .fn()
    .mockImplementation(async (_url, options) =>
      reply(
        options?.method === 'POST'
          ? { ...checked, backupTrackCount: 7 }
          : checked,
      ),
    );
  vi.stubGlobal('fetch', fetcher);
  const { rerender } = render(
    <PlaybackPanel token={'a'.repeat(43)} active onExpired={vi.fn()} />,
  );
  expect(
    await screen.findByRole('link', { name: 'Open backup source in Spotify' }),
  ).toHaveAttribute('href', checked.backupSourceUrl);
  fireEvent.click(
    screen.getByRole('button', { name: 'Check / refresh backup playlist' }),
  );
  await screen.findByText(
    '7 usable songs loaded. Random backup songs fill gaps when guests have no songs waiting.',
  );
  expect(
    JSON.parse(
      fetcher.mock.calls.find(([, options]) => options?.method === 'POST')![1]
        .body,
    ),
  ).toEqual({ action: 'refresh-backup' });
  rerender(
    <PlaybackPanel token={'a'.repeat(43)} active={false} onExpired={vi.fn()} />,
  );
  expect(
    screen.queryByRole('button', { name: 'Check / refresh backup playlist' }),
  ).not.toBeInTheDocument();
});
