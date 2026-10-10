// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { App } from '../src/client/App';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
it('confirms the API is running', async () => {
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockResolvedValue({ ok: true, json: async () => ({ status: 'ok' }) }),
  );
  render(<App />);
  expect(screen.getByText('Checking connection…')).toHaveAttribute(
    'role',
    'status',
  );
  expect(await screen.findByText('CrowdCue is running.')).toBeInTheDocument();
});
it('shows an actionable connection failure', async () => {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
  render(<App />);
  expect(
    await screen.findByText(/Unable to reach CrowdCue/),
  ).toBeInTheDocument();
});
it('does not report malformed responses as healthy', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }),
  );
  render(<App />);
  expect(
    await screen.findByText(/Unable to reach CrowdCue/),
  ).toBeInTheDocument();
});

it('groups home controls and shows only active parties with their real links', async () => {
  const party = {
    id: crypto.randomUUID(),
    name: 'Tonight',
    status: 'ACTIVE',
    createdAt: new Date().toISOString(),
    endedAt: null,
    settings: {},
    links: {
      guest: 'https://crowdcue.example/join/guest',
      admin: 'https://crowdcue.example/admin/host',
      display: 'https://crowdcue.example/display/tv',
    },
  };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => ({
      ok: true,
      json: async () =>
        url === '/api/health'
          ? { status: 'ok' }
          : url === '/api/auth/spotify/status'
            ? { enabled: true, authenticated: true, connected: true }
            : {
                parties: [
                  party,
                  {
                    ...party,
                    id: crypto.randomUUID(),
                    name: 'Yesterday',
                    status: 'ENDED',
                  },
                ],
                nextOffset: null,
              },
    })),
  );
  render(<App />);
  const overview = await screen.findByRole('region', {
    name: 'Active party overview',
  });
  const { within } = await import('@testing-library/react');
  expect(await within(overview).findByText('Tonight')).toBeVisible();
  expect(within(overview).queryByText('Yesterday')).not.toBeInTheDocument();
  expect(
    within(overview).getByRole('link', { name: 'Open admin' }),
  ).toHaveAttribute('href', party.links.admin);
  expect(
    within(screen.getByRole('region', { name: 'Host controls' })).getByRole(
      'button',
      { name: 'Sign out' },
    ),
  ).toBeVisible();
  expect(
    screen.queryByText('Create a party and share it with your guests.'),
  ).not.toBeInTheDocument();
});
