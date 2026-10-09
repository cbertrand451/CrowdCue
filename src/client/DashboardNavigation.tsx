import { motion, MotionConfig } from 'motion/react';
const shortLabels: Record<string, string> = {
  'Find a song': 'Search',
  'Live queue': 'Queue',
  'Song requests': 'Requests',
  Leaderboard: 'Scores',
  'Party details': 'Party',
  'Spotify session': 'Spotify',
  'Invite guests': 'Invite',
  'Party insights': 'Stats',
  'Your parties': 'Parties',
};
const iconPaths: Record<string, string> = {
  '⌕': 'M15 15l5 5M17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0',
  '≋': 'M4 6h16M4 12h16M4 18h10',
  '＋': 'M12 4v16M4 12h16',
  '↗': 'M4 19h16M6 15l5-5 4 3 5-8M15 5h5v5',
  '◉': 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18M12 8v8M8 12h8',
  '◈': 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h3v3h3v3h-6z',
  '⚙': 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M5 19l2-2M17 7l2-2',
};
export function DashboardNavigation({
  items,
  selected,
  onSelect,
  label,
}: {
  items: readonly { id: string; label: string; icon: string }[];
  selected: string;
  onSelect: (id: string) => void;
  label: string;
}) {
  return (
    <MotionConfig reducedMotion="user">
      <nav className="dashboard-nav dock" aria-label={label}>
        <div className="nav-heading">
          <span className="cue-mark" aria-hidden="true">
            ≋
          </span>
          <span>{label}</span>
        </div>
        {items.map((item) => (
          <motion.button
            whileHover={{ y: -2 }}
            whileTap={{ scale: 0.96 }}
            key={item.id}
            type="button"
            aria-label={item.label}
            aria-current={selected === item.id ? 'page' : undefined}
            onClick={() => onSelect(item.id)}
          >
            <span className="nav-icon" aria-hidden="true">
              <svg
                viewBox="0 0 24 24"
                width="20"
                height="20"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.7"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d={iconPaths[item.icon] ?? iconPaths['≋']} />
              </svg>
            </span>
            <span className="nav-label">{item.label}</span>
            <span className="nav-short-label" aria-hidden="true">
              {shortLabels[item.label] ?? item.label}
            </span>
          </motion.button>
        ))}
      </nav>
    </MotionConfig>
  );
}
