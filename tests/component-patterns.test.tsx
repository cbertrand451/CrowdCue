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
import { InlineAction } from '../src/client/InlineAction';
import { InlineOverflow } from '../src/client/InlineOverflow';
import { CreateNewDisclosure } from '../src/client/CreateNewDisclosure';
import { ExpandableProfileCard } from '../src/client/ExpandableProfileCard';
import { OnboardingChecklist } from '../src/client/OnboardingChecklist';
import { PartyPickerDialog } from '../src/client/PartyPickerDialog';
import { WigglingCards } from '../src/client/WigglingCards';
import {
  createPartySchema,
  type PartyDetails,
} from '../src/server/parties/contracts.js';

afterEach(cleanup);

it('keeps an inline action pending until confirmation and supports retry after failure', async () => {
  let reject!: (reason: Error) => void;
  const action = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise<void>((_, fail) => {
          reject = fail;
        }),
    )
    .mockResolvedValueOnce(undefined);
  render(
    <InlineAction
      label="Invite your crowd"
      actionText="Copy guest link"
      onAction={action}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Copy guest link' }));
  fireEvent.click(screen.getByRole('button', { name: 'Copying guest link…' }));
  expect(action).toHaveBeenCalledOnce();
  expect(screen.queryByText('Guest link copied.')).not.toBeInTheDocument();
  await act(async () => reject(new Error('Clipboard denied')));
  expect(screen.getByRole('alert')).toHaveTextContent(
    'Copy the guest link above',
  );
  expect(
    screen.getByRole('button', { name: 'Copy guest link' }),
  ).toHaveAttribute('data-state', 'idle');
  fireEvent.click(screen.getByRole('button', { name: 'Copy guest link' }));
  await screen.findByText('Guest link copied.');
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});

it('reveals real overflow actions, runs them and returns focus on Escape', async () => {
  const action = vi.fn();
  render(
    <InlineOverflow
      label="More song actions"
      visibleActions={<button>Approve</button>}
      hiddenActions={<button onClick={action}>Reject</button>}
    />,
  );
  expect(
    screen.queryByRole('button', { name: 'Reject' }),
  ).not.toBeInTheDocument();
  const toggle = screen.getByRole('button', { name: 'More song actions' });
  fireEvent.click(toggle);
  fireEvent.click(screen.getByRole('button', { name: 'Reject' }));
  expect(action).toHaveBeenCalledOnce();
  fireEvent.keyDown(screen.getByRole('button', { name: 'Reject' }), {
    key: 'Escape',
  });
  await waitFor(() =>
    expect(
      screen.queryByRole('button', { name: 'Reject' }),
    ).not.toBeInTheDocument(),
  );
  expect(toggle).toHaveFocus();
  expect(toggle).toHaveAttribute('aria-expanded', 'false');
});

it('opens host shortcuts and dispatches the selected existing action', async () => {
  const action = vi.fn();
  render(
    <CreateNewDisclosure
      items={[
        { id: 'party', icon: '+', label: 'Create a party', onAction: action },
      ]}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Create New' }));
  fireEvent.click(screen.getByRole('button', { name: 'Create a party' }));
  expect(action).toHaveBeenCalledOnce();
  await waitFor(() =>
    expect(
      screen.queryByRole('region', { name: 'Host shortcuts' }),
    ).not.toBeInTheDocument(),
  );
});

it('expands a real guest profile and edits without showing private session identifiers', () => {
  const edit = vi.fn();
  render(<ExpandableProfileCard name="Alex" active onEdit={edit} />);
  fireEvent.click(screen.getByRole('button', { name: 'View guest profile' }));
  const dialog = screen.getByRole('dialog', { name: 'Your guest profile' });
  expect(
    within(dialog).getByRole('heading', { name: 'Alex' }),
  ).toBeInTheDocument();
  fireEvent.click(
    within(dialog).getByRole('button', { name: 'Change your name' }),
  );
  expect(edit).toHaveBeenCalledOnce();
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});

it('derives checklist progress from confirmed data and never marks an action complete on click', () => {
  const action = vi.fn();
  const view = render(
    <OnboardingChecklist
      steps={[
        {
          id: 'backup',
          title: 'Load backup',
          isCompleted: false,
          onAction: action,
        },
        { id: 'session', title: 'Session started', isCompleted: true },
      ]}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: /Session setup/ }));
  expect(screen.getByText('1/2')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Load backup' }));
  expect(action).toHaveBeenCalledOnce();
  expect(screen.getByText('1/2')).toBeInTheDocument();
  view.rerender(<OnboardingChecklist steps={[]} />);
  expect(screen.getByText('0/0')).toBeInTheDocument();
});

const party: PartyDetails = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Friday',
  status: 'ACTIVE',
  createdAt: new Date().toISOString(),
  endedAt: null,
  settings: createPartySchema.parse({ name: 'Friday' }).settings,
  links: {
    guest: 'https://example.com/join/guest',
    admin: 'https://example.com/admin/host',
    display: null,
  },
};
it('filters loaded parties, keeps their role links, and handles an empty search', () => {
  render(
    <PartyPickerDialog
      parties={[
        party,
        {
          ...party,
          id: '22222222-2222-4222-8222-222222222222',
          name: 'Saturday',
          links: { ...party.links, admin: null },
        },
      ]}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Find a party' }));
  const query = screen.getByRole('searchbox', {
    name: 'Search your loaded parties',
  });
  fireEvent.change(query, { target: { value: 'Friday' } });
  expect(screen.getByRole('link', { name: /Friday/ })).toHaveAttribute(
    'href',
    party.links.admin,
  );
  expect(
    screen.queryByRole('link', { name: /Saturday/ }),
  ).not.toBeInTheDocument();
  fireEvent.change(query, { target: { value: 'Saturday' } });
  expect(screen.getByRole('link', { name: /Saturday/ })).toHaveAttribute(
    'href',
    party.links.guest,
  );
  fireEvent.change(query, { target: { value: 'Not loaded' } });
  expect(screen.getByRole('status')).toHaveTextContent('No matching parties.');
});

it('shows actual statistic values and bounds keyboard-accessible navigation', () => {
  render(
    <WigglingCards
      cards={[
        { label: 'Guest sessions joined', value: 12 },
        { label: 'Song requests', value: 24 },
      ]}
    />,
  );
  expect(
    screen.getByText('Guest sessions joined').nextElementSibling,
  ).toHaveTextContent('12');
  expect(
    screen.getByRole('button', { name: 'Previous statistic' }),
  ).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Next statistic' }));
  expect(screen.getByRole('button', { name: 'Next statistic' })).toBeDisabled();
  expect(
    screen.getByRole('button', { name: 'Previous statistic' }),
  ).toBeEnabled();
});
