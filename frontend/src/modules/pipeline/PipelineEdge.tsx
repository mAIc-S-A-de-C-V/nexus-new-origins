import React from 'react';
import { EdgeProps, getBezierPath, EdgeLabelRenderer } from '@xyflow/react';

interface PipelineEdgeData {
  rowCount?: number;
  label?: string;
}

export const PipelineEdgeComponent: React.FC<EdgeProps> = ({
  id, sourceX, sourceY, targetX, targetY,
  sourcePosition, targetPosition, data, selected,
  markerEnd,
}) => {
  const edgeData = (data || {}) as PipelineEdgeData;
  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX, sourceY, sourcePosition,
    targetX, targetY, targetPosition,
  });

  return (
    <>
      <path
        id={id}
        style={{
          stroke: selected ? '#2563EB' : '#CBD5E1',
          strokeWidth: selected ? 2 : 1.5,
          fill: 'none',
          transition: 'stroke 80ms',
        }}
        className="react-flow__edge-path"
        d={edgePath}
        markerEnd={markerEnd}
      />
      {(edgeData.rowCount !== undefined || edgeData.label) && (
        <EdgeLabelRenderer>
          <div
            style={{
              position: 'absolute',
              transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
              pointerEvents: 'all',
              backgroundColor: '#FFFFFF',
              border: '1px solid #E2E8F0',
              borderRadius: '2px',
              padding: '1px 6px',
              fontSize: '10px',
              color: '#64748B',
              fontFamily: 'var(--font-mono)',
              whiteSpace: 'nowrap',
            }}
          >
            {edgeData.label || (edgeData.rowCount !== undefined ? `${edgeData.rowCount?.toLocaleString()} rows` : '')}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
};

export default PipelineEdgeComponent;
