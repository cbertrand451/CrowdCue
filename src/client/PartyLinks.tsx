import { GuestQRCode } from './GuestQRCode';
import { useRef, useState } from 'react';
import { LoadingButton } from './LoadingButton';
import type { PartyDetails } from '../server/parties/contracts.js';

export function PartyLinks({
  links,
  active,
}: {
  links: PartyDetails['links'];
  active: boolean;
}) {
  const [feedback, setFeedback] = useState<string>();
  const [copying, setCopying] = useState(false);
  const copyingRef = useRef(false);
  async function copyGuestLink() {
    if (copyingRef.current) return;
    copyingRef.current = true;
    setCopying(true);
    setFeedback(undefined);
    try {
      await navigator.clipboard.writeText(links.guest);
      setFeedback('Guest link copied.');
    } catch {
      setFeedback('Copy the guest link below to share it.');
    } finally {
      copyingRef.current = false;
      setCopying(false);
    }
  }
  return (
    <div className="party-links">
      <p className="label">
        {active ? 'Share with your guests' : 'Party links'}
      </p>
      {active && <GuestQRCode url={links.guest} />}
      <a href={links.guest} rel="noreferrer">
        {links.guest}
      </a>
      <LoadingButton
        loading={copying}
        loadingLabel="Copying guest link…"
        succeeded={feedback === 'Guest link copied.'}
        type="button"
        className="secondary"
        onClick={() => void copyGuestLink()}
      >
        Copy guest link
      </LoadingButton>
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
      {feedback && <p aria-live="polite">{feedback}</p>}
    </div>
  );
}
