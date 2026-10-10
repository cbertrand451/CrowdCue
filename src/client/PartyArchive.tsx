import { ComponentIcon } from './ComponentIcon';
import { useEffect, useRef, useState } from 'react';
import { motion, MotionConfig } from 'motion/react';
import {
  archiveSchema,
  type ArchiveItem,
} from '../server/parties/contracts.js';
import { Modal } from './Modal';
import { LoadingButton, LoadingStatus } from './LoadingButton';
import { AlertMessage } from './AlertMessage';
export function PartyArchive() {
  const [parties, setParties] = useState<ArchiveItem[]>([]);
  const [offset, setOffset] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [attempt, setAttempt] = useState(0);
  const [selected, setSelected] = useState<ArchiveItem>();
  const [removing, setRemoving] = useState(false);
  const [detail, setDetail] = useState<ArchiveItem>();
  const pending = useRef(false);
  const c = useRef<AbortController | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    c.current = controller;
    async function load() {
      try {
        const res = await fetch('/api/parties/archive', {
          credentials: 'same-origin',
          signal: controller.signal,
        });
        if (!res.ok) throw new Error();
        const data = archiveSchema.parse(await res.json());
        if (!controller.signal.aborted) {
          setParties(data.parties);
          setOffset(data.nextOffset);
        }
      } catch {
        if (!controller.signal.aborted)
          setError('Could not load Party Archive. Refresh to try again.');
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    void load();
    return () => controller.abort();
  }, [attempt]);
  async function more() {
    if (offset === null || pending.current) return;
    pending.current = true;
    setLoading(true);
    setError(undefined);
    try {
      const res = await fetch(`/api/parties/archive?offset=${offset}`, {
        credentials: 'same-origin',
        signal: c.current?.signal,
      });
      if (!res.ok) throw new Error();
      const data = archiveSchema.parse(await res.json());
      if (c.current?.signal.aborted) return;
      setParties((current) => [
        ...current,
        ...data.parties.filter((p) => !current.some((x) => x.id === p.id)),
      ]);
      setOffset(data.nextOffset);
    } catch {
      if (!c.current?.signal.aborted)
        setError('Could not load older parties. Try again.');
    } finally {
      pending.current = false;
      if (!c.current?.signal.aborted) setLoading(false);
    }
  }
  async function remove() {
    if (!selected || pending.current) return;
    pending.current = true;
    setRemoving(true);
    setError(undefined);
    try {
      const res = await fetch(`/api/parties/${selected.id}/archive/remove`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: '{}',
        signal: c.current?.signal,
      });
      if (!res.ok || (await res.json()).removed !== true) throw new Error();
      if (c.current?.signal.aborted) return;
      setParties((current) => current.filter((p) => p.id !== selected.id));
      setSelected(undefined);
      // Restart pagination after removal so an offset cannot skip an older card.
      setAttempt((a) => a + 1);
    } catch {
      if (!c.current?.signal.aborted)
        setError(
          'Could not remove this card. Refresh the archive before trying again.',
        );
    } finally {
      pending.current = false;
      if (!c.current?.signal.aborted) setRemoving(false);
    }
  }
  function refresh() {
    if (pending.current) return;
    setError(undefined);
    setLoading(true);
    setAttempt((a) => a + 1);
  }
  return (
    <MotionConfig reducedMotion="user">
      <section className="party-archive" aria-label="Party Archive">
        <div className="section-heading">
          <h2>Party Archive</h2>
          <LoadingButton
            loading={loading}
            className="secondary"
            disabled={loading || removing}
            onClick={refresh}
          >
            Refresh archive
          </LoadingButton>
        </div>
        <p className="muted">Your past parties and session playlists.</p>
        {error && (
          <AlertMessage action="Refresh" onAction={refresh}>
            {error}
          </AlertMessage>
        )}
        {loading && <LoadingStatus>Loading archive…</LoadingStatus>}
        {!loading && !error && !parties.length && (
          <p className="muted">
            No archived parties yet. End a party to add it here.
          </p>
        )}
        <div className="archive-grid">
          {parties.map((p) => (
            <motion.article
              key={p.id}
              className="archive-card"
              whileHover={{ y: -5, rotate: 0.3 }}
              transition={{ type: 'spring', stiffness: 220, damping: 24 }}
            >
              <ArchiveArtwork party={p} />
              <div className="archive-card-content">
                <h3>{p.name}</h3>
                <p className="muted">
                  {new Date(p.createdAt).toLocaleDateString()} · {p.trackCount}{' '}
                  songs queued
                </p>
                <div className="control-group" aria-label={`${p.name} actions`}>
                  {p.playlistUrl ? (
                    <a
                      className="button-link"
                      href={p.playlistUrl}
                      target="_blank"
                      rel="noreferrer"
                      title="Open session playlist in Spotify"
                    >
                      Open playlist <ComponentIcon symbol="↗" />
                    </a>
                  ) : (
                    <button
                      type="button"
                      disabled
                      title="No Spotify session playlist was created"
                    >
                      <span aria-hidden="true">⊘</span> No playlist
                    </button>
                  )}
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => setDetail(p)}
                    title="View party details"
                  >
                    Details
                  </button>
                </div>
                <button
                  type="button"
                  className="archive-remove"
                  disabled={removing}
                  onClick={() => {
                    setError(undefined);
                    setSelected(p);
                  }}
                  aria-label={`Remove ${p.name} from archive`}
                >
                  Remove from gallery
                </button>
              </div>
            </motion.article>
          ))}
        </div>
        {offset !== null && (
          <LoadingButton
            loading={loading}
            disabled={loading || removing}
            className="secondary"
            onClick={() => void more()}
          >
            Load older parties
          </LoadingButton>
        )}
        {detail && (
          <Modal title={detail.name} onClose={() => setDetail(undefined)}>
            <p>Created {new Date(detail.createdAt).toLocaleString()}</p>
            <p>
              Ended{' '}
              {detail.endedAt ? new Date(detail.endedAt).toLocaleString() : '—'}
            </p>
            <p>{detail.trackCount} songs queued during this party.</p>
            {detail.playlistUrl ? (
              <a href={detail.playlistUrl} target="_blank" rel="noreferrer">
                Open Spotify playlist ↗
              </a>
            ) : (
              <p className="muted">No session playlist available.</p>
            )}
          </Modal>
        )}
        {selected && (
          <Modal
            title={`Remove ${selected.name}?`}
            onClose={() => setSelected(undefined)}
            closeDisabled={removing}
          >
            <p>
              This removes the card from your Party Archive. Your Spotify
              playlist and party history are kept.
            </p>
            <div className="dialog-actions">
              <button
                type="button"
                className="secondary"
                disabled={removing}
                onClick={() => setSelected(undefined)}
              >
                Cancel
              </button>
              <LoadingButton loading={removing} onClick={() => void remove()}>
                Remove from gallery
              </LoadingButton>
            </div>
            {error && <AlertMessage>{error}</AlertMessage>}
          </Modal>
        )}
      </section>
    </MotionConfig>
  );
}

function ArchiveArtwork({ party }: { party: ArchiveItem }) {
  const [failed, setFailed] = useState(false);
  return party.coverUrl && !failed ? (
    <img
      src={party.coverUrl}
      alt={`${party.name} cover`}
      loading="lazy"
      onError={() => setFailed(true)}
    />
  ) : (
    <div
      className="archive-art"
      aria-label={failed ? 'Cover unavailable' : 'No cover uploaded'}
    >
      <span>CrowdCue</span>
    </div>
  );
}
