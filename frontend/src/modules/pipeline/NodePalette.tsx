import React from 'react';
import {
  Plug, Filter, ArrowRightLeft, Repeat, Sparkles,
  Layers, Copy, ShieldCheck, Database, Activity
} from 'lucide-react';
import { NODE_TYPE_DEFS } from './pipelineTypes';
import { nodeColors } from '../../design-system/tokens';

const ICONS: Record<string, React.ReactNode> = {
  Plug: <Plug size={14} />,
  Filter: <Filter size={14} />,
  ArrowRightLeft: <ArrowRightLeft size={14} />,
  Repeat: <Repeat size={14} />,
  Sparkles: <Sparkles size={14} />,
  Layers: <Layers size={14} />,
  Copy: <Copy size={14} />,
  ShieldCheck: <ShieldCheck size={14} />,
  Database: <Database size={14} />,
  Activity: <Activity size={14} />,
};

export const NodePalette: React.FC = () => {
  const onDragStart = (event: React.DragEvent, nodeType: string) => {
    event.dataTransfer.setData('application/reactflow/nodetype', nodeType);
    event.dataTransfer.effectAllowed = 'move';
  };

  return (
    <div style={{
      width: '180px',
      backgroundColor: '#FFFFFF',
      borderRight: '1px solid #E2E8F0',
      display: 'flex',
      flexDirection: 'column',
      overflowY: 'auto',
      flexShrink: 0,
    }}>
      <div style={{
        padding: '12px',
        borderBottom: '1px solid #E2E8F0',
        fontSize: '11px',
        fontWeight: 600,
        color: '#94A3B8',
        textTransform: 'uppercase',
        letterSpacing: '0.05em',
      }}>
        Node Types
      </div>
      <div style={{ padding: '8px' }}>
        {NODE_TYPE_DEFS.map((def) => {
          const color = nodeColors[def.type] || '#64748B';
          return (
            <div
              key={def.type}
              draggable
              onDragStart={(e) => onDragStart(e, def.type)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                padding: '7px 8px',
                borderRadius: '4px',
                cursor: 'grab',
                border: '1px solid #E2E8F0',
                marginBottom: '4px',
                backgroundColor: '#FFFFFF',
                transition: 'border-color 80ms, background-color 80ms',
                userSelect: 'none',
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLElement).style.borderColor = '#CBD5E1';
                (e.currentTarget as HTMLElement).style.backgroundColor = '#F8F9FA';
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLElement).style.borderColor = '#E2E8F0';
                (e.currentTarget as HTMLElement).style.backgroundColor = '#FFFFFF';
              }}
              title={def.description}
            >
              <div style={{
                width: 24, height: 24, borderRadius: '3px',
                backgroundColor: color,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: '#FFFFFF', flexShrink: 0,
              }}>
                {ICONS[def.iconName] || <Plug size={14} />}
              </div>
              <div>
                <div style={{ fontSize: '12px', fontWeight: 500, color: '#0D1117' }}>{def.label}</div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default NodePalette;
