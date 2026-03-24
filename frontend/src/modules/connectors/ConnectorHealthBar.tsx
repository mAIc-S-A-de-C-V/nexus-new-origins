import React from 'react';
import { ConnectorHealth } from '../../types/connector';

interface ConnectorHealthBarProps {
  history: ConnectorHealth[];
  compact?: boolean;
}

export const ConnectorHealthBar: React.FC<ConnectorHealthBarProps> = ({ history, compact = false }) => {
  const last24 = history.slice(-24);

  const getBarColor = (h: ConnectorHealth): string => {
    if (h.status === 'error') return '#DC2626';
    if (h.successRate < 0.9) return '#D97706';
    return '#059669';
  };

  if (compact) {
    return (
      <div style={{ display: 'flex', gap: '2px', alignItems: 'flex-end', height: '20px' }}>
        {last24.map((h, i) => (
          <div
            key={i}
            style={{
              width: 3,
              height: `${Math.max(4, h.successRate * 20)}px`,
              backgroundColor: getBarColor(h),
              borderRadius: '1px',
              flexShrink: 0,
            }}
            title={`${new Date(h.timestamp).toLocaleTimeString()} — ${Math.round(h.successRate * 100)}% success`}
          />
        ))}
      </div>
    );
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
        <span style={{ fontSize: '12px', color: '#64748B', fontWeight: 500 }}>Sync Health (24h)</span>
        {last24.length > 0 && (
          <span style={{ fontSize: '11px', color: '#94A3B8' }}>
            Avg {Math.round((last24.reduce((s, h) => s + h.successRate, 0) / last24.length) * 100)}% success
          </span>
        )}
      </div>
      <div style={{ display: 'flex', gap: '3px', alignItems: 'flex-end', height: '40px' }}>
        {last24.map((h, i) => (
          <div
            key={i}
            style={{
              flex: 1,
              height: `${Math.max(6, h.successRate * 40)}px`,
              backgroundColor: getBarColor(h),
              borderRadius: '1px',
              cursor: 'default',
              transition: 'opacity 80ms',
            }}
            title={`${new Date(h.timestamp).toLocaleTimeString()} — ${Math.round(h.successRate * 100)}% success, ${h.rowsProcessed.toLocaleString()} rows`}
            onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.opacity = '0.8'; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.opacity = '1'; }}
          />
        ))}
        {last24.length === 0 && (
          <div style={{ fontSize: '12px', color: '#94A3B8', alignSelf: 'center', width: '100%', textAlign: 'center' }}>
            No sync history
          </div>
        )}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '4px' }}>
        <span style={{ fontSize: '10px', color: '#94A3B8' }}>24h ago</span>
        <span style={{ fontSize: '10px', color: '#94A3B8' }}>Now</span>
      </div>
    </div>
  );
};

export default ConnectorHealthBar;
