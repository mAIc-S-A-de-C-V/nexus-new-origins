import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  addEdge,
  BackgroundVariant,
  Node,
  Edge,
  MarkerType,
  NodeTypes,
  EdgeTypes,
  useReactFlow,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { TypeNode, RecordNode, GraphEdge, GraphMode } from '../../store/graphStore';
import { TypeNodeComponent, RecordNodeComponent, typeColor } from './ObjectNode';
import { LinkEdge } from './LinkEdge';

// ── Node / edge type registrations ────────────────────────────────────────────

const nodeTypes: NodeTypes = {
  typeNode: TypeNodeComponent,
  recordNode: RecordNodeComponent,
};

const edgeTypes: EdgeTypes = {
  linkEdge: LinkEdge,
};

// ── Layout algorithms ─────────────────────────────────────────────────────────

const NODE_W = 210;
const NODE_H = 130;
const COL_GAP = 20;
const ROW_GAP = 20;

function circularLayout(
  ids: string[],
  cx: number,
  cy: number,
  radius: number,
): Map<string, { x: number; y: number }> {
  const positions = new Map<string, { x: number; y: number }>();
  const n = ids.length;
  if (n === 0) return positions;
  if (n === 1) {
    positions.set(ids[0], { x: cx - NODE_W / 2, y: cy - NODE_H / 2 });
    return positions;
  }
  ids.forEach((id, i) => {
    const angle = (2 * Math.PI * i) / n - Math.PI / 2;
    positions.set(id, {
      x: cx + radius * Math.cos(angle) - NODE_W / 2,
      y: cy + radius * Math.sin(angle) - NODE_H / 2,
    });
  });
  return positions;
}

function gridLayout(
  ids: string[],
  cx: number,
  cy: number,
): Map<string, { x: number; y: number }> {
  const positions = new Map<string, { x: number; y: number }>();
  const n = ids.length;
  // Aim for a roughly 16:9 grid
  const cols = Math.max(2, Math.ceil(Math.sqrt(n * 1.8)));
  const rows = Math.ceil(n / cols);
  const totalW = cols * (NODE_W + COL_GAP) - COL_GAP;
  const totalH = rows * (NODE_H + ROW_GAP) - ROW_GAP;
  const startX = cx - totalW / 2;
  const startY = cy - totalH / 2;
  ids.forEach((id, i) => {
    positions.set(id, {
      x: startX + (i % cols) * (NODE_W + COL_GAP),
      y: startY + Math.floor(i / cols) * (NODE_H + ROW_GAP),
    });
  });
  return positions;
}

function ringLayout(
  nodes: { id: string; depth: number; object_type_id: string }[],
  cx = 700,
  cy = 420,
): Map<string, { x: number; y: number }> {
  const positions = new Map<string, { x: number; y: number }>();
  const byDepth = new Map<number, string[]>();
  for (const n of nodes) {
    const d = n.depth ?? 0;
    if (!byDepth.has(d)) byDepth.set(d, []);
    byDepth.get(d)!.push(n.id);
  }

  const depths = [...byDepth.keys()].sort();

  if (depths.length === 1) {
    // Only one depth level → grid layout
    const grid = gridLayout(byDepth.get(depths[0])!, cx, cy);
    for (const [id, pos] of grid) positions.set(id, pos);
    return positions;
  }

  // Multi-depth: central cluster for depth 0, rings for deeper levels
  for (const [depth, ids] of byDepth) {
    if (depth === 0) {
      if (ids.length === 1) {
        positions.set(ids[0], { x: cx - NODE_W / 2, y: cy - NODE_H / 2 });
      } else {
        // Small compact circle for seed nodes
        const r = Math.min(120, ids.length * 35);
        const map = circularLayout(ids, cx, cy, r);
        for (const [id, pos] of map) positions.set(id, pos);
      }
    } else {
      // Outer ring — scale radius by number of nodes to avoid overlap
      const baseR = 320 * depth;
      const neededR = (ids.length * (NODE_W + 10)) / (2 * Math.PI);
      const r = Math.max(baseR, neededR);
      const map = circularLayout(ids, cx, cy, r);
      for (const [id, pos] of map) positions.set(id, pos);
    }
  }
  return positions;
}

// ── Build ReactFlow nodes ─────────────────────────────────────────────────────

function buildTypeNodes(
  typeNodes: TypeNode[],
  typeEdges: GraphEdge[],
  selectedId: string | null,
): Node[] {
  const ids = typeNodes.map((n) => n.id);
  const n = ids.length;
  const radius = Math.max(260, (n * (NODE_W + 20)) / (2 * Math.PI));
  const positions = circularLayout(ids, 700, 420, radius);
  return typeNodes.map((n) => ({
    id: n.id,
    type: 'typeNode',
    position: positions.get(n.id) || { x: 0, y: 0 },
    data: { ...n, selected: selectedId === n.id },
    selected: selectedId === n.id,
  }));
}

function buildRecordNodes(
  recordNodes: RecordNode[],
  selectedId: string | null,
): Node[] {
  const positions = ringLayout(
    recordNodes.map((n) => ({ id: n.id, depth: n.depth, object_type_id: n.object_type_id }))
  );
  return recordNodes.map((n) => ({
    id: n.id,
    type: 'recordNode',
    position: positions.get(n.id) || { x: 0, y: 0 },
    data: {
      record_id: n.id,
      object_type_id: n.object_type_id,
      type_name: n.type_name,
      data: n.data,
      depth: n.depth,
      selected: selectedId === n.id,
    },
    selected: selectedId === n.id,
  }));
}

function buildEdges(graphEdges: GraphEdge[], mode: GraphMode): Edge[] {
  return graphEdges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    type: 'linkEdge',
    animated: false,
    markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14, color: '#CBD5E1' },
    data: {
      relationship_type: e.relationship_type,
      is_inferred: e.is_inferred,
      confidence: e.confidence,
    },
  }));
}

// ── Canvas component ──────────────────────────────────────────────────────────

interface GraphCanvasProps {
  mode: GraphMode;
  typeNodes: TypeNode[];
  typeEdges: GraphEdge[];
  recordNodes: RecordNode[];
  recordEdges: GraphEdge[];
  selectedNodeId: string | null;
  onSelectNode: (id: string | null) => void;
}

const FitOnLoad: React.FC<{ trigger: number }> = ({ trigger }) => {
  const { fitView } = useReactFlow();
  useEffect(() => {
    const t = setTimeout(() => fitView({ padding: 0.15, duration: 400 }), 80);
    return () => clearTimeout(t);
  }, [trigger, fitView]);
  return null;
};

export const GraphCanvas: React.FC<GraphCanvasProps> = ({
  mode, typeNodes, typeEdges, recordNodes, recordEdges, selectedNodeId, onSelectNode,
}) => {
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const fitTrigger = useRef(0);

  // Rebuild nodes/edges when data or selection changes
  useEffect(() => {
    if (mode === 'type_overview') {
      setNodes(buildTypeNodes(typeNodes, typeEdges, selectedNodeId));
      setEdges(buildEdges(typeEdges, mode));
    } else {
      setNodes(buildRecordNodes(recordNodes, selectedNodeId));
      setEdges(buildEdges(recordEdges, mode));
    }
    fitTrigger.current++;
  }, [mode, typeNodes, typeEdges, recordNodes, recordEdges, selectedNodeId]);

  const handleNodeClick = useCallback((_: React.MouseEvent, node: Node) => {
    onSelectNode(node.id);
  }, [onSelectNode]);

  const handlePaneClick = useCallback(() => {
    onSelectNode(null);
  }, [onSelectNode]);

  // MiniMap node color
  const miniMapColor = useCallback((node: Node) => {
    if (node.type === 'typeNode') {
      const d = node.data as { id: string };
      return typeColor(d.id).badge;
    }
    if (node.type === 'recordNode') {
      const d = node.data as { object_type_id: string };
      return typeColor(d.object_type_id).badge;
    }
    return '#CBD5E1';
  }, []);

  const isEmpty = mode === 'type_overview' ? typeNodes.length === 0 : recordNodes.length === 0;

  return (
    <div style={{ flex: 1, position: 'relative', backgroundColor: '#F8FAFC' }}>
      {isEmpty && (
        <div style={{
          position: 'absolute', inset: 0, display: 'flex',
          flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          gap: 10, zIndex: 5, pointerEvents: 'none',
        }}>
          <div style={{ fontSize: 13, color: '#94A3B8', fontWeight: 500 }}>
            {mode === 'type_overview'
              ? 'No object types yet — create some in Ontology'
              : 'Select a type from the sidebar and click "Explore Records in Graph"'}
          </div>
        </div>
      )}

      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodeClick={handleNodeClick}
        onPaneClick={handlePaneClick}
        fitView
        fitViewOptions={{ padding: 0.15 }}
        minZoom={0.1}
        maxZoom={2}
        proOptions={{ hideAttribution: true }}
        style={{ backgroundColor: '#F8FAFC' }}
      >
        <Background
          variant={BackgroundVariant.Dots}
          gap={20}
          size={1}
          color="#E2E8F0"
        />
        <Controls
          style={{
            bottom: 16, left: 16, top: 'auto',
            boxShadow: '0 1px 4px rgba(0,0,0,0.1)',
            borderRadius: 6, border: '1px solid #E2E8F0',
            backgroundColor: '#fff',
          }}
        />
        <MiniMap
          nodeColor={miniMapColor}
          style={{
            bottom: 16, right: 16, top: 'auto',
            border: '1px solid #E2E8F0',
            borderRadius: 6, backgroundColor: '#fff',
          }}
          pannable
          zoomable
        />
        <FitOnLoad trigger={fitTrigger.current} />
      </ReactFlow>
    </div>
  );
};
