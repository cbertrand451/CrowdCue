import { useEffect, useRef, useState } from 'react';
import { LoadingButton } from './LoadingButton';
import { Modal } from './Modal';
import {
  partyDetailsSchema,
  type PartyDetails,
} from '../server/parties/contracts.js';

export function EndPartyAction({
  party,
  onEnded,
}: {
  party: PartyDetails;
  onEnded: (party: PartyDetails) => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const pending = useRef(false);
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);
  const token = party.links.admin
    ? /^\/admin\/([A-Za-z0-9_-]{43})\/?$/.exec(
        new URL(party.links.admin).pathname,
      )?.[1]
    : undefined;
  if (party.status !== 'ACTIVE' || !token) return null;

  async function end() {
    if (pending.current) return;
    pending.current = true;
    setLoading(true);
    setError(undefined);
    const controller = new AbortController();
    request.current = controller;
    try {
      const response = await fetch(`/api/party-links/admin/${token}/end`, {
        method: 'POST',
        credentials: 'same-origin',
        signal: controller.signal,
        headers: { 'content-type': 'application/json' },
        body: '{}',
      });
      if (controller.signal.aborted) return;
      if (!response.ok) {
        setError(
          response.status === 401
            ? 'Your sign-in expired. Reconnect Spotify as this party’s host before retrying.'
            : response.status === 404
              ? 'This party is unavailable to your account. Refresh Your parties to check its status.'
              : response.status === 429
                ? 'Too many changes. Wait a moment before retrying.'
                : 'Could not confirm the party ended. Refresh Your parties to check its status before retrying.',
        );
        return;
      }
      const result = (await response.json()) as { party: unknown };
      const updated = partyDetailsSchema.parse(result.party);
      if (updated.id !== party.id || updated.status !== 'ENDED')
        throw new Error('Unconfirmed ending');
      if (!controller.signal.aborted) {
        onEnded(updated);
        setConfirming(false);
      }
    } catch {
      if (!controller.signal.aborted)
        setError(
          'Could not confirm the party ended. Refresh Your parties to check its status before retrying.',
        );
    } finally {
      pending.current = false;
      if (!controller.signal.aborted) setLoading(false);
    }
  }
  const close = () => {
    if (!pending.current) setConfirming(false);
  };
  return (
    <div className="end-party-action">
      <button
        type="button"
        className="secondary"
        aria-label={`End ${party.name}`}
        onClick={() => {
          setError(undefined);
          setConfirming(true);
        }}
      >
        End party
      </button>
      {confirming && (
        <Modal
          title={`End ${party.name}?`}
          onClose={close}
          closeDisabled={loading}
        >
          <p>
            Guests will see that this party has ended. You cannot reopen it.
            Spotify playback continues, and your session playlist stays in
            Spotify.
          </p>
          {error && <p role="alert">{error}</p>}
          <div className="party-actions">
            <LoadingButton
              type="button"
              loading={loading}
              disabled={loading}
              aria-label={`Confirm end ${party.name}`}
              onClick={() => void end()}
            >
              {loading ? 'Ending…' : 'Confirm end party'}
            </LoadingButton>
            <button
              type="button"
              className="secondary"
              disabled={loading}
              onClick={close}
            >
              Keep party active
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
