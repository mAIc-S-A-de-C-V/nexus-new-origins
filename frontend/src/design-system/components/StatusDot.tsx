import React from 'react';

type StatusType = 'active' | 'idle' | 'error' | 'warning' | 'live';

interface StatusDotProps {
  status: StatusType;
  size?: number;
  showLabel?: boolean;
  label?: string;
}

const statusConfig: Record<StatusType, { color: string; label: string; pulse: boolean }> = {
  live: { color: '#059669', label: 'Live', pulse: true },
  active: { color: '#059669', label: 'Active', pulse: false },
  idle: { color: '#94A3B8', label: 'Idle', pulse: false },
  error: { color: '#DC2626', label: 'Error', pulse: false },
  warning: { color: '#D97706', label: 'Warning', pulse: false },
};

export const StatusDot: React.FC<StatusDotProps> = ({
  status,
  size = 8,
  showLabel = false,
  label,
}) => {
  const config = statusConfig[status];
  const displayLabel = label || config.label;

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
      <span
        className={config.pulse ? 'status-dot-live' : undefined}
        style={{
          width: size,
          height: size,
          borderRadius: '50%',
          backgroundColor: config.color,
          display: 'inline-block',
          flexShrink: 0,
        }}
      />
      {showLabel && (
        <span style={{
          fontSize: '12px',
          color: config.color,
          fontWeight: 500,
        }}>
          {displayLabel}
        </span>
      )}
    </span>
  );
};

export default StatusDot;
