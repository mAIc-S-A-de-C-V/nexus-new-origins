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

export const VariantExplorer: React.FC<Props> = ({ objectTypeId, onSelectVariant }) => {
  const { variants, fetchVariants, loading } = useProcessStore();
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    if (objectTypeId) fetchVariants(objectTypeId);
  }, [objectTypeId]);

  const maxCount = Math.max(...variants.map(v => v.case_count), 1);

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
      <div style={{ padding: '12px 20px', borderBottom: '1px solid #E2E8F0', backgroundColor: '#F8FAFC', display: 'flex', alignItems: 'center', gap: 16, flexShrink: 0 }}>
        <span style={{ fontSize: 12, color: '#64748B' }}>
          <strong style={{ color: '#0D1117' }}>{variants.length}</strong> variants across <strong style={{ color: '#0D1117' }}>{variants.reduce((s, v) => s + v.case_count, 0).toLocaleString()}</strong> cases
        </span>
      </div>

      {/* Column headers */}
      <div style={{
        display: 'grid', gridTemplateColumns: '32px 1fr 80px 100px',
        padding: '6px 20px', backgroundColor: '#F8FAFC',
        borderBottom: '1px solid #E2E8F0', flexShrink: 0,
      }}>
        {['#', 'Path', 'Cases', 'Avg Duration'].map(h => (
          <div key={h} style={{ fontSize: 10, fontWeight: 600, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{h}</div>
        ))}
      </div>

      {/* Rows */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {variants.map((v) => (
          <div key={v.variant_id}>
            <div
              onClick={() => { setExpanded(expanded === v.variant_id ? null : v.variant_id); onSelectVariant?.(v.variant_id); }}
              style={{
                display: 'grid', gridTemplateColumns: '32px 1fr 80px 100px',
                padding: '10px 20px', borderBottom: '1px solid #F1F5F9',
                cursor: 'pointer', backgroundColor: expanded === v.variant_id ? '#F8FAFC' : '#FFFFFF',
                transition: 'background 80ms',
              }}
            >
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
            {expanded === v.variant_id && (
              <div style={{ padding: '10px 52px 12px', backgroundColor: '#F8FAFC', borderBottom: '1px solid #E2E8F0' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
                  {v.activities.map((act, i) => (
                    <React.Fragment key={i}>
                      {i > 0 && <Arrow />}
                      <ActivityChip activity={act} isRework={i > 0 && v.activities.indexOf(act) < i} />
                    </React.Fragment>
                  ))}
                </div>
                <div style={{ display: 'flex', gap: 20, marginTop: 10, fontSize: 11, color: '#64748B' }}>
                  <span>Min: <strong style={{ color: '#0D1117', fontFamily: 'var(--font-mono)' }}>{v.min_duration_days.toFixed(1)}d</strong></span>
                  <span>Avg: <strong style={{ color: '#0D1117', fontFamily: 'var(--font-mono)' }}>{v.avg_duration_days.toFixed(1)}d</strong></span>
                  <span>Max: <strong style={{ color: '#0D1117', fontFamily: 'var(--font-mono)' }}>{v.max_duration_days.toFixed(1)}d</strong></span>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};
