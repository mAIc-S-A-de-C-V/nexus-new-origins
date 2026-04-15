import React, { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import {
  ReactFlow, Background, Controls, MiniMap,
  useNodesState, useEdgesState, BackgroundVariant,
  Node, Edge, MarkerType, NodeProps, Handle, Position,
  useReactFlow, ReactFlowProvider, NodeMouseHandler, EdgeMouseHandler,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import dagre from '@dagrejs/dagre';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { useProcessStore, Transition } from '../../store/processStore';
import { useConformanceStore } from '../../store/conformanceStore';

const INFERENCE_API = import.meta.env.VITE_INFERENCE_SERVICE_URL || 'http://localhost:8003';

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
    conformanceSkips?: number; conformanceUnauth?: number; conformanceWrongOrder?: number; conformanceInModel?: boolean;
  };
  const hours = d.avgHours || 0;
  const avgStr = hours < 1 ? `${Math.round(hours * 60)}m` : hours < 24 ? `${hours.toFixed(1)}h` : `${(hours / 24).toFixed(1)}d`;

  const hasDeviation = !!(d.conformanceSkips || d.conformanceUnauth || d.conformanceWrongOrder);
  const baseAccent = hasDeviation ? '#DC2626' : d.conformanceInModel === false && d.conformanceInModel !== undefined ? '#94A3B8' : d.isEntry ? '#2563EB' : d.isExit ? '#7C3AED' : '#1E3A5F';
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
        {/* Conformance badges */}
        {(d.conformanceSkips || d.conformanceUnauth || d.conformanceWrongOrder) ? (
          <div style={{ display: 'flex', gap: 3, marginTop: 4, flexWrap: 'wrap' }}>
            {!!d.conformanceSkips && (
              <span style={{ fontSize: 8, fontWeight: 700, padding: '1px 4px', borderRadius: 2, backgroundColor: '#FEF2F2', color: '#DC2626', border: '1px solid #FECACA' }}>
                {d.conformanceSkips} skip{d.conformanceSkips > 1 ? 's' : ''}
              </span>
            )}
            {!!d.conformanceWrongOrder && (
              <span style={{ fontSize: 8, fontWeight: 700, padding: '1px 4px', borderRadius: 2, backgroundColor: '#FFFBEB', color: '#92400E', border: '1px solid #FDE68A' }}>
                {d.conformanceWrongOrder} order
              </span>
            )}
            {!!d.conformanceUnauth && (
              <span style={{ fontSize: 8, fontWeight: 700, padding: '1px 4px', borderRadius: 2, backgroundColor: '#FEF2F2', color: '#991B1B', border: '1px solid #FECACA' }}>
                {d.conformanceUnauth} unauth
              </span>
            )}
          </div>
        ) : d.conformanceInModel === false && d.conformanceInModel !== undefined ? (
          <div style={{ marginTop: 4 }}>
            <span style={{ fontSize: 8, fontWeight: 700, padding: '1px 4px', borderRadius: 2, backgroundColor: '#F1F5F9', color: '#64748B', border: '1px solid #E2E8F0' }}>
              not in model
            </span>
          </div>
        ) : null}
      </div>
      <Handle type="target" position={Position.Left} style={{ backgroundColor: '#CBD5E1', border: '2px solid #fff', width: 8, height: 8 }} />
      <Handle type="source" position={Position.Right} style={{ backgroundColor: '#CBD5E1', border: '2px solid #fff', width: 8, height: 8 }} />
    </div>
  );
};

const nodeTypes = { activityNode: ActivityNode };

// Edge drill-down side panel
interface ChatMsg { role: 'user' | 'assistant'; text: string }

const EdgeDrillDown: React.FC<{ transition: Transition; totalCases: number; onClose: () => void }> = ({ transition: t, totalCases, onClose }) => {
  const fmtTime = (h: number) => h < 1 ? `${Math.round(h * 60)}m` : h < 24 ? `${h.toFixed(1)}h` : `${(h / 24).toFixed(1)}d`;
  const pctOfCases = totalCases > 0 ? ((t.count / totalCases) * 100).toFixed(1) : '0';

  const chartData = [
    { name: 'P50', hours: t.p50_hours },
    { name: 'Avg', hours: t.avg_hours },
    { name: 'P95', hours: t.p95_hours },
  ];

  // Mini chatbot state
  const [chatMsgs, setChatMsgs] = useState<ChatMsg[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [thinking, setThinking] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [chatMsgs]);

  const sendChat = async () => {
    const q = chatInput.trim();
    if (!q || thinking) return;
    setChatInput('');
    setChatMsgs(m => [...m, { role: 'user', text: q }]);
    setThinking(true);
    try {
      const context = `Transition: ${t.from_activity} → ${t.to_activity}. Cases: ${t.count} (${pctOfCases}% of total). Speed: ${t.speed}. P50: ${fmtTime(t.p50_hours)}, Avg: ${fmtTime(t.avg_hours)}, P95: ${fmtTime(t.p95_hours)}. Total cases in process: ${totalCases}.`;
      const res = await fetch(`${INFERENCE_API}/infer/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question: `Context about a process mining transition:\n${context}\n\nUser question: ${q}`,
          object_type_name: 'Process Transition',
          fields: ['from_activity', 'to_activity', 'count', 'avg_hours', 'p50_hours', 'p95_hours', 'speed'],
          records: [{ from_activity: t.from_activity, to_activity: t.to_activity, count: t.count, avg_hours: t.avg_hours, p50_hours: t.p50_hours, p95_hours: t.p95_hours, speed: t.speed }],
        }),
      });
      const data = await res.json();
      setChatMsgs(m => [...m, { role: 'assistant', text: data.answer || data.detail || 'No response.' }]);
    } catch {
      setChatMsgs(m => [...m, { role: 'assistant', text: 'Could not reach AI service.' }]);
    } finally {
      setThinking(false);
    }
  };

  return (
    <div style={{
      position: 'absolute', top: 0, right: 0, bottom: 0, width: 340,
      backgroundColor: '#FFFFFF', borderLeft: '1px solid #E2E8F0',
      boxShadow: '-4px 0 16px rgba(0,0,0,0.06)', zIndex: 20,
      display: 'flex', flexDirection: 'column', overflow: 'hidden',
    }}>
      {/* Header */}
      <div style={{
        padding: '12px 16px', borderBottom: '1px solid #E2E8F0',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0,
      }}>
        <div>
          <div style={{ fontSize: 10, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 3 }}>Transition</div>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#0D1117', lineHeight: 1.3 }}>
            {t.from_activity.replace(/_/g, ' ')} → {t.to_activity.replace(/_/g, ' ')}
          </div>
        </div>
        <button onClick={onClose} style={{ width: 24, height: 24, border: 'none', background: '#F1F5F9', borderRadius: 4, cursor: 'pointer', fontSize: 14, color: '#64748B', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>×</button>
      </div>

      {/* Stats grid — blue/indigo palette */}
      <div style={{ padding: '12px 16px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, flexShrink: 0 }}>
        <div style={{ padding: '8px 10px', backgroundColor: '#EFF6FF', borderRadius: 6, border: '1px solid #DBEAFE' }}>
          <div style={{ fontSize: 9, color: '#6366F1', textTransform: 'uppercase', fontWeight: 600, marginBottom: 3 }}>Cases</div>
          <div style={{ fontSize: 18, fontWeight: 700, color: '#1E3A5F', fontFamily: 'var(--font-mono)' }}>{t.count.toLocaleString()}</div>
          <div style={{ fontSize: 9, color: '#64748B', marginTop: 1 }}>{pctOfCases}% of total</div>
        </div>
        <div style={{ padding: '8px 10px', backgroundColor: '#EFF6FF', borderRadius: 6, border: '1px solid #DBEAFE' }}>
          <div style={{ fontSize: 9, color: '#6366F1', textTransform: 'uppercase', fontWeight: 600, marginBottom: 3 }}>Speed</div>
          <div style={{ fontSize: 14, fontWeight: 700, color: '#1E3A5F', textTransform: 'capitalize', marginTop: 4 }}>{t.speed}</div>
        </div>
        <div style={{ padding: '8px 10px', backgroundColor: '#F8FAFC', borderRadius: 6, border: '1px solid #E2E8F0' }}>
          <div style={{ fontSize: 9, color: '#94A3B8', textTransform: 'uppercase', fontWeight: 600, marginBottom: 3 }}>P50</div>
          <div style={{ fontSize: 16, fontWeight: 700, color: '#1E3A5F', fontFamily: 'var(--font-mono)' }}>{fmtTime(t.p50_hours)}</div>
        </div>
        <div style={{ padding: '8px 10px', backgroundColor: '#F8FAFC', borderRadius: 6, border: '1px solid #E2E8F0' }}>
          <div style={{ fontSize: 9, color: '#94A3B8', textTransform: 'uppercase', fontWeight: 600, marginBottom: 3 }}>Avg</div>
          <div style={{ fontSize: 16, fontWeight: 700, color: '#1E3A5F', fontFamily: 'var(--font-mono)' }}>{fmtTime(t.avg_hours)}</div>
        </div>
        <div style={{ padding: '8px 10px', backgroundColor: '#F5F3FF', borderRadius: 6, border: '1px solid #DDD6FE', gridColumn: '1 / -1' }}>
          <div style={{ fontSize: 9, color: '#7C3AED', textTransform: 'uppercase', fontWeight: 600, marginBottom: 3 }}>P95 (Worst 5%)</div>
          <div style={{ fontSize: 16, fontWeight: 700, color: '#5B21B6', fontFamily: 'var(--font-mono)' }}>{fmtTime(t.p95_hours)}</div>
        </div>
      </div>

      {/* Time distribution chart — blue/indigo bars */}
      <div style={{ padding: '0 16px 12px', flexShrink: 0 }}>
        <div style={{ fontSize: 10, fontWeight: 600, color: '#64748B', marginBottom: 6 }}>Time Distribution</div>
        <div style={{ height: 100, backgroundColor: '#F8FAFC', borderRadius: 6, border: '1px solid #E2E8F0', padding: '6px 4px' }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} barCategoryGap="20%">
              <XAxis dataKey="name" tick={{ fontSize: 9, fill: '#94A3B8' }} axisLine={false} tickLine={false} />
              <YAxis hide />
              <Tooltip
                formatter={(value) => fmtTime(Number(value))}
                contentStyle={{ fontSize: 11, borderRadius: 4, border: '1px solid #E2E8F0' }}
              />
              <Bar dataKey="hours" radius={[4, 4, 0, 0]}>
                <Cell fill="#3B82F6" />
                <Cell fill="#6366F1" />
                <Cell fill="#7C3AED" />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Divider */}
      <div style={{ height: 1, backgroundColor: '#E2E8F0', flexShrink: 0 }} />

      {/* Mini chatbot */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minHeight: 0 }}>
        <div style={{ padding: '8px 16px', flexShrink: 0 }}>
          <div style={{ fontSize: 10, fontWeight: 600, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Ask about this transition</div>
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: '0 16px 8px', display: 'flex', flexDirection: 'column', gap: 6 }}>
          {chatMsgs.length === 0 && (
            <div style={{ color: '#94A3B8', fontSize: 10, textAlign: 'center', marginTop: 8, lineHeight: 1.5 }}>
              Ask anything — e.g. "Why might this be slow?" or "What could reduce this P95?"
            </div>
          )}
          {chatMsgs.map((m, i) => (
            <div key={i} style={{
              padding: '6px 10px', borderRadius: m.role === 'user' ? '10px 10px 2px 10px' : '10px 10px 10px 2px',
              backgroundColor: m.role === 'user' ? '#1E3A5F' : '#F1F5F9',
              color: m.role === 'user' ? '#FFFFFF' : '#0D1117',
              fontSize: 11, lineHeight: 1.5, alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start',
              maxWidth: '90%',
            }}>
              {m.text}
            </div>
          ))}
          {thinking && (
            <div style={{ padding: '6px 10px', borderRadius: '10px 10px 10px 2px', backgroundColor: '#F1F5F9', color: '#94A3B8', fontSize: 11, alignSelf: 'flex-start' }}>
              Thinking...
            </div>
          )}
          <div ref={chatEndRef} />
        </div>
        <div style={{ padding: '8px 16px', borderTop: '1px solid #E2E8F0', display: 'flex', gap: 6, flexShrink: 0 }}>
          <input
            value={chatInput}
            onChange={e => setChatInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') sendChat(); }}
            placeholder="Ask a question..."
            style={{
              flex: 1, height: 30, padding: '0 10px', borderRadius: 6,
              border: '1px solid #E2E8F0', fontSize: 11, outline: 'none',
            }}
          />
          <button
            onClick={sendChat}
            disabled={!chatInput.trim() || thinking}
            style={{
              height: 30, padding: '0 12px', borderRadius: 6, border: 'none',
              backgroundColor: chatInput.trim() ? '#1E3A5F' : '#F1F5F9',
              color: chatInput.trim() ? '#FFFFFF' : '#94A3B8',
              fontSize: 11, fontWeight: 600, cursor: 'pointer',
            }}
          >Send</button>
        </div>
      </div>
    </div>
  );
};

const NODE_W = 160;
const NODE_H = 90;

export type ProcessViewMode = 'frequency' | 'performance';

function buildGraph(transitions: Transition[], viewMode: ProcessViewMode = 'performance') {
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
    const color = viewMode === 'frequency' ? '#64748B' : (speedStroke[t.speed] ?? '#64748B');
    const label = viewMode === 'frequency'
      ? `${t.count.toLocaleString()}`
      : t.avg_hours < 1 ? `${Math.round(t.avg_hours * 60)}m` : t.avg_hours < 24 ? `${t.avg_hours.toFixed(1)}h` : `${(t.avg_hours / 24).toFixed(1)}d`;
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
  const { transitions, activities, stats, fetchTransitions, variants } = useProcessStore();
  const { checkResult } = useConformanceStore();
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const { fitView } = useReactFlow();
  const fitRef = useRef(false);

  // View mode toggle
  const [viewMode, setViewMode] = useState<ProcessViewMode>('performance');

  // Path complexity: top N transitions by frequency
  const [topN, setTopN] = useState<number>(0); // 0 = show all
  const maxTransitions = transitions.length;

  // Selection state
  const [selectedId, setSelectedId] = useState<string | null>(null);   // single click
  const [focusId, setFocusId] = useState<string | null>(null);          // double click
  const [selectedEdge, setSelectedEdge] = useState<Transition | null>(null); // edge drill-down

  // Activity filter state
  const [activityFilter, setActivityFilter] = useState<{
    type: 'with' | 'without' | 'starting' | 'ending';
    activity: string;
  } | null>(null);

  // Node click popup position
  const [nodePopup, setNodePopup] = useState<{ activity: string; x: number; y: number } | null>(null);

  // Apply top-N path filter first
  const topNTransitions = useMemo(() => {
    if (!topN || topN >= transitions.length) return transitions;
    // Sort by count descending, take top N
    const sorted = [...transitions].sort((a, b) => b.count - a.count);
    return sorted.slice(0, topN);
  }, [transitions, topN]);

  // Apply activity filter using VARIANT sequences (not graph BFS which reaches everything in dense graphs)
  const filteredTransitions = useMemo(() => {
    if (!activityFilter) return topNTransitions;
    const { type, activity } = activityFilter;

    if (type === 'without') {
      // Remove transitions involving this activity entirely
      return topNTransitions.filter(t => t.from_activity !== activity && t.to_activity !== activity);
    }

    // Build the set of valid transitions from matching variants
    const matchingVariants = variants.filter(v => {
      if (type === 'with') return v.activities.includes(activity);
      if (type === 'starting') return v.activities[0] === activity;
      if (type === 'ending') return v.activities[v.activities.length - 1] === activity;
      return true;
    });

    if (!matchingVariants.length) return [];

    // Extract all consecutive-pair transitions from matching variants
    const validEdges = new Set<string>();
    for (const v of matchingVariants) {
      for (let i = 0; i < v.activities.length - 1; i++) {
        validEdges.add(`${v.activities[i]}→${v.activities[i + 1]}`);
      }
    }

    return topNTransitions.filter(t => validEdges.has(`${t.from_activity}→${t.to_activity}`));
  }, [topNTransitions, activityFilter, variants]);

  // ── Conformance overlay data ─────────────────────────────────────────────
  const conformanceOverlay = useMemo(() => {
    if (!checkResult?.cases?.length) return null;
    // Count deviations per activity
    const skipCount: Record<string, number> = {};
    const wrongOrderCount: Record<string, number> = {};
    const unauthorizedCount: Record<string, number> = {};
    const reworkCount: Record<string, number> = {};
    for (const c of checkResult.cases) {
      for (const d of c.deviations) {
        if (d.type === 'skip') skipCount[d.activity] = (skipCount[d.activity] || 0) + 1;
        else if (d.type === 'wrong_order') wrongOrderCount[d.activity] = (wrongOrderCount[d.activity] || 0) + 1;
        else if (d.type === 'unauthorized') unauthorizedCount[d.activity] = (unauthorizedCount[d.activity] || 0) + 1;
        else if (d.type === 'rework') reworkCount[d.activity] = (reworkCount[d.activity] || 0) + 1;
      }
    }
    // Build set of expected edges from model
    const modelActivities = checkResult.model_activities || [];
    const expectedEdges = new Set<string>();
    for (let i = 0; i < modelActivities.length - 1; i++) {
      expectedEdges.add(`${modelActivities[i]}→${modelActivities[i + 1]}`);
    }
    const modelSet = new Set(modelActivities);
    return { skipCount, wrongOrderCount, unauthorizedCount, reworkCount, expectedEdges, modelSet, totalCases: checkResult.aggregate.total_cases };
  }, [checkResult]);

  // Reset when data changes
  useEffect(() => {
    if (objectTypeId) fetchTransitions(objectTypeId);
  }, [objectTypeId]);

  useEffect(() => {
    if (!filteredTransitions.length) return;
    const { nodes: n, edges: e } = buildGraph(filteredTransitions, viewMode);
    setNodes(n);
    setEdges(e);
    fitRef.current = false;
    setSelectedId(null);
    setFocusId(null);
    setSelectedEdge(null);
  }, [filteredTransitions, activities, viewMode]);

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
    return nodes.map(n => {
      const d: Record<string, unknown> = { ...n.data, highlighted: undefined, dimmed: false };
      if (conformanceOverlay) {
        const act = n.id;
        const skips = conformanceOverlay.skipCount[act] || 0;
        const unauth = conformanceOverlay.unauthorizedCount[act] || 0;
        const wrongOrd = conformanceOverlay.wrongOrderCount[act] || 0;
        d.conformanceSkips = skips;
        d.conformanceUnauth = unauth;
        d.conformanceWrongOrder = wrongOrd;
        d.conformanceInModel = conformanceOverlay.modelSet.has(act);
      }
      return { ...n, data: d };
    });
  }, [nodes, edges, selectedId, focusId, focusReachable, conformanceOverlay]);

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
    if (conformanceOverlay) {
      return edges.map(e => {
        const isExpected = conformanceOverlay.expectedEdges.has(e.id);
        if (!isExpected) {
          return {
            ...e,
            style: { ...(e.style || {}), stroke: '#DC262688', strokeWidth: Math.max(2, (e.data?.baseWidth as number) || 1) },
            labelStyle: { ...(e.labelStyle || {}), fill: '#DC2626' },
            labelBgStyle: { fill: '#FEF2F2', stroke: '#FECACA', strokeWidth: 0.8, rx: 3, ry: 3 },
            markerEnd: { type: MarkerType.ArrowClosed, color: '#DC2626', width: 13, height: 13 },
          };
        }
        return {
          ...e,
          style: { ...(e.style || {}), stroke: '#15803D', strokeWidth: Math.max(2, (e.data?.baseWidth as number) || 1) },
          markerEnd: { type: MarkerType.ArrowClosed, color: '#15803D', width: 13, height: 13 },
        };
      });
    }
    return edges;
  }, [edges, selectedId, focusReachable, conformanceOverlay]);

  // ── Handlers ─────────────────────────────────────────────────────────────
  const onNodeClick: NodeMouseHandler = useCallback((evt, node) => {
    if (focusId) return;
    setSelectedId(prev => prev === node.id ? null : node.id);
    // Show filter popup on click
    const rect = (evt.target as HTMLElement).closest('.react-flow__node')?.getBoundingClientRect();
    if (rect) {
      setNodePopup(prev => prev?.activity === node.id ? null : { activity: node.id, x: rect.right + 8, y: rect.top });
    }
    setSelectedEdge(null);
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

  const onEdgeClick: EdgeMouseHandler = useCallback((_evt, edge) => {
    const t = transitions.find(tr => `${tr.from_activity}→${tr.to_activity}` === edge.id);
    setSelectedEdge(prev => prev && `${prev.from_activity}→${prev.to_activity}` === edge.id ? null : (t || null));
  }, [transitions]);

  const onPaneClick = useCallback(() => {
    setSelectedId(null);
    setSelectedEdge(null);
    setNodePopup(null);
  }, []);

  // ESC exits focus
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') { setFocusId(null); setSelectedId(null); setSelectedEdge(null); setNodePopup(null); setActivityFilter(null); } };
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

  if (activityFilter && !filteredTransitions.length) {
    return (
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, padding: 40 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: '#0D1117' }}>No transitions match this filter</div>
        <button
          onClick={() => setActivityFilter(null)}
          style={{ padding: '6px 16px', borderRadius: 4, border: '1px solid #E2E8F0', background: '#FFFFFF', color: '#3B82F6', fontSize: 12, fontWeight: 500, cursor: 'pointer' }}
        >
          Clear filter
        </button>
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
        onEdgeClick={onEdgeClick}
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

      {/* Frequency ↔ Performance toggle */}
      <div style={{
        position: 'absolute', top: 12, left: 12,
        backgroundColor: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: 6,
        display: 'flex', overflow: 'hidden',
        boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
      }}>
        {(['frequency', 'performance'] as const).map(mode => (
          <button
            key={mode}
            onClick={() => setViewMode(mode)}
            style={{
              height: 28, padding: '0 12px', border: 'none',
              backgroundColor: viewMode === mode ? '#1E3A5F' : '#FFFFFF',
              color: viewMode === mode ? '#FFFFFF' : '#64748B',
              fontSize: 11, fontWeight: 600, cursor: 'pointer',
              textTransform: 'capitalize',
              borderRight: mode === 'frequency' ? '1px solid #E2E8F0' : 'none',
            }}
          >
            {mode === 'frequency' ? '# Frequency' : '⏱ Performance'}
          </button>
        ))}
      </div>

      {/* Path complexity slider */}
      {maxTransitions > 1 && (
        <div style={{
          position: 'absolute', top: 48, left: 12,
          backgroundColor: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: 6,
          padding: '8px 12px', boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
          display: 'flex', flexDirection: 'column', gap: 4, width: 200,
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 10, fontWeight: 600, color: '#64748B' }}>Path Complexity</span>
            <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: '#1E3A5F', fontWeight: 700 }}>
              {topN === 0 ? 'All' : `Top ${topN}`} / {maxTransitions}
            </span>
          </div>
          <input
            type="range"
            min={1}
            max={maxTransitions}
            value={topN === 0 ? maxTransitions : topN}
            onChange={e => {
              const v = parseInt(e.target.value);
              setTopN(v >= maxTransitions ? 0 : v);
            }}
            style={{ width: '100%', accentColor: '#1E3A5F', cursor: 'pointer' }}
          />
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, color: '#94A3B8' }}>
            <span>Most common</span>
            <span>All paths</span>
          </div>
        </div>
      )}

      {/* Node click filter popup */}
      {nodePopup && (
        <div style={{
          position: 'fixed', left: nodePopup.x, top: nodePopup.y,
          backgroundColor: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: 6,
          boxShadow: '0 4px 16px rgba(0,0,0,0.12)', zIndex: 50,
          padding: '6px 0', minWidth: 180,
        }}>
          <div style={{ padding: '4px 12px 6px', fontSize: 10, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: '1px solid #F1F5F9' }}>
            Filter by: {nodePopup.activity.replace(/_/g, ' ')}
          </div>
          {([
            { type: 'with' as const, label: 'With this activity', icon: '✓' },
            { type: 'without' as const, label: 'Without this activity', icon: '✕' },
            { type: 'starting' as const, label: 'Starting with', icon: '▶' },
            { type: 'ending' as const, label: 'Ending with', icon: '◼' },
          ]).map(({ type, label, icon }) => (
            <button
              key={type}
              onClick={() => {
                setActivityFilter({ type, activity: nodePopup.activity });
                setNodePopup(null);
                setSelectedId(null);
              }}
              style={{
                display: 'flex', alignItems: 'center', gap: 8, width: '100%',
                padding: '7px 12px', border: 'none', background: 'none',
                fontSize: 12, color: '#0D1117', cursor: 'pointer', textAlign: 'left',
              }}
              onMouseEnter={e => (e.currentTarget.style.backgroundColor = '#F1F5F9')}
              onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'transparent')}
            >
              <span style={{ fontSize: 11, width: 16, textAlign: 'center' }}>{icon}</span>
              {label}
            </button>
          ))}
        </div>
      )}

      {/* Active filter badge */}
      {activityFilter && (
        <div style={{
          position: 'absolute', top: maxTransitions > 1 ? 138 : 46, left: 12,
          backgroundColor: '#EFF6FF', border: '1px solid #BFDBFE', borderRadius: 6,
          padding: '5px 10px', fontSize: 11, color: '#1D4ED8',
          display: 'flex', alignItems: 'center', gap: 8,
          boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
        }}>
          <span style={{ fontWeight: 600 }}>
            {activityFilter.type === 'with' ? '✓ With' : activityFilter.type === 'without' ? '✕ Without' : activityFilter.type === 'starting' ? '▶ Starting' : '◼ Ending'}:
          </span>
          <span>{activityFilter.activity.replace(/_/g, ' ')}</span>
          <button
            onClick={() => setActivityFilter(null)}
            style={{ border: 'none', background: '#DBEAFE', borderRadius: 3, width: 18, height: 18, cursor: 'pointer', fontSize: 11, color: '#1D4ED8', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          >×</button>
        </div>
      )}

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
          Thickness = frequency · Dashed = back-flow · Labels = {viewMode === 'frequency' ? 'case count' : 'avg time'}
        </div>
      </div>

      {/* Conformance overlay indicator */}
      {conformanceOverlay && (
        <div style={{
          position: 'absolute', top: 12, right: 12,
          backgroundColor: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: 6,
          padding: '6px 12px', fontSize: 10, color: '#92400E',
          display: 'flex', alignItems: 'center', gap: 8,
          boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
        }}>
          <span style={{ fontWeight: 700 }}>Conformance Overlay</span>
          <span style={{ color: '#15803D' }}>■ expected</span>
          <span style={{ color: '#DC2626' }}>■ deviation</span>
          <span style={{ fontSize: 9, color: '#94A3B8' }}>
            {checkResult?.aggregate.conformance_rate != null
              ? `${(checkResult.aggregate.conformance_rate * 100).toFixed(0)}% conformant`
              : ''}
          </span>
        </div>
      )}

      {/* Edge drill-down panel */}
      {selectedEdge && (
        <EdgeDrillDown
          transition={selectedEdge}
          totalCases={stats?.total_cases ?? Math.round(transitions.reduce((sum, t) => sum + t.count, 0) / 2)}
          onClose={() => setSelectedEdge(null)}
        />
      )}
    </div>
  );
};

interface Props { objectTypeId: string; }

export const ProcessMap: React.FC<Props> = ({ objectTypeId }) => (
  <ReactFlowProvider>
    <ProcessMapInner objectTypeId={objectTypeId} />
  </ReactFlowProvider>
);
