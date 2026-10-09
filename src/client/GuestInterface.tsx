import { DashboardNavigation } from './DashboardNavigation';
import { Modal } from './Modal';
import { LeaderboardPanel } from './LeaderboardPanel';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from 'react';
import { QueueBoard } from './QueueBoard';
import { RequestBoard } from './RequestBoard';
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
  const [menu, setMenu] = useState('search');
  const [editing, setEditing] = useState(false);
  const [guest, setGuest] = useState<GuestSession | null>(null);
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [feedback, setFeedback] = useState<string>();
  const [attempt, setAttempt] = useState(0);
  const [requestRefresh, setRequestRefresh] = useState(0);
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
  async function join(event: FormEvent, anonymous = false) {
    event.preventDefault();
    if (inFlight.current) return;
    const input = guestInputSchema.safeParse({
      displayName: anonymous ? null : name.trim() || null,
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
        setName(result.guest?.displayName ?? '');
        setEditing(false);
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
  const ready =
    !!guest && (!party.settings.requireGuestNames || !!guest.displayName);
  const nameForm = (
    <form onSubmit={(event) => void join(event)}>
      <fieldset disabled={busy}>
        <label htmlFor="guest-name">
          Your name{party.settings.requireGuestNames ? '' : ' (optional)'}
        </label>
        <input
          id="guest-name"
          autoFocus
          autoComplete="nickname"
          maxLength={80}
          required={party.settings.requireGuestNames}
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
        <div className="party-actions">
          <button type="submit">
            {busy ? 'Saving…' : editing ? 'Update' : 'Join party'}
          </button>
          {editing ? (
            <button
              type="button"
              className="secondary"
              onClick={() => {
                setEditing(false);
                setError(undefined);
              }}
            >
              Cancel
            </button>
          ) : (
            !party.settings.requireGuestNames && (
              <button
                type="button"
                className="secondary"
                onClick={(event) => void join(event, true)}
              >
                Continue as guest
              </button>
            )
          )}
        </div>
      </fieldset>
    </form>
  );
  return (
    <section className="guest-interface" aria-label="Guest access">
      {loading ? (
        <p role="status">Checking your guest session…</p>
      ) : (
        <>
          {party.status === 'ACTIVE' && !ready && (
            <div className="guest-welcome">
              <span className="cue-mark" aria-hidden="true">
                ≋
              </span>
              <p className="label">Your crowd. Your soundtrack.</p>
              <h2>Welcome to {party.name}</h2>
              <p className="muted">
                {party.settings.requireGuestNames
                  ? 'Enter your name to join the party.'
                  : 'Pick a name or jump in as a guest. No account needed.'}
              </p>
              {nameForm}
            </div>
          )}
          {guest && (ready || party.status === 'ENDED') && (
            <>
              <div className="guest-toolbar">
                <p className="ready">
                  Joined as {guest.displayName || 'a guest'}.
                </p>
                {party.status === 'ACTIVE' && (
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => {
                      setName(guest.displayName ?? '');
                      setError(undefined);
                      setEditing(true);
                    }}
                  >
                    Edit Guest Name
                  </button>
                )}
              </div>
              <div className="dashboard-layout">
                <DashboardNavigation
                  label="Guest menus"
                  selected={menu}
                  onSelect={setMenu}
                  items={[
                    { id: 'search', label: 'Find a song', icon: '⌕' },
                    { id: 'queue', label: 'Live queue', icon: '≋' },
                    { id: 'requests', label: 'Song requests', icon: '＋' },
                    { id: 'leaderboard', label: 'Leaderboard', icon: '↗' },
                    { id: 'about', label: 'Party details', icon: '◉' },
                  ]}
                />
                <div className="dashboard-content">
                  <div hidden={menu !== 'search'}>
                    {party.status === 'ACTIVE' ? (
                      <SongSearch
                        token={token}
                        allowExplicit={party.settings.allowExplicitTracks}
                        onExpired={sessionExpired}
                        onRequested={() => setRequestRefresh((v) => v + 1)}
                      />
                    ) : (
                      <p>This party has ended. Thanks for joining.</p>
                    )}
                  </div>
                  <div hidden={menu !== 'requests'}>
                    <RequestBoard
                      role="guest"
                      token={token}
                      active={party.status === 'ACTIVE'}
                      refresh={requestRefresh}
                      votingEnabled={party.settings.votingEnabled}
                      canVote={ready}
                      onExpired={sessionExpired}
                      onChange={() => setRequestRefresh((v) => v + 1)}
                    />
                  </div>
                  <div hidden={menu !== 'queue'}>
                    <QueueBoard
                      role="guest"
                      token={token}
                      refresh={requestRefresh}
                      onExpired={sessionExpired}
                    />
                  </div>
                  <div hidden={menu !== 'leaderboard'}>
                    <LeaderboardPanel
                      role="guest"
                      token={token}
                      refresh={requestRefresh}
                      onExpired={sessionExpired}
                    />
                  </div>
                  <section
                    hidden={menu !== 'about'}
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
                        ? 'Voting is enabled. Vote for someone else’s pick.'
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
                        Wait {party.settings.requestCooldownSeconds} seconds
                        between requests.
                      </p>
                    )}
                  </section>
                </div>
              </div>
            </>
          )}
          {editing && (
            <Modal
              title="Edit Guest Name"
              onClose={() => {
                if (!busy) {
                  setEditing(false);
                  setError(undefined);
                }
              }}
            >
              {nameForm}
              {error && <p role="alert">{error}</p>}
            </Modal>
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
      {error && !editing && (
        <div role="alert">
          <p>{error}</p>
          <button
            type="button"
            className="secondary"
            disabled={busy || loading}
            onClick={() => setAttempt((v) => v + 1)}
          >
            Check session again
          </button>
        </div>
      )}
    </section>
  );
}
