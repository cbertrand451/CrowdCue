import { ComponentIcon } from './ComponentIcon';
import { useId, useState } from 'react';
import { AnimatePresence, motion, MotionConfig } from 'motion/react';

export interface OnboardingStep {
  id: string;
  title: string;
  isCompleted: boolean;
  onAction?: () => void;
}
export function OnboardingChecklist({
  steps,
  title = 'Session setup',
}: {
  steps: OnboardingStep[];
  title?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const id = useId();
  const completed = steps.filter((step) => step.isCompleted).length;
  return (
    <MotionConfig reducedMotion="user">
      <motion.section
        layout
        className="onboarding-checklist"
        aria-label={title}
      >
        <button
          type="button"
          className="checklist-header secondary"
          aria-expanded={expanded}
          aria-controls={id}
          onClick={() => setExpanded((value) => !value)}
        >
          <span>
            <span aria-hidden="true">
              <ComponentIcon symbol={expanded ? '⌃' : '⌄'} />
            </span>{' '}
            {title}
          </span>
          <span className="checklist-progress">
            <span className="checklist-bars" aria-hidden="true">
              {Array.from({ length: 14 }, (_, index) => (
                <i
                  key={index}
                  data-complete={
                    steps.length > 0 && index < (completed / steps.length) * 14
                  }
                />
              ))}
            </span>
            <span>
              {completed}/{steps.length}
            </span>
          </span>
        </button>
        <AnimatePresence initial={false}>
          {expanded && (
            <motion.ol
              id={id}
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="checklist-steps"
            >
              {steps.map((step, index) => (
                <li key={step.id} data-complete={step.isCompleted}>
                  <span className="step-marker" aria-hidden="true">
                    {step.isCompleted ? '✓' : index + 1}
                  </span>
                  {step.onAction && !step.isCompleted ? (
                    <button
                      type="button"
                      className="secondary"
                      onClick={step.onAction}
                    >
                      {step.title}
                      <ComponentIcon symbol="→" />
                    </button>
                  ) : (
                    <span>{step.title}</span>
                  )}
                  <span className="step-status">
                    {step.isCompleted ? 'Complete' : 'Pending'}
                  </span>
                </li>
              ))}
            </motion.ol>
          )}
        </AnimatePresence>
      </motion.section>
    </MotionConfig>
  );
}
