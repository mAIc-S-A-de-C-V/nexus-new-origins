/**
 * HivemindGrid v2 — three sections in one scrolling page:
 *
 *   1. Aggregate header (running, failed, tokens/24h, cost/24h, rows/24h)
 *   2. NOW RUNNING — fat cards with progress bars + current step
 *   3. RECENT RUNS — chronological feed (mixed pipeline + agent)
 *   4. CATALOG — collapsible per-kind browse with terse blurbs
 *
 * Tone: monitoring console. Real numbers, no glow effects, one tiny pulse on
 * running entities (industry standard). Same visual register as AlertsPage.
 */
import React, { useEffect, useMemo, useState } from 'react';
import {
  Workflow, Bot, Plug, Bell, Calendar, RefreshCw, Search, Cpu,
  AlertCircle, ChevronRight, Coins, Zap, Hash, ChevronDown, ChevronUp,
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
const statusBg: Record<RunStatus, string> = {
  running: C.infoLight, success: C.successLight, failed: C.errorLight,
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

// ── Recent run row ──────────────────────────────────────────────────────────

const RecentRow: React.FC<{ row: RunRow; onSelect: () => void }> = ({ row, onSelect }) => {
  const isPipeline = row.kind === 'pipeline';
  return (
    <div
      onClick={onSelect}
      style={{
        display: 'grid',
        gridTemplateColumns: '70px 12px 22px 1.2fr 1fr 80px 120px 70px',
        gap: 10, padding: '7px 14px',
        borderBottom: `1px solid ${C.border}`, cursor: 'pointer',
        alignItems: 'center', fontSize: 12,
        background: C.panel,
      }}
      onMouseEnter={(e) => { e.currentTarget.style.background = C.hover; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = C.panel; }}
    >
      <span style={{ color: C.subtle, fontFamily: MONO, fontSize: 11 }}>
        {timeAgoIso(row.startedAt)}
      </span>
      <span style={{
        width: 8, height: 8, borderRadius: '50%',
        background: statusColor[row.status],
      }} />
      <span style={{ color: C.muted, lineHeight: 0 }}>
        {isPipeline ? <Workflow size={13} /> : <Bot size={13} />}
      </span>
      <span style={{
        fontWeight: 500, color: C.text,
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>{row.entityName}</span>

      {/* outcome */}
      <span style={{
        color: row.status === 'failed' ? C.error : C.muted,
        fontFamily: MONO, fontSize: 11.5,
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>
        {row.status === 'failed' && (row.errorMessage || 'failed')}
        {row.status === 'success' && isPipeline &&
          `${(row.rowsIn ?? 0).toLocaleString()} → ${(row.rowsOut ?? 0).toLocaleString()}`}
        {row.status === 'success' && !isPipeline &&
          `${row.iterations} iter · ${row.toolCount} tools`}
      </span>

      {/* duration */}
      <span style={{ color: C.muted, fontFamily: MONO, fontSize: 11.5, textAlign: 'right' }}>
        {fmtMs(row.durationMs)}
      </span>

      {/* tokens / model */}
      {isPipeline ? (
        <span style={{ color: C.muted, fontFamily: MONO, fontSize: 11.5,
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {row.triggeredBy || ''}
        </span>
      ) : (
        <span style={{ color: C.muted, fontFamily: MONO, fontSize: 11.5,
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {fmtTokens((row.inputTokens || 0) + (row.outputTokens || 0))} tok
          {row.model ? <span style={{ color: C.accent, marginLeft: 6 }}>{row.model.split('-').slice(-2).join('-')}</span> : null}
        </span>
      )}

      {/* cost */}
      <span style={{ textAlign: 'right', color: C.muted, fontFamily: MONO, fontSize: 11.5 }}>
        {row.kind === 'agent' ? fmtCost(row.costUsd) : ''}
      </span>
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
    runningRuns, recentRuns, catalog, aggregate,
    lastFetchedAt, fetchSnapshot, startPolling, stopPolling, selectRun,
  } = useOperationsStore();
  const [search, setSearch] = useState('');
  const [catalogOpen, setCatalogOpen] = useState(true);
  const [recentKindFilter, setRecentKindFilter] = useState<'all' | 'pipeline' | 'agent'>('all');

  useEffect(() => {
    startPolling(5000);
    return () => stopPolling();
  }, [startPolling, stopPolling]);

  // ── Filter recent runs ─────────────────────────────────────────────────
  const filteredRecent = useMemo(() => {
    const q = search.trim().toLowerCase();
    return recentRuns.filter((r) => {
      if (recentKindFilter !== 'all' && r.kind !== recentKindFilter) return false;
      if (q && !r.entityName.toLowerCase().includes(q) &&
               !(r.errorMessage || '').toLowerCase().includes(q) &&
               !(r.currentNodeLabel || '').toLowerCase().includes(q)) return false;
      return true;
    });
  }, [recentRuns, search, recentKindFilter]);

  // ── Click handlers ─────────────────────────────────────────────────────
  const openRun = (r: RunRow) => {
    if (r.kind === 'pipeline') {
      selectRun({ kind: 'pipeline', runId: r.id, pipelineId: r.entityId });
    } else {
      selectRun({ kind: 'agent', runId: r.id });
    }
  };

  const openCatalog = (e: CatalogEntry) => {
    if (e.kind === 'pipeline' && e.latestRunId) {
      selectRun({ kind: 'pipeline', runId: e.latestRunId, pipelineId: e.pipelineId || e.id });
    } else if (e.kind === 'agent' && e.latestRunId) {
      selectRun({ kind: 'agent', runId: e.latestRunId });
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

        {/* ── RECENT RUNS ────────────────────────────────────────────── */}
        <SectionHeader
          title="Recent runs"
          count={`${filteredRecent.length} / ${recentRuns.length}`}
          right={
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              {(['all', 'pipeline', 'agent'] as const).map((k) => (
                <button
                  key={k}
                  onClick={() => setRecentKindFilter(k)}
                  style={{
                    padding: '3px 9px', borderRadius: 12, fontSize: 11,
                    border: `1px solid ${recentKindFilter === k ? C.accent : C.border}`,
                    background: recentKindFilter === k ? C.accentLight : 'transparent',
                    color: recentKindFilter === k ? C.accent : C.muted,
                    cursor: 'pointer', fontWeight: 500, textTransform: 'capitalize',
                  }}
                >{k === 'all' ? 'All' : k}s</button>
              ))}
              <div style={{ position: 'relative', width: 220 }}>
                <Search size={11} style={{
                  position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', color: C.subtle,
                }} />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search recent runs…"
                  style={{
                    height: 24, paddingLeft: 24, paddingRight: 8,
                    border: `1px solid ${C.border}`, borderRadius: 4,
                    fontSize: 11, width: '100%', background: C.bg, color: C.text, outline: 'none',
                  }}
                />
              </div>
            </div>
          }
        />
        {recentRuns.length === 0 ? (
          <div style={{
            margin: '0 24px 16px', padding: 24, fontSize: 13, color: C.subtle,
            border: `1px dashed ${C.border}`, borderRadius: 4, textAlign: 'center', background: C.panel,
          }}>
            No runs in the last 24 hours.
          </div>
        ) : (
          <div style={{ margin: '0 24px 8px', border: `1px solid ${C.border}`, borderRadius: 4, overflow: 'hidden' }}>
            {/* table header */}
            <div style={{
              display: 'grid',
              gridTemplateColumns: '70px 12px 22px 1.2fr 1fr 80px 120px 70px',
              gap: 10, padding: '6px 14px',
              fontSize: 10, fontWeight: 700, textTransform: 'uppercase',
              color: C.subtle, letterSpacing: '.04em', background: C.bg,
              borderBottom: `1px solid ${C.border}`,
            }}>
              <span>When</span><span /><span /><span>Entity</span>
              <span>Outcome</span>
              <span style={{ textAlign: 'right' }}>Duration</span>
              <span>Trigger / model</span>
              <span style={{ textAlign: 'right' }}>Cost</span>
            </div>
            {filteredRecent.map((r) => (
              <RecentRow key={r.id} row={r} onSelect={() => openRun(r)} />
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
