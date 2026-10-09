import { useState } from 'react';
import { AnimatePresence, motion, MotionConfig } from 'motion/react';
import { Modal } from './Modal';
const steps = [
  {
    title: 'Find your song',
    description:
      'Search Spotify and request a song. Party rules decide whether the host needs to approve it.',
  },
  {
    title: 'Support another pick',
    description:
      'When voting is enabled, vote for another guest’s request. You can undo your vote until the song is locked.',
  },
  {
    title: 'Follow the live queue',
    description:
      'The host plays music through Spotify. The current song and next two songs are locked; later requests can still change.',
  },
];
export function FeatureTour() {
  const [open, setOpen] = useState(false);
  const [index, setIndex] = useState(0);
  return (
    <>
      <button
        type="button"
        className="secondary"
        onClick={() => {
          setIndex(0);
          setOpen(true);
        }}
      >
        How CrowdCue works
      </button>
      {open && (
        <Modal title="How CrowdCue works" onClose={() => setOpen(false)}>
          <MotionConfig reducedMotion="user">
            <p className="muted" aria-live="polite">
              Step {index + 1} of {steps.length}
            </p>
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={index}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
              >
                <h3>{steps[index].title}</h3>
                <p>{steps[index].description}</p>
              </motion.div>
            </AnimatePresence>
            <div className="party-actions">
              <button
                type="button"
                className="secondary"
                disabled={index === 0}
                onClick={() => setIndex(index - 1)}
              >
                Previous tip
              </button>
              <button
                type="button"
                onClick={() =>
                  index === steps.length - 1
                    ? setOpen(false)
                    : setIndex(index + 1)
                }
              >
                {index === steps.length - 1 ? 'Done' : 'Next tip'}
              </button>
            </div>
          </MotionConfig>
        </Modal>
      )}
    </>
  );
}
