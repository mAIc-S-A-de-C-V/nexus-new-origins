import { describe, it, expect } from 'vitest';
import {
  buildServerFilters,
  pickLabelField,
  pickXField,
  pickValueField,
  pickTimeBucket,
} from './queryBuilder';
import type { AppComponent, AppFilter } from '../../types/app';

describe('buildServerFilters', () => {
  const id = 'widget-1';

  it('returns undefined when there are no filters and no cross-filter', () => {
    expect(buildServerFilters(undefined, null, id)).toBeUndefined();
    expect(buildServerFilters([], null, id)).toBeUndefined();
  });

  it('encodes simple eq filters', () => {
    const f: AppFilter[] = [{ id: 'f1', field: 'status', operator: 'eq', value: 'active' }];
    expect(buildServerFilters(f, null, id)).toEqual({ status: 'active' });
  });

  it('encodes operator filters with $ prefix and numeric coercion', () => {
    const f: AppFilter[] = [
      { id: 'f1', field: 'amount', operator: 'gt', value: '100' },
      { id: 'f2', field: 'amount', operator: 'lte', value: '500' },
    ];
    // The second write to `amount` overwrites the first — that's the documented
    // behavior; multi-bound filters on the same field must be encoded by the AI
    // as separate fields or we need a different shape.
    expect(buildServerFilters(f, null, id)).toEqual({ amount: { $lte: 500 } });
  });

  it('encodes after/before as $gte/$lte with the raw string', () => {
    const f: AppFilter[] = [
      { id: 'f1', field: 'created_at', operator: 'after', value: '2026-01-01T00:00:00' },
    ];
    expect(buildServerFilters(f, null, id)).toEqual({
      created_at: { $gte: '2026-01-01T00:00:00' },
    });
  });

  it('encodes contains as $contains', () => {
    const f: AppFilter[] = [{ id: 'f1', field: 'name', operator: 'contains', value: 'foo' }];
    expect(buildServerFilters(f, null, id)).toEqual({ name: { $contains: 'foo' } });
  });

  it('encodes is_empty / is_not_empty without a value', () => {
    const f: AppFilter[] = [
      { id: 'f1', field: 'a', operator: 'is_empty', value: '' },
      { id: 'f2', field: 'b', operator: 'is_not_empty', value: '' },
    ];
    expect(buildServerFilters(f, null, id)).toEqual({
      a: { $is_null: true },
      b: { $is_not_null: true },
    });
  });

  it('skips filters with empty value (except unary ops)', () => {
    const f: AppFilter[] = [
      { id: 'f1', field: 'status', operator: 'eq', value: '' },
      { id: 'f2', field: 'name', operator: 'is_empty', value: '' },
    ];
    expect(buildServerFilters(f, null, id)).toEqual({ name: { $is_null: true } });
  });

  it('appends the cross-filter when it did not originate from this widget', () => {
    const cross = { field: 'department', value: 'Sales', sourceId: 'widget-2' };
    expect(buildServerFilters([], cross, 'widget-1')).toEqual({ department: 'Sales' });
  });

  it('does NOT append the cross-filter when it originated from this widget', () => {
    const cross = { field: 'department', value: 'Sales', sourceId: 'widget-1' };
    expect(buildServerFilters([], cross, 'widget-1')).toBeUndefined();
  });

  it('cross-filter overrides own filter on the same field', () => {
    const f: AppFilter[] = [{ id: 'f1', field: 'department', operator: 'eq', value: 'Engineering' }];
    const cross = { field: 'department', value: 'Sales', sourceId: 'widget-2' };
    expect(buildServerFilters(f, cross, 'widget-1')).toEqual({ department: 'Sales' });
  });

  it('encodes "in" operator from comma-separated value', () => {
    const f: AppFilter[] = [{ id: 'f1', field: 'metric', operator: 'in', value: 'rpm, running, temp' }];
    expect(buildServerFilters(f, null, id)).toEqual({
      metric: { $in: ['rpm', 'running', 'temp'] },
    });
  });

  it('"in" with whitespace and trailing commas is normalized', () => {
    const f: AppFilter[] = [{ id: 'f1', field: 'metric', operator: 'in', value: '  rpm , running ,, temp,  ' }];
    expect(buildServerFilters(f, null, id)).toEqual({
      metric: { $in: ['rpm', 'running', 'temp'] },
    });
  });

  it('"in" with empty value is skipped', () => {
    const f: AppFilter[] = [{ id: 'f1', field: 'metric', operator: 'in', value: '   ,  ' }];
    expect(buildServerFilters(f, null, id)).toBeUndefined();
  });

  it('encodes "not_in" as $not_in', () => {
    const f: AppFilter[] = [{ id: 'f1', field: 'status', operator: 'not_in', value: 'cancelled, refunded' }];
    expect(buildServerFilters(f, null, id)).toEqual({
      status: { $not_in: ['cancelled', 'refunded'] },
    });
  });
});

describe('pickLabelField', () => {
  it('prefers labelField, then columns[0], then field, then default', () => {
    expect(pickLabelField({ id: '1', type: 'bar-chart', title: '', labelField: 'a' } as AppComponent)).toBe('a');
    expect(pickLabelField({ id: '1', type: 'bar-chart', title: '', columns: ['b', 'c'] } as AppComponent)).toBe('b');
    expect(pickLabelField({ id: '1', type: 'bar-chart', title: '', field: 'd' } as AppComponent)).toBe('d');
    expect(pickLabelField({ id: '1', type: 'bar-chart', title: '' } as AppComponent)).toBe('name');
  });
});

describe('pickXField', () => {
  it('prefers xField, then labelField, then created_at', () => {
    expect(pickXField({ id: '1', type: 'line-chart', title: '', xField: 'updated_at' } as AppComponent)).toBe('updated_at');
    expect(pickXField({ id: '1', type: 'line-chart', title: '', labelField: 'l' } as AppComponent)).toBe('l');
    expect(pickXField({ id: '1', type: 'line-chart', title: '' } as AppComponent)).toBe('created_at');
  });
});

describe('pickValueField', () => {
  it('returns undefined when valueField equals labelField (count mode)', () => {
    expect(pickValueField({ id: '1', type: 'bar-chart', title: '', labelField: 'x', valueField: 'x' } as AppComponent)).toBeUndefined();
  });

  it('prefers valueField over field', () => {
    expect(pickValueField({ id: '1', type: 'bar-chart', title: '', valueField: 'amount', field: 'fee' } as AppComponent)).toBe('amount');
  });

  it('falls back to field when valueField is missing AND a labelField is set (so they differ)', () => {
    // When only `field` is set, pickLabelField also returns it, so we treat the
    // widget as count-mode. With a distinct labelField, `field` becomes the value.
    expect(pickValueField({ id: '1', type: 'bar-chart', title: '', labelField: 'category', field: 'amount' } as AppComponent)).toBe('amount');
  });

  it('returns undefined when only `field` is set (counts as label, count mode)', () => {
    expect(pickValueField({ id: '1', type: 'bar-chart', title: '', field: 'amount' } as AppComponent)).toBeUndefined();
  });

  it('returns undefined when neither is set', () => {
    expect(pickValueField({ id: '1', type: 'bar-chart', title: '' } as AppComponent)).toBeUndefined();
  });
});

describe('pickTimeBucket', () => {
  it('defaults to month', () => {
    expect(pickTimeBucket({ id: '1', type: 'line-chart', title: '' } as AppComponent)).toBe('month');
  });

  it('respects explicit timeBucket', () => {
    expect(pickTimeBucket({ id: '1', type: 'line-chart', title: '', timeBucket: 'day' } as AppComponent)).toBe('day');
  });
});
