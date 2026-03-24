import React, { useState } from 'react';
import { NodeProps, Handle, Position } from '@xyflow/react';
import { Trash2 } from 'lucide-react';
import { Pipeline } from '../../types/pipeline';
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

interface PipelineNodeData {
  pipeline: Pipeline;
}

export const PipelineFlowNode: React.FC<NodeProps> = ({ data, selected }) => {
  const { pipeline } = data as unknown as PipelineNodeData;
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

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => { setHovered(false); setConfirmDelete(false); }}
      style={{
        backgroundColor: '#FFFFFF',
        border: `1px solid ${confirmDelete ? '#FCA5A5' : selected ? '#2563EB' : '#C7D2FE'}`,
        borderRadius: '6px',
        width: 180,
        fontFamily: 'var(--font-interface)',
        boxShadow: selected ? '0 0 0 2px #DBEAFE' : '0 1px 3px rgba(0,0,0,0.08)',
        overflow: 'hidden',
      }}
    >
      <div style={{ height: '3px', backgroundColor: '#6366F1' }} />
      <div style={{ padding: '7px 10px 8px' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: '4px', marginBottom: '3px' }}>
          <div style={{ fontSize: '12px', fontWeight: 600, color: '#0D1117', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
            {pipeline.name}
          </div>
          {(hovered || confirmDelete) && (
            <button
              onClick={handleDelete}
              title={confirmDelete ? 'Click again to confirm' : 'Delete pipeline'}
              style={{
                width: 18, height: 18, borderRadius: '3px', flexShrink: 0,
                border: `1px solid ${confirmDelete ? '#FCA5A5' : '#E2E8F0'}`,
                backgroundColor: confirmDelete ? '#FEF2F2' : '#FFFFFF',
                color: confirmDelete ? '#DC2626' : '#94A3B8',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                cursor: 'pointer', padding: 0,
              }}
            >
              <Trash2 size={10} />
            </button>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
          <div style={{ width: 6, height: 6, borderRadius: '50%', backgroundColor: color }} />
          <span style={{ fontSize: '10px', color: '#64748B' }}>{label}</span>
          <span style={{ fontSize: '10px', color: '#94A3B8', marginLeft: 'auto' }}>
            {pipeline.nodes.length} nodes
          </span>
        </div>
      </div>
      <Handle type="target" position={Position.Left} style={{ backgroundColor: '#6366F1', border: '2px solid #FFFFFF', width: 9, height: 9 }} />
      <Handle type="source" position={Position.Right} style={{ backgroundColor: '#6366F1', border: '2px solid #FFFFFF', width: 9, height: 9 }} />
    </div>
  );
};

export default PipelineFlowNode;
