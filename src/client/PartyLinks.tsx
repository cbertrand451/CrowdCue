import { GuestQRCode } from './GuestQRCode';
import { CopyConfirm } from './CopyConfirm';
import type { PartyDetails } from '../server/parties/contracts.js';

export function PartyLinks({
  links,
  active,
}: {
  links: PartyDetails['links'];
  active: boolean;
}) {
  return (
    <section
      className="party-links invitation-card"
      aria-label={active ? 'Guest invitation' : 'Party links'}
    >
      <p className="label">
        {active ? 'Share with your guests' : 'Party links'}
      </p>
      <div className="invitation-content">
        {active && (
          <div className="invitation-qr">
            <GuestQRCode url={links.guest} />
          </div>
        )}
        <div className="invitation-details">
          {active && (
            <p className="muted invitation-instructions">
              Guests can scan the code or open the link below to join.
            </p>
          )}
          <a className="invitation-url" href={links.guest} rel="noreferrer">
            {links.guest}
          </a>
          <CopyConfirm
            label="Invite your crowd"
            actionText="Copy guest link"
            onAction={() => navigator.clipboard.writeText(links.guest)}
          />
          <div className="party-actions">
            {links.admin && (
              <a href={links.admin} rel="noreferrer">
                Open admin
              </a>
            )}
            {links.display && (
              <a href={links.display} rel="noreferrer" target="_blank">
                Open display
              </a>
            )}
          </div>
          {links.admin && (
            <p className="muted">
              Keep your admin link private. Sign in as the host to use it.
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
