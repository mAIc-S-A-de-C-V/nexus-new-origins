import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
  ReactFlow, Background, Controls, MiniMap,
  addEdge, useNodesState, useEdgesState,
  Connection, Edge, Node, NodeMouseHandler,
  BackgroundVariant,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import {
  Play, Square, ChevronLeft, ChevronRight,
  Plus, Save, RotateCcw, Trash2
} from 'lucide-react';
import { PipelineNodeComponent } from './PipelineNode';
import { PipelineEdgeComponent } from './PipelineEdge';
import { NodePalette } from './NodePalette';
import { NodeConfigPanel } from './NodeConfigPanel';
import { Button } from '../../design-system/components/Button';
import { Badge } from '../../design-system/components/Badge';
import { usePipelineStore } from '../../store/pipelineStore';
import { useNavigationStore } from '../../store/navigationStore';
import { nodeColors } from '../../design-system/tokens';
import { PipelineNode, PipelineStatus } from '../../types/pipeline';

const nodeTypes = {
  pipelineNode: PipelineNodeComponent,
};

const edgeTypes = {
  pipelineEdge: PipelineEdgeComponent,
};

const statusConfig: Record<PipelineStatus, { label: string; bg: string; text: string }> = {
  RUNNING: { label: 'Running', bg: '#FFF7ED', text: '#92400E' },
  IDLE: { label: 'Idle', bg: '#F8FAFC', text: '#475569' },
  FAILED: { label: 'Failed', bg: '#FEF2F2', text: '#991B1B' },
  PAUSED: { label: 'Paused', bg: '#FEFCE8', text: '#713F12' },
  DRAFT: { label: 'Draft', bg: '#F8FAFC', text: '#64748B' },
  COMPLETED: { label: 'Completed', bg: '#F0FDF4', text: '#166534' },
};

export const PipelineBuilder: React.FC = () => {
  const { pipelines, selectedPipelineId, selectPipeline, updatePipelineNodes, fetchPipelines, runPipeline, addPipeline, removePipeline } = usePipelineStore();
  const { consumePendingPipeline } = useNavigationStore();
  const [paletteVisible, setPaletteVisible] = useState(true);
  const [selectedNode, setSelectedNode] = useState<PipelineNode | null>(null);
  const [isRunning, setIsRunning] = useState(false);

  useEffect(() => {
    const pending = consumePendingPipeline();
    fetchPipelines().then(() => {
      if (pending) {
        const now = new Date().toISOString();
        addPipeline({
          id: '',
          name: pending.name || 'New Pipeline',
          description: pending.description,
          status: 'DRAFT',
          nodes: pending.nodes || [],
          edges: pending.edges || [],
          connectorIds: pending.connectorIds || [],
          targetObjectTypeId: pending.targetObjectTypeId,
          createdAt: now,
          updatedAt: now,
          tenantId: pending.tenantId || 'tenant-001',
          version: 1,
        }).then((created) => {
          selectPipeline(created.id);
        });
      }
    });
  }, []);

  const currentPipeline = pipelines.find((p) => p.id === selectedPipelineId) || pipelines[0];

  const toFlowNodes = (pNodes: PipelineNode[]): Node[] =>
    pNodes.map((n) => ({
      id: n.id,
      type: 'pipelineNode',
      position: n.position,
      data: {
        label: n.label,
        nodeType: n.type,
        config: n.config,
      },
    }));

  const toFlowEdges = (pEdges: { id: string; source: string; target: string; label?: string }[]): Edge[] =>
    pEdges.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      type: 'pipelineEdge',
      data: { label: e.label },
      animated: false,
    }));

  const [nodes, setNodes, onNodesChange] = useNodesState(
    currentPipeline ? toFlowNodes(currentPipeline.nodes) : []
  );
  const [edges, setEdges, onEdgesChange] = useEdgesState(
    currentPipeline ? toFlowEdges(currentPipeline.edges) : []
  );

  const reactFlowWrapper = useRef<HTMLDivElement>(null);
  const [rfInstance, setRfInstance] = useState<any>(null);

  useEffect(() => {
    if (currentPipeline) {
      setNodes(toFlowNodes(currentPipeline.nodes));
      setEdges(toFlowEdges(currentPipeline.edges));
    }
  }, [selectedPipelineId]);

  const onConnect = useCallback(
    (params: Connection) => setEdges((eds) => addEdge({ ...params, type: 'pipelineEdge' }, eds)),
    [setEdges]
  );

  const onNodeClick: NodeMouseHandler = useCallback((_event, node) => {
    const pipelineNode = currentPipeline?.nodes.find((n) => n.id === node.id);
    if (pipelineNode) setSelectedNode(pipelineNode);
  }, [currentPipeline]);

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      const nodeType = event.dataTransfer.getData('application/reactflow/nodetype');
      if (!nodeType || !rfInstance) return;

      const reactFlowBounds = reactFlowWrapper.current?.getBoundingClientRect();
      if (!reactFlowBounds) return;

      const position = rfInstance.screenToFlowPosition({
        x: event.clientX - reactFlowBounds.left,
        y: event.clientY - reactFlowBounds.top,
      });

      const newNode: Node = {
        id: `node-${Date.now()}`,
        type: 'pipelineNode',
        position,
        data: {
          label: nodeType.replace('_', ' ').toLowerCase(),
          nodeType,
          config: {},
        },
      };

      setNodes((nds) => [...nds, newNode]);
    },
    [rfInstance]
  );

  const onDragOver = (event: React.DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  };

  const handleRun = async () => {
    if (!currentPipeline) return;
    setIsRunning(true);
    try {
      await runPipeline(currentPipeline.id);
    } catch (err) {
      console.error('Run pipeline failed:', err);
    } finally {
      setIsRunning(false);
    }
  };

  const pipelineStatus = currentPipeline?.status || 'DRAFT';
  const statusConf = statusConfig[pipelineStatus];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* Top bar */}
      <div style={{
        height: 52,
        backgroundColor: '#FFFFFF',
        borderBottom: '1px solid #E2E8F0',
        display: 'flex',
        alignItems: 'center',
        padding: '0 52px 0 16px',
        gap: '12px',
        flexShrink: 0,
      }}>
        <h1 style={{ fontSize: '16px', fontWeight: 500, color: '#0D1117' }}>Pipeline Builder</h1>

        {/* Pipeline selector dropdown */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginLeft: '8px' }}>
          <select
            value={selectedPipelineId || ''}
            onChange={(e) => selectPipeline(e.target.value)}
            style={{
              height: '28px',
              padding: '0 28px 0 10px',
              borderRadius: '4px',
              border: '1px solid #E2E8F0',
              backgroundColor: '#FFFFFF',
              color: '#0D1117',
              fontSize: '12px',
              fontWeight: 500,
              cursor: 'pointer',
              outline: 'none',
              appearance: 'none',
              backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'%3E%3Cpath d='M1 1l4 4 4-4' stroke='%2394A3B8' stroke-width='1.5' fill='none' stroke-linecap='round'/%3E%3C/svg%3E")`,
              backgroundRepeat: 'no-repeat',
              backgroundPosition: 'right 8px center',
              minWidth: 160,
              maxWidth: 260,
            }}
          >
            {pipelines.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
          <Button variant="ghost" size="sm" icon={<Plus size={12} />}>New</Button>
          {currentPipeline && (
            <button
              onClick={async () => {
                if (!confirm(`Delete pipeline "${currentPipeline.name}"? This cannot be undone.`)) return;
                const remaining = pipelines.filter(p => p.id !== currentPipeline.id);
                if (remaining.length > 0) selectPipeline(remaining[0].id);
                await removePipeline(currentPipeline.id);
              }}
              title="Delete pipeline"
              style={{
                height: '28px', width: '28px', display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: 'none', border: '1px solid #FCA5A5', borderRadius: '4px',
                color: '#DC2626', cursor: 'pointer',
              }}
            >
              <Trash2 size={13} />
            </button>
          )}
        </div>

        {currentPipeline && (
          <span style={{
            fontSize: '11px',
            backgroundColor: statusConf.bg,
            color: statusConf.text,
            padding: '2px 8px',
            borderRadius: '2px',
            fontWeight: 500,
          }}>
            {statusConf.label}
          </span>
        )}

        <div style={{ marginLeft: 'auto', display: 'flex', gap: '8px', alignItems: 'center' }}>
          {currentPipeline && (
            <span style={{ fontSize: '12px', color: '#94A3B8', fontFamily: 'var(--font-mono)' }}>
              v{currentPipeline.version}
            </span>
          )}
          <Button variant="secondary" size="sm" icon={<Save size={12} />}>Save</Button>
          <Button variant="secondary" size="sm" icon={<RotateCcw size={12} />}>Reset</Button>
          <Button
            variant="primary"
            size="sm"
            icon={isRunning ? <Square size={12} /> : <Play size={12} />}
            onClick={handleRun}
            loading={isRunning}
          >
            {isRunning ? 'Running...' : 'Run Pipeline'}
          </Button>
        </div>
      </div>

      {/* Canvas area */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        {/* Palette toggle + palette */}
        <div style={{ display: 'flex', height: '100%' }}>
          {paletteVisible && <NodePalette />}
          <button
            onClick={() => setPaletteVisible(!paletteVisible)}
            style={{
              width: '14px',
              backgroundColor: '#F8F9FA',
              border: 'none',
              borderRight: '1px solid #E2E8F0',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#94A3B8',
              padding: 0,
              flexShrink: 0,
            }}
            title={paletteVisible ? 'Hide palette' : 'Show palette'}
          >
            {paletteVisible ? <ChevronLeft size={10} /> : <ChevronRight size={10} />}
          </button>
        </div>

        {/* React Flow canvas */}
        <div
          ref={reactFlowWrapper}
          style={{ flex: 1, position: 'relative' }}
          onDrop={onDrop}
          onDragOver={onDragOver}
        >
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodeClick={onNodeClick}
            onInit={setRfInstance}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            fitView
            snapToGrid
            snapGrid={[12, 12]}
            defaultEdgeOptions={{
              type: 'pipelineEdge',
              animated: false,
            }}
            proOptions={{ hideAttribution: true }}
          >
            <Background
              variant={BackgroundVariant.Dots}
              gap={20}
              size={1}
              color="#E2E8F0"
            />
            <Controls
              style={{
                backgroundColor: '#FFFFFF',
                border: '1px solid #E2E8F0',
                borderRadius: '4px',
              }}
            />
            <MiniMap
              style={{
                backgroundColor: '#F8F9FA',
                border: '1px solid #E2E8F0',
                borderRadius: '4px',
              }}
              nodeColor={(node) => {
                const nodeType = (node.data as any)?.nodeType || 'SOURCE';
                return nodeColors[nodeType] || '#64748B';
              }}
            />
          </ReactFlow>

          {/* Empty state */}
          {nodes.length === 0 && (
            <div style={{
              position: 'absolute', inset: 0,
              display: 'flex', flexDirection: 'column',
              alignItems: 'center', justifyContent: 'center',
              pointerEvents: 'none', color: '#94A3B8',
              gap: '8px',
            }}>
              <div style={{ fontSize: '14px', fontWeight: 500 }}>Drag nodes from the palette to build your pipeline</div>
              <div style={{ fontSize: '12px' }}>Connect nodes by dragging from the output handle to the next node</div>
            </div>
          )}
        </div>

        {/* Node config panel */}
        {selectedNode && (
          <NodeConfigPanel
            node={selectedNode}
            onClose={() => setSelectedNode(null)}
            onUpdate={(nodeId, config) => {
              setNodes((nds) =>
                nds.map((n) =>
                  n.id === nodeId ? { ...n, data: { ...n.data, config } } : n
                )
              );
            }}
          />
        )}
      </div>

      {/* Status bar */}
      <div style={{
        height: 32,
        backgroundColor: '#0D1117',
        borderTop: '1px solid #1E293B',
        display: 'flex',
        alignItems: 'center',
        padding: '0 16px',
        gap: '16px',
        flexShrink: 0,
      }}>
        <span style={{ fontSize: '11px', color: '#475569', fontFamily: 'var(--font-mono)' }}>
          {nodes.length} nodes · {edges.length} edges
        </span>
        {currentPipeline?.lastRunRowCount != null && (
          <span style={{ fontSize: '11px', color: '#475569', fontFamily: 'var(--font-mono)' }}>
            Last run: {currentPipeline.lastRunRowCount.toLocaleString()} rows
          </span>
        )}
        {isRunning && (
          <span style={{ fontSize: '11px', color: '#D97706', fontFamily: 'var(--font-mono)' }}>
            Pipeline executing...
          </span>
        )}
      </div>
    </div>
  );
};

export default PipelineBuilder;
