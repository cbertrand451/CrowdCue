import { PageGuide } from './PageGuide';
import { SwitchDisclosure } from './SwitchDisclosure';
import { FloatingInput } from './FloatingInput';
import { LoadingButton } from './LoadingButton';
import { DashboardNavigation } from './DashboardNavigation';
import { LeaderboardPanel } from './LeaderboardPanel';
import { PartyStatisticsPanel } from './PartyStatisticsPanel';
import { SongHistory } from './SongHistory';
import { PlaybackPanel } from './PlaybackPanel';
import { playlistIdFromInput } from '../server/playback/contracts.js';
import { QueueBoard } from './QueueBoard';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  createPartySchema,
  partyDetailsSchema,
  type PartyDetails,
} from '../server/parties/contracts.js';
import { RequestBoard } from './RequestBoard';
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
  const [menu, setMenu] = useState('session');
  const [queueRefresh, setQueueRefresh] = useState(0);
  const [backupSource, setBackupSource] = useState(
    party.settings.backupSourceId
      ? `https://open.spotify.com/playlist/${party.settings.backupSourceId}`
      : '',
  );
  const [name, setName] = useState(party.name);
  const [settings, setSettings] = useState(party.settings);
  const [pendingAction, setPendingAction] = useState<'settings' | 'end'>();
  const busy = pendingAction !== undefined;
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
    const backupSourceId = playlistIdFromInput(backupSource);
    if (action === 'settings' && backupSourceId === undefined) {
      setError('Enter a valid Spotify playlist link.');
      return;
    }
    const input = createPartySchema.safeParse({
      name,
      settings: { ...settings, backupSourceId },
    });
    if (action === 'settings' && !input.success) {
      setError('Check the party name and settings.');
      return;
    }
    inFlight.current = true;
    setPendingAction(action);
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
      setQueueRefresh((value) => value + 1);
      setFeedback(action === 'end' ? 'Party ended.' : 'Settings saved.');
      setConfirming(false);
    } catch {
      if (!controller?.signal.aborted)
        setError('Could not confirm the change. Refresh the party or retry.');
    } finally {
      inFlight.current = false;
      setPendingAction(undefined);
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
    <>
      <PageGuide
        role="admin"
        party={party}
        onSetupHelp={() => {
          setMenu('session');
          requestAnimationFrame(() => {
            const help =
              document.querySelector<HTMLDetailsElement>('.session-help');
            if (help) {
              help.open = true;
              help.scrollIntoView({ block: 'start' });
            }
          });
        }}
      />
      <div className="admin-dashboard dashboard-layout">
        <DashboardNavigation
          label="Host menus"
          selected={menu}
          onSelect={setMenu}
          items={[
            { id: 'session', label: 'Spotify session', icon: '◉' },
            { id: 'live', label: 'Live queue', icon: '≋' },
            { id: 'requests', label: 'Requests', icon: '＋' },
            { id: 'invite', label: 'Invite guests', icon: '◈' },
            { id: 'insights', label: 'Party insights', icon: '↗' },
            { id: 'settings', label: 'Settings', icon: '⚙' },
          ]}
        />
        <div className="dashboard-content">
          <div hidden={menu !== 'session'}>
            <PlaybackPanel
              partyId={party.id}
              token={token}
              active={party.status === 'ACTIVE'}
              refresh={queueRefresh}
              onExpired={onExpired}
              onConfigureBackup={() => setMenu('settings')}
            />
          </div>
          <div hidden={menu !== 'live'}>
            <QueueBoard
              role="admin"
              token={token}
              refresh={queueRefresh}
              onExpired={onExpired}
              onChange={() => setQueueRefresh((value) => value + 1)}
            />
          </div>
          <div hidden={menu !== 'requests'}>
            <RequestBoard
              role="admin"
              token={token}
              active={party.status === 'ACTIVE'}
              onExpired={onExpired}
              onChange={() => setQueueRefresh((value) => value + 1)}
            />
          </div>
          <div hidden={menu !== 'invite'}>
            <section aria-label="Party links">
              <h2>Invite your guests</h2>
              <PartyLinks
                links={party.links}
                active={party.status === 'ACTIVE'}
              />
            </section>
          </div>
          <div hidden={menu !== 'insights'}>
            <details className="event-history" open={party.status === 'ENDED'}>
              <summary>View party statistics</summary>
              <PartyStatisticsPanel token={token} onExpired={onExpired} />
            </details>
            <details className="event-history" open={party.status === 'ENDED'}>
              <summary>View event song history</summary>
              <SongHistory token={token} onExpired={onExpired} />
            </details>
            <details className="event-history" open={party.status === 'ENDED'}>
              <summary>View guest leaderboard</summary>
              <LeaderboardPanel
                role="admin"
                token={token}
                refresh={queueRefresh}
                onExpired={onExpired}
              />
            </details>
          </div>
          <div hidden={menu !== 'settings'}>
            <section aria-label="Party settings">
              <h2>Party settings</h2>
              <form onSubmit={save}>
                <fieldset disabled={busy || party.status === 'ENDED'}>
                  <FloatingInput
                    label="Party name"
                    id="admin-party-name"
                    value={name}
                    required
                    maxLength={120}
                    onChange={(event) => setName(event.target.value)}
                  />
                  <div className="party-preferences">
                    {booleans.map(([key, label]) => (
                      <SwitchDisclosure
                        key={key}
                        label={label}
                        description={
                          {
                            approvalRequired:
                              'New requests wait for your approval.',
                            votingEnabled:
                              'Guests can vote for other guests’ songs.',
                            requireGuestNames:
                              'Guests enter a name before requesting songs.',
                            allowExplicitTracks:
                              'Spotify songs marked explicit are allowed.',
                          }[key]
                        }
                        checked={settings[key]}
                        onChange={(event) =>
                          setSettings({
                            ...settings,
                            [key]: event.target.checked,
                          })
                        }
                      />
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
                  <FloatingInput
                    label="Backup Spotify playlist"
                    value={backupSource}
                    onChange={(event) => setBackupSource(event.target.value)}
                    placeholder="https://open.spotify.com/playlist/…"
                  />
                  <p className="muted">
                    The session playlist is the queue. Current and the next two
                    songs are locked for everyone; all later guest songs can be
                    reordered.
                  </p>
                  <LoadingButton
                    loading={pendingAction === 'settings'}
                    succeeded={feedback === 'Settings saved.'}
                    type="submit"
                  >
                    {pendingAction === 'settings' ? 'Saving…' : 'Save settings'}
                  </LoadingButton>
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
                      <LoadingButton
                        loading={pendingAction === 'end'}
                        disabled={busy}
                        type="button"
                        onClick={() => void mutate('end')}
                      >
                        {pendingAction === 'end'
                          ? 'Ending…'
                          : 'Confirm end party'}
                      </LoadingButton>
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
                Ended parties are read-only. Create a new party from your home
                page.
              </p>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
