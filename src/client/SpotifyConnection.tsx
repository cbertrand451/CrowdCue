import { useEffect, useState } from 'react';
import { z } from 'zod';

const statusSchema = z.object({
  enabled: z.boolean(),
  authenticated: z.boolean(),
  connected: z.boolean(),
  displayName: z.string().nullable().optional(),
  error: z
    .enum(['reauthenticate', 'rate_limited', 'unavailable', 'permissions'])
    .optional(),
});
type ConnectionStatus = z.infer<typeof statusSchema>;
const messages: Record<string, string> = {
  denied: 'Spotify connection was cancelled. You can try again.',
  invalid_state: 'This connection attempt expired. Please try again.',
  failed: 'Unable to connect Spotify. Please try again.',
  reauthenticate: 'Please reconnect Spotify to continue.',
  permissions: 'Spotify permissions are missing. Please reconnect.',
  rate_limited: 'Spotify is busy. Please try again shortly.',
  unavailable: 'Spotify is unavailable. Please try again.',
};

export function SpotifyConnection({
  onAuthenticationChange,
}: { onAuthenticationChange?: (authenticated: boolean) => void } = {}) {
  const [connection, setConnection] = useState<ConnectionStatus>();
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [signingOut, setSigningOut] = useState(false);
  const [feedback, setFeedback] = useState<string | undefined>(
    () =>
      messages[
        new URLSearchParams(window.location.search).get('spotify') || ''
      ],
  );
  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.has('spotify')) {
      url.searchParams.delete('spotify');
      window.history.replaceState(
        null,
        '',
        url.pathname + url.search + url.hash,
      );
    }
    const controller = new AbortController();
    async function check() {
      setFailed(false);
      try {
        const response = await fetch('/api/auth/spotify/status', {
          signal: controller.signal,
          credentials: 'same-origin',
        });
        if (!response.ok) throw new Error('Unavailable');
        const status = statusSchema.parse(await response.json());
        if (!controller.signal.aborted) {
          setConnection(status);
          onAuthenticationChange?.(status.authenticated);
        }
      } catch {
        if (!controller.signal.aborted) {
          setFailed(true);
          onAuthenticationChange?.(false);
        }
      }
    }
    void check();
    return () => controller.abort();
  }, [attempt, onAuthenticationChange]);
  async function signOut() {
    setSigningOut(true);
    try {
      const response = await fetch('/api/auth/logout', {
        method: 'POST',
        credentials: 'same-origin',
      });
      if (!response.ok) throw new Error('Unavailable');
      setConnection({ enabled: true, authenticated: false, connected: false });
      onAuthenticationChange?.(false);
      setFeedback(undefined);
    } catch {
      setFeedback('Unable to sign out. Please try again.');
    } finally {
      setSigningOut(false);
    }
  }
  return (
    <section className="spotify-connection" aria-label="Spotify connection">
      {feedback && <p aria-live="polite">{feedback}</p>}
      {failed ? (
        <>
          <p aria-live="polite">Unable to check Spotify. Please try again.</p>
          <button
            type="button"
            onClick={() => setAttempt((value) => value + 1)}
          >
            Try again
          </button>
        </>
      ) : !connection ? (
        <p aria-live="polite">Checking Spotify connection…</p>
      ) : !connection.enabled ? (
        <>
          <p>Spotify connection is not available yet.</p>
          <button type="button" disabled>
            Connect Spotify
          </button>
        </>
      ) : (
        <>
          <p aria-live="polite">
            {connection.connected
              ? `Spotify connected${connection.displayName ? ` as ${connection.displayName}` : ''}.`
              : connection.error
                ? messages[connection.error]
                : 'Connect Spotify to host your party.'}
          </p>
          {!connection.connected && (
            <form method="post" action="/api/auth/spotify/login">
              <button type="submit">
                {connection.authenticated
                  ? 'Reconnect Spotify'
                  : 'Connect Spotify'}
              </button>
            </form>
          )}
          {connection.authenticated && (
            <button
              type="button"
              className="secondary"
              disabled={signingOut}
              onClick={() => void signOut()}
            >
              {signingOut ? 'Signing out…' : 'Sign out'}
            </button>
          )}
        </>
      )}
    </section>
  );
}
