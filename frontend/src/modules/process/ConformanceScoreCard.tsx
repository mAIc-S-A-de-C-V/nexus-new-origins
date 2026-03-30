import React from 'react';
import { ConformanceCheckResult } from '../../store/conformanceStore';

interface Props {
  result: ConformanceCheckResult;
}

const fitnessColor = (f: number) =>
  f >= 0.85 ? '#10B981' : f >= 0.6 ? '#F59E0B' : '#EF4444';

const FitnessBar: React.FC<{ value: number; label: string }> = ({ value, label }) => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#64748B' }}>
      <span>{label}</span>
      <span style={{ fontFamily: 'var(--font-mono)', color: fitnessColor(value), fontWeight: 600 }}>
        {(value * 100).toFixed(0)}%
      </span>
    </div>
    <div style={{ height: 6, borderRadius: 3, backgroundColor: '#E2E8F0', overflow: 'hidden' }}>
      <div style={{
        width: `${value * 100}%`, height: '100%',
        backgroundColor: fitnessColor(value),
        transition: 'width 600ms ease-out',
      }} />
    </div>
  </div>
);

export const ConformanceScoreCard: React.FC<Props> = ({ result }) => {
  const { aggregate, model_activities, conformance_threshold } = result;
  const conformanceRate = aggregate.conformance_rate / 100;

  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
      gap: 12,
      padding: '16px 16px 0',
    }}>
      {/* Conformance rate */}
      <div style={cardStyle}>
        <div style={{ fontSize: 11, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>
          Conformance Rate
        </div>
        <div style={{ fontSize: 28, fontWeight: 700, color: fitnessColor(conformanceRate), fontFamily: 'var(--font-mono)', lineHeight: 1 }}>
          {aggregate.conformance_rate.toFixed(1)}%
        </div>
        <div style={{ fontSize: 11, color: '#94A3B8', marginTop: 4 }}>
          {aggregate.conformant_cases} / {aggregate.total_cases} cases conform
        </div>
        <div style={{ marginTop: 8 }}>
          <FitnessBar value={conformanceRate} label={`Threshold: ${(conformance_threshold * 100).toFixed(0)}%`} />
        </div>
      </div>

      {/* Avg fitness */}
      <div style={cardStyle}>
        <div style={{ fontSize: 11, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>
          Avg Fitness Score
        </div>
        <div style={{ fontSize: 28, fontWeight: 700, color: fitnessColor(aggregate.avg_fitness), fontFamily: 'var(--font-mono)', lineHeight: 1 }}>
          {(aggregate.avg_fitness * 100).toFixed(1)}%
        </div>
        <div style={{ fontSize: 11, color: '#94A3B8', marginTop: 4 }}>
          How closely cases follow the model
        </div>
        <div style={{ marginTop: 8 }}>
          <FitnessBar value={aggregate.avg_fitness} label="Avg fitness" />
        </div>
      </div>

      {/* Happy path */}
      <div style={cardStyle}>
        <div style={{ fontSize: 11, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>
          Happy Path ({model_activities.length} stages)
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
          {model_activities.map((act, i) => (
            <React.Fragment key={act}>
              <span style={{
                fontSize: 11, padding: '2px 7px', borderRadius: 12,
                backgroundColor: '#EFF6FF', color: '#1E40AF',
                fontWeight: 500, border: '1px solid #BFDBFE',
              }}>
                {act.replace(/_/g, ' ')}
              </span>
              {i < model_activities.length - 1 && (
                <span style={{ fontSize: 10, color: '#94A3B8', alignSelf: 'center' }}>→</span>
              )}
            </React.Fragment>
          ))}
        </div>
      </div>

      {/* Deviation counts */}
      <div style={cardStyle}>
        <div style={{ fontSize: 11, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>
          Deviation Types
        </div>
        {Object.keys(aggregate.deviation_summary).length === 0 ? (
          <div style={{ fontSize: 12, color: '#10B981' }}>No deviations detected 🎉</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            {(['skip', 'wrong_order', 'unauthorized', 'rework'] as const).map(type => {
              const total = Object.values(aggregate.deviation_summary)
                .reduce((sum, entry) => sum + (entry[type] || 0), 0);
              if (!total) return null;
              return (
                <div key={type} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                  <span style={{ color: '#475569', textTransform: 'capitalize' }}>
                    {type.replace('_', ' ')}
                  </span>
                  <span style={{
                    fontFamily: 'var(--font-mono)', fontWeight: 600,
                    color: type === 'unauthorized' ? '#EF4444' : type === 'rework' ? '#F59E0B' : '#64748B',
                  }}>
                    {total}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

const cardStyle: React.CSSProperties = {
  backgroundColor: '#FFFFFF',
  border: '1px solid #E2E8F0',
  borderRadius: 6,
  padding: '12px 14px',
};
