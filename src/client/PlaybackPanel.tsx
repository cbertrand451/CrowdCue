import { useLiveRevision } from './realtime';
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
    'Spotify may have created the session playlist. CrowdCue is checking your library before creating another.',
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
  const liveRevision = useLiveRevision();
  const [status, setStatus] = useState<PlaybackStatus>();
  const [attempt, setAttempt] = useState(0);
  const [error, setError] = useState<string>();
  const [actionError, setActionError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [playlistName, setPlaylistName] = useState('');
  const [description, setDescription] = useState('');
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
  }, [token, active, refresh, attempt, onExpired, liveRevision]);
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
            Open the session playlist in Spotify and press Play. Turn off
            Shuffle, Smart Shuffle and Repeat. Current and next songs are locked
            for everyone in CrowdCue; use Spotify itself to skip.
          </p>
          {status.backupSourceUrl && (
            <div className="backup-source">
              <p>
                <a
                  href={status.backupSourceUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  Open backup source in Spotify
                </a>
              </p>
              <p className="muted">
                {status.backupTrackCount
                  ? `${status.backupTrackCount} usable songs loaded. Random backup songs fill gaps when guests have no songs waiting.`
                  : 'No usable backup songs loaded. Check the playlist after saving its link in settings.'}
              </p>
              {active && (
                <button
                  type="button"
                  className="secondary"
                  disabled={busy}
                  onClick={() => void action({ action: 'refresh-backup' })}
                >
                  Check / refresh backup playlist
                </button>
              )}
              <p className="muted">
                Refresh uses updated playlist contents for future refills.
                Current and next songs stay locked. Unlocked backup songs can
                give way to guest requests.
              </p>
            </div>
          )}
          {status.playlistUrl && (
            <p>
              <a href={status.playlistUrl} target="_blank" rel="noreferrer">
                Open session playlist in Spotify
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
                    Start the session to create your private playlist with three
                    random backup songs. Then open that playlist in Spotify and
                    press Play.
                  </p>
                  <label>
                    Session playlist name (defaults to party name)
                    <input
                      maxLength={100}
                      value={playlistName}
                      onChange={(e) => setPlaylistName(e.target.value)}
                    />
                  </label>
                  <label>
                    Playlist description
                    <textarea
                      maxLength={200}
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                    />
                  </label>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      void action({
                        action: 'start',
                        ...(playlistName.trim()
                          ? { name: playlistName.trim() }
                          : {}),
                        description: description.trim(),
                      })
                    }
                  >
                    Start session
                  </button>
                </>
              )}
              {status.enabled && (
                <p className="ready">
                  Session playlist enabled — current and next songs are locked;
                  at least two songs stay ahead.
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
              {status.creation === 'UNKNOWN' && (
                <>
                  <p>
                    Check your Spotify library before replacing the session
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
              <p className="ready">Your session playlist stays in Spotify.</p>
              <p>
                To delete it yourself, open the playlist in Spotify, open its
                three-dot menu, and choose Delete playlist (or Remove from your
                library). CrowdCue never deletes it.
              </p>
            </>
          )}
        </>
      )}
    </section>
  );
}
