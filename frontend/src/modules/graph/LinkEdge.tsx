import React, { memo } from 'react';
import {
  EdgeProps,
  getBezierPath,
  EdgeLabelRenderer,
  BaseEdge,
} from '@xyflow/react';

export const LinkEdge: React.FC<EdgeProps> = memo(({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
  selected,
  markerEnd,
}) => {
  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  const label = (data as { relationship_type?: string })?.relationship_type || 'related';
  const isInferred = (data as { is_inferred?: boolean })?.is_inferred || false;

  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        markerEnd={markerEnd}
        style={{
          stroke: selected ? '#7C3AED' : isInferred ? '#94A3B8' : '#CBD5E1',
          strokeWidth: selected ? 2.5 : 1.5,
          strokeDasharray: isInferred ? '5 3' : undefined,
          opacity: selected ? 1 : 0.75,
          transition: 'stroke 120ms, stroke-width 120ms',
        }}
      />
      <EdgeLabelRenderer>
        <div
          style={{
            position: 'absolute',
            transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
            pointerEvents: 'all',
            backgroundColor: selected ? '#EDE9FE' : '#F8FAFC',
            border: `1px solid ${selected ? '#DDD6FE' : '#E2E8F0'}`,
            borderRadius: 4,
            padding: '1px 6px',
            fontSize: 9,
            fontWeight: 600,
            color: selected ? '#7C3AED' : '#6B7280',
            letterSpacing: '0.04em',
            textTransform: 'uppercase',
            whiteSpace: 'nowrap',
            boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
          }}
          className="nodrag nopan"
        >
          {label}
          {isInferred && (
            <span style={{ marginLeft: 3, color: '#94A3B8', fontSize: 8 }}>~</span>
          )}
        </div>
      </EdgeLabelRenderer>
    </>
  );
});

LinkEdge.displayName = 'LinkEdge';
