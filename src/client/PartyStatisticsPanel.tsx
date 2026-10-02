import { useEffect, useState } from 'react';
import {
  partyStatisticsSchema,
  type PartyStatistics,
} from '../server/statistics/contracts.js';
import { useLiveRevision } from './realtime';

export function PartyStatisticsPanel({
  token,
  onExpired,
}: {
  token: string;
  onExpired: () => void;
}) {
  const revision = useLiveRevision();
  const [statistics, setStatistics] = useState<PartyStatistics>();
  const [attempt, setAttempt] = useState(0);
  const [error, setError] = useState<string>();
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function load() {
      try {
        const response = await fetch(
          `/api/party-links/admin/${encodeURIComponent(token)}/statistics`,
          {
            credentials: 'same-origin',
            signal: controller.signal,
          },
        );
        if (controller.signal.aborted) return;
        if (!response.ok) {
          if (response.status === 401 || response.status === 404)
            setStatistics(undefined);
          if (response.status === 401) onExpired();
          throw new Error('Unavailable');
        }
        const data = partyStatisticsSchema.parse(await response.json());
        if (!controller.signal.aborted) {
          setStatistics(data);
          setError(undefined);
        }
      } catch {
        if (!controller.signal.aborted)
          setError('Unable to load party statistics. Try refreshing it.');
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
  }, [token, attempt, revision, onExpired]);
  return (
    <section aria-label="Party statistics" className="request-board">
      <div className="section-heading">
        <h2>Party statistics</h2>
        <button
          type="button"
          className="secondary"
          onClick={() => setAttempt((x) => x + 1)}
        >
          Refresh statistics
        </button>
      </div>
      {error && <p role="alert">{error}</p>}
      {!statistics && !error && <p role="status">Loading party statistics…</p>}
      {statistics && (
        <>
          <p className="muted">
            {statistics.status === 'ENDED'
              ? 'Final session summary'
              : 'Live session totals'}{' '}
            · Duration: {Math.floor(statistics.durationSeconds / 3600)}h{' '}
            {Math.floor(statistics.durationSeconds / 60) % 60}m
          </p>
          <dl className="party-statistics">
            {[
              ['Guest sessions joined', statistics.guestSessions],
              ['Song requests', statistics.requests.total],
              ['Current votes', statistics.votes],
              ['Guests with current votes', statistics.voters],
              ['Songs committed', statistics.committed.total],
              ['Guest songs committed', statistics.committed.guest],
              ['Backup songs committed', statistics.committed.backup],
              ['Songs observed playing', statistics.committed.observed],
            ].map(([label, value]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
          <h3>Request breakdown</h3>
          <dl className="party-statistics">
            {(
              [
                'pending',
                'approved',
                'queued',
                'played',
                'rejected',
                'removed',
              ] as const
            ).map((key) => (
              <div key={key}>
                <dt>
                  {key === 'played'
                    ? 'Departed playback'
                    : key.charAt(0).toUpperCase() + key.slice(1)}
                </dt>
                <dd>{statistics.requests[key]}</dd>
              </div>
            ))}
          </dl>
          <h3>Most-voted songs</h3>
          {statistics.topSongs.length ? (
            <ol className="statistics-ranking">
              {statistics.topSongs.map((song) => (
                <li key={song.spotifyTrackId}>
                  <a
                    href={`https://open.spotify.com/track/${song.spotifyTrackId}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {song.title}
                  </a>
                  <p>
                    {song.artist} · {song.votes}{' '}
                    {song.votes === 1 ? 'vote' : 'votes'}
                  </p>
                </li>
              ))}
            </ol>
          ) : (
            <p>No votes yet.</p>
          )}
          <p className="muted">
            Guest sessions can include the same person on different devices.
            Votes are currently retained votes, including moderated songs;
            removed votes are excluded. Repeated commitments count separately.
            Observed playback and departure do not confirm full listens.
          </p>
        </>
      )}
    </section>
  );
}
