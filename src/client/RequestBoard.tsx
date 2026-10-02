import { useEffect, useRef, useState } from 'react';
import {
  requestListSchema,
  songRequestSchema,
  type SongRequest,
} from '../server/requests/contracts.js';
const labels: Record<SongRequest['status'], string> = {
  REQUESTED: 'Awaiting host approval',
  APPROVED: 'Approved',
  QUEUED: 'Queued',
  PLAYED: 'Played',
  REJECTED: 'Rejected',
  REMOVED: 'Removed',
};
export function RequestBoard({
  role,
  token,
  active,
  refresh = 0,
  onExpired,
}: {
  role: 'guest' | 'admin';
  token: string;
  active: boolean;
  refresh?: number;
  onExpired?: () => void;
}) {
  const [requests, setRequests] = useState<SongRequest[]>([]);
  const [offset, setOffset] = useState(0);
  const [nextOffset, setNextOffset] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState<string>();
  const [attempt, setAttempt] = useState(0);
  const mutation = useRef<AbortController | null>(null);
  const pending = useRef(false);
  useEffect(() => {
    const controller = new AbortController();
    mutation.current = controller;
    return () => controller.abort();
  }, [token]);
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function load() {
      try {
        const response = await fetch(
          `/api/party-links/${role}/${encodeURIComponent(token)}/requests?offset=${offset}`,
          { credentials: 'same-origin', signal: controller.signal },
        );
        if (controller.signal.aborted) return;
        if (!response.ok) {
          if (response.status === 401) {
            setRequests([]);
            onExpired?.();
          }
          throw new Error('Unavailable');
        }
        const result = requestListSchema.parse(await response.json());
        if (!controller.signal.aborted) {
          setRequests(result.requests);
          setNextOffset(result.nextOffset);
          setError(undefined);
        }
      } catch {
        if (!controller.signal.aborted)
          setError('Unable to load requests. Try refreshing the list.');
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
          timer = setTimeout(() => void load(), 15000);
        }
      }
    }
    void load();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [role, token, offset, attempt, refresh, onExpired]);
  async function moderate(id: string, action: 'approve' | 'reject' | 'remove') {
    if (pending.current) return;
    pending.current = true;
    setBusy(id);
    setError(undefined);
    const controller = mutation.current;
    try {
      const response = await fetch(
        `/api/party-links/admin/${encodeURIComponent(token)}/requests/${id}`,
        {
          method: 'POST',
          credentials: 'same-origin',
          signal: controller?.signal,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ action }),
        },
      );
      if (controller?.signal.aborted) return;
      if (!response.ok) {
        if (response.status === 401) {
          setRequests([]);
          onExpired?.();
        }
        setError(
          response.status === 409
            ? 'This request or party changed. Refresh the list before trying again.'
            : 'Could not confirm the change. Refresh the list or retry.',
        );
        return;
      }
      const result = (await response.json()) as { request: unknown };
      const saved = songRequestSchema.parse(result.request);
      if (!controller?.signal.aborted) {
        setRequests((current) =>
          current.map((row) => (row.id === saved.id ? saved : row)),
        );
        setAttempt((value) => value + 1);
      }
    } catch {
      if (!controller?.signal.aborted)
        setError('Could not confirm the change. Refresh the list or retry.');
    } finally {
      pending.current = false;
      if (!controller?.signal.aborted) setBusy(undefined);
    }
  }
  return (
    <section
      id="song-requests"
      className="request-board"
      aria-label="Song requests"
    >
      <div className="section-heading">
        <h2>Song requests</h2>
        <button
          type="button"
          className="secondary"
          onClick={() => setAttempt((value) => value + 1)}
        >
          Refresh requests
        </button>
      </div>
      {loading && <p role="status">Loading requests…</p>}
      {error && <p role="alert">{error}</p>}
      {!loading && !error && requests.length === 0 && (
        <p>
          No requests yet.{' '}
          {active
            ? 'Find a song to get things started.'
            : 'This party has ended.'}
        </p>
      )}
      <ul className="search-results">
        {requests.map((request) => (
          <li key={request.id}>
            <div className="track-details">
              <a
                href={request.track.spotifyUrl}
                target="_blank"
                rel="noreferrer"
              >
                {request.track.title}
              </a>
              <p>{request.track.artists.join(', ')}</p>
              <p className="muted">
                {request.track.album} ·{' '}
                {Math.floor(request.track.durationMs / 60000)}:
                {String(
                  Math.floor(request.track.durationMs / 1000) % 60,
                ).padStart(2, '0')}
              </p>
              <p>
                {labels[request.status]}
                {request.isOwn ? ' · Your request' : ''}
              </p>
              <p className="muted">
                Requested by {request.requestedBy || 'a guest'}
              </p>
              {role === 'admin' &&
                active &&
                ['REQUESTED', 'APPROVED'].includes(request.status) && (
                  <div className="party-actions">
                    {request.status === 'REQUESTED' && (
                      <button
                        type="button"
                        disabled={!!busy}
                        onClick={() => void moderate(request.id, 'approve')}
                      >
                        Approve
                      </button>
                    )}
                    <button
                      type="button"
                      className="secondary"
                      disabled={!!busy}
                      onClick={() => void moderate(request.id, 'reject')}
                    >
                      Reject
                    </button>
                    <button
                      type="button"
                      className="secondary"
                      disabled={!!busy}
                      onClick={() => void moderate(request.id, 'remove')}
                    >
                      Remove
                    </button>
                  </div>
                )}
            </div>
          </li>
        ))}
      </ul>
      <div className="party-actions">
        {offset > 0 && (
          <button
            type="button"
            className="secondary"
            onClick={() => setOffset(Math.max(0, offset - 50))}
          >
            Newer requests
          </button>
        )}
        {nextOffset !== null && (
          <button
            type="button"
            className="secondary"
            onClick={() => setOffset(nextOffset)}
          >
            Older requests
          </button>
        )}
      </div>
      <p className="muted">
        Approved requests are saved here. Spotify queue delivery and voting are
        coming next.
      </p>
    </section>
  );
}
