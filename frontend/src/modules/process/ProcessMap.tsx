import React, { useEffect } from 'react';
import {
  ReactFlow, Background, Controls, MiniMap,
  useNodesState, useEdgesState, BackgroundVariant,
  Node, Edge, MarkerType, NodeProps, Handle, Position,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useProcessStore, Transition } from '../../store/processStore';

const speedStroke: Record<string, string> = {
  fast: '#15803D',
  normal: '#94A3B8',
  slow: '#DC2626',
};

// Custom activity node
const ActivityNode: React.FC<NodeProps> = ({ data, selected }) => {
  const d = data as { activity: string; caseCount: number; avgHours: number };
  const hours = d.avgHours || 0;
  const avgStr = hours < 1 ? `${Math.round(hours * 60)}m avg` : hours < 24 ? `${hours.toFixed(1)}h avg` : `${(hours / 24).toFixed(1)}d avg`;

  return (
    <div style={{
      width: 160,
      backgroundColor: '#FFFFFF',
      border: `1.5px solid ${selected ? '#2563EB' : '#CBD5E1'}`,
      borderRadius: 6,
      overflow: 'hidden',
      fontFamily: 'var(--font-interface)',
      boxShadow: selected ? '0 0 0 3px #DBEAFE' : '0 1px 4px rgba(0,0,0,0.06)',
    }}>
      <div style={{ height: 3, backgroundColor: '#1E3A5F' }} />
      <div style={{ padding: '8px 10px' }}>
        <div style={{ fontSize: 10, fontWeight: 700, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 3 }}>
          {d.activity.replace(/_/g, ' ').slice(0, 20)}
        </div>
        <div style={{ fontSize: 13, fontWeight: 600, color: '#0D1117', fontFamily: 'var(--font-mono)' }}>
          {d.caseCount.toLocaleString()}
        </div>
        <div style={{ fontSize: 10, color: '#94A3B8' }}>cases · {avgStr} here</div>
      </div>
      <Handle type="target" position={Position.Left} style={{ backgroundColor: '#94A3B8', border: '2px solid #fff', width: 8, height: 8 }} />
      <Handle type="source" position={Position.Right} style={{ backgroundColor: '#94A3B8', border: '2px solid #fff', width: 8, height: 8 }} />
    </div>
  );
};

const nodeTypes = { activityNode: ActivityNode };

function buildGraph(transitions: Transition[], activities: string[], medianHours: number) {
  if (!transitions.length) return { nodes: [], edges: [] };

  // Count cases per activity
  const activityCaseCount: Record<string, number> = {};
  const activityAvgHours: Record<string, number[]> = {};

  for (const t of transitions) {
    activityCaseCount[t.from_activity] = (activityCaseCount[t.from_activity] || 0) + t.count;
    activityCaseCount[t.to_activity] = (activityCaseCount[t.to_activity] || 0) + t.count;
    if (!activityAvgHours[t.to_activity]) activityAvgHours[t.to_activity] = [];
    activityAvgHours[t.to_activity].push(t.avg_hours);
  }

  // Layout: simple layered layout
  // Group activities by rough "stage" based on which appears as source vs target
  const sourceOnly = new Set<string>();
  const targetOnly = new Set<string>();

  for (const t of transitions) {
    const fromInTargets = transitions.some(x => x.to_activity === t.from_activity);
    const toInSources = transitions.some(x => x.from_activity === t.to_activity);
    if (!fromInTargets) sourceOnly.add(t.from_activity);
    if (!toInSources) targetOnly.add(t.to_activity);
  }

  const allActs = activities.filter(a => activityCaseCount[a]);
  const middle = allActs.filter(a => !sourceOnly.has(a) && !targetOnly.has(a));

  const cols: string[][] = [
    [...sourceOnly].filter(a => allActs.includes(a)),
    ...chunkArray(middle, 3),
    [...targetOnly].filter(a => allActs.includes(a)),
  ].filter(c => c.length > 0);

  const GAP_X = 240;
  const GAP_Y = 120;

  const nodes: Node[] = [];
  cols.forEach((col, colIdx) => {
    const totalH = (col.length - 1) * GAP_Y;
    col.forEach((act, rowIdx) => {
      const avgH = activityAvgHours[act]
        ? activityAvgHours[act].reduce((a, b) => a + b, 0) / activityAvgHours[act].length
        : 0;
      nodes.push({
        id: act,
        type: 'activityNode',
        position: { x: colIdx * GAP_X + 40, y: rowIdx * GAP_Y - totalH / 2 + 300 },
        data: {
          activity: act,
          caseCount: activityCaseCount[act] || 0,
          avgHours: Math.round(avgH * 10) / 10,
        },
      });
    });
  });

  const maxTransitionCount = Math.max(...transitions.map(t => t.count), 1);

  const edges: Edge[] = transitions.map(t => {
    const strokeWidth = Math.max(1, Math.round((t.count / maxTransitionCount) * 8));
    const color = speedStroke[t.speed];
    const label = t.avg_hours < 1
      ? `${Math.round(t.avg_hours * 60)}m`
      : t.avg_hours < 24
      ? `${t.avg_hours.toFixed(1)}h`
      : `${(t.avg_hours / 24).toFixed(1)}d`;

    return {
      id: `${t.from_activity}→${t.to_activity}`,
      source: t.from_activity,
      target: t.to_activity,
      label,
      labelStyle: { fontSize: 10, fill: color, fontFamily: 'var(--font-mono)' },
      labelBgStyle: { fill: '#FFFFFF', stroke: '#E2E8F0', strokeWidth: 1 },
      markerEnd: { type: MarkerType.ArrowClosed, color },
      style: { stroke: color, strokeWidth },
      animated: t.speed === 'fast',
    };
  });

  return { nodes, edges };
}

function chunkArray<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) chunks.push(arr.slice(i, i + size));
  return chunks;
}

interface Props { objectTypeId: string; }

export const ProcessMap: React.FC<Props> = ({ objectTypeId }) => {
  const { transitions, activities, medianHours, fetchTransitions } = useProcessStore();
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);

  useEffect(() => {
    if (objectTypeId) fetchTransitions(objectTypeId);
  }, [objectTypeId]);

  useEffect(() => {
    const { nodes: n, edges: e } = buildGraph(transitions, activities, medianHours);
    setNodes(n);
    setEdges(e);
  }, [transitions, activities, medianHours]);

  if (!transitions.length) {
    return (
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, padding: 40 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: '#0D1117' }}>No stage transitions recorded yet</div>
        <div style={{ fontSize: 12, color: '#64748B', maxWidth: 440, textAlign: 'center', lineHeight: 1.6 }}>
          Process transitions appear when the same entity moves through different stages across pipeline runs.
          Check the <strong>Cases</strong> tab to see current stage distribution, or run the pipeline again after
          entities have progressed through their workflow.
        </div>
        <div style={{ fontSize: 11, color: '#94A3B8', fontFamily: 'var(--font-mono)', marginTop: 4 }}>
          Tip: ensure your pipeline SINK EVENT node is configured with a stage field (e.g. dealstage, lifecyclestage)
        </div>
      </div>
    );
  }

  return (
    <div style={{ flex: 1, position: 'relative' }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        nodeTypes={nodeTypes}
        fitView
        proOptions={{ hideAttribution: true }}
      >
        <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="#E2E8F0" />
        <Controls style={{ backgroundColor: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: 4 }} />
        <MiniMap style={{ backgroundColor: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: 4 }} nodeColor="#1E3A5F" />
      </ReactFlow>

      {/* Legend */}
      <div style={{
        position: 'absolute', bottom: 60, left: 12,
        backgroundColor: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: 4,
        padding: '8px 12px', fontSize: 10, display: 'flex', gap: 14,
      }}>
        {[
          { color: '#15803D', label: 'Fast transition' },
          { color: '#94A3B8', label: 'Normal' },
          { color: '#DC2626', label: 'Slow / bottleneck' },
        ].map(({ color, label }) => (
          <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <div style={{ width: 20, height: 2, backgroundColor: color }} />
            <span style={{ color: '#64748B' }}>{label}</span>
          </div>
        ))}
        <div style={{ borderLeft: '1px solid #E2E8F0', paddingLeft: 14, color: '#64748B' }}>
          Edge thickness = frequency
        </div>
      </div>
    </div>
  );
};
