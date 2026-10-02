import { useEffect, useState } from 'react';
import {
  searchQuerySchema,
  searchResultSchema,
  type SearchResult,
} from '../server/search/contracts.js';
export function SongSearch({
  token,
  allowExplicit,
  onExpired,
}: {
  token: string;
  allowExplicit: boolean;
  onExpired: () => void;
}) {
  const [query, setQuery] = useState('');
  const [offset, setOffset] = useState(0);
  const [tracks, setTracks] = useState<SearchResult['tracks']>([]);
  const [nextOffset, setNextOffset] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [error, setError] = useState<string>();
  const [attempt, setAttempt] = useState(0);
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
      {loading && <p role="status">Searching Spotify…</p>}
      {error && (
        <div role="alert">
          <p>{error}</p>
          <button
            type="button"
            className="secondary"
            disabled={loading}
            onClick={() => setAttempt((value) => value + 1)}
          >
            Retry search
          </button>
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
              </li>
            ))}
          </ul>
        </>
      )}
      {nextOffset !== null && (
        <button
          type="button"
          className="secondary"
          disabled={loading}
          onClick={() => setOffset(nextOffset)}
        >
          Load more songs
        </button>
      )}
      <p className="muted">Song requests and voting are coming next.</p>
    </section>
  );
}
