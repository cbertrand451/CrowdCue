import { LoadingButton, LoadingStatus } from './LoadingButton';
import { useEffect, useState } from 'react';
import {
  eventHistorySchema,
  type EventHistory,
} from '../server/history/contracts.js';
import { useLiveRevision } from './realtime';

export function SongHistory({
  token,
  onExpired,
}: {
  token: string;
  onExpired: () => void;
}) {
  const revision = useLiveRevision();
  const [history, setHistory] = useState<EventHistory>();
  const [offset, setOffset] = useState(0);
  const [refreshBusy, setRefreshBusy] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [error, setError] = useState<string>();
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function load() {
      try {
        const response = await fetch(
          `/api/party-links/admin/${encodeURIComponent(token)}/history?offset=${offset}`,
          {
            credentials: 'same-origin',
            signal: controller.signal,
          },
        );
        if (controller.signal.aborted) return;
        if (!response.ok) {
          if (response.status === 401 || response.status === 404)
            setHistory(undefined);
          if (response.status === 401) onExpired();
          throw new Error('Unavailable');
        }
        const data = eventHistorySchema.parse(await response.json());
        if (!controller.signal.aborted) {
          setHistory(data);
          setError(undefined);
        }
      } catch {
        if (!controller.signal.aborted)
          setError('Unable to load song history. Try refreshing it.');
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
  }, [token, offset, attempt, revision, onExpired]);
  return (
    <section className="request-board" aria-label="Event song history">
      <div className="section-heading">
        <h2>Song history</h2>
        <LoadingButton
          loading={refreshBusy}
          className="secondary"
          type="button"
          disabled={refreshBusy}
          aria-busy={refreshBusy}
          onClick={() => {
            setRefreshBusy(true);
            setAttempt((v) => v + 1);
          }}
        >
          {refreshBusy ? <>Refreshing…</> : 'Refresh song history'}
        </LoadingButton>
      </div>
      <p className="muted">
        Songs appear when locked into #1, in commitment order. Repeats are
        included. Spotify observations do not confirm a full listen; skipped or
        missed songs may have no observation.
      </p>
      {error && <p role="alert">{error}</p>}
      {!history && !error && (
        <LoadingStatus>Loading song history…</LoadingStatus>
      )}
      {history && (
        <>
          <p>
            {history.committedCount}{' '}
            {history.committedCount === 1 ? 'song' : 'songs'} committed ·{' '}
            {history.observedCount} observed playing
          </p>
          {history.status === 'ENDED' && (
            <p className="muted">
              This event has ended. Song history remains available even if its
              Spotify playlist is removed.
            </p>
          )}
          {!history.items.length && (
            <p>
              {offset
                ? 'No songs on this page. Return to earlier history.'
                : history.status === 'ENDED'
                  ? 'No songs were committed during this event.'
                  : 'No songs committed yet.'}
            </p>
          )}
          <ol className="search-results history-results" start={offset + 1}>
            {history.items.map((item) => (
              <li key={item.id}>
                <span
                  className="queue-position"
                  aria-label={`History position ${item.position}`}
                >
                  {item.position}
                </span>
                <div className="track-details">
                  <a
                    href={item.track.spotifyUrl}
                    rel="noreferrer"
                    target="_blank"
                  >
                    {item.track.title}
                  </a>
                  <p>
                    {item.track.artists.join(', ')} · {item.track.album}
                  </p>
                  <p className="muted">
                    {item.source === 'BACKUP'
                      ? 'Backup playlist'
                      : item.requestedBy
                        ? `Requested by ${item.requestedBy}`
                        : 'Guest request'}
                  </p>
                  <p>
                    Committed{' '}
                    <time dateTime={item.committedAt}>
                      {new Date(item.committedAt).toLocaleString()}
                    </time>
                  </p>
                  <p className={item.observedAt ? 'ready' : 'muted'}>
                    {item.observedAt ? (
                      <>
                        Observed playing{' '}
                        <time dateTime={item.observedAt}>
                          {new Date(item.observedAt).toLocaleString()}
                        </time>
                      </>
                    ) : (
                      'Playback not observed'
                    )}
                  </p>
                  <p className="muted">
                    {item.delivery === 'SENT'
                      ? 'Spotify acknowledged delivery'
                      : item.delivery === 'UNKNOWN'
                        ? 'Spotify delivery unconfirmed'
                        : item.delivery === 'SENDING'
                          ? 'Spotify delivery in progress'
                          : 'Awaiting Spotify delivery'}
                  </p>
                </div>
              </li>
            ))}
          </ol>
          <div className="party-actions">
            {offset > 0 && (
              <LoadingButton
                loading={refreshBusy}
                disabled={refreshBusy}
                type="button"
                className="secondary"
                onClick={() => {
                  setRefreshBusy(true);
                  setOffset(Math.max(0, offset - 50));
                }}
              >
                Earlier songs
              </LoadingButton>
            )}
            {history.nextOffset !== null && (
              <LoadingButton
                loading={refreshBusy}
                disabled={refreshBusy}
                type="button"
                className="secondary"
                onClick={() => {
                  setRefreshBusy(true);
                  setOffset(history.nextOffset!);
                }}
              >
                Later songs
              </LoadingButton>
            )}
          </div>
        </>
      )}
    </section>
  );
}
