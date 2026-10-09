import { WigglingCards } from './WigglingCards';
import { LoadingButton, LoadingStatus } from './LoadingButton';
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
  const [refreshBusy, setRefreshBusy] = useState(false);
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
        if (!controller.signal.aborted) setRefreshBusy(false);
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
        <LoadingButton
          loading={refreshBusy}
          type="button"
          className="secondary"
          disabled={refreshBusy}
          aria-busy={refreshBusy}
          onClick={() => {
            setRefreshBusy(true);
            setAttempt((v) => v + 1);
          }}
        >
          {refreshBusy ? <>Refreshing…</> : 'Refresh statistics'}
        </LoadingButton>
      </div>
      {error && <p role="alert">{error}</p>}
      {!statistics && !error && (
        <LoadingStatus>Loading party statistics…</LoadingStatus>
      )}
      {statistics && (
        <>
          <p className="muted">
            {statistics.status === 'ENDED'
              ? 'Final session summary'
              : 'Live session totals'}{' '}
            · Duration: {Math.floor(statistics.durationSeconds / 3600)}h{' '}
            {Math.floor(statistics.durationSeconds / 60) % 60}m
          </p>
          <WigglingCards
            cards={[
              {
                label: 'Guest sessions joined',
                value: statistics.guestSessions,
              },
              { label: 'Song requests', value: statistics.requests.total },
              { label: 'Current votes', value: statistics.votes },
              { label: 'Guests with current votes', value: statistics.voters },
              { label: 'Songs committed', value: statistics.committed.total },
              {
                label: 'Guest songs committed',
                value: statistics.committed.guest,
              },
              {
                label: 'Backup songs committed',
                value: statistics.committed.backup,
              },
              {
                label: 'Songs observed playing',
                value: statistics.committed.observed,
              },
            ]}
          />
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
