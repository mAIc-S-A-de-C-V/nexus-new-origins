import React from 'react';
import { Handle, Position, NodeProps } from '@xyflow/react';
import {
  Plug, Filter, ArrowRightLeft, Repeat, Sparkles,
  Layers, LayoutGrid, Copy, ShieldCheck, Database, Activity
} from 'lucide-react';
import { NodeType } from '../../types/pipeline';
import { nodeColors } from '../../design-system/tokens';

const ICONS: Record<string, React.ReactNode> = {
  SOURCE: <Plug size={14} />,
  FILTER: <Filter size={14} />,
  MAP: <ArrowRightLeft size={14} />,
  CAST: <Repeat size={14} />,
  ENRICH: <Sparkles size={14} />,
  FLATTEN: <Layers size={14} />,
  PIVOT: <LayoutGrid size={14} />,
  DEDUPE: <Copy size={14} />,
  VALIDATE: <ShieldCheck size={14} />,
  SINK_OBJECT: <Database size={14} />,
  SINK_EVENT: <Activity size={14} />,
};

interface PipelineNodeData {
  label: string;
  nodeType: NodeType;
  config?: Record<string, unknown>;
  isSelected?: boolean;
  rowCount?: number;
  status?: 'idle' | 'running' | 'success' | 'error';
}

export const PipelineNodeComponent: React.FC<NodeProps> = ({ data, selected }) => {
  const nodeData = data as unknown as PipelineNodeData;
  const { label, nodeType, rowCount, status } = nodeData;
  const color = nodeColors[nodeType] || '#64748B';
  const isSource = nodeType === 'SOURCE';
  const isSink = nodeType === 'SINK_EVENT';

  const statusColor: Record<string, string> = {
    running: '#D97706',
    success: '#059669',
    error: '#DC2626',
    idle: '#94A3B8',
  };

  return (
    <div style={{
      backgroundColor: '#FFFFFF',
      border: `1px solid ${selected ? '#2563EB' : '#E2E8F0'}`,
      borderRadius: '4px',
      minWidth: 140,
      boxShadow: selected ? '0 0 0 2px #DBEAFE' : 'none',
      overflow: 'hidden',
      fontFamily: 'var(--font-interface)',
    }}>
      {/* Header bar */}
      <div style={{
        backgroundColor: color,
        padding: '6px 10px',
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
      }}>
        <span style={{ color: '#FFFFFF', lineHeight: 0 }}>
          {ICONS[nodeType] || <Plug size={14} />}
        </span>
        <span style={{
          fontSize: '11px', fontWeight: 600, color: '#FFFFFF',
          textTransform: 'uppercase', letterSpacing: '0.05em',
        }}>
          {nodeType.replace('_', ' ')}
        </span>
        {status && status !== 'idle' && (
          <span style={{
            marginLeft: 'auto',
            width: 6, height: 6, borderRadius: '50%',
            backgroundColor: statusColor[status],
            display: 'inline-block',
          }} />
        )}
      </div>

      {/* Body */}
      <div style={{ padding: '8px 10px' }}>
        <div style={{ fontSize: '12px', fontWeight: 500, color: '#0D1117' }}>{label}</div>
        {rowCount !== undefined && (
          <div style={{ fontSize: '11px', color: '#94A3B8', marginTop: '2px', fontFamily: 'var(--font-mono)' }}>
            {rowCount.toLocaleString()} rows
          </div>
        )}
      </div>

      {/* Handles */}
      {!isSource && (
        <Handle
          type="target"
          position={Position.Left}
          style={{
            backgroundColor: color, border: '2px solid #FFFFFF',
            width: 10, height: 10,
          }}
        />
      )}
      {!isSink && (
        <Handle
          type="source"
          position={Position.Right}
          style={{
            backgroundColor: color, border: '2px solid #FFFFFF',
            width: 10, height: 10,
          }}
        />
      )}
    </div>
  );
};

export default PipelineNodeComponent;
