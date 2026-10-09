import { motion, MotionConfig } from 'motion/react';
import { LoadingButton } from './LoadingButton';
export function QuickFeedback({
  voted,
  loading,
  disabled,
  onChange,
}: {
  voted: boolean;
  loading: boolean;
  disabled: boolean;
  onChange: (voted: boolean) => void;
}) {
  return (
    <MotionConfig reducedMotion="user">
      <motion.div layout className="quick-feedback" data-voted={voted}>
        <LoadingButton
          className="secondary"
          loading={loading}
          aria-pressed={voted}
          disabled={disabled}
          onClick={() => onChange(!voted)}
          aria-label={loading ? 'Saving vote…' : voted ? 'Remove vote' : 'Vote'}
        >
          <svg
            aria-hidden="true"
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
          >
            <path d="M7 10v11H3V10zM7 10l5-7c2 0 2 2 1 6h6c2 0 2 2 1 4l-2 7H7" />
          </svg>
          {loading ? 'Saving vote…' : voted ? 'Undo vote' : 'Vote'}
        </LoadingButton>
        {voted && <span className="muted">You voted</span>}
      </motion.div>
    </MotionConfig>
  );
}
