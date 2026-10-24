import type { ReactNode } from 'react';
import { Icon, type IconName } from './ui/Icon';

/** Empty views explain what goes here and offer the action that fills it. */
export function EmptyState({
  icon,
  title,
  children,
  actions,
  compact,
}: {
  icon: IconName;
  title: string;
  children?: ReactNode;
  actions?: ReactNode;
  compact?: boolean;
}) {
  return (
    <div className={`empty ${compact ? 'empty-compact' : ''}`}>
      <span className="empty-icon" aria-hidden="true">
        <Icon name={icon} size={compact ? 18 : 22} />
      </span>
      <h3 className="empty-title">{title}</h3>
      {children && <p className="empty-text">{children}</p>}
      {actions && <div className="empty-actions">{actions}</div>}
    </div>
  );
}

export function SkeletonRows({ rows = 4, height = 44 }: { rows?: number; height?: number }) {
  return (
    <div aria-busy="true" aria-label="Loading" style={{ display: 'grid', gap: 6 }}>
      {Array.from({ length: rows }, (_, i) => (
        <span key={i} className="skeleton" style={{ height, opacity: 1 - i * 0.15 }} />
      ))}
    </div>
  );
}
