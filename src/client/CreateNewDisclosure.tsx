import { ComponentIcon } from './ComponentIcon';
import { useId, useState } from 'react';
import { AnimatePresence, motion, MotionConfig } from 'motion/react';

export interface DisclosureItem {
  id: string;
  icon: string;
  label: string;
  onAction: () => void;
}
export function CreateNewDisclosure({ items }: { items: DisclosureItem[] }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <MotionConfig reducedMotion="user">
      <div className="create-disclosure">
        <motion.button
          layout
          type="button"
          className="secondary"
          aria-expanded={open}
          aria-controls={id}
          onClick={() => setOpen((value) => !value)}
        >
          <span aria-hidden="true">
            <ComponentIcon symbol={open ? '×' : '+'} />
          </span>{' '}
          {open ? 'Close shortcuts' : 'Create New'}
        </motion.button>
        <AnimatePresence initial={false}>
          {open && (
            <motion.section
              id={id}
              aria-label="Host shortcuts"
              className="disclosure-panel"
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  setOpen(false);
                  event.currentTarget.parentElement
                    ?.querySelector('button')
                    ?.focus();
                }
              }}
            >
              <p className="label">Start with your party</p>
              <div className="disclosure-grid">
                {items.map((item) => (
                  <motion.button
                    type="button"
                    key={item.id}
                    className="secondary"
                    whileTap={{ scale: 0.97 }}
                    onClick={(event) => {
                      setOpen(false);
                      event.currentTarget
                        .closest('.create-disclosure')
                        ?.querySelector<HTMLButtonElement>('button')
                        ?.focus();
                      item.onAction();
                    }}
                  >
                    <span aria-hidden="true">
                      <ComponentIcon symbol={item.icon} />
                    </span>
                    {item.label}
                  </motion.button>
                ))}
              </div>
            </motion.section>
          )}
        </AnimatePresence>
      </div>
    </MotionConfig>
  );
}
