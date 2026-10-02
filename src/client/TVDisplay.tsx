import { GuestQRCode } from './GuestQRCode';
import { useEffect, useRef, useState } from 'react';
import {
  displaySnapshotSchema,
  type DisplaySnapshot,
} from '../server/display/contracts.js';
import { usePartyRealtime } from './realtime';

function duration(ms: number) {
  return `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}`;
}
function Artwork({
  url,
  album,
  className = '',
}: {
  url: string | null;
  album: string;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  let safe = false;
  try {
    const parsed = new URL(url ?? '');
    safe =
      parsed.protocol === 'https:' &&
      !parsed.username &&
      !parsed.password &&
      (parsed.hostname === 'i.scdn.co' ||
        parsed.hostname.endsWith('.spotifycdn.com'));
  } catch {
    /* Missing artwork uses a neutral placeholder. */
  }
  return safe && !failed ? (
    <img
      className={className}
      src={url!}
      alt={`${album} album artwork`}
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
    />
  ) : (
    <div
      className={`tv-artwork-placeholder ${className}`}
      aria-label="Album artwork unavailable"
    >
      <span aria-hidden="true">♫</span>
    </div>
  );
}
export function TVDisplay({ token }: { token: string }) {
  const { revision, connected } = usePartyRealtime('display', token);
  const [snapshot, setSnapshot] = useState<DisplaySnapshot>();
  const [error, setError] = useState<string>();
  const [attempt, setAttempt] = useState(0);
  const [clock, setClock] = useState(Date.now);
  const [fullscreen, setFullscreen] = useState(false);
  const [screenError, setScreenError] = useState<string>();
  const fullscreenBusy = useRef(false);
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function load() {
      try {
        const response = await fetch(
          `/api/party-links/display/${encodeURIComponent(token)}/snapshot`,
          { credentials: 'same-origin', signal: controller.signal },
        );
        if (controller.signal.aborted) return;
        if (!response.ok) {
          if (response.status === 404) {
            setSnapshot(undefined);
            setError('Display not found. Ask the host for the display link.');
            return;
          }
          throw Error('Unavailable');
        }
        const result = displaySnapshotSchema.parse(await response.json());
        if (!controller.signal.aborted) {
          setSnapshot(result);
          setClock(Date.now());
          setError(undefined);
        }
      } catch {
        if (!controller.signal.aborted)
          setError('Connection interrupted. Reconnecting to the party…');
      } finally {
        if (!controller.signal.aborted)
          timer = setTimeout(() => void load(), 5000);
      }
    }
    void load();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [token, revision, attempt]);
  useEffect(() => {
    const timer = setInterval(() => setClock(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    const changed = () => setFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', changed);
    return () => document.removeEventListener('fullscreenchange', changed);
  }, []);
  async function toggleFullscreen() {
    if (fullscreenBusy.current) return;
    fullscreenBusy.current = true;
    setScreenError(undefined);
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch {
      setScreenError(
        'Full screen is unavailable. Use your browser’s full-screen option.',
      );
    } finally {
      fullscreenBusy.current = false;
    }
  }
  const ended = snapshot?.party.status === 'ENDED';
  const now = snapshot?.nowPlaying;
  const track = now?.track;
  const elapsed = now?.observedAt
    ? Math.max(0, clock - Date.parse(now.observedAt))
    : 0;
  const stale = !!now?.observedAt && elapsed > 20000;
  const unavailable = now?.state === 'UNAVAILABLE' || stale;
  const progress =
    track && now?.progressMs != null
      ? Math.min(
          track.durationMs,
          now.progressMs +
            (now.state === 'PLAYING' && !ended ? Math.min(elapsed, 20000) : 0),
        )
      : null;
  const label = ended
    ? 'Party complete'
    : unavailable
      ? 'Last seen on Spotify'
      : now?.state === 'PAUSED'
        ? 'Paused on Spotify'
        : now?.state === 'PLAYING'
          ? 'Now playing on Spotify'
          : 'Waiting for music';
  return (
    <main className="tv-display">
      <header className="tv-header">
        <p className="tv-brand">
          CrowdCue<span>Good music. Together.</span>
        </p>
        <h1>{snapshot?.party.name ?? 'Your party, on screen'}</h1>
        {typeof document.documentElement.requestFullscreen === 'function' && (
          <button
            className="secondary tv-fullscreen"
            type="button"
            onClick={() => void toggleFullscreen()}
          >
            {fullscreen ? 'Exit full screen' : 'Full screen'}
          </button>
        )}
      </header>
      {!snapshot && !error && (
        <p className="tv-loading" role="status">
          Getting the party ready…
        </p>
      )}
      {snapshot && (
        <div className="tv-content">
          <section className="tv-now" aria-label="Now playing">
            <p className="tv-eyebrow">{label}</p>
            {ended ? (
              <div className="tv-empty">
                <span aria-hidden="true">♫</span>
                <h2>Thanks for the good music.</h2>
                <p>Spotify playback stays with the host.</p>
              </div>
            ) : track ? (
              <>
                <div className="tv-current-track">
                  <Artwork
                    key={`${track.id}:${track.artworkUrl}`}
                    className="tv-cover"
                    url={track.artworkUrl}
                    album={track.album}
                  />
                  <div className="tv-current-details">
                    <h2>{track.title}</h2>
                    <p className="tv-artists">{track.artists.join(', ')}</p>
                    <p className="tv-album">
                      {track.album}
                      {track.explicit ? ' · Explicit' : ''}
                    </p>
                  </div>
                </div>
                {progress != null && track.durationMs > 0 && (
                  <div className="tv-progress">
                    <progress
                      aria-label="Song progress"
                      value={progress}
                      max={track.durationMs}
                    />
                    <div>
                      <span>{duration(progress)}</span>
                      <span>{duration(track.durationMs)}</span>
                    </div>
                  </div>
                )}
                {unavailable && (
                  <p className="tv-notice" role="status">
                    Playback updates delayed. Showing the last observed song.
                  </p>
                )}
              </>
            ) : (
              <div className="tv-empty">
                <span aria-hidden="true">♫</span>
                <h2>
                  {unavailable
                    ? 'Waiting for Spotify updates'
                    : now?.state === 'PLAYING'
                      ? 'Playing in Spotify'
                      : now?.state === 'PAUSED'
                        ? 'Spotify is paused'
                        : 'Ready when you are'}
                </h2>
                <p>
                  {unavailable
                    ? 'The queue is saved. Updates will resume when Spotify reconnects.'
                    : now?.state === 'PLAYING'
                      ? 'Track details aren’t available for this song.'
                      : 'The host starts the music in Spotify. You help choose what comes next.'}
                </p>
              </div>
            )}
          </section>
          <section className="tv-queue" aria-label="Upcoming songs">
            <div className="tv-queue-heading">
              <h2>{ended ? 'Saved queue' : 'Up next'}</h2>
              <span>
                {snapshot.queue.length
                  ? 'CrowdCue queue'
                  : 'Your requests go here'}
              </span>
            </div>
            {snapshot.queue.length ? (
              <ol>
                {snapshot.queue.map((item) => (
                  <li key={`${item.position}:${item.track.id}`}>
                    <span className="tv-position">
                      {String(item.position).padStart(2, '0')}
                    </span>
                    <Artwork
                      key={item.track.artworkUrl}
                      className="tv-queue-cover"
                      url={item.track.artworkUrl}
                      album={item.track.album}
                    />
                    <div className="tv-queue-track">
                      <div className="tv-queue-row-title">
                        <h3>{item.track.title}</h3>
                        {item.locked && <strong>Locked</strong>}
                      </div>
                      <div className="tv-queue-row-subtitle">
                        <p>{item.track.artists.join(', ')}</p>
                        <span>
                          {item.source === 'BACKUP'
                            ? 'Backup playlist'
                            : snapshot.votingEnabled
                              ? `${item.voteCount} ${item.voteCount === 1 ? 'vote' : 'votes'}`
                              : 'Guest request'}
                        </span>
                      </div>
                    </div>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="tv-queue-empty">
                {ended
                  ? 'No songs were left waiting.'
                  : 'Make a request from your phone. Approved songs appear here.'}
              </p>
            )}
            {snapshot.hasMore && (
              <p className="tv-queue-note">
                More songs are waiting. See the full queue on your phone.
              </p>
            )}
            {!ended && snapshot.pendingCount > 0 && (
              <p className="tv-queue-note">
                {snapshot.pendingCount}{' '}
                {snapshot.pendingCount === 1
                  ? 'request awaits'
                  : 'requests await'}{' '}
                host approval.
              </p>
            )}
          </section>
        </div>
      )}
      {snapshot && (
        <footer className="tv-footer">
          <div className="tv-invite">
            {!ended && <GuestQRCode url={snapshot.party.guestUrl} />}
            <div className="tv-join">
              <h2>
                {ended ? 'This party has ended.' : 'Join from your phone'}
              </h2>
              <p>
                {ended
                  ? 'Ask the host for the next one.'
                  : 'Scan the QR code. Request a song. Vote for your favorites.'}
              </p>
              {!ended && (
                <a href={snapshot.party.guestUrl} rel="noreferrer">
                  {snapshot.party.guestUrl.replace(/^https?:\/\//, '')}
                </a>
              )}
            </div>
          </div>
          <p className="tv-connection" role="status">
            {connected
              ? 'Live updates connected.'
              : 'Live updates reconnecting. Checking for changes periodically.'}
          </p>
        </footer>
      )}
      {(error || screenError) && (
        <div className="tv-error" role="alert">
          <p>{error ?? screenError}</p>
          {error && (
            <button
              className="secondary"
              type="button"
              onClick={() => setAttempt((value) => value + 1)}
            >
              Try again
            </button>
          )}
        </div>
      )}
    </main>
  );
}
