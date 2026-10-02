import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  createPartySchema,
  partyDetailsSchema,
  type PartyDetails,
} from '../server/parties/contracts.js';
import { PartyLinks } from './PartyLinks';

export function AdminDashboard({
  party,
  token,
  onChange,
  onExpired,
}: {
  party: PartyDetails;
  token: string;
  onChange: (party: PartyDetails) => void;
  onExpired: () => void;
}) {
  const [name, setName] = useState(party.name);
  const [settings, setSettings] = useState(party.settings);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [feedback, setFeedback] = useState<string>();
  const [error, setError] = useState<string>();
  const inFlight = useRef(false);
  const requestController = useRef<AbortController | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    requestController.current = controller;
    return () => controller.abort();
  }, []);
  async function mutate(action: 'settings' | 'end') {
    if (inFlight.current) return;
    const input = createPartySchema.safeParse({ name, settings });
    if (action === 'settings' && !input.success) {
      setError('Check the party name and settings.');
      return;
    }
    inFlight.current = true;
    setBusy(true);
    setError(undefined);
    setFeedback(undefined);
    const controller = requestController.current;
    try {
      const response = await fetch(
        `/api/party-links/admin/${encodeURIComponent(token)}/${action}`,
        {
          method: 'POST',
          signal: controller?.signal,
          credentials: 'same-origin',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(action === 'end' ? {} : input.data),
        },
      );
      if (controller?.signal.aborted) return;
      if (!response.ok) {
        if (response.status === 401 || response.status === 404) {
          onExpired();
          return;
        }
        setError(
          response.status === 409
            ? 'This party has ended. Refresh to see its current state.'
            : response.status === 429
              ? 'Too many changes. Wait a moment and retry.'
              : 'Could not confirm the change. Refresh the party or retry.',
        );
        return;
      }
      const result = (await response.json()) as { party: unknown };
      if (controller?.signal.aborted) return;
      onChange(partyDetailsSchema.parse(result.party));
      setFeedback(action === 'end' ? 'Party ended.' : 'Settings saved.');
      setConfirming(false);
    } catch {
      if (!controller?.signal.aborted)
        setError('Could not confirm the change. Refresh the party or retry.');
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  function save(event: FormEvent) {
    event.preventDefault();
    void mutate('settings');
  }
  const booleans = [
    ['approvalRequired', 'Approve song requests'],
    ['votingEnabled', 'Allow voting'],
    ['requireGuestNames', 'Require guest names'],
    ['allowExplicitTracks', 'Allow explicit songs'],
  ] as const;
  return (
    <div className="admin-dashboard">
      <section aria-label="Party links">
        <h2>Invite your guests</h2>
        <PartyLinks links={party.links} />
      </section>
      <section aria-label="Party settings">
        <h2>Party settings</h2>
        <form onSubmit={save}>
          <fieldset disabled={busy || party.status === 'ENDED'}>
            <label htmlFor="admin-party-name">Party name</label>
            <input
              id="admin-party-name"
              value={name}
              required
              maxLength={120}
              onChange={(event) => setName(event.target.value)}
            />
            <div className="party-preferences">
              {booleans.map(([key, label]) => (
                <label key={key}>
                  <input
                    type="checkbox"
                    checked={settings[key]}
                    onChange={(event) =>
                      setSettings({ ...settings, [key]: event.target.checked })
                    }
                  />
                  {label}
                </label>
              ))}
            </div>
            <label htmlFor="request-limit">
              Active requests per guest (blank for unlimited)
            </label>
            <input
              id="request-limit"
              type="number"
              min={1}
              max={100}
              value={settings.maxActiveRequestsPerGuest ?? ''}
              onChange={(event) =>
                setSettings({
                  ...settings,
                  maxActiveRequestsPerGuest:
                    event.target.value === ''
                      ? null
                      : Number(event.target.value),
                })
              }
            />
            <label htmlFor="request-cooldown">
              Request cooldown in seconds
            </label>
            <input
              id="request-cooldown"
              type="number"
              min={0}
              max={3600}
              required
              value={settings.requestCooldownSeconds}
              onChange={(event) =>
                setSettings({
                  ...settings,
                  requestCooldownSeconds: Number(event.target.value),
                })
              }
            />
            <p className="muted">
              Queue mode:{' '}
              {settings.queueBehavior === 'SPOTIFY_QUEUE'
                ? 'Spotify queue'
                : 'Backup playlist'}
              . Song requests, voting, and queue delivery are coming next.
            </p>
            <button type="submit">{busy ? 'Saving…' : 'Save settings'}</button>
          </fieldset>
        </form>
        {feedback && (
          <p role="status" className="ready">
            {feedback}
          </p>
        )}
        {error && <p role="alert">{error}</p>}
      </section>
      {party.status === 'ACTIVE' ? (
        <section aria-label="End party">
          <h2>End this party</h2>
          <p>
            Guests will see that the party has ended. Spotify playback
            continues.
          </p>
          {confirming ? (
            <div>
              <p>End this party? You cannot reopen it.</p>
              <div className="party-actions">
                <button
                  disabled={busy}
                  type="button"
                  onClick={() => void mutate('end')}
                >
                  {busy ? 'Ending…' : 'Confirm end party'}
                </button>
                <button
                  disabled={busy}
                  type="button"
                  className="secondary"
                  onClick={() => setConfirming(false)}
                >
                  Keep party active
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              className="secondary"
              disabled={busy}
              onClick={() => setConfirming(true)}
            >
              End party
            </button>
          )}
        </section>
      ) : (
        <p className="muted">
          Ended parties are read-only. Create a new party from your home page.
        </p>
      )}
    </div>
  );
}
