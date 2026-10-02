// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { SpotifyConnection } from '../src/client/SpotifyConnection';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState(null, '', '/');
});
const status = (data: unknown) => ({ ok: true, json: async () => data });

it('shows the connect form without exposing any credentials', async () => {
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockResolvedValue(
        status({ enabled: true, authenticated: false, connected: false }),
      ),
  );
  render(<SpotifyConnection />);
  const button = await screen.findByRole('button', { name: 'Connect Spotify' });
  expect(button.closest('form')).toHaveAttribute('method', 'post');
  expect(button.closest('form')).toHaveAttribute(
    'action',
    '/api/auth/spotify/login',
  );
});
it('displays a connected host and signs out', async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(
      status({
        enabled: true,
        authenticated: true,
        connected: true,
        displayName: 'Sam',
      }),
    )
    .mockResolvedValueOnce({ ok: true });
  vi.stubGlobal('fetch', fetcher);
  render(<SpotifyConnection />);
  expect(
    await screen.findByText('Spotify connected as Sam.'),
  ).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
  expect(
    await screen.findByRole('button', { name: 'Connect Spotify' }),
  ).toBeInTheDocument();
  expect(fetcher.mock.calls[1]).toEqual([
    '/api/auth/logout',
    { method: 'POST', credentials: 'same-origin' },
  ]);
});
it('offers reconnect for expired credentials and shows consent-denial feedback', async () => {
  window.history.replaceState(null, '', '/?spotify=denied');
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(
      status({
        enabled: true,
        authenticated: true,
        connected: false,
        error: 'reauthenticate',
      }),
    ),
  );
  render(<SpotifyConnection />);
  expect(
    await screen.findByRole('button', { name: 'Reconnect Spotify' }),
  ).toBeInTheDocument();
  expect(screen.getByText(/connection was cancelled/)).toBeInTheDocument();
  expect(window.location.search).toBe('');
});
it('disables connection when unavailable and supports retrying failed status requests', async () => {
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockResolvedValue(
        status({ enabled: false, authenticated: false, connected: false }),
      ),
  );
  const view = render(<SpotifyConnection />);
  expect(
    await screen.findByRole('button', { name: 'Connect Spotify' }),
  ).toBeDisabled();
  view.unmount();
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(
        status({
          enabled: true,
          authenticated: false,
          connected: false,
        }),
      ),
  );
  render(<SpotifyConnection />);
  fireEvent.click(await screen.findByRole('button', { name: 'Try again' }));
  expect(
    await screen.findByRole('button', { name: 'Connect Spotify' }),
  ).toBeEnabled();
});

it('uses a same-origin JSON sign-in request, prevents duplicates and recovers from failure', async () => {
  let finish: (value: unknown) => void;
  const pending = new Promise((resolve) => {
    finish = resolve;
  });
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(
      status({ enabled: true, authenticated: false, connected: false }),
    )
    .mockReturnValueOnce(pending)
    .mockResolvedValueOnce(
      status({ authorizationUrl: 'https://attacker.example/authorize' }),
    );
  vi.stubGlobal('fetch', fetcher);
  const view = render(<SpotifyConnection />);
  const button = await screen.findByRole('button', { name: 'Connect Spotify' });
  fireEvent.click(button);
  fireEvent.submit(button.closest('form')!);
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(screen.getByRole('button', { name: 'Connecting…' })).toBeDisabled();
  expect(fetcher.mock.calls[1]).toEqual([
    '/api/auth/spotify/login',
    expect.objectContaining({
      method: 'POST',
      credentials: 'same-origin',
      headers: { accept: 'application/json' },
    }),
  ]);
  finish!({ ok: false });
  await screen.findByText('Unable to start Spotify sign-in. Please try again.');
  fireEvent.click(screen.getByRole('button', { name: 'Connect Spotify' }));
  await screen.findByText('Unable to start Spotify sign-in. Please try again.');
  expect(fetcher).toHaveBeenCalledTimes(3);
  view.unmount();
  expect(fetcher.mock.calls[2][1].signal.aborted).toBe(true);
});
