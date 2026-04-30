import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { NexusApp, AppComponent, AppFilter, AppEvent, AppAction, DashboardFilterBar as DashboardFilterBarConfig, RangePreset, CompositeLayout } from '../../types/app';
import { useTimezone, formatInTz } from '../../lib/timezone';
import { getTenantId, getAccessToken } from '../../store/authStore';
import { AppVariableProvider, useAppVariables } from './AppVariableContext';
import { colors as tokens, chartPalette } from '../../design-system/tokens';
import { useDashboardStackStore, DashboardStackEntry } from '../../store/dashboardStackStore';
import {
  buildServerFilters,
  pickLabelField,
  pickXField,
  pickValueField,
  pickTimeBucket,
  rangeToFilter,
  applyValueFormat,
  type CrossFilter,
  type AggregateOptions,
  type AggregateSpec,
} from './queryBuilder';

// ── Cross-widget filter context ───────────────────────────────────────────
interface CrossFilterCtx {
  filter: CrossFilter | null;
  setFilter: (f: CrossFilter | null) => void;
}
const CrossFilterContext = createContext<CrossFilterCtx>({ filter: null, setFilter: () => {} });

// ── Dashboard-level filter bar context ────────────────────────────────────
// The "live" state — what the user has dialed in via the bar at the top of
// the canvas. Initialized from `app.filterBar` defaults at first render.
// Widgets opted into inheritance (default true) read this and use it to
// override their per-widget xAxisRange / time field / row-set filter.
interface DashboardFilterState {
  enabled: boolean;
  timeField?: string;
  range: RangePreset;
  customStart?: string;
  customEnd?: string;
  groupField?: string;
  groupValues: string[];
}
const DashboardFilterContext = createContext<DashboardFilterState>({
  enabled: false,
  range: 'all_time',
  groupValues: [],
});

const ONTOLOGY_API = import.meta.env.VITE_ONTOLOGY_SERVICE_URL || 'http://localhost:8004';
const INFERENCE_API = import.meta.env.VITE_INFERENCE_SERVICE_URL || 'http://localhost:8003';

// ── Data fetching ──────────────────────────────────────────────────────────

// Hard ceiling on the raw-records path. 100M-row tables cannot be paginated
// down to the browser; the only sane raw-records use is "show me a sample".
// Anything that needs full-table semantics has to use /aggregate via the
// query() helper or one of the ServerAgg* widgets.
const RAW_RECORDS_HARD_CAP = 5000;

function useRecords(objectTypeId?: string, maxRecords: number = RAW_RECORDS_HARD_CAP) {
  const [records, setRecords] = useState<Record<string, unknown>[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!objectTypeId) return;
    let cancelled = false;
    setLoading(true);

    const cap = Math.max(1, Math.min(maxRecords, RAW_RECORDS_HARD_CAP));
    const PAGE = Math.min(5000, cap);
    const MAX_CONCURRENCY = 6;

    async function fetchAll() {
      const headers = { 'x-tenant-id': getTenantId() };
      const firstRes = await fetch(
        `${ONTOLOGY_API}/object-types/${objectTypeId}/records?limit=${PAGE}&offset=0`,
        { headers },
      );
      const firstData = await firstRes.json();
      const firstRows: Record<string, unknown>[] = firstData.records || [];
      const rowsTotal: number = firstData.total ?? firstRows.length;

      if (cancelled) return;
      setTotal(rowsTotal);

      // If we've already hit the cap from page 1, or if the table is small
      // enough to fit in one page, we're done.
      if (firstRows.length >= cap || rowsTotal <= firstRows.length) {
        setRecords(firstRows.slice(0, cap));
        return;
      }

      // Walk forward in PAGE-sized steps until we hit `cap` or `rowsTotal`,
      // whichever comes first. NEVER paginate the entire table.
      const stop = Math.min(rowsTotal, cap);
      const offsets: number[] = [];
      for (let off = PAGE; off < stop; off += PAGE) offsets.push(off);

      const buckets: number[][] = Array.from({ length: MAX_CONCURRENCY }, () => []);
      offsets.forEach((off, i) => buckets[i % MAX_CONCURRENCY].push(off));

      const chunks = await Promise.all(
        buckets.map(async (bucket) => {
          const out: Record<string, unknown>[] = [];
          for (const off of bucket) {
            if (cancelled) return out;
            const remaining = cap - (firstRows.length + out.length);
            if (remaining <= 0) break;
            const limit = Math.min(PAGE, remaining);
            const r = await fetch(
              `${ONTOLOGY_API}/object-types/${objectTypeId}/records?limit=${limit}&offset=${off}`,
              { headers },
            );
            const d = await r.json();
            if (Array.isArray(d.records)) out.push(...d.records);
          }
          return out;
        }),
      );

      if (cancelled) return;
      const all = firstRows.concat(...chunks).slice(0, cap);
      setRecords(all);
    }

    fetchAll().catch(() => { if (!cancelled) setRecords([]); }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [objectTypeId, maxRecords]);

  return { records, loading, total };
}

// ── Server-side aggregation hook ──────────────────────────────────────────
// Calls POST /object-types/{id}/aggregate. Returns one or more aggregated
// numbers (and group keys when group_by / time_bucket is set).

interface AggregateRow {
  group: string | null;
  [agg: string]: number | string | null;
}

function useAggregate(objectTypeId: string | undefined, opts: AggregateOptions | null) {
  const [rows, setRows] = useState<AggregateRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [tz] = useTimezone();
  // The user's TZ is part of the cache key so changing it triggers a
  // refetch (server returns different bucket boundaries).
  const key = JSON.stringify({ ...(opts ?? null), __tz: tz });

  useEffect(() => {
    if (!objectTypeId || !opts) { setRows([]); return; }
    let cancelled = false;
    setLoading(true);
    const body = {
      filters: opts.filters ? JSON.stringify(opts.filters) : null,
      group_by: opts.groupBy ?? null,
      time_bucket: opts.timeBucket ?? null,
      aggregations: opts.aggregations,
      sort_by: opts.sortBy ?? null,
      sort_dir: opts.sortDir ?? 'desc',
      limit: opts.limit ?? 200,
      timezone: opts.timezone || tz || null,
    };
    fetch(`${ONTOLOGY_API}/object-types/${objectTypeId}/aggregate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-tenant-id': getTenantId() },
      body: JSON.stringify(body),
    })
      .then((r) => r.ok ? r.json() : { rows: [] })
      .then((d) => { if (!cancelled) setRows(d.rows || []); })
      .catch(() => { if (!cancelled) setRows([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [objectTypeId, key]);

  return { rows, loading };
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

      // Multi-value ops parse the value as a comma-separated list.
      const fvList = (f.operator === 'in' || f.operator === 'not_in')
        ? fv.split(',').map((s) => s.trim()).filter(Boolean)
        : [];

      switch (f.operator) {
        case 'eq':          return str === fv;
        case 'neq':         return str !== fv;
        case 'in':          return fvList.includes(str);
        case 'not_in':      return !fvList.includes(str);
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

const MetricCard: React.FC<{ comp: AppComponent; records?: Record<string, unknown>[]; serverValue?: number | null }> = ({
  comp,
  records,
  serverValue,
}) => {
  const { fireEvent } = useContext(AppContext);
  const value = serverValue != null
    ? applyValueFormat(serverValue, comp)
    : aggregate(records || [], comp.field, comp.aggregation || 'count');
  const drillable = (comp.drillEnabled ?? false);
  return (
    <div
      onClick={drillable ? () => fireEvent?.(comp.id, 'onKpiClick', { value: String(value), field: comp.field }) : undefined}
      style={{
        backgroundColor: '#fff',
        border: '1px solid #E2E8F0',
        borderRadius: 8,
        padding: '20px 24px',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        cursor: drillable ? 'pointer' : 'default',
        transition: 'box-shadow 120ms',
      }}
      onMouseEnter={drillable ? (e) => ((e.currentTarget as HTMLElement).style.boxShadow = '0 2px 8px rgba(124,58,237,0.16)') : undefined}
      onMouseLeave={drillable ? (e) => ((e.currentTarget as HTMLElement).style.boxShadow = 'none') : undefined}
    >
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

const KpiBanner: React.FC<{ comp: AppComponent; records?: Record<string, unknown>[]; serverKpis?: { count: number; avg: number | null } }> = ({
  comp,
  records,
  serverKpis,
}) => {
  const { fireEvent } = useContext(AppContext);
  const recs = records || [];
  const kpis = serverKpis
    ? [
        { label: 'Total Records', value: serverKpis.count.toLocaleString() },
        { label: comp.field ? `Avg ${comp.field}` : 'Fields', value: comp.field && serverKpis.avg != null ? applyValueFormat(serverKpis.avg, comp) : '—' },
        { label: 'Last Updated', value: 'Live' },
      ]
    : [
        { label: 'Total Records', value: recs.length.toLocaleString() },
        { label: comp.field ? `Avg ${comp.field}` : 'Fields', value: comp.field
          ? aggregate(recs, comp.field, 'avg')
          : (recs[0] ? Object.keys(recs[0]).length : 0).toString() },
        { label: 'Last Updated', value: 'Live' },
      ];

  const drillable = (comp.drillEnabled ?? false);
  return (
    <div
      onClick={drillable ? () => fireEvent?.(comp.id, 'onKpiClick', { value: String(kpis[0].value), field: comp.field }) : undefined}
      style={{
        backgroundColor: '#fff',
        border: '1px solid #E2E8F0',
        borderRadius: 8,
        padding: '16px 24px',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        cursor: drillable ? 'pointer' : 'default',
      }}
      onMouseEnter={drillable ? (e) => ((e.currentTarget as HTMLElement).style.boxShadow = '0 2px 8px rgba(124,58,237,0.16)') : undefined}
      onMouseLeave={drillable ? (e) => ((e.currentTarget as HTMLElement).style.boxShadow = 'none') : undefined}
    >
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

const DataTable: React.FC<{
  comp: AppComponent;
  records?: Record<string, unknown>[];
  serverPage?: { rows: Record<string, unknown>[]; total: number; page: number; pageSize: number; loading: boolean };
  onPage?: (next: number) => void;
}> = ({ comp, records, serverPage, onPage }) => {
  const { fireEvent } = useContext(AppContext);
  const useServer = !!serverPage;
  const rows = useServer ? serverPage!.rows : (records || []).slice(0, comp.maxRows || 10);
  const total = useServer ? serverPage!.total : (records || []).length;
  const page = useServer ? serverPage!.page : 0;
  const pageSize = useServer ? serverPage!.pageSize : (comp.maxRows || 10);
  const totalPages = Math.max(1, Math.ceil(total / Math.max(pageSize, 1)));

  const allCols = rows.length > 0 ? Object.keys(rows[0]) : [];
  const cols = comp.columns?.length
    ? comp.columns.filter((c) => rows.some((r) => resolveRaw(r, c) !== undefined) || allCols.length === 0)
    : allCols.filter((c) => !c.endsWith('[]'));

  return (
    <div style={{
      backgroundColor: '#fff', border: '1px solid #E2E8F0', borderRadius: 8,
      overflow: 'hidden', height: '100%', display: 'flex', flexDirection: 'column',
    }}>
      <div style={{
        padding: '12px 16px', borderBottom: '1px solid #E2E8F0',
        fontSize: 13, fontWeight: 600, color: '#0D1117',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      }}>
        <span>{comp.title}</span>
        <span style={{ fontSize: 11, color: '#94A3B8', fontWeight: 400 }}>
          {total.toLocaleString()} records
          {useServer && totalPages > 1 ? ` · page ${page + 1} of ${totalPages}` : ''}
        </span>
      </div>
      <div style={{ flex: 1, overflowY: 'auto', position: 'relative' }}>
        {useServer && serverPage!.loading && (
          <div style={{
            position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
            backgroundColor: 'rgba(255,255,255,0.7)', color: '#94A3B8', fontSize: 12, zIndex: 1,
          }}>Loading…</div>
        )}
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr style={{ backgroundColor: '#F8FAFC', position: 'sticky', top: 0 }}>
              {cols.map((c) => (
                <th key={c} style={{
                  textAlign: 'left', padding: '8px 12px',
                  color: '#64748B', fontWeight: 500,
                  borderBottom: '1px solid #E2E8F0', whiteSpace: 'nowrap',
                }}>{c}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => {
              const drillable = (comp.drillEnabled ?? false);
              return (
                <tr
                  key={i}
                  onClick={drillable ? () => fireEvent?.(comp.id, 'onRowClick', { row }) : undefined}
                  style={{
                    borderBottom: '1px solid #F1F5F9',
                    cursor: drillable ? 'pointer' : 'default',
                  }}
                >
                  {cols.map((c) => {
                    const val = resolveRaw(row, c);
                    return (
                      <td
                        key={c}
                        onClick={drillable ? (e) => {
                          e.stopPropagation();
                          fireEvent?.(comp.id, 'onCellClick', { row, value: String(val ?? ''), field: c });
                        } : undefined}
                        style={{
                          padding: '7px 12px', color: '#374151', maxWidth: 200,
                          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                        }}
                      >
                        {Array.isArray(val) ? `[${(val as unknown[]).length} items]` : String(val ?? '')}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
        {rows.length === 0 && !(useServer && serverPage!.loading) && (
          <div style={{ textAlign: 'center', padding: '32px', color: '#94A3B8', fontSize: 12 }}>
            No records {useServer ? '' : '— run a sync first'}
          </div>
        )}
      </div>
      {useServer && totalPages > 1 && (
        <div style={{
          padding: '8px 12px', borderTop: '1px solid #E2E8F0',
          display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 6, fontSize: 11,
        }}>
          <button
            disabled={page === 0 || serverPage!.loading}
            onClick={() => onPage && onPage(Math.max(0, page - 1))}
            style={{
              padding: '4px 10px', border: '1px solid #E2E8F0', borderRadius: 4,
              background: '#fff', color: page === 0 ? '#CBD5E1' : '#475569',
              cursor: page === 0 ? 'not-allowed' : 'pointer',
            }}
          >Prev</button>
          <button
            disabled={page >= totalPages - 1 || serverPage!.loading}
            onClick={() => onPage && onPage(Math.min(totalPages - 1, page + 1))}
            style={{
              padding: '4px 10px', border: '1px solid #E2E8F0', borderRadius: 4,
              background: '#fff', color: page >= totalPages - 1 ? '#CBD5E1' : '#475569',
              cursor: page >= totalPages - 1 ? 'not-allowed' : 'pointer',
            }}
          >Next</button>
        </div>
      )}
    </div>
  );
};

const BarChart: React.FC<{
  comp: AppComponent;
  records?: Record<string, unknown>[];
  serverRows?: { group: string; value: number }[];
  resolvedLabelField?: string;
}> = ({
  comp,
  records,
  serverRows,
  resolvedLabelField,
}) => {
  const { filter: crossFilter, setFilter: setCrossFilter } = useContext(CrossFilterContext);
  const { fireEvent } = useContext(AppContext);

  // ── Server-side path: trust the precomputed rows ──
  let labelField: string;
  let entries: [string, number][];

  if (serverRows) {
    labelField = resolvedLabelField || comp.labelField || comp.columns?.[0] || '';
    entries = serverRows
      .map((r) => [r.group ?? '(empty)', r.value] as [string, number])
      .slice(0, 15);
  } else {
    const recs = records || [];
    const candidateLabelField = comp.labelField || comp.columns?.[0] || '';
    const allFields = recs.length > 0 ? Object.keys(recs[0]).filter((k) => !k.endsWith('[]')) : [];

    labelField = (() => {
      if (candidateLabelField) {
        const nonEmpty = recs.filter((r) => r[candidateLabelField] != null && r[candidateLabelField] !== '').length;
        if (nonEmpty > 0) return candidateLabelField;
      }
      for (const f of allFields) {
        const vals = new Set(recs.map((r) => String(r[f] ?? '')).filter(Boolean));
        if (vals.size > 1 && vals.size <= recs.length * 0.8) return f;
      }
      return allFields[0] || 'name';
    })();

    const rawValueField = comp.valueField || comp.field || '';
    const useCountMode = (() => {
      if (!rawValueField || rawValueField === labelField) return true;
      if (!recs.length) return true;
      const nums = recs
        .map((r) => parseFloat(String(r[rawValueField] ?? '')))
        .filter((n) => !isNaN(n));
      if (nums.length < recs.length * 0.5) return true;
      const avg = nums.reduce((a, b) => a + b, 0) / nums.length;
      if (avg > 100_000) return true;
      return false;
    })();
    const valueField = useCountMode ? '' : rawValueField;

    const grouped: Record<string, number> = {};
    for (const r of recs) {
      const rawLabel = r[labelField];
      const label = (rawLabel != null && rawLabel !== '' ? String(rawLabel) : '(empty)').slice(0, 40);
      if (valueField) {
        const n = parseFloat(String(r[valueField] ?? 0));
        grouped[label] = (grouped[label] || 0) + (isNaN(n) ? 0 : n);
      } else {
        grouped[label] = (grouped[label] || 0) + 1;
      }
    }

    entries = Object.entries(grouped)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 15);
  }

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
                    fireEvent?.(comp.id, 'onBarClick', { value: label === '(empty)' ? '' : label, field: labelField });
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
                    {applyValueFormat(val, comp)}
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

const LineChart: React.FC<{
  comp: AppComponent;
  records?: Record<string, unknown>[];
  serverPoints?: { x: string; y: number }[];
  serverSeries?: Record<string, { x: string; y: number }[]>;
  resolvedXField?: string;
}> = ({
  comp,
  records,
  serverPoints,
  serverSeries,
  resolvedXField,
}) => {
  const [tz] = useTimezone();
  const recs = records || [];
  const allFields = recs.length > 0 ? Object.keys(recs[0]) : [];

  const resolveField = (configured: string, fallbackTest: (f: string) => boolean) => {
    if (configured && allFields.includes(configured)) return configured;
    const norm = (s: string) => s.toLowerCase().replace(/_/g, '');
    const fuzzy = allFields.find((f) => norm(f) === norm(configured));
    if (fuzzy) return fuzzy;
    return allFields.find(fallbackTest) || '';
  };

  const xField = resolvedXField || resolveField(
    comp.xField || comp.labelField || '',
    (f) => /date|time|_at|modified|created/i.test(f),
  );

  let points: { x: string; y: number }[];
  if (serverPoints) {
    points = serverPoints.slice(-20);
  } else {
    const rawYField = comp.valueField || comp.field || '';
    const useCountMode = (() => {
      if (!rawYField || rawYField === xField) return true;
      const resolved = resolveField(rawYField, () => false);
      if (!resolved) return true;
      const nums = recs.map((r) => parseFloat(String(r[resolved] ?? ''))).filter((n) => !isNaN(n));
      if (nums.length < recs.length * 0.3) return true;
      if (nums.reduce((a, b) => a + b, 0) / Math.max(nums.length, 1) > 100_000) return true;
      return false;
    })();
    const yField = useCountMode ? '' : resolveField(rawYField, () => false);

    points = (() => {
      if (!xField) return [];
      if (useCountMode) {
        const weekly: Record<string, number> = {};
        for (const r of recs) {
          const rawVal = resolveRaw(r, xField);
          const { date: parsedDate } = coerce(rawVal);
          const raw = parsedDate ? parsedDate.toISOString().slice(0, 10) : String(rawVal ?? '').slice(0, 10);
          if (!raw || raw === 'undefined') continue;
          const d = new Date(raw);
          if (isNaN(d.getTime())) continue;
          const day = d.getDay();
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
      return recs
        .filter((r) => r[xField] !== undefined && r[yField] !== undefined)
        .sort((a, b) => String(a[xField]).localeCompare(String(b[xField])))
        .slice(0, 20)
        .map((r) => ({
          x: String(r[xField] ?? '').slice(0, 10),
          y: parseFloat(String(r[yField] ?? 0)) || 0,
        }));
    })();
  }

  // Multi-series rendering: if serverSeries was provided, draw one line per
  // series, share an x-axis, color via chartPalette.
  const seriesEntries: [string, { x: string; y: number }[]][] = serverSeries
    ? Object.entries(serverSeries).slice(0, 8) // safety cap on series count
    : [['__single', points]];

  const allXs = Array.from(new Set(seriesEntries.flatMap(([, arr]) => arr.map((p) => p.x)))).sort();
  const xIndex = new Map(allXs.map((x, i) => [x, i] as const));
  const allY = seriesEntries.flatMap(([, arr]) => arr.map((p) => p.y));
  const maxY = Math.max(...allY, 1);
  const W = 400, H = 160, pad = { top: 10, right: 10, bottom: serverSeries ? 38 : 24, left: 40 };
  const innerW = W - pad.left - pad.right;
  const innerH = H - pad.top - pad.bottom;

  const toX = (i: number) => pad.left + (i / Math.max(allXs.length - 1, 1)) * innerW;
  const toY = (v: number) => pad.top + innerH - (v / maxY) * innerH;

  const pathFor = (arr: { x: string; y: number }[]) =>
    arr
      .map((p, i) => {
        const ix = xIndex.get(p.x);
        if (ix === undefined) return null;
        return `${i === 0 ? 'M' : 'L'} ${toX(ix)} ${toY(p.y)}`;
      })
      .filter(Boolean)
      .join(' ');

  const isEmpty = serverSeries ? Object.keys(serverSeries).length === 0 : points.length < 2;

  return (
    <div style={{
      backgroundColor: '#fff', border: '1px solid #E2E8F0', borderRadius: 8,
      overflow: 'hidden', height: '100%', display: 'flex', flexDirection: 'column',
    }}>
      <div style={{ padding: '12px 16px', borderBottom: '1px solid #E2E8F0', fontSize: 13, fontWeight: 600, color: '#0D1117' }}>
        {comp.title}
      </div>
      <div style={{ flex: 1, padding: '8px 16px', overflowX: 'auto' }}>
        {isEmpty ? (
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
                    {applyValueFormat(maxY * t, comp)}
                  </text>
                </g>
              );
            })}
            {/* Lines (one per series) + dots */}
            {seriesEntries.map(([name, arr], si) => {
              const color = chartPalette[si % chartPalette.length];
              return (
                <g key={name}>
                  <path d={pathFor(arr)} fill="none" stroke={color} strokeWidth={2} />
                  {arr.map((p, i) => {
                    const ix = xIndex.get(p.x);
                    if (ix === undefined) return null;
                    return <circle key={i} cx={toX(ix)} cy={toY(p.y)} r={3} fill={color} />;
                  })}
                </g>
              );
            })}
            {/* X labels — formatted by data span. ISO timestamps stay as
                YYYY-MM-DD when they span > 24h, or HH:MM when sub-hour /
                same-day, or MM-DD HH:MM in between. Keeps charts readable
                whether you're looking at a year of monthly buckets or 60
                seconds of 1-second buckets. */}
            {(() => {
              const formatLabel = (x: string): string => {
                if (x.length < 13) return x;             // already short (date-only)
                // All formatting goes through the user's TZ — server may
                // bucket by UTC or by user TZ depending on the request,
                // but display should always be the user's chosen zone.
                const dateInTz = (s: string) => formatInTz(s, tz, 'date');
                const days = new Set(allXs.map(dateInTz)).size;
                if (days <= 1) return formatInTz(x, tz, 'time').slice(0, 5); // HH:MM
                if (days <= 14) return formatInTz(x, tz, 'short');           // MM/DD HH:MM
                return formatInTz(x, tz, 'date');                            // YYYY-MM-DD
              };
              return allXs.filter((_, i) => i % Math.max(1, Math.floor(allXs.length / 5)) === 0).map((x, i) => {
                const idx = i * Math.max(1, Math.floor(allXs.length / 5));
                return (
                  <text key={i} x={toX(idx)} y={pad.top + innerH + 14} textAnchor="middle" fontSize={8} fill="#94A3B8">
                    {formatLabel(x)}
                  </text>
                );
              });
            })()}
            {/* Series legend (multi-series only) */}
            {serverSeries && seriesEntries.map(([name], si) => (
              <g key={`l-${name}`} transform={`translate(${pad.left + si * 70}, ${H - 8})`}>
                <rect width={8} height={8} rx={1} fill={chartPalette[si % chartPalette.length]} />
                <text x={11} y={7} fontSize={8} fill="#475569">{name.slice(0, 12)}</text>
              </g>
            ))}
          </svg>
        )}
      </div>
    </div>
  );
};

// ── Pie / Donut Chart ────────────────────────────────────────────────────
const PieChartWidget: React.FC<{
  comp: AppComponent;
  records?: Record<string, unknown>[];
  serverRows?: { group: string; value: number }[];
  resolvedLabelField?: string;
}> = ({ comp, records, serverRows, resolvedLabelField }) => {
  const { filter: crossFilter, setFilter: setCrossFilter } = useContext(CrossFilterContext);
  const { fireEvent } = useContext(AppContext);
  const recs = records || [];
  const labelField = resolvedLabelField || comp.labelField || (recs.length ? Object.keys(recs[0])[0] : 'name');

  let entries: [string, number][];
  if (serverRows) {
    entries = serverRows.map((r) => [(r.group ?? '(empty)').slice(0, 30), r.value] as [string, number]).slice(0, 12);
  } else {
    const valueField = comp.valueField || '';
    const grouped: Record<string, number> = {};
    for (const r of recs) {
      const label = (r[labelField] != null && r[labelField] !== '' ? String(r[labelField]) : '(empty)').slice(0, 30);
      if (valueField) {
        const n = parseFloat(String(r[valueField] ?? 0));
        grouped[label] = (grouped[label] || 0) + (isNaN(n) ? 0 : n);
      } else {
        grouped[label] = (grouped[label] || 0) + 1;
      }
    }
    entries = Object.entries(grouped).sort((a, b) => b[1] - a[1]).slice(0, 12);
  }
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
                      fireEvent?.(comp.id, 'onBarClick', { value: a.label === '(empty)' ? '' : a.label, field: labelField });
                    }}
                  >
                    <title>{a.label}: {applyValueFormat(a.val, comp)} ({a.pct}%)</title>
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
const AreaChartWidget: React.FC<{
  comp: AppComponent;
  records?: Record<string, unknown>[];
  serverPoints?: { x: string; y: number }[];
}> = ({ comp, records, serverPoints }) => {
  const recs = records || [];
  const allFields = recs.length > 0 ? Object.keys(recs[0]) : [];
  const xField = comp.xField || allFields.find(f => /date|time|created|updated/i.test(f)) || allFields[0] || '';
  const valueField = comp.valueField || allFields.find(f => /count|amount|value|total|price|revenue/i.test(f)) || '';
  const groupField = comp.labelField || '';

  let buckets: Record<string, Record<string, number>>;

  if (serverPoints) {
    // Server returned a single time series (no multi-series support yet).
    buckets = {};
    for (const p of serverPoints) {
      const key = (p.x || '').slice(0, 7); // YYYY-MM
      if (!key) continue;
      if (!buckets[key]) buckets[key] = {};
      buckets[key]['value'] = (buckets[key]['value'] || 0) + p.y;
    }
  } else {
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

    buckets = {};
    for (const r of recs) {
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
                <text x={padL - 4} y={y + 3} textAnchor="end" fontSize={8} fill="#94A3B8">{applyValueFormat(maxVal * pct, comp)}</text>
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
const StatCard: React.FC<{
  comp: AppComponent;
  records?: Record<string, unknown>[];
  serverStat?: { current: number; recent?: number | null; prior?: number | null };
}> = ({ comp, records, serverStat }) => {
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

  const currentVal = serverStat ? serverStat.current : computeValue(records || []);

  // Compute trend if dateField is set — compare last 30 days vs prior 30 days
  let trendPct: number | null = null;
  let trendDirection: 'up' | 'down' | 'flat' = 'flat';
  if (serverStat && serverStat.recent != null && serverStat.prior != null) {
    if (serverStat.prior > 0) {
      trendPct = ((serverStat.recent - serverStat.prior) / serverStat.prior) * 100;
      trendDirection = trendPct > 1 ? 'up' : trendPct < -1 ? 'down' : 'flat';
    }
  } else if (!serverStat && dateField && records && records.length > 0) {
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
    // Honor user value-format if any field is set; otherwise the previous
    // K/M abbreviator stays so existing dashboards don't visually change.
    const hasFormat = comp.valueMultiplier != null
      || comp.valueDecimals != null
      || comp.valueUnit != null;
    if (hasFormat) return applyValueFormat(v, comp);
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

const FilterBar: React.FC<{
  comp: AppComponent;
  records?: Record<string, unknown>[];
  serverValues?: string[];
}> = ({ comp, records, serverValues }) => {
  const [search, setSearch] = React.useState('');
  const filterField = comp.filterField || comp.columns?.[0] || '';
  const uniqueValues = serverValues
    ? serverValues.slice(0, 20)
    : Array.from(
        new Set((records || []).map((r) => String(r[filterField] ?? '')).filter(Boolean))
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

/**
 * Custom-code widget — Claude-generated JS body that returns a React tree.
 *
 * Two data paths the user code can use:
 *   1. `records` (existing) — already-paginated array of raw rows. Capped
 *      by `useRecords`; safe up to ~50–100k rows; do not use on a 100M-row
 *      object type.
 *   2. `query(opts)` (new) — server-side aggregation, scales to any size.
 *      Synchronous to call (uses React hooks under the hood); returns
 *      { rows, loading, error }. Re-runs whenever `opts` changes.
 *
 * `query` rules:
 *   - Call it at the TOP of your code, the same number of times on every
 *     render (it uses hooks). Never inside if/else.
 *   - opts: { groupBy, timeBucket, aggregations, filters, sortBy, sortDir, limit }
 */
const CustomCodeWidget: React.FC<{ comp: AppComponent; records: Record<string, unknown>[]; recordsTotal?: number }> = ({ comp, records, recordsTotal }) => {
  const fields = records.length > 0 ? Object.keys(records[0]) : [];
  // True row count in the database (not just what was sampled). Lets user
  // code know whether `records` is the whole dataset or a 5k-row sample.
  const totalCount = typeof recordsTotal === 'number' ? recordsTotal : records.length;
  const isSampled = totalCount > records.length;

  const tenantId = getTenantId();
  const objectTypeId = comp.objectTypeId;

  // Closure-captured query helper — uses hooks, so the user code must follow
  // the rules of hooks. Each call adds a useState + useEffect to this widget.
  // Defensive against AI-generated code that passes malformed opts:
  //   - aggregations defaults to [{method: 'count'}] if missing or empty
  //   - each aggregation is normalized: method defaults to 'count', stray
  //     undefined fields are stripped
  //   - on 4xx, surface FastAPI's `detail` field in the error message so the
  //     user-supplied code (or its writer) can see what's wrong
  const query = (opts: AggregateOptions) => {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    const [state, setState] = React.useState<{
      rows: Record<string, unknown>[]; loading: boolean; error: string | null;
    }>({ rows: [], loading: true, error: null });

    const safeOpts = opts || ({} as AggregateOptions);
    const rawAggs = Array.isArray(safeOpts.aggregations) ? safeOpts.aggregations : [];
    const aggregations = (rawAggs.length > 0 ? rawAggs : [{ method: 'count' as const }])
      .map((a) => {
        const out: { field?: string; method: string } = { method: a?.method || 'count' };
        if (a && typeof a.field === 'string' && a.field.trim()) out.field = a.field.trim();
        return out;
      });

    const key = JSON.stringify({ ot: objectTypeId, ...safeOpts, aggregations });

    // eslint-disable-next-line react-hooks/rules-of-hooks
    React.useEffect(() => {
      if (!objectTypeId) {
        setState({ rows: [], loading: false, error: 'No objectTypeId set on this widget' });
        return;
      }
      let cancelled = false;
      setState({ rows: [], loading: true, error: null });
      const body: Record<string, unknown> = { aggregations };
      if (safeOpts.filters && Object.keys(safeOpts.filters).length) body.filters = JSON.stringify(safeOpts.filters);
      if (safeOpts.groupBy) body.group_by = safeOpts.groupBy;
      if (safeOpts.timeBucket && safeOpts.timeBucket.field && safeOpts.timeBucket.interval) {
        body.time_bucket = { field: safeOpts.timeBucket.field, interval: safeOpts.timeBucket.interval };
      }
      if (safeOpts.sortBy) body.sort_by = safeOpts.sortBy;
      if (safeOpts.sortDir) body.sort_dir = safeOpts.sortDir;
      if (safeOpts.limit) body.limit = safeOpts.limit;

      fetch(`${ONTOLOGY_API}/object-types/${objectTypeId}/aggregate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-tenant-id': tenantId },
        body: JSON.stringify(body),
      })
        .then(async (r) => {
          if (r.ok) return r.json();
          // Try to surface FastAPI's structured error so the user knows what failed
          let detail: string;
          try {
            const j = await r.json();
            detail = typeof j.detail === 'string' ? j.detail : JSON.stringify(j.detail);
          } catch {
            detail = await r.text().catch(() => '');
          }
          throw new Error(`status ${r.status}${detail ? ': ' + detail : ''}`);
        })
        .then((d) => { if (!cancelled) setState({ rows: d.rows || [], loading: false, error: null }); })
        .catch((e) => { if (!cancelled) setState({ rows: [], loading: false, error: e instanceof Error ? e.message : String(e) }); });
      return () => { cancelled = true; };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [key]);
    return state;
  };

  if (!comp.code) {
    return (
      <div style={{ padding: 16, color: '#94A3B8', fontSize: 12 }}>No code provided.</div>
    );
  }
  try {
    // eslint-disable-next-line no-new-func
    const fn = new Function('React', 'records', 'fields', 'title', 'query', 'total', 'isSampled', comp.code);
    const result = fn(React, records, fields, comp.title, query, totalCount, isSampled);
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

const ChatWidget: React.FC<{ comp: AppComponent; records: Record<string, unknown>[]; allComponents?: AppComponent[] }> = ({
  comp, allComponents,
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
      // Build dashboard widget context — only selected widgets or all non-chat siblings
      const sourceWidgetIds = comp.widgetSourceIds;
      const widgetContext = (allComponents || [])
        .filter(c => c.id !== comp.id && c.type !== 'chat-widget')
        .filter(c => !sourceWidgetIds?.length || sourceWidgetIds.includes(c.id))
        .map(c => ({
          type: c.type,
          title: c.title,
          field: c.field,
          aggregation: c.aggregation,
          labelField: c.labelField,
          valueField: c.valueField,
          columns: c.columns,
          filterField: c.filterField,
          objectTypeId: c.objectTypeId,
        }));

      // Support multiple object type IDs
      const otIds = comp.objectTypeIds?.length
        ? comp.objectTypeIds
        : comp.objectTypeId ? [comp.objectTypeId] : [];

      const res = await fetch(`${INFERENCE_API}/infer/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question: q,
          object_type_id: otIds[0] || '',
          object_type_ids: otIds,
          object_type_name: comp.title || 'Data',
          tenant_id: getTenantId(),
          dashboard_widgets: widgetContext.length > 0 ? widgetContext : undefined,
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

  // Static options from config, OR distinct values fetched from server (group_by + count).
  // We never paginate the full record set just to build a dropdown.
  const dynamicField = comp.filterField || comp.labelField || '';
  const useStatic = (comp.options && comp.options.length > 0) || !comp.objectTypeId || !dynamicField;
  const aggregateOpts: AggregateOptions | null = useStatic
    ? null
    : { groupBy: dynamicField, aggregations: [{ method: 'count' }], sortBy: 'agg_0', sortDir: 'desc', limit: 200 };
  const { rows: distinctRows } = useAggregate(useStatic ? undefined : comp.objectTypeId, aggregateOpts);

  const opts: string[] = useStatic
    ? (comp.options || [])
    : distinctRows.map((r) => String(r.group ?? '')).filter(Boolean).sort();

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

// RecordSelectField — fetches records from the configured object type and
// renders them as a dropdown. Each option's label = record[displayField]
// (defaults to 'name'), value = record.id. Used by form, record-creator,
// and object-editor widgets when a field's type is 'record-select'.
//
// Fetch is capped at 200 records — for object types with more, swap to a
// search-as-you-type variant later.
const RecordSelectField: React.FC<{
  recordTypeId?: string;
  displayField?: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}> = ({ recordTypeId, displayField, value, onChange, placeholder }) => {
  const [records, setRecords] = useState<Array<{ id: string; label: string }>>([]);
  const [error, setError] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(false);

  useEffect(() => {
    if (!recordTypeId) { setRecords([]); return; }
    let cancelled = false;
    setLoading(true);
    setError('');
    const field = displayField || 'name';
    fetch(`${ONTOLOGY_API}/object-types/${recordTypeId}/records?limit=200`, {
      headers: { 'x-tenant-id': getTenantId() },
    })
      .then((r) => r.ok ? r.json() : Promise.reject(`HTTP ${r.status}`))
      .then((data) => {
        if (cancelled) return;
        const rows: Record<string, unknown>[] = Array.isArray(data) ? data : (data.records || []);
        const opts = rows.map((row) => {
          const id = String(row.id ?? row.source_id ?? '');
          const labelRaw = row[field] ?? row.name ?? id;
          return { id, label: String(labelRaw || id) };
        }).filter((o) => o.id);
        setRecords(opts);
      })
      .catch((e) => {
        if (!cancelled) setError(typeof e === 'string' ? e : 'Failed to load records');
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [recordTypeId, displayField]);

  if (!recordTypeId) {
    return (
      <div style={{ fontSize: 11, color: '#94A3B8', fontStyle: 'italic' }}>
        Pick an object type for this field in the editor.
      </div>
    );
  }

  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      style={{
        width: '100%', height: 30, padding: '0 8px', border: '1px solid #CBD5E1',
        borderRadius: 4, fontSize: 12, color: '#0D1117', boxSizing: 'border-box',
        outline: 'none', backgroundColor: '#fff',
      }}
    >
      <option value="">{loading ? 'Loading…' : (placeholder || '— select —')}</option>
      {records.map((r) => (
        <option key={r.id} value={r.id}>{r.label}</option>
      ))}
      {error && <option value="" disabled>{error}</option>}
    </select>
  );
};

const FormWidget: React.FC<{ comp: AppComponent }> = ({ comp }) => {
  const formFields = comp.fields || [];
  const { actions } = useContext(AppContext);
  const [values, setValues] = useState<Record<string, any>>({});
  const [submitting, setSubmitting] = useState(false);
  const [status, setStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState('');

  // Phase H — actionId is the new typed reference; actionName is the legacy
  // free-string. Prefer actionId when set, fall back to actionName so
  // existing forms keep working.
  const boundAction = comp.actionId ? actions.find((a) => a.id === comp.actionId) : null;

  const handleSubmit = async () => {
    if (!comp.actionId && !comp.actionName) return;
    setSubmitting(true);
    setStatus('idle');
    setErrorMsg('');

    if (boundAction) {
      const err = validateActionInput(boundAction, values);
      if (err) {
        setStatus('error'); setErrorMsg(err); setSubmitting(false);
        return;
      }
      const result = await runAppAction(boundAction, { formValues: values });
      if (result.ok) {
        setStatus('success');
        setTimeout(() => setStatus('idle'), 3000);
        setValues({});
      } else {
        setStatus('error'); setErrorMsg(result.error || 'Error');
      }
      setSubmitting(false);
      return;
    }

    // Legacy actionName path — POST to the standalone action runner.
    try {
      const res = await fetch(`${ONTOLOGY_API}/actions/${comp.actionName}/run`, {
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
          ) : f.type === 'select' ? (
            <select
              value={values[f.name] ?? ''}
              onChange={(e) => setValues((v) => ({ ...v, [f.name]: e.target.value }))}
              style={{
                width: '100%', height: 30, padding: '0 8px', border: '1px solid #E2E8F0',
                borderRadius: 4, fontSize: 12, color: '#0D1117', boxSizing: 'border-box',
                outline: 'none', backgroundColor: '#fff',
              }}
            >
              <option value="">— select —</option>
              {(f.options || []).map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
          ) : f.type === 'record-select' ? (
            <RecordSelectField
              recordTypeId={f.recordTypeId}
              displayField={f.recordDisplayField}
              value={values[f.name] ?? ''}
              onChange={(v) => setValues((vs) => ({ ...vs, [f.name]: v }))}
            />
          ) : (
            <input
              type={f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : 'text'}
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
      {(comp.actionId || comp.actionName) && (
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
          {submitting ? 'Submitting...' : (boundAction?.name || 'Submit')}
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

// Widgets that can be served by /aggregate or paginated /records — they should
// never paginate the full record set down. The contract: no client-side
// computation over raw rows; the browser only ever sees query results.
const SERVER_AGG_TYPES = new Set([
  'metric-card', 'kpi-banner', 'stat-card',
  'bar-chart', 'pie-chart', 'line-chart', 'area-chart',
  'pivot-table',
  'filter-bar',
]);

const SERVER_PAGINATED_TYPES = new Set(['data-table']);

const ServerAggMetricCard: React.FC<{ comp: AppComponent; serverFilters?: Record<string, unknown> }> = ({ comp, serverFilters }) => {
  const { rows, loading } = useAggregate(comp.objectTypeId, {
    aggregations: [{ field: comp.aggregation === 'count' ? undefined : comp.field, method: comp.aggregation || 'count' }],
    filters: serverFilters,
    limit: 1,
  });
  if (loading) return <LoadingTile />;
  const v = rows[0]?.agg_0;
  return <MetricCard comp={comp} serverValue={typeof v === 'number' ? v : null} />;
};

const ServerAggKpiBanner: React.FC<{ comp: AppComponent; serverFilters?: Record<string, unknown> }> = ({ comp, serverFilters }) => {
  const aggregations: AggregateSpec[] = [{ method: 'count' }];
  if (comp.field) aggregations.push({ field: comp.field, method: 'avg' });
  const { rows, loading } = useAggregate(comp.objectTypeId, {
    aggregations,
    filters: serverFilters,
    limit: 1,
  });
  if (loading) return <LoadingTile />;
  const r = rows[0] || {};
  const count = typeof r.agg_0 === 'number' ? r.agg_0 : 0;
  const avg = typeof r.agg_1 === 'number' ? r.agg_1 : null;
  return <KpiBanner comp={comp} serverKpis={{ count, avg }} />;
};

const ServerAggStatCard: React.FC<{ comp: AppComponent; serverFilters?: Record<string, unknown> }> = ({ comp, serverFilters }) => {
  const method = (comp.aggregation || 'count') as AggregateSpec['method'];
  const baseAgg: AggregateSpec = { field: method === 'count' ? undefined : comp.field, method };
  const { rows: currentRows, loading: l1 } = useAggregate(comp.objectTypeId, {
    aggregations: [baseAgg],
    filters: serverFilters,
    limit: 1,
  });

  // Period comparison via comparisonField if configured
  const dateField = comp.comparisonField;
  const now = Date.now();
  const d30 = 30 * 86400000;
  const recentSince = new Date(now - d30).toISOString();
  const priorSince = new Date(now - d30 * 2).toISOString();
  const priorBefore = new Date(now - d30).toISOString();

  const recentFilters = dateField ? { ...(serverFilters || {}), [dateField]: { $gte: recentSince } } : null;
  const priorFilters = dateField ? { ...(serverFilters || {}), [dateField]: { $gte: priorSince, $lte: priorBefore } } : null;

  const { rows: recentRows, loading: l2 } = useAggregate(
    dateField ? comp.objectTypeId : undefined,
    recentFilters ? { aggregations: [baseAgg], filters: recentFilters as Record<string, unknown>, limit: 1 } : null,
  );
  const { rows: priorRows, loading: l3 } = useAggregate(
    dateField ? comp.objectTypeId : undefined,
    priorFilters ? { aggregations: [baseAgg], filters: priorFilters as Record<string, unknown>, limit: 1 } : null,
  );

  if (l1 || l2 || l3) return <LoadingTile />;
  const current = (currentRows[0]?.agg_0 as number | undefined) ?? 0;
  const recent = (recentRows[0]?.agg_0 as number | undefined) ?? null;
  const prior = (priorRows[0]?.agg_0 as number | undefined) ?? null;
  return <StatCard comp={comp} serverStat={{ current, recent, prior }} />;
};

const LoadingTile: React.FC = () => (
  <div style={{
    backgroundColor: '#fff', border: '1px solid #E2E8F0', borderRadius: 8,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    height: '100%', color: '#94A3B8', fontSize: 12,
  }}>
    Loading…
  </div>
);

// Server-side BarChart: groupBy + agg method, returns up to 50 groups.
const ServerAggBarChart: React.FC<{ comp: AppComponent; serverFilters?: Record<string, unknown> }> = ({ comp, serverFilters }) => {
  const labelField = pickLabelField(comp);
  const valueField = pickValueField(comp);
  const method = (comp.aggregation || (valueField ? 'sum' : 'count')) as AggregateSpec['method'];
  const aggSpec: AggregateSpec = { field: method === 'count' ? undefined : valueField, method };
  if (method === 'runtime' && comp.tsField) aggSpec.ts_field = comp.tsField;
  const { rows, loading } = useAggregate(comp.objectTypeId, {
    groupBy: labelField,
    aggregations: [aggSpec],
    filters: serverFilters,
    sortBy: 'agg_0',
    sortDir: 'desc',
    limit: 50,
  });
  if (loading) return <LoadingTile />;
  const serverRows = rows.map((r) => ({
    group: String(r.group ?? '(empty)'),
    value: typeof r.agg_0 === 'number' ? r.agg_0 : 0,
  }));
  return <BarChart comp={comp} serverRows={serverRows} resolvedLabelField={labelField} />;
};

// Server-side PieChart: same shape as BarChart, smaller slice limit.
const ServerAggPieChart: React.FC<{ comp: AppComponent; serverFilters?: Record<string, unknown> }> = ({ comp, serverFilters }) => {
  const labelField = pickLabelField(comp);
  const valueField = pickValueField(comp);
  const method = valueField ? 'sum' : 'count';
  const { rows, loading } = useAggregate(comp.objectTypeId, {
    groupBy: labelField,
    aggregations: [{ field: valueField, method }],
    filters: serverFilters,
    sortBy: 'agg_0',
    sortDir: 'desc',
    limit: 30,
  });
  if (loading) return <LoadingTile />;
  const serverRows = rows.map((r) => ({
    group: String(r.group ?? '(empty)'),
    value: typeof r.agg_0 === 'number' ? r.agg_0 : 0,
  }));
  return <PieChartWidget comp={comp} serverRows={serverRows} resolvedLabelField={labelField} />;
};

// Server-side LineChart: time-bucketed sum/count of valueField over xField.
// If `labelField` is set AND differs from `xField`, runs as multi-series:
// the response groups by labelField AND time bucket, so we get one line per
// labelField value (e.g. one line per sensor / metric_type).
const ServerAggLineChart: React.FC<{ comp: AppComponent; serverFilters?: Record<string, unknown> }> = ({ comp, serverFilters }) => {
  const [tz] = useTimezone();
  const xField = pickXField(comp);
  const valueField = pickValueField(comp);
  const method = comp.aggregation || (valueField ? 'sum' : 'count');
  const interval = pickTimeBucket(comp);
  const labelField = comp.labelField && comp.labelField !== xField ? comp.labelField : undefined;
  // Merge the user's filter list with the time-range preset (last_24h etc.)
  const rangeFilter = rangeToFilter(comp.xAxisRange, xField, comp.xAxisCustomStart, comp.xAxisCustomEnd, tz);
  const mergedFilters = rangeFilter
    ? { ...(serverFilters || {}), ...rangeFilter }
    : serverFilters;
  const { rows, loading } = useAggregate(comp.objectTypeId, {
    groupBy: labelField,
    timeBucket: { field: xField, interval },
    aggregations: [{ field: valueField, method: method as AggregateSpec['method'] }],
    filters: mergedFilters,
    sortBy: 'group',
    sortDir: 'asc',
    limit: labelField ? 1000 : 200,
  });
  if (loading) return <LoadingTile />;

  if (labelField) {
    // Multi-series: each row is { group: <bucket>, series: <label>, agg_0: <value> }.
    // Pivot into per-series point arrays for the renderer.
    // KEEP the full bucket key — slicing to 10 chars (YYYY-MM-DD) was
    // collapsing 24 hourly buckets into one daily bucket per day.
    const seriesMap: Record<string, { x: string; y: number }[]> = {};
    for (const r of rows) {
      if (r.group == null) continue;
      const seriesKey = String((r as Record<string, unknown>).series ?? 'value');
      const x = String(r.group);
      const y = typeof r.agg_0 === 'number' ? r.agg_0 : 0;
      (seriesMap[seriesKey] ||= []).push({ x, y });
    }
    return <LineChart comp={comp} serverSeries={seriesMap} resolvedXField={xField} />;
  }

  const serverPoints = rows
    .filter((r) => r.group != null)
    .map((r) => ({
      x: String(r.group),
      y: typeof r.agg_0 === 'number' ? r.agg_0 : 0,
    }));
  return <LineChart comp={comp} serverPoints={serverPoints} resolvedXField={xField} />;
};

const ServerAggAreaChart: React.FC<{ comp: AppComponent; serverFilters?: Record<string, unknown> }> = ({ comp, serverFilters }) => {
  const [tz] = useTimezone();
  const xField = pickXField(comp);
  const valueField = pickValueField(comp);
  const method = comp.aggregation || (valueField ? 'sum' : 'count');
  const interval = pickTimeBucket(comp);
  const labelField = comp.labelField && comp.labelField !== xField ? comp.labelField : undefined;
  const rangeFilter = rangeToFilter(comp.xAxisRange, xField, comp.xAxisCustomStart, comp.xAxisCustomEnd, tz);
  const mergedFilters = rangeFilter
    ? { ...(serverFilters || {}), ...rangeFilter }
    : serverFilters;
  const { rows, loading } = useAggregate(comp.objectTypeId, {
    groupBy: labelField,
    timeBucket: { field: xField, interval },
    aggregations: [{ field: valueField, method: method as AggregateSpec['method'] }],
    filters: mergedFilters,
    sortBy: 'group',
    sortDir: 'asc',
    limit: labelField ? 1000 : 200,
  });
  if (loading) return <LoadingTile />;

  if (labelField) {
    const flat = rows
      .filter((r) => r.group != null)
      .map((r) => ({
        x: String(r.group),
        y: typeof r.agg_0 === 'number' ? r.agg_0 : 0,
      }));
    return <AreaChartWidget comp={comp} serverPoints={flat} />;
  }

  const serverPoints = rows
    .filter((r) => r.group != null)
    .map((r) => ({
      x: String(r.group),
      y: typeof r.agg_0 === 'number' ? r.agg_0 : 0,
    }));
  return <AreaChartWidget comp={comp} serverPoints={serverPoints} />;
};

const ServerAggFilterBar: React.FC<{ comp: AppComponent; serverFilters?: Record<string, unknown> }> = ({ comp, serverFilters }) => {
  const filterField = comp.filterField || comp.columns?.[0] || '';
  const opts: AggregateOptions | null = filterField
    ? { groupBy: filterField, aggregations: [{ method: 'count' }], sortBy: 'agg_0', sortDir: 'desc', filters: serverFilters, limit: 50 }
    : null;
  const { rows } = useAggregate(filterField ? comp.objectTypeId : undefined, opts);
  const values = rows.map((r) => String(r.group ?? '')).filter(Boolean);
  return <FilterBar comp={comp} serverValues={values} />;
};

// Hook: paginated server-side records fetch — for data-table (one page at a time).
function useRecordsPage(
  objectTypeId: string | undefined,
  filters: Record<string, unknown> | undefined,
  page: number,
  pageSize: number,
) {
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const filtersKey = JSON.stringify(filters ?? null);

  useEffect(() => {
    if (!objectTypeId) { setRows([]); setTotal(0); return; }
    let cancelled = false;
    setLoading(true);
    const params = new URLSearchParams({ limit: String(pageSize), offset: String(page * pageSize) });
    if (filters) params.set('filter', JSON.stringify(filters));
    fetch(`${ONTOLOGY_API}/object-types/${objectTypeId}/records?${params}`, {
      headers: { 'x-tenant-id': getTenantId() },
    })
      .then((r) => r.ok ? r.json() : { records: [], total: 0 })
      .then((d) => {
        if (!cancelled) {
          setRows(d.records || []);
          setTotal(d.total ?? 0);
        }
      })
      .catch(() => { if (!cancelled) { setRows([]); setTotal(0); } })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [objectTypeId, filtersKey, page, pageSize]);

  return { rows, total, loading };
}

const ServerPaginatedDataTable: React.FC<{ comp: AppComponent; serverFilters?: Record<string, unknown> }> = ({ comp, serverFilters }) => {
  const [page, setPage] = useState(0);
  const pageSize = comp.pageSize || comp.maxRows || 50;
  const { rows, total, loading } = useRecordsPage(comp.objectTypeId, serverFilters, page, pageSize);
  return (
    <DataTable
      comp={comp}
      serverPage={{ rows, total, page, pageSize, loading }}
      onPage={setPage}
    />
  );
};

// PivotTable widget — true 2D pivot. Rows = labelField (e.g. sensor_name),
// Columns = time-bucketed xField (e.g. day), Cells = aggregated value.
// Single /aggregate POST → ≤ rows×cols numbers → rendered as an HTML table.
// Solves the common "X by Y by Z" question without the AI having to write
// fragile custom-code pivots.
const ServerPivotTable: React.FC<{ comp: AppComponent; serverFilters?: Record<string, unknown> }> = ({ comp, serverFilters }) => {
  const [tz] = useTimezone();
  const labelField = comp.labelField || 'sensor_name';
  const xField = pickXField(comp);
  const valueField = pickValueField(comp);
  const interval = pickTimeBucket(comp);
  const method = comp.aggregation || (valueField ? 'sum' : 'count');
  const rangeFilter = rangeToFilter(comp.xAxisRange, xField, comp.xAxisCustomStart, comp.xAxisCustomEnd, tz);
  const mergedFilters = rangeFilter ? { ...(serverFilters || {}), ...rangeFilter } : serverFilters;
  const aggSpec: AggregateSpec = { field: valueField, method: method as AggregateSpec['method'] };
  if (method === 'runtime' && comp.tsField) aggSpec.ts_field = comp.tsField;
  const { rows, loading } = useAggregate(comp.objectTypeId, {
    groupBy: labelField,
    timeBucket: { field: xField, interval },
    aggregations: [aggSpec],
    filters: mergedFilters,
    sortBy: 'group',
    sortDir: 'asc',
    limit: 5000,
  });

  if (loading) return <LoadingTile />;

  // Pivot the {group: <bucket>, series: <label>, agg_0: <value>} rows
  // into rowKeys × colKeys → cell.
  const pivot: Record<string, Record<string, number | null>> = {};
  const colSet = new Set<string>();
  const rowSet = new Set<string>();
  for (const r of rows) {
    if (r.group == null) continue;
    const col = String(r.group);
    const row = String((r as Record<string, unknown>).series ?? '(all)');
    if (!pivot[row]) pivot[row] = {};
    pivot[row][col] = typeof r.agg_0 === 'number' ? r.agg_0 : null;
    colSet.add(col);
    rowSet.add(row);
  }
  const cols = Array.from(colSet).sort();
  const rowKeys = Array.from(rowSet).sort();

  // Calendar buckets (day/week/month/quarter/year) → always show a date.
  // The "show hour" branch is only meaningful for sub-day buckets.
  const isCalendarBucket = ['day', 'week', 'month', 'quarter', 'year'].includes(interval);
  const fmtCol = (c: string): string => {
    if (c.length < 13) return c; // bare YYYY-MM-DD
    if (isCalendarBucket) {
      return formatInTz(c, tz, interval === 'year' || interval === 'month' ? 'month' : 'day');
    }
    // Sub-day bucket: if every bucket is in the same calendar day, show
    // HH:MM; otherwise MM/DD HH:MM so the user sees both axes.
    const allDates = cols.map((x) => formatInTz(x, tz, 'date'));
    const sameDay = allDates.every((d) => d === allDates[0]);
    return sameDay
      ? formatInTz(c, tz, 'time').slice(0, 5)
      : formatInTz(c, tz, 'short');
  };

  const fmtVal = (v: number | null | undefined): string => applyValueFormat(v, comp);

  return (
    <div style={{
      backgroundColor: '#fff', border: '1px solid #E2E8F0', borderRadius: 8,
      overflow: 'hidden', height: '100%', display: 'flex', flexDirection: 'column',
    }}>
      <div style={{
        padding: '12px 16px', borderBottom: '1px solid #E2E8F0',
        fontSize: 13, fontWeight: 600, color: '#0D1117',
      }}>{comp.title}</div>
      <div style={{ flex: 1, overflow: 'auto' }}>
        {rowKeys.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 32, color: '#94A3B8', fontSize: 12 }}>
            No data for this query
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ backgroundColor: '#F8FAFC', position: 'sticky', top: 0 }}>
                <th style={{ textAlign: 'left', padding: '8px 12px', color: '#64748B', fontWeight: 600, borderBottom: '1px solid #E2E8F0', whiteSpace: 'nowrap' }}>
                  {labelField}
                </th>
                {cols.map((c) => (
                  <th key={c} style={{ textAlign: 'right', padding: '8px 12px', color: '#64748B', fontWeight: 600, borderBottom: '1px solid #E2E8F0', whiteSpace: 'nowrap', fontFamily: 'var(--font-mono)' }}>
                    {fmtCol(c)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rowKeys.map((rk) => (
                <tr key={rk} style={{ borderBottom: '1px solid #F1F5F9' }}>
                  <td style={{ padding: '7px 12px', color: '#0D1117', fontWeight: 500 }}>{rk}</td>
                  {cols.map((c) => (
                    <td key={c} style={{ padding: '7px 12px', textAlign: 'right', color: '#374151', fontFamily: 'var(--font-mono)' }}>
                      {fmtVal(pivot[rk]?.[c])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
};

export const ComponentRenderer: React.FC<{ comp: AppComponent; events?: AppEvent[]; allComponents?: AppComponent[] }> = ({ comp: rawComp, events, allComponents }) => {
  const { filter: crossFilter } = useContext(CrossFilterContext);
  const dash = useContext(DashboardFilterContext);

  // Apply dashboard filter bar inheritance. Default is to inherit; widgets
  // opt out by setting inheritDashboardFilter=false. Inheritance overrides
  // the widget's xAxisRange / xField / custom dates and adds the group
  // filter to its filter list.
  const inherits = dash.enabled && rawComp.inheritDashboardFilter !== false;
  const comp: AppComponent = inherits
    ? {
        ...rawComp,
        xAxisRange: dash.range,
        xAxisCustomStart: dash.customStart,
        xAxisCustomEnd: dash.customEnd,
        // Only override the time field if the dashboard specifies one and
        // the widget doesn't already have one set explicitly.
        xField: dash.timeField || rawComp.xField,
        filters: (() => {
          const base = rawComp.filters || [];
          if (!dash.groupField || dash.groupValues.length === 0) return base;
          // Drop any prior dashboard-injected group filter, then append
          // a fresh one. Marked with the field name as the id so re-renders
          // don't multiply it.
          const dropped = base.filter((f) => f.field !== dash.groupField);
          return [
            ...dropped,
            {
              id: `__dash_${dash.groupField}`,
              field: dash.groupField,
              operator: 'in',
              value: dash.groupValues.join(','),
            },
          ];
        })(),
      }
    : rawComp;

  // Aggregate-friendly widgets short-circuit the full record pagination —
  // only the rolled-up numbers come back from the server. This is the only
  // way the dashboard scales to 100M+ rows: the browser never sees raw data.
  if (comp.objectTypeId && SERVER_AGG_TYPES.has(comp.type)) {
    const serverFilters = buildServerFilters(comp.filters, crossFilter, comp.id);
    switch (comp.type) {
      case 'metric-card': return <ServerAggMetricCard comp={comp} serverFilters={serverFilters} />;
      case 'kpi-banner': return <ServerAggKpiBanner comp={comp} serverFilters={serverFilters} />;
      case 'stat-card': return <ServerAggStatCard comp={comp} serverFilters={serverFilters} />;
      case 'bar-chart': return <ServerAggBarChart comp={comp} serverFilters={serverFilters} />;
      case 'pie-chart': return <ServerAggPieChart comp={comp} serverFilters={serverFilters} />;
      case 'line-chart': return <ServerAggLineChart comp={comp} serverFilters={serverFilters} />;
      case 'area-chart': return <ServerAggAreaChart comp={comp} serverFilters={serverFilters} />;
      case 'pivot-table': return <ServerPivotTable comp={comp} serverFilters={serverFilters} />;
      case 'filter-bar': return <ServerAggFilterBar comp={comp} serverFilters={serverFilters} />;
    }
  }

  // data-table: server-side pagination, never the full table.
  if (comp.objectTypeId && SERVER_PAGINATED_TYPES.has(comp.type)) {
    const serverFilters = buildServerFilters(comp.filters, crossFilter, comp.id);
    return <ServerPaginatedDataTable comp={comp} serverFilters={serverFilters} />;
  }

  // Widgets that do their own data fetching server-side (or don't need
  // records at all) should never trigger useRecords. ChatWidget passes the
  // question + object_type_id to /infer/chat which fetches what it needs;
  // the previous architecture was pulling the full table just to throw the
  // records away.
  if (RECORDS_FREE_TYPES.has(comp.type)) {
    return <ComponentRendererNoRecords comp={comp} allComponents={allComponents} />;
  }

  return <ComponentRendererRaw comp={comp} events={events} allComponents={allComponents} />;
};

const RECORDS_FREE_TYPES = new Set([
  'chat-widget',     // /infer/chat handles data fetching server-side
  'text-block',      // static content
  'utility-output',  // calls a utility, no records needed
  'dropdown-filter', // uses /aggregate via useAggregate inside the widget
  'form',            // posts to an action; no records
  'object-table',    // has its own data path
  'date-picker',     // pure UI
  // Composite is a container — children fetch their own data through
  // the recursive ComponentRenderer call. The composite shell itself
  // never fetches records.
  'composite',
  // Phase I — action widgets are interactive, not data-driven.
  'action-button',
  'object-editor',
  'record-creator',
  'approval-queue',
]);

const ComponentRendererNoRecords: React.FC<{ comp: AppComponent; allComponents?: AppComponent[] }> = ({ comp, allComponents }) => {
  switch (comp.type) {
    case 'chat-widget': return <ChatWidget comp={comp} records={[]} allComponents={allComponents} />;
    case 'text-block': return <TextBlock comp={comp} />;
    case 'utility-output': return <UtilityWidget comp={comp} />;
    case 'dropdown-filter': return <DropdownFilterWidget comp={comp} />;
    case 'form': return <FormWidget comp={comp} />;
    case 'object-table': return <ObjectTableWidget comp={comp} />;
    case 'date-picker': return <DatePickerWidget comp={comp} records={[]} />;
    case 'composite': return <CompositeWidget comp={comp} />;
    case 'action-button': return <ActionButtonWidget comp={comp} />;
    case 'object-editor': return <ObjectEditorWidget comp={comp} />;
    case 'record-creator': return <RecordCreatorWidget comp={comp} />;
    case 'approval-queue': return <ApprovalQueueWidget comp={comp} />;
    case 'file-upload': return <FileUploadWidget comp={comp} />;
    default: return null;
  }
};

// ── Composite widget ──────────────────────────────────────────────────────
// A recursive container. Children render through ComponentRenderer in a
// nested 12-col grid. Layout templates apply colSpan defaults to children
// when they don't specify their own. shareDataSource / shareFilters let
// children inherit the composite's objectTypeId and filters.

function applyCompositeLayout(
  children: AppComponent[],
  layout: CompositeLayout,
  cols: number,
): AppComponent[] {
  const half = Math.ceil(cols / 2);
  const sidebarCols = Math.max(3, Math.floor(cols / 3));
  const heroCols = cols - sidebarCols;
  return children.map((child, i) => {
    if (child.colSpan != null) return child;
    let span = half;
    if (layout === 'banner-main') {
      span = i === 0 ? cols : cols;
    } else if (layout === 'hero-sidebar') {
      span = i === 0 ? heroCols : i === 1 ? sidebarCols : cols;
    } else if (layout === 'split') {
      span = i < 2 ? half : cols;
    }
    return { ...child, colSpan: span };
  });
}

const CompositeWidget: React.FC<{ comp: AppComponent }> = ({ comp }) => {
  const cols = comp.innerGridCols && comp.innerGridCols > 0 && comp.innerGridCols <= 12
    ? comp.innerGridCols : 12;
  const layout: CompositeLayout = comp.cardLayout || 'grid';
  const cardStyle = comp.cardStyle || {};
  const titleStyle = cardStyle.titleStyle || 'bold';
  const children = comp.children || [];

  const positioned = applyCompositeLayout(children, layout, cols);

  // Inheritance — children opt into the composite's data source / filters
  // when they don't set their own. shareDataSource/shareFilters default
  // to true so generated composites with a single source "just work."
  const inherited = positioned.map((child) => {
    const out: AppComponent = { ...child };
    if ((comp.shareDataSource ?? true) && !out.objectTypeId && comp.objectTypeId) {
      out.objectTypeId = comp.objectTypeId;
    }
    if ((comp.shareFilters ?? true) && comp.filters && comp.filters.length > 0) {
      out.filters = [...comp.filters, ...(out.filters || [])];
    }
    return out;
  });

  return (
    <div
      style={{
        backgroundColor: cardStyle.background || '#fff',
        border: cardStyle.border || '1px solid #E2E8F0',
        borderRadius: 8,
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      {comp.title && titleStyle !== 'hidden' && (
        <div
          style={{
            padding: '10px 16px',
            borderBottom: '1px solid #E2E8F0',
            fontSize: titleStyle === 'subtle' ? 11 : 13,
            fontWeight: titleStyle === 'subtle' ? 500 : 600,
            color: titleStyle === 'subtle' ? '#64748B' : '#0D1117',
            letterSpacing: titleStyle === 'subtle' ? '0.04em' : 0,
            textTransform: titleStyle === 'subtle' ? 'uppercase' : 'none',
          }}
        >
          {comp.title}
        </div>
      )}
      {children.length === 0 ? (
        <div
          style={{
            flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: '#94A3B8', fontSize: 12, padding: 24, textAlign: 'center',
          }}
        >
          Empty card — add child widgets in the editor.
        </div>
      ) : (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: `repeat(${cols}, 1fr)`,
            gap: 12,
            padding: cardStyle.padding ?? 12,
            flex: 1,
            alignItems: 'start',
          }}
        >
          {inherited.map((child) => {
            const span = Math.max(1, Math.min(cols, child.colSpan || Math.ceil(cols / 2)));
            const fixedH = child.gridH ? child.gridH * 60 : undefined;
            const defaultMin =
              child.type === 'data-table' || child.type === 'object-table' ? 240 :
              child.type === 'bar-chart' || child.type === 'line-chart' ? 220 :
              child.type === 'composite' ? 200 :
              120;
            return (
              <div
                key={child.id}
                style={{
                  gridColumn: `span ${span}`,
                  height: fixedH,
                  minHeight: fixedH ? undefined : defaultMin,
                }}
              >
                <ComponentRenderer comp={child} />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

// Phase I — action widget stubs. Real implementations later in this file.
const ActionButtonWidget: React.FC<{ comp: AppComponent }> = ({ comp }) => (
  <ActionButtonWidgetImpl comp={comp} />
);
const ObjectEditorWidget: React.FC<{ comp: AppComponent }> = ({ comp }) => (
  <ObjectEditorWidgetImpl comp={comp} />
);
const RecordCreatorWidget: React.FC<{ comp: AppComponent }> = ({ comp }) => (
  <RecordCreatorWidgetImpl comp={comp} />
);
const ApprovalQueueWidget: React.FC<{ comp: AppComponent }> = ({ comp }) => (
  <ApprovalQueueWidgetImpl comp={comp} />
);

// FileUploadWidget — Phase 8.
// Drop on canvas. User picks a file → POST /documents/upload → POST
// /infer/extract-from-document with the configured schema → on response,
// each extracted field is written to the mapped app variable so sibling
// form widgets can autofill via their inputBindings.
const FileUploadWidget: React.FC<{ comp: AppComponent }> = ({ comp }) => {
  const { setVariable, getVariable } = useAppVariables();
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState<'idle' | 'uploading' | 'extracting' | 'done' | 'error'>('idle');
  const [docId, setDocId] = useState<string | null>(null);
  const [extracted, setExtracted] = useState<Record<string, unknown>>({});
  const [error, setError] = useState<string>('');

  const onPick = async (file: File) => {
    if (!file) return;
    setBusy(true); setError(''); setExtracted({});
    setPhase('uploading');

    try {
      // 1. Upload the file as a Document record.
      const fd = new FormData();
      fd.append('file', file);
      if (comp.linkedRecordType) fd.append('linked_record_type', comp.linkedRecordType);
      if (comp.linkedRecordVariableId) {
        const linkedId = getVariable(comp.linkedRecordVariableId);
        if (linkedId) fd.append('linked_record_id', String(linkedId));
      }
      const headers: Record<string, string> = { 'x-tenant-id': getTenantId() };
      const token = getAccessToken();
      if (token) headers['Authorization'] = `Bearer ${token}`;
      const upResp = await fetch(`${ONTOLOGY_API}/documents/upload`, {
        method: 'POST', headers, body: fd,
      });
      if (!upResp.ok) {
        throw new Error(`Upload failed (${upResp.status})`);
      }
      const upJson = await upResp.json();
      const document_id: string = upJson.document?.id;
      setDocId(document_id);

      // No extraction schema configured → just store the doc and stop.
      const schema = comp.extractionSchema || [];
      if (schema.length === 0) {
        setPhase('done');
        return;
      }

      // 2. Vision extraction.
      setPhase('extracting');
      const extractResp = await fetch(`${INFERENCE_API}/infer/extract-from-document`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          document_id,
          schema,
          document_kind: comp.documentKind || '',
        }),
      });
      if (!extractResp.ok) {
        const text = await extractResp.text().catch(() => '');
        throw new Error(`Extraction failed: ${extractResp.status} ${text.slice(0, 120)}`);
      }
      const ex = await extractResp.json();
      const extractedFields: Record<string, unknown> = ex.extracted || {};
      setExtracted(extractedFields);

      // 3. Push extracted values into the configured app variables.
      const map = comp.fieldVariableMap || {};
      for (const [fieldName, varId] of Object.entries(map)) {
        if (!varId) continue;
        const value = extractedFields[fieldName];
        if (value !== undefined) setVariable(varId, value);
      }

      setPhase('done');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPhase('error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{
      backgroundColor: '#fff', border: '1px solid #E2E8F0', borderRadius: 8,
      padding: 16, height: '100%', display: 'flex', flexDirection: 'column', gap: 10,
    }}>
      {comp.title && (
        <div style={{ fontSize: 13, fontWeight: 600, color: '#0D1117' }}>{comp.title}</div>
      )}
      <label style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        justifyContent: 'center', minHeight: 80,
        border: '2px dashed #DDD6FE', borderRadius: 6,
        backgroundColor: busy ? '#F5F3FF' : '#FAFBFE',
        cursor: busy ? 'default' : 'pointer', padding: 12,
        transition: 'background-color 80ms',
      }}>
        <input
          type="file"
          disabled={busy}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onPick(f);
          }}
          style={{ display: 'none' }}
        />
        {phase === 'idle' && (
          <>
            <div style={{ fontSize: 12, color: '#7C3AED', fontWeight: 500 }}>Click or drop a file here</div>
            <div style={{ fontSize: 10, color: '#94A3B8', marginTop: 4 }}>
              {comp.documentKind ? `Expected: ${comp.documentKind}` : 'PDF, PNG, JPEG'}
            </div>
          </>
        )}
        {phase === 'uploading' && (
          <div style={{ fontSize: 11, color: '#7C3AED' }}>Uploading…</div>
        )}
        {phase === 'extracting' && (
          <>
            <div style={{ fontSize: 11, color: '#7C3AED' }}>Extracting fields with Claude vision…</div>
            <div style={{ fontSize: 9, color: '#94A3B8', marginTop: 4 }}>This usually takes 3–8s</div>
          </>
        )}
        {phase === 'done' && (
          <>
            <div style={{ fontSize: 11, color: '#16A34A', fontWeight: 500 }}>
              ✓ {Object.keys(extracted).length > 0
                  ? `Extracted ${Object.keys(extracted).length} fields — form prefilled`
                  : 'Uploaded'}
            </div>
            {docId && (
              <div style={{ fontSize: 9, color: '#94A3B8', marginTop: 4, fontFamily: 'monospace' }}>
                doc id: {docId.slice(0, 8)}…
              </div>
            )}
          </>
        )}
        {phase === 'error' && (
          <div style={{ fontSize: 11, color: '#DC2626' }}>{error || 'Failed'}</div>
        )}
      </label>
      {phase === 'done' && Object.keys(extracted).length > 0 && (
        <div style={{ fontSize: 10, color: '#475569', backgroundColor: '#F8FAFC', padding: 8, borderRadius: 4 }}>
          {Object.entries(extracted).slice(0, 6).map(([k, v]) => (
            <div key={k} style={{ display: 'flex', gap: 6 }}>
              <span style={{ color: '#94A3B8', minWidth: 90 }}>{k}:</span>
              <span style={{ color: '#0D1117', flex: 1, wordBreak: 'break-word' }}>
                {v == null || v === '' ? <em style={{ color: '#CBD5E1' }}>not found</em> : String(v)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

const ComponentRendererRaw: React.FC<{ comp: AppComponent; events?: AppEvent[]; allComponents?: AppComponent[] }> = ({ comp, allComponents }) => {
  const { records: rawRecords, loading, total: recordsTotal } = useRecords(comp.objectTypeId);
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
    case 'chat-widget': return <ChatWidget comp={comp} records={records} allComponents={allComponents} />;
    case 'custom-code': return <CustomCodeWidget comp={comp} records={records} recordsTotal={recordsTotal} />;
    case 'map': return <MapWidget comp={comp} records={records} />;
    case 'utility-output': return <UtilityWidget comp={comp} />;
    case 'dropdown-filter': return <DropdownFilterWidget comp={comp} />;
    case 'form': return <FormWidget comp={comp} />;
    case 'object-table': return <ObjectTableWidget comp={comp} />;
    case 'composite': return <CompositeWidget comp={comp} />;
    case 'action-button': return <ActionButtonWidget comp={comp} />;
    case 'object-editor': return <ObjectEditorWidget comp={comp} />;
    case 'record-creator': return <RecordCreatorWidget comp={comp} />;
    case 'approval-queue': return <ApprovalQueueWidget comp={comp} />;
    case 'file-upload': return <FileUploadWidget comp={comp} />;
    default: return null;
  }
};

// ── Dashboard filter bar UI ────────────────────────────────────────────────
// Renders at the top of the canvas when `app.filterBar.enabled`. Single
// source of truth for time range and (optional) group filter across every
// inheriting widget on the dashboard.

const RANGE_OPTIONS: Array<{ value: RangePreset; label: string }> = [
  { value: 'all_time',  label: 'All time' },
  { value: 'last_15m',  label: 'Last 15 min' },
  { value: 'last_1h',   label: 'Last 1 hour' },
  { value: 'last_4h',   label: 'Last 4 hours' },
  { value: 'last_24h',  label: 'Last 24 hours' },
  { value: 'today',     label: 'Today' },
  { value: 'yesterday', label: 'Yesterday' },
  { value: 'this_week', label: 'This week' },
  { value: 'this_month',label: 'This month' },
  { value: 'last_7d',   label: 'Last 7 days' },
  { value: 'last_30d',  label: 'Last 30 days' },
  { value: 'last_90d',  label: 'Last 90 days' },
  { value: 'last_year', label: 'Last year' },
  { value: 'custom',    label: 'Custom range…' },
];

const DashboardFilterBarUI: React.FC<{
  config: DashboardFilterBarConfig;
  objectTypeId?: string;
  range: RangePreset;
  setRange: (r: RangePreset) => void;
  customStart: string;
  setCustomStart: (s: string) => void;
  customEnd: string;
  setCustomEnd: (s: string) => void;
  groupValues: string[];
  setGroupValues: (vs: string[]) => void;
}> = ({ config, objectTypeId, range, setRange, customStart, setCustomStart, customEnd, setCustomEnd, groupValues, setGroupValues }) => {
  // Pull distinct values for the group field server-side. Capped at 200.
  const [groupOptions, setGroupOptions] = useState<string[]>([]);
  useEffect(() => {
    if (!objectTypeId || !config.groupField) { setGroupOptions([]); return; }
    let cancelled = false;
    fetch(`${ONTOLOGY_API}/object-types/${objectTypeId}/aggregate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-tenant-id': getTenantId() },
      body: JSON.stringify({
        group_by: config.groupField,
        aggregations: [{ method: 'count' }],
        sort_by: 'agg_0', sort_dir: 'desc', limit: 200,
      }),
    })
      .then((r) => r.ok ? r.json() : { rows: [] })
      .then((d: { rows: Array<{ group: string | null }> }) => {
        if (cancelled) return;
        setGroupOptions((d.rows || []).map((r) => String(r.group ?? '')).filter(Boolean));
      })
      .catch(() => { if (!cancelled) setGroupOptions([]); });
    return () => { cancelled = true; };
  }, [objectTypeId, config.groupField]);

  // ISO ↔ <input type="datetime-local"> needs the local-flavored format.
  const toLocal = (iso: string) => {
    if (!iso) return '';
    const d = new Date(iso);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };
  const fromLocal = (s: string) => s ? new Date(s).toISOString() : '';

  const toggleGroupValue = (v: string) => {
    if (groupValues.includes(v)) {
      setGroupValues(groupValues.filter((x) => x !== v));
    } else {
      setGroupValues([...groupValues, v]);
    }
  };

  return (
    <div style={{
      display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 12,
      padding: '12px 24px', backgroundColor: '#F8FAFC',
      borderBottom: '1px solid #E2E8F0',
    }}>
      <span style={{ fontSize: 11, fontWeight: 600, color: '#475569', letterSpacing: '0.04em' }}>
        FILTERS
      </span>

      <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#334155' }}>
        Range:
        <select
          value={range}
          onChange={(e) => setRange(e.target.value as RangePreset)}
          style={{ padding: '4px 8px', border: '1px solid #CBD5E1', borderRadius: 4, fontSize: 12, backgroundColor: '#fff' }}
        >
          {RANGE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </label>

      {range === 'custom' && (
        <>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#334155' }}>
            From:
            <input
              type="datetime-local"
              value={toLocal(customStart)}
              onChange={(e) => setCustomStart(fromLocal(e.target.value))}
              style={{ padding: '3px 6px', border: '1px solid #CBD5E1', borderRadius: 4, fontSize: 12 }}
            />
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#334155' }}>
            To:
            <input
              type="datetime-local"
              value={toLocal(customEnd)}
              onChange={(e) => setCustomEnd(fromLocal(e.target.value))}
              style={{ padding: '3px 6px', border: '1px solid #CBD5E1', borderRadius: 4, fontSize: 12 }}
            />
          </label>
        </>
      )}

      {config.groupField && groupOptions.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 12, color: '#334155' }}>{config.groupField}:</span>
          {groupValues.length === 0 && (
            <span style={{ fontSize: 11, color: '#64748B', fontStyle: 'italic' }}>all</span>
          )}
          {groupOptions.map((v) => {
            const active = groupValues.includes(v);
            return (
              <button
                key={v}
                onClick={() => toggleGroupValue(v)}
                style={{
                  padding: '3px 9px',
                  border: `1px solid ${active ? '#2563EB' : '#CBD5E1'}`,
                  borderRadius: 12,
                  fontSize: 11,
                  backgroundColor: active ? '#DBEAFE' : '#fff',
                  color: active ? '#1D4ED8' : '#475569',
                  cursor: 'pointer',
                }}
              >
                {v}
              </button>
            );
          })}
          {groupValues.length > 0 && (
            <button
              onClick={() => setGroupValues([])}
              style={{
                padding: '3px 8px', border: 'none', background: 'transparent',
                color: '#64748B', fontSize: 11, cursor: 'pointer', textDecoration: 'underline',
              }}
            >
              clear
            </button>
          )}
        </div>
      )}
    </div>
  );
};

// ── App-level context (Phase H) ────────────────────────────────────────────
// Lets nested widgets reach the app's actions[], variables, and event-dispatch
// helpers without prop-drilling through composites.

interface AppContextValue {
  app: NexusApp;
  actions: AppAction[];
  // Phase D — runtime drill-down dispatcher; populated by AppCanvas.
  fireEvent?: (
    sourceWidgetId: string,
    trigger: AppEvent['trigger'],
    payload?: { value?: string; field?: string; row?: Record<string, unknown> },
  ) => void;
}

const AppContext = createContext<AppContextValue>({
  app: {
    id: '', name: '', description: '', icon: '', components: [],
    objectTypeIds: [], createdAt: '', updatedAt: '',
  },
  actions: [],
});

export const useAppContext = () => useContext(AppContext);

// ── Action runner (Phase H) ────────────────────────────────────────────────
// Resolves an AppAction into an actual mutation. Object actions translate to
// the existing /objects endpoints in ontology-service. Other kinds defer to
// the action runner (already used by FormWidget) or to webhooks/utilities.

interface ActionRunInput {
  formValues?: Record<string, unknown>;
  selectedRow?: Record<string, unknown>;
  variables?: Record<string, unknown>;
}

interface ActionRunResult {
  ok: boolean;
  data?: Record<string, unknown>;
  error?: string;
}

async function runAppAction(action: AppAction, input: ActionRunInput): Promise<ActionRunResult> {
  // Apply field mappings → payload.
  const mapValue = (m: { formField: string; transform?: string; literalValue?: string }): unknown => {
    if (m.transform === 'literal') return m.literalValue ?? '';
    const raw = input.formValues?.[m.formField] ?? input.selectedRow?.[m.formField];
    if (raw == null) return null;
    if (m.transform === 'asNumber') return Number(raw);
    if (m.transform === 'asDate') return new Date(String(raw)).toISOString();
    if (m.transform === 'asUuid') return String(raw);
    return raw;
  };

  const buildPayload = (): Record<string, unknown> => {
    const out: Record<string, unknown> = {};
    for (const m of action.fieldMappings || []) {
      out[m.targetProperty] = mapValue(m);
    }
    return out;
  };

  // Resolve record id for update/delete.
  const resolveRecordId = (): string | null => {
    if (!action.recordIdSource) return null;
    if (action.recordIdSource === 'formField' && action.recordIdField) {
      return String(input.formValues?.[action.recordIdField] ?? '') || null;
    }
    if (action.recordIdSource === 'variable' && action.recordIdField) {
      return String(input.variables?.[action.recordIdField] ?? '') || null;
    }
    if (action.recordIdSource === 'selectedRow' && action.recordIdField) {
      return String(input.selectedRow?.[action.recordIdField] ?? '') || null;
    }
    return null;
  };

  // PATCH/DELETE on /records require auth; ingest only needs tenant. Include
  // the Authorization header on every call — harmless on ingest, required for
  // updateObject / deleteObject.
  const token = getAccessToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'x-tenant-id': getTenantId(),
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  try {
    if (action.kind === 'createObject') {
      if (!action.objectTypeId) return { ok: false, error: 'Action missing objectTypeId' };
      // /records/ingest is the only POST that creates records on this service.
      // It expects an array shape and a pk_field, even for a single record.
      // Auto-generate an id when the action's mappings don't include one so
      // ingest doesn't dedupe-collide on missing primary key.
      const payload = buildPayload();
      if (!payload.id) {
        payload.id = (typeof crypto !== 'undefined' && crypto.randomUUID)
          ? crypto.randomUUID()
          : `rec-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      }
      const r = await fetch(`${ONTOLOGY_API}/object-types/${action.objectTypeId}/records/ingest`, {
        method: 'POST', headers,
        body: JSON.stringify({ records: [payload], pk_field: 'id', pipeline_id: 'app-action' }),
      });
      if (!r.ok) {
        const text = await r.text().catch(() => '');
        return { ok: false, error: `HTTP ${r.status}: ${text.slice(0, 200)}` };
      }
      const data = await r.json().catch(() => ({}));
      // Echo the new record id so onSuccess handlers (setVariable from
      // response.id) can read it.
      return { ok: true, data: { ...data, id: payload.id } };
    }
    if (action.kind === 'updateObject') {
      if (!action.objectTypeId) return { ok: false, error: 'Action missing objectTypeId' };
      const recId = resolveRecordId();
      if (!recId) return { ok: false, error: 'Could not resolve record id (configure recordIdSource on the action)' };
      // Backend expects flat properties at the top level — `merged_data.update(payload)`
      // — not wrapped in `{properties}`.
      const r = await fetch(`${ONTOLOGY_API}/object-types/${action.objectTypeId}/records/${recId}`, {
        method: 'PATCH', headers, body: JSON.stringify(buildPayload()),
      });
      if (!r.ok) {
        const text = await r.text().catch(() => '');
        return { ok: false, error: `HTTP ${r.status}: ${text.slice(0, 200)}` };
      }
      return { ok: true, data: await r.json() };
    }
    if (action.kind === 'deleteObject') {
      if (!action.objectTypeId) return { ok: false, error: 'Action missing objectTypeId' };
      const recId = resolveRecordId();
      if (!recId) return { ok: false, error: 'Could not resolve record id (configure recordIdSource on the action)' };
      const r = await fetch(`${ONTOLOGY_API}/object-types/${action.objectTypeId}/records/${recId}`, {
        method: 'DELETE', headers,
      });
      if (!r.ok) {
        const text = await r.text().catch(() => '');
        return { ok: false, error: `HTTP ${r.status}: ${text.slice(0, 200)}` };
      }
      return { ok: true };
    }
    if (action.kind === 'webhook') {
      if (!action.webhookUrl) return { ok: false, error: 'Action missing webhookUrl' };
      const r = await fetch(action.webhookUrl, {
        method: action.webhookMethod || 'POST', headers,
        body: JSON.stringify(buildPayload()),
      });
      if (!r.ok) return { ok: false, error: `HTTP ${r.status}` };
      return { ok: true, data: await r.json().catch(() => ({})) };
    }
    if (action.kind === 'callUtility') {
      if (!action.utilityId) return { ok: false, error: 'Action missing utilityId' };
      const r = await fetch(`${INFERENCE_API}/utilities/${action.utilityId}/run`, {
        method: 'POST', headers, body: JSON.stringify({ inputs: buildPayload() }),
      });
      if (!r.ok) return { ok: false, error: `HTTP ${r.status}` };
      return { ok: true, data: await r.json().catch(() => ({})) };
    }
    if (action.kind === 'runWorkflow') {
      if (!action.workflowId) return { ok: false, error: 'Action missing workflowId' };
      const r = await fetch(`${ONTOLOGY_API}/workflows/${action.workflowId}/run`, {
        method: 'POST', headers, body: JSON.stringify({ inputs: buildPayload() }),
      });
      if (!r.ok) return { ok: false, error: `HTTP ${r.status}` };
      return { ok: true, data: await r.json().catch(() => ({})) };
    }
    return { ok: false, error: `Unknown action kind: ${action.kind}` };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

// Validation check for an action's input.
function validateActionInput(
  action: AppAction,
  formValues: Record<string, unknown>,
): string | null {
  for (const v of action.validations || []) {
    const raw = formValues[v.field];
    const str = String(raw ?? '');
    if (v.rule === 'required' && !str) return v.message || `${v.field} is required`;
    if (v.rule === 'regex' && v.value && !new RegExp(v.value).test(str)) {
      return v.message || `${v.field} format invalid`;
    }
    if (v.rule === 'min' && v.value && Number(str) < Number(v.value)) {
      return v.message || `${v.field} must be ≥ ${v.value}`;
    }
    if (v.rule === 'max' && v.value && Number(str) > Number(v.value)) {
      return v.message || `${v.field} must be ≤ ${v.value}`;
    }
  }
  return null;
}

// ── Phase I — action widgets ───────────────────────────────────────────────

const ActionButtonWidgetImpl: React.FC<{ comp: AppComponent }> = ({ comp }) => {
  const { actions } = useAppContext();
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ ok: boolean; msg: string } | null>(null);
  const action = actions.find((a) => a.id === comp.actionId);

  const onClick = async () => {
    if (!action) {
      setFeedback({ ok: false, msg: 'No action configured' });
      return;
    }
    if (action.confirmation && !window.confirm(`${action.confirmation.title}\n\n${action.confirmation.body}`)) {
      return;
    }
    setBusy(true);
    setFeedback(null);
    const result = await runAppAction(action, { formValues: {} });
    setBusy(false);
    setFeedback({ ok: result.ok, msg: result.ok ? 'Done' : (result.error || 'Error') });
    setTimeout(() => setFeedback(null), 3000);
  };

  return (
    <div style={{
      backgroundColor: '#fff', border: '1px solid #E2E8F0', borderRadius: 8,
      padding: 16, height: '100%', display: 'flex', flexDirection: 'column',
      alignItems: 'flex-start', gap: 8,
    }}>
      {comp.title && (
        <div style={{ fontSize: 12, fontWeight: 600, color: '#0D1117' }}>{comp.title}</div>
      )}
      <button
        onClick={onClick}
        disabled={busy || !action}
        style={{
          padding: '8px 16px', borderRadius: 6, fontSize: 13, fontWeight: 500,
          backgroundColor: action ? '#7C3AED' : '#94A3B8',
          color: '#fff', border: 'none',
          cursor: action && !busy ? 'pointer' : 'default',
        }}
      >
        {busy ? 'Running…' : (action?.name || 'Configure action')}
      </button>
      {feedback && (
        <div style={{ fontSize: 11, color: feedback.ok ? '#16A34A' : '#DC2626' }}>
          {feedback.msg}
        </div>
      )}
    </div>
  );
};

const ObjectEditorWidgetImpl: React.FC<{ comp: AppComponent }> = ({ comp }) => {
  const { actions } = useAppContext();
  const action = actions.find((a) => a.id === comp.actionId);
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ ok: boolean; msg: string } | null>(null);

  // Pre-populate from existing record when objectTypeId + recordIdValue are set.
  useEffect(() => {
    if (!comp.objectTypeId || !comp.recordIdValue) return;
    let cancelled = false;
    fetch(`${ONTOLOGY_API}/object-types/${comp.objectTypeId}/records/${comp.recordIdValue}`, {
      headers: { 'x-tenant-id': getTenantId() },
    })
      .then((r) => r.ok ? r.json() : null)
      .then((d) => {
        if (cancelled || !d) return;
        const props = (d.properties || d) as Record<string, unknown>;
        const initial: Record<string, string> = {};
        for (const f of comp.fields || []) initial[f.name] = String(props[f.name] ?? '');
        setValues(initial);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [comp.objectTypeId, comp.recordIdValue, comp.fields]);

  const onSave = async () => {
    if (!action) { setFeedback({ ok: false, msg: 'No action configured' }); return; }
    const err = validateActionInput(action, values);
    if (err) { setFeedback({ ok: false, msg: err }); return; }
    setBusy(true);
    const result = await runAppAction(action, { formValues: values });
    setBusy(false);
    setFeedback({ ok: result.ok, msg: result.ok ? 'Saved' : (result.error || 'Error') });
  };

  return (
    <div style={{
      backgroundColor: '#fff', border: '1px solid #E2E8F0', borderRadius: 8,
      padding: 16, height: '100%', overflow: 'auto',
    }}>
      {comp.title && (
        <div style={{ fontSize: 13, fontWeight: 600, color: '#0D1117', marginBottom: 12 }}>
          {comp.title}
        </div>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {(comp.fields || []).map((f) => (
          <label key={f.name} style={{ fontSize: 11, color: '#475569' }}>
            <div style={{ marginBottom: 4 }}>{f.label || f.name}</div>
            {f.type === 'textarea' ? (
              <textarea
                value={values[f.name] || ''}
                onChange={(e) => setValues((v) => ({ ...v, [f.name]: e.target.value }))}
                rows={3}
                style={{ width: '100%', padding: '6px 8px', border: '1px solid #CBD5E1', borderRadius: 4, fontSize: 12 }}
              />
            ) : (
              <input
                type={f.type === 'number' ? 'number' : 'text'}
                value={values[f.name] || ''}
                onChange={(e) => setValues((v) => ({ ...v, [f.name]: e.target.value }))}
                style={{ width: '100%', padding: '6px 8px', border: '1px solid #CBD5E1', borderRadius: 4, fontSize: 12 }}
              />
            )}
          </label>
        ))}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 12 }}>
        <button
          onClick={onSave}
          disabled={busy || !action}
          style={{
            padding: '7px 14px', borderRadius: 6, fontSize: 12, fontWeight: 500,
            backgroundColor: action ? '#7C3AED' : '#94A3B8', color: '#fff',
            border: 'none', cursor: action && !busy ? 'pointer' : 'default',
          }}
        >
          {busy ? 'Saving…' : 'Save'}
        </button>
        {feedback && (
          <span style={{ fontSize: 11, color: feedback.ok ? '#16A34A' : '#DC2626' }}>
            {feedback.msg}
          </span>
        )}
      </div>
    </div>
  );
};

const RecordCreatorWidgetImpl: React.FC<{ comp: AppComponent }> = ({ comp }) => {
  const { actions } = useAppContext();
  const action = actions.find((a) => a.id === comp.actionId);
  const allFields = comp.fields || [];
  const steps = comp.steps && comp.steps.length > 0
    ? comp.steps
    : [{ title: comp.title || 'New record', fields: allFields.map((f) => f.name) }];
  const [stepIdx, setStepIdx] = useState(0);
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ ok: boolean; msg: string } | null>(null);

  const currentStep = steps[stepIdx];
  const stepFields = allFields.filter((f) => currentStep?.fields.includes(f.name));

  const onSubmit = async () => {
    if (!action) { setFeedback({ ok: false, msg: 'No action configured' }); return; }
    const err = validateActionInput(action, values);
    if (err) { setFeedback({ ok: false, msg: err }); return; }
    setBusy(true);
    const result = await runAppAction(action, { formValues: values });
    setBusy(false);
    setFeedback({ ok: result.ok, msg: result.ok ? 'Created' : (result.error || 'Error') });
    if (result.ok) {
      setValues({});
      setStepIdx(0);
    }
  };

  return (
    <div style={{
      backgroundColor: '#fff', border: '1px solid #E2E8F0', borderRadius: 8,
      padding: 16, height: '100%', display: 'flex', flexDirection: 'column',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        {comp.title && (
          <div style={{ fontSize: 13, fontWeight: 600, color: '#0D1117' }}>{comp.title}</div>
        )}
        <span style={{ marginLeft: 'auto', fontSize: 11, color: '#94A3B8' }}>
          Step {stepIdx + 1} of {steps.length}: {currentStep?.title}
        </span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, flex: 1, overflow: 'auto' }}>
        {stepFields.map((f) => (
          <label key={f.name} style={{ fontSize: 11, color: '#475569' }}>
            <div style={{ marginBottom: 4 }}>{f.label || f.name}</div>
            {f.type === 'textarea' ? (
              <textarea
                value={values[f.name] || ''}
                onChange={(e) => setValues((v) => ({ ...v, [f.name]: e.target.value }))}
                rows={3}
                style={{ width: '100%', padding: '6px 8px', border: '1px solid #CBD5E1', borderRadius: 4, fontSize: 12 }}
              />
            ) : f.type === 'select' ? (
              <select
                value={values[f.name] || ''}
                onChange={(e) => setValues((v) => ({ ...v, [f.name]: e.target.value }))}
                style={{ width: '100%', padding: '6px 8px', border: '1px solid #CBD5E1', borderRadius: 4, fontSize: 12, backgroundColor: '#fff' }}
              >
                <option value="">— select —</option>
                {(f.options || []).map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            ) : f.type === 'record-select' ? (
              <RecordSelectField
                recordTypeId={f.recordTypeId}
                displayField={f.recordDisplayField}
                value={values[f.name] || ''}
                onChange={(v) => setValues((vs) => ({ ...vs, [f.name]: v }))}
              />
            ) : f.type === 'boolean' ? (
              <select
                value={values[f.name] || ''}
                onChange={(e) => setValues((v) => ({ ...v, [f.name]: e.target.value }))}
                style={{ width: '100%', padding: '6px 8px', border: '1px solid #CBD5E1', borderRadius: 4, fontSize: 12, backgroundColor: '#fff' }}
              >
                <option value="">—</option>
                <option value="true">true</option>
                <option value="false">false</option>
              </select>
            ) : (
              <input
                type={f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : 'text'}
                value={values[f.name] || ''}
                onChange={(e) => setValues((v) => ({ ...v, [f.name]: e.target.value }))}
                style={{ width: '100%', padding: '6px 8px', border: '1px solid #CBD5E1', borderRadius: 4, fontSize: 12 }}
              />
            )}
          </label>
        ))}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 12 }}>
        <button
          onClick={() => setStepIdx((i) => Math.max(0, i - 1))}
          disabled={stepIdx === 0}
          style={{
            padding: '6px 12px', borderRadius: 6, fontSize: 12,
            backgroundColor: stepIdx === 0 ? '#F1F5F9' : '#fff',
            border: '1px solid #E2E8F0', color: '#475569',
            cursor: stepIdx === 0 ? 'default' : 'pointer',
          }}
        >Back</button>
        {stepIdx < steps.length - 1 ? (
          <button
            onClick={() => setStepIdx((i) => Math.min(steps.length - 1, i + 1))}
            style={{
              padding: '6px 14px', borderRadius: 6, fontSize: 12, fontWeight: 500,
              backgroundColor: '#7C3AED', color: '#fff', border: 'none', cursor: 'pointer',
            }}
          >Next →</button>
        ) : (
          <button
            onClick={onSubmit}
            disabled={busy || !action}
            style={{
              padding: '6px 14px', borderRadius: 6, fontSize: 12, fontWeight: 500,
              backgroundColor: action ? '#7C3AED' : '#94A3B8', color: '#fff',
              border: 'none', cursor: action && !busy ? 'pointer' : 'default',
            }}
          >{busy ? 'Submitting…' : 'Submit'}</button>
        )}
      </div>
      {feedback && (
        <div style={{ marginTop: 8, fontSize: 11, color: feedback.ok ? '#16A34A' : '#DC2626' }}>
          {feedback.msg}
        </div>
      )}
    </div>
  );
};

const ApprovalQueueWidgetImpl: React.FC<{ comp: AppComponent }> = ({ comp }) => {
  const { actions } = useAppContext();
  const approveAction = actions.find((a) => a.id === comp.approveActionId);
  const rejectAction = actions.find((a) => a.id === comp.rejectActionId);
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);

  useEffect(() => {
    if (!comp.objectTypeId) return;
    let cancelled = false;
    setLoading(true);
    const params = new URLSearchParams({ limit: String(comp.maxRows || 25) });
    if (comp.filters && comp.filters.length > 0) {
      const m: Record<string, unknown> = {};
      for (const f of comp.filters) m[f.field] = f.value;
      params.set('filter', JSON.stringify(m));
    }
    fetch(`${ONTOLOGY_API}/object-types/${comp.objectTypeId}/records?${params}`, {
      headers: { 'x-tenant-id': getTenantId() },
    })
      .then((r) => r.ok ? r.json() : { records: [] })
      .then((d) => { if (!cancelled) setRows(d.records || []); })
      .catch(() => { if (!cancelled) setRows([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [comp.objectTypeId, comp.maxRows, JSON.stringify(comp.filters || []), refreshTick]);

  const fire = async (action: AppAction | undefined, row: Record<string, unknown>) => {
    if (!action) return;
    const id = String(row.id ?? '');
    setBusyId(id);
    await runAppAction(action, { selectedRow: row });
    setBusyId(null);
    setRefreshTick((t) => t + 1);
  };

  const cols = comp.columns && comp.columns.length > 0
    ? comp.columns
    : (rows[0] ? Object.keys(rows[0]).slice(0, 4) : []);

  return (
    <div style={{
      backgroundColor: '#fff', border: '1px solid #E2E8F0', borderRadius: 8,
      height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden',
    }}>
      {comp.title && (
        <div style={{
          padding: '10px 16px', borderBottom: '1px solid #E2E8F0',
          fontSize: 13, fontWeight: 600, color: '#0D1117',
        }}>
          {comp.title}
        </div>
      )}
      <div style={{ flex: 1, overflow: 'auto' }}>
        {loading ? (
          <div style={{ padding: 24, textAlign: 'center', color: '#94A3B8', fontSize: 12 }}>Loading…</div>
        ) : rows.length === 0 ? (
          <div style={{ padding: 24, textAlign: 'center', color: '#94A3B8', fontSize: 12 }}>Queue is empty.</div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ backgroundColor: '#F8FAFC' }}>
                {cols.map((c) => (
                  <th key={c} style={{ textAlign: 'left', padding: '8px 12px', color: '#64748B', fontWeight: 600, borderBottom: '1px solid #E2E8F0' }}>
                    {c}
                  </th>
                ))}
                <th style={{ textAlign: 'right', padding: '8px 12px', color: '#64748B', fontWeight: 600, borderBottom: '1px solid #E2E8F0' }}>
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => {
                const id = String(row.id ?? i);
                return (
                  <tr key={id} style={{ borderBottom: '1px solid #F1F5F9' }}>
                    {cols.map((c) => (
                      <td key={c} style={{ padding: '7px 12px', color: '#0D1117' }}>
                        {String(row[c] ?? '')}
                      </td>
                    ))}
                    <td style={{ padding: '7px 12px', textAlign: 'right' }}>
                      <button
                        onClick={() => fire(approveAction, row)}
                        disabled={busyId === id || !approveAction}
                        style={{
                          marginRight: 6, padding: '3px 10px', borderRadius: 4, fontSize: 11,
                          backgroundColor: approveAction ? '#16A34A' : '#94A3B8',
                          color: '#fff', border: 'none', cursor: approveAction && busyId !== id ? 'pointer' : 'default',
                        }}
                      >Approve</button>
                      <button
                        onClick={() => fire(rejectAction, row)}
                        disabled={busyId === id || !rejectAction}
                        style={{
                          padding: '3px 10px', borderRadius: 4, fontSize: 11,
                          backgroundColor: rejectAction ? '#DC2626' : '#94A3B8',
                          color: '#fff', border: 'none', cursor: rejectAction && busyId !== id ? 'pointer' : 'default',
                        }}
                      >Reject</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
};

// ── Drill-down dispatcher (Phase D / E / F) ────────────────────────────────
// Resolves AppEvent rows on the dashboard against widget click payloads and
// pushes results onto the dashboard stack. Used by AppCanvas via fireEvent
// in the AppContext.

interface ClickPayload {
  value?: string;
  field?: string;
  row?: Record<string, unknown>;
}

function resolveBindings(
  bindings: import('../../types/app').ContextBinding[] | undefined,
  payload: ClickPayload,
): { variables: Record<string, unknown>; filters: AppFilter[] } {
  const variables: Record<string, unknown> = {};
  const filters: AppFilter[] = [];
  for (const b of bindings || []) {
    let value: unknown = '';
    if (b.sourceFrom === 'clickedValue') value = payload.value ?? '';
    else if (b.sourceFrom === 'clickedField') value = payload.field ?? '';
    else if (b.sourceFrom === 'clickedRow') value = payload.row ?? {};
    else if (b.sourceFrom === 'rowField' && b.rowField) value = payload.row?.[b.rowField] ?? '';
    else if (b.sourceFrom === 'literal') value = b.literal ?? '';

    if (b.apply === 'setVariable' && b.targetVariableId) {
      variables[b.targetVariableId] = value;
    } else if (b.apply === 'addFilter' && b.filterField) {
      filters.push({
        id: `__drill_${b.filterField}_${Math.random().toString(36).slice(2, 8)}`,
        field: b.filterField,
        operator: (b.filterOp || 'eq') as AppFilter['operator'],
        value: String(value ?? ''),
      });
    }
  }
  return { variables, filters };
}

async function fetchDashboardById(dashboardId: string): Promise<NexusApp | null> {
  try {
    const r = await fetch(`${ONTOLOGY_API}/apps/${dashboardId}`, {
      headers: { 'x-tenant-id': getTenantId() },
    });
    if (!r.ok) return null;
    const raw = await r.json() as Record<string, unknown>;
    const settings = (raw.settings as Record<string, unknown>) || {};
    return {
      id: raw.id as string,
      name: raw.name as string,
      description: (raw.description as string) || '',
      icon: (raw.icon as string) || '',
      components: (raw.components as NexusApp['components']) || [],
      objectTypeIds:
        Array.isArray(raw.object_type_ids) && (raw.object_type_ids as string[]).length > 0
          ? (raw.object_type_ids as string[])
          : raw.object_type_id ? [raw.object_type_id as string] : [],
      createdAt: (raw.created_at as string) || '',
      updatedAt: (raw.updated_at as string) || '',
      filterBar: settings.filter_bar as NexusApp['filterBar'] | undefined,
      kind: (raw.kind as 'dashboard' | 'app') || (settings.kind as 'dashboard' | 'app') || 'dashboard',
      actions: ((settings.actions as AppAction[]) || (raw.actions as AppAction[]) || []),
      variables: ((settings.variables as NexusApp['variables']) || raw.variables as NexusApp['variables']) || [],
      events: ((settings.events as AppEvent[]) || (raw.events as AppEvent[]) || []),
      isEphemeral: Boolean(raw.is_ephemeral || settings.is_ephemeral),
      parentAppId: (raw.parent_app_id as string) || (settings.parent_app_id as string) || undefined,
      generatedFromWidgetId:
        (raw.generated_from_widget_id as string) || (settings.generated_from_widget_id as string) || undefined,
      expiresAt: (raw.expires_at as string) || (settings.expires_at as string) || undefined,
      isSystem: Boolean(raw.is_system || settings.is_system),
      slug: (raw.slug as string) || (settings.slug as string) || undefined,
    };
  } catch {
    return null;
  }
}

async function generateDrilldownDashboard(
  prompt: string,
  availableObjectTypeIds: string[],
  sourceContext: Record<string, unknown>,
  parentAppId?: string,
  generatedFromWidgetId?: string,
): Promise<NexusApp | null> {
  try {
    const r = await fetch(`${INFERENCE_API}/infer/generate-dashboard`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-tenant-id': getTenantId() },
      body: JSON.stringify({
        prompt,
        available_object_type_ids: availableObjectTypeIds,
        source_context: sourceContext,
      }),
    });
    if (!r.ok) return null;
    const data = await r.json() as Record<string, unknown>;
    const ephemeral: NexusApp = {
      id: `gen-${Date.now()}`,
      name: (data.name as string) || 'Generated detail',
      description: (data.description as string) || '',
      icon: '',
      components: (data.components as NexusApp['components']) || [],
      objectTypeIds: (data.object_type_ids as string[]) || availableObjectTypeIds,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      isEphemeral: true,
      parentAppId,
      generatedFromWidgetId,
    };
    // Persist to the auto-cache so this generated view appears in
    // "Recently generated." Best-effort — if the backend rejects, we
    // still display the ephemeral view in-session.
    try {
      const persistResp = await fetch(`${ONTOLOGY_API}/apps`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-tenant-id': getTenantId() },
        body: JSON.stringify({
          name: ephemeral.name,
          description: ephemeral.description,
          icon: '',
          object_type_ids: ephemeral.objectTypeIds,
          components: ephemeral.components,
          is_ephemeral: true,
          parent_app_id: parentAppId,
          generated_from_widget_id: generatedFromWidgetId,
        }),
      });
      if (persistResp.ok) {
        const persisted = await persistResp.json() as Record<string, unknown>;
        ephemeral.id = persisted.id as string;
      }
    } catch { /* keep client-side ephemeral id */ }
    return ephemeral;
  } catch {
    return null;
  }
}

function interpolatePromptTemplate(template: string, payload: ClickPayload): string {
  return template
    .replace(/\{\{value\}\}/g, payload.value ?? '')
    .replace(/\{\{field\}\}/g, payload.field ?? '')
    .replace(/\{\{row\.([\w_]+)\}\}/g, (_, k) => String(payload.row?.[k] ?? ''));
}

function useDrillDispatcher(app: NexusApp) {
  const push = useDashboardStackStore((s) => s.push);
  const wouldOverflow = useDashboardStackStore((s) => s.wouldOverflow);
  return useCallback(
    async (sourceWidgetId: string, trigger: AppEvent['trigger'], payload: ClickPayload = {}) => {
      const events = (app.events || []).filter(
        (e) => e.sourceWidgetId === sourceWidgetId && e.trigger === trigger,
      );
      if (events.length === 0) return;
      for (const ev of events) {
        for (const action of ev.actions) {
          if (
            action.type !== 'openDashboard' &&
            action.type !== 'openDashboardModal' &&
            action.type !== 'generateDashboard'
          ) continue;
          if (wouldOverflow()) {
            // eslint-disable-next-line no-console
            console.warn('Drill-down depth limit reached');
            return;
          }
          const { variables, filters } = resolveBindings(action.contextBindings, payload);
          const widget = app.components.find((c) => c.id === sourceWidgetId);
          const sourceLabel = widget?.title || sourceWidgetId;
          const displayMode = action.displayMode
            || (action.type === 'openDashboardModal' ? 'modal' : 'replace');
          const triggeredFrom = {
            dashboardId: app.id,
            widgetId: sourceWidgetId,
            label: sourceLabel,
          };

          if (action.type === 'generateDashboard') {
            const tmpl = action.generatePromptTemplate || 'Show details for {{value}} in {{field}}';
            const promptText = interpolatePromptTemplate(tmpl, payload);
            const ots = action.generateObjectTypeIds && action.generateObjectTypeIds.length > 0
              ? action.generateObjectTypeIds
              : app.objectTypeIds || [];
            const ephemeral = await generateDrilldownDashboard(
              promptText,
              ots,
              {
                clicked_value: payload.value || '',
                clicked_field: payload.field || '',
                source_widget_type: widget?.type || '',
                source_dashboard_name: app.name,
                parent_app_id: app.id,
                generated_from_widget_id: sourceWidgetId,
              },
              app.id,
              sourceWidgetId,
            );
            if (!ephemeral) continue;
            const entry: DashboardStackEntry = {
              dashboardId: ephemeral.id,
              source: 'generated',
              ephemeralApp: ephemeral,
              initialContext: {
                variables,
                addedFilters: filters.map((filter) => ({ filter })),
              },
              triggeredFrom,
              displayMode,
              title: ephemeral.name,
            };
            push(entry);
          } else {
            if (!action.targetDashboardId) continue;
            const target = await fetchDashboardById(action.targetDashboardId);
            if (!target) continue;
            const entry: DashboardStackEntry = {
              dashboardId: target.id,
              source: 'saved',
              ephemeralApp: target,
              initialContext: {
                variables,
                addedFilters: filters.map((filter) => ({ filter })),
              },
              triggeredFrom,
              displayMode,
              title: target.name,
            };
            push(entry);
          }
        }
      }
    },
    [app, push, wouldOverflow],
  );
}

// Apply initialContext on top of the app — adds drill-down filters to every
// widget that doesn't already define a filter on the same field. Variables
// will be plumbed through via the AppVariableProvider's defaultValue path.
function applyDrilldownContext(
  app: NexusApp,
  ctx?: { variables: Record<string, unknown>; addedFilters: Array<{ widgetId?: string; filter: AppFilter }> },
): NexusApp {
  if (!ctx || (ctx.addedFilters.length === 0 && Object.keys(ctx.variables).length === 0)) {
    return app;
  }
  const components = app.components.map((comp) => {
    const extras = ctx.addedFilters
      .filter((f) => !f.widgetId || f.widgetId === comp.id)
      .map((f) => f.filter)
      .filter((f) => !(comp.filters || []).some((existing) => existing.field === f.field));
    if (extras.length === 0) return comp;
    return { ...comp, filters: [...(comp.filters || []), ...extras] };
  });
  // Apply variable overrides as defaults on the matching variable entries.
  const variables = (app.variables || []).map((v) => (
    Object.prototype.hasOwnProperty.call(ctx.variables, v.id)
      ? { ...v, defaultValue: ctx.variables[v.id] }
      : v
  ));
  return { ...app, components, variables };
}

// ── App Canvas ─────────────────────────────────────────────────────────────

interface Props {
  app: NexusApp;
  drilldownContext?: { variables: Record<string, unknown>; addedFilters: Array<{ widgetId?: string; filter: AppFilter }> };
}

const AppCanvas: React.FC<Props> = ({ app: rawApp, drilldownContext }) => {
  const app = applyDrilldownContext(rawApp, drilldownContext);
  const fireEvent = useDrillDispatcher(app);
  const [crossFilter, setCrossFilter] = useState<CrossFilter | null>(null);

  // Dashboard filter bar live state. Initialized from the app's saved
  // defaults; user can twiddle without persisting (changes are scoped to
  // this view). The first object type drives the group-options query when
  // the bar has a groupField configured.
  const fb = app.filterBar;
  const [liveRange, setLiveRange] = useState<RangePreset>(fb?.defaultRange || 'all_time');
  const [liveStart, setLiveStart] = useState<string>(fb?.customStart || '');
  const [liveEnd, setLiveEnd] = useState<string>(fb?.customEnd || '');
  const [liveGroupVals, setLiveGroupVals] = useState<string[]>(fb?.groupValues || []);

  const dashboardState: DashboardFilterState = {
    enabled: !!fb?.enabled,
    timeField: fb?.timeField,
    range: liveRange,
    customStart: liveStart,
    customEnd: liveEnd,
    groupField: fb?.groupField,
    groupValues: liveGroupVals,
  };

  const firstOtId = app.components.find((c) => !!c.objectTypeId)?.objectTypeId;

  return (
    <AppContext.Provider value={{ app, actions: app.actions || [], fireEvent }}>
    <AppVariableProvider definitions={app.variables || []}>
      <CrossFilterContext.Provider value={{ filter: crossFilter, setFilter: setCrossFilter }}>
       <DashboardFilterContext.Provider value={dashboardState}>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {fb?.enabled && (
            <DashboardFilterBarUI
              config={fb}
              objectTypeId={firstOtId}
              range={liveRange} setRange={setLiveRange}
              customStart={liveStart} setCustomStart={setLiveStart}
              customEnd={liveEnd} setCustomEnd={setLiveEnd}
              groupValues={liveGroupVals} setGroupValues={setLiveGroupVals}
            />
          )}
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
                  <ComponentRenderer comp={comp} events={app.events} allComponents={app.components} />
                </div>
              );
            })}
          </div>
        </div>
       </DashboardFilterContext.Provider>
      </CrossFilterContext.Provider>
    </AppVariableProvider>
    </AppContext.Provider>
  );
};

export default AppCanvas;
