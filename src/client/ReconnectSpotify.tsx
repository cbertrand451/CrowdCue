import { useEffect, useRef, useState } from 'react';
import { authorizationStartSchema } from '../server/auth/contracts.js';
import { LoadingButton } from './LoadingButton';
export function ReconnectSpotify() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const pending = useRef(false);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  async function connect() {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError(false);
    const c = new AbortController();
    controller.current = c;
    try {
      const response = await fetch('/api/auth/spotify/login', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { accept: 'application/json' },
        signal: c.signal,
      });
      if (!response.ok) throw new Error();
      const result = authorizationStartSchema.parse(await response.json());
      if (!c.signal.aborted) window.location.assign(result.authorizationUrl);
    } catch {
      if (!c.signal.aborted) {
        setBusy(false);
        setError(true);
        pending.current = false;
      }
    }
  }
  return (
    <div>
      <LoadingButton loading={busy} onClick={() => void connect()}>
        Reconnect Spotify
      </LoadingButton>
      {error && (
        <p role="status">Could not reconnect. Please try again shortly.</p>
      )}
    </div>
  );
}
