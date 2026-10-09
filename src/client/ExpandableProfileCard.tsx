import { ComponentIcon } from './ComponentIcon';
import { useId, useState } from 'react';
import { motion, MotionConfig } from 'motion/react';
import { Modal } from './Modal';

export function ExpandableProfileCard({
  name,
  active,
  onEdit,
}: {
  name: string | null;
  active: boolean;
  onEdit: () => void;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const title = name || 'a guest';
  return (
    <MotionConfig reducedMotion="user">
      <div className="guest-profile">
        <motion.button
          layoutId={id}
          type="button"
          className="profile-card secondary"
          aria-label="View guest profile"
          aria-haspopup="dialog"
          onClick={() => setOpen(true)}
          whileHover={{ y: -2 }}
        >
          <span className="profile-avatar" aria-hidden="true">
            {(name || 'Guest').slice(0, 1).toUpperCase()}
          </span>
          <span>
            <span className="profile-eyebrow">Your guest profile</span>
            <span className="ready">Joined as {title}.</span>
          </span>
          <ComponentIcon symbol="↗" />
        </motion.button>
        {active && (
          <button type="button" className="secondary" onClick={onEdit}>
            Edit Guest Name
          </button>
        )}
        {open && (
          <Modal title="Your guest profile" onClose={() => setOpen(false)}>
            <motion.div layoutId={id} className="profile-expanded">
              <span className="profile-avatar" aria-hidden="true">
                {(name || 'Guest').slice(0, 1).toUpperCase()}
              </span>
              <h3>{name || 'Guest'}</h3>
              <p className="muted">
                Your name appears with your requests and on the party
                leaderboard. This profile belongs to your guest session on this
                device.
              </p>
              {active && (
                <button
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    onEdit();
                  }}
                >
                  Change your name
                </button>
              )}
            </motion.div>
          </Modal>
        )}
      </div>
    </MotionConfig>
  );
}
