import { useEffect, useState } from 'react';
import {
  queueSnapshotSchema,
  type QueueSnapshot,
} from '../server/queue/contracts.js';
export function QueueBoard({
  role,
  token,
  refresh = 0,
  onExpired,
}: {
  role: 'guest' | 'admin';
  token: string;
  refresh?: number;
  onExpired?: () => void;
}) {
  const [snapshot, setSnapshot] = useState<QueueSnapshot>();
  const [offset, setOffset] = useState(0);
  const [attempt, setAttempt] = useState(0);
  const [error, setError] = useState<string>();
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function load() {
      try {
        const response = await fetch(
          `/api/party-links/${role}/${encodeURIComponent(token)}/queue?offset=${offset}`,
          { credentials: 'same-origin', signal: controller.signal },
        );
        if (controller.signal.aborted) return;
        if (!response.ok) {
          if (response.status === 401 || response.status === 404)
            setSnapshot(undefined);
          if (response.status === 401) onExpired?.();
          throw new Error('Unavailable');
        }
        const result = queueSnapshotSchema.parse(await response.json());
        if (!controller.signal.aborted) {
          setSnapshot(result);
          setError(undefined);
        }
      } catch {
        if (!controller.signal.aborted)
          setError('Unable to load the queue. Try refreshing it.');
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
  }, [role, token, refresh, offset, attempt, onExpired]);
  return (
    <section className="request-board" aria-label="CrowdCue queue">
      <div className="section-heading">
        <h2>CrowdCue queue</h2>
        <button
          type="button"
          className="secondary"
          onClick={() => setAttempt((value) => value + 1)}
        >
          Refresh queue
        </button>
      </div>
      {error && <p role="alert">{error}</p>}
      {!snapshot && !error && <p role="status">Loading queue…</p>}
      {snapshot && (
        <>
          <p className="muted">
            {snapshot.votingEnabled
              ? 'Most votes first. Earlier requests win ties.'
              : 'Voting is off. Earlier requests play first.'}
          </p>
          {snapshot.status === 'ENDED' && (
            <p className="muted">
              This party has ended. Its saved queue is read-only.
            </p>
          )}
          {snapshot.items.length === 0 && (
            <p>
              {offset === 0
                ? 'No approved songs waiting. Requests awaiting approval stay in the request list.'
                : 'No songs on this page. Return to the front of the queue.'}
            </p>
          )}
          <ol
            className="search-results queue-results"
            start={snapshot.items[0]?.position ?? offset + 1}
          >
            {snapshot.items.map(({ position, request }) => (
              <li key={request.id}>
                <span
                  className="queue-position"
                  aria-label={`Queue position ${position}`}
                >
                  {position}
                </span>
                <div className="track-details">
                  <a
                    href={request.track.spotifyUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {request.track.title}
                  </a>
                  <p>{request.track.artists.join(', ')}</p>
                  <p className="muted">{request.track.album}</p>
                  <p>
                    {request.voteCount}{' '}
                    {request.voteCount === 1 ? 'vote' : 'votes'} ·{' '}
                    {Math.floor(request.track.durationMs / 60000)}:
                    {String(
                      Math.floor(request.track.durationMs / 1000) % 60,
                    ).padStart(2, '0')}
                  </p>
                  {position === 1 && snapshot.status === 'ACTIVE' && (
                    <p className="ready">First in CrowdCue</p>
                  )}
                </div>
              </li>
            ))}
          </ol>
          <div className="party-actions">
            {offset > 0 && (
              <button
                type="button"
                className="secondary"
                onClick={() => setOffset(Math.max(0, offset - 50))}
              >
                Previous queue page
              </button>
            )}
            {snapshot.nextOffset !== null && (
              <button
                type="button"
                className="secondary"
                onClick={() => setOffset(snapshot.nextOffset!)}
              >
                Next queue page
              </button>
            )}
          </div>
        </>
      )}
      <p className="muted">
        Approved songs reorder as votes change. Sending them to Spotify is
        coming next.
      </p>
    </section>
  );
}
