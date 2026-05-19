/**
 * Visual editor for an AggregationSpec.window — running totals, rolling
 * averages, lag/lead, ranks. The /aggregate endpoint accepts these as
 * native window functions; this component just builds the WindowSpec
 * object the request body needs.
 *
 * Designed to surface in the ConfigPanel under an "Advanced" section
 * for any widget whose aggregation is windowable. When the user toggles
 * "Make this a running total" on, the parent widget's `comp.window`
 * gets populated; toggling off clears it.
 */
import React from 'react';
import type { AppComponent, WindowSpec } from '../../../types/app';

interface Props {
  comp: AppComponent;
  onChange: (window: WindowSpec | undefined) => void;
  /** Choices the user can pick for partition_by and order_by.field —
   *  typically "grp", "series", and "agg_0".."agg_N" based on the
   *  widget's other config. */
  availableSources: string[];
}

const FRAME_LABELS: Record<NonNullable<WindowSpec['frame_mode']>, string> = {
  cumulative: 'Cumulative (running total)',
  rolling: 'Rolling N (moving average / sum)',
  all: 'Whole partition (rank / lag / lead)',
};

export const WindowConfig: React.FC<Props> = ({ comp, onChange, availableSources }) => {
  const window = comp.window;
  const enabled = !!window;

  const update = (patch: Partial<WindowSpec>) => {
    onChange({ ...(window ?? { frame_mode: 'cumulative' }), ...patch });
  };

  const toggle = () => {
    if (enabled) {
      onChange(undefined);
    } else {
      // Sensible defaults for a time-series running total.
      onChange({
        frame_mode: 'cumulative',
        partition_by: [],
        order_by: [{ field: 'grp', dir: 'asc' }],
      });
    }
  };

  return (
    <div style={{
      border: '1px solid #E2E8F0',
      borderRadius: 6,
      padding: 10,
      backgroundColor: '#F8FAFC',
      display: 'flex', flexDirection: 'column', gap: 8,
    }}>
      <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 500, cursor: 'pointer' }}>
        <input type="checkbox" checked={enabled} onChange={toggle} />
        Make this a window function
      </label>
      {enabled && window && (
        <>
          <div>
            <label style={{ fontSize: 11, color: '#475569', display: 'block', marginBottom: 3 }}>Frame</label>
            <select
              value={window.frame_mode ?? 'cumulative'}
              onChange={(e) => update({ frame_mode: e.target.value as WindowSpec['frame_mode'] })}
              style={selectStyle}
            >
              {(Object.keys(FRAME_LABELS) as (keyof typeof FRAME_LABELS)[]).map((k) => (
                <option key={k} value={k}>{FRAME_LABELS[k]}</option>
              ))}
            </select>
          </div>
          {window.frame_mode === 'rolling' && (
            <div>
              <label style={{ fontSize: 11, color: '#475569', display: 'block', marginBottom: 3 }}>Rolling window (rows)</label>
              <input
                type="number"
                min={1}
                value={window.frame_rows ?? 7}
                onChange={(e) => update({ frame_rows: Math.max(1, Number(e.target.value)) })}
                style={selectStyle}
              />
            </div>
          )}
          {(comp.aggregation === 'lag' || comp.aggregation === 'lead') && (
            <div>
              <label style={{ fontSize: 11, color: '#475569', display: 'block', marginBottom: 3 }}>Offset</label>
              <input
                type="number"
                min={1}
                value={window.offset ?? 1}
                onChange={(e) => update({ offset: Math.max(1, Number(e.target.value)) })}
                style={selectStyle}
              />
            </div>
          )}
          <div>
            <label style={{ fontSize: 11, color: '#475569', display: 'block', marginBottom: 3 }}>Partition by (optional)</label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
              {availableSources.map((src) => {
                const on = (window.partition_by ?? []).includes(src);
                return (
                  <button
                    key={src}
                    type="button"
                    onClick={() => {
                      const cur = window.partition_by ?? [];
                      const next = on ? cur.filter((s) => s !== src) : [...cur, src];
                      update({ partition_by: next });
                    }}
                    style={{
                      padding: '3px 8px',
                      borderRadius: 12,
                      border: `1px solid ${on ? '#7C3AED' : '#CBD5E1'}`,
                      backgroundColor: on ? '#EDE9FE' : '#fff',
                      color: on ? '#5B21B6' : '#475569',
                      fontSize: 11,
                      cursor: 'pointer',
                    }}
                  >
                    {src}
                  </button>
                );
              })}
            </div>
          </div>
          <div>
            <label style={{ fontSize: 11, color: '#475569', display: 'block', marginBottom: 3 }}>Order by</label>
            <div style={{ display: 'flex', gap: 6 }}>
              <select
                value={(window.order_by?.[0]?.field) ?? 'grp'}
                onChange={(e) => update({ order_by: [{ field: e.target.value, dir: window.order_by?.[0]?.dir ?? 'asc' }] })}
                style={{ ...selectStyle, flex: 1 }}
              >
                {availableSources.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
              <select
                value={(window.order_by?.[0]?.dir) ?? 'asc'}
                onChange={(e) => update({ order_by: [{ field: window.order_by?.[0]?.field ?? 'grp', dir: e.target.value as 'asc' | 'desc' }] })}
                style={{ ...selectStyle, width: 90 }}
              >
                <option value="asc">asc</option>
                <option value="desc">desc</option>
              </select>
            </div>
          </div>
          <div style={{ fontSize: 10, color: '#94A3B8', lineHeight: 1.4 }}>
            For a running total per project over time: aggregation = sum, frame =
            cumulative, partition_by = [series], order_by = grp asc. The
            aggregation field must reference an inner column —
            <code> agg_0 </code>(an earlier non-windowed aggregation),
            <code> grp </code>(the time bucket), or
            <code> series </code>(the group_by dimension).
          </div>
        </>
      )}
    </div>
  );
};

const selectStyle: React.CSSProperties = {
  width: '100%',
  padding: '5px 8px',
  border: '1px solid #CBD5E1',
  borderRadius: 4,
  fontSize: 12,
  backgroundColor: '#fff',
  boxSizing: 'border-box',
};
