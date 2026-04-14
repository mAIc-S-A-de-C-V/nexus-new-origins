import React, { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import {
  ReactFlow, Background, Controls, MiniMap,
  useNodesState, useEdgesState, BackgroundVariant,
  Node, Edge, MarkerType, NodeProps, Handle, Position,
  useReactFlow, ReactFlowProvider, NodeMouseHandler,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import dagre from '@dagrejs/dagre';
import { useProcessStore, Transition } from '../../store/processStore';

const speedStroke: Record<string, string> = {
  fast: '#15803D',
  normal: '#64748B',
  slow: '#DC2626',
};

// Custom activity node
const ActivityNode: React.FC<NodeProps> = ({ data }) => {
  const d = data as {
    activity: string; caseCount: number; avgHours: number;
    isEntry?: boolean; isExit?: boolean;
    dimmed?: boolean; highlighted?: 'selected' | 'incoming' | 'outgoing';
  };
  const hours = d.avgHours || 0;
  const avgStr = hours < 1 ? `${Math.round(hours * 60)}m` : hours < 24 ? `${hours.toFixed(1)}h` : `${(hours / 24).toFixed(1)}d`;

  const baseAccent = d.isEntry ? '#2563EB' : d.isExit ? '#7C3AED' : '#1E3A5F';
  const accentColor =
    d.highlighted === 'selected' ? '#F59E0B' :
    d.highlighted === 'incoming' ? '#3B82F6' :
    d.highlighted === 'outgoing' ? '#10B981' :
    baseAccent;

  const opacity = d.dimmed ? 0.1 : 1;
  const shadow = d.highlighted
    ? `0 0 0 2.5px ${accentColor}55, 0 2px 8px ${accentColor}33`
    : '0 1px 4px rgba(0,0,0,0.08)';

  return (
    <div style={{
      width: 160,
      backgroundColor: '#FFFFFF',
      border: `1.5px solid ${d.highlighted ? accentColor : '#E2E8F0'}`,
      borderRadius: 8,
      overflow: 'hidden',
      fontFamily: 'var(--font-interface)',
      boxShadow: shadow,
      opacity,
      transition: 'opacity 0.15s, box-shadow 0.15s',
    }}>
      <div style={{ height: 3, backgroundColor: accentColor }} />
      <div style={{ padding: '8px 10px 10px' }}>
        {d.highlighted && (
          <div style={{
            fontSize: 8, fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase',
            color: accentColor, marginBottom: 3,
          }}>
            {d.highlighted === 'selected' ? 'selected' : d.highlighted === 'incoming' ? '← inflow' : 'outflow →'}
          </div>
        )}
        <div style={{ fontSize: 11, fontWeight: 600, color: '#1E293B', marginBottom: 5, lineHeight: 1.3, wordBreak: 'break-word' }}>
          {d.activity.replace(/_/g, ' ')}
        </div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 5 }}>
          <span style={{ fontSize: 15, fontWeight: 700, color: '#0D1117', fontFamily: 'var(--font-mono)', lineHeight: 1 }}>
            {d.caseCount.toLocaleString()}
          </span>
          <span style={{ fontSize: 10, color: '#94A3B8' }}>events</span>
        </div>
        <div style={{ fontSize: 10, color: '#94A3B8', marginTop: 2 }}>avg {avgStr} here</div>
      </div>
      <Handle type="target" position={Position.Left} style={{ backgroundColor: '#CBD5E1', border: '2px solid #fff', width: 8, height: 8 }} />
      <Handle type="source" position={Position.Right} style={{ backgroundColor: '#CBD5E1', border: '2px solid #fff', width: 8, height: 8 }} />
    </div>
  );
};

const nodeTypes = { activityNode: ActivityNode };

const NODE_W = 160;
const NODE_H = 90;

function buildGraph(transitions: Transition[]) {
  if (!transitions.length) return { nodes: [], edges: [], rawEdges: [] as Transition[] };

  const caseCount: Record<string, number> = {};
  const avgHoursAccum: Record<string, { sum: number; total: number }> = {};
  const incoming = new Map<string, Set<string>>();
  const outgoing = new Map<string, Set<string>>();

  for (const t of transitions) {
    caseCount[t.from_activity] = (caseCount[t.from_activity] || 0) + t.count;
    caseCount[t.to_activity] = (caseCount[t.to_activity] || 0) + t.count;
    if (!avgHoursAccum[t.to_activity]) avgHoursAccum[t.to_activity] = { sum: 0, total: 0 };
    avgHoursAccum[t.to_activity].sum += t.avg_hours * t.count;
    avgHoursAccum[t.to_activity].total += t.count;
    if (!outgoing.has(t.from_activity)) outgoing.set(t.from_activity, new Set());
    outgoing.get(t.from_activity)!.add(t.to_activity);
    if (!incoming.has(t.to_activity)) incoming.set(t.to_activity, new Set());
    incoming.get(t.to_activity)!.add(t.from_activity);
  }

  const allActs = new Set<string>();
  transitions.forEach(t => { allActs.add(t.from_activity); allActs.add(t.to_activity); });

  // DFS back-edge detection
  const visited = new Set<string>();
  const inStack = new Set<string>();
  const backEdges = new Set<string>();

  function dfs(node: string) {
    visited.add(node); inStack.add(node);
    for (const next of outgoing.get(node) ?? []) {
      const eid = `${node}→${next}`;
      if (inStack.has(next)) backEdges.add(eid);
      else if (!visited.has(next)) dfs(next);
    }
    inStack.delete(node);
  }
  [...allActs].sort((a, b) => (outgoing.get(b)?.size ?? 0) - (outgoing.get(a)?.size ?? 0))
    .forEach(act => { if (!visited.has(act)) dfs(act); });

  // Dagre layout
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: 'LR', ranksep: 80, nodesep: 40, edgesep: 20, marginx: 40, marginy: 40 });
  g.setDefaultEdgeLabel(() => ({}));
  for (const act of allActs) g.setNode(act, { width: NODE_W, height: NODE_H });
  for (const t of transitions) {
    const eid = `${t.from_activity}→${t.to_activity}`;
    backEdges.has(eid) ? g.setEdge(t.to_activity, t.from_activity) : g.setEdge(t.from_activity, t.to_activity);
  }
  dagre.layout(g);

  const entrySet = new Set([...allActs].filter(a => !incoming.has(a) || incoming.get(a)!.size === 0));
  const exitSet = new Set([...allActs].filter(a => !outgoing.has(a) || outgoing.get(a)!.size === 0));

  const nodes: Node[] = [];
  for (const act of allActs) {
    const pos = g.node(act);
    if (!pos) continue;
    const accum = avgHoursAccum[act];
    const avgH = accum ? accum.sum / accum.total : 0;
    nodes.push({
      id: act, type: 'activityNode',
      position: { x: pos.x - NODE_W / 2, y: pos.y - NODE_H / 2 },
      data: { activity: act, caseCount: caseCount[act] ?? 0, avgHours: Math.round(avgH * 10) / 10, isEntry: entrySet.has(act), isExit: exitSet.has(act) },
    });
  }

  const maxCount = Math.max(...transitions.map(t => t.count), 1);
  const edges: Edge[] = transitions.map(t => {
    const w = Math.max(1, Math.round((t.count / maxCount) * 6));
    const color = speedStroke[t.speed] ?? '#64748B';
    const label = t.avg_hours < 1 ? `${Math.round(t.avg_hours * 60)}m` : t.avg_hours < 24 ? `${t.avg_hours.toFixed(1)}h` : `${(t.avg_hours / 24).toFixed(1)}d`;
    const isBack = backEdges.has(`${t.from_activity}→${t.to_activity}`);
    return {
      id: `${t.from_activity}→${t.to_activity}`,
      source: t.from_activity, target: t.to_activity,
      type: 'smoothstep', label,
      labelStyle: { fontSize: 9, fill: color, fontFamily: 'var(--font-mono)', fontWeight: 600 },
      labelBgStyle: { fill: '#FFFFFF', stroke: color, strokeWidth: 0.8, rx: 3, ry: 3 },
      labelBgPadding: [3, 4] as [number, number],
      markerEnd: { type: MarkerType.ArrowClosed, color, width: 13, height: 13 },
      style: { stroke: color, strokeWidth: w, strokeDasharray: isBack ? '5,3' : undefined },
      animated: t.speed === 'fast',
      data: { baseColor: color, baseWidth: w, isBack },
    };
  });

  return { nodes, edges, rawEdges: transitions };
}

interface InnerProps { objectTypeId: string; }

const ProcessMapInner: React.FC<InnerProps> = ({ objectTypeId }) => {
  const { transitions, activities, fetchTransitions } = useProcessStore();
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const { fitView } = useReactFlow();
  const fitRef = useRef(false);

  // Selection state
  const [selectedId, setSelectedId] = useState<string | null>(null);   // single click
  const [focusId, setFocusId] = useState<string | null>(null);          // double click

  // Reset when data changes
  useEffect(() => {
    if (objectTypeId) fetchTransitions(objectTypeId);
  }, [objectTypeId]);

  useEffect(() => {
    if (!transitions.length) return;
    const { nodes: n, edges: e } = buildGraph(transitions);
    setNodes(n);
    setEdges(e);
    fitRef.current = false;
    setSelectedId(null);
    setFocusId(null);
  }, [transitions, activities]);

  useEffect(() => {
    if (nodes.length && !fitRef.current) {
      fitRef.current = true;
      setTimeout(() => fitView({ padding: 0.12, duration: 400 }), 80);
    }
  }, [nodes, fitView]);

  // ── Build focus subgraph (double-click) ─────────────────────────────────
  const focusReachable = useMemo<Set<string> | null>(() => {
    if (!focusId) return null;
    const fwd = new Set<string>([focusId]);
    const q = [focusId];
    while (q.length) {
      const curr = q.shift()!;
      for (const e of edges) {
        if (e.source === curr && !fwd.has(e.target)) { fwd.add(e.target); q.push(e.target); }
      }
    }
    const bwd = new Set<string>([focusId]);
    const q2 = [focusId];
    while (q2.length) {
      const curr = q2.shift()!;
      for (const e of edges) {
        if (e.target === curr && !bwd.has(e.source)) { bwd.add(e.source); q2.push(e.source); }
      }
    }
    return new Set([...fwd, ...bwd]);
  }, [focusId, edges]);

  // ── Derive display nodes with highlight/dim/hidden overlays ─────────────
  const displayNodes = useMemo(() => {
    if (focusReachable) {
      return nodes.map(n => ({
        ...n,
        hidden: !focusReachable.has(n.id),
        data: {
          ...n.data,
          highlighted: n.id === focusId ? 'selected' as const : undefined,
          dimmed: false,
        },
      }));
    }
    if (selectedId) {
      const incomers = new Set(edges.filter(e => e.target === selectedId).map(e => e.source));
      const outgoers = new Set(edges.filter(e => e.source === selectedId).map(e => e.target));
      return nodes.map(n => ({
        ...n,
        data: {
          ...n.data,
          highlighted: n.id === selectedId ? 'selected' as const : incomers.has(n.id) ? 'incoming' as const : outgoers.has(n.id) ? 'outgoing' as const : undefined,
          dimmed: n.id !== selectedId && !incomers.has(n.id) && !outgoers.has(n.id),
        },
      }));
    }
    return nodes.map(n => ({ ...n, data: { ...n.data, highlighted: undefined, dimmed: false } }));
  }, [nodes, edges, selectedId, focusId, focusReachable]);

  // ── Derive display edges ─────────────────────────────────────────────────
  const displayEdges = useMemo(() => {
    if (focusReachable) {
      return edges.map(e => ({
        ...e,
        hidden: !focusReachable.has(e.source) || !focusReachable.has(e.target),
      }));
    }
    if (selectedId) {
      return edges.map(e => {
        const isIn = e.target === selectedId;
        const isOut = e.source === selectedId;
        if (isIn) return {
          ...e, animated: true,
          style: { ...(e.style || {}), stroke: '#3B82F6', strokeWidth: Math.max(2, (e.data?.baseWidth as number) || 1), opacity: 1 },
          markerEnd: { type: MarkerType.ArrowClosed, color: '#3B82F6', width: 14, height: 14 },
        };
        if (isOut) return {
          ...e, animated: true,
          style: { ...(e.style || {}), stroke: '#10B981', strokeWidth: Math.max(2, (e.data?.baseWidth as number) || 1), opacity: 1 },
          markerEnd: { type: MarkerType.ArrowClosed, color: '#10B981', width: 14, height: 14 },
        };
        return { ...e, label: '', style: { ...(e.style || {}), opacity: 0.06 } };
      });
    }
    return edges;
  }, [edges, selectedId, focusReachable]);

  // ── Handlers ─────────────────────────────────────────────────────────────
  const onNodeClick: NodeMouseHandler = useCallback((_evt, node) => {
    if (focusId) return; // in focus mode, single click does nothing
    setSelectedId(prev => prev === node.id ? null : node.id);
  }, [focusId]);

  const onNodeDoubleClick: NodeMouseHandler = useCallback((_evt, node) => {
    setFocusId(prev => {
      if (prev === node.id) {
        setSelectedId(null);
        return null;
      }
      setSelectedId(null);
      return node.id;
    });
  }, []);

  const onPaneClick = useCallback(() => {
    setSelectedId(null);
    // don't exit focus on pane click — user must press Escape or double-click again
  }, []);

  // ESC exits focus
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') { setFocusId(null); setSelectedId(null); } };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  if (!transitions.length) {
    return (
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, padding: 40 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: '#0D1117' }}>No process transitions recorded yet</div>
        <div style={{ fontSize: 12, color: '#64748B', maxWidth: 440, textAlign: 'center', lineHeight: 1.6 }}>
          Open the <strong>Settings</strong> tab, select your pipeline, and click <strong>Save & Apply</strong>.
          For event-log data (like ClinicalEvent), leave the Activity Field Override blank.
        </div>
      </div>
    );
  }

  return (
    <div style={{ flex: 1, position: 'relative' }}>
      <ReactFlow
        nodes={displayNodes}
        edges={displayEdges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        nodeTypes={nodeTypes}
        onNodeClick={onNodeClick}
        onNodeDoubleClick={onNodeDoubleClick}
        onPaneClick={onPaneClick}
        fitView
        fitViewOptions={{ padding: 0.12 }}
        minZoom={0.05}
        proOptions={{ hideAttribution: true }}
        selectNodesOnDrag={false}
        nodesFocusable={false}
      >
        <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="#E8ECF0" />
        <Controls style={{ backgroundColor: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: 6, boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }} />
        <MiniMap
          style={{ backgroundColor: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: 6 }}
          nodeColor={(n) => {
            const d = n.data as any;
            if (d.dimmed) return '#E2E8F0';
            if (d.highlighted === 'selected') return '#F59E0B';
            if (d.highlighted === 'incoming') return '#3B82F6';
            if (d.highlighted === 'outgoing') return '#10B981';
            return d.isEntry ? '#2563EB' : d.isExit ? '#7C3AED' : '#1E3A5F';
          }}
        />
      </ReactFlow>

      {/* Focus mode banner */}
      {focusId && (
        <div style={{
          position: 'absolute', top: 12, left: '50%', transform: 'translateX(-50%)',
          backgroundColor: '#1E3A5F', color: '#FFFFFF', borderRadius: 6,
          padding: '6px 14px', fontSize: 11, fontWeight: 600,
          display: 'flex', alignItems: 'center', gap: 10,
          boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
        }}>
          <span>Focus: <span style={{ color: '#F59E0B' }}>{focusId.replace(/_/g, ' ')}</span></span>
          <span style={{ color: '#94A3B8', fontSize: 10 }}>— showing all paths through this activity</span>
          <button
            onClick={() => { setFocusId(null); setSelectedId(null); }}
            style={{ marginLeft: 6, background: 'rgba(255,255,255,0.12)', border: 'none', color: '#FFFFFF', borderRadius: 4, padding: '2px 8px', fontSize: 10, cursor: 'pointer' }}
          >
            esc
          </button>
        </div>
      )}

      {/* Hint when nothing is selected */}
      {!selectedId && !focusId && (
        <div style={{
          position: 'absolute', top: 12, right: 12,
          backgroundColor: 'rgba(255,255,255,0.9)', border: '1px solid #E2E8F0',
          borderRadius: 5, padding: '5px 10px', fontSize: 10, color: '#94A3B8',
          boxShadow: '0 1px 4px rgba(0,0,0,0.05)',
        }}>
          Click to highlight flows · Double-click to focus paths
        </div>
      )}

      {/* Legend */}
      <div style={{
        position: 'absolute', bottom: 64, left: 12,
        backgroundColor: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: 6,
        padding: '7px 12px', fontSize: 10, display: 'flex', alignItems: 'center', gap: 14,
        boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
      }}>
        {[
          { color: '#2563EB', label: 'Entry' },
          { color: '#7C3AED', label: 'Exit' },
          { color: '#3B82F6', label: 'Inflow' },
          { color: '#10B981', label: 'Outflow' },
          { color: '#DC2626', label: 'Bottleneck' },
        ].map(({ color, label }) => (
          <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <div style={{ width: ['Entry', 'Exit', 'Inflow', 'Outflow'].includes(label) ? 10 : 18, height: ['Entry', 'Exit', 'Inflow', 'Outflow'].includes(label) ? 10 : 2, backgroundColor: color, borderRadius: ['Entry', 'Exit', 'Inflow', 'Outflow'].includes(label) ? 2 : 0 }} />
            <span style={{ color: '#64748B' }}>{label}</span>
          </div>
        ))}
        <div style={{ borderLeft: '1px solid #E2E8F0', paddingLeft: 14, color: '#94A3B8' }}>
          Thickness = frequency · Dashed = back-flow
        </div>
      </div>
    </div>
  );
};

interface Props { objectTypeId: string; }

export const ProcessMap: React.FC<Props> = ({ objectTypeId }) => (
  <ReactFlowProvider>
    <ProcessMapInner objectTypeId={objectTypeId} />
  </ReactFlowProvider>
);
