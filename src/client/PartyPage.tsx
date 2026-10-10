import { LoadingButton, LoadingStatus } from './LoadingButton';
import { TVDisplay } from './TVDisplay';
import { LiveRevision, usePartyRealtime } from './realtime';
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
import { CreatorContact } from './CreatorContact';

const publicResponse = z.object({
  party: publicPartySchema.extend({ guestUrl: z.string().url().optional() }),
});
const adminResponse = z.object({ party: partyDetailsSchema });
type PageParty = z.infer<typeof publicResponse>['party'];
export function PartyPage(props: {
  role: 'guest' | 'admin' | 'display';
  token: string;
}) {
  return props.role === 'display' ? (
    <TVDisplay key={props.token} token={props.token} />
  ) : (
    <RolePage role={props.role} token={props.token} />
  );
}
function RolePage({ role, token }: { role: 'guest' | 'admin'; token: string }) {
  const { revision, connected } = usePartyRealtime(role, token);
  const [party, setParty] = useState<PageParty | PartyDetails>();
  const [error, setError] = useState<string>();
  const [retryBusy, setRetryBusy] = useState(false);
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
        if (!controller.signal.aborted) setRetryBusy(false);
        if (!controller.signal.aborted)
          timer = setTimeout(() => void load(), 15_000);
      }
    }
    void load();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [role, token, refreshing, revision]);
  return (
    <LiveRevision.Provider value={revision}>
      <main className="party-page">
        <header
          className={
            role === 'admin' ? 'party-header admin-header' : 'party-header'
          }
        >
          <p className="wordmark">CrowdCue</p>
          {role === 'admin' && (
            <SpotifyConnection onAuthenticationChange={authenticationChanged} />
          )}
        </header>
        {party && (
          <p className="muted" role="status">
            {connected
              ? 'Live updates connected.'
              : 'Live updates reconnecting. Checking for changes periodically.'}
          </p>
        )}
        {error && (
          <div role="alert">
            <p>{error}</p>
            <LoadingButton
              loading={retryBusy}
              type="button"
              className="secondary"
              disabled={retryBusy}
              onClick={() => {
                setRetryBusy(true);
                setRefreshing((value) => value + 1);
              }}
            >
              {retryBusy ? 'Loading…' : 'Try again'}
            </LoadingButton>
          </div>
        )}
        {!party && !error && <LoadingStatus>Loading party…</LoadingStatus>}
        {party && (
          <>
            <p className="label">
              {role === 'admin' ? 'Your party' : 'You’re invited'}
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
          </>
        )}
        {
          <p>
            <a href="/" rel="noreferrer">
              {role === 'admin' ? 'Back to your parties' : 'CrowdCue home'}
            </a>
          </p>
        }
        <CreatorContact />
      </main>
    </LiveRevision.Provider>
  );
}
