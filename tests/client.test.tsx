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
  expect(screen.getByRole('status')).toHaveTextContent('Checking connection');
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
