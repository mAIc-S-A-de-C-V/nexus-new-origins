import React from 'react';

const COLORS = ['#7C3AED', '#2563EB', '#059669', '#D97706', '#DC2626', '#DB2777', '#0891B2', '#65A30D', '#6366F1', '#14B8A6', '#F97316', '#84CC16'];

interface Props {
  data: { label: string; value: number }[];
  title?: string;
  size?: number;
}

export const DonutChart: React.FC<Props> = ({ data, title, size = 180 }) => {
  const entries = data.filter(d => d.value > 0).slice(0, 12);
  const total = entries.reduce((s, d) => s + d.value, 0);

  if (!entries.length || !total) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: size, color: '#94A3B8', fontSize: 12 }}>
        No data
      </div>
    );
  }

  const cx = size / 2, cy = size / 2;
  const r = size * 0.44, ir = size * 0.25;

  let cumAngle = -Math.PI / 2;
  const arcs = entries.map((entry, i) => {
    const angle = (entry.value / total) * Math.PI * 2;
    const startAngle = cumAngle;
    cumAngle += angle;
    const endAngle = cumAngle;
    const largeArc = angle > Math.PI ? 1 : 0;
    const x1 = cx + r * Math.cos(startAngle), y1 = cy + r * Math.sin(startAngle);
    const x2 = cx + r * Math.cos(endAngle), y2 = cy + r * Math.sin(endAngle);
    const ix1 = cx + ir * Math.cos(endAngle), iy1 = cy + ir * Math.sin(endAngle);
    const ix2 = cx + ir * Math.cos(startAngle), iy2 = cy + ir * Math.sin(startAngle);
    const path = `M ${ix2} ${iy2} L ${x1} ${y1} A ${r} ${r} 0 ${largeArc} 1 ${x2} ${y2} L ${ix1} ${iy1} A ${ir} ${ir} 0 ${largeArc} 0 ${ix2} ${iy2} Z`;
    const color = COLORS[i % COLORS.length];
    const pct = ((entry.value / total) * 100).toFixed(1);
    return { ...entry, path, color, pct };
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {title && (
        <div style={{ fontSize: 12, fontWeight: 600, color: '#0D1117' }}>{title}</div>
      )}
      <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
          {arcs.map((a, i) => (
            <path key={i} d={a.path} fill={a.color} stroke="#fff" strokeWidth={1.5}>
              <title>{a.label}: {a.value.toLocaleString()} ({a.pct}%)</title>
            </path>
          ))}
          <text x={cx} y={cy - 4} textAnchor="middle" fontSize={16} fontWeight={700} fill="#0D1117">
            {total.toLocaleString()}
          </text>
          <text x={cx} y={cy + 12} textAnchor="middle" fontSize={9} fill="#94A3B8">
            total
          </text>
        </svg>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 100 }}>
          {arcs.map((a, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 10, color: '#64748B' }}>
              <div style={{ width: 8, height: 8, borderRadius: 2, backgroundColor: a.color, flexShrink: 0 }} />
              <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 120 }}>
                {a.label}
              </span>
              <span style={{ fontFamily: 'var(--font-mono)', color: '#0D1117', fontWeight: 600 }}>{a.pct}%</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
