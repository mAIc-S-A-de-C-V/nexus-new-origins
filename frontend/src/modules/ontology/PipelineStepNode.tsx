import React from 'react';
import { NodeProps, Handle, Position } from '@xyflow/react';

const STEP_COLOR: Record<string, string> = {
  AUTH:        '#92400E',
  SOURCE:      '#1D4ED8',
  FILTER:      '#6D28D9',
  MAP:         '#0E7490',
  CAST:        '#0E7490',
  ENRICH:      '#065F46',
  FLATTEN:     '#374151',
  DEDUPE:      '#374151',
  VALIDATE:    '#92400E',
  SINK_OBJECT: '#1E3A5F',
  SINK_EVENT:  '#BE185D',
};

const STEP_BG: Record<string, string> = {
  AUTH:        '#FFFBEB',
  SOURCE:      '#EFF6FF',
  FILTER:      '#F5F3FF',
  MAP:         '#ECFEFF',
  CAST:        '#ECFEFF',
  ENRICH:      '#ECFDF5',
  FLATTEN:     '#F8FAFC',
  DEDUPE:      '#F8FAFC',
  VALIDATE:    '#FFFBEB',
  SINK_OBJECT: '#EFF6FF',
  SINK_EVENT:  '#FDF2F8',
};

export interface PipelineStepNodeData {
  stepType: string;
  label: string;
  subtitle?: string;
  pipelineName?: string;
  isFirst?: boolean;
  isLast?: boolean;
}

export const PipelineStepNode: React.FC<NodeProps> = ({ data, selected }) => {
  const { stepType, label, subtitle } = data as unknown as PipelineStepNodeData;
  const color = STEP_COLOR[stepType] || '#374151';
  const bg = STEP_BG[stepType] || '#F8FAFC';
  const typeLabel = stepType === 'SINK_OBJECT' ? 'SINK OBJ' : stepType === 'SINK_EVENT' ? 'SINK EVT' : stepType;

  return (
    <div
      style={{
        width: 120,
        backgroundColor: bg,
        border: `1.5px solid ${selected ? color : `${color}55`}`,
        borderRadius: 6,
        overflow: 'hidden',
        fontFamily: 'var(--font-interface)',
        boxShadow: selected
          ? `0 0 0 2px ${color}33`
          : '0 1px 3px rgba(0,0,0,0.07)',
      }}
    >
      {/* Top bar */}
      <div style={{ height: 3, backgroundColor: color }} />

      {/* Content */}
      <div style={{ padding: '5px 8px' }}>
        <div
          style={{
            fontSize: 8,
            fontWeight: 700,
            color,
            textTransform: 'uppercase',
            letterSpacing: '0.06em',
            marginBottom: 2,
          }}
        >
          {typeLabel}
        </div>
        <div
          style={{
            fontSize: 11,
            fontWeight: 500,
            color: '#0D1117',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {label}
        </div>
        {subtitle && (
          <div
            style={{
              fontSize: 9,
              color: '#64748B',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              marginTop: 1,
            }}
          >
            {subtitle}
          </div>
        )}
      </div>

      <Handle
        type="target"
        position={Position.Left}
        style={{
          backgroundColor: color,
          border: '2px solid #FFFFFF',
          width: 8,
          height: 8,
        }}
      />
      <Handle
        type="source"
        position={Position.Right}
        style={{
          backgroundColor: color,
          border: '2px solid #FFFFFF',
          width: 8,
          height: 8,
        }}
      />
    </div>
  );
};

export default PipelineStepNode;
