/**
 * HivemindGrid v2 — operations console.
 *
 *   1. Aggregate header (running, failed, tokens/24h, cost/24h, rows/24h)
 *   2. NOW RUNNING — fat cards with progress bars + current step
 *   3. CATALOG — per-kind browse; clicking a pipeline/agent opens its history
 *
 * Per-entity run history lives in EntityHistory.tsx — clicking a Catalog pill
 * opens it. There is no global recent-runs feed here by design (it was noisy
 * when one pipeline was failing in a loop).
 */
import React, { useEffect, useState } from 'react';
import {
  Workflow, Bot, Plug, Bell, RefreshCw, Cpu,
  AlertCircle, Coins, Zap, Hash, ChevronDown, ChevronUp,
} from 'lucide-react';
import {
  useOperationsStore, RunRow, RunStatus, CatalogEntry,
  timeAgoIso, fmtTokens, fmtCost,
} from '../../store/operationsStore';

const C = {
  bg: '#F8FAFC', panel: '#FFFFFF', border: '#E2E8F0', hover: '#F1F5F9',
  text: '#0D1117', muted: '#64748B', subtle: '#94A3B8',
  accent: '#7C3AED', accentLight: '#EDE9FE',
  success: '#16A34A', successLight: '#F0FDF4',
  warn: '#D97706', warnLight: '#FEF3C7',
  error: '#DC2626', errorLight: '#FEF2F2',
  info: '#2563EB', infoLight: '#DBEAFE',
};
const MONO = 'ui-monospace, SF Mono, Menlo, Monaco, Consolas, monospace';

// ── status meta ─────────────────────────────────────────────────────────────

const statusColor: Record<RunStatus, string> = {
  running: C.info, success: C.success, failed: C.error,
};
const catStatusColor: Record<CatalogEntry['status'], string> = {
  running: C.info, success: C.success, failed: C.error,
  warning: C.warn, idle: C.subtle,
};

const fmtMs = (ms?: number | null): string => {
  if (ms == null || ms < 0) return '—';
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)}s`;
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ${Math.floor((ms % 60_000) / 1000)}s`;
  return `${Math.floor(ms / 3_600_000)}h ${Math.floor((ms % 3_600_000) / 60_000)}m`;
};

// ── Now-running card ─────────────────────────────────────────────────────────

const RunningCard: React.FC<{ row: RunRow; onSelect: () => void }> = ({ row, onSelect }) => {
  const isPipeline = row.kind === 'pipeline';
  const pct = (row.currentStepIndex && row.totalSteps && row.totalSteps > 0)
    ? Math.round((row.currentStepIndex / row.totalSteps) * 100)
    : null;

  return (
    <div
      onClick={onSelect}
      style={{
        padding: '12px 14px', background: C.panel,
        border: `1px solid ${C.border}`, borderLeft: `3px solid ${C.info}`,
        borderRadius: 4, cursor: 'pointer', minWidth: 0,
        transition: 'background 80ms',
      }}
      onMouseEnter={(e) => { e.currentTarget.style.background = C.hover; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = C.panel; }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <span aria-hidden style={{
          width: 7, height: 7, borderRadius: '50%', background: C.info,
          animation: 'opsPulse 1.4s ease-in-out infinite', flexShrink: 0,
        }} />
        {isPipeline ? <Workflow size={13} color={C.muted} /> : <Bot size={13} color={C.muted} />}
        <span style={{
          fontSize: 13, fontWeight: 600, flex: 1, minWidth: 0,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>{row.entityName}</span>
        <span style={{
          fontSize: 11, padding: '1px 7px', borderRadius: 10, fontFamily: MONO,
          color: C.info, background: C.infoLight, fontWeight: 600,
        }}>{fmtMs(row.durationMs)}</span>
      </div>

      {/* current step */}
      {isPipeline && row.currentNodeLabel && (
        <div style={{ fontSize: 12, color: C.text, marginBottom: 6,
                       fontFamily: MONO,
                       overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {row.currentNodeLabel}
        </div>
      )}
      {!isPipeline && row.iterations !== undefined && (
        <div style={{ fontSize: 12, color: C.text, marginBottom: 6, fontFamily: MONO }}>
          iter {row.iterations} · {row.toolCount} tool{row.toolCount === 1 ? '' : 's'}
        </div>
      )}

      {/* progress bar */}
      {pct !== null && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
          <div style={{ flex: 1, height: 4, background: C.hover, borderRadius: 2, overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${pct}%`, background: C.info,
                           transition: 'width 400ms ease-out' }} />
          </div>
          <span style={{ fontSize: 11, color: C.muted, fontFamily: MONO,
                          minWidth: 56, textAlign: 'right' }}>
            {row.currentStepIndex}/{row.totalSteps}
          </span>
        </div>
      )}
      {pct === null && !isPipeline && (
        <div style={{ height: 4, background: C.hover, borderRadius: 2, overflow: 'hidden', marginBottom: 4 }}>
          <div style={{ height: '100%', width: '38%', background: C.info,
                         animation: 'opsBarPulse 1.6s ease-in-out infinite' }} />
        </div>
      )}

      {/* row counts / model */}
      <div style={{ fontSize: 11, color: C.subtle, fontFamily: MONO,
                     display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        {isPipeline && (
          <span>{(row.rowsIn ?? 0).toLocaleString()} → {(row.rowsOut ?? 0).toLocaleString()}</span>
        )}
        {!isPipeline && row.model && (
          <span style={{ color: C.accent }}>{row.model}</span>
        )}
        <span style={{ marginLeft: 'auto' }}>{timeAgoIso(row.startedAt)}</span>
      </div>
    </div>
  );
};

// ── Catalog entry pill ──────────────────────────────────────────────────────

const CatalogPill: React.FC<{ entry: CatalogEntry; onSelect: (e: CatalogEntry) => void }> =
({ entry, onSelect }) => (
  <div
    onClick={() => onSelect(entry)}
    style={{
      padding: '7px 10px', background: C.panel,
      border: `1px solid ${C.border}`, borderRadius: 4,
      cursor: 'pointer', minWidth: 0,
      transition: 'border-color 80ms',
    }}
    onMouseEnter={(e) => { e.currentTarget.style.borderColor = C.accent; }}
    onMouseLeave={(e) => { e.currentTarget.style.borderColor = C.border; }}
  >
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
      <span style={{
        width: 6, height: 6, borderRadius: '50%',
        background: catStatusColor[entry.status],
        animation: entry.status === 'running' ? 'opsPulse 1.4s ease-in-out infinite' : undefined,
      }} />
      <span style={{
        fontSize: 12, fontWeight: 600, color: C.text,
        flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>{entry.name}</span>
    </div>
    <div style={{
      fontSize: 11, color: C.muted, fontFamily: MONO,
      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
    }}>{entry.blurb}</div>
  </div>
);

// ── Section header ──────────────────────────────────────────────────────────

const SectionHeader: React.FC<{
  title: string; count?: number | string; right?: React.ReactNode;
}> = ({ title, count, right }) => (
  <div style={{
    display: 'flex', alignItems: 'center', gap: 10,
    padding: '14px 24px 8px', background: C.bg,
  }}>
    <span style={{
      fontSize: 11, fontWeight: 700, textTransform: 'uppercase',
      letterSpacing: '.05em', color: C.muted,
    }}>{title}</span>
    {count != null && (
      <span style={{
        fontSize: 11, color: C.subtle, fontFamily: MONO,
      }}>{count}</span>
    )}
    {right && <span style={{ marginLeft: 'auto' }}>{right}</span>}
  </div>
);

// ── Page ────────────────────────────────────────────────────────────────────

export const HivemindGrid: React.FC = () => {
  const {
    runningRuns, catalog, aggregate,
    lastFetchedAt, fetchSnapshot, startPolling, stopPolling,
    selectRun, viewEntityHistory,
  } = useOperationsStore();
  const [catalogOpen, setCatalogOpen] = useState(true);

  useEffect(() => {
    startPolling(5000);
    return () => stopPolling();
  }, [startPolling, stopPolling]);

  // ── Click handlers ─────────────────────────────────────────────────────
  const openRun = (r: RunRow) => {
    if (r.kind === 'pipeline') {
      selectRun({ kind: 'pipeline', runId: r.id, pipelineId: r.entityId });
    } else {
      selectRun({ kind: 'agent', runId: r.id });
    }
  };

  const openCatalog = (e: CatalogEntry) => {
    if (e.kind === 'pipeline') {
      viewEntityHistory({
        kind: 'pipeline',
        entityId: e.pipelineId || e.id,
        entityName: e.name,
      });
    } else if (e.kind === 'agent') {
      viewEntityHistory({
        kind: 'agent',
        entityId: e.agentId || e.id,
        entityName: e.name,
      });
    } else if (e.kind === 'alert' && e.pipelineId && e.latestRunId) {
      selectRun({ kind: 'pipeline', runId: e.latestRunId, pipelineId: e.pipelineId });
    } else if (e.kind === 'alert' && e.agentId && e.latestRunId) {
      selectRun({ kind: 'agent', runId: e.latestRunId });
    }
  };

  // ── Render ─────────────────────────────────────────────────────────────
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', backgroundColor: C.bg, overflow: 'hidden' }}>
      <style>{`
        @keyframes opsPulse {
          0%, 100% { opacity: .55; transform: scale(.9); }
          50%      { opacity: 1;   transform: scale(1.2); }
        }
        @keyframes opsBarPulse {
          0%   { transform: translateX(-30%); }
          100% { transform: translateX(220%); }
        }
      `}</style>

      {/* Top bar */}
      <div style={{
        height: 52, background: C.panel, borderBottom: `1px solid ${C.border}`,
        display: 'flex', alignItems: 'center', padding: '0 24px', gap: 14, flexShrink: 0,
      }}>
        <span aria-hidden style={{
          width: 8, height: 8, borderRadius: '50%', background: aggregate.runningCount > 0 ? C.success : C.subtle,
          animation: aggregate.runningCount > 0 ? 'opsPulse 1.4s ease-in-out infinite' : undefined,
        }} />
        <h1 style={{ fontSize: 15, fontWeight: 600, color: C.text, margin: 0 }}>Operations</h1>
        <span style={{ fontSize: 12, color: C.muted }}>Live · 24h window</span>
        <button
          onClick={() => fetchSnapshot()}
          title={lastFetchedAt ? `Refreshed ${timeAgoIso(lastFetchedAt)}` : 'Refresh'}
          style={{
            marginLeft: 'auto',
            border: `1px solid ${C.border}`, background: C.panel, borderRadius: 4,
            padding: '4px 8px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5,
            color: C.muted, fontSize: 12,
          }}
        >
          <RefreshCw size={12} /> Refresh
        </button>
      </div>

      {/* Aggregate stat strip */}
      <div style={{
        background: C.panel, borderBottom: `1px solid ${C.border}`,
        padding: '10px 24px', flexShrink: 0,
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
        gap: 16,
      }}>
        <Stat icon={<Cpu size={13} />} label="Running" value={aggregate.runningCount.toLocaleString()} accent={C.info} />
        <Stat icon={<AlertCircle size={13} />} label="Failed (24h)" value={aggregate.failedLast24h.toLocaleString()} accent={aggregate.failedLast24h > 0 ? C.error : C.muted} />
        <Stat icon={<RefreshCw size={13} />} label="Total runs (24h)" value={aggregate.totalRunsLast24h.toLocaleString()} accent={C.muted} />
        <Stat icon={<Zap size={13} />} label="Tokens (24h)" value={fmtTokens(aggregate.tokensLast24h)} accent={C.accent} />
        <Stat icon={<Coins size={13} />} label="Cost (24h)" value={fmtCost(aggregate.costUsdLast24h)} accent={C.accent} />
        <Stat icon={<Hash size={13} />} label="Rows out (24h)" value={fmtTokens(aggregate.rowsProcessedLast24h)} accent={C.muted} />
      </div>

      {/* Scrollable body */}
      <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>

        {/* ── NOW RUNNING ────────────────────────────────────────────── */}
        <SectionHeader
          title="Now running"
          count={runningRuns.length}
          right={runningRuns.length === 0 ? (
            <span style={{ fontSize: 11, color: C.subtle }}>nothing currently executing</span>
          ) : null}
        />
        {runningRuns.length > 0 && (
          <div style={{
            display: 'grid', gap: 10,
            gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
            padding: '0 24px 8px',
          }}>
            {runningRuns.map((r) => (
              <RunningCard key={r.id} row={r} onSelect={() => openRun(r)} />
            ))}
          </div>
        )}

        {/* ── CATALOG ─────────────────────────────────────────────────── */}
        <SectionHeader
          title="Catalog"
          right={
            <button
              onClick={() => setCatalogOpen((v) => !v)}
              style={{
                background: 'transparent', border: 'none', color: C.muted,
                fontSize: 11, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4,
              }}
            >
              {catalogOpen ? <><ChevronUp size={12} /> Hide</> : <><ChevronDown size={12} /> Show</>}
            </button>
          }
        />
        {catalogOpen && (
          <div style={{ padding: '0 24px 24px',
                         display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14 }}>
            <Lane title="Pipelines" icon={<Workflow size={11} />}
                  entries={catalog.pipelines} onSelect={openCatalog} />
            <Lane title="Agents"     icon={<Bot size={11} />}
                  entries={catalog.agents} onSelect={openCatalog} />
            <Lane title="Connectors" icon={<Plug size={11} />}
                  entries={catalog.connectors} onSelect={openCatalog} />
            <Lane title="Alerts"     icon={<Bell size={11} />}
                  entries={catalog.alerts} onSelect={openCatalog} />
          </div>
        )}
      </div>
    </div>
  );
};

const Stat: React.FC<{ icon: React.ReactNode; label: string; value: string; accent: string }> =
({ icon, label, value, accent }) => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
    <span style={{
      fontSize: 10, color: C.muted, textTransform: 'uppercase',
      letterSpacing: '.04em', fontWeight: 600,
      display: 'flex', alignItems: 'center', gap: 4,
    }}>
      <span style={{ color: accent, lineHeight: 0 }}>{icon}</span>
      {label}
    </span>
    <span style={{ fontSize: 18, fontWeight: 700, color: C.text, fontFamily: MONO }}>{value}</span>
  </div>
);

const Lane: React.FC<{
  title: string;
  icon: React.ReactNode;
  entries: CatalogEntry[];
  onSelect: (e: CatalogEntry) => void;
}> = ({ title, icon, entries, onSelect }) => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
    <div style={{
      display: 'flex', alignItems: 'center', gap: 6,
      fontSize: 11, fontWeight: 700, textTransform: 'uppercase',
      letterSpacing: '.04em', color: C.muted, padding: '4px 0',
    }}>
      <span style={{ color: C.muted, lineHeight: 0 }}>{icon}</span>
      {title}
      <span style={{ marginLeft: 'auto', color: C.subtle, fontFamily: MONO, fontWeight: 400 }}>
        {entries.length}
      </span>
    </div>
    {entries.length === 0 ? (
      <div style={{
        fontSize: 11, color: C.subtle, fontStyle: 'italic',
        padding: '8px 10px', border: `1px dashed ${C.border}`, borderRadius: 4, textAlign: 'center',
      }}>
        No {title.toLowerCase()}
      </div>
    ) : entries.map((e) => (
      <CatalogPill key={e.id} entry={e} onSelect={onSelect} />
    ))}
  </div>
);

export default HivemindGrid;
