import { z } from 'zod';
import { SessionHelp } from './SessionHelp';
import { OnboardingChecklist } from './OnboardingChecklist';
import { LoadingButton, LoadingStatus } from './LoadingButton';
import { useLiveRevision } from './realtime';
import { useEffect, useRef, useState } from 'react';
import {
  playbackStatusSchema,
  type PlaybackStatus,
} from '../server/playback/contracts.js';
const failureSchema = z.object({
  error: z.string().optional(),
  code: playbackStatusSchema.shape.error.optional(),
  retryAfter: z.number().positive().nullable().optional(),
});
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
  onConfigureBackup,
}: {
  token: string;
  active: boolean;
  refresh?: number;
  onExpired: () => void;
  onConfigureBackup?: () => void;
}) {
  const liveRevision = useLiveRevision();
  const [status, setStatus] = useState<PlaybackStatus>();
  const [refreshBusy, setRefreshBusy] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [error, setError] = useState<string>();
  const [actionError, setActionError] = useState<string>();
  const [diagnostic, setDiagnostic] = useState<{
    code?: PlaybackStatus['error'];
    httpStatus?: number;
    retryAfter?: number;
  }>({});
  const [busy, setBusy] = useState<string>();
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
          const failure = failureSchema.parse(await response.json());
          if (!c.signal.aborted)
            setError(failure.error ?? 'Unable to load Spotify session status.');
          return;
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
        if (!c.signal.aborted) setRefreshBusy(false);
        if (!c.signal.aborted) timer = setTimeout(() => void load(), 5000);
      }
    };
    void load();
    return () => {
      c.abort();
      clearTimeout(timer);
    };
  }, [token, active, refresh, attempt, onExpired, liveRevision]);
  async function action(body: {
    action: string;
    name?: string;
    description?: string;
    confirm?: boolean;
  }) {
    if (pending.current) return;
    pending.current = true;
    setBusy(body.action);
    setActionError(undefined);
    setDiagnostic({});
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
        const data = failureSchema.parse(await response.json());
        setDiagnostic({
          code: data.code,
          httpStatus: response.status,
          retryAfter: data.retryAfter ?? undefined,
        });
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
      if (!c?.signal.aborted) {
        setActionError(
          'Could not confirm the action. Refresh the status before retrying.',
        );
        setAttempt((x) => x + 1);
      }
    } finally {
      pending.current = false;
      if (!c?.signal.aborted) setBusy(undefined);
    }
  }
  return (
    <section
      aria-label={active ? 'Spotify session' : 'Session summary'}
      className="request-board"
    >
      <div className="section-heading">
        <h2>{active ? 'Spotify session' : 'Session summary'}</h2>
        <LoadingButton
          loading={refreshBusy}
          type="button"
          className="secondary session-refresh"
          disabled={refreshBusy}
          aria-busy={refreshBusy}
          onClick={() => {
            setRefreshBusy(true);
            setAttempt((v) => v + 1);
          }}
        >
          {refreshBusy ? <>Refreshing…</> : 'Refresh Spotify status'}
        </LoadingButton>
      </div>
      {busy && <LoadingStatus>Updating Spotify session…</LoadingStatus>}
      {(actionError || error) && <p role="alert">{actionError ?? error}</p>}
      {!status && error && (
        <p className="muted">
          Check your internet connection and sign in as this party’s host. If
          Spotify session playback is not configured, the app owner must check
          the Spotify and database configuration. Use Refresh Spotify status to
          check again.
        </p>
      )}
      {!status && !error && (
        <LoadingStatus>Loading Spotify session…</LoadingStatus>
      )}
      {status && (
        <>
          {active && (
            <OnboardingChecklist
              steps={[
                {
                  id: 'backup',
                  title: 'Load a backup playlist',
                  isCompleted: status.backupTrackCount > 0,
                  onAction: onConfigureBackup,
                },
                {
                  id: 'session',
                  title: 'Start the session',
                  isCompleted: status.enabled,
                  onAction: () =>
                    document
                      .querySelector<HTMLElement>('.session-start')
                      ?.focus(),
                },
                {
                  id: 'playlist',
                  title: 'Create the session playlist',
                  isCompleted: !!status.playlistUrl,
                  onAction: () =>
                    (
                      document.querySelector<HTMLElement>('.session-start') ??
                      document.querySelector<HTMLElement>(
                        '.playlist-launch a',
                      ) ??
                      document.querySelector<HTMLElement>('.session-refresh')
                    )?.focus(),
                },
              ]}
            />
          )}

          {active && status.enabled && (
            <p
              role="status"
              className={
                status.playlistUrl && status.syncedAt && !status.error
                  ? 'ready'
                  : undefined
              }
            >
              {status.playlistUrl
                ? status.error
                  ? 'Session playlist created. Spotify synchronization needs attention; you can open the playlist below.'
                  : status.syncedAt
                    ? 'Session playlist ready — open it below and press Play in Spotify.'
                    : 'Session playlist created. CrowdCue is preparing its songs.'
                : status.creation === 'UNKNOWN' ||
                    status.creation === 'CREATING'
                  ? 'Checking whether Spotify created your session playlist. The link will appear here automatically once confirmed.'
                  : status.error
                    ? 'Session playlist creation has not been confirmed. Retry Spotify sync to try again.'
                    : 'Waiting for Spotify to create your session playlist. The link will appear here automatically once confirmed.'}
            </p>
          )}
          {status.playlistUrl && (
            <p className="playlist-launch">
              <a href={status.playlistUrl} target="_blank" rel="noreferrer">
                <span aria-hidden="true">↗</span> Open session playlist in
                Spotify
              </a>
            </p>
          )}
          {status.error && <p role="status">{errors[status.error]}</p>}
          {active && status.enabled && !status.playlistUrl && (
            <p className="muted">
              No session playlist link is available yet. Status updates
              automatically every five seconds. The backup source below is a
              separate playlist.
            </p>
          )}
          <p>
            {status.lockedCount} songs committed · {status.guestCount} guest
            songs · {status.backupCount} backup songs
          </p>
          {status.playlistUrl && (
            <p className="muted">
              Open the session playlist in Spotify and press Play. Turn off
              Shuffle, Smart Shuffle and Repeat. Current and the next two songs
              are locked for everyone in CrowdCue; use Spotify itself to skip.
            </p>
          )}
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
                <LoadingButton
                  loading={busy === 'refresh-backup'}
                  type="button"
                  className="secondary"
                  disabled={!!busy}
                  onClick={() => void action({ action: 'refresh-backup' })}
                >
                  Check / refresh backup playlist
                </LoadingButton>
              )}
              <p className="muted">
                Refresh uses updated playlist contents for future refills.
                Current and the next two songs stay locked. Unlocked backup
                songs can give way to guest requests.
              </p>
            </div>
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
                  <LoadingButton
                    className="session-start"
                    loading={busy === 'start'}
                    type="button"
                    disabled={!!busy}
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
                  </LoadingButton>
                </>
              )}
              {status.error && (
                <LoadingButton
                  loading={busy === 'retry'}
                  type="button"
                  className="secondary"
                  disabled={!!busy}
                  onClick={() => void action({ action: 'retry' })}
                >
                  Retry Spotify sync
                </LoadingButton>
              )}
              {status.error && (
                <p className="muted">
                  Retry asks the background worker to resume synchronization.
                  Refresh Spotify status only checks progress; refreshing the
                  backup source only reloads its songs.
                </p>
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
                  <LoadingButton
                    loading={busy === 'recreate'}
                    type="button"
                    disabled={!!busy || !recreate}
                    onClick={() =>
                      void action({ action: 'recreate', confirm: true })
                    }
                  >
                    Confirm replacement
                  </LoadingButton>
                </>
              )}
            </>
          )}
          {active && (
            <SessionHelp
              status={status}
              failed={!!(actionError || error)}
              {...diagnostic}
              onConfigureBackup={onConfigureBackup}
            />
          )}
          {!active && status.playlistUrl && (
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
