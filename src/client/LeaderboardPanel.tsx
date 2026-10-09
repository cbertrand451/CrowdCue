import { LoadingButton, LoadingStatus } from './LoadingButton';
import { useEffect, useState } from 'react';
import {
  leaderboardSchema,
  type Leaderboard,
} from '../server/leaderboard/contracts.js';
import { useLiveRevision } from './realtime';

export function LeaderboardPanel({
  token,
  role,
  refresh = 0,
  onExpired,
}: {
  token: string;
  role: 'guest' | 'admin';
  refresh?: number;
  onExpired: () => void;
}) {
  const revision = useLiveRevision();
  const [leaderboard, setLeaderboard] = useState<Leaderboard>();
  const [refreshBusy, setRefreshBusy] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [error, setError] = useState<string>();
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function load() {
      try {
        const response = await fetch(
          `/api/party-links/${role}/${encodeURIComponent(token)}/leaderboard`,
          {
            credentials: 'same-origin',
            signal: controller.signal,
          },
        );
        if (controller.signal.aborted) return;
        if (!response.ok) {
          if (response.status === 401 || response.status === 404)
            setLeaderboard(undefined);
          if (response.status === 401) onExpired();
          throw new Error('Unavailable');
        }
        const data = leaderboardSchema.parse(await response.json());
        if (!controller.signal.aborted) {
          setLeaderboard(data);
          setError(undefined);
        }
      } catch {
        if (!controller.signal.aborted)
          setError('Unable to load leaderboard. Try refreshing it.');
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
  }, [token, role, refresh, attempt, revision, onExpired]);
  return (
    <section aria-label="Party leaderboard" className="request-board">
      <div className="section-heading">
        <h2>Guest leaderboard</h2>
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
          {refreshBusy ? <>Refreshing…</> : 'Refresh leaderboard'}
        </LoadingButton>
      </div>
      <p className="muted">
        Earn 5 points when your song is observed playing, plus 1 point for each
        vote from another guest on an approved, queued or played request.
        Self-votes and rejected or removed requests earn no vote points.
        Removing a vote removes its point.
      </p>
      {error && <p role="alert">{error}</p>}
      {!leaderboard && !error && (
        <LoadingStatus>Loading leaderboard…</LoadingStatus>
      )}
      {leaderboard && (
        <>
          {leaderboard.status === 'ENDED' && (
            <p className="muted">Final party leaderboard</p>
          )}
          {leaderboard.yourEntry && (
            <p className="ready">
              Your score: {leaderboard.yourEntry.points} points · Rank{' '}
              {leaderboard.yourEntry.rank}
            </p>
          )}
          {!leaderboard.entries.length ? (
            <p>No guests have joined yet.</p>
          ) : (
            <ol className="leaderboard-list">
              {leaderboard.entries.map((entry, index) => (
                <li
                  key={index}
                  className={entry.isYou ? 'leaderboard-you' : undefined}
                >
                  <span className="queue-position">{entry.rank}</span>
                  <div>
                    <strong>
                      {entry.name}
                      {entry.isYou ? ' (you)' : ''}
                    </strong>
                    <p>
                      {entry.songsObserved}{' '}
                      {entry.songsObserved === 1 ? 'song' : 'songs'} observed ·{' '}
                      {entry.votesReceived}{' '}
                      {entry.votesReceived === 1 ? 'vote' : 'votes'} received
                    </p>
                  </div>
                  <strong>{entry.points} pts</strong>
                </li>
              ))}
            </ol>
          )}
          {leaderboard.participants > 50 && (
            <p className="muted">
              Showing the first 50 of {leaderboard.participants} guest sessions.
              Your score remains above even if you are outside the list.
            </p>
          )}
          <p className="muted">
            Tied scores share a rank. Points belong to this party’s guest
            session and never affect the song queue. Playback observations do
            not prove a full listen.
          </p>
        </>
      )}
    </section>
  );
}
