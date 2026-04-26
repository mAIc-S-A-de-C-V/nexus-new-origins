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
