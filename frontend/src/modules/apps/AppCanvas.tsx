import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { NexusApp, AppComponent, AppFilter, AppEvent } from '../../types/app';
import { getTenantId } from '../../store/authStore';
import { AppVariableProvider, useAppVariables } from './AppVariableContext';
import { colors as tokens, chartPalette } from '../../design-system/tokens';

// ── Cross-widget filter context ───────────────────────────────────────────
interface CrossFilter { field: string; value: string; sourceId: string }
interface CrossFilterCtx {
  filter: CrossFilter | null;
  setFilter: (f: CrossFilter | null) => void;
}
const CrossFilterContext = createContext<CrossFilterCtx>({ filter: null, setFilter: () => {} });

const ONTOLOGY_API = import.meta.env.VITE_ONTOLOGY_SERVICE_URL || 'http://localhost:8004';
const INFERENCE_API = import.meta.env.VITE_INFERENCE_SERVICE_URL || 'http://localhost:8003';

// ── Data fetching ──────────────────────────────────────────────────────────

function useRecords(objectTypeId?: string) {
  const [records, setRecords] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!objectTypeId) return;
    let cancelled = false;
    setLoading(true);

    // Fetch all records by paginating through pages of 500
    const PAGE = 500;
    async function fetchAll() {
      const all: Record<string, unknown>[] = [];
      let offset = 0;
      let total = Infinity;
      while (offset < total) {
        const res = await fetch(
          `${ONTOLOGY_API}/object-types/${objectTypeId}/records?limit=${PAGE}&offset=${offset}`,
          { headers: { 'x-tenant-id': getTenantId() } },
        );
        const d = await res.json();
        const rows = d.records || [];
        total = d.total ?? rows.length;
        all.push(...rows);
        offset += PAGE;
        if (rows.length < PAGE) break; // no more pages
      }
      if (!cancelled) setRecords(all);
    }

    fetchAll().catch(() => { if (!cancelled) setRecords([]); }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
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
            <div style={{ fontSize: 22, fontWeight: 700, color: tokens.primary }}>{k.value}</div>
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
  const { filter: crossFilter, setFilter: setCrossFilter } = useContext(CrossFilterContext);
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
              const isActive = crossFilter?.field === labelField && crossFilter?.value === label;
              return (
                <g
                  key={label}
                  style={{ cursor: 'pointer' }}
                  onClick={() => {
                    if (isActive) setCrossFilter(null);
                    else setCrossFilter({ field: labelField, value: label === '(empty)' ? '' : label, sourceId: comp.id });
                  }}
                >
                  <text
                    x={labelW - 6}
                    y={y + barHeight / 2 + 4}
                    textAnchor="end"
                    fontSize={10}
                    fill={isActive ? tokens.primary : tokens.textMuted}
                    fontWeight={isActive ? 700 : 400}
                  >
                    {label.length > 18 ? label.slice(0, 18) + '…' : label}
                  </text>
                  <rect
                    x={labelW}
                    y={y}
                    width={Math.max(barW, 2)}
                    height={barHeight}
                    rx={3}
                    fill={isActive ? tokens.primary : chartPalette[0]}
                    opacity={isActive ? 1 : 0.8}
                    stroke={isActive ? tokens.primary : 'none'}
                    strokeWidth={isActive ? 2 : 0}
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
            <path d={pathD} fill="none" stroke={chartPalette[0]} strokeWidth={2} />
            {/* Dots */}
            {points.map((p, i) => (
              <circle key={i} cx={toX(i)} cy={toY(p.y)} r={3} fill={chartPalette[0]} />
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

// ── Pie / Donut Chart ────────────────────────────────────────────────────
const PieChartWidget: React.FC<{ comp: AppComponent; records: Record<string, unknown>[] }> = ({
  comp, records,
}) => {
  const { filter: crossFilter, setFilter: setCrossFilter } = useContext(CrossFilterContext);
  const labelField = comp.labelField || (records.length ? Object.keys(records[0])[0] : 'name');
  const valueField = comp.valueField || '';

  // Group data
  const grouped: Record<string, number> = {};
  for (const r of records) {
    const label = (r[labelField] != null && r[labelField] !== '' ? String(r[labelField]) : '(empty)').slice(0, 30);
    if (valueField) {
      const n = parseFloat(String(r[valueField] ?? 0));
      grouped[label] = (grouped[label] || 0) + (isNaN(n) ? 0 : n);
    } else {
      grouped[label] = (grouped[label] || 0) + 1;
    }
  }

  const entries = Object.entries(grouped).sort((a, b) => b[1] - a[1]).slice(0, 12);
  const total = entries.reduce((s, [, v]) => s + v, 0);
  const cx = 100, cy = 100, r = 80, ir = 45; // outer and inner (donut) radius

  // Build SVG arcs
  let cumAngle = -Math.PI / 2;
  const arcs = entries.map(([label, val], i) => {
    const angle = (val / total) * Math.PI * 2;
    const startAngle = cumAngle;
    cumAngle += angle;
    const endAngle = cumAngle;
    const largeArc = angle > Math.PI ? 1 : 0;
    const x1 = cx + r * Math.cos(startAngle), y1 = cy + r * Math.sin(startAngle);
    const x2 = cx + r * Math.cos(endAngle), y2 = cy + r * Math.sin(endAngle);
    const ix1 = cx + ir * Math.cos(endAngle), iy1 = cy + ir * Math.sin(endAngle);
    const ix2 = cx + ir * Math.cos(startAngle), iy2 = cy + ir * Math.sin(startAngle);
    const path = `M ${ix2} ${iy2} L ${x1} ${y1} A ${r} ${r} 0 ${largeArc} 1 ${x2} ${y2} L ${ix1} ${iy1} A ${ir} ${ir} 0 ${largeArc} 0 ${ix2} ${iy2} Z`;
    return { label, val, path, color: chartPalette[i % chartPalette.length], pct: ((val / total) * 100).toFixed(1) };
  });

  return (
    <div style={{ backgroundColor: '#fff', border: '1px solid #E2E8F0', borderRadius: 8, overflow: 'hidden', height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: '12px 16px', borderBottom: '1px solid #E2E8F0', fontSize: 13, fontWeight: 600, color: '#0D1117' }}>{comp.title}</div>
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 24, padding: '12px 16px', overflow: 'hidden' }}>
        {entries.length === 0 ? (
          <div style={{ color: '#94A3B8', fontSize: 12 }}>No data</div>
        ) : (
          <>
            <svg width="200" height="200" viewBox="0 0 200 200">
              {arcs.map((a, i) => {
                const isActive = crossFilter?.field === labelField && crossFilter?.value === a.label;
                return (
                  <path
                    key={i} d={a.path} fill={a.color} stroke={isActive ? '#0D1117' : '#fff'}
                    strokeWidth={isActive ? 3 : 1.5}
                    style={{ cursor: 'pointer', opacity: crossFilter && !isActive ? 0.4 : 1 }}
                    onClick={() => {
                      if (isActive) setCrossFilter(null);
                      else setCrossFilter({ field: labelField, value: a.label === '(empty)' ? '' : a.label, sourceId: comp.id });
                    }}
                  >
                    <title>{a.label}: {a.val.toLocaleString()} ({a.pct}%)</title>
                  </path>
                );
              })}
              <text x={cx} y={cy - 4} textAnchor="middle" fontSize={18} fontWeight={700} fill="#0D1117">{total.toLocaleString()}</text>
              <text x={cx} y={cy + 12} textAnchor="middle" fontSize={9} fill="#94A3B8">total</text>
            </svg>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 100 }}>
              {arcs.map((a, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 10, color: '#64748B' }}>
                  <div style={{ width: 8, height: 8, borderRadius: 2, backgroundColor: a.color, flexShrink: 0 }} />
                  <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.label}</span>
                  <span style={{ fontFamily: 'var(--font-mono)', color: '#0D1117', fontWeight: 600 }}>{a.pct}%</span>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
};

// ── Area Chart ───────────────────────────────────────────────────────────
const AreaChartWidget: React.FC<{ comp: AppComponent; records: Record<string, unknown>[] }> = ({
  comp, records,
}) => {
  const allFields = records.length > 0 ? Object.keys(records[0]) : [];
  const xField = comp.xField || allFields.find(f => /date|time|created|updated/i.test(f)) || allFields[0] || '';
  const valueField = comp.valueField || allFields.find(f => /count|amount|value|total|price|revenue/i.test(f)) || '';
  const groupField = comp.labelField || '';

  // Parse and sort by date
  const parseDate = (v: unknown) => {
    if (!v) return 0;
    const s = String(v);
    const d = new Date(s);
    if (!isNaN(d.getTime())) return d.getTime();
    const n = Number(s);
    if (!isNaN(n) && n > 1e9 && n < 1e13) return n * 1000;
    if (!isNaN(n) && n >= 1e13) return n;
    return 0;
  };

  // Bucket by month
  const buckets: Record<string, Record<string, number>> = {};
  for (const r of records) {
    const ts = parseDate(r[xField]);
    if (!ts) continue;
    const d = new Date(ts);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    if (!buckets[key]) buckets[key] = {};
    const series = groupField && r[groupField] ? String(r[groupField]) : 'value';
    if (valueField) {
      const n = parseFloat(String(r[valueField] ?? 0));
      buckets[key][series] = (buckets[key][series] || 0) + (isNaN(n) ? 0 : n);
    } else {
      buckets[key][series] = (buckets[key][series] || 0) + 1;
    }
  }

  const sortedKeys = Object.keys(buckets).sort();
  const allSeries = [...new Set(sortedKeys.flatMap(k => Object.keys(buckets[k])))].slice(0, 5);
  // Use design-system chart palette for series colors

  if (!sortedKeys.length) {
    return (
      <div style={{ backgroundColor: '#fff', border: '1px solid #E2E8F0', borderRadius: 8, height: '100%', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '12px 16px', borderBottom: '1px solid #E2E8F0', fontSize: 13, fontWeight: 600, color: '#0D1117' }}>{comp.title}</div>
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#94A3B8', fontSize: 12 }}>No data</div>
      </div>
    );
  }

  const data = sortedKeys.map(k => ({ key: k, ...Object.fromEntries(allSeries.map(s => [s, buckets[k][s] || 0])) }));
  const maxVal = Math.max(...data.flatMap(d => allSeries.map(s => (d as unknown as Record<string, number>)[s] || 0)), 1);

  // SVG area chart
  const W = 400, H = 200, padL = 40, padR = 10, padT = 10, padB = 30;
  const chartW = W - padL - padR, chartH = H - padT - padB;

  return (
    <div style={{ backgroundColor: '#fff', border: '1px solid #E2E8F0', borderRadius: 8, overflow: 'hidden', height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: '12px 16px', borderBottom: '1px solid #E2E8F0', fontSize: 13, fontWeight: 600, color: '#0D1117' }}>{comp.title}</div>
      <div style={{ flex: 1, padding: '12px 16px', overflow: 'hidden' }}>
        <svg width="100%" height="100%" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet">
          {/* Y-axis gridlines */}
          {[0, 0.25, 0.5, 0.75, 1].map(pct => {
            const y = padT + chartH * (1 - pct);
            return (
              <g key={pct}>
                <line x1={padL} x2={W - padR} y1={y} y2={y} stroke="#F1F5F9" strokeWidth={1} />
                <text x={padL - 4} y={y + 3} textAnchor="end" fontSize={8} fill="#94A3B8">{Math.round(maxVal * pct).toLocaleString()}</text>
              </g>
            );
          })}
          {/* Areas (stacked if multiple series, single otherwise) */}
          {allSeries.map((s, si) => {
            const points = data.map((d, i) => {
              const x = padL + (i / Math.max(data.length - 1, 1)) * chartW;
              const val = (d as unknown as Record<string, number>)[s] || 0;
              const y = padT + chartH * (1 - val / maxVal);
              return `${x},${y}`;
            });
            const baseline = `${padL + chartW},${padT + chartH} ${padL},${padT + chartH}`;
            return (
              <polygon key={s} points={`${points.join(' ')} ${baseline}`} fill={chartPalette[si % chartPalette.length]} opacity={0.25} stroke={chartPalette[si % chartPalette.length]} strokeWidth={1.5}
                style={{ transition: 'opacity 0.2s' }}
              />
            );
          })}
          {/* X labels */}
          {data.filter((_, i) => i % Math.max(1, Math.floor(data.length / 6)) === 0).map((d, i, arr) => {
            const idx = data.indexOf(d);
            const x = padL + (idx / Math.max(data.length - 1, 1)) * chartW;
            return <text key={i} x={x} y={H - 4} textAnchor="middle" fontSize={8} fill="#94A3B8">{d.key}</text>;
          })}
          {/* Legend */}
          {allSeries.length > 1 && allSeries.map((s, i) => (
            <g key={s} transform={`translate(${padL + i * 80}, ${H - 14})`}>
              <rect width={8} height={8} rx={1} fill={chartPalette[i % chartPalette.length]} />
              <text x={11} y={7} fontSize={8} fill={tokens.textMuted}>{s.slice(0, 12)}</text>
            </g>
          ))}
        </svg>
      </div>
    </div>
  );
};

// ── Stat Card ────────────────────────────────────────────────────────────
const StatCard: React.FC<{ comp: AppComponent; records: Record<string, unknown>[] }> = ({
  comp, records,
}) => {
  const field = comp.field || '';
  const agg = comp.aggregation || 'count';
  const dateField = comp.comparisonField || '';

  // Compute current value
  const computeValue = (recs: Record<string, unknown>[]) => {
    if (agg === 'count') return recs.length;
    const nums = recs.map(r => parseFloat(String(r[field] ?? ''))).filter(n => !isNaN(n));
    if (!nums.length) return 0;
    switch (agg) {
      case 'sum': return nums.reduce((a, b) => a + b, 0);
      case 'avg': return nums.reduce((a, b) => a + b, 0) / nums.length;
      case 'max': return Math.max(...nums);
      case 'min': return Math.min(...nums);
      default: return nums.length;
    }
  };

  const currentVal = computeValue(records);

  // Compute trend if dateField is set — compare last 30 days vs prior 30 days
  let trendPct: number | null = null;
  let trendDirection: 'up' | 'down' | 'flat' = 'flat';
  if (dateField && records.length > 0) {
    const now = Date.now();
    const d30 = 30 * 86400000;
    const recent = records.filter(r => {
      const d = new Date(String(r[dateField] ?? ''));
      return !isNaN(d.getTime()) && d.getTime() > now - d30;
    });
    const prior = records.filter(r => {
      const d = new Date(String(r[dateField] ?? ''));
      return !isNaN(d.getTime()) && d.getTime() > now - d30 * 2 && d.getTime() <= now - d30;
    });
    const recentVal = computeValue(recent);
    const priorVal = computeValue(prior);
    if (priorVal > 0) {
      trendPct = ((recentVal - priorVal) / priorVal) * 100;
      trendDirection = trendPct > 1 ? 'up' : trendPct < -1 ? 'down' : 'flat';
    }
  }

  const fmt = (v: number) => {
    if (v >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
    if (v >= 1e3) return `${(v / 1e3).toFixed(1)}K`;
    return agg === 'avg' ? v.toFixed(1) : v.toLocaleString();
  };

  return (
    <div style={{
      backgroundColor: '#fff', border: '1px solid #E2E8F0', borderRadius: 8,
      height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'center',
      padding: '20px 24px',
    }}>
      <div style={{ fontSize: 10, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>
        {comp.title}
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
        <span style={{ fontSize: 32, fontWeight: 700, color: '#0D1117', fontFamily: 'var(--font-mono)', lineHeight: 1 }}>
          {fmt(currentVal)}
        </span>
        {trendPct !== null && (
          <span style={{
            fontSize: 13, fontWeight: 600,
            color: trendDirection === 'up' ? '#10B981' : trendDirection === 'down' ? '#DC2626' : '#94A3B8',
          }}>
            {trendDirection === 'up' ? '↑' : trendDirection === 'down' ? '↓' : '→'} {Math.abs(trendPct).toFixed(1)}%
          </span>
        )}
      </div>
      {trendPct !== null && (
        <div style={{ fontSize: 10, color: '#94A3B8', marginTop: 4 }}>
          vs prior 30 days
        </div>
      )}
    </div>
  );
};

// ── Date Picker Widget ───────────────────────────────────────────────────
const DatePickerWidget: React.FC<{ comp: AppComponent; records: Record<string, unknown>[] }> = ({ comp }) => {
  const [start, setStart] = React.useState('');
  const [end, setEnd] = React.useState('');

  return (
    <div style={{
      backgroundColor: '#fff', border: '1px solid #E2E8F0', borderRadius: 8,
      padding: '12px 16px', height: '100%',
    }}>
      <div style={{ fontSize: 13, fontWeight: 600, color: '#0D1117', marginBottom: 10 }}>{comp.title || 'Date Filter'}</div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <input type="date" value={start} onChange={e => setStart(e.target.value)}
          style={{ height: 28, padding: '0 8px', border: '1px solid #E2E8F0', borderRadius: 4, fontSize: 12, color: '#0D1117', outline: 'none' }} />
        <span style={{ fontSize: 10, color: '#94A3B8' }}>to</span>
        <input type="date" value={end} onChange={e => setEnd(e.target.value)}
          style={{ height: 28, padding: '0 8px', border: '1px solid #E2E8F0', borderRadius: 4, fontSize: 12, color: '#0D1117', outline: 'none' }} />
        {(start || end) && (
          <button onClick={() => { setStart(''); setEnd(''); }}
            style={{ height: 28, padding: '0 10px', border: '1px solid #E2E8F0', borderRadius: 4, background: '#FFF', fontSize: 11, color: '#64748B', cursor: 'pointer' }}>
            Clear
          </button>
        )}
        <div style={{ fontSize: 10, color: '#94A3B8', marginLeft: 'auto' }}>
          Filters: {comp.xField || 'date field'}
        </div>
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
              padding: '3px 8px', backgroundColor: tokens.interactiveDim, color: tokens.interactive,
              border: `1px solid ${tokens.interactiveBorder}`, borderRadius: 3, fontSize: 11, cursor: 'pointer',
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

const InlineWidget: React.FC<{ comp: AppComponent; records?: Record<string, unknown>[] }> = ({ comp, records: passedRecords }) => {
  const { records: fetchedRecords } = useRecords(passedRecords ? undefined : comp.objectTypeId);
  const records = passedRecords || fetchedRecords;
  const filtered = applyFilters(records, comp.filters);
  switch (comp.type) {
    case 'metric-card': return <MetricCard comp={comp} records={filtered} />;
    case 'kpi-banner': return <KpiBanner comp={comp} records={filtered} />;
    case 'data-table': return <DataTable comp={comp} records={filtered} />;
    case 'bar-chart': return <BarChart comp={comp} records={filtered} />;
    case 'line-chart': return <LineChart comp={comp} records={filtered} />;
    case 'pie-chart': return <PieChartWidget comp={comp} records={filtered} />;
    case 'area-chart': return <AreaChartWidget comp={comp} records={filtered} />;
    case 'stat-card': return <StatCard comp={comp} records={filtered} />;
    case 'date-picker': return <DatePickerWidget comp={comp} records={filtered} />;
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
  records?: Record<string, unknown>[];
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
}) => {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [thinking, setThinking] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

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
          tenant_id: getTenantId(),
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
        <span style={{ fontSize: 11, color: '#94A3B8' }}>Full data access</span>
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
              backgroundColor: m.role === 'user' ? tokens.primary : '#F8FAFC',
              color: m.role === 'user' ? '#fff' : '#0D1117',
              border: m.role === 'assistant' ? '1px solid #E2E8F0' : 'none',
              fontSize: 12, lineHeight: 1.6,
            }}>
              {m.role === 'user'
                ? m.text
                : <MarkdownMessage text={m.text} objectTypeId={comp.objectTypeId} />
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
            backgroundColor: !input.trim() || thinking ? '#E2E8F0' : tokens.primary,
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

// ── Dropdown Filter Widget ────────────────────────────────────────────────

const DropdownFilterWidget: React.FC<{ comp: AppComponent }> = ({ comp }) => {
  const { setVariable, getVariable } = useAppVariables();
  const varId = comp.variableId || '';
  const currentValue = varId ? getVariable(varId) : '';
  const { records } = useRecords(comp.objectTypeId);

  // Static options from config or distinct values from records
  const opts: string[] = comp.options && comp.options.length > 0
    ? comp.options
    : (() => {
        const field = comp.filterField || comp.labelField || '';
        if (!field || !records.length) return [];
        const seen = new Set<string>();
        for (const r of records) {
          const v = String(r[field] ?? '');
          if (v) seen.add(v);
          if (seen.size >= 100) break;
        }
        return Array.from(seen).sort();
      })();

  return (
    <div style={{
      backgroundColor: '#fff', border: '1px solid #E2E8F0', borderRadius: 8,
      padding: '12px 16px', height: '100%', display: 'flex', flexDirection: 'column', gap: 8,
    }}>
      <div style={{ fontSize: 13, fontWeight: 600, color: '#0D1117' }}>{comp.title}</div>
      <select
        value={currentValue ?? ''}
        onChange={(e) => { if (varId) setVariable(varId, e.target.value); }}
        style={{
          width: '100%', height: 32, padding: '0 8px',
          border: '1px solid #E2E8F0', borderRadius: 6, fontSize: 12,
          color: currentValue ? '#0D1117' : '#94A3B8', backgroundColor: '#F8FAFC',
          outline: 'none', cursor: 'pointer',
        }}
      >
        <option value="">-- Select --</option>
        {opts.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
      {currentValue && (
        <button
          onClick={() => { if (varId) setVariable(varId, ''); }}
          style={{
            alignSelf: 'flex-start', padding: '2px 8px', border: '1px solid #E2E8F0',
            borderRadius: 4, background: '#F8FAFC', fontSize: 11, color: '#64748B',
            cursor: 'pointer',
          }}
        >
          Clear
        </button>
      )}
    </div>
  );
};

// ── Form Widget ──────────────────────────────────────────────────────────

const FormWidget: React.FC<{ comp: AppComponent }> = ({ comp }) => {
  const formFields = comp.fields || [];
  const [values, setValues] = useState<Record<string, any>>({});
  const [submitting, setSubmitting] = useState(false);
  const [status, setStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState('');

  const handleSubmit = async () => {
    if (!comp.actionName) return;
    setSubmitting(true);
    setStatus('idle');
    setErrorMsg('');
    try {
      const ACTION_API = import.meta.env.VITE_ONTOLOGY_SERVICE_URL || 'http://localhost:8004';
      const res = await fetch(`${ACTION_API}/actions/${comp.actionName}/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-tenant-id': getTenantId() },
        body: JSON.stringify({ inputs: values }),
      });
      if (!res.ok) throw new Error(`Status ${res.status}`);
      setStatus('success');
      setTimeout(() => setStatus('idle'), 3000);
    } catch (e: unknown) {
      setStatus('error');
      setErrorMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={{
      backgroundColor: '#fff', border: '1px solid #E2E8F0', borderRadius: 8,
      padding: '16px 20px', height: '100%', display: 'flex', flexDirection: 'column', gap: 10,
      overflowY: 'auto',
    }}>
      <div style={{ fontSize: 13, fontWeight: 600, color: '#0D1117' }}>{comp.title}</div>
      {formFields.map((f) => (
        <div key={f.name}>
          <div style={{ fontSize: 11, fontWeight: 500, color: '#64748B', marginBottom: 4 }}>{f.label || f.name}</div>
          {f.type === 'boolean' ? (
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={!!values[f.name]}
                onChange={(e) => setValues((v) => ({ ...v, [f.name]: e.target.checked }))}
              />
              <span style={{ fontSize: 12, color: '#374151' }}>{values[f.name] ? 'Yes' : 'No'}</span>
            </label>
          ) : f.type === 'textarea' ? (
            <textarea
              value={values[f.name] ?? ''}
              onChange={(e) => setValues((v) => ({ ...v, [f.name]: e.target.value }))}
              rows={3}
              style={{
                width: '100%', padding: '6px 8px', border: '1px solid #E2E8F0',
                borderRadius: 4, fontSize: 12, color: '#0D1117', resize: 'vertical',
                boxSizing: 'border-box', outline: 'none', fontFamily: 'inherit',
              }}
            />
          ) : (
            <input
              type={f.type === 'number' ? 'number' : 'text'}
              value={values[f.name] ?? ''}
              onChange={(e) => setValues((v) => ({ ...v, [f.name]: f.type === 'number' ? Number(e.target.value) : e.target.value }))}
              style={{
                width: '100%', height: 30, padding: '0 8px', border: '1px solid #E2E8F0',
                borderRadius: 4, fontSize: 12, color: '#0D1117', boxSizing: 'border-box',
                outline: 'none',
              }}
            />
          )}
        </div>
      ))}
      {comp.actionName && (
        <button
          onClick={handleSubmit}
          disabled={submitting}
          style={{
            marginTop: 4, padding: '7px 16px', border: 'none', borderRadius: 6,
            backgroundColor: submitting ? '#E2E8F0' : tokens.primary,
            color: submitting ? '#94A3B8' : '#fff',
            fontSize: 12, fontWeight: 600, cursor: submitting ? 'default' : 'pointer',
            alignSelf: 'flex-start',
          }}
        >
          {submitting ? 'Submitting...' : 'Submit'}
        </button>
      )}
      {status === 'success' && (
        <div style={{ fontSize: 11, color: '#16A34A', backgroundColor: '#F0FDF4', border: '1px solid #BBF7D0', borderRadius: 4, padding: '4px 8px' }}>
          Submitted successfully
        </div>
      )}
      {status === 'error' && (
        <div style={{ fontSize: 11, color: '#DC2626', backgroundColor: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 4, padding: '4px 8px' }}>
          Error: {errorMsg}
        </div>
      )}
    </div>
  );
};

// ── Object Table Widget ──────────────────────────────────────────────────

const ObjectTableWidget: React.FC<{ comp: AppComponent }> = ({ comp }) => {
  const { variables, setVariable } = useAppVariables();
  const [records, setRecords] = useState<Record<string, unknown>[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [sortField, setSortField] = useState<string | null>(null);
  const [sortAsc, setSortAsc] = useState(true);
  const [page, setPage] = useState(0);
  const pageSize = comp.maxRows || 100;

  // Build filter params from inputBindings + current variable values
  const filterKey = comp.inputBindings
    ? Object.entries(comp.inputBindings).map(([k, vId]) => `${k}=${variables.get(vId) ?? ''}`).join('&')
    : '';

  // Build server-side filter from inputBindings
  const buildFilter = () => {
    if (!comp.inputBindings) return null;
    const filters: Record<string, unknown> = {};
    for (const [field, varId] of Object.entries(comp.inputBindings)) {
      const val = variables.get(varId);
      if (val !== undefined && val !== null && val !== '') {
        filters[field] = { op: 'eq', value: String(val) };
      }
    }
    return Object.keys(filters).length > 0 ? filters : null;
  };

  useEffect(() => {
    if (!comp.objectTypeId) return;
    setLoading(true);
    const params = new URLSearchParams();
    params.set('limit', String(pageSize));
    params.set('offset', String(page * pageSize));
    if (sortField) {
      params.set('sort_field', sortField);
      params.set('sort_dir', sortAsc ? 'asc' : 'desc');
    }
    const filter = buildFilter();
    if (filter) params.set('filter', JSON.stringify(filter));

    fetch(`${ONTOLOGY_API}/object-types/${comp.objectTypeId}/records?${params}`, {
      headers: { 'x-tenant-id': getTenantId() },
    })
      .then((r) => r.json())
      .then((d) => {
        setRecords(d.records || []);
        setTotal(d.total ?? (d.records || []).length);
      })
      .catch(() => { setRecords([]); setTotal(0); })
      .finally(() => setLoading(false));
  }, [comp.objectTypeId, filterKey, page, pageSize, sortField, sortAsc]);

  // Reset page when filters change
  useEffect(() => { setPage(0); }, [filterKey]);

  const cols = comp.columns?.length
    ? comp.columns
    : (records.length > 0 ? Object.keys(records[0]).filter((k) => !k.endsWith('[]')).slice(0, 8) : []);

  const handleSort = (field: string) => {
    if (sortField === field) setSortAsc((a) => !a);
    else { setSortField(field); setSortAsc(true); }
    setPage(0);
  };

  const handleRowClick = (row: Record<string, unknown>) => {
    if (comp.outputBindings) {
      for (const [, varId] of Object.entries(comp.outputBindings)) {
        setVariable(varId, row);
      }
    }
  };

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  if (loading && records.length === 0) {
    return (
      <div style={{
        backgroundColor: '#fff', border: '1px solid #E2E8F0', borderRadius: 8,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        height: '100%', color: '#94A3B8', fontSize: 12,
      }}>
        Loading...
      </div>
    );
  }

  return (
    <div style={{
      backgroundColor: '#fff', border: '1px solid #E2E8F0', borderRadius: 8,
      overflow: 'hidden', height: '100%', display: 'flex', flexDirection: 'column',
    }}>
      {/* Header */}
      <div style={{
        padding: '12px 16px', borderBottom: '1px solid #E2E8F0', fontSize: 13, fontWeight: 600,
        color: '#0D1117', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      }}>
        <span>{comp.title}</span>
        <span style={{ fontSize: 11, color: '#94A3B8', fontWeight: 400 }}>
          {total.toLocaleString()} records
          {loading && ' (loading...)'}
        </span>
      </div>

      {/* Table */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr style={{ backgroundColor: '#F8FAFC', position: 'sticky', top: 0 }}>
              {cols.map((c) => (
                <th
                  key={c}
                  onClick={() => handleSort(c)}
                  style={{
                    textAlign: 'left', padding: '8px 12px', color: '#64748B', fontWeight: 500,
                    borderBottom: '1px solid #E2E8F0', whiteSpace: 'nowrap', cursor: 'pointer',
                    userSelect: 'none',
                  }}
                >
                  {c} {sortField === c ? (sortAsc ? '\u2191' : '\u2193') : ''}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {records.map((row, i) => (
              <tr
                key={i}
                onClick={() => handleRowClick(row)}
                style={{ borderBottom: '1px solid #F1F5F9', cursor: comp.outputBindings ? 'pointer' : 'default' }}
                onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#F8FAFC')}
                onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = '')}
              >
                {cols.map((c) => (
                  <td key={c} style={{
                    padding: '7px 12px', color: '#374151', maxWidth: 200,
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>
                    {Array.isArray(row[c]) ? `[${(row[c] as unknown[]).length} items]` : String(row[c] ?? '')}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {records.length === 0 && !loading && (
          <div style={{ textAlign: 'center', padding: 32, color: '#94A3B8', fontSize: 12 }}>
            No records found
          </div>
        )}
      </div>

      {/* Pagination footer */}
      {total > pageSize && (
        <div style={{
          padding: '8px 16px', borderTop: '1px solid #E2E8F0', backgroundColor: '#F8FAFC',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0,
        }}>
          <span style={{ fontSize: 11, color: '#64748B' }}>
            {(page * pageSize + 1).toLocaleString()}–{Math.min((page + 1) * pageSize, total).toLocaleString()} of {total.toLocaleString()}
          </span>
          <div style={{ display: 'flex', gap: 4 }}>
            <button
              onClick={() => setPage(0)}
              disabled={page === 0}
              style={{
                height: 26, padding: '0 8px', borderRadius: 4, border: '1px solid #E2E8F0',
                backgroundColor: '#fff', color: page === 0 ? '#CBD5E1' : '#64748B',
                fontSize: 11, cursor: page === 0 ? 'default' : 'pointer',
              }}
            >
              First
            </button>
            <button
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={page === 0}
              style={{
                height: 26, padding: '0 8px', borderRadius: 4, border: '1px solid #E2E8F0',
                backgroundColor: '#fff', color: page === 0 ? '#CBD5E1' : '#64748B',
                fontSize: 11, cursor: page === 0 ? 'default' : 'pointer',
              }}
            >
              Prev
            </button>
            <span style={{ fontSize: 11, color: '#64748B', padding: '0 8px', lineHeight: '26px' }}>
              Page {page + 1} of {totalPages}
            </span>
            <button
              onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
              disabled={page >= totalPages - 1}
              style={{
                height: 26, padding: '0 8px', borderRadius: 4, border: '1px solid #E2E8F0',
                backgroundColor: '#fff', color: page >= totalPages - 1 ? '#CBD5E1' : '#64748B',
                fontSize: 11, cursor: page >= totalPages - 1 ? 'default' : 'pointer',
              }}
            >
              Next
            </button>
            <button
              onClick={() => setPage(totalPages - 1)}
              disabled={page >= totalPages - 1}
              style={{
                height: 26, padding: '0 8px', borderRadius: 4, border: '1px solid #E2E8F0',
                backgroundColor: '#fff', color: page >= totalPages - 1 ? '#CBD5E1' : '#64748B',
                fontSize: 11, cursor: page >= totalPages - 1 ? 'default' : 'pointer',
              }}
            >
              Last
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

// ── Event bus helper ─────────────────────────────────────────────────────

function useEventBus(events: AppEvent[] | undefined) {
  const { setVariable } = useAppVariables();

  const fireTrigger = useCallback(
    (sourceWidgetId: string, trigger: string, payload?: any) => {
      if (!events) return;
      const matched = events.filter(
        (e) => e.sourceWidgetId === sourceWidgetId && e.trigger === trigger,
      );
      for (const ev of matched) {
        for (const action of ev.actions) {
          if (action.type === 'setVariable' && action.variableId) {
            const value = action.valueFrom && payload ? payload[action.valueFrom] : payload;
            setVariable(action.variableId, value);
          }
          // refreshWidget is a no-op for now — widgets auto-refresh on variable change
        }
      }
    },
    [events, setVariable],
  );

  return { fireTrigger };
}

// ── Component wrapper with per-type data loading ───────────────────────────

const ComponentRenderer: React.FC<{ comp: AppComponent; events?: AppEvent[] }> = ({ comp, events }) => {
  const { records: rawRecords, loading } = useRecords(comp.objectTypeId);
  const { filter: crossFilter } = useContext(CrossFilterContext);
  const afterCompFilters = applyFilters(rawRecords, comp.filters);
  // Apply cross-widget filter (skip if this widget is the source)
  const records = crossFilter && crossFilter.sourceId !== comp.id
    ? afterCompFilters.filter(r => {
        const raw = resolveRaw(r, crossFilter.field);
        return String(raw ?? '') === crossFilter.value || (crossFilter.value === '' && (raw == null || raw === ''));
      })
    : afterCompFilters;

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
    case 'pie-chart': return <PieChartWidget comp={comp} records={records} />;
    case 'area-chart': return <AreaChartWidget comp={comp} records={records} />;
    case 'stat-card': return <StatCard comp={comp} records={records} />;
    case 'date-picker': return <DatePickerWidget comp={comp} records={records} />;
    case 'filter-bar': return <FilterBar comp={comp} records={records} />;
    case 'text-block': return <TextBlock comp={comp} />;
    case 'chat-widget': return <ChatWidget comp={comp} records={records} />;
    case 'custom-code': return <CustomCodeWidget comp={comp} records={records} />;
    case 'map': return <MapWidget comp={comp} records={records} />;
    case 'utility-output': return <UtilityWidget comp={comp} />;
    case 'dropdown-filter': return <DropdownFilterWidget comp={comp} />;
    case 'form': return <FormWidget comp={comp} />;
    case 'object-table': return <ObjectTableWidget comp={comp} />;
    default: return null;
  }
};

// ── App Canvas ─────────────────────────────────────────────────────────────

interface Props {
  app: NexusApp;
}

const AppCanvas: React.FC<Props> = ({ app }) => {
  const [crossFilter, setCrossFilter] = useState<CrossFilter | null>(null);

  return (
    <AppVariableProvider definitions={app.variables || []}>
      <CrossFilterContext.Provider value={{ filter: crossFilter, setFilter: setCrossFilter }}>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {/* Cross-filter badge */}
          {crossFilter && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: 8, padding: '8px 24px',
              backgroundColor: '#EFF6FF', borderBottom: '1px solid #BFDBFE',
            }}>
              <span style={{ fontSize: 11, color: '#1D4ED8', fontWeight: 600 }}>Filtered:</span>
              <span style={{
                fontSize: 11, padding: '2px 8px', borderRadius: 10,
                backgroundColor: '#DBEAFE', color: '#1E40AF', fontWeight: 500,
              }}>
                {crossFilter.field} = {crossFilter.value || '(empty)'}
              </span>
              <button
                onClick={() => setCrossFilter(null)}
                style={{
                  border: 'none', background: '#BFDBFE', borderRadius: 3,
                  width: 20, height: 20, cursor: 'pointer', fontSize: 12,
                  color: '#1D4ED8', display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}
              >×</button>
            </div>
          )}
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(12, 1fr)',
            gap: 16,
            padding: 24,
            alignItems: 'start',
          }}>
            {app.components.map((comp) => {
              const defaultMin = comp.type === 'data-table' || comp.type === 'object-table' ? 320 : comp.type === 'bar-chart' ? 280 : comp.type === 'chat-widget' ? 400 : 140;
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
                  <ComponentRenderer comp={comp} events={app.events} />
                </div>
              );
            })}
          </div>
        </div>
      </CrossFilterContext.Provider>
    </AppVariableProvider>
  );
};

export default AppCanvas;
