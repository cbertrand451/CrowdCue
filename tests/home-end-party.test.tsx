// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { App } from '../src/client/App';
import { EndPartyAction } from '../src/client/EndPartyAction';
import {
  createPartySchema,
  type PartyDetails,
} from '../src/server/parties/contracts.js';

const token = 'a'.repeat(43);
const party: PartyDetails = {
  id: crypto.randomUUID(),
  name: 'Tonight',
  status: 'ACTIVE',
  createdAt: new Date().toISOString(),
  endedAt: null,
  settings: createPartySchema.parse({ name: 'Tonight' }).settings,
  links: {
    guest: `https://crowdcue.example/join/${'g'.repeat(43)}`,
    admin: `https://crowdcue.example/admin/${token}`,
    display: null,
  },
};
const reply = (data: unknown, status = 200) => ({
  ok: status < 400,
  status,
  json: async () => data,
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it('confirms ending from home, blocks duplicate submissions, and keeps the shared list ended after a stale refresh', async () => {
  let finish!: (value: ReturnType<typeof reply>) => void;
  const ending = new Promise<ReturnType<typeof reply>>((resolve) => {
    finish = resolve;
  });
  const fetcher = vi.fn(async (url: string, options?: RequestInit) =>
    options?.method === 'POST'
      ? ending
      : url === '/api/health'
        ? reply({ status: 'ok' })
        : url === '/api/auth/spotify/status'
          ? reply({ enabled: true, authenticated: true, connected: true })
          : reply({ parties: [party], nextOffset: null }),
  );
  vi.stubGlobal('fetch', fetcher);
  render(<App />);
  fireEvent.click(await screen.findByRole('button', { name: 'End Tonight' }));
  expect(screen.getByRole('dialog', { name: 'End Tonight?' })).toBeVisible();
  await waitFor(() =>
    expect(screen.getByText(/You cannot reopen it/)).toBeVisible(),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Keep party active' }));
  expect(
    fetcher.mock.calls.filter((call) => call[1]?.method === 'POST'),
  ).toHaveLength(0);
  fireEvent.click(screen.getByRole('button', { name: 'End Tonight' }));
  const confirm = screen.getByRole('button', { name: 'Confirm end Tonight' });
  fireEvent.click(confirm);
  fireEvent.click(confirm);
  expect(confirm).toBeDisabled();
  expect(confirm).toHaveAttribute('data-state', 'loading');
  expect(
    screen.getByRole('button', { name: 'Close End Tonight?' }),
  ).toBeDisabled();
  expect(
    fetcher.mock.calls.filter((call) => call[1]?.method === 'POST'),
  ).toHaveLength(1);
  await act(async () =>
    finish(
      reply({
        party: { ...party, status: 'ENDED', endedAt: new Date().toISOString() },
      }),
    ),
  );
  await waitFor(() =>
    expect(
      screen.queryByRole('button', { name: 'End Tonight' }),
    ).not.toBeInTheDocument(),
  );
  const overview = screen.getByRole('region', {
    name: 'Active party overview',
  });
  expect(
    within(overview).getByText('Tonight ended. Spotify playback continues.'),
  ).toBeVisible();
  expect(
    within(overview).queryByRole('img', { name: 'Guest join QR code' }),
  ).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Your parties' }));
  expect(screen.getByRole('button', { name: 'Close Tonight' })).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Refresh parties' }));
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'Refresh parties' }),
    ).not.toBeDisabled(),
  );
  expect(
    screen.queryByRole('button', { name: 'End Tonight' }),
  ).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Close Tonight' })).toBeVisible();
  const post = fetcher.mock.calls.find((call) => call[1]?.method === 'POST')!;
  expect(post[0]).toBe(`/api/party-links/admin/${token}/end`);
  expect(post[1]).toMatchObject({ credentials: 'same-origin', body: '{}' });
});

it.each([401, 503])(
  'keeps a failed %s end attempt retryable and does not report success',
  async (status) => {
    const ended = vi.fn();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => reply({}, status)),
    );
    render(<EndPartyAction party={party} onEnded={ended} />);
    fireEvent.click(screen.getByRole('button', { name: 'End Tonight' }));
    fireEvent.click(
      screen.getByRole('button', { name: 'Confirm end Tonight' }),
    );
    expect(await screen.findByRole('alert')).toHaveTextContent(
      status === 401 ? 'sign-in expired' : 'Could not confirm',
    );
    expect(ended).not.toHaveBeenCalled();
    expect(
      screen.getByRole('button', { name: 'Confirm end Tonight' }),
    ).not.toBeDisabled();
  },
);
