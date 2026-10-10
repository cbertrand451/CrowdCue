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
  vi.useRealTimers();
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

it('does not claim readiness or offer playback instructions when creation failed', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(
      reply({
        ...status,
        creation: 'NEW',
        playlistUrl: null,
        error: 'unavailable',
        lockedCount: 0,
        guestCount: 0,
        backupCount: 0,
        backupSourceUrl: `https://open.spotify.com/playlist/${'s'.repeat(22)}`,
        backupTrackCount: 76,
      }),
    ),
  );
  render(<PlaybackPanel token={'a'.repeat(43)} active onExpired={vi.fn()} />);
  expect(
    await screen.findByText(/Session playlist creation has not been confirmed/),
  ).toBeVisible();
  expect(
    screen.getByRole('button', { name: 'Retry Spotify sync' }),
  ).toBeVisible();
  expect(
    screen.getByRole('link', { name: 'Open backup source in Spotify' }),
  ).toBeVisible();
  expect(
    screen.queryByRole('link', { name: 'Open session playlist in Spotify' }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByText(/Session playlist enabled/),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByText(/Open the session playlist in Spotify and press Play/),
  ).not.toBeInTheDocument();
});
it('automatically reveals the confirmed playlist link on the next status poll', async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(
      reply({ ...status, creation: 'CREATING', playlistUrl: null }),
    )
    .mockResolvedValue(
      reply({ ...status, syncedAt: new Date().toISOString() }),
    );
  vi.stubGlobal('fetch', fetcher);
  vi.useFakeTimers();
  await act(async () => {
    render(<PlaybackPanel token={'a'.repeat(43)} active onExpired={vi.fn()} />);
  });
  expect(
    screen.getByText(/Checking whether Spotify created your session playlist/),
  ).toBeVisible();
  expect(
    screen.queryByRole('link', { name: 'Open session playlist in Spotify' }),
  ).not.toBeInTheDocument();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(5000);
  });
  expect(
    screen.getByRole('link', { name: 'Open session playlist in Spotify' }),
  ).toHaveAttribute('href', status.playlistUrl);
  expect(screen.getByText(/Session playlist ready/)).toBeVisible();
  expect(fetcher.mock.calls.every((call) => call[1]?.method !== 'POST')).toBe(
    true,
  );
});
it('keeps the confirmed playlist link visible when filling the playlist fails', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(reply({ ...status, error: 'unavailable' })),
  );
  render(<PlaybackPanel token={'a'.repeat(43)} active onExpired={vi.fn()} />);
  expect(
    await screen.findByRole('link', {
      name: 'Open session playlist in Spotify',
    }),
  ).toHaveAttribute('href', status.playlistUrl);
  expect(
    screen.getByText(
      /Session playlist created. Spotify synchronization needs attention/,
    ),
  ).toBeVisible();
  expect(screen.queryByText(/Session playlist ready/)).not.toBeInTheDocument();
});
it('does not claim an ended party left a playlist when no creation was confirmed', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(
      reply({
        ...status,
        enabled: false,
        ended: true,
        playlistUrl: null,
        creation: 'NEW',
      }),
    ),
  );
  render(
    <PlaybackPanel token={'a'.repeat(43)} active={false} onExpired={vi.fn()} />,
  );
  await screen.findByText(/songs committed/);
  expect(
    screen.queryByText('Your session playlist stays in Spotify.'),
  ).not.toBeInTheDocument();
});

it('keeps Spotify failure diagnostics and expands actionable setup help after refreshing status', async () => {
  const initial = {
    ...status,
    enabled: false,
    playlistUrl: null,
    creation: 'NEW',
  };
  const fetcher = vi.fn(async (_url, opts) =>
    opts?.method === 'POST'
      ? reply(
          {
            error: 'Spotify permissions are missing. Please reconnect.',
            code: 'permissions',
          },
          503,
        )
      : reply(initial),
  );
  vi.stubGlobal('fetch', fetcher);
  const configure = vi.fn();
  render(
    <PlaybackPanel
      token={'a'.repeat(43)}
      active
      onExpired={vi.fn()}
      onConfigureBackup={configure}
    />,
  );
  fireEvent.click(await screen.findByRole('button', { name: 'Start session' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Spotify permissions are missing',
  );
  expect(
    screen.getByText('Session troubleshooting').closest('details'),
  ).toHaveAttribute('open');
  expect(
    screen.getByText(/Reconnect Spotify and approve playlist read/),
  ).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Open party settings' }));
  expect(configure).toHaveBeenCalledOnce();
  expect(
    fetcher.mock.calls.filter((call) => call[1]?.method === 'POST'),
  ).toHaveLength(1);
});

it('explains cooldowns when Spotify rejects startup without persisted session errors', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url, opts) =>
      opts?.method === 'POST'
        ? reply(
            {
              error: 'Spotify is busy. Please try again shortly.',
              code: 'rate_limited',
              retryAfter: 60,
            },
            429,
          )
        : reply({ ...status, enabled: false, playlistUrl: null, error: null }),
    ),
  );
  render(<PlaybackPanel token={'a'.repeat(43)} active onExpired={vi.fn()} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Start session' }));
  expect(
    await screen.findByText('Wait at least 60 seconds before retrying.'),
  ).toBeVisible();
});
