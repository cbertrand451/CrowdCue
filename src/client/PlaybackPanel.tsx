import { useEffect, useRef, useState } from 'react';
import {
  playbackStatusSchema,
  type PlaybackStatus,
} from '../server/playback/contracts.js';
const errors: Record<NonNullable<PlaybackStatus['error']>, string> = {
  reauthenticate: 'Reconnect Spotify to continue.',
  permissions:
    'Spotify declined access. Check the host’s Premium account and reconnect with the session permissions.',
  rate_limited:
    'Spotify asked us to wait. Synchronization will retry after its cooldown.',
  unavailable:
    'Spotify synchronization is interrupted. Your queue and song history are saved.',
  no_active_device:
    'Start music in Spotify on your usual speaker or device to continue.',
  queue_unknown:
    'Spotify may already have received the locked song. CrowdCue will not resend it. Use playlist recovery if playback does not advance.',
  creation_unknown:
    'Spotify may have created the nightly playlist. CrowdCue is checking your library before creating another.',
  backup_empty:
    'The backup playlist has no playable songs allowed by your settings.',
  backup_required: 'Add a backup Spotify playlist in party settings.',
  too_many_tracks:
    'This session exceeded the supported 10,000-song playlist size.',
};
export function PlaybackPanel({
  token,
  active,
  refresh = 0,
  onExpired,
}: {
  token: string;
  active: boolean;
  refresh?: number;
  onExpired: () => void;
}) {
  const [status, setStatus] = useState<PlaybackStatus>();
  const [attempt, setAttempt] = useState(0);
  const [error, setError] = useState<string>();
  const [actionError, setActionError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [closeSave, setCloseSave] = useState('no');
  const [clearQueue, setClearQueue] = useState(false);
  const [recreate, setRecreate] = useState(false);
  const pending = useRef(false);
  const mutation = useRef<AbortController | null>(null);
  useEffect(() => {
    const c = new AbortController();
    mutation.current = c;
    return () => c.abort();
  }, [token]);
  useEffect(() => {
    const c = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const load = async () => {
      try {
        const response = await fetch(
          `/api/party-links/admin/${encodeURIComponent(token)}/playback`,
          { credentials: 'same-origin', signal: c.signal },
        );
        if (c.signal.aborted) return;
        if (!response.ok) {
          if (response.status === 401 || response.status === 404) {
            setStatus(undefined);
            onExpired();
          }
          throw new Error('Unavailable');
        }
        const data = playbackStatusSchema.parse(await response.json());
        if (!c.signal.aborted) {
          setStatus(data);
          setError(undefined);
        }
      } catch {
        if (!c.signal.aborted)
          setError('Unable to load Spotify session status.');
      } finally {
        if (!c.signal.aborted) timer = setTimeout(() => void load(), 5000);
      }
    };
    void load();
    return () => {
      c.abort();
      clearTimeout(timer);
    };
  }, [token, active, refresh, attempt, onExpired]);
  async function action(body: unknown) {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setActionError(undefined);
    const c = mutation.current;
    try {
      const response = await fetch(
        `/api/party-links/admin/${encodeURIComponent(token)}/playback`,
        {
          method: 'POST',
          credentials: 'same-origin',
          signal: c?.signal,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        },
      );
      if (c?.signal.aborted) return;
      if (!response.ok) {
        if (response.status === 401 || response.status === 404) {
          setStatus(undefined);
          onExpired();
          return;
        }
        const data = (await response.json()) as { error?: string };
        setActionError(
          data.error ??
            'Could not confirm the action. Refresh the status before retrying.',
        );
        setAttempt((x) => x + 1);
        return;
      }
      setStatus(playbackStatusSchema.parse(await response.json()));
      setAttempt((x) => x + 1);
      setRecreate(false);
    } catch {
      if (!c?.signal.aborted)
        setActionError(
          'Could not confirm the action. Refresh the status before retrying.',
        );
    } finally {
      pending.current = false;
      if (!c?.signal.aborted) setBusy(false);
    }
  }
  return (
    <section
      aria-label={active ? 'Spotify session' : 'Session summary'}
      className="request-board"
    >
      <div className="section-heading">
        <h2>{active ? 'Spotify session' : 'Session summary'}</h2>
        <button
          type="button"
          className="secondary"
          onClick={() => setAttempt((x) => x + 1)}
        >
          Refresh Spotify status
        </button>
      </div>
      {(actionError || error) && <p role="alert">{actionError ?? error}</p>}
      {!status && !error && <p role="status">Loading Spotify session…</p>}
      {status && (
        <>
          {status.error && <p role="status">{errors[status.error]}</p>}
          <p>
            {status.lockedCount} songs committed · {status.guestCount} guest
            songs · {status.backupCount} backup songs
          </p>
          <p className="muted">
            Locked songs are recorded even if the host skips them in Spotify.
          </p>
          {status.playlistUrl && (
            <p>
              <a href={status.playlistUrl} target="_blank" rel="noreferrer">
                Open nightly playlist in Spotify
              </a>
            </p>
          )}
          {status.syncedAt && (
            <p className="muted">
              Playlist last updated{' '}
              {new Date(status.syncedAt).toLocaleTimeString()}.
            </p>
          )}
          {active && (
            <>
              {!status.enabled && (
                <>
                  <p>
                    Start music in Spotify normally, then start the CrowdCue
                    queue.
                  </p>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void action({ action: 'start' })}
                  >
                    Start CrowdCue queue
                  </button>
                </>
              )}
              {status.enabled && (
                <p className="ready">
                  {status.mode === 'QUEUE'
                    ? 'Spotify queue enabled'
                    : 'Playlist recovery enabled'}
                </p>
              )}
              {status.error && (
                <button
                  type="button"
                  className="secondary"
                  disabled={busy}
                  onClick={() => void action({ action: 'retry' })}
                >
                  Retry Spotify sync
                </button>
              )}
              {status.playlistUrl && status.enabled && (
                <>
                  <h3>Playlist recovery</h3>
                  <p>
                    If queue delivery stops, use the nightly playlist. Clear any
                    remaining queued songs in Spotify first; this action starts
                    the playlist at the latest locked song.
                  </p>
                  <label>
                    <input
                      type="checkbox"
                      checked={clearQueue}
                      onChange={(e) => setClearQueue(e.target.checked)}
                    />
                    I cleared pending songs in Spotify
                  </label>
                  <button
                    type="button"
                    className="secondary"
                    disabled={busy || !clearQueue}
                    onClick={() =>
                      void action({ action: 'fallback', confirm: true })
                    }
                  >
                    Start playlist recovery
                  </button>
                  {status.mode === 'PLAYLIST' && (
                    <p className="muted">
                      New guest requests keep updating this playlist. Spotify
                      controls playback; changing the playlist may not
                      immediately change its current playback order.
                    </p>
                  )}
                </>
              )}
              {status.creation === 'UNKNOWN' && (
                <>
                  <p>
                    Check your Spotify library before replacing the nightly
                    playlist. A replacement may leave an extra empty playlist.
                  </p>
                  <label>
                    <input
                      type="checkbox"
                      checked={recreate}
                      onChange={(e) => setRecreate(e.target.checked)}
                    />
                    Create a replacement playlist
                  </label>
                  <button
                    type="button"
                    disabled={busy || !recreate}
                    onClick={() =>
                      void action({ action: 'recreate', confirm: true })
                    }
                  >
                    Confirm replacement
                  </button>
                </>
              )}
            </>
          )}
          {!active && (
            <>
              {!status.closeDecided && (
                <>
                  <label>
                    Save the nightly playlist?
                    <select
                      value={closeSave}
                      onChange={(e) => setCloseSave(e.target.value)}
                    >
                      <option value="no">No</option>
                      <option value="yes">Yes</option>
                    </select>
                  </label>
                  <p>
                    {status.saveAtCreation
                      ? 'You chose Yes at creation, so this playlist will be kept either way.'
                      : 'If you choose No again, CrowdCue clears the temporary playlist and removes it from your Spotify library.'}
                  </p>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      void action({
                        action: 'close',
                        save: closeSave === 'yes',
                      })
                    }
                  >
                    Finish session summary
                  </button>
                </>
              )}
              {status.closeDecided &&
                (status.saveAtCreation || status.saveAtClose) && (
                  <p className="ready">The nightly playlist is saved.</p>
                )}
              {status.closeDecided &&
                !status.saveAtCreation &&
                !status.saveAtClose && (
                  <p>
                    {status.playlistRemoved
                      ? 'Temporary playlist cleared and removed from your Spotify library.'
                      : 'Removing the temporary playlist from your Spotify library…'}
                  </p>
                )}
            </>
          )}
        </>
      )}
    </section>
  );
}
