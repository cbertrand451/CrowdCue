import { useLiveRevision } from './realtime';
import { useEffect, useRef, useState } from 'react';
import {
  queueSnapshotSchema,
  type QueueSnapshot,
  type QueueAction,
} from '../server/queue/contracts.js';
export function QueueBoard({
  role,
  token,
  refresh = 0,
  onExpired,
  onChange,
}: {
  role: 'guest' | 'admin';
  token: string;
  refresh?: number;
  onExpired?: () => void;
  onChange?: () => void;
}) {
  const liveRevision = useLiveRevision();
  const [snapshot, setSnapshot] = useState<QueueSnapshot>();
  const [offset, setOffset] = useState(0);
  const [attempt, setAttempt] = useState(0);
  const mutation = useRef<AbortController | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string>();
  useEffect(
    () => () => {
      mutation.current?.abort();
    },
    [token],
  );
  async function control(action: QueueAction) {
    if (mutation.current) return;
    const controller = new AbortController();
    mutation.current = controller;
    setBusy(true);
    setActionError(undefined);
    try {
      const response = await fetch(
        `/api/party-links/admin/${encodeURIComponent(token)}/queue`,
        {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(action),
          signal: controller.signal,
        },
      );
      if (controller.signal.aborted) return;
      if (!response.ok) {
        if (response.status === 401 || response.status === 404)
          setSnapshot(undefined);
        if (response.status === 401) onExpired?.();
        throw new Error(
          response.status === 409
            ? 'The queue changed or the song locked. Refresh the queue before trying again.'
            : response.status === 429
              ? 'Too many changes. Try again shortly.'
              : 'Unable to change the queue. Try again.',
        );
      }
      setAttempt((value) => value + 1);
      onChange?.();
    } catch (error) {
      if (!controller.signal.aborted)
        setActionError(
          error instanceof Error
            ? error.message
            : 'Unable to change the queue.',
        );
    } finally {
      if (mutation.current === controller) mutation.current = null;
      if (!controller.signal.aborted) setBusy(false);
    }
  }
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
  }, [role, token, refresh, offset, attempt, onExpired, liveRevision]);
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
      {actionError && <p role="alert">{actionError}</p>}
      {error && <p role="alert">{error}</p>}
      {!snapshot && !error && <p role="status">Loading queue…</p>}
      {snapshot && (
        <>
          <p className="muted">
            {snapshot.hostOrdered
              ? 'Host order is active. Votes are counted; new guest songs follow the host’s ordered songs. Backup slots and songs committed to Spotify stay fixed.'
              : snapshot.votingEnabled
                ? 'Guest songs rank by votes. Backup slots stay in place; songs committed to Spotify cannot change.'
                : 'Voting is off. Guest songs follow request order.'}
          </p>
          {role === 'admin' &&
            snapshot.hostOrdered &&
            snapshot.status === 'ACTIVE' && (
              <button
                type="button"
                className="secondary"
                disabled={busy}
                onClick={() => void control({ action: 'reset' })}
              >
                {snapshot.votingEnabled
                  ? 'Restore vote order'
                  : 'Restore request order'}
              </button>
            )}
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
            {snapshot.items.map(
              ({ position, request, locked, source, delivery }, index) => {
                const guest = (item: QueueSnapshot['items'][number]) =>
                  item.source === 'GUEST' && !item.locked;
                const before = snapshot.items
                  .slice(0, index)
                  .filter(guest)
                  .at(-1);
                const after = snapshot.items.slice(index + 1).find(guest);
                return (
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
                      {source === 'BACKUP' && (
                        <p className="muted">Backup playlist</p>
                      )}
                      {locked && (
                        <p className="ready">
                          Locked ·{' '}
                          {delivery === 'SENT'
                            ? 'Sent to Spotify'
                            : delivery === 'UNKNOWN'
                              ? 'Delivery needs host attention'
                              : 'Awaiting Spotify delivery'}
                        </p>
                      )}
                      {position === 1 &&
                        !locked &&
                        snapshot.status === 'ACTIVE' && (
                          <p className="ready">First in CrowdCue</p>
                        )}
                    </div>
                    {role === 'admin' &&
                      snapshot.status === 'ACTIVE' &&
                      source === 'GUEST' &&
                      !locked && (
                        <div className="queue-controls">
                          <button
                            type="button"
                            className="secondary"
                            disabled={busy || !before}
                            aria-label={`Move ${request.track.title} up`}
                            onClick={() =>
                              before &&
                              void control({
                                action: 'move',
                                requestId: request.id,
                                neighborId: before.request.id,
                                direction: 'up',
                              })
                            }
                          >
                            Move up
                          </button>
                          <button
                            type="button"
                            className="secondary"
                            disabled={busy || !after}
                            aria-label={`Move ${request.track.title} down`}
                            onClick={() =>
                              after &&
                              void control({
                                action: 'move',
                                requestId: request.id,
                                neighborId: after.request.id,
                                direction: 'down',
                              })
                            }
                          >
                            Move down
                          </button>
                        </div>
                      )}
                  </li>
                );
              },
            )}
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
        Only locked #1 is committed to Spotify. The host can remove guest songs
        before they reach #1.
      </p>
    </section>
  );
}
