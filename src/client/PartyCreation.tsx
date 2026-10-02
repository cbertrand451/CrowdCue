import { useEffect, useRef, useState, type FormEvent } from 'react';
import { z } from 'zod';
import {
  createPartySchema,
  partyDetailsSchema,
  type PartyDetails,
} from '../server/parties/contracts.js';
import { playlistIdFromInput } from '../server/playback/contracts.js';
import { PartyLinks } from './PartyLinks';

const listSchema = z.object({
  parties: z.array(partyDetailsSchema),
  nextOffset: z.number().int().nullable(),
});
const creationSchema = z.object({ party: partyDetailsSchema });
export function PartyCreation() {
  const [parties, setParties] = useState<PartyDetails[]>([]);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState(false);
  const [listAttempt, setListAttempt] = useState(0);
  const [nextOffset, setNextOffset] = useState<number | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [name, setName] = useState('');
  const [backupSource, setBackupSource] = useState('');
  const [saveRecapPlaylist, setSaveRecapPlaylist] = useState(false);
  const [approvalRequired, setApprovalRequired] = useState(false);
  const [votingEnabled, setVotingEnabled] = useState(true);
  const [requireGuestNames, setRequireGuestNames] = useState(false);
  const [allowExplicitTracks, setAllowExplicitTracks] = useState(true);
  const [creating, setCreating] = useState(false);
  const [creationError, setCreationError] = useState<string>();
  const [createdId, setCreatedId] = useState<string>();
  const inFlight = useRef(false);
  const intent = useRef<{ fingerprint: string; key: string } | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      setLoading(true);
      setListError(false);
      try {
        const response = await fetch('/api/parties', {
          credentials: 'same-origin',
          signal: controller.signal,
        });
        if (!response.ok) throw new Error('Unavailable');
        const result = listSchema.parse(await response.json());
        if (!controller.signal.aborted) {
          // A list response may arrive after creation; preserve that new party.
          setParties((current) => [
            ...current.filter(
              (party) =>
                party.id === createdId &&
                !result.parties.some((item) => item.id === party.id),
            ),
            ...result.parties,
          ]);
          setNextOffset(result.nextOffset);
        }
      } catch {
        if (!controller.signal.aborted) setListError(true);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    void load();
    return () => controller.abort();
  }, [listAttempt, createdId]);

  async function loadMore() {
    if (nextOffset === null || loadingMore) return;
    setLoadingMore(true);
    setListError(false);
    try {
      const response = await fetch(`/api/parties?offset=${nextOffset}`, {
        credentials: 'same-origin',
      });
      if (!response.ok) throw new Error('Unavailable');
      const result = listSchema.parse(await response.json());
      setParties((current) => [
        ...current,
        ...result.parties.filter(
          (party) => !current.some((item) => item.id === party.id),
        ),
      ]);
      setNextOffset(result.nextOffset);
    } catch {
      setListError(true);
    } finally {
      setLoadingMore(false);
    }
  }
  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current) return;
    const backupSourceId = playlistIdFromInput(backupSource);
    if (backupSourceId === undefined) {
      setCreationError('Enter a valid Spotify playlist link.');
      return;
    }
    const parsed = createPartySchema.safeParse({
      name,
      settings: {
        approvalRequired,
        votingEnabled,
        requireGuestNames,
        allowExplicitTracks,
        backupSourceId,
        saveRecapPlaylist,
      },
    });
    if (!parsed.success) {
      setCreationError('Enter a party name between 1 and 120 characters.');
      return;
    }
    const fingerprint = JSON.stringify(parsed.data);
    if (intent.current?.fingerprint !== fingerprint) {
      intent.current = { fingerprint, key: crypto.randomUUID() };
    }
    inFlight.current = true;
    setCreating(true);
    setCreationError(undefined);
    try {
      const response = await fetch('/api/parties', {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          'content-type': 'application/json',
          'idempotency-key': intent.current.key,
        },
        body: fingerprint,
      });
      if (!response.ok) {
        setCreationError(
          response.status === 401
            ? 'Your session expired. Sign in with Spotify again to create a party.'
            : response.status === 400
              ? 'Check your party name and preferences, then try again.'
              : response.status === 409
                ? 'This attempt already created a party. Refresh your parties before starting another.'
                : response.status === 429
                  ? 'Too many attempts. Please wait a moment and try again.'
                  : 'Could not confirm party creation. Retry with the same details, or refresh your parties before starting another.',
        );
        return;
      }
      const result = creationSchema.parse(await response.json());
      setParties((current) => [
        result.party,
        ...current.filter((party) => party.id !== result.party.id),
      ]);
      setCreatedId(result.party.id);
      setName('');
      intent.current = null;
    } catch {
      setCreationError(
        'Could not confirm party creation. Retry with the same details, or refresh your parties before starting another.',
      );
    } finally {
      setCreating(false);
      inFlight.current = false;
    }
  }
  return (
    <section className="party-creation" aria-label="Party creation">
      <h2>Create a party</h2>
      <p className="muted">Give it a name, then share the guest link.</p>
      <form onSubmit={(event) => void create(event)}>
        <fieldset disabled={creating}>
          <label htmlFor="party-name">Party name</label>
          <input
            id="party-name"
            name="name"
            value={name}
            maxLength={120}
            required
            onChange={(event) => setName(event.target.value)}
            placeholder="Friday at Sam’s"
            aria-describedby={creationError ? 'creation-error' : undefined}
          />
          <label>
            Backup Spotify playlist
            <input
              value={backupSource}
              onChange={(event) => setBackupSource(event.target.value)}
              placeholder="https://open.spotify.com/playlist/…"
            />
          </label>
          <p className="muted">
            Use a playlist you own or can edit. It supplies songs when guests
            have none waiting. You can add it later.
          </p>
          <label>
            Save the nightly playlist?
            <select
              value={saveRecapPlaylist ? 'yes' : 'no'}
              onChange={(event) =>
                setSaveRecapPlaylist(event.target.value === 'yes')
              }
            >
              <option value="no">No</option>
              <option value="yes">Yes</option>
            </select>
          </label>
          <p className="muted">
            A temporary private playlist records locked songs either way. You’ll
            be asked again at closeout.
          </p>
          <div className="party-preferences">
            <label>
              <input
                type="checkbox"
                checked={approvalRequired}
                onChange={(event) => setApprovalRequired(event.target.checked)}
              />
              Approve song requests
            </label>
            <label>
              <input
                type="checkbox"
                checked={votingEnabled}
                onChange={(event) => setVotingEnabled(event.target.checked)}
              />
              Allow voting
            </label>
            <label>
              <input
                type="checkbox"
                checked={requireGuestNames}
                onChange={(event) => setRequireGuestNames(event.target.checked)}
              />
              Require guest names
            </label>
            <label>
              <input
                type="checkbox"
                checked={allowExplicitTracks}
                onChange={(event) =>
                  setAllowExplicitTracks(event.target.checked)
                }
              />
              Allow explicit songs
            </label>
          </div>
          <button type="submit">
            {creating ? 'Creating party…' : 'Create party'}
          </button>
        </fieldset>
      </form>
      {creationError && (
        <p id="creation-error" role="alert">
          {creationError}
        </p>
      )}
      {createdId && (
        <p aria-live="polite" className="ready">
          Your party is ready. Share the guest link below.
        </p>
      )}
      <div className="party-list">
        <div className="section-heading">
          <h2>Your parties</h2>
          <button
            type="button"
            className="secondary"
            disabled={loading}
            onClick={() => setListAttempt((value) => value + 1)}
          >
            Refresh parties
          </button>
        </div>
        {loading && <p aria-live="polite">Loading your parties…</p>}
        {listError && (
          <p role="alert">
            Unable to load your parties. Try refreshing the list.
          </p>
        )}
        {!loading && !listError && parties.length === 0 && (
          <p className="muted">No parties yet. Create your first one.</p>
        )}
        {parties.map((party) => (
          <article key={party.id} className="party-summary">
            <div className="section-heading">
              <h3>{party.name}</h3>
              <span className={party.status === 'ACTIVE' ? 'ready' : 'muted'}>
                {party.status === 'ACTIVE' ? 'Active' : 'Ended'}
              </span>
            </div>
            <PartyLinks
              links={party.links}
              active={party.status === 'ACTIVE'}
            />
          </article>
        ))}
        {nextOffset !== null && (
          <button
            type="button"
            className="secondary"
            disabled={loadingMore}
            onClick={() => void loadMore()}
          >
            {loadingMore ? 'Loading…' : 'Load older parties'}
          </button>
        )}
      </div>
    </section>
  );
}
