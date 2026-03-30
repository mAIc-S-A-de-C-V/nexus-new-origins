/**
 * NodeAuditPanel — shows per-node execution data from the last pipeline run.
 * Displays rows in/out, sample records before and after, and node-specific stats
 * (match rate for ENRICH, dropped rows for FILTER, field mappings for MAP, etc.)
 */
import React, { useState } from 'react';
import { ChevronDown, ChevronRight, ArrowRight, AlertTriangle, CheckCircle2, Clock } from 'lucide-react';
import { PipelineNode } from '../../types/pipeline';
import { nodeColors } from '../../design-system/tokens';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface NodeAudit {
  node_id: string;
  node_type: string;
  node_label: string;
  rows_in: number;
  rows_out: number;
  dropped: number;
  duration_ms: number;
  started_at: string;
  sample_in: Record<string, unknown>[];
  sample_out: Record<string, unknown>[];
  stats: Record<string, unknown>;
}

interface Props {
  node: PipelineNode;
  audit: NodeAudit | null;
  loading: boolean;
}

// ── Mini record table ─────────────────────────────────────────────────────────

const MiniTable: React.FC<{ rows: Record<string, unknown>[]; label: string; accent: string }> = ({ rows, label, accent }) => {
  const [expanded, setExpanded] = useState(false);
  if (!rows || rows.length === 0) {
    return (
      <div style={{ marginBottom: 10 }}>
        <div style={{ fontSize: 10, fontWeight: 600, color: '#94A3B8', textTransform: 'uppercase', marginBottom: 4 }}>{label}</div>
        <div style={{ fontSize: 11, color: '#CBD5E1', fontStyle: 'italic' }}>No records</div>
      </div>
    );
  }

  const cols = Array.from(new Set(rows.flatMap((r) => Object.keys(r)))).slice(0, 8);
  const displayRows = expanded ? rows : rows.slice(0, 2);

  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ fontSize: 10, fontWeight: 600, color: '#64748B', textTransform: 'uppercase', marginBottom: 5, display: 'flex', alignItems: 'center', gap: 5 }}>
        <span style={{ width: 6, height: 6, borderRadius: '50%', backgroundColor: accent, display: 'inline-block' }} />
        {label} <span style={{ color: '#94A3B8', fontWeight: 400 }}>({rows.length} rows)</span>
      </div>
      <div style={{ overflowX: 'auto', border: '1px solid #E2E8F0', borderRadius: 4 }}>
        <table style={{ borderCollapse: 'collapse', fontSize: '10px', width: '100%' }}>
          <thead>
            <tr style={{ backgroundColor: '#F8FAFC' }}>
              {cols.map((c) => (
                <th key={c} style={{ padding: '4px 6px', textAlign: 'left', fontWeight: 600, color: '#64748B', borderBottom: '1px solid #E2E8F0', whiteSpace: 'nowrap', fontFamily: 'var(--font-mono)', fontSize: '9px' }}>
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {displayRows.map((row, i) => (
              <tr key={i} style={{ borderBottom: i < displayRows.length - 1 ? '1px solid #F1F5F9' : 'none', backgroundColor: i % 2 === 0 ? '#FFFFFF' : '#FAFAFA' }}>
                {cols.map((c) => {
                  const val = row[c];
                  const display = val === null || val === undefined ? '' : String(val);
                  return (
                    <td key={c} style={{ padding: '4px 6px', maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontFamily: 'var(--font-mono)', fontSize: '10px', color: display ? '#0D1117' : '#CBD5E1' }} title={display}>
                      {display || <span style={{ fontStyle: 'italic' }}>null</span>}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length > 2 && (
        <button
          onClick={() => setExpanded((v) => !v)}
          style={{ marginTop: 4, fontSize: 10, color: '#2563EB', background: 'none', border: 'none', cursor: 'pointer', padding: 0, display: 'flex', alignItems: 'center', gap: 3 }}
        >
          {expanded ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
          {expanded ? 'Show less' : `Show all ${rows.length} rows`}
        </button>
      )}
    </div>
  );
};

// ── Node-type-specific stats ──────────────────────────────────────────────────

const NodeStats: React.FC<{ nodeType: string; stats: Record<string, unknown>; dropped: number }> = ({ nodeType, stats, dropped }) => {
  if (!stats || Object.keys(stats).length === 0) return null;

  const type = nodeType.toUpperCase();

  if (type === 'FILTER') {
    return (
      <div style={{ padding: '8px 10px', backgroundColor: dropped > 0 ? '#FFF7ED' : '#F0FDF4', borderRadius: 4, marginBottom: 10, border: `1px solid ${dropped > 0 ? '#FED7AA' : '#BBF7D0'}` }}>
        <div style={{ fontSize: 10, fontWeight: 600, color: dropped > 0 ? '#C2410C' : '#15803D', marginBottom: 4 }}>
          {dropped > 0 ? `${dropped} rows dropped by filter` : 'No rows dropped'}
        </div>
        {!!stats.expression && (
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: '#64748B', wordBreak: 'break-all' }}>
            {String(stats.expression).slice(0, 120)}{String(stats.expression).length > 120 ? '…' : ''}
          </div>
        )}
      </div>
    );
  }

  if (type === 'ENRICH') {
    const matchRate = Number(stats.match_rate || 0);
    const pct = Math.round(matchRate * 100);
    const color = pct >= 80 ? '#16A34A' : pct >= 50 ? '#D97706' : '#DC2626';
    return (
      <div style={{ padding: '8px 10px', backgroundColor: '#F8FAFC', borderRadius: 4, marginBottom: 10, border: '1px solid #E2E8F0' }}>
        <div style={{ fontSize: 10, fontWeight: 600, color: '#64748B', marginBottom: 6 }}>Enrichment Match Rate</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ flex: 1, height: 6, backgroundColor: '#E2E8F0', borderRadius: 3, overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${pct}%`, backgroundColor: color, borderRadius: 3, transition: 'width 400ms' }} />
          </div>
          <span style={{ fontSize: 12, fontWeight: 700, color, fontFamily: 'var(--font-mono)', minWidth: 36 }}>{pct}%</span>
        </div>
        <div style={{ display: 'flex', gap: 12, marginTop: 6, fontSize: 10, color: '#64748B' }}>
          <span><strong style={{ color: '#16A34A' }}>{String(stats.matched)}</strong> matched</span>
          <span><strong style={{ color: '#DC2626' }}>{String(stats.unmatched)}</strong> unmatched</span>
          {!!stats.join_key && <span>join: <span style={{ fontFamily: 'var(--font-mono)', color: '#0D1117' }}>{String(stats.join_key)}</span></span>}
        </div>
      </div>
    );
  }

  if (type === 'MAP') {
    const mappings = stats.mappings as Record<string, string> | null;
    if (!mappings || Object.keys(mappings).length === 0) return null;
    return (
      <div style={{ marginBottom: 10 }}>
        <div style={{ fontSize: 10, fontWeight: 600, color: '#64748B', textTransform: 'uppercase', marginBottom: 5 }}>Field Mappings</div>
        <div style={{ border: '1px solid #E2E8F0', borderRadius: 4, overflow: 'hidden' }}>
          {Object.entries(mappings).slice(0, 10).map(([from, to], i, arr) => (
            <div key={from} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 8px', borderBottom: i < arr.length - 1 ? '1px solid #F1F5F9' : 'none', backgroundColor: i % 2 === 0 ? '#FFFFFF' : '#FAFAFA', fontSize: 10 }}>
              <span style={{ fontFamily: 'var(--font-mono)', color: '#64748B', flex: 1 }}>{from}</span>
              <ArrowRight size={9} color="#94A3B8" />
              <span style={{ fontFamily: 'var(--font-mono)', color: '#0D1117', flex: 1 }}>{to}</span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (type === 'DEDUPE') {
    return (
      <div style={{ padding: '8px 10px', backgroundColor: '#F5F3FF', borderRadius: 4, marginBottom: 10, border: '1px solid #DDD6FE', fontSize: 10 }}>
        <span style={{ fontWeight: 600, color: '#6D28D9' }}>{String(stats.duplicates_removed || 0)} duplicates removed</span>
        {!!stats.keys && <div style={{ color: '#64748B', marginTop: 3, fontFamily: 'var(--font-mono)' }}>keys: {String(stats.keys)}</div>}
      </div>
    );
  }

  if (type === 'VALIDATE') {
    return (
      <div style={{ padding: '8px 10px', backgroundColor: dropped > 0 ? '#FFF1F2' : '#F0FDF4', borderRadius: 4, marginBottom: 10, border: `1px solid ${dropped > 0 ? '#FECDD3' : '#BBF7D0'}`, fontSize: 10 }}>
        <span style={{ fontWeight: 600, color: dropped > 0 ? '#BE123C' : '#15803D' }}>
          {dropped > 0 ? `${dropped} invalid rows dropped` : 'All rows passed validation'}
        </span>
        {Array.isArray(stats.required_fields) && stats.required_fields.length > 0 && (
          <div style={{ color: '#64748B', marginTop: 3 }}>required: {(stats.required_fields as string[]).join(', ')}</div>
        )}
      </div>
    );
  }

  if (type === 'SINK_OBJECT') {
    return (
      <div style={{ padding: '8px 10px', backgroundColor: '#EFF6FF', borderRadius: 4, marginBottom: 10, border: '1px solid #BFDBFE', fontSize: 10 }}>
        <div style={{ fontWeight: 600, color: '#1D4ED8' }}>Written to ontology</div>
        {!!stats.object_type_id && <div style={{ color: '#64748B', marginTop: 2, fontFamily: 'var(--font-mono)' }}>{String(stats.object_type_id)}</div>}
        {!!stats.write_mode && <div style={{ color: '#64748B', marginTop: 1 }}>mode: {String(stats.write_mode)}</div>}
      </div>
    );
  }

  if (type === 'SINK_EVENT') {
    return (
      <div style={{ padding: '8px 10px', backgroundColor: '#ECFDF5', borderRadius: 4, marginBottom: 10, border: '1px solid #BBF7D0', fontSize: 10 }}>
        <span style={{ fontWeight: 600, color: '#065F46' }}>{String(stats.events_emitted || 0)} events emitted</span>
        {!!stats.activity_field && <div style={{ color: '#64748B', marginTop: 2 }}>activity: <span style={{ fontFamily: 'var(--font-mono)' }}>{String(stats.activity_field)}</span></div>}
      </div>
    );
  }

  if (type === 'SOURCE') {
    return (
      <div style={{ padding: '8px 10px', backgroundColor: '#F8FAFC', borderRadius: 4, marginBottom: 10, border: '1px solid #E2E8F0', fontSize: 10 }}>
        {!!stats.connector_id && <div style={{ color: '#64748B' }}>connector: <span style={{ fontFamily: 'var(--font-mono)', color: '#0D1117' }}>{String(stats.connector_id)}</span></div>}
        {!!stats.endpoint && <div style={{ color: '#64748B', marginTop: 2 }}>endpoint: <span style={{ fontFamily: 'var(--font-mono)', color: '#0D1117' }}>{String(stats.endpoint)}</span></div>}
      </div>
    );
  }

  return null;
};

// ── Main component ────────────────────────────────────────────────────────────

export const NodeAuditPanel: React.FC<Props> = ({ node, audit, loading }) => {
  const color = nodeColors[node.type] || '#64748B';

  if (loading) {
    return (
      <div style={{ padding: 16, color: '#94A3B8', fontSize: 12, textAlign: 'center' }}>
        Loading run data…
      </div>
    );
  }

  if (!audit) {
    return (
      <div style={{ padding: 20, textAlign: 'center' }}>
        <Clock size={24} color="#CBD5E1" style={{ marginBottom: 8 }} />
        <div style={{ fontSize: 12, color: '#94A3B8' }}>No run data yet</div>
        <div style={{ fontSize: 11, color: '#CBD5E1', marginTop: 4 }}>Run the pipeline to see per-step audit data</div>
      </div>
    );
  }

  const throughput = audit.rows_in > 0 ? Math.round((audit.rows_out / audit.rows_in) * 100) : 100;
  const hasDropped = audit.dropped > 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* Row funnel */}
      <div style={{ padding: '10px 12px', borderBottom: '1px solid #E2E8F0', backgroundColor: '#F8FAFC', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 18, fontWeight: 700, color: '#0D1117', fontFamily: 'var(--font-mono)' }}>{audit.rows_in.toLocaleString()}</div>
            <div style={{ fontSize: 9, color: '#94A3B8', textTransform: 'uppercase', fontWeight: 600 }}>In</div>
          </div>
          <div style={{ flex: 1, position: 'relative', height: 20, display: 'flex', alignItems: 'center' }}>
            <div style={{ flex: 1, height: 3, backgroundColor: '#E2E8F0', borderRadius: 2, overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${throughput}%`, backgroundColor: hasDropped ? '#F59E0B' : color, borderRadius: 2, transition: 'width 400ms' }} />
            </div>
            <ArrowRight size={12} color={hasDropped ? '#F59E0B' : color} style={{ marginLeft: 4, flexShrink: 0 }} />
          </div>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 18, fontWeight: 700, color: '#0D1117', fontFamily: 'var(--font-mono)' }}>{audit.rows_out.toLocaleString()}</div>
            <div style={{ fontSize: 9, color: '#94A3B8', textTransform: 'uppercase', fontWeight: 600 }}>Out</div>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {hasDropped && (
            <span style={{ fontSize: 10, padding: '2px 7px', borderRadius: 3, backgroundColor: '#FFF7ED', color: '#C2410C', border: '1px solid #FED7AA', fontWeight: 600 }}>
              <AlertTriangle size={9} style={{ marginRight: 3, verticalAlign: 'middle' }} />
              {audit.dropped} dropped
            </span>
          )}
          {!hasDropped && audit.rows_in > 0 && (
            <span style={{ fontSize: 10, padding: '2px 7px', borderRadius: 3, backgroundColor: '#F0FDF4', color: '#16A34A', border: '1px solid #BBF7D0', fontWeight: 600 }}>
              <CheckCircle2 size={9} style={{ marginRight: 3, verticalAlign: 'middle' }} />
              100% pass-through
            </span>
          )}
          <span style={{ fontSize: 10, padding: '2px 7px', borderRadius: 3, backgroundColor: '#F1F5F9', color: '#64748B', border: '1px solid #E2E8F0' }}>
            <Clock size={9} style={{ marginRight: 3, verticalAlign: 'middle' }} />
            {audit.duration_ms}ms
          </span>
          <span style={{ fontSize: 10, padding: '2px 7px', borderRadius: 3, backgroundColor: '#F1F5F9', color: '#64748B', border: '1px solid #E2E8F0' }}>
            {new Date(audit.started_at).toLocaleTimeString()}
          </span>
        </div>
      </div>

      {/* Scrollable body */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '10px 12px' }}>
        {/* Node-type-specific stats */}
        <NodeStats nodeType={audit.node_type} stats={audit.stats} dropped={audit.dropped} />

        {/* Sample IN */}
        <MiniTable rows={audit.sample_in} label="Sample In" accent="#94A3B8" />

        {/* Sample OUT */}
        <MiniTable rows={audit.sample_out} label="Sample Out" accent={color} />
      </div>
    </div>
  );
};
