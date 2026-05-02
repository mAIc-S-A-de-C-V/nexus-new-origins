/**
 * RunDrilldown — universal viewer for a single pipeline OR agent run.
 *
 * Layout:
 *   ┌──────────────────────────────────────────────────────────────────┐
 *   │ Header: crumb · status · acknowledge / re-run                    │
 *   ├─────────────┬─────────────────────────────┬──────────────────────┤
 *   │ Step list   │ Tabs: Logs | Records | …    │ Metadata + related   │
 *   │ (timeline)  │ Content body                │ entities             │
 *   └─────────────┴─────────────────────────────┴──────────────────────┘
 */
import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft, Workflow, Bot, AlertCircle, CheckCircle2, Clock,
  Terminal, Database, Activity as ActivityIcon, Copy, RefreshCw,
} from 'lucide-react';
import {
  useOperationsStore, OpsLogLine, NodeAuditDetail,
  PipelineRunDetail, AgentRunDetail, AgentStep,
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

// ── Shared helpers ───────────────────────────────────────────────────────────

function fmtClock(iso?: string | null) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function fmtMs(d?: number) {
  if (!d || d < 0) return '—';
  if (d < 1000) return `${d}ms`;
  return `${(d / 1000).toFixed(d < 10000 ? 1 : 0)}s`;
}

function fmtDuration(start?: string | null, end?: string | null): string {
  if (!start) return '—';
  const a = new Date(start).getTime();
  const b = end ? new Date(end).getTime() : Date.now();
  return fmtMs(b - a);
}

// ── PIPELINE RUN VIEW ────────────────────────────────────────────────────────

type LogLevel = OpsLogLine['level'];
const LEVEL_COLOR: Record<LogLevel, string> = {
  INFO: C.info, WARN: C.warn, ERROR: C.error, OK: C.success,
};

const PipelineView: React.FC<{ run: PipelineRunDetail }> = ({ run }) => {
  const auditList = useMemo(
    () => Object.values(run.node_audits).sort(
      (a, b) => new Date(a.started_at).getTime() - new Date(b.started_at).getTime(),
    ),
    [run.node_audits],
  );

  const failingAudit = auditList.find((a) => a.error || (a.dropped > 0 && /VALIDATE|FILTER/i.test(a.node_type)));
  const [selectedNode, setSelectedNode] = useState<NodeAuditDetail | null>(failingAudit || auditList[0] || null);
  const [tab, setTab] = useState<'logs' | 'records' | 'metadata'>('logs');
  const [levels, setLevels] = useState<Record<LogLevel, boolean>>({ INFO: true, WARN: true, ERROR: true, OK: true });
  const [grep, setGrep] = useState('');

  const filteredLogs = useMemo(() => {
    let logs = run.logs;
    if (selectedNode) logs = logs.filter((l) => !l.node_id || l.node_id === selectedNode.node_id);
    logs = logs.filter((l) => levels[l.level]);
    if (grep.trim()) {
      const q = grep.toLowerCase();
      logs = logs.filter((l) => l.msg.toLowerCase().includes(q) || (l.node_id || '').toLowerCase().includes(q));
    }
    return logs;
  }, [run.logs, selectedNode, levels, grep]);

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '260px 1fr', height: '100%', minHeight: 0, overflow: 'hidden' }}>
      {/* Left: step timeline */}
      <aside style={{ borderRight: `1px solid ${C.border}`, background: C.panel, overflowY: 'auto' }}>
        <div style={{ padding: '8px 14px', fontSize: 11, fontWeight: 700, color: C.muted,
                       textTransform: 'uppercase', letterSpacing: '.04em',
                       borderBottom: `1px solid ${C.border}`, position: 'sticky', top: 0,
                       background: C.panel, zIndex: 1 }}>
          Run timeline
          {run.status === 'RUNNING' && run.total_steps && (
            <span style={{ marginLeft: 6, fontFamily: MONO, color: C.info, fontWeight: 600,
                            textTransform: 'none', letterSpacing: 0 }}>
              · step {run.current_step_index ?? '?'}/{run.total_steps}
            </span>
          )}
        </div>
        {auditList.map((a, i) => {
          const active = selectedNode?.node_id === a.node_id;
          const failed = !!a.error;
          const isCurrent = run.status === 'RUNNING' && run.current_node_id === a.node_id;
          return (
            <div key={a.node_id} style={{ position: 'relative' }}>
              <div
                onClick={() => setSelectedNode(a)}
                style={{
                  display: 'flex', gap: 8, padding: '10px 14px',
                  borderBottom: `1px solid ${C.border}`, cursor: 'pointer',
                  background: active ? C.accentLight : isCurrent ? C.infoLight : 'transparent',
                }}
              >
                <span style={{
                  width: 10, height: 10, borderRadius: '50%', flexShrink: 0, marginTop: 4,
                  background: isCurrent ? C.info : failed ? C.error : a.dropped > 0 ? C.warn : C.success,
                  boxShadow: failed ? `0 0 0 3px ${C.errorLight}` : 'none',
                  animation: isCurrent ? 'opsPulse 1.4s ease-in-out infinite' : undefined,
                }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{
                    fontSize: 12.5, fontWeight: 600,
                    color: active ? C.accent : isCurrent ? C.info : C.text,
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>
                    {a.node_type} · {a.node_label}
                    {isCurrent && <span style={{ marginLeft: 6, fontWeight: 500, color: C.info, fontSize: 11 }}>running…</span>}
                  </div>
                  <div style={{ fontSize: 11, color: C.muted, fontFamily: MONO,
                                marginTop: 2, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <span>{a.rows_in.toLocaleString()} → {a.rows_out.toLocaleString()}</span>
                    {a.dropped > 0 && <span style={{ color: C.warn }}>−{a.dropped}</span>}
                    <span>{fmtMs(a.duration_ms)}</span>
                  </div>
                  {a.error && (
                    <div style={{ marginTop: 4, padding: '4px 6px', background: C.errorLight,
                                  borderRadius: 3, fontSize: 11, color: C.error,
                                  fontFamily: MONO, wordBreak: 'break-word' }}>
                      {a.error}
                    </div>
                  )}
                </div>
              </div>
              {i < auditList.length - 1 && (
                <div style={{ position: 'absolute', left: 19, bottom: -1, top: 24, width: 1, background: C.border }} />
              )}
            </div>
          );
        })}
        {/* Pending step indicator — shown while a run is in flight and the
            current_node_id hasn't yet emitted a node_audit entry. */}
        {run.status === 'RUNNING' && run.current_node_label &&
          !auditList.some((a) => a.node_id === run.current_node_id) && (
          <div style={{ display: 'flex', gap: 8, padding: '10px 14px',
                         borderBottom: `1px solid ${C.border}`, background: C.infoLight }}>
            <span style={{ width: 10, height: 10, borderRadius: '50%', flexShrink: 0, marginTop: 4,
                            background: C.info, animation: 'opsPulse 1.4s ease-in-out infinite' }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12.5, fontWeight: 600, color: C.info,
                             overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {run.current_node_label}
                <span style={{ marginLeft: 6, fontWeight: 500, fontSize: 11 }}>running…</span>
              </div>
              <div style={{ fontSize: 11, color: C.muted, fontFamily: MONO, marginTop: 2 }}>
                step {run.current_step_index}/{run.total_steps}
              </div>
            </div>
          </div>
        )}
        {auditList.length === 0 && run.status !== 'RUNNING' && (
          <div style={{ padding: 20, fontSize: 12, color: C.subtle, textAlign: 'center' }}>
            No node audit data for this run
          </div>
        )}
      </aside>

      {/* Right: tabs + content */}
      <main style={{ display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
        {/* Tabs */}
        <div style={{ display: 'flex', gap: 0, padding: '0 16px', background: C.panel,
                       borderBottom: `1px solid ${C.border}`, flexShrink: 0 }}>
          {(['logs', 'records', 'metadata'] as const).map((t) => {
            const on = tab === t;
            const label = { logs: 'Logs', records: 'Sample data', metadata: 'Stats' }[t];
            const count = t === 'logs' ? run.logs.length : t === 'records' ? (selectedNode?.sample_out?.length ?? 0) : 0;
            return (
              <button
                key={t}
                onClick={() => setTab(t)}
                style={{
                  padding: '10px 14px', fontSize: 13, border: 'none', background: 'transparent',
                  cursor: 'pointer', color: on ? C.info : C.muted,
                  borderBottom: on ? `2px solid ${C.info}` : '2px solid transparent',
                  fontWeight: on ? 500 : 400,
                  display: 'flex', alignItems: 'center', gap: 6,
                }}
              >
                {label}
                {count > 0 && <span style={{
                  padding: '0 6px', borderRadius: 8, fontSize: 11, fontFamily: MONO,
                  background: on ? C.infoLight : C.hover, color: on ? C.info : C.muted,
                }}>{count}</span>}
              </button>
            );
          })}
        </div>

        <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
          {tab === 'logs' && (
            <div>
              {/* Filter row */}
              <div style={{
                position: 'sticky', top: 0, zIndex: 1, background: C.panel,
                borderBottom: `1px solid ${C.border}`, padding: '8px 14px',
                display: 'flex', gap: 6, alignItems: 'center',
              }}>
                {(['INFO', 'WARN', 'ERROR', 'OK'] as LogLevel[]).map((lv) => {
                  const on = levels[lv];
                  const color = LEVEL_COLOR[lv];
                  return (
                    <button
                      key={lv}
                      onClick={() => setLevels((s) => ({ ...s, [lv]: !s[lv] }))}
                      style={{
                        padding: '3px 9px', borderRadius: 12, fontSize: 11, fontWeight: 500,
                        border: `1px solid ${on ? color : C.border}`,
                        background: on ? `${color}1A` : 'transparent',
                        color: on ? color : C.muted, cursor: 'pointer',
                        fontFamily: MONO,
                      }}
                    >{lv}</button>
                  );
                })}
                <input
                  value={grep}
                  onChange={(e) => setGrep(e.target.value)}
                  placeholder="grep logs…"
                  style={{
                    flex: 1, marginLeft: 8, height: 26, border: `1px solid ${C.border}`,
                    borderRadius: 4, padding: '0 8px', fontSize: 11.5, background: C.bg,
                    color: C.text, outline: 'none', fontFamily: MONO,
                  }}
                />
                {selectedNode && (
                  <span style={{
                    fontSize: 11, color: C.muted, fontFamily: MONO,
                    padding: '3px 8px', background: C.hover, borderRadius: 3,
                  }}>scoped: {selectedNode.node_label}</span>
                )}
              </div>

              {/* Log list */}
              <div style={{ fontFamily: MONO, fontSize: 11.5 }}>
                {filteredLogs.length === 0 ? (
                  <div style={{ padding: 24, textAlign: 'center', color: C.subtle, fontSize: 12 }}>
                    {run.logs.length === 0
                      ? 'No log lines captured for this run.'
                      : 'No log lines match the current filter.'}
                  </div>
                ) : filteredLogs.map((l, i) => (
                  <div
                    key={i}
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '88px 60px 110px 1fr',
                      gap: 8, padding: '4px 14px',
                      borderBottom: `1px dashed ${C.hover}`,
                      background: l.level === 'ERROR' ? '#FFFAFA' : 'transparent',
                      alignItems: 'baseline',
                    }}
                  >
                    <span style={{ color: C.subtle }}>{fmtClock(l.ts)}</span>
                    <span style={{ color: LEVEL_COLOR[l.level], fontWeight: 700 }}>{l.level}</span>
                    <span style={{ color: C.accent, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {l.node_id ? l.node_id.slice(0, 12) : '—'}
                    </span>
                    <span style={{ color: l.level === 'ERROR' ? C.error : C.text,
                                   whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                      {l.msg}
                      {l.extra && Object.keys(l.extra).length > 0 && (
                        <span style={{ color: C.muted, marginLeft: 6 }}>
                          {JSON.stringify(l.extra)}
                        </span>
                      )}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {tab === 'records' && (
            <div style={{ padding: 14 }}>
              {selectedNode ? (
                <SampleData node={selectedNode} />
              ) : (
                <div style={{ color: C.subtle, fontSize: 12 }}>Select a step to inspect its records.</div>
              )}
            </div>
          )}

          {tab === 'metadata' && (
            <div style={{ padding: 14 }}>
              {selectedNode ? (
                <MetadataBlock node={selectedNode} />
              ) : (
                <div style={{ color: C.subtle, fontSize: 12 }}>Select a step.</div>
              )}
            </div>
          )}
        </div>
      </main>
    </div>
  );
};

const SampleData: React.FC<{ node: NodeAuditDetail }> = ({ node }) => {
  const which: ('sample_in' | 'sample_out')[] = ['sample_in', 'sample_out'];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {which.map((k) => {
        const rows = (node[k] as Record<string, unknown>[] | undefined) || [];
        if (rows.length === 0) {
          return (
            <div key={k}>
              <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase',
                             color: C.muted, letterSpacing: '.04em', marginBottom: 6 }}>
                {k === 'sample_in' ? 'Sample · in' : 'Sample · out'}
              </div>
              <div style={{ fontSize: 12, color: C.subtle, fontStyle: 'italic' }}>No records</div>
            </div>
          );
        }
        const cols = Array.from(new Set(rows.flatMap((r) => Object.keys(r)))).slice(0, 10);
        return (
          <div key={k}>
            <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase',
                           color: C.muted, letterSpacing: '.04em', marginBottom: 6 }}>
              {k === 'sample_in' ? 'Sample · in' : 'Sample · out'}
              <span style={{ color: C.subtle, fontWeight: 400, marginLeft: 6 }}>({rows.length} rows)</span>
            </div>
            <div style={{ overflowX: 'auto', border: `1px solid ${C.border}`, borderRadius: 4 }}>
              <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 11, fontFamily: MONO }}>
                <thead>
                  <tr style={{ background: C.bg }}>
                    {cols.map((c) => (
                      <th key={c} style={{ textAlign: 'left', fontWeight: 600, color: C.muted,
                                            padding: '4px 8px', borderBottom: `1px solid ${C.border}`,
                                            whiteSpace: 'nowrap' }}>{c}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={i} style={{ background: i % 2 === 0 ? C.panel : '#FAFAFA' }}>
                      {cols.map((c) => {
                        const v = r[c];
                        const display = v === null || v === undefined ? '' : String(v);
                        return (
                          <td key={c} title={display} style={{
                            padding: '4px 8px', maxWidth: 180, overflow: 'hidden',
                            textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                            color: display ? C.text : C.subtle,
                            borderBottom: `1px solid ${C.hover}`,
                          }}>
                            {display || <span style={{ fontStyle: 'italic' }}>null</span>}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}
    </div>
  );
};

const MetadataBlock: React.FC<{ node: NodeAuditDetail }> = ({ node }) => {
  const stats = node.stats || {};
  return (
    <div>
      <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase',
                     color: C.muted, letterSpacing: '.04em', marginBottom: 6 }}>
        {node.node_type} · {node.node_label}
      </div>
      <table style={{ borderCollapse: 'collapse', fontSize: 12, width: '100%' }}>
        <tbody>
          <Row k="Rows in" v={node.rows_in.toLocaleString()} />
          <Row k="Rows out" v={node.rows_out.toLocaleString()} />
          <Row k="Dropped" v={String(node.dropped)} />
          <Row k="Duration" v={fmtMs(node.duration_ms)} />
          <Row k="Started at" v={fmtClock(node.started_at)} />
          {Object.entries(stats).map(([k, v]) => (
            <Row key={k} k={k} v={typeof v === 'object' ? JSON.stringify(v) : String(v)} />
          ))}
        </tbody>
      </table>
    </div>
  );
};

const Row: React.FC<{ k: string; v: string }> = ({ k, v }) => (
  <tr>
    <td style={{ color: C.muted, padding: '4px 0', borderBottom: `1px dashed ${C.hover}`, width: 140 }}>{k}</td>
    <td style={{ color: C.text, padding: '4px 0', borderBottom: `1px dashed ${C.hover}`,
                  fontFamily: MONO, wordBreak: 'break-word' }}>{v}</td>
  </tr>
);

// ── AGENT RUN VIEW ───────────────────────────────────────────────────────────

const AgentView: React.FC<{ run: AgentRunDetail }> = ({ run }) => {
  const [showThinking, setShowThinking] = useState(true);
  const visibleSteps = useMemo(
    () => run.steps.filter((s) => showThinking || s.kind !== 'thinking'),
    [run.steps, showThinking],
  );
  const iters = useMemo(() => {
    const out = new Map<number, AgentStep[]>();
    for (const s of run.steps) {
      const arr = out.get(s.iter) || [];
      arr.push(s);
      out.set(s.iter, arr);
    }
    return Array.from(out.entries()).sort(([a], [b]) => a - b);
  }, [run.steps]);

  const [selectedIter, setSelectedIter] = useState<number | 'all'>('all');
  const filteredSteps = useMemo(
    () => selectedIter === 'all' ? visibleSteps : visibleSteps.filter((s) => s.iter === selectedIter),
    [visibleSteps, selectedIter],
  );

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '220px 1fr', height: '100%', minHeight: 0, overflow: 'hidden' }}>
      <aside style={{ borderRight: `1px solid ${C.border}`, background: C.panel, overflowY: 'auto' }}>
        <div style={{ padding: '8px 14px', fontSize: 11, fontWeight: 700, color: C.muted,
                       textTransform: 'uppercase', letterSpacing: '.04em',
                       borderBottom: `1px solid ${C.border}`, position: 'sticky', top: 0, background: C.panel }}>
          Iterations
        </div>
        <div
          onClick={() => setSelectedIter('all')}
          style={{
            padding: '10px 14px', borderBottom: `1px solid ${C.border}`, cursor: 'pointer',
            background: selectedIter === 'all' ? C.accentLight : 'transparent',
            color: selectedIter === 'all' ? C.accent : C.text,
            fontSize: 12.5, fontWeight: 600,
          }}
        >All steps · {run.steps.length}</div>
        {iters.map(([iter, steps]) => {
          const hasError = steps.some((s) => s.kind === 'error');
          const tools = steps.filter((s) => s.kind === 'tool_call');
          return (
            <div
              key={iter}
              onClick={() => setSelectedIter(iter)}
              style={{
                padding: '10px 14px', borderBottom: `1px solid ${C.border}`, cursor: 'pointer',
                background: selectedIter === iter ? C.accentLight : 'transparent',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{
                  width: 22, height: 22, borderRadius: '50%',
                  background: hasError ? C.errorLight : C.successLight,
                  color: hasError ? C.error : C.success,
                  display: 'grid', placeItems: 'center', fontSize: 11, fontWeight: 700,
                  fontFamily: MONO, flexShrink: 0,
                }}>{iter}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{
                    fontSize: 12, fontWeight: 600,
                    color: selectedIter === iter ? C.accent : C.text,
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>
                    {tools[0]?.tool || (steps[0]?.kind === 'thinking' ? 'thinking' : 'iteration')}
                  </div>
                  <div style={{ fontSize: 11, color: C.muted, fontFamily: MONO }}>
                    {steps.length} step{steps.length === 1 ? '' : 's'}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </aside>

      <main style={{ overflowY: 'auto', minHeight: 0 }}>
        {/* Token + cost summary ribbon */}
        <div style={{
          padding: '10px 14px', background: C.panel, borderBottom: `1px solid ${C.border}`,
          display: 'flex', alignItems: 'center', gap: 18, flexWrap: 'wrap',
          fontSize: 12, fontFamily: MONO,
        }}>
          <Stat label="In tokens"      value={(run.input_tokens || 0).toLocaleString()}      color={C.info} />
          <Stat label="Out tokens"     value={(run.output_tokens || 0).toLocaleString()}     color={C.success} />
          {(run.cache_creation_tokens || 0) > 0 && (
            <Stat label="Cache writes" value={run.cache_creation_tokens.toLocaleString()}    color={C.accent} />
          )}
          {(run.cache_read_tokens || 0) > 0 && (
            <Stat label="Cache hits"   value={run.cache_read_tokens.toLocaleString()}        color={C.accent} />
          )}
          <Stat label="Cost"           value={`$${(run.cost_usd || 0).toFixed((run.cost_usd || 0) < 0.01 ? 4 : 3)}`} color={C.text} />
          {run.duration_ms != null && (
            <Stat label="Duration" value={fmtMs(run.duration_ms)} color={C.muted} />
          )}
          <span style={{ marginLeft: 'auto', color: C.muted }}>
            model {run.model || 'unknown'} · temp 0.2
          </span>
        </div>

        <div style={{
          position: 'sticky', top: 0, zIndex: 1, background: C.panel,
          borderBottom: `1px solid ${C.border}`, padding: '8px 14px',
          display: 'flex', gap: 8, alignItems: 'center', fontSize: 12,
        }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 5, color: C.muted, cursor: 'pointer' }}>
            <input type="checkbox" checked={showThinking}
                   onChange={(e) => setShowThinking(e.target.checked)} />
            Show thinking blocks
          </label>
          <span style={{ marginLeft: 'auto', color: C.muted, fontFamily: MONO }}>
            {run.iterations} iter · {run.tool_calls.length} tool{run.tool_calls.length === 1 ? '' : 's'}
            {run.error && <span style={{ color: C.error, marginLeft: 8 }}>· error</span>}
          </span>
        </div>

        <div style={{ padding: '14px 18px', maxWidth: 880 }}>
          {filteredSteps.length === 0 ? (
            <div style={{ color: C.subtle, fontSize: 12, padding: 24, textAlign: 'center' }}>
              No steps captured for this run.
            </div>
          ) : filteredSteps.map((s, i) => <StepBlock key={i} step={s} />)}

          {run.final_text && selectedIter === 'all' && (
            <div style={{
              border: `1px solid ${C.border}`, borderRadius: 4,
              background: C.panel, padding: '12px 14px', marginTop: 10,
            }}>
              <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase',
                             color: C.muted, letterSpacing: '.04em', marginBottom: 6 }}>
                Final answer
              </div>
              <div style={{ fontSize: 13, whiteSpace: 'pre-wrap', wordBreak: 'break-word', color: C.text }}>
                {run.final_text}
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
};

const Stat: React.FC<{ label: string; value: string; color: string }> = ({ label, value, color }) => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
    <span style={{ fontSize: 10, color: C.muted, textTransform: 'uppercase',
                    letterSpacing: '.04em', fontWeight: 600 }}>{label}</span>
    <span style={{ fontSize: 14, fontWeight: 700, color, fontFamily: MONO }}>{value}</span>
  </div>
);

const StepBlock: React.FC<{ step: AgentStep }> = ({ step }) => {
  const styles = {
    thinking:    { bg: '#FAF7FF', border: '#E9D5FF', tagBg: C.accentLight, tagFg: C.accent,
                   role: 'Thinking' },
    tool_call:   { bg: '#FFFDF5', border: '#FDE68A', tagBg: C.warnLight,   tagFg: C.warn,
                   role: 'Tool call' },
    tool_result: { bg: C.successLight, border: '#BBF7D0', tagBg: C.successLight, tagFg: C.success,
                   role: 'Tool result' },
    assistant:   { bg: C.panel, border: C.border, tagBg: C.hover, tagFg: C.muted,
                   role: 'Assistant' },
    error:       { bg: C.errorLight, border: '#FECACA', tagBg: C.errorLight, tagFg: C.error,
                   role: 'Error' },
  } as const;
  const s = styles[step.kind] || styles.assistant;

  return (
    <div style={{
      background: s.bg, border: `1px solid ${s.border}`, borderRadius: 4,
      padding: '10px 12px', marginBottom: 8,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
        <span style={{
          fontSize: 10, fontWeight: 700, textTransform: 'uppercase',
          background: s.tagBg, color: s.tagFg, padding: '2px 7px', borderRadius: 10,
          letterSpacing: '.04em',
        }}>
          {s.role} · iter {step.iter}
        </span>
        {step.tool && (
          <span style={{ fontFamily: MONO, fontSize: 11.5, color: C.text, fontWeight: 700 }}>
            {step.tool}
          </span>
        )}
        {step.ts && <span style={{ marginLeft: 'auto', fontSize: 11, color: C.subtle, fontFamily: MONO }}>
          {fmtClock(step.ts)}
        </span>}
      </div>
      {step.text && (
        <div style={{ fontSize: 13, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                       color: step.kind === 'thinking' ? C.muted : C.text,
                       fontStyle: step.kind === 'thinking' ? 'italic' : 'normal' }}>
          {step.text}
        </div>
      )}
      {step.input && Object.keys(step.input).length > 0 && (
        <pre style={{
          margin: '4px 0 0', background: C.bg, border: `1px solid ${C.border}`,
          borderRadius: 4, padding: '6px 8px', fontSize: 11, fontFamily: MONO, color: C.muted,
          overflowX: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
        }}>
          {JSON.stringify(step.input, null, 2)}
        </pre>
      )}
      {step.result !== undefined && step.kind === 'tool_result' && (
        <pre style={{
          margin: '4px 0 0', background: C.panel, border: `1px solid ${C.border}`,
          borderRadius: 4, padding: '6px 8px', fontSize: 11, fontFamily: MONO, color: C.text,
          overflowX: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: 280,
        }}>
          {typeof step.result === 'string' ? step.result : JSON.stringify(step.result, null, 2)}
        </pre>
      )}
      {step.msg && step.kind === 'error' && (
        <div style={{ fontSize: 12.5, color: C.error, fontFamily: MONO }}>{step.msg}</div>
      )}
    </div>
  );
};

// ── Page shell ───────────────────────────────────────────────────────────────

export const RunDrilldown: React.FC = () => {
  const { selected, selectRun, fetchPipelineRun, fetchAgentRun } = useOperationsStore();
  const [pipeline, setPipeline] = useState<PipelineRunDetail | null>(null);
  const [agent, setAgent] = useState<AgentRunDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    if (!selected) return;
    setLoading(true);
    setError(null);
    try {
      if (selected.kind === 'pipeline' && selected.pipelineId) {
        const data = await fetchPipelineRun(selected.pipelineId, selected.runId);
        setPipeline(data);
        setAgent(null);
      } else if (selected.kind === 'agent') {
        const data = await fetchAgentRun(selected.runId);
        setAgent(data);
        setPipeline(null);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // re-load if status is RUNNING — gives a live feel without sse
    const interval = setInterval(() => {
      if (pipeline?.status === 'RUNNING' || (agent && !agent.error && agent.iterations === 0)) {
        void load();
      }
    }, 4000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.kind, selected?.runId]);

  if (!selected) return null;

  const status = pipeline?.status || (agent ? (agent.error ? 'FAILED' : 'COMPLETED') : '');
  const statusColor = status === 'FAILED' ? C.error
                    : status === 'RUNNING' ? C.info
                    : status === 'COMPLETED' ? C.success
                    : C.muted;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', backgroundColor: C.bg }}>
      <style>{`
        @keyframes opsPulse {
          0%, 100% { opacity: .55; transform: scale(.9); }
          50%      { opacity: 1;   transform: scale(1.2); }
        }
      `}</style>
      {/* Header */}
      <div style={{
        height: 52, background: C.panel, borderBottom: `1px solid ${C.border}`,
        display: 'flex', alignItems: 'center', padding: '0 18px', gap: 14, flexShrink: 0,
      }}>
        <button
          onClick={() => selectRun(null)}
          style={{
            border: `1px solid ${C.border}`, background: C.panel, borderRadius: 4,
            padding: '5px 10px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5,
            color: C.muted, fontSize: 12.5,
          }}
        >
          <ArrowLeft size={13} /> Back to grid
        </button>
        <span style={{ fontSize: 12.5, color: C.muted }}>
          Operations / {selected.kind === 'pipeline' ? 'Pipelines' : 'Agents'} /
          <span style={{ color: C.text, marginLeft: 4, fontWeight: 600 }}>
            {selected.kind === 'pipeline'
              ? (pipeline ? `${selected.pipelineId?.slice(0, 8) || ''}` : selected.pipelineId)
              : (agent?.agent_name || selected.runId.slice(0, 8))}
          </span>
        </span>
        <span style={{
          marginLeft: 4, fontSize: 11, fontWeight: 700,
          color: statusColor, background: `${statusColor}1A`, padding: '2px 8px', borderRadius: 10,
          fontFamily: MONO,
        }}>
          {selected.kind === 'pipeline' ? <Workflow size={10} style={{ marginRight: 4, verticalAlign: '-1px' }} />
                                          : <Bot size={10}      style={{ marginRight: 4, verticalAlign: '-1px' }} />}
          {status || (loading ? 'LOADING' : '—')}
        </span>

        <span style={{
          fontSize: 11.5, color: C.muted, fontFamily: MONO, marginLeft: 4,
        }}>{selected.runId}</span>

        <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
          <button
            onClick={() => navigator.clipboard?.writeText(selected.runId)}
            title="Copy run id"
            style={{
              border: `1px solid ${C.border}`, background: C.panel, borderRadius: 4,
              padding: '5px 10px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5,
              color: C.muted, fontSize: 12,
            }}
          ><Copy size={12} /> Copy id</button>
          <button
            onClick={() => void load()}
            style={{
              border: `1px solid ${C.border}`, background: C.panel, borderRadius: 4,
              padding: '5px 10px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5,
              color: C.muted, fontSize: 12,
            }}
          ><RefreshCw size={12} /> Reload</button>
        </div>
      </div>

      {/* Banner: failure summary */}
      {pipeline && (pipeline.status === 'FAILED' || pipeline.error_message) && (
        <div style={{
          padding: '10px 18px', background: C.errorLight, borderBottom: '1px solid #FECACA',
          fontSize: 13, color: '#7F1D1D', display: 'flex', alignItems: 'center', gap: 10,
        }}>
          <AlertCircle size={14} color={C.error} />
          <span><strong style={{ color: C.error }}>Failed.</strong> {pipeline.error_message || 'See logs and node timeline.'}</span>
        </div>
      )}
      {agent?.error && (
        <div style={{
          padding: '10px 18px', background: C.errorLight, borderBottom: '1px solid #FECACA',
          fontSize: 13, color: '#7F1D1D', display: 'flex', alignItems: 'center', gap: 10,
        }}>
          <AlertCircle size={14} color={C.error} />
          <span><strong style={{ color: C.error }}>Agent error.</strong> {agent.error}</span>
        </div>
      )}

      {/* Body */}
      <div style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
        {error && (
          <div style={{ padding: 24, color: C.error, fontSize: 13 }}>
            <AlertCircle size={14} style={{ marginRight: 6, verticalAlign: '-2px' }} />
            {error}
          </div>
        )}
        {loading && !pipeline && !agent && (
          <div style={{ padding: 24, color: C.subtle, fontSize: 13, textAlign: 'center' }}>
            <Clock size={16} style={{ marginRight: 6, verticalAlign: '-3px' }} />
            Loading run…
          </div>
        )}
        {pipeline && <PipelineView run={pipeline} />}
        {agent && <AgentView run={agent} />}
      </div>

      {/* Footer summary */}
      {(pipeline || agent) && (
        <div style={{
          height: 32, background: C.panel, borderTop: `1px solid ${C.border}`,
          padding: '0 18px', display: 'flex', alignItems: 'center', gap: 16, fontSize: 11.5,
          color: C.muted, fontFamily: MONO, flexShrink: 0,
        }}>
          {pipeline && <>
            <span><CheckCircle2 size={11} style={{ verticalAlign: '-2px', marginRight: 4 }} />
              {pipeline.rows_in.toLocaleString()} → {pipeline.rows_out.toLocaleString()} rows
            </span>
            <span><Clock size={11} style={{ verticalAlign: '-2px', marginRight: 4 }} />
              {fmtDuration(pipeline.started_at, pipeline.finished_at)}
            </span>
            <span><Terminal size={11} style={{ verticalAlign: '-2px', marginRight: 4 }} />
              {pipeline.logs.length} log lines
            </span>
            {pipeline.triggered_by && <span><ActivityIcon size={11} style={{ verticalAlign: '-2px', marginRight: 4 }} />
              trigger {pipeline.triggered_by}
            </span>}
          </>}
          {agent && <>
            <span><Bot size={11} style={{ verticalAlign: '-2px', marginRight: 4 }} />
              {agent.agent_name || agent.agent_id.slice(0, 8)}
            </span>
            {agent.model && <span><Database size={11} style={{ verticalAlign: '-2px', marginRight: 4 }} />
              {agent.model}
            </span>}
            <span>{agent.iterations} iter · {agent.tool_calls.length} tools</span>
            <span>
              {((agent.input_tokens || 0) + (agent.output_tokens || 0)).toLocaleString()} tok · ${(agent.cost_usd || 0).toFixed((agent.cost_usd || 0) < 0.01 ? 4 : 3)}
            </span>
            {agent.created_at && <span>{fmtClock(agent.created_at)}</span>}
          </>}
        </div>
      )}
    </div>
  );
};

export default RunDrilldown;
