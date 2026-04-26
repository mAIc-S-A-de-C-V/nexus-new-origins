/**
 * Pure helpers for translating widget config + cross-filter state into the
 * shape of queries the server `/aggregate` and `/records` endpoints accept.
 *
 * Kept side-effect-free and free of React so we can unit-test them.
 */
import type { AppComponent, AppFilter } from '../../types/app';

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
): Record<string, unknown> | undefined {
  if (!range || range === 'all_time' || !xField) return undefined;
  const now = Date.now();
  const oneMin = 60 * 1000;
  const oneHour = 60 * oneMin;
  const oneDay = 24 * oneHour;

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
    case 'today': {
      const d = new Date(); d.setHours(0, 0, 0, 0);
      from = d.getTime();
      break;
    }
    case 'yesterday': {
      const d = new Date(); d.setHours(0, 0, 0, 0);
      to = d.getTime();
      from = to - oneDay;
      break;
    }
    case 'this_week': {
      const d = new Date(); d.setHours(0, 0, 0, 0);
      const day = d.getDay() || 7; // 1=Mon, 7=Sun
      d.setDate(d.getDate() - day + 1);
      from = d.getTime();
      break;
    }
    case 'this_month': {
      const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(1);
      from = d.getTime();
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
    default: return undefined;
  }
}
