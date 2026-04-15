import React from 'react';

interface Props {
  value: number;
  max: number;
  color?: string;
  width?: number;
  label?: string;
}

export const InlineValueBar: React.FC<Props> = ({ value, max, color = '#6366F1', width = 100, label }) => {
  const pct = max > 0 ? Math.min((value / max) * 100, 100) : 0;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <div style={{ width, height: 6, backgroundColor: '#E2E8F0', borderRadius: 3, flexShrink: 0 }}>
        <div style={{ height: '100%', width: `${pct}%`, backgroundColor: color, borderRadius: 3 }} />
      </div>
      <span style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: '#0D1117', fontWeight: 600, whiteSpace: 'nowrap' }}>
        {label ?? value.toLocaleString()}
      </span>
    </div>
  );
};
