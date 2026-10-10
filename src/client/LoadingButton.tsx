import { Children, isValidElement, type ReactNode } from 'react';
import {
  AnimatePresence,
  motion,
  MotionConfig,
  useReducedMotion,
  type HTMLMotionProps,
} from 'motion/react';

type Props = Omit<HTMLMotionProps<'button'>, 'children'> & {
  children: ReactNode;
  loading: boolean;
  succeeded?: boolean;
  loadingLabel?: string;
};

function labelText(children: ReactNode): string {
  return Children.toArray(children)
    .map((child) =>
      isValidElement<{ children?: ReactNode }>(child)
        ? labelText(child.props.children)
        : String(child),
    )
    .join('');
}

// Adapted from the supplied SaveToggle. Callers own the real operation state.
export function LoadingButton({
  loading,
  succeeded = false,
  loadingLabel,
  children,
  className = '',
  disabled,
  type = 'button',
  'aria-label': ariaLabel,
  ...props
}: Props) {
  const reducedMotion = useReducedMotion();
  const state = loading ? 'loading' : succeeded ? 'saved' : 'idle';
  return (
    <MotionConfig reducedMotion="user">
      <span className="loading-button-slot">
        <span
          className="loading-button-space"
          aria-hidden="true"
          data-label={labelText(children)}
          data-succeeded={succeeded && !loading}
        />
        <motion.button
          {...props}
          type={type}
          disabled={disabled || loading}
          aria-busy={loading}
          aria-label={
            loading && loadingLabel
              ? loadingLabel
              : (ariaLabel ?? labelText(children))
          }
          className={`loading-button ${className}`}
          data-state={state}
          initial={false}
          animate={{ width: loading ? 52 : '100%', borderRadius: 999 }}
          transition={
            reducedMotion
              ? { duration: 0 }
              : { type: 'spring', stiffness: 200, damping: 20 }
          }
        >
          <AnimatePresence mode="wait" initial={false}>
            <motion.span
              key={state}
              className="loading-button-content"
              aria-hidden="true"
              initial={{ opacity: 0, y: reducedMotion ? 0 : 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: reducedMotion ? 0 : -10 }}
              transition={{ duration: reducedMotion ? 0 : 0.15 }}
            >
              {loading ? (
                <LoadingSpinner />
              ) : (
                <>
                  {disabled && !succeeded && (
                    <span className="disabled-symbol">⊘</span>
                  )}
                  {succeeded && (
                    <svg className="loading-check" viewBox="0 0 26 26">
                      <circle cx="13" cy="13" r="12" fill="currentColor" />
                      <path
                        d="m7 13 4 4 8-8"
                        fill="none"
                        stroke="var(--cue-check)"
                        strokeWidth="2.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  )}
                  {children}
                </>
              )}
            </motion.span>
          </AnimatePresence>
        </motion.button>
      </span>
    </MotionConfig>
  );
}

function LoadingSpinner() {
  return (
    <svg className="cue-loading-spinner" viewBox="0 0 26 26" aria-hidden="true">
      <circle
        cx="13"
        cy="13"
        r="10"
        stroke="currentColor"
        opacity="0.25"
        strokeWidth="3"
        fill="none"
      />
      <path
        d="M13 3 A10 10 0 0 1 23 13"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
        fill="none"
      />
    </svg>
  );
}

export function LoadingStatus({
  children,
  className = '',
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <p role="status" className={`cue-loading-status ${className}`}>
      <LoadingSpinner />
      {children}
    </p>
  );
}
