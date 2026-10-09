import type { ReactNode } from 'react';
export function ExpandDetails({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <details className="expand-details">
      <summary>{title}</summary>
      <div>{children}</div>
    </details>
  );
}
