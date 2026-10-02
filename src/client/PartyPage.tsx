import { useCallback, useEffect, useState } from 'react';
import { z } from 'zod';
import {
  partyDetailsSchema,
  publicPartySchema,
  type PartyDetails,
} from '../server/parties/contracts.js';
import { GuestInterface } from './GuestInterface';
import { AdminDashboard } from './AdminDashboard';
import { SpotifyConnection } from './SpotifyConnection';

const publicResponse = z.object({
  party: publicPartySchema.extend({ guestUrl: z.string().url().optional() }),
});
const adminResponse = z.object({ party: partyDetailsSchema });
type PageParty = z.infer<typeof publicResponse>['party'];
export function PartyPage({
  role,
  token,
}: {
  role: 'guest' | 'admin' | 'display';
  token: string;
}) {
  const [party, setParty] = useState<PageParty | PartyDetails>();
  const [error, setError] = useState<string>();
  const [refreshing, setRefreshing] = useState(0);
  const authenticationChanged = useCallback((authenticated: boolean) => {
    if (!authenticated) {
      setRefreshing((value) => value + 1);
      setParty(undefined);
      setError('Sign in as this party’s host to manage it.');
    }
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function load() {
      try {
        const response = await fetch(
          `/api/party-links/${role}/${encodeURIComponent(token)}`,
          { credentials: 'same-origin', signal: controller.signal },
        );
        if (!response.ok) {
          if (!controller.signal.aborted) {
            setError(
              response.status === 401
                ? 'Sign in as this party’s host to manage it.'
                : response.status === 404
                  ? 'Party not found. Check your link with the host.'
                  : 'Unable to load this party. Please try again.',
            );
            if (response.status === 401 || response.status === 404)
              setParty(undefined);
          }
        } else {
          const result =
            role === 'admin'
              ? adminResponse.parse(await response.json())
              : publicResponse.parse(await response.json());
          if (!controller.signal.aborted) {
            setParty(result.party);
            setError(undefined);
          }
        }
      } catch {
        if (!controller.signal.aborted)
          setError('Unable to load this party. Please try again.');
      } finally {
        if (!controller.signal.aborted)
          timer = setTimeout(() => void load(), 15_000);
      }
    }
    void load();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [role, token, refreshing]);
  return (
    <main className={`party-page ${role === 'display' ? 'display-page' : ''}`}>
      <p className="wordmark">CrowdCue</p>
      {role === 'admin' && (
        <SpotifyConnection onAuthenticationChange={authenticationChanged} />
      )}
      {error && (
        <div role="alert">
          <p>{error}</p>
          <button
            type="button"
            className="secondary"
            onClick={() => setRefreshing((value) => value + 1)}
          >
            Try again
          </button>
        </div>
      )}
      {!party && !error && <p aria-live="polite">Loading party…</p>}
      {party && (
        <>
          <p className="label">
            {role === 'admin'
              ? 'Your party'
              : role === 'display'
                ? 'Party display'
                : 'You’re invited'}
          </p>
          <h1>{party.name}</h1>
          <p
            aria-live="polite"
            className={party.status === 'ACTIVE' ? 'ready' : 'muted'}
          >
            {party.status === 'ACTIVE'
              ? 'Party is active.'
              : 'This party has ended.'}
          </p>
          {role === 'guest' && (
            <GuestInterface key={token} party={party} token={token} />
          )}
          {role === 'admin' && 'links' in party && (
            <AdminDashboard
              key={party.id}
              party={party}
              token={token}
              onChange={(updated) => {
                setParty(updated);
                setRefreshing((value) => value + 1);
              }}
              onExpired={() => {
                setParty(undefined);
                setRefreshing((value) => value + 1);
                setError('Sign in as this party’s host to manage it.');
              }}
            />
          )}
          {role === 'display' && 'guestUrl' in party && party.guestUrl && (
            <>
              <p>Join the party</p>
              <a href={party.guestUrl} rel="noreferrer">
                {party.guestUrl}
              </a>
            </>
          )}
          {role === 'display' && party.status === 'ACTIVE' && (
            <p className="muted">Live playback display is coming next.</p>
          )}
        </>
      )}
      {role !== 'display' && (
        <p>
          <a href="/" rel="noreferrer">
            {role === 'admin' ? 'Back to your parties' : 'CrowdCue home'}
          </a>
        </p>
      )}
    </main>
  );
}
