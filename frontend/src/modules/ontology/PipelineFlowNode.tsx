import React, { useState } from 'react';
import { NodeProps, Handle, Position } from '@xyflow/react';
import { Trash2 } from 'lucide-react';
import { Pipeline } from '../../types/pipeline';
import { ConnectorConfig } from '../../types/connector';
import { usePipelineStore } from '../../store/pipelineStore';

const statusColor: Record<string, string> = {
  RUNNING: '#D97706',
  IDLE: '#059669',
  FAILED: '#DC2626',
  PAUSED: '#94A3B8',
  DRAFT: '#6366F1',
};

const statusLabel: Record<string, string> = {
  RUNNING: 'Running',
  IDLE: 'Idle',
  FAILED: 'Failed',
  PAUSED: 'Paused',
  DRAFT: 'Draft',
};

const NODE_TYPE_ICON: Record<string, string> = {
  SOURCE: '↓',
  FILTER: 'F',
  MAP: 'M',
  CAST: 'C',
  ENRICH: 'E',
  FLATTEN: '~',
  DEDUPE: 'D',
  VALIDATE: 'V',
  SINK_OBJECT: 'S',
  SINK_EVENT: 'S',
};

const NODE_TYPE_COLOR: Record<string, string> = {
  SOURCE: '#2563EB',
  FILTER: '#7C3AED',
  MAP: '#0891B2',
  CAST: '#0891B2',
  ENRICH: '#059669',
  FLATTEN: '#64748B',
  DEDUPE: '#64748B',
  VALIDATE: '#D97706',
  SINK_OBJECT: '#6366F1',
  SINK_EVENT: '#EC4899',
};

interface PipelineNodeData {
  pipeline: Pipeline;
  connectors: ConnectorConfig[];
}

export const PipelineFlowNode: React.FC<NodeProps> = ({ data, selected }) => {
  const { pipeline, connectors = [] } = data as unknown as PipelineNodeData;
  const color = statusColor[pipeline.status] || '#94A3B8';
  const label = statusLabel[pipeline.status] || pipeline.status;
  const [hovered, setHovered] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const { removePipeline } = usePipelineStore();

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (confirmDelete) {
      removePipeline(pipeline.id);
    } else {
      setConfirmDelete(true);
      setTimeout(() => setConfirmDelete(false), 2500);
    }
  };

  // Sort pipeline nodes topologically (SOURCE first, SINK last)
  const NODE_ORDER: Record<string, number> = {
    SOURCE: 0, FILTER: 1, MAP: 2, CAST: 2, ENRICH: 3,
    FLATTEN: 3, DEDUPE: 4, VALIDATE: 5, SINK_OBJECT: 99, SINK_EVENT: 99,
  };
  const sortedNodes = [...pipeline.nodes].sort(
    (a, b) => (NODE_ORDER[a.type] ?? 50) - (NODE_ORDER[b.type] ?? 50)
  );

  // Collect auth steps from connected connectors
  const authSteps: { connectorName: string; loginUrl: string }[] = [];
  for (const c of connectors) {
    const creds = c.credentials || {};
    if (creds.tokenEndpointUrl) {
      authSteps.push({ connectorName: c.name, loginUrl: creds.tokenEndpointUrl });
    }
  }

  const stepRowStyle: React.CSSProperties = {
    display: 'flex', alignItems: 'center', gap: 6,
    padding: '4px 10px', borderBottom: '1px solid #F1F5F9',
    fontSize: 11,
  };

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => { setHovered(false); setConfirmDelete(false); }}
      style={{
        backgroundColor: '#FFFFFF',
        border: `1px solid ${confirmDelete ? '#FCA5A5' : selected ? '#2563EB' : '#C7D2FE'}`,
        borderRadius: '6px',
        width: 240,
        fontFamily: 'var(--font-interface)',
        boxShadow: selected ? '0 0 0 2px #DBEAFE' : '0 1px 3px rgba(0,0,0,0.08)',
        overflow: 'hidden',
      }}
    >
      {/* Top bar */}
      <div style={{ height: '3px', backgroundColor: '#6366F1' }} />

      {/* Header */}
      <div style={{ padding: '6px 10px 5px', borderBottom: '1px solid #E2E8F0', display: 'flex', alignItems: 'center', gap: 4 }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: '#0D1117', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
          {pipeline.name}
        </div>
        {(hovered || confirmDelete) && (
          <button onClick={handleDelete}
            title={confirmDelete ? 'Click again to confirm' : 'Delete pipeline'}
            style={{
              width: 16, height: 16, borderRadius: '3px', flexShrink: 0,
              border: `1px solid ${confirmDelete ? '#FCA5A5' : '#E2E8F0'}`,
              backgroundColor: confirmDelete ? '#FEF2F2' : '#FFFFFF',
              color: confirmDelete ? '#DC2626' : '#94A3B8',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              cursor: 'pointer', padding: 0,
            }}>
            <Trash2 size={9} />
          </button>
        )}
      </div>

      {/* Auth steps */}
      {authSteps.map((a, i) => (
        <div key={i} style={{ ...stepRowStyle, backgroundColor: '#FFFBEB' }}>
          <span style={{ fontSize: 10, fontWeight: 700, color: '#92400E', width: 14, textAlign: 'center', flexShrink: 0 }}>A</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 600, color: '#92400E', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Auth · {a.connectorName}</div>
            <div style={{ color: '#64748B', fontSize: 10, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {a.loginUrl.replace(/^https?:\/\/[^/]+/, '')}
            </div>
          </div>
        </div>
      ))}

      {/* Pipeline nodes */}
      {sortedNodes.map((node, i) => {
        const icon = NODE_TYPE_ICON[node.type] || '●';
        const nodeColor = NODE_TYPE_COLOR[node.type] || '#64748B';
        const isLast = i === sortedNodes.length - 1;
        return (
          <div key={node.id} style={{ ...stepRowStyle, backgroundColor: isLast ? '#EFF6FF' : 'transparent' }}>
            <span style={{ fontSize: 12, color: nodeColor, width: 14, textAlign: 'center', flexShrink: 0 }}>{icon}</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 600, color: nodeColor, fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{node.type.replace('_', ' ')}</div>
              <div style={{ color: '#334155', fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {node.label || (node.config?.label as string) || node.id}
              </div>
            </div>
          </div>
        );
      })}

      {/* Footer */}
      <div style={{ padding: '4px 10px', display: 'flex', alignItems: 'center', gap: 5, backgroundColor: '#F8FAFC' }}>
        <div style={{ width: 6, height: 6, borderRadius: '50%', backgroundColor: color, flexShrink: 0 }} />
        <span style={{ fontSize: 10, color: '#64748B' }}>{label}</span>
        <span style={{ fontSize: 10, color: '#94A3B8', marginLeft: 'auto' }}>
          {authSteps.length > 0 ? `${authSteps.length} auth · ` : ''}{pipeline.nodes.length} steps
        </span>
      </div>

      <Handle type="target" position={Position.Left} style={{ backgroundColor: '#6366F1', border: '2px solid #FFFFFF', width: 9, height: 9 }} />
      <Handle type="source" position={Position.Right} style={{ backgroundColor: '#6366F1', border: '2px solid #FFFFFF', width: 9, height: 9 }} />
    </div>
  );
};

export default PipelineFlowNode;
