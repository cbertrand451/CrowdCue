import type { ReactNode } from 'react';
import { ComponentIcon } from './ComponentIcon';
export function AlertMessage({
  children,
  action,
  onAction,
}: {
  children: ReactNode;
  action?: string;
  onAction?: () => void;
}) {
  return (
    <div className="alert-message" role="alert">
      <span aria-hidden="true" className="alert-symbol">
        !
      </span>
      <div>{children}</div>
      {action && onAction && (
        <button type="button" className="alert-action" onClick={onAction}>
          {action}
          <ComponentIcon symbol="↗" />
        </button>
      )}
    </div>
  );
}
