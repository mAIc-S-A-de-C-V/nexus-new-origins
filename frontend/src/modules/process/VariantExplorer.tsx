import React, { useEffect, useState } from 'react';
import { useProcessStore } from '../../store/processStore';

interface Props {
  objectTypeId: string;
  onSelectVariant?: (variantId: string) => void;
}

function ActivityChip({ activity, isRework }: { activity: string; isRework?: boolean }) {
  return (
    <div style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      padding: '2px 8px', borderRadius: 3,
      backgroundColor: '#EFF6FF', border: '1px solid #BFDBFE',
      fontSize: 10, fontWeight: 600, color: '#1E3A5F',
      textTransform: 'uppercase', letterSpacing: '0.04em',
      maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      flexShrink: 0,
    }}>
      {isRework && <span style={{ color: '#DC2626', marginRight: 2 }}>↩</span>}
      {activity.replace(/_/g, ' ').slice(0, 16)}
    </div>
  );
}

const Arrow = () => (
  <div style={{ color: '#CBD5E1', fontSize: 12, flexShrink: 0, paddingTop: 1 }}>→</div>
);

// Mini variant path diagram
const VariantPathDiagram: React.FC<{ activities: string[] }> = ({ activities }) => (
  <div style={{ display: 'flex', alignItems: 'center', gap: 0, padding: '12px 0', overflowX: 'auto' }}>
    {activities.map((act, i) => {
      const isFirst = i === 0;
      const isLast = i === activities.length - 1;
      const isRework = i > 0 && activities.indexOf(act) < i;
      return (
        <React.Fragment key={i}>
          {i > 0 && (
            <svg width="32" height="16" viewBox="0 0 32 16" style={{ flexShrink: 0 }}>
              <line x1="0" y1="8" x2="24" y2="8" stroke="#CBD5E1" strokeWidth="1.5" />
              <polygon points="24,4 32,8 24,12" fill="#CBD5E1" />
            </svg>
          )}
          <div style={{
            padding: '6px 12px', borderRadius: 6, flexShrink: 0,
            backgroundColor: isRework ? '#FEF2F2' : isFirst ? '#EFF6FF' : isLast ? '#F5F3FF' : '#F8FAFC',
            border: `1.5px solid ${isRework ? '#FECACA' : isFirst ? '#BFDBFE' : isLast ? '#DDD6FE' : '#E2E8F0'}`,
          }}>
            <div style={{
              fontSize: 10, fontWeight: 600,
              color: isRework ? '#DC2626' : isFirst ? '#1D4ED8' : isLast ? '#5B21B6' : '#1E3A5F',
            }}>
              {isRework && '↩ '}{act.replace(/_/g, ' ')}
            </div>
          </div>
        </React.Fragment>
      );
    })}
  </div>
);

export const VariantExplorer: React.FC<Props> = ({ objectTypeId, onSelectVariant }) => {
  const { variants, fetchVariants, loading, stats } = useProcessStore();
  const [expanded, setExpanded] = useState<string | null>(null);
  const [hidden, setHidden] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (objectTypeId) fetchVariants(objectTypeId);
  }, [objectTypeId]);

  const visible = variants.filter(v => !hidden.has(v.variant_id));
  const maxCount = Math.max(...visible.map(v => v.case_count), 1);

  const toggleHide = (vid: string) => {
    setHidden(prev => {
      const next = new Set(prev);
      if (next.has(vid)) next.delete(vid); else next.add(vid);
      return next;
    });
  };

  if (!variants.length && !loading) {
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#94A3B8', fontSize: 13 }}>
        No variant data available. Run pipelines to generate process events.
      </div>
    );
  }

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Header */}
      <div style={{ padding: '10px 20px', borderBottom: '1px solid #E2E8F0', backgroundColor: '#F8FAFC', display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
        <span style={{ fontSize: 12, color: '#64748B' }}>
          <strong style={{ color: '#0D1117' }}>{variants.length}</strong> variants across <strong style={{ color: '#0D1117' }}>{(stats?.total_cases ?? variants.reduce((s, v) => s + v.case_count, 0)).toLocaleString()}</strong> cases
        </span>
        {hidden.size > 0 && (
          <button
            onClick={() => setHidden(new Set())}
            style={{
              marginLeft: 'auto', height: 24, padding: '0 10px', borderRadius: 4,
              border: '1px solid #FECACA', backgroundColor: '#FEF2F2', color: '#DC2626',
              fontSize: 10, fontWeight: 600, cursor: 'pointer',
            }}
          >Show all ({hidden.size} hidden)</button>
        )}
      </div>

      {/* Column headers */}
      <div style={{
        display: 'grid', gridTemplateColumns: '32px 32px 1fr 80px 100px',
        padding: '6px 20px', backgroundColor: '#F8FAFC',
        borderBottom: '1px solid #E2E8F0', flexShrink: 0,
      }}>
        {['', '#', 'Path', 'Cases', 'Avg Duration'].map(h => (
          <div key={h || 'chk'} style={{ fontSize: 10, fontWeight: 600, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{h}</div>
        ))}
      </div>

      {/* Rows */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {variants.map((v) => {
          const isHidden = hidden.has(v.variant_id);
          const isExpanded = expanded === v.variant_id;
          return (
            <div key={v.variant_id}>
              <div
                onClick={() => { setExpanded(isExpanded ? null : v.variant_id); onSelectVariant?.(v.variant_id); }}
                style={{
                  display: 'grid', gridTemplateColumns: '32px 32px 1fr 80px 100px',
                  padding: '10px 20px', borderBottom: '1px solid #F1F5F9',
                  cursor: 'pointer',
                  opacity: isHidden ? 0.35 : 1,
                  backgroundColor: isExpanded ? '#F8FAFC' : '#FFFFFF',
                  transition: 'background 80ms, opacity 150ms',
                }}
              >
                {/* Toggle */}
                <div style={{ paddingTop: 4 }}>
                  <input
                    type="checkbox"
                    checked={!isHidden}
                    onChange={e => { e.stopPropagation(); toggleHide(v.variant_id); }}
                    onClick={e => e.stopPropagation()}
                    style={{ cursor: 'pointer', accentColor: '#6366F1' }}
                    title={isHidden ? 'Show this variant' : 'Hide this variant'}
                  />
                </div>

                {/* Rank */}
                <div style={{ fontSize: 11, color: '#94A3B8', fontFamily: 'var(--font-mono)', paddingTop: 4 }}>{v.rank}</div>

                {/* Path */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'nowrap', overflow: 'hidden' }}>
                    {v.is_rework && (
                      <span style={{ fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 2, backgroundColor: '#FEF2F2', color: '#DC2626', border: '1px solid #FECACA', flexShrink: 0 }}>REWORK</span>
                    )}
                    {v.is_skip && !v.is_rework && (
                      <span style={{ fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 2, backgroundColor: '#FEFCE8', color: '#92400E', border: '1px solid #FDE68A', flexShrink: 0 }}>SKIP</span>
                    )}
                    {v.activities.slice(0, 5).map((act, i) => (
                      <React.Fragment key={i}>
                        {i > 0 && <Arrow />}
                        <ActivityChip activity={act} />
                      </React.Fragment>
                    ))}
                    {v.activities.length > 5 && (
                      <span style={{ fontSize: 10, color: '#94A3B8' }}>+{v.activities.length - 5} more</span>
                    )}
                  </div>
                  {/* Frequency bar */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{ flex: 1, maxWidth: 200, height: 4, backgroundColor: '#E2E8F0', borderRadius: 2 }}>
                      <div style={{ height: '100%', width: `${(v.case_count / maxCount) * 100}%`, backgroundColor: '#1E3A5F', borderRadius: 2 }} />
                    </div>
                    <span style={{ fontSize: 10, color: '#94A3B8', fontFamily: 'var(--font-mono)' }}>{v.frequency_pct}%</span>
                  </div>
                </div>

                {/* Cases */}
                <div style={{ fontSize: 12, fontWeight: 600, color: '#0D1117', fontFamily: 'var(--font-mono)', paddingTop: 4 }}>
                  {v.case_count.toLocaleString()}
                </div>

                {/* Avg duration */}
                <div style={{ fontSize: 12, color: '#64748B', fontFamily: 'var(--font-mono)', paddingTop: 4 }}>
                  {v.avg_duration_days.toFixed(1)}d
                </div>
              </div>

              {/* Expanded detail */}
              {isExpanded && !isHidden && (
                <div style={{ padding: '12px 20px 16px', backgroundColor: '#F8FAFC', borderBottom: '2px solid #E2E8F0' }}>
                  {/* Visual path diagram */}
                  <VariantPathDiagram activities={v.activities} />

                  {/* Stats */}
                  <div style={{ display: 'flex', gap: 20, marginTop: 8, fontSize: 11, color: '#64748B' }}>
                    <span>Min: <strong style={{ color: '#0D1117', fontFamily: 'var(--font-mono)' }}>{v.min_duration_days.toFixed(1)}d</strong></span>
                    <span>Avg: <strong style={{ color: '#0D1117', fontFamily: 'var(--font-mono)' }}>{v.avg_duration_days.toFixed(1)}d</strong></span>
                    <span>Max: <strong style={{ color: '#0D1117', fontFamily: 'var(--font-mono)' }}>{v.max_duration_days.toFixed(1)}d</strong></span>
                    <span>Cases: <strong style={{ color: '#0D1117', fontFamily: 'var(--font-mono)' }}>{v.case_count.toLocaleString()}</strong></span>
                    <span>Steps: <strong style={{ color: '#0D1117', fontFamily: 'var(--font-mono)' }}>{v.activities.length}</strong></span>
                  </div>

                  {/* Throughput time distribution */}
                  {v.max_duration_days > 0 && (() => {
                    const min = v.min_duration_days;
                    const avg = v.avg_duration_days;
                    const max = v.max_duration_days;
                    const range = max - min || 1;
                    const bucketCount = 8;
                    const bucketSize = range / bucketCount;
                    const buckets = Array.from({ length: bucketCount }, (_, i) => {
                      const lo = min + i * bucketSize;
                      const hi = lo + bucketSize;
                      const mid = (lo + hi) / 2;
                      const sigma = range * 0.3;
                      const weight = Math.exp(-0.5 * ((mid - avg) / sigma) ** 2);
                      return { lo, hi, weight: Math.round(weight * v.case_count) };
                    });
                    const maxWeight = Math.max(...buckets.map(b => b.weight), 1);
                    const barW = 24;
                    const gap = 2;

                    return (
                      <div style={{ marginTop: 12 }}>
                        <div style={{ fontSize: 10, fontWeight: 600, color: '#64748B', marginBottom: 6 }}>Duration Distribution (estimated)</div>
                        <svg width={bucketCount * (barW + gap)} height={60} style={{ display: 'block' }}>
                          {buckets.map((b, i) => {
                            const h = (b.weight / maxWeight) * 44;
                            const x = i * (barW + gap);
                            const isAvgBucket = b.lo <= avg && avg <= b.hi;
                            return (
                              <g key={i}>
                                <rect x={x} y={44 - h} width={barW} height={h} rx={2} fill={isAvgBucket ? '#6366F1' : '#94A3B8'} opacity={0.7} />
                                <text x={x + barW / 2} y={56} textAnchor="middle" fontSize={7} fill="#94A3B8">
                                  {b.lo.toFixed(0)}d
                                </text>
                              </g>
                            );
                          })}
                        </svg>
                      </div>
                    );
                  })()}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
