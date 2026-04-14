import React, { useEffect, useRef, useCallback } from 'react';
import { Search, X, GitBranch, Plug, Bot, Code, LayoutDashboard, Box, FileText } from 'lucide-react';
import { useSearchStore, SearchResult } from '../store/searchStore';
import { useNavigationStore } from '../store/navigationStore';

const TYPE_META: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  object_type: { label: 'Object Type', color: '#7C3AED', icon: <Box size={13} /> },
  pipeline:    { label: 'Pipeline',    color: '#2563EB', icon: <GitBranch size={13} /> },
  connector:   { label: 'Connector',   color: '#0891B2', icon: <Plug size={13} /> },
  agent:       { label: 'Agent',       color: '#059669', icon: <Bot size={13} /> },
  logic:       { label: 'Logic',       color: '#D97706', icon: <Code size={13} /> },
  dashboard:   { label: 'Dashboard',   color: '#DB2777', icon: <LayoutDashboard size={13} /> },
  record:      { label: 'Record',      color: '#0891B2', icon: <FileText size={13} /> },
};

export const SearchModal: React.FC = () => {
  const { isOpen, query, results, loading, open, close, setQuery, search, clear } = useSearchStore();
  const { navigateTo } = useNavigationStore();
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Global Cmd+K / Ctrl+K shortcut
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        if (isOpen) close(); else open();
      }
      if (e.key === 'Escape' && isOpen) close();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isOpen, open, close]);

  // Focus input when opened
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  const handleQueryChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const q = e.target.value;
    setQuery(q);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => search(q), 200);
  }, [setQuery, search]);

  const handleSelect = useCallback((result: SearchResult) => {
    navigateTo(result.path);
    close();
  }, [navigateTo, close]);

  if (!isOpen) return null;

  // Group results by type
  const grouped: Record<string, SearchResult[]> = {};
  for (const r of results) {
    if (!grouped[r.type]) grouped[r.type] = [];
    grouped[r.type].push(r);
  }
  const typeOrder = ['record', 'object_type', 'pipeline', 'connector', 'agent', 'logic', 'dashboard'];

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={close}
        style={{
          position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.4)',
          zIndex: 9998, backdropFilter: 'blur(2px)',
        }}
      />

      {/* Modal */}
      <div style={{
        position: 'fixed', top: '15%', left: '50%', transform: 'translateX(-50%)',
        width: 560, maxWidth: 'calc(100vw - 32px)',
        backgroundColor: '#FFFFFF', borderRadius: 10,
        boxShadow: '0 20px 60px rgba(0,0,0,0.25)',
        zIndex: 9999, overflow: 'hidden',
        border: '1px solid #E2E8F0',
      }}>
        {/* Search input row */}
        <div style={{ display: 'flex', alignItems: 'center', padding: '10px 14px', borderBottom: '1px solid #E2E8F0', gap: 8 }}>
          <Search size={16} style={{ color: '#94A3B8', flexShrink: 0 }} />
          <input
            ref={inputRef}
            value={query}
            onChange={handleQueryChange}
            placeholder="Search pipelines, connectors, agents, object types..."
            style={{
              flex: 1, border: 'none', outline: 'none',
              fontSize: 14, color: '#0D1117', backgroundColor: 'transparent',
            }}
          />
          {query && (
            <button
              onClick={() => { clear(); inputRef.current?.focus(); }}
              style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2, color: '#94A3B8', display: 'flex' }}
            >
              <X size={14} />
            </button>
          )}
          <kbd style={{ fontSize: 10, color: '#94A3B8', border: '1px solid #E2E8F0', borderRadius: 3, padding: '1px 5px', fontFamily: 'monospace' }}>
            ESC
          </kbd>
        </div>

        {/* Results */}
        <div style={{ maxHeight: 420, overflowY: 'auto' }}>
          {!query && (
            <div style={{ padding: '24px 16px', textAlign: 'center', color: '#94A3B8', fontSize: 13 }}>
              Start typing to search across all your data
            </div>
          )}

          {query && loading && (
            <div style={{ padding: '20px 16px', textAlign: 'center', color: '#94A3B8', fontSize: 13 }}>
              Searching...
            </div>
          )}

          {query && !loading && results.length === 0 && (
            <div style={{ padding: '20px 16px', textAlign: 'center', color: '#94A3B8', fontSize: 13 }}>
              No results for "{query}"
            </div>
          )}

          {!loading && typeOrder.filter(t => grouped[t]?.length).map(type => {
            const meta = TYPE_META[type];
            return (
              <div key={type}>
                {/* Section header */}
                <div style={{
                  padding: '6px 14px 3px',
                  fontSize: 10, fontWeight: 600, color: '#94A3B8',
                  textTransform: 'uppercase', letterSpacing: '0.06em',
                  backgroundColor: '#F8FAFC',
                  borderBottom: '1px solid #F1F5F9',
                }}>
                  {meta.label}s
                </div>
                {grouped[type].map(result => (
                  <button
                    key={result.id}
                    onClick={() => handleSelect(result)}
                    style={{
                      width: '100%', display: 'flex', alignItems: 'center',
                      gap: 10, padding: '9px 14px',
                      background: 'none', border: 'none', cursor: 'pointer',
                      borderBottom: '1px solid #F8FAFC',
                      textAlign: 'left', transition: 'background-color 60ms',
                    }}
                    onMouseEnter={e => { (e.currentTarget as HTMLElement).style.backgroundColor = '#EFF6FF'; }}
                    onMouseLeave={e => { (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent'; }}
                  >
                    {/* Type icon */}
                    <div style={{
                      width: 26, height: 26, borderRadius: 6, flexShrink: 0,
                      backgroundColor: `${meta.color}18`,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      color: meta.color,
                    }}>
                      {meta.icon}
                    </div>
                    {/* Text */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 500, color: '#0D1117', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {result.title}
                      </div>
                      <div style={{ fontSize: 11, color: '#64748B', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {result.subtitle}
                      </div>
                    </div>
                    {/* Score badge */}
                    <div style={{
                      fontSize: 10, color: meta.color,
                      backgroundColor: `${meta.color}15`,
                      borderRadius: 3, padding: '1px 5px', flexShrink: 0,
                    }}>
                      {meta.label}
                    </div>
                  </button>
                ))}
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div style={{
          padding: '6px 14px', borderTop: '1px solid #E2E8F0',
          display: 'flex', alignItems: 'center', gap: 12,
          backgroundColor: '#F8FAFC',
        }}>
          <span style={{ fontSize: 10, color: '#94A3B8' }}>
            <kbd style={{ fontFamily: 'monospace', border: '1px solid #E2E8F0', borderRadius: 3, padding: '0 4px', fontSize: 10 }}>↵</kbd> to navigate
          </span>
          <span style={{ fontSize: 10, color: '#94A3B8' }}>
            <kbd style={{ fontFamily: 'monospace', border: '1px solid #E2E8F0', borderRadius: 3, padding: '0 4px', fontSize: 10 }}>⌘K</kbd> to toggle
          </span>
        </div>
      </div>
    </>
  );
};

export default SearchModal;
