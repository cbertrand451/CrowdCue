import { ComponentIcon } from './ComponentIcon';
export function CarouselNavigator({
  totalSlides,
  currentIndex,
  onIndexChange,
}: {
  totalSlides: number;
  currentIndex: number;
  onIndexChange: (index: number) => void;
}) {
  return (
    <div className="statistics-card-controls carousel-navigator">
      <button
        type="button"
        className="secondary"
        aria-label="Previous statistic"
        disabled={currentIndex === 0}
        onClick={() => onIndexChange(currentIndex - 1)}
      >
        <ComponentIcon symbol="←" />
      </button>
      <div className="carousel-dots">
        {Array.from({ length: totalSlides }, (_, i) => (
          <button
            key={i}
            type="button"
            className="carousel-dot"
            aria-label={`Show statistic ${i + 1}`}
            aria-current={i === currentIndex ? 'true' : undefined}
            onClick={() => onIndexChange(i)}
          >
            <span />
          </button>
        ))}
      </div>
      <span className="visually-hidden" aria-live="polite">
        {currentIndex + 1} / {totalSlides}
      </span>
      <button
        type="button"
        className="secondary"
        aria-label="Next statistic"
        disabled={currentIndex === totalSlides - 1}
        onClick={() => onIndexChange(currentIndex + 1)}
      >
        <ComponentIcon symbol="→" />
      </button>
    </div>
  );
}
