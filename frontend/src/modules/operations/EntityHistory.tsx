/**
 * EntityHistory — per-entity run history.
 *
 * Reached by clicking a Pipeline or Agent in the Catalog on the Operations
 * page. Shows the run feed for that one entity (so the global view stays
 * uncluttered when one pipeline is failing in a loop). Clicking a row
 * opens the run drilldown.
 */
import React from 'react';
import { ArrowLeft, Workflow, Bot, RefreshCw } from 'lucide-react';
import {
  useOperationsStore, RunRow, RunStatus,
  timeAgoIso, fmtTokens, fmtCost,
} from '../../store/operationsStore';

const C = {
  bg: '#F8FAFC', panel: '#FFFFFF', border: '#E2E8F0', hover: '#F1F5F9',
  text: '#0D1117', muted: '#64748B', subtle: '#94A3B8',
  accent: '#7C3AED',
  success: '#16A34A',
  error: '#DC2626',
  info: '#2563EB',
};
const MONO = 'ui-monospace, SF Mono, Menlo, Monaco, Consolas, monospace';

const statusColor: Record<RunStatus, string> = {
  running: C.info, success: C.success, failed: C.error,
};

const fmtMs = (ms?: number | null): string => {
  if (ms == null || ms < 0) return '—';
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)}s`;
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ${Math.floor((ms % 60_000) / 1000)}s`;
  return `${Math.floor(ms / 3_600_000)}h ${Math.floor((ms % 3_600_000) / 60_000)}m`;
};

const HistoryRow: React.FC<{ row: RunRow; onSelect: () => void }> = ({ row, onSelect }) => {
  const isPipeline = row.kind === 'pipeline';
  return (
    <div
      onClick={onSelect}
      style={{
        display: 'grid',
        gridTemplateColumns: '90px 12px 1.4fr 80px 130px 70px',
        gap: 10, padding: '8px 14px',
        borderBottom: `1px solid ${C.border}`, cursor: 'pointer',
        alignItems: 'center', fontSize: 12, background: C.panel,
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
        animation: row.status === 'running' ? 'opsPulse 1.4s ease-in-out infinite' : undefined,
      }} />
      <span style={{
        color: row.status === 'failed' ? C.error : C.muted,
        fontFamily: MONO, fontSize: 11.5,
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>
        {row.status === 'failed' && (row.errorMessage || 'failed')}
        {row.status === 'running' && (row.currentNodeLabel || 'running…')}
        {row.status === 'success' && isPipeline &&
          `${(row.rowsIn ?? 0).toLocaleString()} → ${(row.rowsOut ?? 0).toLocaleString()}`}
        {row.status === 'success' && !isPipeline &&
          `${row.iterations} iter · ${row.toolCount} tool${row.toolCount === 1 ? '' : 's'}`}
      </span>
      <span style={{ color: C.muted, fontFamily: MONO, fontSize: 11.5, textAlign: 'right' }}>
        {fmtMs(row.durationMs)}
      </span>
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
      <span style={{ textAlign: 'right', color: C.muted, fontFamily: MONO, fontSize: 11.5 }}>
        {row.kind === 'agent' ? fmtCost(row.costUsd) : ''}
      </span>
    </div>
  );
};

const EntityHistory: React.FC = () => {
  const {
    entityHistory, entityHistoryRuns, entityHistoryLoading,
    clearEntityHistory, fetchEntityHistory, selectRun,
  } = useOperationsStore();

  if (!entityHistory) return null;

  const isPipeline = entityHistory.kind === 'pipeline';
  const runs = entityHistoryRuns;
  const failed = runs.filter((r) => r.status === 'failed').length;
  const succeeded = runs.filter((r) => r.status === 'success').length;
  const running = runs.filter((r) => r.status === 'running').length;

  const openRun = (r: RunRow) => {
    if (r.kind === 'pipeline') {
      selectRun({ kind: 'pipeline', runId: r.id, pipelineId: r.entityId });
    } else {
      selectRun({ kind: 'agent', runId: r.id });
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', backgroundColor: C.bg, overflow: 'hidden' }}>
      <style>{`
        @keyframes opsPulse {
          0%, 100% { opacity: .55; transform: scale(.9); }
          50%      { opacity: 1;   transform: scale(1.2); }
        }
      `}</style>

      {/* Top bar */}
      <div style={{
        height: 52, background: C.panel, borderBottom: `1px solid ${C.border}`,
        display: 'flex', alignItems: 'center', padding: '0 16px', gap: 12, flexShrink: 0,
      }}>
        <button
          onClick={clearEntityHistory}
          style={{
            display: 'flex', alignItems: 'center', gap: 4,
            padding: '5px 9px', background: 'transparent',
            border: `1px solid ${C.border}`, borderRadius: 4,
            color: C.muted, cursor: 'pointer', fontSize: 12,
          }}
        >
          <ArrowLeft size={13} /> Operations
        </button>
        {isPipeline
          ? <Workflow size={14} color={C.muted} />
          : <Bot size={14} color={C.muted} />}
        <h1 style={{ fontSize: 14, fontWeight: 600, color: C.text, margin: 0 }}>
          {entityHistory.entityName}
        </h1>
        <span style={{ fontSize: 11, color: C.subtle, fontFamily: MONO }}>
          {isPipeline ? 'pipeline' : 'agent'} · history
        </span>
        <button
          onClick={() => fetchEntityHistory()}
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

      {/* Stat strip */}
      <div style={{
        background: C.panel, borderBottom: `1px solid ${C.border}`,
        padding: '10px 24px', flexShrink: 0,
        display: 'flex', gap: 28, alignItems: 'center',
      }}>
        <Stat label="Runs" value={runs.length.toLocaleString()} accent={C.muted} />
        <Stat label="Running" value={running.toLocaleString()} accent={running > 0 ? C.info : C.muted} />
        <Stat label="Failed" value={failed.toLocaleString()} accent={failed > 0 ? C.error : C.muted} />
        <Stat label="Succeeded" value={succeeded.toLocaleString()} accent={succeeded > 0 ? C.success : C.muted} />
      </div>

      {/* Body */}
      <div style={{ flex: 1, overflowY: 'auto', minHeight: 0, padding: '14px 24px' }}>
        {entityHistoryLoading && runs.length === 0 ? (
          <div style={{ padding: 24, fontSize: 13, color: C.subtle, textAlign: 'center' }}>
            Loading…
          </div>
        ) : runs.length === 0 ? (
          <div style={{
            padding: 24, fontSize: 13, color: C.subtle,
            border: `1px dashed ${C.border}`, borderRadius: 4, textAlign: 'center', background: C.panel,
          }}>
            No runs yet for this {isPipeline ? 'pipeline' : 'agent'}.
          </div>
        ) : (
          <div style={{ border: `1px solid ${C.border}`, borderRadius: 4, overflow: 'hidden', background: C.panel }}>
            <div style={{
              display: 'grid',
              gridTemplateColumns: '90px 12px 1.4fr 80px 130px 70px',
              gap: 10, padding: '6px 14px',
              fontSize: 10, fontWeight: 700, textTransform: 'uppercase',
              color: C.subtle, letterSpacing: '.04em', background: C.bg,
              borderBottom: `1px solid ${C.border}`,
            }}>
              <span>When</span><span /><span>Outcome</span>
              <span style={{ textAlign: 'right' }}>Duration</span>
              <span>{isPipeline ? 'Trigger' : 'Tokens / model'}</span>
              <span style={{ textAlign: 'right' }}>Cost</span>
            </div>
            {runs.map((r) => (
              <HistoryRow key={r.id} row={r} onSelect={() => openRun(r)} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

const Stat: React.FC<{ label: string; value: string; accent: string }> =
({ label, value, accent }) => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
    <span style={{
      fontSize: 10, color: C.muted, textTransform: 'uppercase',
      letterSpacing: '.04em', fontWeight: 600,
    }}>{label}</span>
    <span style={{ fontSize: 18, fontWeight: 700, color: accent, fontFamily: MONO }}>{value}</span>
  </div>
);

export default EntityHistory;
