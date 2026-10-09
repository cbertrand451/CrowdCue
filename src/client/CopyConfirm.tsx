import { ComponentIcon } from './ComponentIcon';
import { useEffect, useRef, useState } from 'react';
import { motion, MotionConfig } from 'motion/react';
import { LoadingButton } from './LoadingButton';

// Supplied CopyConfirm, with the app's shared pending treatment and real errors.
export function CopyConfirm({
  label,
  actionText,
  onAction,
}: {
  label: string;
  actionText: string;
  onAction: () => Promise<void>;
}) {
  const [status, setStatus] = useState<'idle' | 'loading' | 'success'>('idle');
  const [error, setError] = useState<string>();
  const pending = useRef(false);
  useEffect(() => {
    if (status !== 'success') return;
    const timer = setTimeout(() => setStatus('idle'), 2000);
    return () => clearTimeout(timer);
  }, [status]);
  async function run() {
    if (pending.current) return;
    pending.current = true;
    setStatus('loading');
    setError(undefined);
    try {
      await onAction();
      setStatus('success');
    } catch {
      setStatus('idle');
      setError('Copy the guest link above to share it.');
    } finally {
      pending.current = false;
    }
  }
  return (
    <MotionConfig reducedMotion="user">
      <div className="inline-action-wrap">
        <motion.div
          layout
          className="inline-action copy-confirm"
          transition={{ type: 'spring', stiffness: 400, damping: 35 }}
        >
          <span className="inline-action-label">
            <span className="component-symbol" aria-hidden="true">
              <ComponentIcon symbol="↗" />
            </span>
            {label}
          </span>
          <LoadingButton
            loading={status === 'loading'}
            succeeded={status === 'success'}
            loadingLabel="Copying guest link…"
            aria-label={actionText}
            className="secondary"
            onClick={() => void run()}
          >
            {status === 'success' ? 'Copied' : actionText}
          </LoadingButton>
        </motion.div>
        {status === 'success' && (
          <p role="status" className="ready">
            Guest link copied.
          </p>
        )}
        {error && <p role="alert">{error}</p>}
      </div>
    </MotionConfig>
  );
}
