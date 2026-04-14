import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  BarChart3, Filter, Play, Download, Sparkles, ChevronDown,
  Plus, X, Table2, BarChart2, Bot, Search, Loader2, Database,
  ArrowUpDown, RefreshCw, Share2, FlaskConical, Trash2,
} from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  Cell, Legend,
} from 'recharts';
import { useExplorerStore, FilterRow, AggregateSpec } from '../../store/explorerStore';
import { useGraphStore } from '../../store/graphStore';
import { useNavigationStore } from '../../store/navigationStore';
import { getTenantId } from '../../store/authStore';
import { CheckpointGate } from '../audit/CheckpointGate';

const ANALYTICS_API = import.meta.env.VITE_ANALYTICS_SERVICE_URL || 'http://localhost:8015';

// ── Theme ─────────────────────────────────────────────────────────────────────
const C = {
  bg: '#F8FAFC',
  panel: '#FFFFFF',
  border: '#E2E8F0',
  accent: '#7C3AED',
  accentLight: '#EDE9FE',
  text: '#0D1117',
  muted: '#64748B',
  subtle: '#94A3B8',
  hover: '#F1F5F9',
  success: '#059669',
  warning: '#D97706',
  error: '#DC2626',
};

const CHART_COLORS = ['#7C3AED', '#2563EB', '#059669', '#D97706', '#DC2626', '#DB2777', '#0891B2', '#65A30D'];

const FILTER_OPS = [
  { value: 'eq', label: '=' },
  { value: 'neq', label: '≠' },
  { value: 'contains', label: 'contains' },
  { value: 'starts_with', label: 'starts with' },
  { value: 'gt', label: '>' },
  { value: 'gte', label: '>=' },
  { value: 'lt', label: '<' },
  { value: 'lte', label: '<=' },
  { value: 'is_null', label: 'is empty' },
  { value: 'is_not_null', label: 'is set' },
];

const AGG_FUNCS = ['COUNT', 'SUM', 'AVG', 'MIN', 'MAX'];

// ── Helpers ────────────────────────────────────────────────────────────────────

function fmtNum(n: unknown): string {
  if (n == null) return '—';
  const num = Number(n);
  if (isNaN(num)) return String(n);
  if (Number.isInteger(num) || Math.abs(num) >= 1000) return num.toLocaleString();
  return num.toFixed(2);
}

function exportCsv(columns: string[], rows: Record<string, unknown>[]) {
  const header = columns.join(',');
  const lines = rows.map((r) =>
    columns.map((c) => {
      const v = r[c];
      const s = v == null ? '' : String(v);
      return s.includes(',') || s.includes('"') ? `"${s.replace(/"/g, '""')}"` : s;
    }).join(',')
  );
  const blob = new Blob([[header, ...lines].join('\n')], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'export.csv';
  a.click();
  URL.revokeObjectURL(url);
}

// ── Sub-components ─────────────────────────────────────────────────────────────

const TabBtn: React.FC<{ active: boolean; onClick: () => void; children: React.ReactNode }> = ({ active, onClick, children }) => (
  <button
    onClick={onClick}
    style={{
      display: 'flex', alignItems: 'center', gap: 5, padding: '6px 14px',
      border: 'none', borderBottom: active ? `2px solid ${C.accent}` : '2px solid transparent',
      backgroundColor: 'transparent', cursor: 'pointer',
      fontSize: 13, fontWeight: active ? 600 : 500,
      color: active ? C.accent : C.muted,
      transition: 'all 120ms',
    }}
  >
    {children}
  </button>
);

const FieldPill: React.FC<{ field: string; onClick?: () => void }> = ({ field, onClick }) => (
  <button
    onClick={onClick}
    title={field}
    style={{
      display: 'block', width: '100%', textAlign: 'left',
      padding: '5px 10px', borderRadius: 4, fontSize: 12,
      border: '1px solid transparent', backgroundColor: 'transparent',
      color: C.muted, cursor: onClick ? 'pointer' : 'default',
      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      transition: 'all 100ms',
    }}
    onMouseEnter={(e) => { if (onClick) { (e.currentTarget as HTMLButtonElement).style.backgroundColor = C.hover; (e.currentTarget as HTMLButtonElement).style.color = C.text; } }}
    onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.backgroundColor = 'transparent'; (e.currentTarget as HTMLButtonElement).style.color = C.muted; }}
  >
    {field}
  </button>
);

// ── Filter Builder ─────────────────────────────────────────────────────────────

const FilterBuilder: React.FC<{
  filters: FilterRow[];
  fields: string[];
  onChange: (filters: FilterRow[]) => void;
}> = ({ filters, fields, onChange }) => {
  const addFilter = () => {
    onChange([...filters, { id: crypto.randomUUID(), field: fields[0] || '', op: 'eq', value: '' }]);
  };
  const removeFilter = (id: string) => onChange(filters.filter((f) => f.id !== id));
  const updateFilter = (id: string, patch: Partial<FilterRow>) =>
    onChange(filters.map((f) => (f.id === id ? { ...f, ...patch } : f)));

  const inputStyle: React.CSSProperties = {
    height: 28, padding: '0 8px', borderRadius: 4, fontSize: 12,
    border: `1px solid ${C.border}`, backgroundColor: C.panel, color: C.text, outline: 'none',
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {filters.map((f) => (
        <div key={f.id} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <select
            value={f.field}
            onChange={(e) => updateFilter(f.id, { field: e.target.value })}
            style={{ ...inputStyle, flex: 1, minWidth: 0 }}
          >
            {fields.map((field) => <option key={field} value={field}>{field}</option>)}
          </select>
          <select
            value={f.op}
            onChange={(e) => updateFilter(f.id, { op: e.target.value })}
            style={{ ...inputStyle, width: 110 }}
          >
            {FILTER_OPS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          {!['is_null', 'is_not_null'].includes(f.op) && (
            <input
              value={f.value}
              onChange={(e) => updateFilter(f.id, { value: e.target.value })}
              placeholder="value"
              style={{ ...inputStyle, width: 120 }}
            />
          )}
          <button
            onClick={() => removeFilter(f.id)}
            style={{ width: 24, height: 24, border: 'none', borderRadius: 4, backgroundColor: 'transparent', cursor: 'pointer', color: C.subtle, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          >
            <X size={13} />
          </button>
        </div>
      ))}
      <button
        onClick={addFilter}
        disabled={fields.length === 0}
        style={{
          display: 'flex', alignItems: 'center', gap: 4, padding: '5px 10px',
          border: `1px dashed ${C.border}`, borderRadius: 4, backgroundColor: 'transparent',
          cursor: fields.length === 0 ? 'not-allowed' : 'pointer', fontSize: 12, color: C.muted,
          opacity: fields.length === 0 ? 0.5 : 1,
        }}
      >
        <Plus size={12} /> Add filter
      </button>
    </div>
  );
};

// ── Results Table ──────────────────────────────────────────────────────────────

const ResultsTable: React.FC<{
  columns: string[];
  rows: Record<string, unknown>[];
  total: number;
  queryMs: number;
  page: number;
  pageSize: number;
  onPageChange: (p: number) => void;
}> = ({ columns, rows, total, queryMs, page, pageSize, onPageChange }) => {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const visibleCols = columns.slice(0, 12);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ flex: 1, overflow: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr style={{ backgroundColor: C.bg, position: 'sticky', top: 0, zIndex: 1 }}>
              {visibleCols.map((col) => (
                <th key={col} style={{
                  padding: '8px 12px', textAlign: 'left', fontWeight: 600,
                  color: C.muted, borderBottom: `1px solid ${C.border}`,
                  whiteSpace: 'nowrap', fontSize: 11,
                }}>
                  {col.startsWith('_') ? col.slice(1) : col}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr
                key={i}
                style={{ borderBottom: `1px solid ${C.border}`, transition: 'background 80ms' }}
                onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = C.hover)}
                onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
              >
                {visibleCols.map((col) => {
                  const val = row[col];
                  return (
                    <td key={col} style={{
                      padding: '7px 12px', color: C.text,
                      maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>
                      {val == null ? <span style={{ color: C.subtle }}>—</span> : String(val)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && (
          <div style={{ textAlign: 'center', padding: '48px 0', color: C.subtle, fontSize: 13 }}>
            No records found. Try adjusting your filters.
          </div>
        )}
      </div>

      {/* Pagination + meta */}
      <div style={{
        height: 36, borderTop: `1px solid ${C.border}`, display: 'flex',
        alignItems: 'center', padding: '0 16px', gap: 12, backgroundColor: C.bg, flexShrink: 0,
      }}>
        <span style={{ fontSize: 11, color: C.muted, fontFamily: 'var(--font-mono)' }}>
          {total.toLocaleString()} records · {queryMs}ms
        </span>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 4, alignItems: 'center' }}>
          <button
            onClick={() => onPageChange(page - 1)}
            disabled={page <= 1}
            style={{ padding: '3px 8px', border: `1px solid ${C.border}`, borderRadius: 4, backgroundColor: C.panel, cursor: page <= 1 ? 'not-allowed' : 'pointer', fontSize: 11, color: page <= 1 ? C.subtle : C.text, opacity: page <= 1 ? 0.5 : 1 }}
          >
            Prev
          </button>
          <span style={{ fontSize: 11, color: C.muted, padding: '0 4px' }}>
            {page} / {totalPages}
          </span>
          <button
            onClick={() => onPageChange(page + 1)}
            disabled={page >= totalPages}
            style={{ padding: '3px 8px', border: `1px solid ${C.border}`, borderRadius: 4, backgroundColor: C.panel, cursor: page >= totalPages ? 'not-allowed' : 'pointer', fontSize: 11, color: page >= totalPages ? C.subtle : C.text, opacity: page >= totalPages ? 0.5 : 1 }}
          >
            Next
          </button>
        </div>
      </div>
    </div>
  );
};

// ── Chart View ─────────────────────────────────────────────────────────────────

const ChartView: React.FC<{
  rows: Record<string, unknown>[];
  aggregate: AggregateSpec | null;
  groupBy: string | null;
  fields: string[];
}> = ({ rows, aggregate, groupBy, fields }) => {
  // Detect whether rows are pre-aggregated (have agg_value) or raw records
  const isAggregated = rows.length > 0 && 'agg_value' in rows[0];

  // Local chart config for raw-record mode
  const [xField, setXField] = useState<string>('');
  const [yFunc, setYFunc] = useState<'COUNT' | 'AVG' | 'SUM'>('COUNT');
  const [yField, setYField] = useState<string>('');
  const [excludeBlanks, setExcludeBlanks] = useState(true);
  const [nlInput, setNlInput] = useState('');

  // Pick a sensible default x-field when fields change
  useEffect(() => {
    if (!xField && fields.length) {
      const pref = fields.find(f => ['outcome', 'diagnosis', 'gender', 'status', 'category', 'type'].some(k => f.includes(k)));
      setXField(pref || fields.find(f => !f.startsWith('_')) || fields[0]);
    }
  }, [fields]);

  useEffect(() => {
    if (!yField && fields.length) {
      const num = fields.find(f => ['age', 'count', 'amount', 'duration', 'hours', 'score'].some(k => f.includes(k)));
      setYField(num || fields.find(f => !f.startsWith('_') && f !== xField) || fields[0]);
    }
  }, [fields, xField]);

  // NL prompt — parse simple instructions to set axes
  const handleNlSubmit = () => {
    const q = nlInput.toLowerCase();
    const userFields = fields.filter(f => !f.startsWith('_'));
    // Find field mentions
    const mentionedField = userFields.find(f => q.includes(f.toLowerCase().replace(/_/g, ' ')) || q.includes(f.toLowerCase()));
    const wantsAvg = /average|avg|mean/.test(q);
    const wantsSum = /sum|total/.test(q);
    if (mentionedField) setXField(mentionedField);
    if (wantsAvg) setYFunc('AVG');
    else if (wantsSum) setYFunc('SUM');
    else setYFunc('COUNT');
    if ((wantsAvg || wantsSum) && mentionedField) {
      const numField = userFields.find(f => f !== mentionedField && ['age', 'duration', 'hours', 'count', 'amount', 'score'].some(k => f.includes(k)));
      if (numField) setYField(numField);
    }
    setNlInput('');
  };

  if (!rows.length) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: C.subtle, fontSize: 13 }}>
        No data. Run a query first.
      </div>
    );
  }

  let data: { name: string; value: number }[];
  let label: string;

  if (isAggregated) {
    // Pre-aggregated from server
    data = rows.map((r) => ({
      name: String(r.group_key ?? r[groupBy || ''] ?? ''),
      value: Number(r.agg_value ?? 0),
    })).slice(0, 30);
    label = aggregate ? `${aggregate.function}(${aggregate.field === '*' ? 'records' : aggregate.field})` : 'Value';
  } else {
    // Compute client-side groupby
    const activeX = xField || fields[0] || '';
    const counts: Record<string, number> = {};
    const sums: Record<string, number> = {};
    for (const row of rows) {
      const rawKey = row[activeX];
      if (excludeBlanks && (rawKey === null || rawKey === undefined || rawKey === '' || rawKey === '—')) continue;
      const key = String(rawKey ?? '(blank)');
      counts[key] = (counts[key] || 0) + 1;
      const numVal = Number(row[yField] ?? 0);
      sums[key] = (sums[key] || 0) + (isNaN(numVal) ? 0 : numVal);
    }
    const entries = Object.entries(yFunc === 'COUNT' ? counts : sums)
      .map(([name, value]) => ({
        name,
        value: yFunc === 'AVG' ? +(value / (counts[name] || 1)).toFixed(2) : value,
      }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 50);
    data = entries;
    label = yFunc === 'COUNT' ? 'Count' : `${yFunc}(${yField})`;
  }

  const selectStyle: React.CSSProperties = {
    fontSize: 12, border: `1px solid ${C.border}`, borderRadius: 4,
    padding: '4px 8px', color: C.text, backgroundColor: C.panel, outline: 'none',
  };

  return (
    <div style={{ flex: 1, padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
      {/* Axis controls (only shown for raw-record mode) */}
      {!isAggregated && (
        <>
          {/* NL prompt */}
          <div style={{ display: 'flex', gap: 6 }}>
            <input
              value={nlInput}
              onChange={(e) => setNlInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleNlSubmit(); }}
              placeholder='e.g. "show age distribution" or "average episode duration by outcome"'
              style={{ flex: 1, fontSize: 12, border: `1px solid ${C.border}`, borderRadius: 4, padding: '5px 10px', color: C.text, backgroundColor: C.panel, outline: 'none' }}
            />
            <button
              onClick={handleNlSubmit}
              disabled={!nlInput.trim()}
              style={{ fontSize: 12, padding: '5px 12px', border: 'none', borderRadius: 4, backgroundColor: C.accent, color: '#fff', cursor: nlInput.trim() ? 'pointer' : 'not-allowed', opacity: nlInput.trim() ? 1 : 0.5 }}
            >
              Apply
            </button>
          </div>

          {/* Axis selectors */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 11, color: C.muted, fontWeight: 500 }}>X</span>
              <select value={xField} onChange={(e) => setXField(e.target.value)} style={selectStyle}>
                {fields.filter(f => !f.startsWith('_')).map(f => <option key={f} value={f}>{f}</option>)}
              </select>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 11, color: C.muted, fontWeight: 500 }}>Y</span>
              <select value={yFunc} onChange={(e) => setYFunc(e.target.value as 'COUNT' | 'AVG' | 'SUM')} style={selectStyle}>
                <option value="COUNT">COUNT</option>
                <option value="SUM">SUM</option>
                <option value="AVG">AVG</option>
              </select>
              {yFunc !== 'COUNT' && (
                <select value={yField} onChange={(e) => setYField(e.target.value)} style={selectStyle}>
                  {fields.filter(f => !f.startsWith('_')).map(f => <option key={f} value={f}>{f}</option>)}
                </select>
              )}
            </div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: C.muted, cursor: 'pointer', userSelect: 'none' }}>
              <input type="checkbox" checked={excludeBlanks} onChange={(e) => setExcludeBlanks(e.target.checked)} style={{ cursor: 'pointer' }} />
              Hide blanks
            </label>
            <span style={{ fontSize: 11, color: C.subtle, marginLeft: 'auto' }}>
              {data.length} groups · {rows.length.toLocaleString()} records
            </span>
          </div>
        </>
      )}

      {!isAggregated && (
        <div style={{ fontSize: 11, color: C.muted }}>
          {xField} — {label}
          {data.length === 30 && <span style={{ color: C.subtle }}> (top 30)</span>}
        </div>
      )}
      {isAggregated && (
        <div style={{ fontSize: 11, color: C.muted }}>
          {groupBy} — {label}
          {rows.length > 30 && <span style={{ color: C.subtle }}> (top 30 of {rows.length})</span>}
        </div>
      )}

      <ResponsiveContainer width="100%" height={400}>
        <BarChart data={data} margin={{ top: 8, right: 24, left: 0, bottom: 60 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
          <XAxis
            dataKey="name"
            tick={{ fontSize: 11, fill: C.muted }}
            angle={-35}
            textAnchor="end"
            interval={0}
          />
          <YAxis tick={{ fontSize: 11, fill: C.muted }} tickFormatter={(v) => fmtNum(v)} />
          <Tooltip
            formatter={(v) => [fmtNum(v as number), label]}
            contentStyle={{ backgroundColor: C.panel, border: `1px solid ${C.border}`, borderRadius: 6, fontSize: 12 }}
          />
          <Bar dataKey="value" radius={[3, 3, 0, 0]}>
            {data.map((_, idx) => (
              <Cell key={idx} fill={CHART_COLORS[idx % CHART_COLORS.length]} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
};

// ── AIP Analyst ────────────────────────────────────────────────────────────────

const AIPAnalyst: React.FC<{
  typeId: string | null;
  typeName: string;
}> = ({ typeId, typeName }) => {
  const { runAnalyst, analystResult, loadingAnalyst } = useExplorerStore();
  const [question, setQuestion] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const examples = [
    `How many ${typeName} records are there in total?`,
    `Show the breakdown of ${typeName} by status`,
    `What are the top 10 ${typeName} records?`,
    `What is the average value across all ${typeName} records?`,
  ];

  const handleSubmit = useCallback(() => {
    if (!typeId || !question.trim() || loadingAnalyst) return;
    runAnalyst(question);
  }, [typeId, question, loadingAnalyst, runAnalyst]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', padding: '20px 24px', gap: 16 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
        <div style={{ width: 32, height: 32, borderRadius: 8, backgroundColor: C.accentLight, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <Bot size={16} color={C.accent} />
        </div>
        <div>
          <div style={{ fontSize: 14, fontWeight: 600, color: C.text }}>AIP Analyst</div>
          <div style={{ fontSize: 12, color: C.muted, marginTop: 2 }}>
            Ask questions about your {typeName} data in plain English
          </div>
        </div>
      </div>

      {/* Input area */}
      <div style={{ position: 'relative' }}>
        <textarea
          ref={textareaRef}
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleSubmit(); }}
          placeholder={typeId ? `Ask anything about your ${typeName} data…` : 'Select an object type first'}
          disabled={!typeId || loadingAnalyst}
          rows={3}
          style={{
            width: '100%', padding: '10px 44px 10px 12px', borderRadius: 6,
            border: `1px solid ${C.border}`, fontSize: 13, color: C.text,
            backgroundColor: typeId ? C.panel : C.bg, resize: 'none', outline: 'none',
            fontFamily: 'inherit', lineHeight: 1.5, boxSizing: 'border-box',
          }}
        />
        <button
          onClick={handleSubmit}
          disabled={!typeId || !question.trim() || loadingAnalyst}
          style={{
            position: 'absolute', right: 8, bottom: 8,
            width: 28, height: 28, borderRadius: 6,
            backgroundColor: (!typeId || !question.trim() || loadingAnalyst) ? C.border : C.accent,
            border: 'none', cursor: (!typeId || !question.trim() || loadingAnalyst) ? 'not-allowed' : 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            transition: 'all 120ms',
          }}
        >
          {loadingAnalyst
            ? <Loader2 size={14} color="#fff" style={{ animation: 'spin 0.8s linear infinite' }} />
            : <Sparkles size={14} color="#fff" />
          }
        </button>
        <div style={{ position: 'absolute', right: 8, top: 8, fontSize: 10, color: C.subtle }}>
          ⌘↵
        </div>
      </div>

      {/* Example prompts */}
      {!analystResult && !loadingAnalyst && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ fontSize: 11, color: C.subtle, textTransform: 'uppercase', fontWeight: 600, letterSpacing: '0.05em' }}>
            Try asking
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {examples.map((ex) => (
              <button
                key={ex}
                onClick={() => { setQuestion(ex); textareaRef.current?.focus(); }}
                disabled={!typeId}
                style={{
                  textAlign: 'left', padding: '7px 12px', borderRadius: 6,
                  border: `1px solid ${C.border}`, backgroundColor: C.bg,
                  fontSize: 12, color: C.muted, cursor: typeId ? 'pointer' : 'not-allowed',
                  transition: 'all 100ms',
                }}
                onMouseEnter={(e) => { if (typeId) { (e.currentTarget as HTMLButtonElement).style.backgroundColor = C.hover; (e.currentTarget as HTMLButtonElement).style.borderColor = C.accent; } }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.backgroundColor = C.bg; (e.currentTarget as HTMLButtonElement).style.borderColor = C.border; }}
              >
                {ex}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Loading */}
      {loadingAnalyst && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '16px 20px', backgroundColor: C.accentLight, borderRadius: 8 }}>
          <Loader2 size={16} color={C.accent} style={{ animation: 'spin 0.8s linear infinite' }} />
          <div style={{ fontSize: 13, color: C.accent }}>Analyzing your data…</div>
        </div>
      )}

      {/* Result */}
      {analystResult && !loadingAnalyst && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {/* Answer */}
          <div style={{ padding: '16px 20px', backgroundColor: C.panel, border: `1px solid ${C.border}`, borderRadius: 8 }}>
            <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
              <Bot size={14} color={C.accent} />
              <span style={{ fontSize: 11, fontWeight: 600, color: C.accent, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Analysis</span>
            </div>
            <p style={{ fontSize: 13, color: C.text, lineHeight: 1.6, margin: 0, whiteSpace: 'pre-wrap' }}>
              {analystResult.answer}
            </p>
          </div>

          {/* Data table from analyst */}
          {analystResult.rows && analystResult.columns && analystResult.rows.length > 0 && (
            <div style={{ border: `1px solid ${C.border}`, borderRadius: 8, overflow: 'hidden' }}>
              <div style={{ padding: '8px 16px', backgroundColor: C.bg, borderBottom: `1px solid ${C.border}`, fontSize: 11, color: C.muted, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span>{analystResult.total?.toLocaleString()} rows returned</span>
                <button
                  onClick={() => exportCsv(analystResult.columns!, analystResult.rows!)}
                  style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '3px 8px', border: `1px solid ${C.border}`, borderRadius: 4, backgroundColor: C.panel, cursor: 'pointer', fontSize: 11, color: C.muted }}
                >
                  <Download size={11} /> Export CSV
                </button>
              </div>
              <div style={{ overflowX: 'auto', maxHeight: 280 }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                  <thead>
                    <tr style={{ backgroundColor: C.bg }}>
                      {analystResult.columns.map((c) => (
                        <th key={c} style={{ padding: '6px 12px', textAlign: 'left', fontWeight: 600, color: C.muted, borderBottom: `1px solid ${C.border}`, whiteSpace: 'nowrap', fontSize: 11 }}>
                          {c}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {analystResult.rows.slice(0, 50).map((row, i) => (
                      <tr key={i} style={{ borderBottom: `1px solid ${C.border}` }}>
                        {analystResult.columns!.map((c) => (
                          <td key={c} style={{ padding: '6px 12px', color: C.text, whiteSpace: 'nowrap', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {row[c] == null ? <span style={{ color: C.subtle }}>—</span> : String(row[c])}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
};

// ── Scenario Panel ─────────────────────────────────────────────────────────────

interface Override {
  id: string;
  // Record-level override
  object_id?: string;
  // Rule-based override (applies to all matching records)
  filter_field?: string;
  filter_op?: string;
  filter_value?: string;
  property: string;
  simulated_value: string;
}

interface Metric {
  id: string;
  name: string;
  function: string;
  field: string;
  filter_field?: string;
  filter_value?: string;
  filter_op?: string;
}

interface ScenarioResult {
  record_count: number;
  affected_records: number;
  deltas: Record<string, { baseline: number | null; simulated: number | null; absolute: number | null; percent: number | null }>;
}

const ScenarioPanel: React.FC<{
  typeId: string | null;
  typeName: string;
  fields: string[];
  sampleRows: Record<string, unknown>[];
}> = ({ typeId, typeName, fields, sampleRows }) => {
  const [mode, setMode] = useState<'manual' | 'nl'>('nl');
  const [nlQuestion, setNlQuestion] = useState('');
  const [nlLoading, setNlLoading] = useState(false);
  const [nlPreview, setNlPreview] = useState<{ explanation: string; insight: string; overrides: Override[]; metrics: Metric[] } | null>(null);
  const [overrides, setOverrides] = useState<Override[]>([]);
  const [metrics, setMetrics] = useState<Metric[]>([
    { id: '1', name: 'Count', function: 'COUNT', field: '' },
  ]);
  const [result, setResult] = useState<ScenarioResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sampleIds = sampleRows.slice(0, 20).map((r) => {
    const d = r as Record<string, unknown>;
    return String(d._id || d.id || '');
  }).filter(Boolean);

  const addOverride = () => {
    setOverrides((v) => [...v, { id: crypto.randomUUID(), object_id: sampleIds[0] || '', property: fields[0] || '', simulated_value: '' }]);
  };
  const removeOverride = (id: string) => setOverrides((v) => v.filter((o) => o.id !== id));
  const updateOverride = (id: string, patch: Partial<Override>) =>
    setOverrides((v) => v.map((o) => o.id === id ? { ...o, ...patch } : o));

  const addMetric = () => {
    setMetrics((v) => [...v, { id: crypto.randomUUID(), name: '', function: 'SUM', field: fields[0] || '' }]);
  };
  const removeMetric = (id: string) => setMetrics((v) => v.filter((m) => m.id !== id));
  const updateMetric = (id: string, patch: Partial<Metric>) =>
    setMetrics((v) => v.map((m) => m.id === id ? { ...m, ...patch } : m));

  const handleInterpret = async () => {
    if (!typeId || !nlQuestion.trim()) return;
    setNlLoading(true);
    setNlPreview(null);
    setError(null);
    try {
      const resp = await fetch(`${ANALYTICS_API}/scenarios/interpret`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-tenant-id': getTenantId() },
        body: JSON.stringify({
          object_type_id: typeId,
          object_type_name: typeName,
          description: nlQuestion,
          fields,
        }),
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ detail: resp.statusText }));
        throw new Error(err.detail || `HTTP ${resp.status}`);
      }
      const data = await resp.json();
      setNlPreview({
        explanation: data.explanation || '',
        insight: data.insight || '',
        overrides: (data.overrides || []).map((o: Record<string, string>, i: number) => ({
          id: String(i),
          object_id: o.object_id || undefined,
          filter_field: o.filter_field || undefined,
          filter_op: o.filter_op || 'eq',
          filter_value: o.filter_value || undefined,
          property: o.property || '',
          simulated_value: o.simulated_value || '',
        })),
        metrics: (data.derived_metrics || []).map((m: Record<string, string>, i: number) => ({
          id: String(i),
          name: m.name || '',
          function: m.function || 'COUNT',
          field: m.field || '',
          filter_field: m.filter_field || undefined,
          filter_value: m.filter_value || undefined,
          filter_op: m.filter_op || 'eq',
        })),
      });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setNlLoading(false);
    }
  };

  const handleRunNl = async () => {
    if (!typeId || !nlPreview) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const resp = await fetch(`${ANALYTICS_API}/scenarios/compute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-tenant-id': getTenantId() },
        body: JSON.stringify({
          object_type_id: typeId,
          overrides: nlPreview.overrides.map((o) => ({
            ...(o.object_id ? { object_id: o.object_id } : {}),
            ...(o.filter_field ? { filter_field: o.filter_field, filter_op: o.filter_op || 'eq', filter_value: o.filter_value } : {}),
            property: o.property,
            simulated_value: o.simulated_value,
          })),
          derived_metrics: nlPreview.metrics.map((m) => ({
            name: m.name || m.function,
            function: m.function,
            field: m.field,
            ...(m.filter_field ? { filter_field: m.filter_field, filter_value: m.filter_value, filter_op: m.filter_op || 'eq' } : {}),
          })),
        }),
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ detail: resp.statusText }));
        throw new Error(err.detail || `HTTP ${resp.status}`);
      }
      setResult(await resp.json());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const handleCompute = async () => {
    if (!typeId) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const resp = await fetch(`${ANALYTICS_API}/scenarios/compute`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-tenant-id': getTenantId(),
        },
        body: JSON.stringify({
          object_type_id: typeId,
          overrides: overrides.map((o) => ({ object_id: o.object_id, property: o.property, simulated_value: o.simulated_value })),
          derived_metrics: metrics.map((m) => ({ name: m.name || m.function, function: m.function, field: m.field })),
        }),
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ detail: resp.statusText }));
        throw new Error(err.detail || `HTTP ${resp.status}`);
      }
      setResult(await resp.json());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const inputStyle: React.CSSProperties = {
    height: 28, padding: '0 8px', borderRadius: 4, fontSize: 12,
    border: `1px solid ${C.border}`, backgroundColor: C.panel, color: C.text, outline: 'none',
  };

  if (!typeId) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: 300, gap: 8, color: C.subtle }}>
        <FlaskConical size={28} color={C.border} />
        <div style={{ fontSize: 13, fontWeight: 500 }}>Select an object type first</div>
      </div>
    );
  }

  return (
    <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 20 }}>

      {/* Mode toggle */}
      <div style={{ display: 'flex', gap: 0, border: `1px solid ${C.border}`, borderRadius: 6, overflow: 'hidden', alignSelf: 'flex-start' }}>
        {(['nl', 'manual'] as const).map((m) => (
          <button
            key={m}
            onClick={() => { setMode(m); setResult(null); setError(null); }}
            style={{
              padding: '6px 16px', border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 600,
              backgroundColor: mode === m ? C.accent : C.panel,
              color: mode === m ? '#fff' : C.muted,
              transition: 'all 120ms',
            }}
          >
            {m === 'nl' ? '✦ Natural Language' : 'Manual Builder'}
          </button>
        ))}
      </div>

      {/* ── NL mode ── */}
      {mode === 'nl' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ fontSize: 12, color: C.subtle }}>
            Describe your what-if scenario in plain language. Claude will generate the simulation plan for you.
          </div>
          <textarea
            value={nlQuestion}
            onChange={(e) => { setNlQuestion(e.target.value); setNlPreview(null); }}
            placeholder={`e.g. "What if all ${typeName} records with priority Alta were downgraded to Media?"`}
            rows={3}
            style={{
              padding: '10px 12px', borderRadius: 6, fontSize: 13, lineHeight: 1.5,
              border: `1px solid ${C.border}`, backgroundColor: C.panel, color: C.text,
              outline: 'none', resize: 'vertical', fontFamily: 'inherit',
            }}
          />
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <button
              onClick={handleInterpret}
              disabled={nlLoading || !nlQuestion.trim()}
              style={{
                display: 'flex', alignItems: 'center', gap: 6, padding: '0 18px', height: 34,
                border: 'none', borderRadius: 6,
                cursor: nlLoading || !nlQuestion.trim() ? 'not-allowed' : 'pointer',
                backgroundColor: nlLoading || !nlQuestion.trim() ? C.border : C.accent,
                color: '#fff', fontSize: 13, fontWeight: 600, transition: 'all 120ms',
              }}
            >
              {nlLoading
                ? <><Loader2 size={13} style={{ animation: 'spin 0.8s linear infinite' }} /> Interpreting…</>
                : <><Sparkles size={13} /> Interpret with Claude</>
              }
            </button>
            {error && !nlPreview && <span style={{ fontSize: 12, color: C.error }}>{error}</span>}
          </div>

          {/* NL Preview card */}
          {nlPreview && (
            <div style={{ border: `1px solid ${C.border}`, borderRadius: 8, overflow: 'hidden' }}>
              <div style={{ padding: '10px 14px', backgroundColor: '#F0FDF4', borderBottom: `1px solid #BBF7D0`, display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                <Sparkles size={14} style={{ color: '#059669', marginTop: 1, flexShrink: 0 }} />
                <div>
                  <div style={{ fontSize: 12, fontWeight: 600, color: '#065F46', marginBottom: 3 }}>Claude's Simulation Plan</div>
                  <div style={{ fontSize: 12, color: '#047857', lineHeight: 1.5 }}>{nlPreview.explanation}</div>
                </div>
              </div>

              {nlPreview.insight && (
                <div style={{ padding: '8px 14px', backgroundColor: '#FFFBEB', borderBottom: `1px solid #FDE68A`, display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                  <span style={{ fontSize: 11, color: '#92400E', fontStyle: 'italic', lineHeight: 1.5 }}>
                    <strong>Predicted outcome:</strong> {nlPreview.insight}
                  </span>
                </div>
              )}

              <div style={{ padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 10 }}>
                {/* Overrides preview */}
                <div>
                  <div style={{ fontSize: 11, fontWeight: 600, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>
                    Overrides ({nlPreview.overrides.length})
                  </div>
                  {nlPreview.overrides.length === 0 ? (
                    <div style={{ fontSize: 12, color: C.subtle, fontStyle: 'italic' }}>No overrides — uses actual data</div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      {nlPreview.overrides.map((o, i) => (
                        <div key={i} style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 12 }}>
                          {o.filter_field ? (
                            <code style={{ color: C.muted, fontSize: 11, backgroundColor: C.bg, padding: '1px 6px', borderRadius: 3 }}>
                              {o.filter_field} {o.filter_op || '='} {o.filter_value}
                            </code>
                          ) : (
                            <code style={{ color: C.muted, fontSize: 11, backgroundColor: C.bg, padding: '1px 6px', borderRadius: 3 }}>
                              id:{String(o.object_id || '').slice(0, 8)}…
                            </code>
                          )}
                          <span style={{ color: C.subtle }}>·</span>
                          <span style={{ color: C.text, fontWeight: 500 }}>{o.property}</span>
                          <span style={{ color: C.subtle }}>→</span>
                          <code style={{ color: C.accent, fontSize: 11, backgroundColor: '#EDE9FE', padding: '1px 6px', borderRadius: 3 }}>
                            {o.simulated_value}
                          </code>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Metrics preview */}
                <div>
                  <div style={{ fontSize: 11, fontWeight: 600, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>
                    Metrics ({nlPreview.metrics.length})
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                    {nlPreview.metrics.map((m, i) => (
                      <span
                        key={i}
                        style={{ fontSize: 11, padding: '2px 8px', borderRadius: 10, backgroundColor: C.accentLight, color: C.accent, fontWeight: 500 }}
                      >
                        {m.name || m.function}
                        {m.filter_field ? ` (${m.filter_field}:${m.filter_value})` : m.field ? ` (${m.field})` : ''}
                      </span>
                    ))}
                  </div>
                </div>
              </div>

              {/* Run button */}
              <div style={{ padding: '10px 14px', backgroundColor: C.bg, borderTop: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', gap: 10 }}>
                <button
                  onClick={handleRunNl}
                  disabled={loading}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 6, padding: '0 18px', height: 34,
                    border: 'none', borderRadius: 6, cursor: loading ? 'not-allowed' : 'pointer',
                    backgroundColor: loading ? C.border : C.success,
                    color: '#fff', fontSize: 13, fontWeight: 600, transition: 'all 120ms',
                  }}
                >
                  {loading
                    ? <><Loader2 size={13} style={{ animation: 'spin 0.8s linear infinite' }} /> Computing…</>
                    : <><FlaskConical size={13} /> Looks good — Run Simulation</>
                  }
                </button>
                <button
                  onClick={() => { setNlPreview(null); setResult(null); }}
                  style={{ fontSize: 12, color: C.muted, background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}
                >
                  Discard plan
                </button>
                {error && <span style={{ fontSize: 12, color: C.error }}>{error}</span>}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Manual mode ── */}
      {mode === 'manual' && (
        <>
          {/* Overrides */}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: C.text }}>Property Overrides</span>
              <span style={{ fontSize: 11, color: C.subtle }}>— modify record values in simulation (no DB writes)</span>
            </div>
            {overrides.length === 0 && (
              <div style={{ fontSize: 12, color: C.subtle, fontStyle: 'italic', marginBottom: 8 }}>
                No overrides — simulation will use actual data as-is.
              </div>
            )}
            {overrides.map((o) => (
              <div key={o.id} style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 6 }}>
                <select
                  value={o.object_id}
                  onChange={(e) => updateOverride(o.id, { object_id: e.target.value })}
                  style={{ ...inputStyle, flex: 2 }}
                >
                  {sampleIds.length === 0 && <option value="">Run query first</option>}
                  {sampleIds.map((id) => <option key={id} value={id}>{id.slice(0, 16)}…</option>)}
                </select>
                <select
                  value={o.property}
                  onChange={(e) => updateOverride(o.id, { property: e.target.value })}
                  style={{ ...inputStyle, flex: 2 }}
                >
                  {fields.map((f) => <option key={f} value={f}>{f}</option>)}
                </select>
                <span style={{ fontSize: 12, color: C.subtle }}>→</span>
                <input
                  value={o.simulated_value}
                  onChange={(e) => updateOverride(o.id, { simulated_value: e.target.value })}
                  placeholder="new value"
                  style={{ ...inputStyle, flex: 2 }}
                />
                <button
                  onClick={() => removeOverride(o.id)}
                  style={{ width: 26, height: 26, borderRadius: 4, border: 'none', backgroundColor: 'transparent', cursor: 'pointer', color: C.subtle, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                >
                  <Trash2 size={12} />
                </button>
              </div>
            ))}
            <button
              onClick={addOverride}
              disabled={fields.length === 0}
              style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '5px 10px', border: `1px dashed ${C.border}`, borderRadius: 4, backgroundColor: 'transparent', cursor: fields.length === 0 ? 'not-allowed' : 'pointer', fontSize: 12, color: C.muted, opacity: fields.length === 0 ? 0.5 : 1 }}
            >
              <Plus size={12} /> Add override
            </button>
          </div>

          {/* Metrics */}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: C.text }}>Derived Metrics</span>
              <span style={{ fontSize: 11, color: C.subtle }}>— compare baseline vs simulated</span>
            </div>
            {metrics.map((m) => (
              <div key={m.id} style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 6 }}>
                <input
                  value={m.name}
                  onChange={(e) => updateMetric(m.id, { name: e.target.value })}
                  placeholder="Metric name"
                  style={{ ...inputStyle, flex: 2 }}
                />
                <select
                  value={m.function}
                  onChange={(e) => updateMetric(m.id, { function: e.target.value })}
                  style={{ ...inputStyle, flex: 1 }}
                >
                  {['COUNT', 'SUM', 'AVG', 'MIN', 'MAX'].map((f) => <option key={f} value={f}>{f}</option>)}
                </select>
                {m.function !== 'COUNT' && (
                  <select
                    value={m.field}
                    onChange={(e) => updateMetric(m.id, { field: e.target.value })}
                    style={{ ...inputStyle, flex: 2 }}
                  >
                    {fields.map((f) => <option key={f} value={f}>{f}</option>)}
                  </select>
                )}
                {m.function === 'COUNT' && (
                  <span style={{ ...inputStyle, display: 'flex', alignItems: 'center', flex: 2, color: C.subtle, fontStyle: 'italic' }}>
                    all records
                  </span>
                )}
                <button
                  onClick={() => removeMetric(m.id)}
                  style={{ width: 26, height: 26, borderRadius: 4, border: 'none', backgroundColor: 'transparent', cursor: 'pointer', color: C.subtle, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                >
                  <Trash2 size={12} />
                </button>
              </div>
            ))}
            <button
              onClick={addMetric}
              style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '5px 10px', border: `1px dashed ${C.border}`, borderRadius: 4, backgroundColor: 'transparent', cursor: 'pointer', fontSize: 12, color: C.muted }}
            >
              <Plus size={12} /> Add metric
            </button>
          </div>

          {/* Compute button */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <button
              onClick={handleCompute}
              disabled={loading || metrics.length === 0}
              style={{
                display: 'flex', alignItems: 'center', gap: 6, padding: '0 18px', height: 34,
                border: 'none', borderRadius: 6, cursor: loading || metrics.length === 0 ? 'not-allowed' : 'pointer',
                backgroundColor: loading || metrics.length === 0 ? C.border : C.accent,
                color: '#fff', fontSize: 13, fontWeight: 600, transition: 'all 120ms',
              }}
            >
              {loading
                ? <><Loader2 size={13} style={{ animation: 'spin 0.8s linear infinite' }} /> Computing…</>
                : <><FlaskConical size={13} /> Run Simulation</>
              }
            </button>
            {error && <span style={{ fontSize: 12, color: C.error }}>{error}</span>}
          </div>
        </>
      )}

      {/* Results */}
      {result && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <div style={{ padding: '8px 14px', backgroundColor: C.bg, border: `1px solid ${C.border}`, borderRadius: 6, fontSize: 12, color: C.muted }}>
              <span style={{ fontWeight: 600, color: C.text }}>{result.record_count.toLocaleString()}</span> total records
            </div>
            <div style={{ padding: '8px 14px', backgroundColor: C.bg, border: `1px solid ${C.border}`, borderRadius: 6, fontSize: 12, color: C.muted }}>
              <span style={{ fontWeight: 600, color: C.accent }}>{result.affected_records}</span> records modified in simulation
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 10 }}>
            {Object.entries(result.deltas).map(([name, delta]) => {
              const pct = delta.percent;
              const isPositive = (delta.absolute ?? 0) >= 0;
              return (
                <div key={name} style={{ padding: '14px 16px', backgroundColor: C.panel, border: `1px solid ${C.border}`, borderRadius: 8 }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: C.subtle, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>
                    {name}
                  </div>
                  <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', marginBottom: 8 }}>
                    <div>
                      <div style={{ fontSize: 9, color: C.subtle, marginBottom: 1 }}>Baseline</div>
                      <div style={{ fontSize: 16, fontWeight: 700, color: C.text }}>
                        {delta.baseline == null ? '—' : delta.baseline.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                      </div>
                    </div>
                    <div style={{ fontSize: 16, color: C.subtle, marginBottom: 2 }}>→</div>
                    <div>
                      <div style={{ fontSize: 9, color: C.subtle, marginBottom: 1 }}>Simulated</div>
                      <div style={{ fontSize: 16, fontWeight: 700, color: delta.absolute === 0 ? C.text : isPositive ? C.success : C.error }}>
                        {delta.simulated == null ? '—' : delta.simulated.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                      </div>
                    </div>
                  </div>
                  {delta.absolute !== null && (
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                      <span style={{ fontSize: 11, fontWeight: 600, color: delta.absolute === 0 ? C.muted : isPositive ? C.success : C.error }}>
                        {isPositive && delta.absolute !== 0 ? '+' : ''}{delta.absolute.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                      </span>
                      {pct !== null && (
                        <span style={{
                          fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 10,
                          backgroundColor: delta.absolute === 0 ? '#F1F5F9' : isPositive ? '#ECFDF5' : '#FEF2F2',
                          color: delta.absolute === 0 ? C.muted : isPositive ? C.success : C.error,
                        }}>
                          {isPositive && pct !== 0 ? '+' : ''}{pct.toFixed(1)}%
                        </span>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};

// ── Main ───────────────────────────────────────────────────────────────────────

type ViewTab = 'table' | 'chart' | 'analyst' | 'simulate';

const DataExplorer: React.FC = () => {
  const {
    objectTypes, selectedTypeId, fields, recordCount,
    filters, aggregate, groupBy, result, loading, loadingFields,
    fetchObjectTypes, selectObjectType, setFilters, setAggregate, setGroupBy, runQuery,
  } = useExplorerStore();
  const { setPendingTypeId } = useGraphStore();
  const { navigateTo } = useNavigationStore();

  const [activeTab, setActiveTab] = useState<ViewTab>('table');
  const [fieldSearch, setFieldSearch] = useState('');
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 100;

  // Aggregation panel state
  const [aggFunc, setAggFunc] = useState<AggregateSpec['function']>('COUNT');
  const [aggField, setAggField] = useState('*');
  const [aggGroupBy, setAggGroupBy] = useState('');
  const [showAggPanel, setShowAggPanel] = useState(false);

  useEffect(() => {
    fetchObjectTypes();
  }, []);

  const selectedType = objectTypes.find((t) => t.id === selectedTypeId);

  const handleSelectType = (id: string) => {
    setFilters([]);
    setPage(1);
    selectObjectType(id);
  };

  const handleRun = useCallback((p = 1) => {
    if (showAggPanel && aggGroupBy) {
      setAggregate({ function: aggFunc, field: aggField });
      setGroupBy(aggGroupBy);
    } else {
      setAggregate(null);
      setGroupBy(null);
    }
    setPage(p);
    runQuery(PAGE_SIZE, (p - 1) * PAGE_SIZE);
    if (showAggPanel && aggGroupBy) setActiveTab('chart');
  }, [showAggPanel, aggFunc, aggField, aggGroupBy, runQuery, setAggregate, setGroupBy]);

  const handlePageChange = (p: number) => {
    setPage(p);
    runQuery(PAGE_SIZE, (p - 1) * PAGE_SIZE);
  };

  // When switching to Chart tab, fetch ALL records so the chart uses the full dataset
  useEffect(() => {
    if (activeTab === 'chart' && selectedTypeId) {
      const total = recordCount ?? 5000;
      runQuery(Math.max(total, 5000), 0);
    }
  }, [activeTab, selectedTypeId]);

  const filteredFields = fieldSearch
    ? fields.filter((f) => f.toLowerCase().includes(fieldSearch.toLowerCase()))
    : fields;

  const selectStyle: React.CSSProperties = {
    height: 30, padding: '0 8px', border: `1px solid ${C.border}`,
    borderRadius: 4, fontSize: 12, color: C.text, backgroundColor: C.panel, outline: 'none',
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', backgroundColor: C.bg, overflow: 'hidden' }}>

      {/* Header */}
      <div style={{
        height: 52, backgroundColor: C.panel, borderBottom: `1px solid ${C.border}`,
        display: 'flex', alignItems: 'center', padding: '0 20px', gap: 12, flexShrink: 0,
      }}>
        <BarChart3 size={16} color={C.accent} />
        <h1 style={{ fontSize: 15, fontWeight: 600, color: C.text, margin: 0 }}>Data Explorer</h1>

        {/* Object type selector */}
        <select
          value={selectedTypeId || ''}
          onChange={(e) => handleSelectType(e.target.value)}
          style={{ ...selectStyle, marginLeft: 8, minWidth: 200 }}
        >
          <option value="">Select object type…</option>
          {objectTypes.map((t) => (
            <option key={t.id} value={t.id}>{t.displayName || t.name}</option>
          ))}
        </select>

        {selectedTypeId && !loadingFields && (
          <span style={{ fontSize: 11, color: C.muted, fontFamily: 'var(--font-mono)' }}>
            {recordCount.toLocaleString()} records · {fields.length} fields
          </span>
        )}
        {loadingFields && <span style={{ fontSize: 11, color: C.subtle }}>Loading schema…</span>}

        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
          {selectedTypeId && (
            <button
              onClick={() => { setPendingTypeId(selectedTypeId); navigateTo('graph'); }}
              style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '0 12px', height: 30, border: `1px solid ${C.border}`, borderRadius: 4, backgroundColor: C.panel, cursor: 'pointer', fontSize: 12, color: C.muted }}
              title="Open this object type in the Object Graph Explorer"
            >
              <Share2 size={13} /> Open in Graph
            </button>
          )}
          {result && (
            <CheckpointGate resource_type="data_export" operation="csv_export" onProceed={() => exportCsv(result.columns, result.rows)}>
              {(triggerGate, checking) => (
                <button
                  onClick={triggerGate}
                  disabled={checking}
                  style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '0 12px', height: 30, border: `1px solid ${C.border}`, borderRadius: 4, backgroundColor: C.panel, cursor: checking ? 'wait' : 'pointer', fontSize: 12, color: C.muted }}
                >
                  <Download size={13} /> Export CSV
                </button>
              )}
            </CheckpointGate>
          )}
          <button
            onClick={() => handleRun(1)}
            disabled={!selectedTypeId || loading}
            style={{
              display: 'flex', alignItems: 'center', gap: 5, padding: '0 14px', height: 30,
              border: 'none', borderRadius: 4,
              backgroundColor: (!selectedTypeId || loading) ? C.border : C.accent,
              cursor: (!selectedTypeId || loading) ? 'not-allowed' : 'pointer',
              fontSize: 12, fontWeight: 600, color: '#fff', transition: 'all 120ms',
            }}
          >
            {loading
              ? <><Loader2 size={13} style={{ animation: 'spin 0.8s linear infinite' }} /> Running…</>
              : <><Play size={13} /> Run</>
            }
          </button>
        </div>
      </div>

      {/* Body */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>

        {/* Left sidebar — field list */}
        <div style={{ width: 220, flexShrink: 0, borderRight: `1px solid ${C.border}`, backgroundColor: C.panel, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div style={{ padding: '12px 10px 8px', borderBottom: `1px solid ${C.border}`, flexShrink: 0 }}>
            <div style={{ fontSize: 10, fontWeight: 600, color: C.subtle, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>
              Fields
            </div>
            <div style={{ position: 'relative' }}>
              <Search size={12} style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', color: C.subtle }} />
              <input
                value={fieldSearch}
                onChange={(e) => setFieldSearch(e.target.value)}
                placeholder="Search fields…"
                style={{
                  width: '100%', height: 28, paddingLeft: 26, paddingRight: 8, border: `1px solid ${C.border}`,
                  borderRadius: 4, fontSize: 11, color: C.text, backgroundColor: C.bg, outline: 'none', boxSizing: 'border-box',
                }}
              />
            </div>
          </div>

          <div style={{ flex: 1, overflowY: 'auto', padding: '4px 4px' }}>
            {!selectedTypeId && (
              <div style={{ padding: '20px 10px', textAlign: 'center', color: C.subtle, fontSize: 12 }}>
                Select an object type to see available fields
              </div>
            )}
            {loadingFields && (
              <div style={{ padding: '20px 10px', textAlign: 'center', color: C.subtle, fontSize: 12 }}>
                Loading fields…
              </div>
            )}
            {!loadingFields && filteredFields.map((f) => (
              <FieldPill
                key={f}
                field={f}
                onClick={() => {
                  const exists = filters.some((fr) => fr.field === f);
                  if (!exists) {
                    setFilters([...filters, { id: crypto.randomUUID(), field: f, op: 'eq', value: '' }]);
                  }
                }}
              />
            ))}
          </div>

          {/* Object type list */}
          {objectTypes.length > 0 && (
            <div style={{ borderTop: `1px solid ${C.border}`, padding: '8px 4px', flexShrink: 0 }}>
              <div style={{ fontSize: 10, fontWeight: 600, color: C.subtle, textTransform: 'uppercase', letterSpacing: '0.06em', padding: '4px 10px 6px' }}>
                Object Types
              </div>
              {objectTypes.map((t) => (
                <button
                  key={t.id}
                  onClick={() => handleSelectType(t.id)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 6, width: '100%',
                    padding: '6px 10px', border: 'none', borderRadius: 4, textAlign: 'left',
                    backgroundColor: selectedTypeId === t.id ? C.accentLight : 'transparent',
                    color: selectedTypeId === t.id ? C.accent : C.muted,
                    cursor: 'pointer', fontSize: 12, fontWeight: selectedTypeId === t.id ? 600 : 400,
                  }}
                >
                  <Database size={11} />
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {t.displayName || t.name}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Main area */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

          {/* Filter bar */}
          <div style={{ padding: '12px 16px', borderBottom: `1px solid ${C.border}`, backgroundColor: C.panel, flexShrink: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: filters.length > 0 ? 10 : 0 }}>
              <Filter size={13} color={C.muted} />
              <span style={{ fontSize: 12, fontWeight: 600, color: C.muted }}>Filters</span>
              {filters.length > 0 && (
                <span style={{
                  fontSize: 10, padding: '1px 6px', borderRadius: 10,
                  backgroundColor: C.accentLight, color: C.accent, fontWeight: 600,
                }}>
                  {filters.length}
                </span>
              )}
              <button
                onClick={() => setShowAggPanel((v) => !v)}
                style={{
                  marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 4,
                  padding: '3px 10px', border: `1px solid ${showAggPanel ? C.accent : C.border}`,
                  borderRadius: 4, backgroundColor: showAggPanel ? C.accentLight : C.panel,
                  cursor: 'pointer', fontSize: 11, color: showAggPanel ? C.accent : C.muted,
                }}
              >
                <BarChart2 size={12} />
                Aggregate
                <ChevronDown size={11} style={{ transform: showAggPanel ? 'rotate(180deg)' : 'none', transition: 'transform 150ms' }} />
              </button>
            </div>

            <FilterBuilder
              filters={filters}
              fields={fields}
              onChange={setFilters}
            />

            {showAggPanel && (
              <div style={{ marginTop: 10, padding: '10px 12px', backgroundColor: C.bg, borderRadius: 6, border: `1px solid ${C.border}`, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                <span style={{ fontSize: 11, color: C.muted, fontWeight: 600 }}>Aggregate</span>
                <select value={aggFunc} onChange={(e) => setAggFunc(e.target.value as AggregateSpec['function'])} style={{ ...selectStyle, height: 28 }}>
                  {AGG_FUNCS.map((f) => <option key={f} value={f}>{f}</option>)}
                </select>
                {aggFunc !== 'COUNT' && (
                  <>
                    <span style={{ fontSize: 11, color: C.muted }}>of</span>
                    <select value={aggField} onChange={(e) => setAggField(e.target.value)} style={{ ...selectStyle, height: 28 }}>
                      {fields.map((f) => <option key={f} value={f}>{f}</option>)}
                    </select>
                  </>
                )}
                <span style={{ fontSize: 11, color: C.muted }}>grouped by</span>
                <select value={aggGroupBy} onChange={(e) => setAggGroupBy(e.target.value)} style={{ ...selectStyle, height: 28 }}>
                  <option value="">Select field…</option>
                  {fields.map((f) => <option key={f} value={f}>{f}</option>)}
                </select>
              </div>
            )}
          </div>

          {/* Tab bar */}
          <div style={{ display: 'flex', borderBottom: `1px solid ${C.border}`, backgroundColor: C.panel, flexShrink: 0 }}>
            <TabBtn active={activeTab === 'table'} onClick={() => setActiveTab('table')}>
              <Table2 size={13} /> Table
            </TabBtn>
            <TabBtn active={activeTab === 'chart'} onClick={() => setActiveTab('chart')}>
              <BarChart2 size={13} /> Chart
            </TabBtn>
            <TabBtn active={activeTab === 'analyst'} onClick={() => setActiveTab('analyst')}>
              <Bot size={13} /> AIP Analyst
            </TabBtn>
            <TabBtn active={activeTab === 'simulate'} onClick={() => setActiveTab('simulate')}>
              <FlaskConical size={13} /> Simulate
            </TabBtn>
          </div>

          {/* Tab content */}
          <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
            {activeTab === 'table' && (
              <>
                {!result ? (
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 12, color: C.subtle }}>
                    <BarChart3 size={32} color={C.border} />
                    <div style={{ fontSize: 13, fontWeight: 500 }}>Select an object type and click Run</div>
                    <div style={{ fontSize: 12 }}>Use the filter builder to narrow results</div>
                  </div>
                ) : (
                  <ResultsTable
                    columns={result.columns}
                    rows={result.rows}
                    total={result.total}
                    queryMs={result.query_ms}
                    page={page}
                    pageSize={PAGE_SIZE}
                    onPageChange={handlePageChange}
                  />
                )}
              </>
            )}

            {activeTab === 'chart' && (
              <div style={{ flex: 1, overflowY: 'auto' }}>
                <ChartView
                  rows={result?.rows || []}
                  aggregate={aggregate}
                  groupBy={groupBy}
                  fields={fields}
                />
              </div>
            )}

            {activeTab === 'analyst' && (
              <div style={{ flex: 1, overflowY: 'auto' }}>
                <AIPAnalyst
                  typeId={selectedTypeId}
                  typeName={selectedType?.displayName || selectedType?.name || 'data'}
                />
              </div>
            )}

            {activeTab === 'simulate' && (
              <div style={{ flex: 1, overflowY: 'auto' }}>
                <ScenarioPanel
                  typeId={selectedTypeId}
                  typeName={selectedType?.displayName || selectedType?.name || ''}
                  fields={fields}
                  sampleRows={result?.rows?.slice(0, 50) || []}
                />
              </div>
            )}
          </div>
        </div>
      </div>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
};

export default DataExplorer;
