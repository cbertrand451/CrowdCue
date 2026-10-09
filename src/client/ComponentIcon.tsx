const paths: Record<string, string> = {
  '+': 'M12 4v16M4 12h16',
  '×': 'm6 6 12 12M18 6 6 18',
  '⋯': 'M5 12h.01M12 12h.01M19 12h.01',
  '↗': 'M7 17 17 7M7 7h10v10',
  '←': 'M19 12H5m7-7-7 7 7 7',
  '→': 'M5 12h14m-7-7 7 7-7 7',
  '⌄': 'm6 9 6 6 6-6',
  '⌃': 'm6 15 6-6 6 6',
  '≋': 'M4 6h16M4 12h16M4 18h10',
  '◉': 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18M12 8v8M8 12h8',
};

export function ComponentIcon({ symbol }: { symbol: string }) {
  return (
    <svg
      className="component-icon"
      viewBox="0 0 24 24"
      width="20"
      height="20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[symbol] ?? paths['≋']} />
    </svg>
  );
}
