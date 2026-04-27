/**
 * Pure helpers for translating widget config + cross-filter state into the
 * shape of queries the server `/aggregate` and `/records` endpoints accept.
 *
 * Kept side-effect-free and free of React so we can unit-test them.
 */
import type { AppComponent, AppFilter } from '../../types/app';
import { tzMidnight, tzWeekStart, tzMonthStart } from '../../lib/timezone';

export interface CrossFilter {
  field: string;
  value: string;
  sourceId: string;
}

export type TimeBucket =
  | 'second' | '5_seconds' | '15_seconds' | '30_seconds'
  | 'minute' | '5_minutes' | '15_minutes' | '30_minutes'
  | 'hour' | 'day' | 'week' | 'month' | 'quarter' | 'year';

export type AggregateMethod = 'count' | 'sum' | 'avg' | 'min' | 'max' | 'count_distinct';

export interface AggregateSpec {
  field?: string;
  method: AggregateMethod;
}

export interface AggregateOptions {
  groupBy?: string;
  timeBucket?: { field: string; interval: TimeBucket };
  aggregations: AggregateSpec[];
  filters?: Record<string, unknown>;
  sortBy?: string;
  sortDir?: 'asc' | 'desc';
  limit?: number;
  // IANA timezone — when set, server buckets calendar intervals
  // (date_trunc) at the boundaries of this zone instead of UTC.
  timezone?: string;
}

export interface AggregateRow {
  group: string | null;
  [agg: string]: number | string | null;
}

/**
 * Combine the widget's own filters with the active cross-filter (if any, and
 * we are not the widget that emitted it) into the JSON dict the aggregate
 * endpoint expects (same shape as GET /records `filter=` param).
 *
 * Returns undefined when there are no filters, so the caller can omit the
 * field entirely from the request body.
 */
export function buildServerFilters(
  filters: AppFilter[] | undefined,
  crossFilter: CrossFilter | null,
  ownId: string,
): Record<string, unknown> | undefined {
  const out: Record<string, unknown> = {};
  for (const f of filters || []) {
    if (!f.field) continue;
    const isUnaryOp = f.operator === 'is_empty' || f.operator === 'is_not_empty';
    if (!isUnaryOp && (f.value == null || f.value === '')) continue;
    switch (f.operator) {
      case 'eq': out[f.field] = f.value; break;
      case 'neq': out[f.field] = { $neq: f.value }; break;
      case 'in': {
        const list = String(f.value).split(',').map((s) => s.trim()).filter(Boolean);
        if (list.length) out[f.field] = { $in: list };
        break;
      }
      case 'not_in': {
        const list = String(f.value).split(',').map((s) => s.trim()).filter(Boolean);
        // Server doesn't have $not_in yet; encode as a negated $in for now.
        // Long-term: add $not_in to records.py JSONB filter parser.
        if (list.length) out[f.field] = { $not_in: list };
        break;
      }
      case 'gt': out[f.field] = { $gt: parseFloat(f.value) }; break;
      case 'gte': out[f.field] = { $gte: parseFloat(f.value) }; break;
      case 'lt': out[f.field] = { $lt: parseFloat(f.value) }; break;
      case 'lte': out[f.field] = { $lte: parseFloat(f.value) }; break;
      case 'after': out[f.field] = { $gte: f.value }; break;
      case 'before': out[f.field] = { $lte: f.value }; break;
      case 'contains': out[f.field] = { $contains: f.value }; break;
      case 'is_empty': out[f.field] = { $is_null: true }; break;
      case 'is_not_empty': out[f.field] = { $is_not_null: true }; break;
      default: break;
    }
  }
  if (crossFilter && crossFilter.sourceId !== ownId) {
    out[crossFilter.field] = crossFilter.value;
  }
  return Object.keys(out).length ? out : undefined;
}

/**
 * pickLabelField — for groupBy widgets (bar, pie). Prefer explicit labelField,
 * then the first configured column, then a generic field. Never auto-detects
 * from records (we never have records).
 */
export function pickLabelField(comp: AppComponent): string {
  return comp.labelField || comp.columns?.[0] || comp.field || 'name';
}

export function pickXField(comp: AppComponent): string {
  return comp.xField || comp.labelField || 'created_at';
}

export function pickValueField(comp: AppComponent): string | undefined {
  const v = comp.valueField || comp.field;
  return v && v !== pickLabelField(comp) ? v : undefined;
}

export function pickTimeBucket(comp: AppComponent): TimeBucket {
  return comp.timeBucket || 'month';
}

/**
 * Resolve `comp.xAxisRange` (e.g. "last_24h") into a server filter on
 * `xField`. Computed at render time using the browser's clock; the chart
 * re-runs whenever the user reopens or refreshes.
 *
 * Returns undefined when no range is set or 'all_time' is selected.
 */
export function rangeToFilter(
  range: AppComponent['xAxisRange'],
  xField: string,
  customStart?: string,
  customEnd?: string,
  tz?: string,
): Record<string, unknown> | undefined {
  if (!range || range === 'all_time' || !xField) return undefined;
  const now = Date.now();
  const oneMin = 60 * 1000;
  const oneHour = 60 * oneMin;
  const oneDay = 24 * oneHour;
  // TZ is optional — without it, "today"/"this_week"/etc fall back to the
  // browser's local zone (legacy behavior). With it, calendar boundaries
  // are computed at midnight of the user's chosen timezone, regardless of
  // where their browser thinks it is.
  const tzMid = tz
    ? (d: Date) => tzMidnight(tz, d)
    : (d: Date) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
  const tzWeek = tz
    ? (d: Date) => tzWeekStart(tz, d)
    : (d: Date) => {
        const x = new Date(d); x.setHours(0, 0, 0, 0);
        const dow = x.getDay() || 7;
        x.setDate(x.getDate() - dow + 1);
        return x;
      };
  const tzMonth = tz
    ? (d: Date) => tzMonthStart(tz, d)
    : (d: Date) => { const x = new Date(d); x.setHours(0, 0, 0, 0); x.setDate(1); return x; };

  // Custom range short-circuits the preset switch.
  if (range === 'custom') {
    const out: Record<string, unknown> = {};
    if (customStart && customEnd) {
      out[xField] = { $gte: customStart, $lte: customEnd };
    } else if (customStart) {
      out[xField] = { $gte: customStart };
    } else if (customEnd) {
      out[xField] = { $lte: customEnd };
    } else {
      return undefined;
    }
    return out;
  }

  let from: number | null = null;
  let to: number | null = null;

  switch (range) {
    case 'last_15m': from = now - 15 * oneMin; break;
    case 'last_1h':  from = now - oneHour; break;
    case 'last_4h':  from = now - 4 * oneHour; break;
    case 'last_24h': from = now - oneDay; break;
    case 'last_7d':  from = now - 7 * oneDay; break;
    case 'last_30d': from = now - 30 * oneDay; break;
    case 'last_90d': from = now - 90 * oneDay; break;
    case 'last_year': from = now - 365 * oneDay; break;
    case 'today': {
      from = tzMid(new Date()).getTime();
      break;
    }
    case 'yesterday': {
      to = tzMid(new Date()).getTime();
      from = to - oneDay;
      break;
    }
    case 'this_week': {
      from = tzWeek(new Date()).getTime();
      break;
    }
    case 'this_month': {
      from = tzMonth(new Date()).getTime();
      break;
    }
    default: return undefined;
  }

  const out: Record<string, unknown> = {};
  if (from !== null && to !== null) {
    out[xField] = { $gte: new Date(from).toISOString(), $lte: new Date(to).toISOString() };
  } else if (from !== null) {
    out[xField] = { $gte: new Date(from).toISOString() };
  } else if (to !== null) {
    out[xField] = { $lte: new Date(to).toISOString() };
  }
  return out;
}

// ── EAV pattern detection (mirrors backend's _detect_eav_pattern) ──────────
// When the object type is in long-format / sensor shape, this lets the editor
// surface a friendly "Metric" picker instead of asking the user to manually
// add a `field = "rpm"` filter every time.

const ATTRIBUTE_NAME_HINTS = new Set([
  'field', 'metric', 'metric_name', 'metric_type', 'measurement', 'kpi',
  'attribute', 'attr', 'key', 'tag', 'type', 'reading_type', 'signal',
  'sensor_type', 'channel', 'param', 'parameter',
  // 'name' intentionally excluded — too generic
]);

const VALUE_NAME_HINTS = new Set([
  'value', 'val', 'reading', 'data', 'amount', 'measurement',
  'magnitude', 'quantity',
]);

const NUMERIC_RE = /^-?\d+(\.\d+)?$/;

export interface EavPattern {
  attributeCol: string;
  valueCol: string;
  metrics: string[];
}

/**
 * Returns the detected attribute / value column pair when the sample looks
 * like long-format / EAV data, else null. Same heuristic as the backend
 * (claude_client._detect_eav_pattern) — keep both in sync.
 */
export function detectEavPattern(sampleRows: Record<string, unknown>[]): EavPattern | null {
  if (!sampleRows || sampleRows.length < 5) return null;

  const distinct: Record<string, Set<string>> = {};
  const counts: Record<string, number> = {};
  for (const row of sampleRows) {
    if (!row) continue;
    for (const [k, v] of Object.entries(row)) {
      if (!(k in distinct)) {
        distinct[k] = new Set();
        counts[k] = 0;
      }
      if (v != null && v !== '') {
        distinct[k].add(String(v));
        counts[k] += 1;
      }
    }
  }

  // Find the attribute column
  let attrCol: string | null = null;
  for (const k of Object.keys(distinct)) {
    if (!ATTRIBUTE_NAME_HINTS.has(k.toLowerCase())) continue;
    const vals = distinct[k];
    if (vals.size < 2 || vals.size > 30) continue;
    if (![...vals].every((v) => v.length <= 40)) continue;
    const recurrence = counts[k] / Math.max(vals.size, 1);
    if (recurrence < 1.5) continue;
    attrCol = k;
    break;
  }
  if (!attrCol) return null;

  // Find the value column
  let valueCol: string | null = null;
  for (const k of Object.keys(distinct)) {
    if (k === attrCol) continue;
    if (!VALUE_NAME_HINTS.has(k.toLowerCase())) continue;
    const vals = distinct[k];
    if (vals.size === 0) continue;
    const numericCount = [...vals].filter((v) => NUMERIC_RE.test(v)).length;
    if (numericCount >= 1) {
      valueCol = k;
      break;
    }
  }
  if (!valueCol) return null;

  return {
    attributeCol: attrCol,
    valueCol: valueCol,
    metrics: [...distinct[attrCol]].sort(),
  };
}

/**
 * Apply a widget's numeric value transform (multiplier + decimals + unit
 * suffix) to a raw aggregated number. Returns the formatted string ready
 * to drop into a cell, label, or tooltip.
 *
 * When the widget has no transform configured, falls back to a sensible
 * default: thousands separators for integers ≥1000, two-decimal otherwise.
 */
export function applyValueFormat(
  raw: number | null | undefined,
  comp: { valueMultiplier?: number; valueDecimals?: number; valueUnit?: string },
): string {
  if (raw == null || Number.isNaN(raw)) return '—';
  const m = comp.valueMultiplier ?? 1;
  const v = raw * m;
  const hasFormat = comp.valueMultiplier != null
    || comp.valueDecimals != null
    || comp.valueUnit != null;
  let body: string;
  if (hasFormat) {
    const d = comp.valueDecimals ?? (Math.abs(v) >= 100 ? 0 : 2);
    body = v.toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d });
  } else {
    if (Math.abs(v) >= 1000) body = v.toLocaleString();
    else if (Math.abs(v) >= 1) body = v.toFixed(1);
    else body = v.toFixed(2);
  }
  return comp.valueUnit ? `${body}${comp.valueUnit}` : body;
}

/**
 * Sensible default time bucket for a given range, so the chart shows a
 * reasonable number of data points (~12–96) instead of either 2 or 10000.
 */
export function suggestedBucketForRange(range: AppComponent['xAxisRange']): TimeBucket | undefined {
  switch (range) {
    case 'last_15m': return 'minute';
    case 'last_1h':  return 'minute';
    case 'last_4h':  return '5_minutes';
    case 'last_24h': return 'hour';
    case 'today':    return 'hour';
    case 'yesterday':return 'hour';
    case 'this_week':return 'hour';
    case 'last_7d':  return 'hour';
    case 'last_30d': return 'day';
    case 'this_month':return 'day';
    case 'last_90d': return 'day';
    case 'last_year': return 'week';
    default: return undefined;
  }
}
