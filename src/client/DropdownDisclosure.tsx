import { useEffect, useId, useRef, useState } from 'react';
import { AnimatePresence, motion, MotionConfig } from 'motion/react';
import { ComponentIcon } from './ComponentIcon';
export interface DisclosureOption {
  id: string;
  label: string;
  description?: string;
}
export function DropdownDisclosure({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: DisclosureOption[];
  value: string;
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const id = useId();
  useEffect(() => {
    if (!open) return;
    function close(e: PointerEvent) {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [open]);
  return (
    <MotionConfig reducedMotion="user">
      <div
        className="dropdown-disclosure"
        ref={ref}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            setOpen(false);
            trigger.current?.focus();
          }
        }}
        onBlur={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget)) setOpen(false);
        }}
      >
        <motion.button
          ref={trigger}
          type="button"
          className="secondary"
          aria-label={label}
          aria-expanded={open}
          aria-controls={id}
          onClick={() => setOpen(!open)}
          whileTap={{ scale: 0.97 }}
        >
          {options.find((o) => o.id === value)?.label ?? label}
          <ComponentIcon symbol={open ? '⌃' : '⌄'} />
        </motion.button>
        <AnimatePresence initial={false}>
          {open && (
            <motion.div
              id={id}
              className="disclosure-options"
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
            >
              {options.map((o) => (
                <button
                  key={o.id}
                  type="button"
                  className="secondary"
                  aria-pressed={o.id === value}
                  onClick={() => {
                    onChange(o.id);
                    setOpen(false);
                    trigger.current?.focus();
                  }}
                >
                  <span>{o.label}</span>
                  {o.description && <small>{o.description}</small>}
                </button>
              ))}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </MotionConfig>
  );
}
