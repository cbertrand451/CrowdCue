import { ComponentIcon } from './ComponentIcon';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { AnimatePresence, motion, MotionConfig } from 'motion/react';

export function InlineDisclosureMenu({
  visibleActions,
  hiddenActions,
  label,
  disabled,
}: {
  visibleActions: ReactNode;
  hiddenActions: ReactNode;
  label: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    function close(event: PointerEvent) {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [open]);
  return (
    <MotionConfig reducedMotion="user">
      <motion.div
        layout
        className="inline-overflow inline-disclosure-menu"
        ref={ref}
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget))
            setOpen(false);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape' && open) {
            setOpen(false);
            event.currentTarget
              .querySelector<HTMLButtonElement>('[aria-controls]')
              ?.focus();
          }
        }}
      >
        {visibleActions}
        <AnimatePresence initial={false}>
          {open && (
            <motion.div
              id={id}
              className="overflow-extra"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
            >
              {hiddenActions}
            </motion.div>
          )}
        </AnimatePresence>
        <motion.button
          layout
          type="button"
          className="secondary overflow-toggle"
          disabled={disabled}
          aria-label={label}
          aria-expanded={open}
          aria-controls={id}
          onClick={() => setOpen((value) => !value)}
          whileTap={{ scale: 0.96 }}
        >
          <span aria-hidden="true">
            <ComponentIcon symbol={open ? '×' : '⋯'} />
          </span>
        </motion.button>
      </motion.div>
    </MotionConfig>
  );
}
