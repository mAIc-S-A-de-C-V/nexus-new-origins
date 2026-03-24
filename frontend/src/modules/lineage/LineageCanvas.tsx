import React from 'react';
import { ReactFlow, Background, Controls, MiniMap, BackgroundVariant } from '@xyflow/react';
import '@xyflow/react/dist/style.css';

export const LineageCanvas: React.FC = () => {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{
        height: 52, backgroundColor: '#FFFFFF', borderBottom: '1px solid #E2E8F0',
        display: 'flex', alignItems: 'center', padding: '0 16px',
      }}>
        <h1 style={{ fontSize: '16px', fontWeight: 500, color: '#0D1117' }}>Data Lineage</h1>
        <span style={{
          marginLeft: '12px', fontSize: '11px',
          backgroundColor: '#F1F5F9', color: '#64748B',
          padding: '2px 8px', borderRadius: '2px', fontWeight: 500,
        }}>
          Coming Soon
        </span>
      </div>
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: '8px', color: '#94A3B8' }}>
        <div style={{ fontSize: '14px', fontWeight: 500 }}>Full lineage DAG coming soon</div>
        <div style={{ fontSize: '12px' }}>End-to-end data lineage from connectors through pipelines to object types</div>
      </div>
    </div>
  );
};

export default LineageCanvas;
