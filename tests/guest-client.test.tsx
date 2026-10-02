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
import { GuestInterface } from '../src/client/GuestInterface';
import { createPartySchema } from '../src/server/parties/contracts.js';
const party = {
  name: 'Friday party',
  status: 'ACTIVE' as const,
  settings: createPartySchema.parse({ name: 'Friday party' }).settings,
};
const guest = {
  id: crypto.randomUUID(),
  displayName: 'Alex',
  expiresAt: new Date(Date.now() + 86400000).toISOString(),
};
const reply = (data: unknown, status = 200) => ({
  ok: status < 400,
  status,
  json: async () => data,
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
function stubActionFetch(
  fetcher: (url: string, options?: RequestInit) => unknown,
) {
  vi.stubGlobal('fetch', (url: string, options?: RequestInit) =>
    url.includes('/requests?')
      ? Promise.resolve(reply({ requests: [], nextOffset: null }))
      : url.includes('/queue?')
        ? Promise.resolve(
            reply({
              items: [],
              nextOffset: null,
              votingEnabled: true,
              status: 'ACTIVE',
            }),
          )
        : fetcher(url, options),
  );
}

it('joins anonymously once and lets a guest save a name without host controls', async () => {
  let resolve!: (value: ReturnType<typeof reply>) => void;
  const pending = new Promise<ReturnType<typeof reply>>((done) => {
    resolve = done;
  });
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(reply({ guest: null }))
    .mockReturnValueOnce(pending)
    .mockResolvedValueOnce(reply({ guest }));
  stubActionFetch(fetcher);
  render(<GuestInterface party={party} token={'g'.repeat(43)} />);
  await screen.findByRole('button', { name: 'Join party' });
  const form = screen.getByLabelText('Your name (optional)').closest('form')!;
  fireEvent.submit(form);
  fireEvent.submit(form);
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(JSON.parse(fetcher.mock.calls[1][1].body)).toEqual({
    displayName: null,
  });
  await act(async () => {
    resolve(reply({ guest: { ...guest, displayName: null } }));
    await pending;
  });
  expect(await screen.findByText('Joined as a guest.')).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Your name (optional)'), {
    target: { value: '  Alex  ' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Save name' }));
  await screen.findByText('Your name is saved.');
  expect(JSON.parse(fetcher.mock.calls[2][1].body)).toEqual({
    displayName: 'Alex',
  });
  expect(
    screen.queryByRole('link', { name: 'Open admin' }),
  ).not.toBeInTheDocument();
});
it('restores an existing guest and displays current preferences and required-name changes', async () => {
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockResolvedValue(reply({ guest: { ...guest, displayName: null } })),
  );
  const view = render(<GuestInterface party={party} token={'g'.repeat(43)} />);
  await screen.findByText('Joined as a guest.');
  view.rerender(
    <GuestInterface
      party={{
        ...party,
        settings: {
          ...party.settings,
          requireGuestNames: true,
          votingEnabled: false,
          approvalRequired: true,
        },
      }}
      token={'g'.repeat(43)}
    />,
  );
  expect(
    screen.getByText(
      'The host now requires a name. Add yours before requesting songs or voting.',
    ),
  ).toBeInTheDocument();
  expect(screen.getByText('Voting is turned off.')).toBeInTheDocument();
  const form = screen.getByLabelText('Your name').closest('form')!;
  fireEvent.submit(form);
  expect(
    screen.getByText('Enter your name to join this party.'),
  ).toBeInTheDocument();
});
it('shows ended-party state without join or edit controls', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(reply({ guest })));
  render(
    <GuestInterface
      party={{ ...party, status: 'ENDED' }}
      token={'g'.repeat(43)}
    />,
  );
  await screen.findByText('Joined as Alex.');
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  expect(
    screen.queryByRole('button', { name: 'Join party' }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole('button', { name: 'Save name' }),
  ).not.toBeInTheDocument();
});
it('recovers from session errors and handles a party ending during joining', async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(reply({}, 503))
    .mockResolvedValueOnce(reply({ guest: null }))
    .mockResolvedValueOnce(reply({}, 409));
  stubActionFetch(fetcher);
  render(<GuestInterface party={party} token={'g'.repeat(43)} />);
  await screen.findByText('Unable to check your guest session. Try again.');
  fireEvent.click(screen.getByRole('button', { name: 'Check session again' }));
  await screen.findByRole('button', { name: 'Join party' });
  fireEvent.click(screen.getByRole('button', { name: 'Join party' }));
  await screen.findByText(
    'This party has ended. You can no longer join or change your name.',
  );
});
it('cancels a pending join on navigation without updating a departed page', async () => {
  let resolve!: (value: ReturnType<typeof reply>) => void;
  const pending = new Promise<ReturnType<typeof reply>>((done) => {
    resolve = done;
  });
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(reply({ guest: null }))
    .mockReturnValueOnce(pending);
  stubActionFetch(fetcher);
  const view = render(<GuestInterface party={party} token={'g'.repeat(43)} />);
  await screen.findByRole('button', { name: 'Join party' });
  fireEvent.click(screen.getByRole('button', { name: 'Join party' }));
  view.unmount();
  expect(fetcher.mock.calls[1][1].signal.aborted).toBe(true);
  await act(async () => {
    resolve(reply({ guest }));
    await pending;
  });
  await waitFor(() =>
    expect(screen.queryByText('Joined as Alex.')).not.toBeInTheDocument(),
  );
});
