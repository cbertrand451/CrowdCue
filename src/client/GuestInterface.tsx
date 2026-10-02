import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from 'react';
import { SongSearch } from './SongSearch';
import { z } from 'zod';
import {
  guestInputSchema,
  guestSessionSchema,
  type GuestSession,
} from '../server/guests/contracts.js';
import type { PublicParty } from '../server/parties/contracts.js';
const responseSchema = z.object({ guest: guestSessionSchema.nullable() });
export function GuestInterface({
  party,
  token,
}: {
  party: PublicParty;
  token: string;
}) {
  const [guest, setGuest] = useState<GuestSession | null>(null);
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [feedback, setFeedback] = useState<string>();
  const [attempt, setAttempt] = useState(0);
  const inFlight = useRef(false);
  const sessionExpired = useCallback(() => {
    setGuest(null);
    setFeedback('Your guest session expired. Join again to continue.');
  }, []);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => {
    const active = new AbortController();
    controller.current = active;
    async function load() {
      setLoading(true);
      setError(undefined);
      try {
        const response = await fetch(
          `/api/party-links/guest/${encodeURIComponent(token)}/session`,
          { credentials: 'same-origin', signal: active.signal },
        );
        if (!response.ok) throw new Error('Unavailable');
        const result = responseSchema.parse(await response.json());
        if (!active.signal.aborted) {
          setGuest(result.guest);
          setName(result.guest?.displayName ?? '');
        }
      } catch {
        if (!active.signal.aborted)
          setError('Unable to check your guest session. Try again.');
      } finally {
        if (!active.signal.aborted) setLoading(false);
      }
    }
    void load();
    return () => active.abort();
  }, [token, attempt]);
  useEffect(() => {
    if (!guest) return;
    const timer = setInterval(() => {
      if (Date.parse(guest.expiresAt) <= Date.now()) {
        setGuest(null);
        setFeedback('Your guest session expired. Join again to continue.');
      }
    }, 60_000);
    return () => clearInterval(timer);
  }, [guest]);
  async function join(event: FormEvent) {
    event.preventDefault();
    if (inFlight.current) return;
    const input = guestInputSchema.safeParse({
      displayName: name.trim() || null,
    });
    if (
      !input.success ||
      (party.settings.requireGuestNames && !input.data.displayName)
    ) {
      setError(
        party.settings.requireGuestNames
          ? 'Enter your name to join this party.'
          : 'Use a name between 1 and 80 characters.',
      );
      return;
    }
    inFlight.current = true;
    setBusy(true);
    setError(undefined);
    setFeedback(undefined);
    const active = controller.current;
    try {
      const response = await fetch(
        `/api/party-links/guest/${encodeURIComponent(token)}/session`,
        {
          method: 'POST',
          credentials: 'same-origin',
          signal: active?.signal,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(input.data),
        },
      );
      if (active?.signal.aborted) return;
      if (!response.ok) {
        setError(
          response.status === 409
            ? 'This party has ended. You can no longer join or change your name.'
            : response.status === 400
              ? 'The host requires a valid guest name. Check your name and try again.'
              : response.status === 429
                ? 'Too many attempts. Wait a moment and retry.'
                : response.status === 404
                  ? 'Party not found. Check your link with the host.'
                  : 'Could not join the party. Try again.',
        );
        return;
      }
      const result = responseSchema.parse(await response.json());
      if (!active?.signal.aborted) {
        setGuest(result.guest);
        setFeedback(guest ? 'Your name is saved.' : 'You’ve joined the party.');
      }
    } catch {
      if (!active?.signal.aborted)
        setError('Could not join the party. Try again.');
    } finally {
      inFlight.current = false;
      if (!active?.signal.aborted) setBusy(false);
    }
  }
  return (
    <section className="guest-interface" aria-label="Guest access">
      {loading ? (
        <p aria-live="polite">Checking your guest session…</p>
      ) : (
        <>
          {guest && (
            <p className="ready">Joined as {guest.displayName || 'a guest'}.</p>
          )}
          {party.status === 'ACTIVE' && (
            <>
              <h2>{guest ? 'Your guest name' : 'Join the party'}</h2>
              <p className="muted">
                {party.settings.requireGuestNames
                  ? 'The host asks everyone to use a name.'
                  : 'A name is optional. No account needed.'}
              </p>
              {guest &&
                party.settings.requireGuestNames &&
                !guest.displayName && (
                  <p role="alert">
                    The host now requires a name. Add yours before requesting
                    songs.
                  </p>
                )}
              <form onSubmit={join}>
                <fieldset disabled={busy}>
                  <label htmlFor="guest-name">
                    Your name
                    {party.settings.requireGuestNames ? '' : ' (optional)'}
                  </label>
                  <input
                    id="guest-name"
                    autoComplete="nickname"
                    maxLength={80}
                    required={party.settings.requireGuestNames}
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                  />
                  <button type="submit">
                    {busy ? 'Joining…' : guest ? 'Save name' : 'Join party'}
                  </button>
                </fieldset>
              </form>
              <section
                aria-label="Party preferences"
                className="guest-preferences"
              >
                <h2>At this party</h2>
                <p>
                  {party.settings.approvalRequired
                    ? 'The host will approve song requests.'
                    : 'Song requests won’t need host approval.'}
                </p>
                <p>
                  {party.settings.votingEnabled
                    ? 'Voting is enabled.'
                    : 'Voting is turned off.'}
                </p>
                {!party.settings.allowExplicitTracks && (
                  <p>Explicit songs are turned off.</p>
                )}
                {party.settings.maxActiveRequestsPerGuest && (
                  <p>
                    Up to {party.settings.maxActiveRequestsPerGuest} active
                    requests per guest.
                  </p>
                )}
                {party.settings.requestCooldownSeconds > 0 && (
                  <p>
                    Wait {party.settings.requestCooldownSeconds} seconds between
                    requests.
                  </p>
                )}
                {!guest && <p className="muted">Join to search Spotify.</p>}
              </section>
              {guest &&
                (!party.settings.requireGuestNames || guest.displayName) && (
                  <SongSearch
                    token={token}
                    allowExplicit={party.settings.allowExplicitTracks}
                    onExpired={sessionExpired}
                  />
                )}
            </>
          )}
          {party.status === 'ENDED' && (
            <p className="muted">
              Thanks for joining. Ask the host for a new party link to keep the
              music going.
            </p>
          )}
        </>
      )}
      {feedback && (
        <p role="status" className="ready">
          {feedback}
        </p>
      )}
      {error && (
        <div role="alert">
          <p>{error}</p>
          {!busy && (
            <button
              type="button"
              className="secondary"
              onClick={() => setAttempt((value) => value + 1)}
            >
              Check session again
            </button>
          )}
        </div>
      )}
    </section>
  );
}
