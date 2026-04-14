import React from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { useUiStore } from '../store/uiStore';
import { useShortcutStore, ShortcutDefinition } from '../store/shortcutStore';

const KBD: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <span style={{
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    minWidth: 22, height: 20, padding: '0 5px',
    fontSize: 11, fontFamily: 'var(--font-mono)',
    color: 'var(--color-text-muted)',
    border: '1px solid var(--color-border-emphasis)',
    borderRadius: 3,
    backgroundColor: 'var(--color-base)',
  }}>
    {children}
  </span>
);

const BUILT_IN: ShortcutDefinition[] = [
  { id: 'cmd-k',    keys: ['meta', 'k'],   display: '⌘K',  label: 'Open command palette',   category: 'navigation', handler: () => {} },
  { id: 'escape',   keys: ['Escape'],       display: 'Esc', label: 'Close active panel',      category: 'navigation', handler: () => {} },
  { id: 'question', keys: ['?'],            display: '?',   label: 'Show keyboard shortcuts', category: 'navigation', handler: () => {} },
];

const CATEGORIES: Array<ShortcutDefinition['category']> = ['navigation', 'action', 'view'];
const CATEGORY_LABELS: Record<string, string> = {
  navigation: 'Navigation',
  action: 'Actions',
  view: 'View',
};

export const ShortcutsOverlay: React.FC = () => {
  const { shortcutsOverlayOpen, closeShortcutsOverlay } = useUiStore();
  const { shortcuts } = useShortcutStore();

  if (!shortcutsOverlayOpen) return null;

  const all = [...BUILT_IN, ...shortcuts];
  const grouped: Partial<Record<ShortcutDefinition['category'], ShortcutDefinition[]>> = {};
  for (const cat of CATEGORIES) {
    const items = all.filter((s) => s.category === cat);
    if (items.length > 0) grouped[cat] = items;
  }

  return createPortal(
    <div
      onClick={closeShortcutsOverlay}
      style={{
        position: 'fixed', inset: 0,
        backgroundColor: 'rgba(0,0,0,0.4)',
        zIndex: 9000,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        animation: 'fadeIn 80ms ease-out',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 560, maxHeight: '80vh',
          backgroundColor: 'var(--color-surface-elevated, #FFFFFF)',
          border: '1px solid var(--color-border)',
          borderRadius: 8,
          boxShadow: '0 24px 48px rgba(0,0,0,0.2)',
          overflow: 'hidden',
          display: 'flex', flexDirection: 'column',
          animation: 'slideInUp 120ms ease-out',
        }}
      >
        {/* Header */}
        <div style={{
          height: 52, display: 'flex', alignItems: 'center', padding: '0 20px',
          borderBottom: '1px solid var(--color-border)',
          flexShrink: 0,
        }}>
          <span style={{ fontSize: 14, fontWeight: 600, flex: 1, color: 'var(--color-text)' }}>
            Keyboard Shortcuts
          </span>
          <button
            onClick={closeShortcutsOverlay}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-muted)', padding: 4, display: 'flex', alignItems: 'center' }}
          >
            <X size={16} />
          </button>
        </div>

        {/* Shortcuts grid */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '8px 0' }}>
          {Object.entries(grouped).map(([cat, items]) => (
            <div key={cat} style={{ padding: '12px 20px' }}>
              <div style={{
                fontSize: 10, fontWeight: 700, letterSpacing: '0.07em',
                textTransform: 'uppercase', color: 'var(--color-text-subtle)',
                marginBottom: 8,
              }}>
                {CATEGORY_LABELS[cat] || cat}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 24px' }}>
                {(items as ShortcutDefinition[]).map((s) => (
                  <div key={s.id} style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '6px 0',
                    borderBottom: '1px solid var(--color-border)',
                  }}>
                    <span style={{ fontSize: 12, color: 'var(--color-text)' }}>
                      {s.label}
                    </span>
                    <div style={{ display: 'flex', gap: 3, alignItems: 'center' }}>
                      {s.display.split('').map((ch, i) => (
                        <KBD key={i}>{ch === '⌘' ? '⌘' : ch}</KBD>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div style={{
          height: 36, padding: '0 20px',
          borderTop: '1px solid var(--color-border)',
          display: 'flex', alignItems: 'center',
          fontSize: 11, color: 'var(--color-text-subtle)',
          flexShrink: 0,
        }}>
          Press <span style={{ margin: '0 4px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', minWidth: 22, height: 20, padding: '0 5px', fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--color-text-muted)', border: '1px solid var(--color-border-emphasis)', borderRadius: 3, backgroundColor: 'var(--color-base)' }}>?</span> or <span style={{ margin: '0 4px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', minWidth: 22, height: 20, padding: '0 5px', fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--color-text-muted)', border: '1px solid var(--color-border-emphasis)', borderRadius: 3, backgroundColor: 'var(--color-base)' }}>esc</span> to close
        </div>
      </div>
    </div>,
    document.body,
  );
};

export default ShortcutsOverlay;
