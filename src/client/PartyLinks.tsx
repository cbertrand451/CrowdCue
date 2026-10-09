import { GuestQRCode } from './GuestQRCode';
import { InlineAction } from './InlineAction';
import type { PartyDetails } from '../server/parties/contracts.js';

export function PartyLinks({
  links,
  active,
}: {
  links: PartyDetails['links'];
  active: boolean;
}) {
  return (
    <div className="party-links">
      <p className="label">
        {active ? 'Share with your guests' : 'Party links'}
      </p>
      {active && <GuestQRCode url={links.guest} />}
      <a href={links.guest} rel="noreferrer">
        {links.guest}
      </a>
      <InlineAction
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
  );
}
