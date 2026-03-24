import React, { useState } from 'react';
import { NodeProps, Handle, Position } from '@xyflow/react';
import { Trash2 } from 'lucide-react';
import { ConnectorConfig } from '../../types/connector';
import { useConnectorStore } from '../../store/connectorStore';

const statusColor: Record<string, string> = {
  live: '#059669',
  active: '#2563EB',
  idle: '#94A3B8',
  error: '#DC2626',
  warning: '#D97706',
};

interface ConnectorNodeData {
  connector: ConnectorConfig;
}

export const ConnectorFlowNode: React.FC<NodeProps> = ({ data, selected }) => {
  const { connector } = data as unknown as ConnectorNodeData;
  const dot = statusColor[connector.status] || '#94A3B8';
  const [hovered, setHovered] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const { removeConnector } = useConnectorStore();

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (confirmDelete) {
      removeConnector(connector.id);
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
        border: `1px solid ${confirmDelete ? '#FCA5A5' : selected ? '#2563EB' : '#CBD5E1'}`,
        borderRadius: '6px',
        width: 180,
        fontFamily: 'var(--font-interface)',
        boxShadow: selected ? '0 0 0 2px #DBEAFE' : '0 1px 3px rgba(0,0,0,0.08)',
        overflow: 'hidden',
      }}
    >
      <div style={{ padding: '8px 10px', backgroundColor: '#F8FAFC', borderBottom: '1px solid #E2E8F0', display: 'flex', alignItems: 'center', gap: '7px' }}>
        <div style={{ width: 7, height: 7, borderRadius: '50%', backgroundColor: dot, flexShrink: 0 }} />
        <span style={{ fontSize: '12px', fontWeight: 600, color: '#0D1117', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
          {connector.name}
        </span>
        {(hovered || confirmDelete) && (
          <button
            onClick={handleDelete}
            title={confirmDelete ? 'Click again to confirm' : 'Delete connector'}
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
      <div style={{ padding: '5px 10px 7px', display: 'flex', alignItems: 'center', gap: '5px' }}>
        <span style={{ fontSize: '10px', color: '#94A3B8', backgroundColor: '#F1F5F9', padding: '1px 5px', borderRadius: '2px', fontWeight: 500 }}>
          {connector.type}
        </span>
        <span style={{ fontSize: '10px', color: '#94A3B8' }}>{connector.category}</span>
      </div>
      <Handle type="source" position={Position.Right} style={{ backgroundColor: '#64748B', border: '2px solid #FFFFFF', width: 9, height: 9 }} />
    </div>
  );
};

export default ConnectorFlowNode;
