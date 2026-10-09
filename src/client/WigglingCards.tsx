import { CarouselNavigator } from './CarouselNavigator';
import { useRef, useState } from 'react';
import { motion, MotionConfig, useReducedMotion } from 'motion/react';

export interface StatisticCard {
  label: string;
  value: number;
}
// A bounded, scroll-snapping adaptation: counts remain readable without drag.
export function WigglingCards({ cards }: { cards: StatisticCard[] }) {
  const [index, setIndex] = useState(0);
  const track = useRef<HTMLDListElement>(null);
  const reducedMotion = useReducedMotion();
  function select(next: number) {
    const bounded = Math.max(0, Math.min(cards.length - 1, next));
    setIndex(bounded);
    const target = track.current?.children[bounded] as HTMLElement | undefined;
    target?.scrollIntoView?.({
      behavior: reducedMotion ? 'instant' : 'smooth',
      block: 'nearest',
      inline: 'start',
    });
  }
  if (!cards.length) return null;
  return (
    <MotionConfig reducedMotion="user">
      <div className="wiggling-cards" aria-label="Session totals">
        <dl
          ref={track}
          className="statistics-card-track"
          onScroll={() => {
            const element = track.current;
            const first = element?.children[0] as HTMLElement | undefined;
            if (element && first?.offsetWidth)
              setIndex(
                Math.min(
                  cards.length - 1,
                  Math.round(element.scrollLeft / (first.offsetWidth + 16)),
                ),
              );
          }}
        >
          {cards.map((card) => (
            <motion.div
              key={card.label}
              className="statistics-card"
              whileHover={reducedMotion ? undefined : { rotate: -1.5, y: -3 }}
              transition={{ type: 'spring', stiffness: 300, damping: 30 }}
            >
              <dt>{card.label}</dt>
              <dd>{card.value}</dd>
            </motion.div>
          ))}
        </dl>
        <CarouselNavigator
          totalSlides={cards.length}
          currentIndex={index}
          onIndexChange={select}
        />
      </div>
    </MotionConfig>
  );
}
