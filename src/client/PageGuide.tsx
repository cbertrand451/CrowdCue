import type { PublicParty } from '../server/parties/contracts.js';
import { FeatureTour } from './FeatureTour';

export function PageGuide({
  role,
  party,
  onSetupHelp,
}: {
  role: 'guest' | 'admin';
  party: PublicParty;
  onSetupHelp?: () => void;
}) {
  if (party.status !== 'ACTIVE') return null;
  const steps =
    role === 'admin'
      ? [
          [
            'Set up your session',
            'Add a backup Spotify playlist in Settings, then choose Start session in Spotify session.',
          ],
          [
            'Play in Spotify',
            'Open the new session playlist in Spotify and press Play. Turn off Shuffle, Smart Shuffle and Repeat.',
          ],
          [
            'Invite and manage',
            'Share the QR code or guest link from Invite guests. Review Requests and follow the Live queue.',
          ],
        ]
      : [
          [
            'Join and request',
            `${party.settings.requireGuestNames ? 'Join with your name.' : 'Join with a name or continue as a guest — no account needed.'} Find a song, then choose Request song.`,
          ],
          [
            party.settings.votingEnabled
              ? 'Vote for a pick'
              : 'Check your requests',
            party.settings.votingEnabled
              ? `Open Song requests to vote for another guest’s pick.${party.settings.approvalRequired ? ' Requests need host approval first.' : ''}`
              : party.settings.approvalRequired
                ? 'Open Song requests to check your picks. The host must approve them; voting is off.'
                : 'Open Song requests to check your picks. Voting is off at this party.',
          ],
          [
            'Follow the queue',
            'Open Live queue to see what’s next. The current song and next two are locked; the host controls playback in Spotify.',
          ],
        ];
  return (
    <section
      className="page-guide"
      aria-label={role === 'admin' ? 'Host instructions' : 'Guest instructions'}
    >
      <div className="page-guide-heading">
        <h2>{role === 'admin' ? 'Host quick start' : 'How to join in'}</h2>
        {role === 'guest' ? (
          <FeatureTour />
        ) : (
          onSetupHelp && (
            <button type="button" className="secondary" onClick={onSetupHelp}>
              Setup help
            </button>
          )
        )}
      </div>
      <ol className="page-guide-steps">
        {steps.map(([title, text]) => (
          <li key={title}>
            <strong>{title}</strong>
            <p>{text}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}
