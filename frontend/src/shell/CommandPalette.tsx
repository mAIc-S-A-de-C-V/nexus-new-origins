import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Search, Workflow, Bot, Network, Plug, Command } from 'lucide-react';
import { useUiStore } from '../store/uiStore';
import { useNavigationStore } from '../store/navigationStore';
import { usePipelineStore } from '../store/pipelineStore';
import { useAgentStore } from '../store/agentStore';
import { useConnectorStore } from '../store/connectorStore';
import type { Pipeline } from '../types/pipeline';
import type { AgentConfig } from '../store/agentStore';
import type { ConnectorConfig } from '../types/connector';

interface Result {
  id: string;
  label: string;
  sublabel?: string;
  category: string;
  icon: React.ReactNode;
  action: () => void;
}

const NAV_ITEMS = [
  { id: 'connectors',    label: 'Connectors',    icon: <Plug size={14} />,     page: 'connectors' },
  { id: 'ontology',      label: 'Ontology',       icon: <Network size={14} />,  page: 'ontology' },
  { id: 'pipelines',     label: 'Pipelines',      icon: <Workflow size={14} />, page: 'pipelines' },
  { id: 'agents',        label: 'Agent Studio',   icon: <Bot size={14} />,      page: 'agents' },
  { id: 'human-actions', label: 'Actions Queue',  icon: <Command size={14} />,  page: 'human-actions' },
  { id: 'events',        label: 'Event Log',      icon: <Search size={14} />,   page: 'events' },
  { id: 'process',       label: 'Process Mining', icon: <Search size={14} />,   page: 'process' },
  { id: 'logic',         label: 'Logic Studio',   icon: <Search size={14} />,   page: 'logic' },
];

const KBD: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <span style={{
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    minWidth: 20, height: 18, padding: '0 4px',
    fontSize: 10, fontFamily: 'var(--font-mono)',
    color: 'var(--color-text-subtle)',
    border: '1px solid var(--color-border-emphasis)',
    borderRadius: 3,
    backgroundColor: 'var(--color-base)',
  }}>
    {children}
  </span>
);

export const CommandPalette: React.FC = () => {
  const { commandPaletteOpen, closeCommandPalette } = useUiStore();
  const { navigateTo } = useNavigationStore();
  const [query, setQuery] = useState('');
  const [activeIdx, setActiveIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Gather searchable items from stores
  const pipelines: Pipeline[] = usePipelineStore((s) => s.pipelines);
  const agents: AgentConfig[] = useAgentStore((s) => s.agents);
  const connectors: ConnectorConfig[] = useConnectorStore((s) => s.connectors);

  const buildResults = useCallback((): Result[] => {
    const q = query.toLowerCase().trim();

    const nav: Result[] = NAV_ITEMS
      .filter((item) => !q || item.label.toLowerCase().includes(q) || item.id.includes(q))
      .map((item) => ({
        id: `nav-${item.id}`,
        label: item.label,
        category: 'Navigate',
        icon: item.icon,
        action: () => { navigateTo(item.page); closeCommandPalette(); },
      }));

    const pipelineResults: Result[] = (pipelines || [])
      .filter((p) => !q || p.name.toLowerCase().includes(q))
      .slice(0, 5)
      .map((p) => ({
        id: `pipeline-${p.id}`,
        label: p.name,
        sublabel: 'Pipeline',
        category: 'Pipelines',
        icon: <Workflow size={14} />,
        action: () => { navigateTo('pipelines'); closeCommandPalette(); },
      }));

    const agentResults: Result[] = (agents || [])
      .filter((a) => !q || a.name.toLowerCase().includes(q))
      .slice(0, 5)
      .map((a) => ({
        id: `agent-${a.id}`,
        label: a.name,
        sublabel: 'Agent',
        category: 'Agents',
        icon: <Bot size={14} />,
        action: () => { navigateTo('agents'); closeCommandPalette(); },
      }));

    const connectorResults: Result[] = (connectors || [])
      .filter((c) => !q || c.name.toLowerCase().includes(q))
      .slice(0, 5)
      .map((c) => ({
        id: `connector-${c.id}`,
        label: c.name,
        sublabel: (c as ConnectorConfig).type || 'Connector',
        category: 'Connectors',
        icon: <Plug size={14} />,
        action: () => { navigateTo('connectors'); closeCommandPalette(); },
      }));

    return [...nav, ...pipelineResults, ...agentResults, ...connectorResults];
  }, [query, pipelines, agents, connectors]);

  const results = buildResults();

  useEffect(() => { setActiveIdx(0); }, [query]);

  useEffect(() => {
    if (commandPaletteOpen) {
      setQuery('');
      setActiveIdx(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [commandPaletteOpen]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!commandPaletteOpen) return;
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveIdx((i) => Math.min(i + 1, results.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveIdx((i) => Math.max(i - 1, 0));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        results[activeIdx]?.action();
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [commandPaletteOpen, results, activeIdx]);

  // Scroll active item into view
  useEffect(() => {
    const el = listRef.current?.querySelector(`[data-idx="${activeIdx}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [activeIdx]);

  if (!commandPaletteOpen) return null;

  // Group results by category
  const grouped: Record<string, Result[]> = {};
  for (const r of results) {
    if (!grouped[r.category]) grouped[r.category] = [];
    grouped[r.category].push(r);
  }

  let globalIdx = 0;

  return createPortal(
    <div
      className="cmd-backdrop"
      onClick={closeCommandPalette}
      style={{
        position: 'fixed', inset: 0,
        backgroundColor: 'rgba(0,0,0,0.45)',
        zIndex: 9000,
        display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
        paddingTop: '15vh',
      }}
    >
      <div
        className="cmd-panel"
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 560, maxHeight: 440,
          backgroundColor: 'var(--color-surface-elevated, #FFFFFF)',
          border: '1px solid var(--color-border-emphasis)',
          borderRadius: 8,
          boxShadow: '0 24px 48px rgba(0,0,0,0.2)',
          display: 'flex', flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        {/* Search input */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '0 16px',
          borderBottom: '1px solid var(--color-border)',
          height: 52, flexShrink: 0,
        }}>
          <Search size={16} style={{ color: 'var(--color-text-subtle)', flexShrink: 0 }} />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search modules, pipelines, agents, connectors..."
            style={{
              flex: 1, border: 'none', outline: 'none',
              fontSize: 14, fontFamily: 'var(--font-interface)',
              backgroundColor: 'transparent',
              color: 'var(--color-text)',
            }}
          />
          <KBD>esc</KBD>
        </div>

        {/* Results */}
        <div ref={listRef} style={{ flex: 1, overflowY: 'auto' }}>
          {results.length === 0 && (
            <div style={{
              padding: '32px 16px', textAlign: 'center',
              fontSize: 13, color: 'var(--color-text-muted)',
            }}>
              No results for "{query}"
            </div>
          )}
          {Object.entries(grouped).map(([category, items]) => (
            <div key={category}>
              <div style={{
                padding: '8px 16px 4px',
                fontSize: 10, fontWeight: 700, letterSpacing: '0.06em',
                textTransform: 'uppercase', color: 'var(--color-text-subtle)',
                borderTop: '1px solid var(--color-border)',
              }}>
                {category}
              </div>
              {items.map((r) => {
                const idx = globalIdx++;
                const isActive = idx === activeIdx;
                return (
                  <div
                    key={r.id}
                    data-idx={idx}
                    onClick={r.action}
                    onMouseEnter={() => setActiveIdx(idx)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 10,
                      padding: '9px 16px', cursor: 'pointer',
                      backgroundColor: isActive ? 'var(--color-interactive-dim)' : 'transparent',
                      transition: 'background-color 60ms',
                    }}
                  >
                    <span style={{
                      color: isActive ? 'var(--color-interactive)' : 'var(--color-text-muted)',
                      flexShrink: 0, lineHeight: 0,
                    }}>
                      {r.icon}
                    </span>
                    <span style={{ flex: 1, fontSize: 13, fontWeight: 500, color: 'var(--color-text)' }}>
                      {r.label}
                    </span>
                    {r.sublabel && (
                      <span style={{ fontSize: 11, color: 'var(--color-text-subtle)' }}>
                        {r.sublabel}
                      </span>
                    )}
                    {isActive && <KBD>↵</KBD>}
                  </div>
                );
              })}
            </div>
          ))}
        </div>

        {/* Footer */}
        <div style={{
          height: 36, padding: '0 16px',
          borderTop: '1px solid var(--color-border)',
          display: 'flex', alignItems: 'center', gap: 12,
          fontSize: 11, color: 'var(--color-text-subtle)',
          flexShrink: 0,
        }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}><KBD>↑</KBD><KBD>↓</KBD> navigate</span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}><KBD>↵</KBD> select</span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}><KBD>esc</KBD> close</span>
          <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 4 }}>
            <KBD>⌘</KBD><KBD>K</KBD>
          </span>
        </div>
      </div>
    </div>,
    document.body,
  );
};

export default CommandPalette;
