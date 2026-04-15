import React from 'react';
import { ProcessStats } from '../../store/processStore';

interface KpiCardProps {
  label: string;
  value: string | number;
  color?: string;
  sub?: string;
}

const KpiCard: React.FC<KpiCardProps> = ({ label, value, color, sub }) => (
  <div style={{
    backgroundColor: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: 6,
    padding: '14px 16px', minWidth: 0,
  }}>
    <div style={{
      fontSize: 10, fontWeight: 600, color: '#94A3B8',
      textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6,
    }}>
      {label}
    </div>
    <div style={{
      fontSize: 26, fontWeight: 700, fontFamily: 'var(--font-mono)', lineHeight: 1,
      color: color || '#0D1117',
    }}>
      {value}
    </div>
    {sub && (
      <div style={{ fontSize: 10, color: '#94A3B8', marginTop: 4 }}>{sub}</div>
    )}
  </div>
);

interface Props {
  stats: ProcessStats;
  totalCost?: number;
  automationRate?: number;
}

export const KpiBanner: React.FC<Props> = ({ stats, totalCost, automationRate }) => {
  const reworkColor = stats.rework_rate > 10 ? '#DC2626' : stats.rework_rate > 5 ? '#D97706' : '#10B981';
  const stuckColor = stats.stuck_cases > 0 ? '#DC2626' : '#10B981';

  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
      gap: 10,
      padding: '12px 20px',
      borderBottom: '1px solid #E2E8F0',
      backgroundColor: '#F8FAFC',
      flexShrink: 0,
    }}>
      <KpiCard
        label="Total Cases"
        value={stats.total_cases.toLocaleString()}
        sub={`${stats.variant_count} variants`}
      />
      <KpiCard
        label="Avg Throughput"
        value={`${stats.avg_duration_days}d`}
        color="#1E3A5F"
      />
      <KpiCard
        label="Rework Rate"
        value={`${stats.rework_rate}%`}
        color={reworkColor}
      />
      <KpiCard
        label="Stuck Cases"
        value={stats.stuck_cases}
        color={stuckColor}
      />
      {automationRate != null && (
        <KpiCard
          label="Automation"
          value={`${automationRate.toFixed(1)}%`}
          color={automationRate >= 50 ? '#10B981' : '#D97706'}
        />
      )}
      {totalCost != null && totalCost > 0 && (
        <KpiCard
          label="Total Cost"
          value={totalCost >= 1e6 ? `$${(totalCost / 1e6).toFixed(1)}M` : totalCost >= 1e3 ? `$${(totalCost / 1e3).toFixed(1)}K` : `$${totalCost.toFixed(0)}`}
        />
      )}
    </div>
  );
};
