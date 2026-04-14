import React from 'react';
import { useUiStore } from '../../store/uiStore';

export const DensityToggle: React.FC = () => {
  const { density, setDensity } = useUiStore();

  return (
    <div
      title="Table density"
      style={{
        display: 'flex',
        border: '1px solid rgba(255,255,255,0.12)',
        borderRadius: 4,
        overflow: 'hidden',
        height: 26,
      }}
    >
      {(['comfortable', 'compact'] as const).map((d) => (
        <button
          key={d}
          onClick={() => setDensity(d)}
          style={{
            padding: '0 8px',
            fontSize: 10,
            fontWeight: 600,
            letterSpacing: '0.03em',
            border: 'none',
            cursor: 'pointer',
            backgroundColor: density === d ? 'rgba(255,255,255,0.15)' : 'transparent',
            color: density === d ? '#E2E8F0' : '#64748B',
            transition: 'background-color 80ms, color 80ms',
          }}
        >
          {d === 'comfortable' ? 'Comfy' : 'Compact'}
        </button>
      ))}
    </div>
  );
};

export default DensityToggle;
