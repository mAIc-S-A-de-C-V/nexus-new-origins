import React, { useState, useCallback, useEffect } from 'react';
import { createPortal } from 'react-dom';
import {
  ReactFlow, Background, Controls, MiniMap,
  useNodesState, useEdgesState,
  NodeMouseHandler, BackgroundVariant,
  Node, Edge, MarkerType,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Plus, X } from 'lucide-react';
import { Pipeline } from '../../types/pipeline';
import { ObjectTypeNodeComponent } from './ObjectTypeNode';
import { ConnectorFlowNode } from './ConnectorFlowNode';
import { PipelineFlowNode } from './PipelineFlowNode';
import { ObjectTypePanel } from './ObjectTypePanel';
import { Button } from '../../design-system/components/Button';
import { useOntologyStore } from '../../store/ontologyStore';
import { useConnectorStore } from '../../store/connectorStore';
import { usePipelineStore } from '../../store/pipelineStore';
import { ObjectType } from '../../types/ontology';

// ── Pipeline expand modal ─────────────────────────────────────────────────

const NODE_TYPE_COLOR: Record<string, string> = {
  SOURCE: '#1E3A5F',
  FILTER: '#5B21B6',
  MAP: '#0E7490',
  CAST: '#065F46',
  ENRICH: '#92400E',
  FLATTEN: '#1E40AF',
  DEDUPE: '#374151',
  VALIDATE: '#065F46',
  SINK_OBJECT: '#1E3A5F',
  SINK_EVENT: '#1E3A5F',
};

const statusDot: Record<string, string> = {
  RUNNING: '#D97706',
  IDLE: '#059669',
  FAILED: '#DC2626',
  PAUSED: '#94A3B8',
  DRAFT: '#6366F1',
};

const PipelineExpandModal: React.FC<{ pipeline: Pipeline; onClose: () => void }> = ({ pipeline, onClose }) => {
  // Build ordered node list via topological sort on edges
  const nodeMap = Object.fromEntries(pipeline.nodes.map((n) => [n.id, n]));
  const adjacency: Record<string, string[]> = {};
  const inDegree: Record<string, number> = {};
  pipeline.nodes.forEach((n) => { adjacency[n.id] = []; inDegree[n.id] = 0; });
  pipeline.edges.forEach((e) => {
    adjacency[e.source]?.push(e.target);
    inDegree[e.target] = (inDegree[e.target] || 0) + 1;
  });
  const queue = pipeline.nodes.filter((n) => !inDegree[n.id]).map((n) => n.id);
  const ordered: string[] = [];
  while (queue.length) {
    const id = queue.shift()!;
    ordered.push(id);
    adjacency[id]?.forEach((tid) => {
      inDegree[tid]--;
      if (inDegree[tid] === 0) queue.push(tid);
    });
  }
  const sortedNodes = ordered.map((id) => nodeMap[id]).filter(Boolean);

  return createPortal(
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 10000, backgroundColor: 'rgba(0,0,0,0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{ backgroundColor: '#FFFFFF', borderRadius: 10, boxShadow: '0 20px 60px rgba(0,0,0,0.2)', width: Math.min(160 * sortedNodes.length + 120, window.innerWidth * 0.9), maxWidth: '92vw', overflow: 'hidden' }}>
        {/* Header */}
        <div style={{ padding: '14px 20px', borderBottom: '1px solid #E2E8F0', display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: statusDot[pipeline.status] || '#94A3B8' }} />
          <span style={{ fontSize: 14, fontWeight: 600, color: '#0D1117' }}>{pipeline.name}</span>
          <span style={{ fontSize: 11, color: '#94A3B8' }}>{sortedNodes.length} nodes</span>
          <button onClick={onClose} style={{ marginLeft: 'auto', width: 26, height: 26, border: '1px solid #E2E8F0', borderRadius: 5, backgroundColor: '#fff', color: '#64748B', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <X size={13} />
          </button>
        </div>

        {/* Node pipeline visualization */}
        <div style={{ padding: '24px 28px', overflowX: 'auto' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 0, minWidth: 'max-content' }}>
            {sortedNodes.map((node, idx) => (
              <React.Fragment key={node.id}>
                {/* Node card */}
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
                  <div style={{
                    backgroundColor: NODE_TYPE_COLOR[node.type] || '#374151',
                    borderRadius: 6, padding: '8px 14px', minWidth: 110,
                    display: 'flex', flexDirection: 'column', gap: 3,
                  }}>
                    <span style={{ fontSize: 9, fontWeight: 700, color: 'rgba(255,255,255,0.6)', letterSpacing: '0.06em' }}>
                      {node.type.replace('_', ' ')}
                    </span>
                    <span style={{ fontSize: 12, fontWeight: 500, color: '#FFFFFF', whiteSpace: 'nowrap' }}>
                      {(node.config as Record<string, string>)?.label || node.id}
                    </span>
                  </div>
                </div>
                {/* Arrow connector */}
                {idx < sortedNodes.length - 1 && (
                  <div style={{ display: 'flex', alignItems: 'center', flexShrink: 0, padding: '0 4px' }}>
                    <div style={{ width: 24, height: 1, backgroundColor: '#CBD5E1' }} />
                    <div style={{ width: 0, height: 0, borderTop: '4px solid transparent', borderBottom: '4px solid transparent', borderLeft: '6px solid #CBD5E1' }} />
                  </div>
                )}
              </React.Fragment>
            ))}
          </div>
        </div>

        {/* Footer stats */}
        <div style={{ padding: '10px 20px', borderTop: '1px solid #F1F5F9', backgroundColor: '#F8FAFC', display: 'flex', gap: 16, fontSize: 11, color: '#94A3B8' }}>
          {pipeline.lastRunRowCount != null && <span><strong style={{ color: '#374151' }}>{pipeline.lastRunRowCount.toLocaleString()}</strong> rows last run</span>}
          {pipeline.lastRunAt && <span>Last run {new Date(pipeline.lastRunAt).toLocaleString()}</span>}
          <span style={{ marginLeft: 'auto' }}>Double-click to open in Pipeline Builder</span>
        </div>
      </div>
    </div>,
    document.body
  );
};

const nodeTypes = {
  objectTypeNode: ObjectTypeNodeComponent,
  connectorNode: ConnectorFlowNode,
  pipelineNode: PipelineFlowNode,
};


// Column x positions for the 3-column layout
const COL_CONNECTOR = 60;
const COL_PIPELINE = 320;
const COL_OBJECT = 580;
const ROW_GAP = 160;

export const OntologyGraph: React.FC = () => {
  const { objectTypes, links, fetchObjectTypes, fetchLinks } = useOntologyStore();
  const { connectors, fetchConnectors } = useConnectorStore();
  const { pipelines, fetchPipelines } = usePipelineStore();
  const [selectedObjectType, setSelectedObjectType] = useState<ObjectType | null>(null);
  const [expandedPipeline, setExpandedPipeline] = useState<import('../../types/pipeline').Pipeline | null>(null);

  useEffect(() => {
    fetchObjectTypes();
    fetchLinks();
    fetchConnectors();
    fetchPipelines();
  }, []);

  const buildGraph = useCallback(() => {
    const flowNodes: Node[] = [];
    const flowEdges: Edge[] = [];

    // Only show connectors that are referenced by at least one object type or pipeline
    const usedConnectorIds = new Set<string>([
      ...objectTypes.flatMap((o) => o.sourceConnectorIds),
      ...pipelines.flatMap((p) => p.connectorIds),
    ]);
    const relevantConnectors = connectors.filter((c) => usedConnectorIds.has(c.id));

    // Build index: connectorId → row index
    const connectorRowMap = new Map<string, number>();
    relevantConnectors.forEach((c, i) => connectorRowMap.set(c.id, i));

    // Build index: objectTypeId → row index
    const objectRowMap = new Map<string, number>();
    objectTypes.forEach((o, i) => objectRowMap.set(o.id, i));

    // --- Connector nodes ---
    relevantConnectors.forEach((c, i) => {
      flowNodes.push({
        id: `con-${c.id}`,
        type: 'connectorNode',
        position: { x: COL_CONNECTOR, y: i * ROW_GAP + 40 },
        data: { connector: c },
      });
    });

    // --- Pipeline nodes ---
    // Position each pipeline at the centroid y of its connected connectors
    // so edges don't cross each other.
    pipelines.forEach((p, i) => {
      const connectorYs = p.connectorIds
        .map((cId) => connectorRowMap.get(cId))
        .filter((r): r is number => r !== undefined)
        .map((r) => r * ROW_GAP + 40);

      const y = connectorYs.length > 0
        ? connectorYs.reduce((a, b) => a + b, 0) / connectorYs.length
        : i * ROW_GAP + 40;

      flowNodes.push({
        id: `pipe-${p.id}`,
        type: 'pipelineNode',
        position: { x: COL_PIPELINE, y },
        data: { pipeline: p },
      });

      // Connector → Pipeline edges
      p.connectorIds.forEach((cId) => {
        if (usedConnectorIds.has(cId)) {
          flowEdges.push({
            id: `e-con-${cId}-pipe-${p.id}`,
            source: `con-${cId}`,
            target: `pipe-${p.id}`,
            markerEnd: { type: MarkerType.ArrowClosed, color: '#94A3B8' },
            style: { stroke: '#CBD5E1', strokeWidth: 1.5 },
          });
        }
      });

      // Pipeline → ObjectType edge
      if (p.targetObjectTypeId) {
        const isLive = p.status === 'RUNNING';
        flowEdges.push({
          id: `e-pipe-${p.id}-ot-${p.targetObjectTypeId}`,
          source: `pipe-${p.id}`,
          target: p.targetObjectTypeId,
          animated: isLive,
          markerEnd: { type: MarkerType.ArrowClosed, color: isLive ? '#6366F1' : '#A5B4FC' },
          style: { stroke: isLive ? '#6366F1' : '#A5B4FC', strokeWidth: isLive ? 2 : 1.5 },
        });
      }
    });

    // --- ObjectType nodes ---
    const runningTargetIds = new Set(
      pipelines.filter((p) => p.status === 'RUNNING').map((p) => p.targetObjectTypeId).filter(Boolean)
    );

    objectTypes.forEach((ot, i) => {
      flowNodes.push({
        id: ot.id,
        type: 'objectTypeNode',
        position: { x: COL_OBJECT, y: i * ROW_GAP + 40 },
        data: { objectType: ot, isReceivingData: runningTargetIds.has(ot.id) },
      });

      // Direct connector → objectType edges (for connectors not covered by a pipeline)
      const pipelineConnectorIds = new Set(
        pipelines
          .filter((p) => p.targetObjectTypeId === ot.id)
          .flatMap((p) => p.connectorIds)
      );
      ot.sourceConnectorIds.forEach((cId) => {
        if (!pipelineConnectorIds.has(cId) && usedConnectorIds.has(cId)) {
          flowEdges.push({
            id: `e-direct-${cId}-${ot.id}`,
            source: `con-${cId}`,
            target: ot.id,
            markerEnd: { type: MarkerType.ArrowClosed, color: '#2563EB' },
            style: { stroke: '#93C5FD', strokeWidth: 1.5, strokeDasharray: '4 3' },
          });
        }
      });
    });

    // --- Ontology links (object type → object type) ---
    links.forEach((link) => {
      flowEdges.push({
        id: link.id,
        source: link.sourceObjectTypeId,
        target: link.targetObjectTypeId,
        animated: link.isInferred,
        label: link.relationshipType,
        markerEnd: { type: MarkerType.ArrowClosed, color: '#2563EB' },
        style: { stroke: '#2563EB', strokeWidth: 1.5, strokeDasharray: link.isInferred ? '4 3' : undefined },
        labelStyle: { fontSize: '11px', fill: '#64748B', fontFamily: 'var(--font-interface)' },
        labelBgStyle: { fill: '#FFFFFF', stroke: '#E2E8F0', strokeWidth: 1 },
      });
    });

    return { flowNodes, flowEdges };
  }, [objectTypes, connectors, pipelines, links]);

  const { flowNodes, flowEdges } = buildGraph();
  const [nodes, setNodes, onNodesChange] = useNodesState(flowNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(flowEdges);

  // Re-sync canvas when any store data changes, preserving dragged positions
  useEffect(() => {
    const { flowNodes: fresh, flowEdges: freshEdges } = buildGraph();
    setNodes((prev) =>
      fresh.map((n) => {
        const existing = prev.find((p) => p.id === n.id);
        return existing ? { ...n, position: existing.position } : n;
      })
    );
    setEdges(freshEdges);
  }, [objectTypes, connectors, pipelines, links]);

  const onNodeClick: NodeMouseHandler = useCallback((_event, node) => {
    const ot = objectTypes.find((o) => o.id === node.id);
    if (ot) {
      setSelectedObjectType(ot);
    }
  }, [objectTypes]);

  const onNodeDoubleClick: NodeMouseHandler = useCallback((_event, node) => {
    if (node.id.startsWith('pipe-')) {
      const pipeId = node.id.replace('pipe-', '');
      const pipeline = pipelines.find((p) => p.id === pipeId);
      if (pipeline) setExpandedPipeline(pipeline);
    }
  }, [pipelines]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* Header */}
      <div style={{
        height: 52, backgroundColor: '#FFFFFF', borderBottom: '1px solid #E2E8F0',
        display: 'flex', alignItems: 'center', padding: '0 16px', gap: '12px', flexShrink: 0,
      }}>
        <h1 style={{ fontSize: '16px', fontWeight: 500, color: '#0D1117' }}>Ontology Graph</h1>

        <div style={{ display: 'flex', gap: '6px', alignItems: 'center', marginLeft: '8px' }}>
          {objectTypes.map((ot) => (
            <button
              key={ot.id}
              onClick={() => {
                const node = nodes.find((n) => n.id === ot.id);
                setSelectedObjectType(ot);
              }}
              style={{
                height: '26px', padding: '0 10px', borderRadius: '2px',
                border: `1px solid ${selectedObjectType?.id === ot.id ? '#2563EB' : '#E2E8F0'}`,
                backgroundColor: selectedObjectType?.id === ot.id ? '#EFF6FF' : '#FFFFFF',
                color: selectedObjectType?.id === ot.id ? '#1D4ED8' : '#64748B',
                fontSize: '12px', cursor: 'pointer', transition: 'all 80ms',
              }}
            >
              {ot.name}
            </button>
          ))}
        </div>

        <div style={{ marginLeft: 'auto', display: 'flex', gap: '8px', alignItems: 'center' }}>
          <Button variant="primary" size="sm" icon={<Plus size={12} />}>New Object Type</Button>
        </div>
      </div>

      {/* Graph + Panel */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        {/* React Flow canvas */}
        <div style={{ flex: 1, position: 'relative' }}>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onNodeClick={onNodeClick}
            onNodeDoubleClick={onNodeDoubleClick}
            nodeTypes={nodeTypes}
            fitView
            proOptions={{ hideAttribution: true }}
          >
            <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="#E2E8F0" />
            <Controls style={{ backgroundColor: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: '4px' }} />
            <MiniMap
              style={{
                backgroundColor: '#F8F9FA',
                border: '1px solid #E2E8F0',
                borderRadius: '4px',
              }}
              nodeColor="#1A3C6E"
              position="bottom-right"
            />
          </ReactFlow>
        </div>

        {/* Object type detail panel */}
        {selectedObjectType && (
          <ObjectTypePanel
            objectType={selectedObjectType}
            onClose={() => setSelectedObjectType(null)}
          />
        )}
      </div>

      {/* Pipeline expand overlay */}
      {expandedPipeline && (
        <PipelineExpandModal
          pipeline={expandedPipeline}
          onClose={() => setExpandedPipeline(null)}
        />
      )}

      {/* Status bar */}
      <div style={{
        height: 32, backgroundColor: '#0D1117', borderTop: '1px solid #1E293B',
        display: 'flex', alignItems: 'center', padding: '0 16px', gap: '16px', flexShrink: 0,
      }}>
        <span style={{ fontSize: '11px', color: '#475569', fontFamily: 'var(--font-mono)' }}>
          {connectors.filter(c => objectTypes.flatMap(o => o.sourceConnectorIds).includes(c.id) || pipelines.flatMap(p => p.connectorIds).includes(c.id)).length} connectors · {pipelines.length} pipelines · {objectTypes.length} object types · {links.length} links
        </span>
      </div>
    </div>
  );
};

export default OntologyGraph;
