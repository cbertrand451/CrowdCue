// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { LoadingButton, LoadingStatus } from '../src/client/LoadingButton';

afterEach(cleanup);

it('blocks clicks while pending and only shows success when explicitly confirmed', () => {
  const clicked = vi.fn();
  const view = render(
    <LoadingButton loading loadingLabel="Saving settings…" onClick={clicked}>
      Save settings
    </LoadingButton>,
  );
  const button = screen.getByRole('button', { name: 'Saving settings…' });
  expect(button).toBeDisabled();
  expect(button).toHaveAttribute('aria-busy', 'true');
  fireEvent.click(button);
  expect(clicked).not.toHaveBeenCalled();
  // A failed operation returns to idle, never to a timed success state.
  view.rerender(
    <LoadingButton loading={false} onClick={clicked}>
      Save settings
    </LoadingButton>,
  );
  expect(button).toBeEnabled();
  expect(button).toHaveAttribute('data-state', 'idle');
  view.rerender(
    <LoadingButton loading={false} succeeded>
      Settings saved
    </LoadingButton>,
  );
  expect(button).toHaveAttribute('data-state', 'saved');
  expect(button).toHaveAccessibleName('Settings saved');
});

it('preserves form submission, explicit labels and unrelated disabled states', () => {
  render(
    <form>
      <LoadingButton
        type="submit"
        loading={false}
        disabled
        aria-label="Request this song"
      >
        Request song
      </LoadingButton>
    </form>,
  );
  const button = screen.getByRole('button', { name: 'Request this song' });
  expect(button).toHaveAttribute('type', 'submit');
  expect(button).toBeDisabled();
  expect(button).toHaveAttribute('aria-busy', 'false');
});

it('announces passive loading without creating an extra button', () => {
  render(<LoadingStatus>Searching Spotify…</LoadingStatus>);
  expect(screen.getByRole('status')).toHaveTextContent('Searching Spotify…');
  expect(screen.queryByRole('button')).not.toBeInTheDocument();
});
