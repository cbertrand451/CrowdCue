import type { PlaybackStatus } from '../server/playback/contracts.js';

const recovery: Record<NonNullable<PlaybackStatus['error']>, string[]> = {
  reauthenticate: [
    'Reconnect Spotify using Spotify connection on this page. Sign in with the account that owns this party and approve the requested permissions.',
  ],
  permissions: [
    'Reconnect Spotify and approve playlist read/write and playback-read access.',
    'If access is still denied, check your Spotify account eligibility and that the account is allowed to use the host’s Spotify app in development mode.',
  ],
  rate_limited: [
    'Wait for Spotify’s cooldown before retrying. Repeated clicks will not make Spotify accept the request sooner.',
  ],
  unavailable: [
    'Check your internet connection, then Refresh Spotify status to see whether the playlist was created.',
    'If a session is enabled, use Retry Spotify sync. If it is still not started, try Start session again after checking the status.',
  ],
  no_active_device: [
    'Open the session playlist in Spotify on your usual device or speaker and press Play, then refresh the status.',
  ],
  queue_unknown: [
    'Check the session playlist and current song in Spotify before retrying; the song may already have been submitted.',
  ],
  creation_unknown: [
    'Check your Spotify library for the session playlist and let CrowdCue check its status.',
    'Only use Confirm replacement after inspecting your library. A replacement may leave an extra playlist.',
  ],
  backup_empty: [
    'Open the backup playlist in Spotify and check that it contains songs playable by the host’s account.',
    'Check Allow explicit tracks in party settings if the source contains only explicit songs. Save changes, then Check / refresh backup playlist.',
  ],
  backup_required: [
    'Open party settings, paste a Spotify playlist link into Backup Spotify playlist, and save the settings.',
  ],
  too_many_tracks: [
    'End this session and create a new party; Spotify playlists support at most 10,000 songs in CrowdCue.',
  ],
};

export function SessionHelp({
  status,
  code,
  failed,
  httpStatus,
  retryAfter,
  onConfigureBackup,
}: {
  status: PlaybackStatus;
  code?: PlaybackStatus['error'];
  failed: boolean;
  httpStatus?: number;
  retryAfter?: number;
  onConfigureBackup?: () => void;
}) {
  const reason = code ?? status.error;
  const retryDate = status.retryAt ? new Date(status.retryAt) : null;
  return (
    <details className="session-help" open={failed || !!reason || undefined}>
      <summary>
        {failed || reason
          ? 'Session troubleshooting'
          : 'Before you start · setup help'}
      </summary>
      {reason && (
        <ol>
          {recovery[reason].map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
      )}
      {httpStatus === 409 && (
        <p>
          Read the message above: if another queue is active, open Your parties
          on the home page, open that party’s admin page and end its session. If
          synchronization is already in progress, wait for the next status
          update. If settings changed, check the saved backup source and retry.
        </p>
      )}
      {httpStatus === 403 && (
        <p>
          Open this party’s admin link from the CrowdCue home page on the same
          site where you signed in. Check Spotify connection if Spotify access
          was declined.
        </p>
      )}
      {(httpStatus === 429 || reason === 'rate_limited') && (
        <p>
          {retryDate && !Number.isNaN(retryDate.getTime())
            ? `Spotify will retry after ${retryDate.toLocaleTimeString()}.`
            : retryAfter
              ? `Wait at least ${retryAfter} seconds before retrying.`
              : 'Wait for the cooldown shown in session status, then refresh before retrying.'}
        </p>
      )}
      {failed && !reason && (
        <p>
          Refresh Spotify status before retrying: a failed response can arrive
          after Spotify has already created a playlist. If the status cannot be
          loaded, check your connection and sign in again as the party’s host.
        </p>
      )}
      <h3>Session startup checklist</h3>
      <ol>
        <li>
          Sign in with the Spotify account that owns this party. Reconnect if
          Spotify connection asks you to.
        </li>
        <li>
          Save a backup Spotify playlist in party settings. It must be readable
          by that account and contain playable songs allowed by your
          explicit-track setting.
        </li>
        <li>
          Choose Check / refresh backup playlist to verify the source. End any
          other active session on this Spotify account.
        </li>
        <li>
          Choose Start session and wait for the session playlist link. Creating
          the playlist does not start music: open it in Spotify and press Play.
          Turn off Shuffle, Smart Shuffle and Repeat.
        </li>
      </ol>
      <div className="active-party-actions">
        {onConfigureBackup && (
          <button
            type="button"
            className="secondary"
            onClick={onConfigureBackup}
          >
            Open party settings
          </button>
        )}
        <a href="/">Open Your parties</a>
      </div>
      <p className="muted">
        Refresh Spotify status checks progress; Retry Spotify sync resumes an
        enabled session; Check / refresh backup playlist reloads the source
        songs. Your queue and history stay saved when Spotify is unavailable.
      </p>
    </details>
  );
}
