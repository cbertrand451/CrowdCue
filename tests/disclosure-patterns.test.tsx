// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { FloatingInput } from '../src/client/FloatingInput';
import { SwitchDisclosure } from '../src/client/SwitchDisclosure';
import { FilterDisclosure } from '../src/client/FilterDisclosure';
import { QuickFeedback } from '../src/client/QuickFeedback';
import { CopyConfirm } from '../src/client/CopyConfirm';
import { FeatureTour } from '../src/client/FeatureTour';
afterEach(cleanup);
it('preserves input values, labels and caller change handlers', () => {
  const onChange = vi.fn();
  const { rerender } = render(
    <FloatingInput
      label="Party name"
      value="Existing party"
      onChange={onChange}
      required
    />,
  );
  expect(screen.getByLabelText('Party name')).toHaveValue('Existing party');
  fireEvent.change(screen.getByLabelText('Party name'), {
    target: { value: 'New name' },
  });
  expect(onChange).toHaveBeenCalledOnce();
  rerender(
    <FloatingInput
      label="Party name"
      value="New name"
      onChange={onChange}
      required
    />,
  );
  expect(screen.getByLabelText('Party name')).toBeRequired();
});
it('keeps preference controls disabled within a saving fieldset', () => {
  const change = vi.fn();
  render(
    <fieldset disabled>
      <SwitchDisclosure
        label="Allow voting"
        checked
        onChange={change}
        description="Guests can vote."
      />
    </fieldset>,
  );
  expect(screen.getByRole('checkbox', { name: 'Allow voting' })).toBeDisabled();
  expect(screen.getByText('Guests can vote.')).toBeInTheDocument();
});
it('selects a filter and returns keyboard focus to the disclosure trigger', async () => {
  const change = vi.fn();
  render(<FilterDisclosure value="all" onChange={change} />);
  const trigger = screen.getByRole('button', {
    name: 'Filter requests on this page',
  });
  fireEvent.click(trigger);
  fireEvent.click(screen.getByRole('button', { name: 'Awaiting approval' }));
  expect(change).toHaveBeenCalledWith('waiting');
  expect(trigger).toHaveFocus();
  await waitFor(() =>
    expect(
      screen.queryByRole('button', { name: 'Awaiting approval' }),
    ).not.toBeInTheDocument(),
  );
  fireEvent.click(trigger);
  fireEvent.keyDown(trigger, { key: 'Escape' });
  expect(trigger).toHaveAttribute('aria-expanded', 'false');
});
it('waits for confirmed vote state and disables repeated submissions', () => {
  const change = vi.fn();
  const { rerender } = render(
    <QuickFeedback
      voted={false}
      loading={false}
      disabled={false}
      onChange={change}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Vote' }));
  expect(change).toHaveBeenCalledWith(true);
  expect(screen.getByRole('button', { name: 'Vote' })).toHaveAttribute(
    'aria-pressed',
    'false',
  );
  rerender(
    <QuickFeedback voted={false} loading disabled={false} onChange={change} />,
  );
  expect(screen.getByRole('button', { name: 'Saving vote…' })).toBeDisabled();
  rerender(
    <QuickFeedback voted loading={false} disabled={false} onChange={change} />,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Remove vote' }));
  expect(change).toHaveBeenLastCalledWith(false);
});
it('offers clipboard retry without claiming failed copies succeeded', async () => {
  const copy = vi
    .fn()
    .mockRejectedValueOnce(new Error('Denied'))
    .mockResolvedValueOnce(undefined);
  render(
    <CopyConfirm
      label="Invite your crowd"
      actionText="Copy guest link"
      onAction={copy}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Copy guest link' }));
  await screen.findByRole('alert');
  expect(screen.queryByText('Guest link copied.')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Copy guest link' }));
  await screen.findByText('Guest link copied.');
  expect(copy).toHaveBeenCalledTimes(2);
});
it('opens the guide only on demand and closes with Escape', async () => {
  render(<FeatureTour />);
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'How CrowdCue works' }));
  expect(screen.getByRole('dialog')).toHaveAccessibleName('How CrowdCue works');
  fireEvent.click(screen.getByRole('button', { name: 'Next tip' }));
  expect(screen.getByText('Step 2 of 3')).toBeInTheDocument();
  fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
  await waitFor(() =>
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
  );
});
