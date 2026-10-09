import { useId, type InputHTMLAttributes } from 'react';
import { AnimatePresence, motion, MotionConfig } from 'motion/react';
export function SwitchDisclosure({
  label,
  description,
  ...props
}: Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> & {
  label: string;
  description?: string;
}) {
  const id = useId();
  return (
    <MotionConfig reducedMotion="user">
      <div className="switch-disclosure">
        <label className="switch-row">
          <span>{label}</span>
          <input
            {...props}
            type="checkbox"
            aria-describedby={props.checked && description ? id : undefined}
          />
          <span className="switch-track" aria-hidden="true">
            <span />
          </span>
        </label>
        <AnimatePresence initial={false}>
          {props.checked && description && (
            <motion.p
              id={id}
              className="muted"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
            >
              {description}
            </motion.p>
          )}
        </AnimatePresence>
      </div>
    </MotionConfig>
  );
}
