// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { PartyArchive } from '../src/client/PartyArchive';
import { ShowQR } from '../src/client/ShowQR';
import { DashboardNavigation } from '../src/client/DashboardNavigation';
import { CoverUpload } from '../src/client/CoverUpload';
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
const item = {
  id: 'a70dc230-6ab3-44cb-a58c-0e236973bb38',
  name: 'Friday night',
  createdAt: '2026-10-01T18:00:00Z',
  endedAt: '2026-10-02T02:00:00Z',
  coverUrl: null,
  playlistUrl: 'https://open.spotify.com/playlist/' + 'p'.repeat(22),
  trackCount: 12,
};
it('requires confirmation before removing a gallery card and reloads pagination after removal', async () => {
  let removed = false;
  const fetcher = vi.fn(async (url: string) => ({
    ok: true,
    json: async () =>
      url.endsWith('/remove')
        ? ((removed = true), { removed: true })
        : { parties: removed ? [] : [item], nextOffset: 20 },
  }));
  vi.stubGlobal('fetch', fetcher);
  render(<PartyArchive />);
  const remove = await screen.findByRole('button', {
    name: 'Remove Friday night from archive',
  });
  expect(screen.getByRole('link', { name: /Open playlist/ })).toHaveAttribute(
    'href',
    item.playlistUrl,
  );
  fireEvent.click(remove);
  expect(fetcher).toHaveBeenCalledTimes(1);
  const dialog = screen.getByRole('dialog');
  expect(
    within(dialog).getByText(/Spotify playlist and party history are kept/),
  ).toBeInTheDocument();
  fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
  expect(fetcher).toHaveBeenCalledTimes(1);
  fireEvent.click(remove);
  fireEvent.click(
    within(screen.getByRole('dialog')).getByRole('button', {
      name: 'Remove from gallery',
    }),
  );
  await waitFor(() =>
    expect(
      screen.queryByRole('button', {
        name: 'Remove Friday night from archive',
      }),
    ).not.toBeInTheDocument(),
  );
  expect(fetcher).toHaveBeenCalledWith(
    `/api/parties/${item.id}/archive/remove`,
    expect.objectContaining({
      method: 'POST',
      body: '{}',
      credentials: 'same-origin',
    }),
  );
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(3));
});
it('keeps a gallery card and displays recovery when removal fails', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => ({
      ok: !url.endsWith('/remove'),
      json: async () => ({ parties: [item], nextOffset: null }),
    })),
  );
  render(<PartyArchive />);
  fireEvent.click(
    await screen.findByRole('button', {
      name: 'Remove Friday night from archive',
    }),
  );
  fireEvent.click(
    within(screen.getByRole('dialog')).getByRole('button', {
      name: 'Remove from gallery',
    }),
  );
  await waitFor(() =>
    expect(
      within(screen.getByRole('dialog')).getByRole('alert'),
    ).toHaveTextContent('Could not remove'),
  );
  expect(screen.getByRole('heading', { name: item.name })).toBeInTheDocument();
});
it('expands a secondary guest QR through a keyboard-accessible button', async () => {
  render(<ShowQR url={'https://crowdcue.example/join/' + 'g'.repeat(43)} />);
  const button = screen.getByRole('button', { name: 'Show QR code' });
  expect(button).toHaveAttribute('aria-expanded', 'false');
  fireEvent.click(button);
  expect(
    screen.getByRole('img', { name: 'Guest join QR code' }),
  ).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Hide QR code' })).toHaveAttribute(
    'aria-expanded',
    'true',
  );
});
it('shows navigation tooltips for focus and dismisses them with Escape', async () => {
  const onSelect = vi.fn();
  render(
    <DashboardNavigation
      label="Workspace"
      items={[{ id: 'archive', label: 'Party Archive', icon: '▣' }]}
      selected="archive"
      onSelect={onSelect}
    />,
  );
  const button = screen.getByRole('button', { name: 'Party Archive' });
  fireEvent.focus(button);
  expect(screen.getByRole('tooltip')).toHaveTextContent('Party Archive');
  fireEvent.click(button);
  expect(onSelect).toHaveBeenCalledWith('archive');
  fireEvent.keyDown(button, { key: 'Escape' });
  await waitFor(() =>
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument(),
  );
});
it('rejects unsupported cover media before invoking an upload', async () => {
  const onChange = vi.fn();
  render(<CoverUpload onChange={onChange} />);
  fireEvent.change(screen.getByLabelText(/Cover Image/), {
    target: {
      files: [new File(['<svg/>'], 'cover.svg', { type: 'image/svg+xml' })],
    },
  });
  expect(screen.getByRole('alert')).toHaveTextContent('JPEG, PNG, or WebP');
  expect(onChange).not.toHaveBeenCalled();
});
