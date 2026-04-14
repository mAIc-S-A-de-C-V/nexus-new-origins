import React from 'react';
import { ChevronRight, Search } from 'lucide-react';
import { useNavigationStore, BreadcrumbItem } from '../../store/navigationStore';
import { ThemeToggle } from './ThemeToggle';
import { NotificationBell } from '../../shell/NotificationBell';
import { useSearchStore } from '../../store/searchStore';

export const Breadcrumb: React.FC = () => {
  const { breadcrumbs, navigateTo } = useNavigationStore();
  const { open } = useSearchStore();

  return (
    <div style={{
      height: 34,
      display: 'flex',
      alignItems: 'center',
      padding: '0 12px 0 20px',
      borderBottom: '1px solid var(--color-border)',
      backgroundColor: 'var(--color-surface)',
      gap: 4,
      flexShrink: 0,
      overflow: 'hidden',
    }}>
      {breadcrumbs.map((crumb: BreadcrumbItem, i: number) => {
        const isLast = i === breadcrumbs.length - 1;
        return (
          <React.Fragment key={i}>
            {i > 0 && (
              <ChevronRight size={12} style={{ color: 'var(--color-text-subtle)', flexShrink: 0 }} />
            )}
            {!isLast && crumb.page ? (
              <button
                onClick={() => navigateTo(crumb.page!)}
                style={{
                  background: 'none',
                  border: 'none',
                  padding: '0 2px',
                  fontSize: 12,
                  color: 'var(--color-text-muted)',
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                  transition: 'color 80ms',
                }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = 'var(--color-text)'; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = 'var(--color-text-muted)'; }}
              >
                {crumb.label}
              </button>
            ) : (
              <span style={{
                fontSize: 12,
                fontWeight: isLast ? 500 : 400,
                color: isLast ? 'var(--color-text)' : 'var(--color-text-muted)',
                padding: '0 2px',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}>
                {crumb.label}
              </span>
            )}
          </React.Fragment>
        );
      })}

      {/* Search trigger */}
      <button
        onClick={open}
        style={{
          marginLeft: 'auto',
          display: 'flex', alignItems: 'center', gap: 6,
          height: 24, padding: '0 10px',
          border: '1px solid var(--color-border)',
          borderRadius: 5,
          backgroundColor: 'var(--color-surface-raised, #F8FAFC)',
          cursor: 'pointer',
          fontSize: 11, color: 'var(--color-text-muted)',
          flexShrink: 0,
          transition: 'border-color 80ms, background-color 80ms',
        }}
        onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = '#2563EB'; (e.currentTarget as HTMLElement).style.backgroundColor = '#EFF6FF'; }}
        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--color-border)'; (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-surface-raised, #F8FAFC)'; }}
      >
        <Search size={11} />
        <span>Search</span>
        <kbd style={{ fontSize: 9, fontFamily: 'monospace', border: '1px solid var(--color-border)', borderRadius: 2, padding: '0 3px', marginLeft: 2 }}>⌘K</kbd>
      </button>

      {/* Bell + theme always in top-right of this bar */}
      <div style={{ marginLeft: 8, display: 'flex', alignItems: 'center', gap: 2, flexShrink: 0 }}>
        <ThemeToggle />
        <NotificationBell />
      </div>
    </div>
  );
};

export default Breadcrumb;
