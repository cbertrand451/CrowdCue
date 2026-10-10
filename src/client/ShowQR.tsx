import { useId, useState } from 'react';
import { AnimatePresence, motion, MotionConfig } from 'motion/react';
import { GuestQRCode } from './GuestQRCode';
import { ComponentIcon } from './ComponentIcon';
import { CopyConfirm } from './CopyConfirm';
// Adapted from the supplied ShowQr; secondary sharing only.
export function ShowQR({ url }: { url: string }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <MotionConfig reducedMotion="user">
      <motion.div
        layout
        className="show-qr"
        transition={{ type: 'spring', bounce: 0.15, duration: 0.35 }}
      >
        <button
          type="button"
          className="secondary"
          aria-expanded={open}
          aria-controls={id}
          onClick={() => setOpen(!open)}
        >
          <ComponentIcon symbol="◈" />
          {open ? 'Hide QR code' : 'Show QR code'}
        </button>
        <AnimatePresence initial={false}>
          {open && (
            <motion.div
              id={id}
              className="show-qr-content"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
            >
              <GuestQRCode url={url} />
              <CopyConfirm
                label="Guest link"
                actionText="Copy guest link"
                onAction={() => navigator.clipboard.writeText(url)}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </MotionConfig>
  );
}
