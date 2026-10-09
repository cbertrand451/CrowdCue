import { useEffect, useRef, type ReactNode } from 'react';
import { motion, MotionConfig } from 'motion/react';
export function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    const previous = document.activeElement as HTMLElement | null;
    if (dialog?.showModal) dialog.showModal();
    else dialog?.setAttribute('open', '');
    return () => {
      dialog?.close?.();
      previous?.focus();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className="cue-dialog"
      aria-label={title}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          onClose();
        }
      }}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <MotionConfig reducedMotion="user">
        <motion.div
          initial={{ opacity: 0, scale: 0.96 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ type: 'spring', bounce: 0, duration: 0.3 }}
        >
          <div className="dialog-heading">
            <h2>{title}</h2>
            <button
              type="button"
              className="secondary"
              aria-label={`Close ${title}`}
              onClick={onClose}
            >
              ×
            </button>
          </div>
          {children}
        </motion.div>
      </MotionConfig>
    </dialog>
  );
}
