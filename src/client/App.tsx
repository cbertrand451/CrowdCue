import { CreateNewDisclosure } from './CreateNewDisclosure';
import { LoadingStatus } from './LoadingButton';
import { DashboardNavigation } from './DashboardNavigation';
import { useCallback, useEffect, useState } from 'react';
import { SpotifyConnection } from './SpotifyConnection';
import { PartyCreation } from './PartyCreation';
import { PartyPage } from './PartyPage';

export function App() {
  const route = /^\/(join|admin|display)\/([^/]+)\/?$/.exec(
    window.location.pathname,
  );
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
  const authenticationChanged = useCallback(
    (value: boolean) => setAuthenticated(value),
    [],
  );
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
      <h1>CrowdCue</h1>
      <p className="intro">Create a party and share it with your guests.</p>
      {status === 'checking' ? (
        <LoadingStatus className="status">Checking connection…</LoadingStatus>
      ) : (
        <p role="status" className={`status ${status}`}>
          {status === 'ready'
            ? 'CrowdCue is running.'
            : 'Unable to reach CrowdCue. Please refresh to try again.'}
        </p>
      )}
      <SpotifyConnection onAuthenticationChange={authenticationChanged} />
      {authenticated && (
        <CreateNewDisclosure
          items={[
            {
              id: 'create',
              icon: '+',
              label: 'Create a party',
              onAction: () => setMenu('create'),
            },
            {
              id: 'parties',
              icon: '≋',
              label: 'Browse parties',
              onAction: () => setMenu('parties'),
            },
            {
              id: 'spotify',
              icon: '◉',
              label: 'Spotify connection',
              onAction: () => {
                const connection = document.querySelector<HTMLElement>(
                  '.spotify-connection',
                );
                connection?.setAttribute('tabindex', '-1');
                connection?.focus({ preventScroll: true });
                connection?.scrollIntoView?.({ block: 'start' });
              },
            },
          ]}
        />
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
            />
          </div>
        </div>
      )}
    </main>
  );
}
