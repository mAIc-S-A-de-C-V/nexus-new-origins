import React, { useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { NexusApp, AppComponent, AppFilter } from '../../types/app';
import { getTenantId } from '../../store/authStore';

const ONTOLOGY_API = import.meta.env.VITE_ONTOLOGY_SERVICE_URL || 'http://localhost:8004';
const INFERENCE_API = import.meta.env.VITE_INFERENCE_SERVICE_URL || 'http://localhost:8003';

// ── Data fetching ──────────────────────────────────────────────────────────

function useRecords(objectTypeId?: string) {
  const [records, setRecords] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!objectTypeId) return;
    setLoading(true);
    fetch(`${ONTOLOGY_API}/object-types/${objectTypeId}/records`, {
      headers: { 'x-tenant-id': getTenantId() },
    })
      .then((r) => r.json())
      .then((d) => setRecords(d.records || []))
      .catch(() => setRecords([]))
      .finally(() => setLoading(false));
  }, [objectTypeId]);

  return { records, loading };
}

// ── Aggregation helpers ────────────────────────────────────────────────────

function aggregate(
  records: Record<string, unknown>[],
  field: string | undefined,
  method: string | undefined
): string {
  if (!records.length) return '—';
  if (method === 'count' || !field) return records.length.toLocaleString();

  const nums = records
    .map((r) => parseFloat(String(r[field] ?? '')))
    .filter((n) => !isNaN(n));

  if (!nums.length) return '—';
  if (method === 'sum') return nums.reduce((a, b) => a + b, 0).toLocaleString();
  if (method === 'avg') return (nums.reduce((a, b) => a + b, 0) / nums.length).toFixed(1);
  if (method === 'max') return Math.max(...nums).toLocaleString();
  if (method === 'min') return Math.min(...nums).toLocaleString();
  return records.length.toLocaleString();
}

function aggLabel(method?: string, field?: string) {
  if (method === 'count' || !field) return 'Total Records';
  return `${method?.toUpperCase()} of ${field}`;
}

// ── Filter engine ─────────────────────────────────────────────────────────

/**
 * Resolve a field value from a record, falling back to underscore-insensitive
 * matching so that ontology names like "hs_last_modified_date" match compact
 * HubSpot field names like "hs_lastmodifieddate".
 */
function resolveRaw(rec: Record<string, unknown>, field: string): unknown {
  if (rec[field] !== undefined) return rec[field];
  const normalized = field.replace(/_/g, '').toLowerCase();
  for (const k of Object.keys(rec)) {
    if (k.replace(/_/g, '').toLowerCase() === normalized) return rec[k];
  }
  return undefined;
}

function coerce(raw: unknown): { str: string; num: number; date: Date | null } {
  const str = String(raw ?? '');
  const num = parseFloat(str);
  // Parse ISO date strings AND Unix timestamps (ms) like 1742864400000
  let date: Date | null = null;
  if (/\d{4}-\d{2}-\d{2}/.test(str)) {
    date = new Date(str);
  } else if (/^\d{10,13}$/.test(str.trim())) {
    // Unix timestamp — 10 digits = seconds, 13 digits = milliseconds
    const ms = str.length <= 10 ? parseFloat(str) * 1000 : parseFloat(str);
    date = new Date(ms);
  } else if (typeof raw === 'number' && raw > 1e9) {
    date = new Date(raw < 1e12 ? raw * 1000 : raw);
  }
  return { str, num, date };
}

function applyFilters(
  records: Record<string, unknown>[],
  filters?: AppFilter[],
): Record<string, unknown>[] {
  if (!filters || filters.length === 0) return records;
  return records.filter((rec) =>
    filters.every((f) => {
      if (!f.field || !f.operator) return true;
      const raw = resolveRaw(rec, f.field);
      const { str, num, date } = coerce(raw);
      const fv = f.value ?? '';
      const fvNum = parseFloat(fv);
      const fvDate = /\d{4}-\d{2}-\d{2}/.test(fv) ? new Date(fv) : null;

      switch (f.operator) {
        case 'eq':          return str === fv;
        case 'neq':         return str !== fv;
        case 'contains':    return str.toLowerCase().includes(fv.toLowerCase());
        case 'not_contains':return !str.toLowerCase().includes(fv.toLowerCase());
        // For numeric/date comparisons, prefer date when both sides are dates
        case 'gt':          return date && fvDate ? date > fvDate : (!isNaN(num) && !isNaN(fvNum) ? num > fvNum : str > fv);
        case 'gte':         return date && fvDate ? date >= fvDate : (!isNaN(num) && !isNaN(fvNum) ? num >= fvNum : str >= fv);
        case 'lt':          return date && fvDate ? date < fvDate : (!isNaN(num) && !isNaN(fvNum) ? num < fvNum : str < fv);
        case 'lte':         return date && fvDate ? date <= fvDate : (!isNaN(num) && !isNaN(fvNum) ? num <= fvNum : str <= fv);
        case 'after':       return date && fvDate ? date > fvDate : str > fv;
        case 'before':      return date && fvDate ? date < fvDate : str < fv;
        case 'is_empty':    return str === '' || raw === null || raw === undefined;
        case 'is_not_empty':return str !== '' && raw !== null && raw !== undefined;
        default:            return true;
      }
    }),
  );
}

// ── Individual Components ──────────────────────────────────────────────────

const MetricCard: React.FC<{ comp: AppComponent; records: Record<string, unknown>[] }> = ({
  comp,
  records,
}) => {
  const value = aggregate(records, comp.field, comp.aggregation || 'count');
  return (
    <div style={{
      backgroundColor: '#fff',
      border: '1px solid #E2E8F0',
      borderRadius: 8,
      padding: '20px 24px',
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'space-between',
    }}>
      <div style={{ fontSize: 13, color: '#64748B', fontWeight: 500 }}>{comp.title}</div>
      <div>
        <div style={{ fontSize: 36, fontWeight: 700, color: '#0D1117', lineHeight: 1.1 }}>
          {value}
        </div>
        <div style={{ fontSize: 11, color: '#94A3B8', marginTop: 4 }}>
          {aggLabel(comp.aggregation, comp.field)}
        </div>
      </div>
    </div>
  );
};

const KpiBanner: React.FC<{ comp: AppComponent; records: Record<string, unknown>[] }> = ({
  comp,
  records,
}) => {
  const kpis = [
    { label: 'Total Records', value: records.length.toLocaleString() },
    { label: comp.field ? `Avg ${comp.field}` : 'Fields', value: comp.field
      ? aggregate(records, comp.field, 'avg')
      : (records[0] ? Object.keys(records[0]).length : 0).toString() },
    { label: 'Last Updated', value: 'Live' },
  ];

  return (
    <div style={{
      backgroundColor: '#fff',
      border: '1px solid #E2E8F0',
      borderRadius: 8,
      padding: '16px 24px',
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
      gap: 8,
    }}>
      <div style={{ fontSize: 13, fontWeight: 600, color: '#0D1117' }}>{comp.title}</div>
      <div style={{ display: 'flex', gap: 32, flexWrap: 'wrap' }}>
        {kpis.map((k) => (
          <div key={k.label}>
            <div style={{ fontSize: 22, fontWeight: 700, color: '#2563EB' }}>{k.value}</div>
            <div style={{ fontSize: 11, color: '#94A3B8' }}>{k.label}</div>
          </div>
        ))}
      </div>
    </div>
  );
};

const DataTable: React.FC<{ comp: AppComponent; records: Record<string, unknown>[] }> = ({
  comp,
  records,
}) => {
  const maxRows = comp.maxRows || 10;
  const shown = records.slice(0, maxRows);
  const allCols = records.length > 0 ? Object.keys(records[0]) : [];
  // Keep configured columns even if names differ from record keys (underscore-insensitive)
  const cols = comp.columns?.length
    ? comp.columns.filter((c) => records.some((r) => resolveRaw(r, c) !== undefined))
    : allCols.filter((c) => !c.endsWith('[]'));

  return (
    <div style={{
      backgroundColor: '#fff',
      border: '1px solid #E2E8F0',
      borderRadius: 8,
      overflow: 'hidden',
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
    }}>
      <div style={{
        padding: '12px 16px',
        borderBottom: '1px solid #E2E8F0',
        fontSize: 13,
        fontWeight: 600,
        color: '#0D1117',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
      }}>
        <span>{comp.title}</span>
        <span style={{ fontSize: 11, color: '#94A3B8', fontWeight: 400 }}>
          {records.length.toLocaleString()} records
        </span>
      </div>
      <div style={{ flex: 1, overflowY: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr style={{ backgroundColor: '#F8FAFC', position: 'sticky', top: 0 }}>
              {cols.map((c) => (
                <th key={c} style={{
                  textAlign: 'left',
                  padding: '8px 12px',
                  color: '#64748B',
                  fontWeight: 500,
                  borderBottom: '1px solid #E2E8F0',
                  whiteSpace: 'nowrap',
                }}>
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map((row, i) => (
              <tr key={i} style={{ borderBottom: '1px solid #F1F5F9' }}>
                {cols.map((c) => {
                  const val = resolveRaw(row, c);
                  return (
                    <td key={c} style={{
                      padding: '7px 12px',
                      color: '#374151',
                      maxWidth: 200,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}>
                      {Array.isArray(val)
                        ? `[${(val as unknown[]).length} items]`
                        : String(val ?? '')}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
        {records.length === 0 && (
          <div style={{ textAlign: 'center', padding: '32px', color: '#94A3B8', fontSize: 12 }}>
            No records — run a sync first
          </div>
        )}
      </div>
    </div>
  );
};

const BarChart: React.FC<{ comp: AppComponent; records: Record<string, unknown>[] }> = ({
  comp,
  records,
}) => {
  // Auto-detect the best label field: prefer the configured one, but fall back to
  // the first field that produces more than 1 distinct non-numeric value
  const candidateLabelField = comp.labelField || comp.columns?.[0] || '';
  const allFields = records.length > 0 ? Object.keys(records[0]).filter((k) => !k.endsWith('[]')) : [];

  const labelField = (() => {
    if (candidateLabelField) {
      // Check if this field produces meaningful labels (not all "Unknown")
      const nonEmpty = records.filter((r) => r[candidateLabelField] != null && r[candidateLabelField] !== '').length;
      if (nonEmpty > 0) return candidateLabelField;
    }
    // Fall back to first field with >1 distinct string value
    for (const f of allFields) {
      const vals = new Set(records.map((r) => String(r[f] ?? '')).filter(Boolean));
      if (vals.size > 1 && vals.size <= records.length * 0.8) return f;
    }
    return allFields[0] || 'name';
  })();

  // Determine if valueField should be used for summing or if we should just count.
  // We use count mode if:
  //  - no valueField configured
  //  - valueField === labelField (mistake: user set the same field for both)
  //  - valueField values are mostly non-numeric or look like ID numbers (avg > 100k)
  const rawValueField = comp.valueField || comp.field || '';
  const useCountMode = (() => {
    if (!rawValueField || rawValueField === labelField) return true;
    if (!records.length) return true;
    const nums = records
      .map((r) => parseFloat(String(r[rawValueField] ?? '')))
      .filter((n) => !isNaN(n));
    if (nums.length < records.length * 0.5) return true; // mostly non-numeric → count
    const avg = nums.reduce((a, b) => a + b, 0) / nums.length;
    if (avg > 100_000) return true; // looks like ID numbers → count
    return false;
  })();
  const valueField = useCountMode ? '' : rawValueField;

  // Build bar data: group by labelField
  const grouped: Record<string, number> = {};
  for (const r of records) {
    const rawLabel = r[labelField];
    const label = (rawLabel != null && rawLabel !== '' ? String(rawLabel) : '(empty)').slice(0, 40);
    if (valueField) {
      const n = parseFloat(String(r[valueField] ?? 0));
      grouped[label] = (grouped[label] || 0) + (isNaN(n) ? 0 : n);
    } else {
      grouped[label] = (grouped[label] || 0) + 1;
    }
  }

  const entries = Object.entries(grouped)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15);

  const maxVal = Math.max(...entries.map(([, v]) => v), 1);
  const barHeight = 24;
  const gap = 6;
  const svgH = entries.length * (barHeight + gap);
  const labelW = 140;

  return (
    <div style={{
      backgroundColor: '#fff',
      border: '1px solid #E2E8F0',
      borderRadius: 8,
      overflow: 'hidden',
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
    }}>
      <div style={{
        padding: '12px 16px',
        borderBottom: '1px solid #E2E8F0',
        fontSize: 13,
        fontWeight: 600,
        color: '#0D1117',
      }}>
        {comp.title}
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: '12px 16px' }}>
        {entries.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 32, color: '#94A3B8', fontSize: 12 }}>
            No data — run a sync first
          </div>
        ) : (
          <svg width="100%" height={svgH} viewBox={`0 0 400 ${svgH}`}>
            {entries.map(([label, val], i) => {
              const y = i * (barHeight + gap);
              const barW = ((val / maxVal) * (400 - labelW - 60));
              return (
                <g key={label}>
                  <text
                    x={labelW - 6}
                    y={y + barHeight / 2 + 4}
                    textAnchor="end"
                    fontSize={10}
                    fill="#64748B"
                  >
                    {label.length > 18 ? label.slice(0, 18) + '…' : label}
                  </text>
                  <rect
                    x={labelW}
                    y={y}
                    width={Math.max(barW, 2)}
                    height={barHeight}
                    rx={3}
                    fill="#2563EB"
                    opacity={0.8}
                  />
                  <text
                    x={labelW + barW + 6}
                    y={y + barHeight / 2 + 4}
                    fontSize={10}
                    fill="#374151"
                  >
                    {val.toLocaleString()}
                  </text>
                </g>
              );
            })}
          </svg>
        )}
      </div>
    </div>
  );
};

const LineChart: React.FC<{ comp: AppComponent; records: Record<string, unknown>[] }> = ({
  comp,
  records,
}) => {
  const allFields = records.length > 0 ? Object.keys(records[0]) : [];

  // Auto-resolve xField: if configured field doesn't exist, find the first date-like field
  const resolveField = (configured: string, fallbackTest: (f: string) => boolean) => {
    if (configured && allFields.includes(configured)) return configured;
    // try fuzzy: strip underscores and compare lowercased
    const norm = (s: string) => s.toLowerCase().replace(/_/g, '');
    const fuzzy = allFields.find((f) => norm(f) === norm(configured));
    if (fuzzy) return fuzzy;
    return allFields.find(fallbackTest) || '';
  };

  const xField = resolveField(
    comp.xField || comp.labelField || '',
    (f) => /date|time|_at|modified|created/i.test(f),
  );

  const rawYField = comp.valueField || comp.field || '';
  // Use count mode if no yField or if it's the same as xField or looks like IDs
  const useCountMode = (() => {
    if (!rawYField || rawYField === xField) return true;
    const resolved = resolveField(rawYField, () => false);
    if (!resolved) return true;
    const nums = records.map((r) => parseFloat(String(r[resolved] ?? ''))).filter((n) => !isNaN(n));
    if (nums.length < records.length * 0.3) return true;
    if (nums.reduce((a, b) => a + b, 0) / Math.max(nums.length, 1) > 100_000) return true;
    return false;
  })();
  const yField = useCountMode ? '' : resolveField(rawYField, () => false);

  // Build points: if count mode, group by week (first 7 chars of date = YYYY-Www or YYYY-MM-D)
  const points: { x: string; y: number }[] = (() => {
    if (!xField) return [];
    if (useCountMode) {
      // Group by date prefix (YYYY-MM-DD → use YYYY-WNN week bucket)
      const weekly: Record<string, number> = {};
      for (const r of records) {
        const rawVal = resolveRaw(r, xField);
        const { date: parsedDate } = coerce(rawVal);
        const raw = parsedDate ? parsedDate.toISOString().slice(0, 10) : String(rawVal ?? '').slice(0, 10);
        if (!raw || raw === 'undefined') continue;
        // bucket to week start (Mon)
        const d = new Date(raw);
        if (isNaN(d.getTime())) continue;
        const day = d.getDay(); // 0=Sun
        const diffToMon = (day === 0 ? -6 : 1 - day);
        const mon = new Date(d);
        mon.setDate(d.getDate() + diffToMon);
        const key = mon.toISOString().slice(0, 10);
        weekly[key] = (weekly[key] || 0) + 1;
      }
      return Object.entries(weekly)
        .sort(([a], [b]) => a.localeCompare(b))
        .slice(-20)
        .map(([x, y]) => ({ x, y }));
    }
    return records
      .filter((r) => r[xField] !== undefined && r[yField] !== undefined)
      .sort((a, b) => String(a[xField]).localeCompare(String(b[xField])))
      .slice(0, 20)
      .map((r) => ({
        x: String(r[xField] ?? '').slice(0, 10),
        y: parseFloat(String(r[yField] ?? 0)) || 0,
      }));
  })();

  const maxY = Math.max(...points.map((p) => p.y), 1);
  const W = 400, H = 140, pad = { top: 10, right: 10, bottom: 24, left: 40 };
  const innerW = W - pad.left - pad.right;
  const innerH = H - pad.top - pad.bottom;

  const toX = (i: number) => pad.left + (i / Math.max(points.length - 1, 1)) * innerW;
  const toY = (v: number) => pad.top + innerH - (v / maxY) * innerH;

  const pathD = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${toX(i)} ${toY(p.y)}`).join(' ');

  return (
    <div style={{
      backgroundColor: '#fff', border: '1px solid #E2E8F0', borderRadius: 8,
      overflow: 'hidden', height: '100%', display: 'flex', flexDirection: 'column',
    }}>
      <div style={{ padding: '12px 16px', borderBottom: '1px solid #E2E8F0', fontSize: 13, fontWeight: 600, color: '#0D1117' }}>
        {comp.title}
      </div>
      <div style={{ flex: 1, padding: '8px 16px', overflowX: 'auto' }}>
        {points.length < 2 ? (
          <div style={{ textAlign: 'center', padding: 32, color: '#94A3B8', fontSize: 12 }}>
            {xField ? `No date data found in "${xField}"` : 'Configure an x-axis date field'}
          </div>
        ) : (
          <svg width="100%" viewBox={`0 0 ${W} ${H}`}>
            {/* Y gridlines */}
            {[0, 0.25, 0.5, 0.75, 1].map((t) => {
              const y = toY(maxY * t);
              return (
                <g key={t}>
                  <line x1={pad.left} y1={y} x2={W - pad.right} y2={y} stroke="#F1F5F9" strokeWidth={1} />
                  <text x={pad.left - 4} y={y + 4} textAnchor="end" fontSize={8} fill="#94A3B8">
                    {(maxY * t).toFixed(0)}
                  </text>
                </g>
              );
            })}
            {/* Line */}
            <path d={pathD} fill="none" stroke="#2563EB" strokeWidth={2} />
            {/* Dots */}
            {points.map((p, i) => (
              <circle key={i} cx={toX(i)} cy={toY(p.y)} r={3} fill="#2563EB" />
            ))}
            {/* X labels */}
            {points.filter((_, i) => i % Math.max(1, Math.floor(points.length / 5)) === 0).map((p, i) => {
              const idx = i * Math.max(1, Math.floor(points.length / 5));
              return (
                <text key={i} x={toX(idx)} y={H - 4} textAnchor="middle" fontSize={8} fill="#94A3B8">
                  {p.x}
                </text>
              );
            })}
          </svg>
        )}
      </div>
    </div>
  );
};

const FilterBar: React.FC<{ comp: AppComponent; records: Record<string, unknown>[] }> = ({
  comp,
  records,
}) => {
  const [search, setSearch] = React.useState('');
  const filterField = comp.filterField || comp.columns?.[0] || '';
  const uniqueValues = Array.from(
    new Set(records.map((r) => String(r[filterField] ?? '')).filter(Boolean))
  ).slice(0, 20);

  return (
    <div style={{
      backgroundColor: '#fff', border: '1px solid #E2E8F0', borderRadius: 8,
      padding: '12px 16px', height: '100%',
    }}>
      <div style={{ fontSize: 13, fontWeight: 600, color: '#0D1117', marginBottom: 10 }}>{comp.title}</div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <input
          placeholder={`Filter by ${filterField || 'value'}…`}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{
            height: 28, padding: '0 10px', border: '1px solid #E2E8F0', borderRadius: 4,
            fontSize: 12, color: '#0D1117', outline: 'none', minWidth: 160,
          }}
        />
        {uniqueValues
          .filter((v) => !search || v.toLowerCase().includes(search.toLowerCase()))
          .slice(0, 12)
          .map((v) => (
            <span key={v} style={{
              padding: '3px 8px', backgroundColor: '#EFF6FF', color: '#2563EB',
              border: '1px solid #BFDBFE', borderRadius: 3, fontSize: 11, cursor: 'pointer',
            }}>
              {v}
            </span>
          ))}
      </div>
    </div>
  );
};

const TextBlock: React.FC<{ comp: AppComponent }> = ({ comp }) => (
  <div style={{
    backgroundColor: '#F8FAFC',
    border: '1px solid #E2E8F0',
    borderRadius: 8,
    padding: '16px 20px',
    height: '100%',
  }}>
    <div style={{ fontSize: 15, fontWeight: 600, color: '#0D1117', marginBottom: 8 }}>
      {comp.title}
    </div>
    {comp.content && (
      <div style={{ fontSize: 13, color: '#475569', lineHeight: 1.6 }}>{comp.content}</div>
    )}
  </div>
);

// ── Custom Code Widget ────────────────────────────────────────────────────
// Claude-generated code executed safely with new Function.
// The code receives: React, records, fields, title — and must return React elements.

const CustomCodeWidget: React.FC<{ comp: AppComponent; records: Record<string, unknown>[] }> = ({ comp, records }) => {
  const fields = records.length > 0 ? Object.keys(records[0]) : [];
  if (!comp.code) {
    return (
      <div style={{ padding: 16, color: '#94A3B8', fontSize: 12 }}>No code provided.</div>
    );
  }
  try {
    // eslint-disable-next-line no-new-func
    const fn = new Function('React', 'records', 'fields', 'title', comp.code);
    const result = fn(React, records, fields, comp.title);
    return result ?? null;
  } catch (err) {
    return (
      <div style={{ padding: 12, backgroundColor: '#FFF1F2', borderRadius: 6, fontSize: 11, fontFamily: 'var(--font-mono)', color: '#BE123C' }}>
        <strong>Code error:</strong> {String(err)}
      </div>
    );
  }
};

// ── Inline widget (used inside chat messages) ──────────────────────────────

const InlineWidget: React.FC<{ comp: AppComponent; records: Record<string, unknown>[] }> = ({ comp, records }) => {
  const filtered = applyFilters(records, comp.filters);
  switch (comp.type) {
    case 'metric-card': return <MetricCard comp={comp} records={filtered} />;
    case 'kpi-banner': return <KpiBanner comp={comp} records={filtered} />;
    case 'data-table': return <DataTable comp={comp} records={filtered} />;
    case 'bar-chart': return <BarChart comp={comp} records={filtered} />;
    case 'line-chart': return <LineChart comp={comp} records={filtered} />;
    case 'custom-code': return <CustomCodeWidget comp={comp} records={filtered} />;
    default: return null;
  }
};

// ── Markdown message renderer ───────────────────────────────────────────────

const mdStyles: Record<string, React.CSSProperties> = {
  table: { borderCollapse: 'collapse', width: '100%', fontSize: 12, margin: '8px 0' },
  th: { border: '1px solid #CBD5E1', padding: '5px 10px', backgroundColor: '#F1F5F9', textAlign: 'left', fontWeight: 600 },
  td: { border: '1px solid #E2E8F0', padding: '5px 10px' },
  h2: { fontSize: 13, fontWeight: 700, margin: '8px 0 3px', color: '#0D1117' },
  h3: { fontSize: 12, fontWeight: 700, margin: '6px 0 2px', color: '#0D1117' },
  p: { margin: '3px 0', lineHeight: 1.6 },
  ul: { paddingLeft: 18, margin: '4px 0' },
  ol: { paddingLeft: 18, margin: '4px 0' },
  li: { marginBottom: 2 },
  code: { backgroundColor: '#F1F5F9', padding: '1px 4px', borderRadius: 3, fontSize: 11, fontFamily: 'monospace' },
  pre: { backgroundColor: '#F1F5F9', padding: '8px 12px', borderRadius: 6, fontSize: 11, overflowX: 'auto', margin: '6px 0' },
};

const MarkdownMessage: React.FC<{
  text: string;
  records: Record<string, unknown>[];
  objectTypeId?: string;
}> = ({ text, records, objectTypeId }) => {
  let widgetIdx = 0;
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        // Block code — detect ```widget for inline widget rendering
        pre({ children }) {
          const codeEl = React.Children.toArray(children).find(
            (c) => React.isValidElement(c) && (c as React.ReactElement).type === 'code',
          ) as React.ReactElement | undefined;
          if (codeEl) {
            const cls: string = (codeEl.props as { className?: string }).className || '';
            if (cls.includes('language-widget')) {
              const src = String((codeEl.props as { children?: unknown }).children || '').trim();
              try {
                const raw = JSON.parse(src) as Partial<AppComponent>;
                const spec: AppComponent = {
                  ...raw,
                  id: `chat-inline-${++widgetIdx}`,
                  objectTypeId: raw.objectTypeId || objectTypeId,
                } as AppComponent;
                return (
                  <div style={{ margin: '10px 0', minHeight: 160 }}>
                    <InlineWidget comp={spec} records={records} />
                  </div>
                );
              } catch { /* fall through */ }
            }
          }
          return <pre style={mdStyles.pre}>{children}</pre>;
        },
        code({ className, children }) {
          // Inline code (no pre wrapper)
          if (!className) return <code style={mdStyles.code}>{children}</code>;
          return <code className={className}>{children}</code>;
        },
        table({ children }) {
          return (
            <div style={{ overflowX: 'auto' }}>
              <table style={mdStyles.table}>{children}</table>
            </div>
          );
        },
        th({ children }) { return <th style={mdStyles.th}>{children}</th>; },
        td({ children }) { return <td style={mdStyles.td}>{children}</td>; },
        h1({ children }) { return <strong style={{ ...mdStyles.h2, fontSize: 14 }}>{children}</strong>; },
        h2({ children }) { return <strong style={mdStyles.h2}>{children}</strong>; },
        h3({ children }) { return <strong style={mdStyles.h3}>{children}</strong>; },
        p({ children }) { return <p style={mdStyles.p}>{children}</p>; },
        ul({ children }) { return <ul style={mdStyles.ul}>{children}</ul>; },
        ol({ children }) { return <ol style={mdStyles.ol}>{children}</ol>; },
        li({ children }) { return <li style={mdStyles.li}>{children}</li>; },
      }}
    >
      {text}
    </ReactMarkdown>
  );
};

// ── Chat Widget ────────────────────────────────────────────────────────────

interface ChatMessage { role: 'user' | 'assistant'; text: string }

const ChatWidget: React.FC<{ comp: AppComponent; records: Record<string, unknown>[] }> = ({
  comp,
  records,
}) => {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [thinking, setThinking] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const fields = records.length > 0 ? Object.keys(records[0]) : [];

  const send = async () => {
    const q = input.trim();
    if (!q || thinking) return;
    setInput('');
    setMessages((m) => [...m, { role: 'user', text: q }]);
    setThinking(true);
    try {
      const res = await fetch(`${INFERENCE_API}/infer/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question: q,
          object_type_id: comp.objectTypeId || '',
          object_type_name: comp.title || 'Data',
          fields,
          records: records.slice(0, 100),
        }),
      });
      const data = await res.json();
      setMessages((m) => [...m, { role: 'assistant', text: data.answer || data.detail || 'No response.' }]);
    } catch {
      setMessages((m) => [...m, { role: 'assistant', text: 'Could not reach the AI service. Make sure ANTHROPIC_API_KEY is set.' }]);
    } finally {
      setThinking(false);
    }
  };

  return (
    <div style={{
      backgroundColor: '#fff', border: '1px solid #E2E8F0', borderRadius: 8,
      height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden',
    }}>
      {/* Header */}
      <div style={{
        padding: '10px 16px', borderBottom: '1px solid #E2E8F0',
        display: 'flex', alignItems: 'center', gap: 8,
      }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: '#0D1117', flex: 1 }}>{comp.title}</span>
        <span style={{ fontSize: 11, color: '#94A3B8' }}>{records.length} records loaded</span>
      </div>

      {/* Messages */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        {messages.length === 0 && (
          <div style={{ color: '#94A3B8', fontSize: 12, textAlign: 'center', marginTop: 24 }}>
            Ask anything about this data — e.g. "how many deals were modified this week?" or "which stage has the most deals?"
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} style={{
            display: 'flex', flexDirection: m.role === 'user' ? 'row-reverse' : 'row', gap: 8, alignItems: 'flex-start',
          }}>
            <div style={{
              maxWidth: m.role === 'assistant' ? '95%' : '80%',
              padding: '8px 12px',
              borderRadius: m.role === 'user' ? '12px 12px 2px 12px' : '12px 12px 12px 2px',
              backgroundColor: m.role === 'user' ? '#2563EB' : '#F8FAFC',
              color: m.role === 'user' ? '#fff' : '#0D1117',
              border: m.role === 'assistant' ? '1px solid #E2E8F0' : 'none',
              fontSize: 12, lineHeight: 1.6,
            }}>
              {m.role === 'user'
                ? m.text
                : <MarkdownMessage text={m.text} records={records} objectTypeId={comp.objectTypeId} />
              }
            </div>
          </div>
        ))}
        {thinking && (
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
            <div style={{
              padding: '8px 14px', borderRadius: '12px 12px 12px 2px',
              backgroundColor: '#F8FAFC', border: '1px solid #E2E8F0',
              fontSize: 12, color: '#94A3B8',
            }}>
              Thinking…
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div style={{
        padding: '10px 12px', borderTop: '1px solid #E2E8F0',
        display: 'flex', gap: 8, alignItems: 'center',
      }}>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && send()}
          placeholder="Ask about this data…"
          style={{
            flex: 1, height: 32, padding: '0 10px', border: '1px solid #E2E8F0',
            borderRadius: 6, fontSize: 12, outline: 'none', color: '#0D1117',
          }}
        />
        <button
          onClick={send}
          disabled={!input.trim() || thinking}
          style={{
            height: 32, padding: '0 14px', borderRadius: 6,
            backgroundColor: !input.trim() || thinking ? '#E2E8F0' : '#2563EB',
            color: !input.trim() || thinking ? '#94A3B8' : '#fff',
            border: 'none', cursor: !input.trim() || thinking ? 'default' : 'pointer',
            fontSize: 12, fontWeight: 600,
          }}
        >
          Send
        </button>
      </div>
    </div>
  );
};

// ── Map Widget ─────────────────────────────────────────────────────────────

const MapWidget: React.FC<{ comp: AppComponent; records: Record<string, unknown>[] }> = ({ comp, records }) => {
  const latField = comp.latField || 'lat';
  const lngField = comp.lngField || 'lng';
  const labelField = comp.labelField || 'name';

  const pins = records
    .map((r) => ({
      lat: parseFloat(String(r[latField] ?? '')),
      lng: parseFloat(String(r[lngField] ?? '')),
      label: String(r[labelField] ?? ''),
    }))
    .filter((p) => !isNaN(p.lat) && !isNaN(p.lng));

  if (!pins.length) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', flexDirection: 'column', gap: 8, color: '#94A3B8' }}>
        <span style={{ fontSize: 24 }}>🗺</span>
        <span style={{ fontSize: 12 }}>No lat/lng data found</span>
        <span style={{ fontSize: 11, color: '#CBD5E1' }}>Set latField and lngField in config</span>
      </div>
    );
  }

  const lats = pins.map(p => p.lat);
  const lngs = pins.map(p => p.lng);
  const minLat = Math.min(...lats), maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs), maxLng = Math.max(...lngs);
  const pad = 0.02;
  const bbox = `${minLng - pad},${minLat - pad},${maxLng + pad},${maxLat + pad}`;
  const centerLat = (minLat + maxLat) / 2;
  const centerLng = (minLng + maxLng) / 2;

  const src = `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${centerLat},${centerLng}`;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: 0 }}>
      <div style={{ flex: 1, position: 'relative', minHeight: 180 }}>
        <iframe
          src={src}
          style={{ width: '100%', height: '100%', border: 'none' }}
          title="Map"
          loading="lazy"
        />
        <div style={{
          position: 'absolute', bottom: 4, right: 4,
          backgroundColor: 'rgba(255,255,255,0.9)', borderRadius: 3,
          padding: '2px 6px', fontSize: 10, color: '#475569',
        }}>
          {pins.length} location{pins.length !== 1 ? 's' : ''}
        </div>
      </div>
      {pins.length <= 10 && (
        <div style={{ borderTop: '1px solid #E2E8F0', maxHeight: 120, overflowY: 'auto' }}>
          {pins.map((p, i) => (
            <div key={i} style={{ display: 'flex', gap: 8, padding: '4px 8px', fontSize: 11, borderBottom: '1px solid #F1F5F9', alignItems: 'center' }}>
              <span style={{ color: '#3B82F6', flexShrink: 0 }}>📍</span>
              <span style={{ flex: 1, color: '#0D1117', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.label}</span>
              <span style={{ color: '#94A3B8', fontFamily: 'monospace', fontSize: 10 }}>{p.lat.toFixed(4)}, {p.lng.toFixed(4)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

// ── Utility Output Widget ──────────────────────────────────────────────────

const UtilityWidget: React.FC<{ comp: AppComponent }> = ({ comp }) => {
  const UTILITY_API = import.meta.env.VITE_UTILITY_SERVICE_URL || 'http://localhost:8014';
  const [result, setResult] = useState<unknown>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const runUtility = async () => {
    const utilityId = comp.utility_id;
    if (!utilityId) return;
    let inputs: Record<string, unknown> = {};
    try { inputs = JSON.parse(comp.utility_inputs || '{}'); } catch { inputs = {}; }

    setLoading(true);
    setError(null);
    try {
      const r = await fetch(`${UTILITY_API}/utilities/${utilityId}/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ inputs }),
      });
      const data = await r.json();
      setResult(data.result ?? data);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { runUtility(); }, [comp.utility_id, comp.utility_inputs]);

  if (!comp.utility_id) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#94A3B8', fontSize: 12 }}>
        Configure utility_id in widget settings
      </div>
    );
  }

  const displayValue = comp.display_field && result && typeof result === 'object'
    ? (result as Record<string, unknown>)[comp.display_field]
    : result;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      <div style={{ display: 'flex', gap: 6, padding: '6px 8px', borderBottom: '1px solid #F1F5F9', alignItems: 'center', flexShrink: 0 }}>
        <span style={{ fontSize: 11, color: '#64748B', fontFamily: 'monospace', flex: 1 }}>{comp.utility_id}</span>
        <button
          onClick={runUtility}
          disabled={loading}
          style={{ fontSize: 10, padding: '2px 8px', backgroundColor: '#F1F5F9', border: '1px solid #E2E8F0', borderRadius: 3, cursor: loading ? 'wait' : 'pointer', color: '#475569' }}
        >
          {loading ? '…' : '↻ Refresh'}
        </button>
      </div>
      <div style={{ flex: 1, overflow: 'auto', padding: 8 }}>
        {error && <div style={{ color: '#DC2626', fontSize: 11 }}>{error}</div>}
        {loading && !result && <div style={{ color: '#94A3B8', fontSize: 11 }}>Running…</div>}
        {displayValue !== null && displayValue !== undefined && (
          typeof displayValue === 'object'
            ? (
              Array.isArray(displayValue)
                ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {(displayValue as unknown[]).map((item, i) => (
                      <div key={i} style={{ padding: '4px 6px', backgroundColor: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: 3, fontSize: 11, color: '#0D1117' }}>
                        {typeof item === 'object' ? JSON.stringify(item) : String(item)}
                      </div>
                    ))}
                  </div>
                )
                : <pre style={{ margin: 0, fontSize: 10, color: '#0D1117', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>{JSON.stringify(displayValue, null, 2)}</pre>
            )
            : <div style={{ fontSize: 13, color: '#0D1117', lineHeight: 1.5 }}>{String(displayValue)}</div>
        )}
      </div>
    </div>
  );
};

// ── Component wrapper with per-type data loading ───────────────────────────

const ComponentRenderer: React.FC<{ comp: AppComponent }> = ({ comp }) => {
  const { records: rawRecords, loading } = useRecords(comp.objectTypeId);
  const records = applyFilters(rawRecords, comp.filters);

  if (loading) {
    return (
      <div style={{
        backgroundColor: '#fff',
        border: '1px solid #E2E8F0',
        borderRadius: 8,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100%',
        color: '#94A3B8',
        fontSize: 12,
      }}>
        Loading…
      </div>
    );
  }

  switch (comp.type) {
    case 'metric-card': return <MetricCard comp={comp} records={records} />;
    case 'kpi-banner': return <KpiBanner comp={comp} records={records} />;
    case 'data-table': return <DataTable comp={comp} records={records} />;
    case 'bar-chart': return <BarChart comp={comp} records={records} />;
    case 'line-chart': return <LineChart comp={comp} records={records} />;
    case 'filter-bar': return <FilterBar comp={comp} records={records} />;
    case 'text-block': return <TextBlock comp={comp} />;
    case 'chat-widget': return <ChatWidget comp={comp} records={records} />;
    case 'custom-code': return <CustomCodeWidget comp={comp} records={records} />;
    case 'map': return <MapWidget comp={comp} records={records} />;
    case 'utility-output': return <UtilityWidget comp={comp} />;
    default: return null;
  }
};

// ── App Canvas ─────────────────────────────────────────────────────────────

interface Props {
  app: NexusApp;
}

const AppCanvas: React.FC<Props> = ({ app }) => {
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: 'repeat(12, 1fr)',
      gap: 16,
      padding: 24,
      alignItems: 'start',
    }}>
      {app.components.map((comp) => {
        const defaultMin = comp.type === 'data-table' ? 320 : comp.type === 'bar-chart' ? 280 : comp.type === 'chat-widget' ? 400 : 140;
        const fixedH = comp.gridH ? comp.gridH * 60 : undefined;
        return (
          <div
            key={comp.id}
            style={{
              gridColumn: `span ${comp.colSpan || 6}`,
              height: fixedH ? fixedH : undefined,
              minHeight: fixedH ? undefined : defaultMin,
            }}
          >
            <ComponentRenderer comp={comp} />
          </div>
        );
      })}
    </div>
  );
};

export default AppCanvas;
