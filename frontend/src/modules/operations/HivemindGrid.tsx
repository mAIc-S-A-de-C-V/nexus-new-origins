/**
 * HivemindGrid — live wall of every running pipeline, agent, connector, and
 * recent alert. Click any card to open the Run Drilldown.
 *
 * Tone: utilitarian, monitoring-console aesthetic. No glow effects, no
 * gradients — just clean status colors, a small pulse on running entities,
 * and a sticky header with aggregate counts. Same visual register as
 * AlertsPage / AgentStudio.
 */
import React, { useEffect, useMemo, useState } from 'react';
import {
  Workflow, Bot, Plug, Bell, Calendar, RefreshCw, Filter, Search,
} from 'lucide-react';
import {
  useOperationsStore, OpsCard, OpsKind, OpsStatus, timeAgoIso,
} from '../../store/operationsStore';

const C = {
  bg: '#F8FAFC',
  panel: '#FFFFFF',
  border: '#E2E8F0',
  hover: '#F1F5F9',
  text: '#0D1117',
  muted: '#64748B',
  subtle: '#94A3B8',

  accent: '#7C3AED',
  accentLight: '#EDE9FE',
  success: '#16A34A',
  successLight: '#F0FDF4',
  warn: '#D97706',
  warnLight: '#FEF3C7',
  error: '#DC2626',
  errorLight: '#FEF2F2',
  info: '#2563EB',
  infoLight: '#DBEAFE',
};

const LANES: { kind: OpsKind | 'all'; label: string; icon: React.ReactNode }[] = [
  { kind: 'all',       label: 'All',         icon: <Filter size={12} /> },
  { kind: 'pipeline',  label: 'Pipelines',   icon: <Workflow size={12} /> },
  { kind: 'agent',     label: 'Agents',      icon: <Bot size={12} /> },
  { kind: 'connector', label: 'Connectors',  icon: <Plug size={12} /> },
  { kind: 'schedule',  label: 'Schedules',   icon: <Calendar size={12} /> },
  { kind: 'alert',     label: 'Alerts',      icon: <Bell size={12} /> },
];

const statusMeta: Record<OpsStatus, { color: string; bg: string; label: string; pulse: boolean }> = {
  running: { color: C.info,    bg: C.infoLight,    label: 'Running', pulse: true  },
  success: { color: C.success, bg: C.successLight, label: 'OK',      pulse: false },
  warning: { color: C.warn,    bg: C.warnLight,    label: 'Warning', pulse: false },
  failed:  { color: C.error,   bg: C.errorLight,   label: 'Failed',  pulse: false },
  idle:    { color: C.muted,   bg: C.hover,        label: 'Idle',    pulse: false },
};

const kindMeta: Record<OpsKind, { label: string; icon: React.ReactNode; accent: string }> = {
  pipeline:  { label: 'Pipelines',   icon: <Workflow size={11} />, accent: '#2563EB' },
  agent:     { label: 'Agents',      icon: <Bot size={11} />,      accent: '#7C3AED' },
  connector: { label: 'Connectors',  icon: <Plug size={11} />,     accent: '#0891B2' },
  schedule:  { label: 'Schedules',   icon: <Calendar size={11} />, accent: '#D97706' },
  alert:     { label: 'Alerts',      icon: <Bell size={11} />,     accent: '#DC2626' },
};

// ── Card ─────────────────────────────────────────────────────────────────────

const Card: React.FC<{ card: OpsCard; onClick: () => void }> = ({ card, onClick }) => {
  const sm = statusMeta[card.status];
  const km = kindMeta[card.kind];
  return (
    <div
      onClick={onClick}
      style={{
        padding: '10px 12px',
        background: C.panel,
        border: `1px solid ${C.border}`,
        borderLeft: `3px solid ${sm.color}`,
        borderRadius: 4,
        cursor: 'pointer',
        transition: 'background 80ms, border-color 80ms',
      }}
      onMouseEnter={(e) => { e.currentTarget.style.background = C.hover; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = C.panel; }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
        <span
          aria-hidden
          style={{
            width: 6, height: 6, borderRadius: '50%',
            backgroundColor: sm.color,
            animation: sm.pulse ? 'opsPulse 1.4s ease-in-out infinite' : undefined,
            flexShrink: 0,
          }}
        />
        <span style={{
          fontSize: 12.5, fontWeight: 600, color: C.text,
          flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {card.name}
        </span>
        <span style={{
          fontSize: 10, color: sm.color, background: sm.bg,
          padding: '1px 6px', borderRadius: 3, fontWeight: 600,
        }}>{sm.label}</span>
      </div>
      <div style={{
        fontSize: 11.5, color: C.muted,
        fontFamily: 'ui-monospace, SF Mono, Menlo, monospace',
        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        marginBottom: 4,
      }}>
        {card.verb || '—'}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 10.5, color: C.subtle }}>
        <span style={{ color: km.accent, display: 'inline-flex', alignItems: 'center', gap: 3 }}>
          {km.icon}{km.label.replace(/s$/, '')}
        </span>
        {card.lastAt && <>· <span>{timeAgoIso(card.lastAt)}</span></>}
        {card.meta.model && (
          <span style={{
            marginLeft: 'auto', padding: '0 5px', borderRadius: 2,
            background: C.accentLight, color: C.accent,
            fontFamily: 'ui-monospace, SF Mono, Menlo, monospace',
          }}>{card.meta.model}</span>
        )}
      </div>
    </div>
  );
};

// ── Lane ─────────────────────────────────────────────────────────────────────

const Lane: React.FC<{
  kind: OpsKind;
  cards: OpsCard[];
  onSelect: (c: OpsCard) => void;
}> = ({ kind, cards, onSelect }) => {
  const km = kindMeta[kind];
  const counts = useMemo(() => {
    const out: Record<OpsStatus, number> = { running: 0, success: 0, warning: 0, failed: 0, idle: 0 };
    for (const c of cards) out[c.status]++;
    return out;
  }, [cards]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
      <div style={{
        padding: '8px 10px', display: 'flex', alignItems: 'center', gap: 6,
        position: 'sticky', top: 0, background: C.bg, zIndex: 1,
      }}>
        <span style={{ width: 8, height: 8, borderRadius: '50%', background: km.accent }} />
        <span style={{
          fontSize: 11, fontWeight: 700, textTransform: 'uppercase',
          letterSpacing: '.04em', color: C.muted,
        }}>{km.label}</span>
        <span style={{
          marginLeft: 'auto', fontSize: 11, color: C.subtle,
          fontFamily: 'ui-monospace, SF Mono, Menlo, monospace',
        }}>{cards.length}</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0 10px 8px',
                    fontSize: 10.5, color: C.subtle,
                    fontFamily: 'ui-monospace, SF Mono, Menlo, monospace' }}>
        {counts.running > 0 && <span style={{ color: C.info }}>● {counts.running} run</span>}
        {counts.failed > 0  && <span style={{ color: C.error }}>● {counts.failed} fail</span>}
        {counts.warning > 0 && <span style={{ color: C.warn }}>● {counts.warning} warn</span>}
        {counts.success > 0 && <span style={{ color: C.success }}>● {counts.success} ok</span>}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '0 10px 12px' }}>
        {cards.length === 0 ? (
          <div style={{
            fontSize: 11.5, color: C.subtle, padding: '8px 10px',
            border: `1px dashed ${C.border}`, borderRadius: 4, textAlign: 'center',
          }}>
            No {km.label.toLowerCase()} yet
          </div>
        ) : cards.map((c) => (
          <Card key={c.id} card={c} onClick={() => onSelect(c)} />
        ))}
      </div>
    </div>
  );
};

// ── Page shell ───────────────────────────────────────────────────────────────

export const HivemindGrid: React.FC = () => {
  const { cards, lastFetchedAt, fetchSnapshot, startPolling, stopPolling, selectRun } =
    useOperationsStore();
  const [filter, setFilter] = useState<OpsKind | 'all'>('all');
  const [search, setSearch] = useState('');

  useEffect(() => {
    startPolling(5000);
    return () => stopPolling();
  }, [startPolling, stopPolling]);

  const totals = useMemo(() => {
    const t = { running: 0, failed: 0, warning: 0, total: cards.length };
    for (const c of cards) {
      if (c.status === 'running') t.running++;
      if (c.status === 'failed')  t.failed++;
      if (c.status === 'warning') t.warning++;
    }
    return t;
  }, [cards]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return cards.filter((c) => {
      if (filter !== 'all' && c.kind !== filter) return false;
      if (q && !c.name.toLowerCase().includes(q) && !c.verb.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [cards, filter, search]);

  const grouped: Record<OpsKind, OpsCard[]> = {
    pipeline: [], agent: [], connector: [], schedule: [], alert: [],
  };
  for (const c of visible) grouped[c.kind].push(c);

  const handleSelect = (c: OpsCard) => {
    if (c.kind === 'pipeline' && c.meta.runId && c.meta.pipelineId) {
      selectRun({ kind: 'pipeline', runId: c.meta.runId, pipelineId: c.meta.pipelineId });
    } else if (c.kind === 'agent' && c.meta.runId) {
      selectRun({ kind: 'agent', runId: c.meta.runId });
    } else if (c.kind === 'alert') {
      // Alert with run_link goes straight to the underlying run.
      if (c.meta.pipelineId && c.meta.runId) {
        selectRun({ kind: 'pipeline', runId: c.meta.runId, pipelineId: c.meta.pipelineId });
      } else if (c.meta.agentId && c.meta.runId) {
        selectRun({ kind: 'agent', runId: c.meta.runId });
      }
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', backgroundColor: C.bg, overflow: 'hidden' }}>
      {/* Inline keyframes — kept self-contained so this module doesn't need a global stylesheet edit */}
      <style>{`
        @keyframes opsPulse {
          0%, 100% { opacity: .55; transform: scale(.9); }
          50%      { opacity: 1;   transform: scale(1.2); }
        }
      `}</style>

      {/* Header */}
      <div style={{
        height: 52, backgroundColor: C.panel, borderBottom: `1px solid ${C.border}`,
        display: 'flex', alignItems: 'center', padding: '0 24px', gap: 14, flexShrink: 0,
      }}>
        <span
          aria-hidden
          style={{
            width: 8, height: 8, borderRadius: '50%', background: C.success,
            animation: 'opsPulse 1.4s ease-in-out infinite',
          }}
        />
        <h1 style={{ fontSize: 15, fontWeight: 600, color: C.text, margin: 0 }}>Operations</h1>
        <span style={{ fontSize: 12, color: C.muted }}>Live</span>

        <div style={{ display: 'flex', gap: 18, marginLeft: 'auto', alignItems: 'center', fontSize: 12 }}>
          <span style={{ color: C.muted }}>
            <strong style={{ color: C.text, fontFamily: 'ui-monospace, SF Mono, Menlo, monospace' }}>{totals.total}</strong> total
          </span>
          <span style={{ color: C.muted }}>
            <strong style={{ color: C.info, fontFamily: 'ui-monospace, SF Mono, Menlo, monospace' }}>{totals.running}</strong> running
          </span>
          <span style={{ color: C.muted }}>
            <strong style={{ color: C.error, fontFamily: 'ui-monospace, SF Mono, Menlo, monospace' }}>{totals.failed}</strong> failed
          </span>
          <span style={{ color: C.muted }}>
            <strong style={{ color: C.warn, fontFamily: 'ui-monospace, SF Mono, Menlo, monospace' }}>{totals.warning}</strong> warn
          </span>
          <button
            onClick={() => fetchSnapshot()}
            title={lastFetchedAt ? `Last refreshed ${timeAgoIso(lastFetchedAt)}` : 'Refresh'}
            style={{
              border: `1px solid ${C.border}`, background: C.panel, borderRadius: 4,
              padding: '4px 8px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5,
              color: C.muted, fontSize: 12,
            }}
          >
            <RefreshCw size={12} /> Refresh
          </button>
        </div>
      </div>

      {/* Filter bar */}
      <div style={{
        height: 40, backgroundColor: C.panel, borderBottom: `1px solid ${C.border}`,
        display: 'flex', alignItems: 'center', padding: '0 24px', gap: 6, flexShrink: 0,
      }}>
        {LANES.map((l) => {
          const on = filter === l.kind;
          return (
            <button
              key={l.kind}
              onClick={() => setFilter(l.kind)}
              style={{
                padding: '4px 10px', borderRadius: 14, fontSize: 12,
                border: `1px solid ${on ? C.accent : C.border}`,
                backgroundColor: on ? C.accentLight : 'transparent',
                color: on ? C.accent : C.muted,
                cursor: 'pointer', fontWeight: on ? 600 : 400,
                display: 'flex', alignItems: 'center', gap: 5,
              }}
            >
              {l.icon}{l.label}
            </button>
          );
        })}
        <div style={{ position: 'relative', marginLeft: 'auto', width: 240 }}>
          <Search size={12} style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', color: C.subtle }} />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name or activity…"
            style={{
              height: 28, paddingLeft: 26, paddingRight: 10,
              border: `1px solid ${C.border}`, borderRadius: 4,
              fontSize: 12, width: '100%', backgroundColor: C.bg, color: C.text, outline: 'none',
            }}
          />
        </div>
      </div>

      {/* Grid */}
      <div style={{
        flex: 1, overflowY: 'auto',
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
        gap: 0,
        background: C.bg,
        alignContent: 'start',
      }}>
        {(['pipeline', 'agent', 'connector', 'schedule', 'alert'] as OpsKind[])
          .filter((k) => filter === 'all' || filter === k)
          .map((k) => (
            <Lane key={k} kind={k} cards={grouped[k]} onSelect={handleSelect} />
          ))}
      </div>
    </div>
  );
};

export default HivemindGrid;
