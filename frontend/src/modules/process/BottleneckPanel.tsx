import React, { useEffect, useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { useProcessStore } from '../../store/processStore';
import { getTenantId } from '../../store/authStore';

const PROCESS_API = import.meta.env.VITE_PROCESS_ENGINE_URL || 'http://localhost:8009';

interface Bottleneck {
  from_activity: string;
  to_activity: string;
  case_count: number;
  avg_hours: number;
  max_hours: number;
  p95_hours: number;
}

interface Props {
  objectTypeId: string;
}

function buildQs(eventConfig: { excluded_activities: string[]; activity_labels: Record<string, string>; activity_attribute?: string; case_id_attribute?: string; timestamp_attribute?: string }, dateRange: { start: string; end: string } | null) {
  const params = new URLSearchParams();
  if (eventConfig.excluded_activities.length > 0) params.set('excluded', eventConfig.excluded_activities.join(','));
  if (eventConfig.activity_attribute) params.set('activity_attribute', eventConfig.activity_attribute);
  if (eventConfig.case_id_attribute) params.set('case_id_attribute', eventConfig.case_id_attribute);
  if (eventConfig.timestamp_attribute) params.set('timestamp_attribute', eventConfig.timestamp_attribute);
  if (dateRange?.start) params.set('start_date', dateRange.start);
  if (dateRange?.end) params.set('end_date', dateRange.end);
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

const fmtTime = (h: number) => h < 1 ? `${Math.round(h * 60)}m` : h < 24 ? `${h.toFixed(1)}h` : `${(h / 24).toFixed(1)}d`;

// Mini 2-node transition diagram
const MiniTransitionMap: React.FC<{ bottleneck: Bottleneck }> = ({ bottleneck: b }) => (
  <div style={{ display: 'flex', alignItems: 'center', gap: 0, padding: '16px 20px' }}>
    {/* From node */}
    <div style={{
      padding: '10px 16px', backgroundColor: '#EFF6FF', border: '1.5px solid #BFDBFE',
      borderRadius: 8, minWidth: 120, textAlign: 'center',
    }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: '#1E3A5F' }}>{b.from_activity.replace(/_/g, ' ')}</div>
    </div>
    {/* Arrow with time */}
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '0 8px', minWidth: 100 }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: '#DC2626', fontFamily: 'var(--font-mono)', marginBottom: 2 }}>
        avg {fmtTime(b.avg_hours)}
      </div>
      <svg width="100" height="16" viewBox="0 0 100 16">
        <line x1="0" y1="8" x2="88" y2="8" stroke="#DC2626" strokeWidth="2" />
        <polygon points="88,3 100,8 88,13" fill="#DC2626" />
      </svg>
      <div style={{ fontSize: 9, color: '#94A3B8', marginTop: 2 }}>
        p95: {fmtTime(b.p95_hours)} · max: {fmtTime(b.max_hours)}
      </div>
    </div>
    {/* To node */}
    <div style={{
      padding: '10px 16px', backgroundColor: '#F5F3FF', border: '1.5px solid #DDD6FE',
      borderRadius: 8, minWidth: 120, textAlign: 'center',
    }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: '#5B21B6' }}>{b.to_activity.replace(/_/g, ' ')}</div>
    </div>
    {/* Stats sidebar */}
    <div style={{ marginLeft: 24, display: 'flex', gap: 16 }}>
      <div>
        <div style={{ fontSize: 9, color: '#94A3B8', textTransform: 'uppercase', fontWeight: 600 }}>Cases</div>
        <div style={{ fontSize: 16, fontWeight: 700, color: '#1E3A5F', fontFamily: 'var(--font-mono)' }}>{b.case_count.toLocaleString()}</div>
      </div>
      <div>
        <div style={{ fontSize: 9, color: '#94A3B8', textTransform: 'uppercase', fontWeight: 600 }}>Avg</div>
        <div style={{ fontSize: 16, fontWeight: 700, color: '#DC2626', fontFamily: 'var(--font-mono)' }}>{fmtTime(b.avg_hours)}</div>
      </div>
      <div>
        <div style={{ fontSize: 9, color: '#94A3B8', textTransform: 'uppercase', fontWeight: 600 }}>P95</div>
        <div style={{ fontSize: 16, fontWeight: 700, color: '#7C3AED', fontFamily: 'var(--font-mono)' }}>{fmtTime(b.p95_hours)}</div>
      </div>
    </div>
  </div>
);

export const BottleneckPanel: React.FC<Props> = ({ objectTypeId }) => {
  const { eventConfig, dateRange } = useProcessStore();
  const [bottlenecks, setBottlenecks] = useState<Bottleneck[]>([]);
  const [loading, setLoading] = useState(false);
  const [hidden, setHidden] = useState<Set<number>>(new Set());
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);

  useEffect(() => {
    if (!objectTypeId) return;
    setLoading(true);
    setHidden(new Set());
    setExpandedIdx(null);
    const qs = buildQs(eventConfig, dateRange);
    fetch(`${PROCESS_API}/process/bottlenecks/${objectTypeId}${qs}`, {
      headers: { 'x-tenant-id': getTenantId() },
    })
      .then(r => r.json())
      .then(data => setBottlenecks(data.bottlenecks || []))
      .catch(() => setBottlenecks([]))
      .finally(() => setLoading(false));
  }, [objectTypeId, eventConfig, dateRange]);

  if (loading) {
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#94A3B8', fontSize: 13 }}>
        Loading bottlenecks...
      </div>
    );
  }

  if (!bottlenecks.length) {
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#94A3B8', fontSize: 13 }}>
        No bottleneck data available
      </div>
    );
  }

  const visible = bottlenecks.filter((_, i) => !hidden.has(i));
  const chartData = visible.slice(0, 10).map(b => ({
    name: `${b.from_activity.replace(/_/g, ' ')} → ${b.to_activity.replace(/_/g, ' ')}`,
    avg: b.avg_hours,
    p95: b.p95_hours,
  }));

  const toggleHide = (idx: number) => {
    setHidden(prev => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx); else next.add(idx);
      return next;
    });
  };

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Header */}
      <div style={{ padding: '12px 20px', borderBottom: '1px solid #E2E8F0', flexShrink: 0, display: 'flex', alignItems: 'center', gap: 12 }}>
        <div>
          <h2 style={{ fontSize: 14, fontWeight: 600, color: '#0D1117', margin: 0 }}>Bottleneck Analysis</h2>
          <p style={{ fontSize: 11, color: '#64748B', margin: '2px 0 0' }}>
            Slowest transitions ranked by average time. Click a row to inspect, toggle off to surface the next.
          </p>
        </div>
        {hidden.size > 0 && (
          <button
            onClick={() => setHidden(new Set())}
            style={{
              marginLeft: 'auto', height: 26, padding: '0 10px', borderRadius: 4,
              border: '1px solid #FECACA', backgroundColor: '#FEF2F2', color: '#DC2626',
              fontSize: 10, fontWeight: 600, cursor: 'pointer',
            }}
          >Show all ({hidden.size} hidden)</button>
        )}
      </div>

      <div style={{ flex: 1, overflow: 'auto', padding: '16px 20px' }}>
        {/* Chart */}
        {visible.length > 0 && (
          <div style={{ height: 240, marginBottom: 20, backgroundColor: '#F8FAFC', borderRadius: 8, border: '1px solid #E2E8F0', padding: '12px 8px 8px' }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} layout="vertical" margin={{ left: 160, right: 20 }}>
                <XAxis type="number" tick={{ fontSize: 10, fill: '#94A3B8' }} axisLine={false} tickLine={false} tickFormatter={v => fmtTime(v)} />
                <YAxis type="category" dataKey="name" tick={{ fontSize: 10, fill: '#64748B' }} width={150} axisLine={false} tickLine={false} />
                <Tooltip
                  formatter={(value) => fmtTime(Number(value))}
                  contentStyle={{ fontSize: 11, borderRadius: 4, border: '1px solid #E2E8F0' }}
                />
                <Bar dataKey="avg" name="Avg Time" fill="#6366F1" radius={[0, 4, 4, 0]} barSize={12} />
                <Bar dataKey="p95" name="P95 Time" fill="#7C3AED" radius={[0, 4, 4, 0]} barSize={12} opacity={0.5} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* Table */}
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr style={{ borderBottom: '2px solid #E2E8F0' }}>
              <th style={{ width: 32, padding: '8px 6px' }} />
              <th style={{ textAlign: 'left', padding: '8px 12px', color: '#64748B', fontWeight: 600, fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.05em' }}>#</th>
              <th style={{ textAlign: 'left', padding: '8px 12px', color: '#64748B', fontWeight: 600, fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Transition</th>
              <th style={{ textAlign: 'right', padding: '8px 12px', color: '#64748B', fontWeight: 600, fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Cases</th>
              <th style={{ textAlign: 'right', padding: '8px 12px', color: '#64748B', fontWeight: 600, fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Avg Time</th>
              <th style={{ textAlign: 'right', padding: '8px 12px', color: '#64748B', fontWeight: 600, fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.05em' }}>P95 Time</th>
              <th style={{ textAlign: 'right', padding: '8px 12px', color: '#64748B', fontWeight: 600, fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Max Time</th>
            </tr>
          </thead>
          <tbody>
            {bottlenecks.map((b, i) => {
              const isHidden = hidden.has(i);
              const isExpanded = expandedIdx === i;
              return (
                <React.Fragment key={i}>
                  <tr
                    style={{
                      borderBottom: '1px solid #F1F5F9',
                      opacity: isHidden ? 0.35 : 1,
                      backgroundColor: isExpanded ? '#F8FAFC' : '#FFFFFF',
                      cursor: 'pointer',
                      transition: 'background 80ms',
                    }}
                    onClick={() => setExpandedIdx(isExpanded ? null : i)}
                  >
                    {/* Toggle visibility */}
                    <td style={{ padding: '8px 6px', textAlign: 'center' }}>
                      <input
                        type="checkbox"
                        checked={!isHidden}
                        onChange={e => { e.stopPropagation(); toggleHide(i); }}
                        onClick={e => e.stopPropagation()}
                        style={{ cursor: 'pointer', accentColor: '#6366F1' }}
                        title={isHidden ? 'Show this bottleneck' : 'Hide this bottleneck'}
                      />
                    </td>
                    <td style={{ padding: '10px 12px', color: '#94A3B8', fontFamily: 'var(--font-mono)', fontSize: 11 }}>{i + 1}</td>
                    <td style={{ padding: '10px 12px', color: '#0D1117', fontWeight: 500 }}>
                      {b.from_activity.replace(/_/g, ' ')} <span style={{ color: '#94A3B8' }}>→</span> {b.to_activity.replace(/_/g, ' ')}
                    </td>
                    <td style={{ padding: '10px 12px', textAlign: 'right', fontFamily: 'var(--font-mono)', color: '#0D1117' }}>{b.case_count.toLocaleString()}</td>
                    <td style={{ padding: '10px 12px', textAlign: 'right', fontFamily: 'var(--font-mono)', color: '#DC2626', fontWeight: 600 }}>{fmtTime(b.avg_hours)}</td>
                    <td style={{ padding: '10px 12px', textAlign: 'right', fontFamily: 'var(--font-mono)', color: '#7C3AED' }}>{fmtTime(b.p95_hours)}</td>
                    <td style={{ padding: '10px 12px', textAlign: 'right', fontFamily: 'var(--font-mono)', color: '#94A3B8' }}>{fmtTime(b.max_hours)}</td>
                  </tr>
                  {/* Expanded detail: mini transition map */}
                  {isExpanded && !isHidden && (
                    <tr>
                      <td colSpan={7} style={{ padding: 0, backgroundColor: '#F8FAFC', borderBottom: '2px solid #E2E8F0' }}>
                        <MiniTransitionMap bottleneck={b} />
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};
