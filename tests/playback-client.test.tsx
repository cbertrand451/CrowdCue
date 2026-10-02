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
it('requires clearing Spotify queue before recovery and shows confirmed recovery mode', async () => {
  const fetcher = vi.fn().mockResolvedValue(reply(status));
  fetcher.mockImplementation(async (_url: string, options?: RequestInit) =>
    reply(
      options?.method === 'POST' ? { ...status, mode: 'PLAYLIST' } : status,
    ),
  );
  vi.stubGlobal('fetch', fetcher);
  render(<PlaybackPanel token={'a'.repeat(43)} active onExpired={vi.fn()} />);
  await screen.findByText('4 songs committed · 1 guest songs · 3 backup songs');
  expect(
    screen.getByRole('button', { name: 'Start playlist recovery' }),
  ).toBeDisabled();
  fireEvent.click(
    screen.getByRole('checkbox', {
      name: 'I cleared pending songs in Spotify',
    }),
  );
  fireEvent.click(
    screen.getByRole('button', { name: 'Start playlist recovery' }),
  );
  await screen.findByText('Playlist recovery enabled');
  expect(
    JSON.parse(
      fetcher.mock.calls.find((x) => x[1]?.method === 'POST')![1]!
        .body as string,
    ),
  ).toEqual({ action: 'fallback', confirm: true });
});
it('asks again at closeout and keeps the first Yes decision visible', async () => {
  const initial = {
    ...status,
    enabled: false,
    ended: true,
    saveAtCreation: true,
  };
  const fetcher = vi
    .fn()
    .mockImplementation(async (_url: string, options?: RequestInit) =>
      reply(
        options?.method === 'POST'
          ? { ...initial, closeDecided: true, saveAtClose: false }
          : initial,
      ),
    );
  vi.stubGlobal('fetch', fetcher);
  render(
    <PlaybackPanel token={'a'.repeat(43)} active={false} onExpired={vi.fn()} />,
  );
  await screen.findByRole('combobox', { name: 'Save the nightly playlist?' });
  expect(
    screen.getByText(
      'You chose Yes at creation, so this playlist will be kept either way.',
    ),
  ).toBeVisible();
  fireEvent.click(
    screen.getByRole('button', { name: 'Finish session summary' }),
  );
  await screen.findByText('The nightly playlist is saved.');
  expect(
    JSON.parse(
      fetcher.mock.calls.find((x) => x[1]?.method === 'POST')![1]!
        .body as string,
    ),
  ).toEqual({ action: 'close', save: false });
});
it('clears private session details on expired host authentication', async () => {
  const expired = vi.fn();
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(reply(status))
    .mockResolvedValue(reply({}, 401));
  vi.stubGlobal('fetch', fetcher);
  render(<PlaybackPanel token={'a'.repeat(43)} active onExpired={expired} />);
  await screen.findByRole('link', { name: 'Open nightly playlist in Spotify' });
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
    '7 usable songs loaded. Backup songs cycle when guests have no songs waiting.',
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
