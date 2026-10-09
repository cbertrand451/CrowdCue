import { LoadingButton, LoadingStatus } from './LoadingButton';
import { z } from 'zod';
import { useLiveRevision } from './realtime';
import { Modal } from './Modal';
import { useEffect, useRef, useState } from 'react';
import { requestResponseSchema } from '../server/requests/contracts.js';
import {
  searchQuerySchema,
  searchResultSchema,
  type SearchResult,
} from '../server/search/contracts.js';
const trackStatesSchema = z.object({
  tracks: z.array(
    z.object({ id: z.string(), requested: z.boolean(), played: z.boolean() }),
  ),
});
export function SongSearch({
  token,
  allowExplicit,
  onExpired,
  onRequested,
}: {
  token: string;
  allowExplicit: boolean;
  onExpired: () => void;
  onRequested?: () => void;
}) {
  const liveRevision = useLiveRevision();
  const [states, setStates] = useState<
    Record<string, { requested: boolean; played: boolean }>
  >({});
  const [stateRevision, setStateRevision] = useState(0);
  const [query, setQuery] = useState('');
  const [offset, setOffset] = useState(0);
  const [tracks, setTracks] = useState<SearchResult['tracks']>([]);
  const [nextOffset, setNextOffset] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [error, setError] = useState<string>();
  const [attempt, setAttempt] = useState(0);
  const [requestBusy, setRequestBusy] = useState<string>();
  const [playedRepeatTrack, setPlayedRepeatTrack] =
    useState<SearchResult['tracks'][number]>();
  const [requestFeedback, setRequestFeedback] = useState<string>();
  const [requestError, setRequestError] = useState<string>();
  const requestKeys = useRef(new Map<string, string>());
  const requestPending = useRef(false);
  const requestController = useRef<AbortController | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    requestController.current = controller;
    return () => controller.abort();
  }, [token]);
  const stateIds = tracks.map((track) => track.id).join(',');
  useEffect(() => {
    if (!stateIds) return;
    const c = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function load() {
      try {
        const ids = stateIds.split(',');
        const all: z.infer<typeof trackStatesSchema>['tracks'] = [];
        for (let i = 0; i < ids.length; i += 100) {
          const response = await fetch(
            `/api/party-links/guest/${encodeURIComponent(token)}/track-states?ids=${ids.slice(i, i + 100).join(',')}`,
            { credentials: 'same-origin', signal: c.signal },
          );
          if (response.status === 401) {
            onExpired();
            return;
          }
          if (!response.ok) throw new Error();
          all.push(...trackStatesSchema.parse(await response.json()).tracks);
        }
        if (!c.signal.aborted)
          setStates((old) => ({
            ...old,
            ...Object.fromEntries(all.map((track) => [track.id, track])),
          }));
      } catch {
        /* Keep the last confirmed state; request mutations remain server-validated. */
      } finally {
        if (!c.signal.aborted) timer = setTimeout(() => void load(), 5000);
      }
    }
    void load();
    return () => {
      c.abort();
      clearTimeout(timer);
    };
  }, [stateIds, token, liveRevision, stateRevision, onExpired]);
  async function requestSong(trackId: string, confirmPlayedRepeat = false) {
    if (requestPending.current || states[trackId]?.requested) return;
    if (states[trackId]?.played && !confirmPlayedRepeat) {
      setPlayedRepeatTrack(tracks.find((t) => t.id === trackId));
      return;
    }
    const key = requestKeys.current.get(trackId) ?? crypto.randomUUID();
    requestKeys.current.set(trackId, key);
    const controller = requestController.current;
    requestPending.current = true;
    setRequestBusy(trackId);
    setRequestError(undefined);
    setRequestFeedback(undefined);
    try {
      const response = await fetch(
        `/api/party-links/guest/${encodeURIComponent(token)}/requests`,
        {
          method: 'POST',
          credentials: 'same-origin',
          signal: controller?.signal,
          headers: {
            'content-type': 'application/json',
            'idempotency-key': key,
          },
          body: JSON.stringify({ confirmPlayedRepeat, trackId }),
        },
      );
      if (controller?.signal.aborted) return;
      if (!response.ok) {
        if (response.status === 401) {
          onExpired();
          return;
        }
        const body = (await response.json()) as { error?: unknown };
        setRequestError(
          typeof body.error === 'string'
            ? body.error
            : 'Could not confirm the request. Retry the same song or refresh requests.',
        );
        return;
      }
      const result = requestResponseSchema.parse(await response.json());
      if (!controller?.signal.aborted) {
        if ('confirmationRequired' in result) {
          setPlayedRepeatTrack(
            tracks.find((track) => track.id === trackId) ??
              visibleTracks.find((track) => track.id === trackId),
          );
          setRequestFeedback(undefined);
          return;
        }
        requestKeys.current.delete(trackId);
        setStates((old) => ({
          ...old,
          [trackId]: { requested: true, played: old[trackId]?.played ?? false },
        }));
        setStateRevision((v) => v + 1);
        setPlayedRepeatTrack(undefined);
        setRequestFeedback(
          !result.created
            ? 'This song is already requested.'
            : result.request.status === 'REQUESTED'
              ? 'Request sent for host approval.'
              : 'Your request is added.',
        );
        onRequested?.();
      }
    } catch {
      if (!controller?.signal.aborted)
        setRequestError(
          'Could not confirm the request. Retry the same song or refresh requests.',
        );
    } finally {
      requestPending.current = false;
      if (!controller?.signal.aborted) setRequestBusy(undefined);
    }
  }
  function cancelPlayedRepeat() {
    setPlayedRepeatTrack(undefined);
    setRequestFeedback(undefined);
    setRequestError(undefined);
  }
  useEffect(() => {
    const controller = new AbortController();
    const input = searchQuerySchema.safeParse({ q: query, offset });
    if (!input.success) return () => controller.abort();
    const timer = setTimeout(
      () => {
        void load();
      },
      offset === 0 ? 400 : 0,
    );
    async function load() {
      setLoading(true);
      setError(undefined);
      try {
        const params = new URLSearchParams({
          q: query.trim(),
          offset: String(offset),
        });
        const response = await fetch(
          `/api/party-links/guest/${encodeURIComponent(token)}/search?${params}`,
          { credentials: 'same-origin', signal: controller.signal },
        );
        if (controller.signal.aborted) return;
        if (!response.ok) {
          if (response.status === 401) {
            onExpired();
            return;
          }
          const wait = Number(response.headers.get('retry-after'));
          setError(
            response.status === 429
              ? `Search is busy. ${Number.isFinite(wait) && wait > 0 ? `Wait ${Math.min(Math.ceil(wait), 3600)} seconds, then retry.` : 'Wait a moment, then retry.'}`
              : response.status === 409
                ? 'This party has ended. Search is closed.'
                : response.status === 400
                  ? 'Check your search and guest name, then retry.'
                  : response.status === 404
                    ? 'Party not found. Check your link with the host.'
                    : 'Search is unavailable. The host may need to reconnect Spotify. Try again shortly.',
          );
          return;
        }
        const result = searchResultSchema.parse(await response.json());
        if (!controller.signal.aborted) {
          setTracks((current) =>
            offset === 0
              ? result.tracks
              : [
                  ...current,
                  ...result.tracks.filter(
                    (track) => !current.some((item) => item.id === track.id),
                  ),
                ],
          );
          setNextOffset(result.nextOffset);
          setSearched(true);
        }
      } catch {
        if (!controller.signal.aborted)
          setError('Unable to search. Check your connection and retry.');
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [query, offset, attempt, token, allowExplicit, onExpired]);
  function change(value: string) {
    setLoading(false);
    setError(undefined);
    setQuery(value);
    setOffset(0);
    setTracks([]);
    setSearched(false);
    setNextOffset(null);
  }
  const visibleTracks = tracks.filter(
    (track) => allowExplicit || !track.explicit,
  );
  return (
    <section className="song-search" aria-label="Song search">
      <h2>Find a song</h2>
      <label htmlFor="song-query">Search songs, artists, or albums</label>
      <input
        id="song-query"
        type="search"
        maxLength={200}
        value={query}
        onChange={(event) => change(event.target.value)}
        placeholder="What should we play?"
      />
      {query.trim().length < 2 && (
        <p className="muted">Type at least two characters to search.</p>
      )}
      {!allowExplicit && (
        <p className="muted">Explicit songs are hidden for this party.</p>
      )}
      {loading && <LoadingStatus>Searching Spotify…</LoadingStatus>}
      {error && (
        <div role="alert">
          <p>{error}</p>
          <LoadingButton
            loading={loading}
            type="button"
            className="secondary"
            disabled={loading}
            onClick={() => setAttempt((value) => value + 1)}
          >
            Retry search
          </LoadingButton>
        </div>
      )}
      {searched && !loading && visibleTracks.length === 0 && !error && (
        <p>
          No matching songs on this page. Try another search
          {nextOffset !== null ? ' or load more results' : ''}.
        </p>
      )}
      {visibleTracks.length > 0 && (
        <>
          <p className="muted">Search results from Spotify</p>
          <ul className="search-results">
            {visibleTracks.map((track) => (
              <li key={track.id}>
                {track.artworkUrl ? (
                  <img
                    src={track.artworkUrl}
                    alt={`${track.album} artwork`}
                    width={64}
                    height={64}
                    loading="lazy"
                    referrerPolicy="no-referrer"
                  />
                ) : (
                  <div className="artwork-placeholder" aria-hidden="true">
                    ♪
                  </div>
                )}
                <div className="track-details">
                  <a href={track.spotifyUrl} target="_blank" rel="noreferrer">
                    {track.title}
                  </a>
                  <p>{track.artists.join(', ')}</p>
                  <p className="muted">{track.album}</p>
                  <p className="muted">
                    {Math.floor(track.durationMs / 60000)}:
                    {String(Math.floor(track.durationMs / 1000) % 60).padStart(
                      2,
                      '0',
                    )}
                    {track.explicit ? ' · Explicit' : ''}
                  </p>
                </div>
                <LoadingButton
                  loading={requestBusy === track.id}
                  succeeded={!!states[track.id]?.requested}
                  type="button"
                  className={
                    states[track.id]?.requested
                      ? 'requested-button'
                      : 'secondary'
                  }
                  disabled={!!requestBusy || !!states[track.id]?.requested}
                  onClick={() => void requestSong(track.id)}
                >
                  {requestBusy === track.id
                    ? 'Requesting…'
                    : states[track.id]?.requested
                      ? 'Song Requested'
                      : 'Request song'}
                </LoadingButton>
              </li>
            ))}
          </ul>
        </>
      )}
      {nextOffset !== null && (
        <LoadingButton
          loading={loading}
          type="button"
          className="secondary"
          disabled={loading}
          onClick={() => setOffset(nextOffset)}
        >
          Load more songs
        </LoadingButton>
      )}
      {requestFeedback && (
        <p role="status" className="ready">
          {requestFeedback}
        </p>
      )}
      {playedRepeatTrack && (
        <Modal
          title="This song has been played in this session already, are you sure?"
          onClose={() => {
            if (!requestBusy) cancelPlayedRepeat();
          }}
        >
          <p>{playedRepeatTrack.title}</p>
          <LoadingButton
            loading={!!requestBusy}
            type="button"
            disabled={!!requestBusy}
            onClick={() => void requestSong(playedRepeatTrack.id, true)}
          >
            Yes
          </LoadingButton>
          <button
            type="button"
            className="secondary"
            disabled={!!requestBusy}
            onClick={cancelPlayedRepeat}
          >
            No
          </button>
        </Modal>
      )}
      {requestError && <p role="alert">{requestError}</p>}
      <p className="muted">Vote for songs in the request list.</p>
    </section>
  );
}
