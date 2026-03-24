import React from 'react';
import { NodeProps, Handle, Position } from '@xyflow/react';
import { ObjectType } from '../../types/ontology';
import { PropertyList } from './PropertyList';

interface ObjectTypeNodeData {
  objectType: ObjectType;
  isReceivingData?: boolean;
}

const healthColors: Record<string, string> = {
  healthy: '#059669',
  warning: '#D97706',
  degraded: '#DC2626',
};

// Inject pulse keyframes once
const PULSE_STYLE_ID = 'ot-node-pulse-style';
if (typeof document !== 'undefined' && !document.getElementById(PULSE_STYLE_ID)) {
  const style = document.createElement('style');
  style.id = PULSE_STYLE_ID;
  style.textContent = `
    @keyframes ot-data-pulse {
      0%   { box-shadow: 0 0 0 0 rgba(99,102,241,0.55), 0 0 0 0 rgba(99,102,241,0.25); }
      50%  { box-shadow: 0 0 0 6px rgba(99,102,241,0.18), 0 0 0 14px rgba(99,102,241,0.06); }
      100% { box-shadow: 0 0 0 0 rgba(99,102,241,0), 0 0 0 0 rgba(99,102,241,0); }
    }
    @keyframes ot-header-flow {
      0%   { background-position: 0% 50%; }
      50%  { background-position: 100% 50%; }
      100% { background-position: 0% 50%; }
    }
    @keyframes ot-ticker {
      0%   { opacity: 0; transform: translateY(4px); }
      20%  { opacity: 1; transform: translateY(0); }
      80%  { opacity: 1; transform: translateY(0); }
      100% { opacity: 0; transform: translateY(-4px); }
    }
  `;
  document.head.appendChild(style);
}

export const ObjectTypeNodeComponent: React.FC<NodeProps> = ({ data, selected }) => {
  const { objectType, isReceivingData } = data as unknown as ObjectTypeNodeData;
  const healthColor = healthColors[objectType.schemaHealth] || '#94A3B8';
  const [tickerVal, setTickerVal] = React.useState<number | null>(null);

  React.useEffect(() => {
    if (!isReceivingData) return;
    const interval = setInterval(() => {
      setTickerVal(Math.floor(Math.random() * 48) + 1);
      setTimeout(() => setTickerVal(null), 1800);
    }, 2800);
    return () => clearInterval(interval);
  }, [isReceivingData]);

  return (
    <div style={{
      backgroundColor: '#FFFFFF',
      border: `1px solid ${selected ? '#6366F1' : isReceivingData ? '#6366F1' : '#1A3C6E'}`,
      borderRadius: '4px',
      width: 240,
      overflow: 'visible',
      fontFamily: 'var(--font-interface)',
      animation: isReceivingData ? 'ot-data-pulse 2.2s ease-in-out infinite' : undefined,
      position: 'relative',
    }}>
      {/* Incoming data ticker */}
      {tickerVal !== null && (
        <div style={{
          position: 'absolute', top: -22, right: 6,
          fontSize: '10px', fontWeight: 700,
          color: '#6366F1', fontFamily: 'var(--font-mono)',
          animation: 'ot-ticker 1.8s ease forwards',
          pointerEvents: 'none', whiteSpace: 'nowrap',
          backgroundColor: '#EEF2FF', padding: '1px 6px', borderRadius: '10px',
          border: '1px solid #C7D2FE',
        }}>
          +{tickerVal} rows
        </div>
      )}

      {/* Header */}
      <div style={{
        background: isReceivingData
          ? 'linear-gradient(270deg, #1E3A8A, #1A3C6E, #312E81, #1A3C6E)'
          : '#1A3C6E',
        backgroundSize: isReceivingData ? '300% 300%' : undefined,
        animation: isReceivingData ? 'ot-header-flow 3.5s ease infinite' : undefined,
        padding: '8px 12px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        borderRadius: '3px 3px 0 0',
        overflow: 'hidden',
      }}>
        <div>
          <div style={{ fontSize: '13px', fontWeight: 700, color: '#FFFFFF' }}>
            {objectType.name}
          </div>
          <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.6)', marginTop: '1px' }}>
            {objectType.description?.slice(0, 32) || 'Object Type'}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          {isReceivingData && (
            <div style={{
              fontSize: '10px', fontWeight: 700, color: '#A5F3FC',
              backgroundColor: 'rgba(6,182,212,0.2)',
              padding: '1px 5px', borderRadius: '2px',
              border: '1px solid rgba(6,182,212,0.4)',
            }}>
              LIVE
            </div>
          )}
          <div style={{
            backgroundColor: 'rgba(255,255,255,0.15)',
            borderRadius: '2px', padding: '1px 6px',
            fontSize: '11px', color: 'rgba(255,255,255,0.85)', fontWeight: 500,
          }}>
            {objectType.sourceConnectorIds.length} src
          </div>
          <div title={`Schema health: ${objectType.schemaHealth}`} style={{
            width: 8, height: 8, borderRadius: '50%',
            backgroundColor: healthColor,
          }} />
        </div>
      </div>

      {/* Properties */}
      <div style={{ padding: '8px 10px' }}>
        <PropertyList properties={objectType.properties} compact maxVisible={5} />
      </div>

      {/* Footer */}
      <div style={{
        borderTop: '1px solid #E2E8F0', padding: '5px 10px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        backgroundColor: '#FAFAFA', borderRadius: '0 0 3px 3px',
      }}>
        <span style={{ fontSize: '11px', color: '#94A3B8', fontFamily: 'var(--font-mono)' }}>
          v{objectType.version}
        </span>
        <span style={{ fontSize: '11px', color: '#94A3B8' }}>
          {objectType.properties.length} props
        </span>
      </div>

      <Handle type="target" position={Position.Left} style={{ backgroundColor: '#6366F1', border: '2px solid #FFFFFF', width: 10, height: 10 }} />
      <Handle type="source" position={Position.Right} style={{ backgroundColor: '#1A3C6E', border: '2px solid #FFFFFF', width: 10, height: 10 }} />
    </div>
  );
};

export default ObjectTypeNodeComponent;
