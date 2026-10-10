import { EndPartyAction } from './EndPartyAction';
import { GuestQRCode } from './GuestQRCode';
import { LoadingStatus } from './LoadingButton';
import { DashboardNavigation } from './DashboardNavigation';
import { useCallback, useEffect, useState } from 'react';
import { SpotifyConnection } from './SpotifyConnection';
import { PartyCreation } from './PartyCreation';
import { PartyPage } from './PartyPage';
import type { PartyDetails } from '../server/parties/contracts.js';

export function App() {
  const route = /^\/(join|admin|display)\/([^/]+)\/?$/.exec(
    window.location.pathname,
  );
  const page = route
    ? route[1] === 'join'
      ? 'Guest'
      : route[1] === 'admin'
        ? 'Admin'
        : 'Display'
    : 'Home';
  useEffect(() => {
    document.title = `CrowdCue · ${page}`;
  }, [page]);
  if (route)
    return (
      <PartyPage
        role={route[1] === 'join' ? 'guest' : (route[1] as 'admin' | 'display')}
        token={route[2]}
      />
    );
  return <HostHome />;
}
function HostHome() {
  const [menu, setMenu] = useState('create');
  const [authenticated, setAuthenticated] = useState(false);
  const [endedParty, setEndedParty] = useState<PartyDetails>();
  const [confirmedEndedParties, setConfirmedEndedParties] = useState<
    ReadonlyMap<string, PartyDetails>
  >(() => new Map());
  const recordEnded = useCallback((updated: PartyDetails) => {
    setConfirmedEndedParties((current) =>
      new Map(current).set(updated.id, updated),
    );
    setEndedParty(updated);
  }, []);
  const [overview, setOverview] = useState<{
    parties: PartyDetails[];
    loading: boolean;
    failed: boolean;
  }>({ parties: [], loading: true, failed: false });
  const authenticationChanged = useCallback((value: boolean) => {
    setAuthenticated(value);
    if (!value) setEndedParty(undefined);
  }, []);
  const [status, setStatus] = useState<'checking' | 'ready' | 'unavailable'>(
    'checking',
  );
  useEffect(() => {
    const controller = new AbortController();
    async function check() {
      try {
        const response = await fetch('/api/health', {
          signal: controller.signal,
        });
        const data: unknown = await response.json();
        if (
          !response.ok ||
          typeof data !== 'object' ||
          data === null ||
          !('status' in data) ||
          data.status !== 'ok'
        )
          throw new Error('Unavailable');
        setStatus('ready');
      } catch {
        if (!controller.signal.aborted) setStatus('unavailable');
      }
    }
    void check();
    return () => controller.abort();
  }, []);
  return (
    <main className="host-home">
      <header className="party-header admin-header home-header">
        <h1>CrowdCue</h1>
        <SpotifyConnection onAuthenticationChange={authenticationChanged} />
      </header>
      {status === 'checking' ? (
        <LoadingStatus className="home-status">
          Checking connection…
        </LoadingStatus>
      ) : (
        <p role="status" className={`home-status ${status}`}>
          {status === 'ready'
            ? 'CrowdCue is running.'
            : 'Unable to reach CrowdCue. Please refresh to try again.'}
        </p>
      )}
      {authenticated && (
        <section
          className="home-active-card"
          aria-label="Active party overview"
        >
          <h2>Active parties</h2>
          {endedParty && (
            <p role="status" className="ready">
              {endedParty.name} ended. Spotify playback continues.
            </p>
          )}
          {overview.loading ? (
            <LoadingStatus>Loading your parties…</LoadingStatus>
          ) : overview.failed ? (
            <p role="status">
              Could not refresh your parties. Open Your parties and choose
              Refresh parties to try again.
            </p>
          ) : !overview.parties.some((party) => party.status === 'ACTIVE') ? (
            <p className="muted">
              No active party in your recent parties. Create one below, or
              browse Your parties for older parties.
            </p>
          ) : null}
          <div className="active-party-list">
            {overview.parties
              .filter((party) => party.status === 'ACTIVE')
              .map((party) => (
                <article key={party.id} className="active-party-summary">
                  <GuestQRCode url={party.links.guest} />
                  <div className="active-party-details">
                    <h3>{party.name}</h3>
                    <p className="ready">Party open to guests</p>
                    <p className="muted">
                      {party.settings.backupSourceId
                        ? 'Backup playlist configured'
                        : 'Add a backup playlist in settings before starting the Spotify session'}
                    </p>
                    <div className="active-party-actions">
                      {party.links.admin && (
                        <a
                          href={party.links.admin}
                          target="_blank"
                          rel="noreferrer"
                        >
                          Open admin
                        </a>
                      )}
                      {party.links.display && (
                        <a
                          href={party.links.display}
                          target="_blank"
                          rel="noreferrer"
                        >
                          Open display
                        </a>
                      )}
                      <a href={party.links.guest}>Guest link</a>
                      <EndPartyAction party={party} onEnded={recordEnded} />
                    </div>
                  </div>
                </article>
              ))}
          </div>
        </section>
      )}
      {authenticated && (
        <div className="dashboard-layout">
          <DashboardNavigation
            label="Your workspace"
            selected={menu}
            onSelect={setMenu}
            items={[
              { id: 'create', label: 'New party', icon: '＋' },
              { id: 'parties', label: 'Your parties', icon: '≋' },
            ]}
          />
          <div className="dashboard-content">
            <PartyCreation
              view={menu === 'parties' ? 'parties' : 'create'}
              onCreated={() => setMenu('parties')}
              onOverviewChange={setOverview}
              confirmedEndedParties={confirmedEndedParties}
              onPartyEnded={recordEnded}
            />
          </div>
        </div>
      )}
    </main>
  );
}
