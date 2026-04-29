import React, { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import {
  ReactFlow, Background, Controls, MiniMap, BackgroundVariant,
  Node, Edge, MarkerType, NodeProps, ReactFlowProvider,
  useNodesState, useEdgesState, useReactFlow,
  Handle, Position,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import dagre from '@dagrejs/dagre';
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid,
  ComposedChart, Line, PieChart, Pie, Cell, Legend,
} from 'recharts';
import {
  Process, ProcessCase, ProcessVariant, ProcessTransition, ProcessBottleneck, ProcessStats,
  CaseTimelineEvent, DiscoverySuggestion,
  listProcesses, createProcess, updateProcess, deleteProcess, autoDiscover, backfillProcess,
  getStats, getCases, getVariants, getTransitions, getBottlenecks, getCaseTimeline,
} from './api';
import { useOntologyStore } from '../../store/ontologyStore';

const PROCESS_API = import.meta.env.VITE_PROCESS_ENGINE_URL || 'http://localhost:8009';

// Match the rest of the app — light mode tokens borrowed from index.css
const T = {
  bg:            '#F8FAFC',
  surface:       '#FFFFFF',
  surfaceHi:     '#F8FAFC',
  surfaceCol:    '#F8FAFC',  // table header
  border:        '#E2E8F0',
  borderSoft:    '#F1F5F9',
  text:          '#0D1117',
  textMuted:     '#64748B',
  textSubtle:    '#94A3B8',
  accent:        '#2563EB',  // interactive blue — same as connectors filter active
  accentDim:     '#EFF6FF',
  accentText:    '#1D4ED8',
  brand:         '#7C3AED',  // brand purple, used sparingly
  brandDim:      '#EDE9FE',
  brandText:     '#5B21B6',
  success:       '#059669',
  successDim:    '#ECFDF5',
  warning:       '#D97706',
  warningDim:    '#FFFBEB',
  danger:        '#DC2626',
  dangerDim:     '#FEF2F2',
  mono:          'ui-monospace, SFMono-Regular, Menlo, monospace',
};

type Tab = 'overview' | 'map' | 'variants' | 'insights' | 'bottlenecks' | 'cases' | 'definition';

const palette = [
  '#7C3AED', '#0EA5E9', '#F59E0B', '#10B981', '#EC4899',
  '#6366F1', '#EF4444', '#14B8A6', '#A855F7', '#84CC16',
];

const colorForObjectType = (otId: string | null | undefined, allOts: string[]): string => {
  if (!otId) return '#94A3B8';
  const idx = allOts.indexOf(otId);
  return palette[(idx >= 0 ? idx : 0) % palette.length];
};

const speedStroke: Record<string, string> = {
  fast: '#15803D', normal: '#64748B', slow: '#DC2626',
};

const fmtH = (h: number) =>
  h < 1 ? `${Math.round(h * 60)}m` : h < 24 ? `${h.toFixed(1)}h` : `${(h / 24).toFixed(1)}d`;

// ── Activity node (custom for ReactFlow) ─────────────────────────────────────

const ActivityNode: React.FC<NodeProps> = ({ data }) => {
  const d = data as {
    activity: string; objectTypeId: string | null; objectTypeName: string;
    caseCount: number; avgHours: number;
    color: string; isEntry: boolean; isExit: boolean;
    highlighted?: 'selected' | 'incoming' | 'outgoing';
    dimmed?: boolean;
  };
  const accent =
    d.highlighted === 'selected' ? T.warning :
    d.highlighted === 'incoming' ? T.accent :
    d.highlighted === 'outgoing' ? T.success :
    d.isEntry ? T.accent :
    d.isExit ? T.brand : d.color;
  const opacity = d.dimmed ? 0.18 : 1;
  const ring = d.highlighted
    ? `0 0 0 2.5px ${accent}33, 0 2px 8px ${accent}33`
    : '0 1px 4px rgba(0,0,0,0.06)';

  return (
    <div style={{
      width: 168, background: T.surface,
      border: `1.5px solid ${d.highlighted ? accent : T.border}`,
      borderRadius: 8, fontFamily: 'var(--font-interface)', overflow: 'hidden',
      boxShadow: ring, position: 'relative', opacity,
      transition: 'opacity 0.15s, box-shadow 0.15s',
    }}>
      <Handle type="target" position={Position.Left} style={{ background: accent, width: 6, height: 6, border: 'none' }} />
      <Handle type="source" position={Position.Right} style={{ background: accent, width: 6, height: 6, border: 'none' }} />
      <div style={{ height: 3, background: accent }} />
      <div style={{ padding: '8px 10px 10px' }}>
        {d.highlighted && (
          <div style={{ fontSize: 9, fontWeight: 600, color: accent, marginBottom: 4 }}>
            {d.highlighted === 'selected' ? 'Selected' : d.highlighted === 'incoming' ? '← Inflow' : 'Outflow →'}
          </div>
        )}
        <div style={{ fontSize: 10, fontWeight: 600, color: d.color, marginBottom: 4 }}>
          {d.objectTypeName}
        </div>
        <div style={{ fontSize: 11, fontWeight: 600, color: T.text, marginBottom: 5, lineHeight: 1.3, wordBreak: 'break-word' }}>
          {d.activity.replace(/_/g, ' ')}
        </div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 5 }}>
          <span style={{ fontSize: 15, fontWeight: 700, color: T.text, fontFamily: T.mono, lineHeight: 1 }}>
            {d.caseCount.toLocaleString()}
          </span>
          <span style={{ fontSize: 10, color: T.textSubtle }}>events</span>
        </div>
        <div style={{ fontSize: 10, color: T.textSubtle, marginTop: 2 }}>
          avg {fmtH(d.avgHours)} here
        </div>
        <div style={{ display: 'flex', gap: 4, marginTop: 5, flexWrap: 'wrap' }}>
          {d.isEntry && <span style={{ ...badge, background: T.accentDim, color: T.accentText }}>Start</span>}
          {d.isExit && <span style={{ ...badge, background: T.brandDim, color: T.brandText }}>End</span>}
        </div>
      </div>
    </div>
  );
};

const nodeTypes = { activityNode: ActivityNode };

// ── Map graph builder ────────────────────────────────────────────────────────

const NODE_W = 168;
const NODE_H = 96;

type ViewMode = 'frequency' | 'performance';

function buildGraph(
  transitions: ProcessTransition[],
  viewMode: ViewMode,
  allOts: string[],
  otName: (id: string | null | undefined) => string,
) {
  if (!transitions.length) return { nodes: [] as Node[], edges: [] as Edge[] };

  // node identity = objectType::activity to keep object-tagged activities distinct
  type Key = string;
  const k = (act: string, ot: string | null | undefined): Key => `${ot || ''}::${act}`;

  const meta = new Map<Key, { activity: string; ot: string | null }>();
  const eventCount = new Map<Key, number>();
  const dwellSum = new Map<Key, { sum: number; n: number }>();
  const incoming = new Map<Key, Set<Key>>();
  const outgoing = new Map<Key, Set<Key>>();

  for (const t of transitions) {
    const fk = t.from_activity ? k(t.from_activity, t.from_object_type_id) : null;
    const tk = k(t.to_activity, t.to_object_type_id);
    if (fk) {
      meta.set(fk, { activity: t.from_activity!, ot: t.from_object_type_id });
      eventCount.set(fk, (eventCount.get(fk) || 0) + t.count);
    }
    meta.set(tk, { activity: t.to_activity, ot: t.to_object_type_id });
    eventCount.set(tk, (eventCount.get(tk) || 0) + t.count);

    const dw = dwellSum.get(tk) || { sum: 0, n: 0 };
    dw.sum += t.avg_hours * t.count; dw.n += t.count;
    dwellSum.set(tk, dw);

    if (fk) {
      if (!outgoing.has(fk)) outgoing.set(fk, new Set());
      outgoing.get(fk)!.add(tk);
      if (!incoming.has(tk)) incoming.set(tk, new Set());
      incoming.get(tk)!.add(fk);
    }
  }

  // Back-edge detection
  const visited = new Set<Key>(), inStack = new Set<Key>(), backEdges = new Set<string>();
  function dfs(node: Key) {
    visited.add(node); inStack.add(node);
    for (const next of outgoing.get(node) ?? []) {
      const eid = `${node}|${next}`;
      if (inStack.has(next)) backEdges.add(eid);
      else if (!visited.has(next)) dfs(next);
    }
    inStack.delete(node);
  }
  [...meta.keys()].forEach((key) => { if (!visited.has(key)) dfs(key); });

  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: 'LR', ranksep: 70, nodesep: 30, edgesep: 16, marginx: 30, marginy: 30 });
  g.setDefaultEdgeLabel(() => ({}));
  for (const key of meta.keys()) g.setNode(key, { width: NODE_W, height: NODE_H });
  for (const t of transitions) {
    if (!t.from_activity) continue;
    const fk = k(t.from_activity, t.from_object_type_id);
    const tk = k(t.to_activity, t.to_object_type_id);
    if (backEdges.has(`${fk}|${tk}`)) g.setEdge(tk, fk);
    else g.setEdge(fk, tk);
  }
  dagre.layout(g);

  const nodes: Node[] = [];
  for (const [key, { activity, ot }] of meta.entries()) {
    const pos = g.node(key);
    if (!pos) continue;
    const dw = dwellSum.get(key);
    const avgH = dw && dw.n ? dw.sum / dw.n : 0;
    const color = colorForObjectType(ot, allOts);
    nodes.push({
      id: key, type: 'activityNode',
      position: { x: pos.x - NODE_W / 2, y: pos.y - NODE_H / 2 },
      data: {
        activity, objectTypeId: ot, objectTypeName: otName(ot),
        caseCount: eventCount.get(key) || 0,
        avgHours: avgH, color,
        isEntry: !incoming.has(key) || incoming.get(key)!.size === 0,
        isExit: !outgoing.has(key) || outgoing.get(key)!.size === 0,
      },
    });
  }

  const maxCount = Math.max(1, ...transitions.map((t) => t.count));
  const edges: Edge[] = transitions.map((t) => {
    if (!t.from_activity) {
      // synthetic start edge — skip
      return null as any;
    }
    const fk = k(t.from_activity, t.from_object_type_id);
    const tk = k(t.to_activity, t.to_object_type_id);
    const w = Math.max(1, Math.round((t.count / maxCount) * 6));
    const color = viewMode === 'frequency' ? '#64748B' : (speedStroke[t.speed] ?? '#64748B');
    const label = viewMode === 'frequency' ? t.count.toLocaleString() : fmtH(t.avg_hours);
    const isBack = backEdges.has(`${fk}|${tk}`);
    const crossObj = t.from_object_type_id !== t.to_object_type_id;
    return {
      id: `${fk}|${tk}`, source: fk, target: tk, type: 'smoothstep',
      label,
      labelStyle: { fontSize: 9, fill: color, fontWeight: 600, fontFamily: T.mono },
      labelBgStyle: { fill: T.surface, stroke: color, strokeWidth: 0.7, rx: 2, ry: 2 },
      labelBgPadding: [3, 4] as [number, number],
      markerEnd: { type: MarkerType.ArrowClosed, color, width: 13, height: 13 },
      style: {
        stroke: color, strokeWidth: w,
        strokeDasharray: isBack ? '5,3' : crossObj ? '8,3' : undefined,
      },
      animated: t.speed === 'fast',
    };
  }).filter(Boolean) as Edge[];

  return { nodes, edges };
}

// ── Main component ───────────────────────────────────────────────────────────

// Filter spec — drives every tab when set. Cases/variants must contain ALL these
// activities to pass. activity = "<object_type_id>::<activity_name>" (matches the
// backend's resolved activity expression for cross-object processes).
type ActivityFilter = string[];

interface FilterCtx {
  filter: ActivityFilter;
  add: (key: string) => void;
  remove: (key: string) => void;
  clear: () => void;
}

const ProcessMiningV2: React.FC = () => {
  const { objectTypes, fetchObjectTypes } = useOntologyStore();
  const [processes, setProcesses] = useState<Process[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('overview');
  const [showManager, setShowManager] = useState(false);
  const [filter, setFilter] = useState<ActivityFilter>([]);

  const filterCtx: FilterCtx = useMemo(() => ({
    filter,
    add: (k: string) => setFilter((f) => (f.includes(k) ? f : [...f, k])),
    remove: (k: string) => setFilter((f) => f.filter((x) => x !== k)),
    clear: () => setFilter([]),
  }), [filter]);

  // Reset filter on process change
  useEffect(() => { setFilter([]); }, [selectedId]);

  useEffect(() => {
    fetchObjectTypes();
    void refreshProcesses();
  }, []);

  const refreshProcesses = async () => {
    try {
      const list = await listProcesses(true);
      setProcesses(list);
      if (!selectedId && list.length) {
        // Prefer an explicit (non-implicit) process if any
        const def = list.find((p) => !p.is_implicit);
        setSelectedId((def || list[0]).id);
      }
    } catch (e) { console.error(e); }
  };

  const otName = useCallback((otId: string | null | undefined): string => {
    if (!otId) return '';
    return objectTypes.find((o) => o.id === otId)?.name || (otId.length === 36 ? otId.slice(0, 8) : otId);
  }, [objectTypes]);

  const selected = processes.find((p) => p.id === selectedId) || null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, height: '100%', background: T.bg, overflow: 'hidden' }}>
      <Header
        processes={processes}
        selectedId={selectedId}
        onSelect={setSelectedId}
        onManage={() => setShowManager(true)}
        otName={otName}
      />
      <Tabs tab={tab} onTab={setTab} />
      {filter.length > 0 && (
        <FilterBanner filter={filter} onRemove={filterCtx.remove} onClear={filterCtx.clear} otName={otName} />
      )}
      <div style={{ flex: 1, overflow: 'auto', padding: 24, color: T.text, background: T.bg }}>
        {!selected && <Empty />}
        {selected && tab === 'overview'    && <OverviewPane process={selected} otName={otName} filterCtx={filterCtx} onJumpTo={setTab} />}
        {selected && tab === 'map'         && <MapPane process={selected} otName={otName} filterCtx={filterCtx} />}
        {selected && tab === 'variants'    && <VariantsPane process={selected} otName={otName} filterCtx={filterCtx} />}
        {selected && tab === 'insights'    && <InsightsPane process={selected} otName={otName} filterCtx={filterCtx} />}
        {selected && tab === 'bottlenecks' && <BottlenecksPane process={selected} otName={otName} filterCtx={filterCtx} />}
        {selected && tab === 'cases'       && <CasesPane process={selected} otName={otName} filterCtx={filterCtx} />}
        {selected && tab === 'definition'  && (
          <DefinitionPane process={selected} objectTypes={objectTypes} onSaved={refreshProcesses} />
        )}
      </div>
      {showManager && (
        <ProcessManagerModal
          processes={processes}
          objectTypes={objectTypes}
          onClose={() => setShowManager(false)}
          onChanged={refreshProcesses}
        />
      )}
    </div>
  );
};

// ── Header & Tabs ────────────────────────────────────────────────────────────

const Header: React.FC<{
  processes: Process[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onManage: () => void;
  otName: (id: string | null | undefined) => string;
}> = ({ processes, selectedId, onSelect, onManage, otName }) => {
  const explicit = processes.filter((p) => !p.is_implicit);
  const implicit = processes.filter((p) => p.is_implicit);
  return (
    <div style={{
      padding: '20px 24px 16px 24px', background: T.surface,
      borderBottom: `1px solid ${T.border}`, flexShrink: 0,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
        <div>
          <h1 style={{ fontSize: 18, fontWeight: 500, color: T.text, margin: 0, marginBottom: 2 }}>
            Process Mining
            <span style={{
              marginLeft: 10, fontSize: 11, color: T.brandText,
              background: T.brandDim, padding: '2px 8px', borderRadius: 3,
              fontWeight: 600, verticalAlign: 'middle',
            }}>
              v2 · object-centric
            </span>
          </h1>
          <p style={{ fontSize: 13, color: T.textMuted, margin: 0 }}>
            {processes.filter((p) => !p.is_implicit).length} defined · {processes.filter((p) => p.is_implicit).length} implicit
          </p>
        </div>
        <button onClick={onManage} style={btnPrimary}>Manage processes</button>
      </div>

      <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
        <select
          value={selectedId || ''}
          onChange={(e) => onSelect(e.target.value)}
          style={{
            flex: 1, maxWidth: 560, height: 32, padding: '0 10px', fontSize: 13,
            border: `1px solid ${T.border}`, borderRadius: 4,
            background: T.surface, color: T.text,
            outline: 'none', cursor: 'pointer',
          }}
        >
          {explicit.length > 0 && (
            <optgroup label="Defined processes (cross-object)">
              {explicit.map((p) => {
                const objs = p.included_object_type_ids.map(otName).join(' + ');
                return <option key={p.id} value={p.id}>{p.name}  ·  {objs}</option>;
              })}
            </optgroup>
          )}
          {implicit.length > 0 && (
            <optgroup label="Implicit (single object)">
              {implicit.map((p) => (
                <option key={p.id} value={p.id}>
                  {otName(p.included_object_type_ids[0])}
                </option>
              ))}
            </optgroup>
          )}
        </select>
      </div>
    </div>
  );
};

const Tabs: React.FC<{ tab: Tab; onTab: (t: Tab) => void }> = ({ tab, onTab }) => {
  const items: { id: Tab; label: string }[] = [
    { id: 'overview',    label: 'Overview' },
    { id: 'map',         label: 'Process Map' },
    { id: 'variants',    label: 'Variants' },
    { id: 'insights',    label: 'Insights' },
    { id: 'bottlenecks', label: 'Bottlenecks' },
    { id: 'cases',       label: 'Cases' },
    { id: 'definition',  label: 'Definition' },
  ];
  return (
    <div style={{
      height: 40, background: T.surface, borderBottom: `1px solid ${T.border}`,
      display: 'flex', padding: '0 24px', flexShrink: 0,
    }}>
      {items.map((it) => (
        <button key={it.id} onClick={() => onTab(it.id)} style={{
          padding: '0 16px', height: '100%', border: 'none',
          background: 'transparent', cursor: 'pointer',
          borderBottom: tab === it.id ? `2px solid ${T.accent}` : '2px solid transparent',
          color: tab === it.id ? T.accentText : T.textMuted,
          fontSize: 13, fontWeight: tab === it.id ? 500 : 400,
        }}>{it.label}</button>
      ))}
    </div>
  );
};

const FilterBanner: React.FC<{
  filter: ActivityFilter;
  onRemove: (k: string) => void;
  onClear: () => void;
  otName: (id: string | null | undefined) => string;
}> = ({ filter, onRemove, onClear, otName }) => (
  <div style={{
    background: T.accentDim, borderBottom: `1px solid ${T.border}`,
    padding: '10px 24px', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
  }}>
    <span style={{ fontSize: 12, fontWeight: 500, color: T.accentText }}>
      Filter active — showing only cases that include:
    </span>
    {filter.map((key) => {
      const [ot, act] = key.includes('::') ? key.split('::', 2) : [null, key];
      return (
        <span key={key} style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          padding: '3px 10px', background: T.surface, border: `1px solid ${T.accent}55`,
          borderRadius: 999, fontSize: 12, color: T.text,
        }}>
          {ot && <span style={{ fontSize: 10, color: T.textMuted }}>{otName(ot)}</span>}
          <strong>{act}</strong>
          <button onClick={() => onRemove(key)} style={{
            border: 'none', background: 'transparent', cursor: 'pointer',
            color: T.textMuted, fontSize: 14, lineHeight: 1, padding: 0,
          }}>×</button>
        </span>
      );
    })}
    <button onClick={onClear} style={{
      marginLeft: 'auto', ...btnGhost,
      padding: '4px 10px', fontSize: 12,
    }}>Clear all</button>
  </div>
);

const Empty: React.FC = () => (
  <div style={{ padding: 60, textAlign: 'center', color: T.textSubtle }}>
    No processes available. Create one via "Manage processes".
  </div>
);

const Loading: React.FC<{ label?: string }> = ({ label = 'Loading…' }) => (
  <div style={{ padding: 40, color: T.textSubtle, textAlign: 'center', fontSize: 12 }}>{label}</div>
);

// ── Overview tab: KPIs + monthly trend + distribution + top variants ─────────

const OverviewPane: React.FC<{ process: Process; otName: (id: string | null | undefined) => string; filterCtx?: FilterCtx; onJumpTo?: (t: Tab) => void }> = ({ process, otName }) => {
  const [stats, setStats] = useState<ProcessStats | null>(null);
  const [variants, setVariants] = useState<ProcessVariant[]>([]);
  const [overview, setOverview] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      getStats(process.id),
      getVariants(process.id, 10),
      fetch(`${PROCESS_API}/process/by-process/overview/${process.id}`, {
        headers: { 'x-tenant-id': (window.localStorage.getItem('tenant_id') || '') },
      }).then(async (r) => r.ok ? r.json() : null).catch(() => null),
    ])
      .then(([s, v, o]) => { setStats(s); setVariants(v.variants); setOverview(o); })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [process.id]);

  if (loading) return <Loading />;
  if (!stats) return <Empty />;

  const dist = (overview?.distribution || []).slice(0, 8);
  const monthly = overview?.monthly_series || [];

  return (
    <div>
      <KpiBar stats={stats} />
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 12, marginTop: 12 }}>
        <Card title="Cases completed by month">
          {monthly.length === 0 ? (
            <div style={mutedNote}>No monthly data yet — events may not span enough time.</div>
          ) : (
            <ResponsiveContainer width="100%" height={240}>
              <ComposedChart data={monthly}>
                <CartesianGrid strokeDasharray="3 3" stroke={T.border} />
                <XAxis dataKey="month" tick={{ fontSize: 10, fill: T.textMuted, fontFamily: T.mono }} stroke={T.border} />
                <YAxis yAxisId="left" tick={{ fontSize: 10, fill: T.textMuted, fontFamily: T.mono }} stroke={T.border} />
                <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 10, fill: T.textMuted, fontFamily: T.mono }} stroke={T.border} />
                <Tooltip wrapperStyle={{ fontSize: 11, fontFamily: T.mono }} contentStyle={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 2, color: T.text }} labelStyle={{ color: T.textMuted }} />
                <Bar yAxisId="left" dataKey="cases_completed" fill={T.accent} radius={[3, 3, 0, 0]} />
                <Line yAxisId="right" dataKey="avg_duration_days" stroke="#F59E0B" strokeWidth={2} />
              </ComposedChart>
            </ResponsiveContainer>
          )}
        </Card>
        <Card title="Distribution by resource">
          {dist.length === 0 ? <div style={mutedNote}>—</div> : (
            <ResponsiveContainer width="100%" height={240}>
              <PieChart>
                <Pie data={dist} dataKey="case_count" nameKey="group_label" outerRadius={80} label={(e: any) => e.group_label?.slice(0, 12)}>
                  {dist.map((_: any, i: number) => <Cell key={i} fill={palette[i % palette.length]} />)}
                </Pie>
                <Tooltip wrapperStyle={{ fontSize: 11, fontFamily: T.mono }} contentStyle={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 2, color: T.text }} labelStyle={{ color: T.textMuted }} />
              </PieChart>
            </ResponsiveContainer>
          )}
        </Card>
      </div>

      <Card title={`Top ${variants.length} variants`} style={{ marginTop: 12 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {variants.map((v) => {
            const ots = process.included_object_type_ids;
            return (
              <div key={v.variant_id} style={{ display: 'grid', gridTemplateColumns: '60px 90px 90px 1fr', alignItems: 'center', gap: 12, padding: '8px 10px', border: `1px solid ${T.border}`, borderRadius: 4 }}>
                <div>
                  <div style={{ fontSize: 16, fontWeight: 700, fontFamily: 'var(--font-mono)' }}>#{v.rank}</div>
                </div>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 700 }}>{v.case_count}</div>
                  <div style={{ fontSize: 10, color: T.textSubtle }}>cases · {v.frequency_pct}%</div>
                </div>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600, fontFamily: 'var(--font-mono)' }}>{v.avg_duration_days}d</div>
                  <div style={{ fontSize: 10, color: T.textSubtle }}>avg duration</div>
                </div>
                <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap', alignItems: 'center' }}>
                  {v.steps.slice(0, 12).map((s, i) => (
                    <React.Fragment key={i}>
                      <span style={{
                        ...chip, fontSize: 10,
                        background: colorForObjectType(s.object_type_id, ots) + '22',
                        color: colorForObjectType(s.object_type_id, ots),
                      }}>{s.activity.slice(0, 22)}</span>
                      {i < Math.min(11, v.steps.length - 1) && <span style={{ color: '#CBD5E1', fontSize: 10 }}>→</span>}
                    </React.Fragment>
                  ))}
                  {v.steps.length > 12 && <span style={{ fontSize: 10, color: T.textSubtle }}>… +{v.steps.length - 12}</span>}
                </div>
              </div>
            );
          })}
        </div>
      </Card>
    </div>
  );
};

const KpiBar: React.FC<{ stats: ProcessStats }> = ({ stats }) => {
  const reworkColor = stats.rework_rate > 10 ? T.danger : stats.rework_rate > 5 ? T.warning : T.success;
  const stuckColor = stats.stuck_cases > 0 ? T.danger : T.success;
  const items: [string, string, string, string?][] = [
    ['Total cases', stats.total_cases.toLocaleString(), T.text, `${stats.variant_count} variants`],
    ['Avg throughput', `${stats.avg_duration_days}d`, T.text],
    ['Rework rate', `${stats.rework_rate}%`, reworkColor],
    ['Stuck cases', stats.stuck_cases.toLocaleString(), stuckColor],
    ['Variants', stats.variant_count.toLocaleString(), T.text],
    ['Objects / case', stats.avg_object_types_per_case.toString(), stats.spans_objects ? T.accentText : T.textMuted, stats.spans_objects ? 'Cross-object' : 'Single object'],
  ];
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10 }}>
      {items.map(([label, value, color, sub]) => (
        <div key={label} style={{
          background: T.surface, border: `1px solid ${T.border}`, borderRadius: 6,
          padding: '14px 16px',
        }}>
          <div style={{ fontSize: 11, color: T.textMuted, marginBottom: 8 }}>{label}</div>
          <div style={{ fontSize: 24, fontWeight: 600, fontFamily: T.mono, lineHeight: 1, color, fontVariantNumeric: 'tabular-nums' }}>
            {value}
          </div>
          {sub && <div style={{ fontSize: 11, color: T.textSubtle, marginTop: 6 }}>{sub}</div>}
        </div>
      ))}
    </div>
  );
};

// ── Map tab ──────────────────────────────────────────────────────────────────

const MapPane: React.FC<{ process: Process; otName: (id: string | null | undefined) => string; filterCtx?: FilterCtx }> = ({ process, otName, filterCtx }) => {
  return (
    <ReactFlowProvider>
      <MapPaneInner process={process} otName={otName} filterCtx={filterCtx} />
    </ReactFlowProvider>
  );
};

const MapPaneInner: React.FC<{ process: Process; otName: (id: string | null | undefined) => string; filterCtx?: FilterCtx }> = ({ process, otName, filterCtx }) => {
  const [transitions, setTransitions] = useState<ProcessTransition[]>([]);
  const [variants, setVariants] = useState<ProcessVariant[]>([]);
  const [totalCases, setTotalCases] = useState(0);
  const [stats, setStats] = useState<ProcessStats | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('frequency');
  const [variantCount, setVariantCount] = useState(1);  // slider position; 1 = just the most common
  const [loading, setLoading] = useState(true);
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const { fitView } = useReactFlow();
  const fitRef = useRef(false);

  // Click state — mirrors the old ProcessMap interactions
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [edgePopup, setEdgePopup] = useState<ProcessTransition | null>(null);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      getTransitions(process.id),
      getVariants(process.id, 200),
      getStats(process.id),
    ])
      .then(([t, v, s]) => {
        setTransitions(t.transitions);
        setVariants(v.variants);
        setTotalCases(v.total_cases);
        setStats(s);
        setVariantCount(1);
        fitRef.current = false;
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [process.id]);

  // Slider drives which variants are shown.
  // Edges = consecutive activity pairs from each included variant, looked up in transitions
  // for performance/frequency colouring. Cumulative coverage % shows next to the slider.
  const filteredTransitions = useMemo(() => {
    if (!variants.length) return [] as ProcessTransition[];
    const n = Math.min(variantCount, variants.length);
    const top = variants.slice(0, n);
    // Map each step to its (object_type_id, activity) tuple. The transitions
    // endpoint already returns activities tagged with object_type_id, so we
    // build a key of "<ot_from>::<act_from>→<ot_to>::<act_to>".
    const wantedKeys = new Set<string>();
    for (const v of top) {
      for (let i = 0; i < v.steps.length - 1; i++) {
        const a = v.steps[i], b = v.steps[i + 1];
        wantedKeys.add(`${a.object_type_id || ''}::${a.activity}|${b.object_type_id || ''}::${b.activity}`);
      }
    }
    return transitions.filter((t) => {
      const k = `${t.from_object_type_id || ''}::${t.from_activity}|${t.to_object_type_id || ''}::${t.to_activity}`;
      return wantedKeys.has(k);
    });
  }, [transitions, variants, variantCount]);

  // Cumulative coverage of selected variants
  const coveragePct = useMemo(() => {
    if (!totalCases) return 0;
    const top = variants.slice(0, Math.min(variantCount, variants.length));
    const covered = top.reduce((s, v) => s + v.case_count, 0);
    return Math.round((covered / totalCases) * 1000) / 10;
  }, [variants, variantCount, totalCases]);

  useEffect(() => {
    if (!filteredTransitions.length) {
      setNodes([]); setEdges([]); return;
    }
    const { nodes, edges } = buildGraph(filteredTransitions, viewMode, process.included_object_type_ids, otName);
    setNodes(nodes);
    setEdges(edges);
    setSelectedId(null); setFocusId(null); setEdgePopup(null);
  }, [filteredTransitions, viewMode]);

  useEffect(() => {
    if (nodes.length && !fitRef.current) {
      fitRef.current = true;
      setTimeout(() => { try { fitView({ padding: 0.15, duration: 400 }); } catch {} }, 80);
    }
  }, [nodes, fitView]);

  // Focus mode subgraph (double-click)
  const focusReachable = useMemo<Set<string> | null>(() => {
    if (!focusId) return null;
    const fwd = new Set<string>([focusId]);
    const q = [focusId];
    while (q.length) {
      const c = q.shift()!;
      for (const e of edges) if (e.source === c && !fwd.has(e.target)) { fwd.add(e.target); q.push(e.target); }
    }
    const bwd = new Set<string>([focusId]);
    const q2 = [focusId];
    while (q2.length) {
      const c = q2.shift()!;
      for (const e of edges) if (e.target === c && !bwd.has(e.source)) { bwd.add(e.source); q2.push(e.source); }
    }
    return new Set([...fwd, ...bwd]);
  }, [focusId, edges]);

  const displayNodes = useMemo(() => {
    if (focusReachable) {
      return nodes.map((n) => ({
        ...n, hidden: !focusReachable.has(n.id),
        data: { ...n.data, highlighted: n.id === focusId ? 'selected' as const : undefined, dimmed: false },
      }));
    }
    if (selectedId) {
      const incomers = new Set(edges.filter((e) => e.target === selectedId).map((e) => e.source));
      const outgoers = new Set(edges.filter((e) => e.source === selectedId).map((e) => e.target));
      return nodes.map((n) => ({
        ...n,
        data: {
          ...n.data,
          highlighted: n.id === selectedId ? 'selected' as const : incomers.has(n.id) ? 'incoming' as const : outgoers.has(n.id) ? 'outgoing' as const : undefined,
          dimmed: n.id !== selectedId && !incomers.has(n.id) && !outgoers.has(n.id),
        },
      }));
    }
    return nodes.map((n) => ({ ...n, data: { ...n.data, highlighted: undefined, dimmed: false } }));
  }, [nodes, edges, selectedId, focusId, focusReachable]);

  const displayEdges = useMemo(() => {
    if (focusReachable) {
      return edges.map((e) => ({ ...e, hidden: !focusReachable.has(e.source) || !focusReachable.has(e.target) }));
    }
    if (selectedId) {
      return edges.map((e) => {
        const isIn = e.target === selectedId;
        const isOut = e.source === selectedId;
        if (isIn) return { ...e, animated: true, style: { ...(e.style || {}), stroke: '#3B82F6', strokeWidth: 2.5, opacity: 1 }, markerEnd: { type: MarkerType.ArrowClosed, color: '#3B82F6', width: 14, height: 14 } };
        if (isOut) return { ...e, animated: true, style: { ...(e.style || {}), stroke: '#10B981', strokeWidth: 2.5, opacity: 1 }, markerEnd: { type: MarkerType.ArrowClosed, color: '#10B981', width: 14, height: 14 } };
        return { ...e, label: '', style: { ...(e.style || {}), opacity: 0.08 } };
      });
    }
    return edges;
  }, [edges, selectedId, focusReachable]);

  const onNodeClick = useCallback((_evt: any, node: Node) => {
    if (focusId) return;
    setSelectedId((p) => (p === node.id ? null : node.id));
    setEdgePopup(null);
  }, [focusId]);

  const onNodeDoubleClick = useCallback((_evt: any, node: Node) => {
    setFocusId((p) => {
      if (p === node.id) { setSelectedId(null); return null; }
      setSelectedId(null);
      return node.id;
    });
  }, []);

  const onEdgeClick = useCallback((_evt: any, edge: Edge) => {
    const t = transitions.find((x) => `${x.from_object_type_id || ''}::${x.from_activity}|${x.to_object_type_id || ''}::${x.to_activity}` === edge.id);
    setEdgePopup((p) => p && p === t ? null : (t || null));
  }, [transitions]);

  const onPaneClick = useCallback(() => {
    setSelectedId(null); setEdgePopup(null);
  }, []);

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setFocusId(null); setSelectedId(null); setEdgePopup(null); }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);

  if (loading) return <Loading />;
  if (!variants.length) return <Empty />;

  const ots = process.included_object_type_ids;
  const cur = Math.min(variantCount, variants.length);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: 10, background: T.surface, border: `1px solid ${T.border}`, borderRadius: 6, flexWrap: 'wrap' }}>
        <Toggle label="Mode" options={['frequency', 'performance']} value={viewMode} onChange={(v) => setViewMode(v as ViewMode)} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 320 }}>
          <label style={muted}>Variants shown</label>
          <input type="range" min={1} max={variants.length} value={cur}
                 onChange={(e) => setVariantCount(Number(e.target.value))}
                 style={{ flex: 1, accentColor: '#7C3AED' }} />
          <span style={{ fontSize: 11, fontFamily: 'var(--font-mono)', minWidth: 70, textAlign: 'right' }}>
            {cur} / {variants.length}
          </span>
          <span style={{ fontSize: 11, fontWeight: 600, color: T.accent, fontFamily: 'var(--font-mono)', minWidth: 56, textAlign: 'right' }}>
            {coveragePct}% cases
          </span>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {ots.map((ot) => (
            <span key={ot} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11 }}>
              <span style={{ width: 10, height: 10, borderRadius: 2, background: colorForObjectType(ot, ots) }} />
              {otName(ot)}
            </span>
          ))}
          {ots.length > 1 && <span style={{ fontSize: 10, color: T.textSubtle }}>· dashed = cross-object</span>}
        </div>
      </div>

      <div style={{ fontSize: 11, color: T.textMuted, padding: '0 4px', display: 'flex', justifyContent: 'space-between' }}>
        <span>
          Showing top {cur} variant{cur === 1 ? '' : 's'} —
          covers <strong>{coveragePct}%</strong> of {totalCases.toLocaleString()} cases.
          {cur === 1 && ' This is the happy path.'}
        </span>
        <span>
          Click node to highlight flow · Double-click to focus · Click edge for details · ESC to reset
        </span>
      </div>

      <div style={{ position: 'relative', height: 'calc(100vh - 280px)', minHeight: 460, background: T.surface, border: `1px solid ${T.border}`, borderRadius: 6 }}>
        <ReactFlow
          nodes={displayNodes} edges={displayEdges}
          nodeTypes={nodeTypes}
          onNodesChange={onNodesChange} onEdgesChange={onEdgesChange}
          onNodeClick={onNodeClick} onNodeDoubleClick={onNodeDoubleClick}
          onEdgeClick={onEdgeClick} onPaneClick={onPaneClick}
          fitView proOptions={{ hideAttribution: true }}
          minZoom={0.1} maxZoom={2}
        >
          <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="#1E2330" />
          <Controls position="bottom-right" style={{ background: T.surface, border: `1px solid ${T.border}` }} />
          <MiniMap pannable zoomable
            style={{ background: T.surface, border: `1px solid ${T.border}` }}
            maskColor="rgba(11,14,20,0.65)"
            nodeColor={(n) => (n.data as any)?.color || T.textSubtle}
            nodeStrokeColor={() => T.border}
          />
        </ReactFlow>

        {focusId && (
          <div style={{
            position: 'absolute', top: 12, left: 12,
            background: T.accentDim, color: T.accentText, padding: '6px 12px',
            borderRadius: 4, fontSize: 12, fontWeight: 500,
            border: `1px solid ${T.accent}55`,
            boxShadow: '0 4px 12px rgba(0,0,0,0.06)',
          }}>
            Focused on a node — showing reachable subgraph. Press ESC to exit.
          </div>
        )}

        {selectedId && !focusId && (() => {
          // Parse "ot::activity" key
          const [ot, act] = selectedId.includes('::') ? selectedId.split('::', 2) : ['', selectedId];
          const inFilter = filterCtx?.filter.includes(selectedId);
          return (
            <div style={{
              position: 'absolute', top: 12, left: 12,
              background: T.surface, border: `1px solid ${T.border}`,
              borderRadius: 6, padding: 12, fontSize: 12, width: 260,
              boxShadow: '0 10px 30px rgba(0,0,0,0.10)',
            }}>
              <div style={{ fontSize: 11, color: T.textMuted, marginBottom: 4 }}>{otName(ot)}</div>
              <div style={{ fontSize: 13, fontWeight: 600, color: T.text, marginBottom: 10 }}>
                {act?.replace(/_/g, ' ')}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {filterCtx && (inFilter ? (
                  <button onClick={() => filterCtx.remove(selectedId)} style={btnGhost}>
                    ✕ Remove from filter
                  </button>
                ) : (
                  <button onClick={() => filterCtx.add(selectedId)} style={btnPrimary}>
                    Filter to cases with this activity
                  </button>
                ))}
                <button onClick={() => setFocusId(selectedId)} style={btnGhost}>
                  Focus on reachable subgraph
                </button>
              </div>
              <div style={{ fontSize: 11, color: T.textSubtle, marginTop: 10, lineHeight: 1.5 }}>
                Filtering narrows variants, cases, and insights to traces that pass through this activity.
              </div>
            </div>
          );
        })()}

        {edgePopup && (
          <div style={{ position: 'absolute', top: 12, right: 12, background: T.surface, border: `1px solid ${T.border}`, padding: 12, borderRadius: 6, fontSize: 11, width: 280, boxShadow: '0 10px 30px rgba(0,0,0,0.12)' }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: T.accentText, marginBottom: 8 }}>Transition details</div>
            <div style={{ marginBottom: 8 }}>
              <div style={{ fontSize: 11, color: T.textMuted }}>{otName(edgePopup.from_object_type_id)}</div>
              <div style={{ fontSize: 13, fontWeight: 600 }}>{edgePopup.from_activity}</div>
              <div style={{ fontSize: 14, color: T.textSubtle, margin: '2px 0' }}>↓</div>
              <div style={{ fontSize: 11, color: T.textMuted }}>{otName(edgePopup.to_object_type_id)}</div>
              <div style={{ fontSize: 13, fontWeight: 600 }}>{edgePopup.to_activity}</div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: 6 }}>
              <Stat label="Cases" value={edgePopup.count.toLocaleString()} />
              <Stat label="Avg" value={fmtH(edgePopup.avg_hours)} />
              <Stat label="p50" value={fmtH(edgePopup.p50_hours)} />
              <Stat label="p95" value={fmtH(edgePopup.p95_hours)} />
            </div>
            <button onClick={() => setEdgePopup(null)} style={{ ...btnGhost, marginTop: 10, width: '100%' }}>Close</button>
          </div>
        )}
      </div>

      {stats && <KpiBar stats={stats} />}
    </div>
  );
};

// ── Variants tab ─────────────────────────────────────────────────────────────

const VariantsPane: React.FC<{ process: Process; otName: (id: string | null | undefined) => string; filterCtx?: FilterCtx }> = ({ process, otName, filterCtx }) => {
  const [variants, setVariants] = useState<ProcessVariant[]>([]);
  const [totalCases, setTotalCases] = useState(0);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  useEffect(() => {
    setLoading(true);
    getVariants(process.id, 100).then((r) => {
      setVariants(r.variants); setTotalCases(r.total_cases);
    }).finally(() => setLoading(false));
  }, [process.id]);

  if (loading) return <Loading />;

  // Apply global activity filter — variant must contain ALL filtered activities (AND)
  const activeFilter = filterCtx?.filter || [];
  const matchesFilter = (v: ProcessVariant): boolean => {
    if (!activeFilter.length) return true;
    const stepKeys = new Set(v.steps.map((s) => `${s.object_type_id || ''}::${s.activity}`));
    return activeFilter.every((k) => stepKeys.has(k));
  };
  const filteredByActivity = variants.filter(matchesFilter);
  const filtered = filteredByActivity.filter((v) =>
    !search || v.activities.some((a) => a.toLowerCase().includes(search.toLowerCase())));

  // When a filter is active, totals + frequency % recompute against the filtered case base.
  const filteredTotalCases = activeFilter.length
    ? filteredByActivity.reduce((s, v) => s + v.case_count, 0)
    : totalCases;
  const filteredPct = (caseCount: number) =>
    filteredTotalCases ? Math.round((caseCount / filteredTotalCases) * 1000) / 10 : 0;

  const top10 = filteredByActivity.slice(0, 10);
  const ots = process.included_object_type_ids;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 12 }}>
        <Card title="Top 10 variants by case count">
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={top10} layout="vertical" margin={{ left: 30 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={T.border} horizontal={false} />
              <XAxis type="number" tick={{ fontSize: 10, fill: T.textMuted, fontFamily: T.mono }} stroke={T.border} />
              <YAxis type="category" dataKey="variant_id" tick={{ fontSize: 10, fill: T.textMuted, fontFamily: T.mono }} stroke={T.border} width={70} tickFormatter={(v) => `#${variants.findIndex((x) => x.variant_id === v) + 1}`} />
              <Tooltip wrapperStyle={{ fontSize: 11, fontFamily: T.mono }} contentStyle={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 2, color: T.text }} labelStyle={{ color: T.textMuted }} formatter={(v: any) => v.toLocaleString()}
                labelFormatter={(_l, p: any) => p?.[0]?.payload ? `#${p[0].payload.rank} · ${p[0].payload.case_count} cases (${p[0].payload.frequency_pct}%)` : ''} />
              <Bar dataKey="case_count" fill={T.accent} radius={[0, 3, 3, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </Card>
        <Card title={activeFilter.length ? 'Coverage (filtered)' : 'Coverage'}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <Stat label={activeFilter.length ? 'Cases (filtered)' : 'Total cases'} value={filteredTotalCases.toLocaleString()} />
            <Stat label="Distinct variants" value={filteredByActivity.length.toString()} />
            <Stat label="Top 1 covers" value={`${filteredPct(top10[0]?.case_count ?? 0)}%`} />
            <Stat label="Top 5 cover" value={`${top10.slice(0, 5).reduce((a, v) => a + filteredPct(v.case_count), 0).toFixed(1)}%`} />
            <Stat label="Top 10 cover" value={`${top10.reduce((a, v) => a + filteredPct(v.case_count), 0).toFixed(1)}%`} />
          </div>
        </Card>
      </div>

      <Card title={`All variants (${filtered.length})`} action={
        <input placeholder="Filter by activity…" value={search} onChange={(e) => setSearch(e.target.value)}
          style={{ ...input, width: 220, padding: '4px 8px' }} />
      }>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 'calc(100vh - 460px)', overflow: 'auto' }}>
          {filtered.map((v) => {
            const isSel = selected === v.variant_id;
            return (
              <div key={v.variant_id}
                onClick={() => setSelected(isSel ? null : v.variant_id)}
                style={{ border: `1px solid ${isSel ? T.accent : T.border}`, borderRadius: 2, padding: '8px 10px', background: isSel ? T.accentDim : T.surface, cursor: 'pointer' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: isSel ? 8 : 4 }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: T.textMuted, minWidth: 32 }}>#{v.rank}</span>
                  <span style={{ fontSize: 13, fontWeight: 600 }}>{v.case_count.toLocaleString()}</span>
                  <span style={{ fontSize: 11, color: T.textMuted }}>{v.frequency_pct}%</span>
                  <span style={{ fontSize: 11, color: T.textMuted }}>· avg {v.avg_duration_days}d</span>
                  <span style={{ fontSize: 11, color: T.textSubtle }}>· {v.steps.length} steps</span>
                  {v.is_rework && <span style={{ ...chip, background: T.warningDim, color: T.warning }}>rework</span>}
                </div>
                <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap', alignItems: 'center' }}>
                  {(isSel ? v.steps : v.steps.slice(0, 14)).map((s, i, arr) => (
                    <React.Fragment key={i}>
                      <span style={{ ...chip, fontSize: 10,
                        background: colorForObjectType(s.object_type_id, ots) + '22',
                        color: colorForObjectType(s.object_type_id, ots) }}>
                        <span style={{ opacity: 0.7, marginRight: 4 }}>{otName(s.object_type_id)}</span>{s.activity}
                      </span>
                      {i < arr.length - 1 && <span style={{ color: '#CBD5E1', fontSize: 10 }}>→</span>}
                    </React.Fragment>
                  ))}
                  {!isSel && v.steps.length > 14 && (
                    <span style={{ fontSize: 10, color: T.textSubtle }}>… +{v.steps.length - 14}</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </Card>
    </div>
  );
};

// ── Insights tab — derived analytics ─────────────────────────────────────────

interface ActivityStat {
  activity: string;
  objectTypeId: string | null;
  occurrences: number;        // total events
  caseCoverage: number;       // distinct cases that include this activity
  caseCoveragePct: number;    // % of all cases
  avgDwellHours: number;      // avg time spent at this activity (from transitions)
  isEntry: boolean;
  isExit: boolean;
}

interface AutomationSuggestion {
  id: string;
  kind: 'bottleneck' | 'handoff' | 'rework' | 'manual';
  title: string;
  rationale: string;
  fromActivity: string | null;
  fromObjectTypeId: string | null;
  toActivity: string;
  toObjectTypeId: string | null;
  caseCount: number;
  hoursSavedPerCase: number;
  reductionPct: number;        // % reduction in avg case throughput if this is automated
}

const InsightsPane: React.FC<{ process: Process; otName: (id: string | null | undefined) => string; filterCtx?: FilterCtx }> = ({ process, otName, filterCtx }) => {
  const [variants, setVariants] = useState<ProcessVariant[]>([]);
  const [transitions, setTransitions] = useState<ProcessTransition[]>([]);
  const [bottlenecks, setBottlenecks] = useState<ProcessBottleneck[]>([]);
  const [cases, setCases] = useState<ProcessCase[]>([]);
  const [totalCases, setTotalCases] = useState(0);
  const [loading, setLoading] = useState(true);
  const [actSort, setActSort] = useState<'occurrences' | 'caseCoverage' | 'avgDwellHours'>('occurrences');

  // Automation ROI inputs — persisted per-tenant in localStorage
  const [hourlyRate, setHourlyRate] = useState<number>(() => {
    const v = localStorage.getItem('pmv2.hourlyRate');
    return v ? Number(v) : 50;
  });
  const [casesPerYear, setCasesPerYear] = useState<number | null>(null);
  useEffect(() => { localStorage.setItem('pmv2.hourlyRate', String(hourlyRate)); }, [hourlyRate]);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      getVariants(process.id, 200),
      getTransitions(process.id),
      getCases(process.id, 500),
      getBottlenecks(process.id, 30),
    ]).then(([v, t, c, b]) => {
      setVariants(v.variants);
      setTotalCases(v.total_cases);
      setTransitions(t.transitions);
      setCases(c.cases);
      setBottlenecks(b.bottlenecks);
    }).finally(() => setLoading(false));
  }, [process.id]);

  // Apply global activity filter
  const activeFilter = filterCtx?.filter || [];
  const filteredVariants = useMemo(() => {
    if (!activeFilter.length) return variants;
    return variants.filter((v) => {
      const stepKeys = new Set(v.steps.map((s) => `${s.object_type_id || ''}::${s.activity}`));
      return activeFilter.every((k) => stepKeys.has(k));
    });
  }, [variants, activeFilter]);
  const filteredTotalCases = useMemo(
    () => activeFilter.length ? filteredVariants.reduce((s, v) => s + v.case_count, 0) : totalCases,
    [filteredVariants, totalCases, activeFilter.length]
  );
  const filteredCases = useMemo(() => {
    if (!activeFilter.length) return cases;
    return cases.filter((c) => {
      const stepKeys = new Set((c.steps || []).map((s) => `${s.object_type_id || ''}::${s.activity}`));
      return activeFilter.every((k) => stepKeys.has(k));
    });
  }, [cases, activeFilter]);

  // Variant coverage Pareto curve (cumulative % of cases by variant rank)
  const paretoData = useMemo(() => {
    let cum = 0;
    const denom = filteredTotalCases || 1;
    return filteredVariants.map((v, i) => {
      cum += v.case_count;
      return {
        rank: i + 1,
        cumPct: Math.round((cum / denom) * 1000) / 10,
        thisPct: Math.round((v.case_count / denom) * 1000) / 10,
        cases: v.case_count,
      };
    });
  }, [filteredVariants, filteredTotalCases]);

  // Activity frequency — derived from variants and transitions
  const activityStats = useMemo<ActivityStat[]>(() => {
    if (!filteredVariants.length) return [];
    // For each step (object_type_id, activity), accumulate stats
    type Key = string;
    const k = (act: string, ot: string | null | undefined): Key => `${ot || ''}::${act}`;

    const occ = new Map<Key, number>();
    const dwellSum = new Map<Key, { sum: number; n: number }>();
    const meta = new Map<Key, { activity: string; ot: string | null; isEntry: boolean; isExit: boolean }>();

    for (const v of filteredVariants) {
      const seen = new Set<Key>();
      v.steps.forEach((s, i) => {
        const key = k(s.activity, s.object_type_id);
        meta.set(key, {
          activity: s.activity,
          ot: s.object_type_id,
          isEntry: meta.get(key)?.isEntry || i === 0,
          isExit: meta.get(key)?.isExit || i === v.steps.length - 1,
        });
        if (!seen.has(key)) {
          occ.set(key, (occ.get(key) || 0) + v.case_count);
          seen.add(key);
        }
      });
    }

    // Dwell time from transitions (avg_hours into a node)
    for (const t of transitions) {
      const key = k(t.to_activity, t.to_object_type_id);
      const dw = dwellSum.get(key) || { sum: 0, n: 0 };
      dw.sum += t.avg_hours * t.count;
      dw.n += t.count;
      dwellSum.set(key, dw);
    }

    const out: ActivityStat[] = [];
    for (const [key, m] of meta.entries()) {
      const dw = dwellSum.get(key);
      out.push({
        activity: m.activity,
        objectTypeId: m.ot,
        occurrences: occ.get(key) || 0,
        caseCoverage: occ.get(key) || 0, // since occ counts cases (variant case_count summed once per variant)
        caseCoveragePct: filteredTotalCases ? Math.round(((occ.get(key) || 0) / filteredTotalCases) * 1000) / 10 : 0,
        avgDwellHours: dw && dw.n ? dw.sum / dw.n : 0,
        isEntry: m.isEntry,
        isExit: m.isExit,
      });
    }
    return out;
  }, [filteredVariants, transitions, filteredTotalCases]);

  const sortedActivities = useMemo(() => {
    return [...activityStats].sort((a, b) => (b as any)[actSort] - (a as any)[actSort]);
  }, [activityStats, actSort]);

  // Case duration histogram — bin cases by total_duration_days
  const durationHist = useMemo(() => {
    if (!filteredCases.length) return [] as { bucket: string; count: number; lo: number; hi: number }[];
    const durs = filteredCases.map((c) => c.total_duration_days || 0).filter((d) => d >= 0);
    const max = Math.max(...durs, 1);
    const binCount = 12;
    const binSize = max / binCount;
    const bins: { bucket: string; count: number; lo: number; hi: number }[] = [];
    for (let i = 0; i < binCount; i++) {
      const lo = i * binSize, hi = (i + 1) * binSize;
      bins.push({
        bucket: `${lo.toFixed(0)}–${hi.toFixed(0)}d`,
        count: 0, lo, hi,
      });
    }
    for (const d of durs) {
      const idx = Math.min(binCount - 1, Math.floor(d / binSize));
      bins[idx].count++;
    }
    return bins;
  }, [filteredCases]);

  // Idle time buckets
  const idleHist = useMemo(() => {
    if (!filteredCases.length) return [] as { bucket: string; count: number }[];
    const buckets = [
      { bucket: '<1d',     test: (d: number) => d < 1 },
      { bucket: '1–7d',    test: (d: number) => d >= 1 && d < 7 },
      { bucket: '7–30d',   test: (d: number) => d >= 7 && d < 30 },
      { bucket: '30–90d',  test: (d: number) => d >= 30 && d < 90 },
      { bucket: '90–365d', test: (d: number) => d >= 90 && d < 365 },
      { bucket: '>1y',     test: (d: number) => d >= 365 },
    ];
    return buckets.map((b) => ({
      bucket: b.bucket,
      count: filteredCases.filter((c) => b.test(c.days_since_last_activity || 0)).length,
    }));
  }, [filteredCases]);

  // Per-object-type breakdown
  const perObject = useMemo(() => {
    const ots = process.included_object_type_ids;
    const events = new Map<string, number>();
    for (const v of filteredVariants) {
      const stepsByOt = new Map<string, number>();
      for (const s of v.steps) {
        const o = s.object_type_id || '';
        stepsByOt.set(o, (stepsByOt.get(o) || 0) + 1);
      }
      for (const [ot, n] of stepsByOt.entries()) {
        events.set(ot, (events.get(ot) || 0) + n * v.case_count);
      }
    }
    return ots.map((ot) => {
      let caseTouchCount = 0;
      for (const v of filteredVariants) {
        if (v.steps.some((s) => s.object_type_id === ot)) caseTouchCount += v.case_count;
      }
      return {
        ot,
        name: otName(ot),
        events: events.get(ot) || 0,
        casesTouched: caseTouchCount,
        coveragePct: filteredTotalCases ? Math.round((caseTouchCount / filteredTotalCases) * 1000) / 10 : 0,
        color: colorForObjectType(ot, ots),
      };
    });
  }, [filteredVariants, process.included_object_type_ids, filteredTotalCases, otName]);

  // ── Automation suggestions ────────────────────────────────────────────────
  // Derived from bottlenecks: each top-N slow transition is a candidate to
  // automate. We assume an automation removes ~80% of the wait time on that
  // transition (conservative estimate) and rank by total annual hours saved.
  const avgCaseHours = useMemo(() => {
    const totals = filteredCases.map((c) => (c.total_duration_days || 0) * 24);
    if (!totals.length) return 0;
    return totals.reduce((s, h) => s + h, 0) / totals.length;
  }, [filteredCases]);

  const automationSuggestions = useMemo<AutomationSuggestion[]>(() => {
    const out: AutomationSuggestion[] = [];
    // 1. Slow transitions → bottleneck automation
    for (const b of bottlenecks) {
      if (!b.from_activity || b.avg_hours <= 1) continue;
      const isHandoff = b.from_object_type_id !== b.to_object_type_id;
      const hoursSavedPerCase = b.avg_hours * 0.8;  // assume 80% reduction
      const reductionPct = avgCaseHours > 0 ? (hoursSavedPerCase / avgCaseHours) * 100 : 0;
      out.push({
        id: `${b.from_activity}-${b.to_activity}`,
        kind: isHandoff ? 'handoff' : 'bottleneck',
        title: isHandoff
          ? `Automate handoff: ${b.from_activity} → ${b.to_activity}`
          : `Automate transition: ${b.from_activity} → ${b.to_activity}`,
        rationale: isHandoff
          ? `Cross-object handoff between ${otName(b.from_object_type_id)} and ${otName(b.to_object_type_id)}. Currently averages ${fmtH(b.avg_hours)} of wait per case (${b.case_count} cases observed). Eliminating the manual baton-pass between systems is a high-confidence automation.`
          : `Average wait of ${fmtH(b.avg_hours)} between these two activities. Often automatable with a rule trigger on completion of the upstream step.`,
        fromActivity: b.from_activity,
        fromObjectTypeId: b.from_object_type_id,
        toActivity: b.to_activity,
        toObjectTypeId: b.to_object_type_id,
        caseCount: b.case_count,
        hoursSavedPerCase,
        reductionPct,
      });
    }
    // 2. Rework loops (variants where activity recurs)
    const reworkVariants = filteredVariants.filter((v) => v.is_rework).slice(0, 3);
    for (const rv of reworkVariants) {
      // Find a repeated activity in this variant
      const seen = new Set<string>();
      let repeatedAct: string | null = null;
      let repeatedOt: string | null = null;
      for (const s of rv.steps) {
        const k = `${s.object_type_id || ''}::${s.activity}`;
        if (seen.has(k)) { repeatedAct = s.activity; repeatedOt = s.object_type_id; break; }
        seen.add(k);
      }
      if (!repeatedAct) continue;
      const hoursSavedPerCase = avgCaseHours * 0.15;  // assume 15% case time saved
      out.push({
        id: `rework-${rv.variant_id}-${repeatedAct}`,
        kind: 'rework',
        title: `Eliminate rework loop on "${repeatedAct}"`,
        rationale: `${rv.case_count} cases follow a path that repeats "${repeatedAct}". Adding a pre-condition check (validation, approval gate, or AI classifier) can prevent the loop. Estimated 15% throughput improvement on affected cases.`,
        fromActivity: null,
        fromObjectTypeId: null,
        toActivity: repeatedAct,
        toObjectTypeId: repeatedOt,
        caseCount: rv.case_count,
        hoursSavedPerCase,
        reductionPct: 15,
      });
    }
    // Sort by total annual hours saved (caseCount × hoursSavedPerCase)
    out.sort((a, b) => (b.caseCount * b.hoursSavedPerCase) - (a.caseCount * a.hoursSavedPerCase));
    return out.slice(0, 8);
  }, [bottlenecks, filteredVariants, avgCaseHours, otName]);

  // ── Root cause: which variants drive most of the slow + stuck cases ──────
  const rootCauseRows = useMemo(() => {
    if (!filteredCases.length) return [] as { kind: string; title: string; cases: number; pct: number; impact: string }[];
    const sortedByDur = [...filteredCases].sort((a, b) => b.total_duration_days - a.total_duration_days);
    const top10pctCount = Math.max(1, Math.floor(filteredCases.length * 0.1));
    const slowCases = sortedByDur.slice(0, top10pctCount);
    const stuckCases = filteredCases.filter((c) => c.state === 'stuck');
    const reworkCases = filteredCases.filter((c) => c.is_rework);
    // Variants that appear in slowest cases but not in fastest
    const fastVariantIds = new Set(sortedByDur.slice(-top10pctCount).map((c) => c.variant_id));
    const slowVariantIds = new Set(slowCases.map((c) => c.variant_id));
    const slowOnlyVariants = [...slowVariantIds].filter((id) => !fastVariantIds.has(id));

    const rows: { kind: string; title: string; cases: number; pct: number; impact: string }[] = [];
    if (slowCases.length) {
      const avgSlow = slowCases.reduce((s, c) => s + c.total_duration_days, 0) / slowCases.length;
      const avgAll = filteredCases.reduce((s, c) => s + c.total_duration_days, 0) / filteredCases.length;
      rows.push({
        kind: 'Slow cases',
        title: `Top 10% slowest cases (avg ${avgSlow.toFixed(1)}d vs overall ${avgAll.toFixed(1)}d)`,
        cases: slowCases.length,
        pct: 10,
        impact: `${(avgSlow - avgAll).toFixed(1)}d above mean`,
      });
    }
    if (slowOnlyVariants.length) {
      rows.push({
        kind: 'Variant pattern',
        title: `${slowOnlyVariants.length} variants only seen in slow cases — investigate path divergence`,
        cases: slowCases.filter((c) => slowOnlyVariants.includes(c.variant_id)).length,
        pct: 100 * slowOnlyVariants.length / Math.max(filteredVariants.length, 1),
        impact: 'Path-driven',
      });
    }
    if (reworkCases.length) {
      rows.push({
        kind: 'Rework',
        title: `${reworkCases.length} cases involve rework — repeated activities in the trace`,
        cases: reworkCases.length,
        pct: 100 * reworkCases.length / filteredCases.length,
        impact: 'Quality / first-pass-yield issue',
      });
    }
    if (stuckCases.length) {
      rows.push({
        kind: 'Stuck',
        title: `${stuckCases.length} cases stuck (no activity in 30+ days)`,
        cases: stuckCases.length,
        pct: 100 * stuckCases.length / filteredCases.length,
        impact: 'Open WIP',
      });
    }
    return rows;
  }, [filteredCases, filteredVariants]);

  // Estimate cases/year from the spread of last_activity_at if user hasn't overridden
  useEffect(() => {
    if (casesPerYear !== null || !filteredCases.length) return;
    const dates = filteredCases.map((c) => c.last_activity_at).filter(Boolean) as string[];
    if (!dates.length) return;
    const ts = dates.map((d) => +new Date(d)).sort();
    const spanDays = (ts[ts.length - 1] - ts[0]) / (1000 * 60 * 60 * 24);
    if (spanDays < 1) {
      setCasesPerYear(filteredCases.length);
    } else {
      setCasesPerYear(Math.round((filteredCases.length / spanDays) * 365));
    }
  }, [filteredCases, casesPerYear]);

  if (loading) return <Loading />;
  if (!variants.length) return <Empty />;

  const ots = process.included_object_type_ids;
  const top80 = paretoData.findIndex((d) => d.cumPct >= 80) + 1;
  const top95 = paretoData.findIndex((d) => d.cumPct >= 95) + 1;
  const maxOcc = Math.max(1, ...sortedActivities.map((a) => a.occurrences));
  const cy = casesPerYear ?? filteredTotalCases;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* Pareto + complexity stats */}
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 12 }}>
        <Card title="Variant coverage (Pareto)">
          <ResponsiveContainer width="100%" height={240}>
            <ComposedChart data={paretoData}>
              <CartesianGrid strokeDasharray="3 3" stroke={T.border} />
              <XAxis dataKey="rank" tick={{ fontSize: 10, fill: T.textMuted, fontFamily: T.mono }} stroke={T.border} label={{ value: 'Variant rank', position: 'insideBottom', offset: -5, fontSize: 10 }} />
              <YAxis yAxisId="left" tick={{ fontSize: 10, fill: T.textMuted, fontFamily: T.mono }} stroke={T.border} domain={[0, 100]} unit="%" />
              <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 10, fill: T.textMuted, fontFamily: T.mono }} stroke={T.border} />
              <Tooltip wrapperStyle={{ fontSize: 11, fontFamily: T.mono }} contentStyle={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 2, color: T.text }} labelStyle={{ color: T.textMuted }} formatter={(v: any, name: string) => name === 'cumPct' ? `${v}%` : v.toLocaleString()} />
              <Bar yAxisId="right" dataKey="cases" fill={T.accent} opacity={0.5} />
              <Line yAxisId="left" dataKey="cumPct" stroke="#F59E0B" strokeWidth={2} dot={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </Card>
        <Card title={activeFilter.length ? `Filtered complexity (${activeFilter.length} activity ${activeFilter.length === 1 ? 'filter' : 'filters'})` : 'Process complexity'}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <Stat label={activeFilter.length ? 'Cases (filtered)' : 'Total cases'} value={filteredTotalCases.toLocaleString()} />
            <Stat label="Distinct variants" value={filteredVariants.length.toString()} />
            <Stat label="Distinct activities" value={activityStats.length.toString()} />
            <Stat label="Variants for 80% coverage" value={top80 > 0 ? top80.toString() : '—'} />
            <Stat label="Variants for 95% coverage" value={top95 > 0 ? top95.toString() : '—'} />
            <Stat label="Top 1 covers" value={`${filteredVariants[0]?.frequency_pct ?? 0}%`} />
            <Stat label="Avg events / case" value={(filteredCases.reduce((s, c) => s + c.event_count, 0) / Math.max(filteredCases.length, 1)).toFixed(1)} />
            {process.included_object_type_ids.length > 1 && <Stat label="Object types" value={`${process.included_object_type_ids.length} (cross-object)`} />}
          </div>
        </Card>
      </div>

      {/* Per-object-type breakdown — only useful when cross-object */}
      {ots.length > 1 && (
        <Card title="Per-object-type breakdown">
          <div style={{ display: 'grid', gridTemplateColumns: `repeat(${ots.length}, 1fr)`, gap: 12 }}>
            {perObject.map((p) => (
              <div key={p.ot} style={{ border: `1.5px solid ${p.color}`, borderRadius: 6, padding: 12 }}>
                <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.07em', color: p.color, textTransform: 'uppercase' }}>{p.name}</div>
                <div style={{ fontSize: 22, fontWeight: 700, fontFamily: 'var(--font-mono)', marginTop: 4 }}>{p.events.toLocaleString()}</div>
                <div style={{ fontSize: 10, color: T.textSubtle }}>events emitted</div>
                <div style={{ height: 8, background: T.surfaceHi, borderRadius: 4, marginTop: 10, overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${p.coveragePct}%`, background: p.color }} />
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: T.textMuted, marginTop: 4 }}>
                  <span>{p.casesTouched.toLocaleString()} cases touched</span>
                  <span style={{ fontWeight: 600 }}>{p.coveragePct}%</span>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Automation suggestions */}
      <Card
        title={`Automation suggestions (${automationSuggestions.length})`}
        action={(
          <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={muted}>Hourly rate</span>
              <span style={{ fontSize: 12, color: T.textMuted }}>$</span>
              <input
                type="number" min={0} step={1}
                value={hourlyRate}
                onChange={(e) => setHourlyRate(Math.max(0, Number(e.target.value) || 0))}
                style={{ ...input, width: 70, padding: '4px 8px' }}
              />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={muted}>Cases / year</span>
              <input
                type="number" min={0} step={1}
                value={cy}
                onChange={(e) => setCasesPerYear(Math.max(0, Number(e.target.value) || 0))}
                style={{ ...input, width: 90, padding: '4px 8px' }}
              />
            </div>
          </div>
        )}
      >
        {automationSuggestions.length === 0 ? (
          <div style={mutedNote}>No bottlenecks slow enough to suggest automation. Try widening the variant slider on the Map tab to surface more transitions.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {automationSuggestions.map((s) => {
              const annualHoursSaved = s.hoursSavedPerCase * (cy * (s.caseCount / Math.max(filteredTotalCases, 1)));
              const annualDollarsSaved = annualHoursSaved * hourlyRate;
              const kindColor =
                s.kind === 'handoff' ? T.danger :
                s.kind === 'rework' ? T.warning :
                s.kind === 'manual' ? T.brand : T.accent;
              const kindLabel =
                s.kind === 'handoff' ? 'Cross-object handoff' :
                s.kind === 'rework' ? 'Rework loop' :
                s.kind === 'manual' ? 'Manual step' : 'Bottleneck';
              return (
                <div key={s.id} style={{
                  border: `1px solid ${T.border}`, borderRadius: 6, padding: 14,
                  display: 'grid', gridTemplateColumns: '1fr auto', gap: 16,
                }}>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                      <span style={{ ...chip, background: kindColor + '22', color: kindColor }}>
                        {kindLabel}
                      </span>
                      <span style={{ fontSize: 13, fontWeight: 600, color: T.text }}>{s.title}</span>
                    </div>
                    <div style={{ fontSize: 12, color: T.textMuted, lineHeight: 1.5, marginBottom: 8 }}>
                      {s.rationale}
                    </div>
                    <div style={{ display: 'flex', gap: 16, fontSize: 12, color: T.textMuted, flexWrap: 'wrap' }}>
                      <span><strong style={{ color: T.text, fontFamily: T.mono }}>{s.caseCount.toLocaleString()}</strong> cases observed</span>
                      <span><strong style={{ color: T.text, fontFamily: T.mono }}>{fmtH(s.hoursSavedPerCase)}</strong> saved per case</span>
                      <span><strong style={{ color: T.text, fontFamily: T.mono }}>{s.reductionPct.toFixed(0)}%</strong> case throughput reduction</span>
                    </div>
                  </div>
                  <div style={{ minWidth: 200, textAlign: 'right' }}>
                    <div style={{ fontSize: 10, color: T.textMuted, marginBottom: 2 }}>Estimated annual savings</div>
                    <div style={{ fontSize: 22, fontWeight: 700, fontFamily: T.mono, color: T.success, lineHeight: 1 }}>
                      ${annualDollarsSaved.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                    </div>
                    <div style={{ fontSize: 11, color: T.textSubtle, marginTop: 4, fontFamily: T.mono }}>
                      {Math.round(annualHoursSaved).toLocaleString()} hours / year
                    </div>
                    <button
                      onClick={() => {
                        // eslint-disable-next-line no-console
                        console.log('[automation suggestion] would create:', s);
                        alert(`Automation request queued (placeholder):\n\n${s.title}\n\nIn the future, an agent will draft the automation pipeline. For now this is a no-op.`);
                      }}
                      style={{ ...btnPrimary, marginTop: 10, width: '100%' }}
                    >
                      Create automation
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {/* Root cause analysis */}
      <Card title="Root cause analysis">
        {rootCauseRows.length === 0 ? (
          <div style={mutedNote}>Not enough variation in the case data to surface root causes.</div>
        ) : (
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={th}>Signal</th>
                <th style={th}>Finding</th>
                <th style={thNum}>Cases</th>
                <th style={thNum}>% of total</th>
                <th style={th}>Impact</th>
              </tr>
            </thead>
            <tbody>
              {rootCauseRows.map((r, i) => (
                <tr key={i}>
                  <td style={td}>
                    <span style={{
                      ...chip,
                      background:
                        r.kind === 'Slow cases' ? T.warningDim :
                        r.kind === 'Stuck' ? T.dangerDim :
                        r.kind === 'Rework' ? T.warningDim : T.accentDim,
                      color:
                        r.kind === 'Slow cases' ? T.warning :
                        r.kind === 'Stuck' ? T.danger :
                        r.kind === 'Rework' ? T.warning : T.accentText,
                    }}>{r.kind}</span>
                  </td>
                  <td style={td}>{r.title}</td>
                  <td style={tdNum}>{r.cases.toLocaleString()}</td>
                  <td style={tdNum}>{r.pct.toFixed(1)}%</td>
                  <td style={td}>{r.impact}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {/* Histograms */}
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 12 }}>
        <Card title={activeFilter.length ? `Case duration histogram (${filteredCases.length} filtered cases)` : `Case duration histogram (${filteredCases.length} cases)`}>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={durationHist}>
              <CartesianGrid strokeDasharray="3 3" stroke={T.border} />
              <XAxis dataKey="bucket" tick={{ fontSize: 9, fill: T.textMuted, fontFamily: T.mono }} stroke={T.border} />
              <YAxis tick={{ fontSize: 10, fill: T.textMuted, fontFamily: T.mono }} stroke={T.border} />
              <Tooltip wrapperStyle={{ fontSize: 11, fontFamily: T.mono }} contentStyle={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 2, color: T.text }} labelStyle={{ color: T.textMuted }} />
              <Bar dataKey="count" fill="#0EA5E9" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </Card>
        <Card title={activeFilter.length ? 'Idle time distribution (filtered)' : 'Idle time distribution'}>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={idleHist}>
              <CartesianGrid strokeDasharray="3 3" stroke={T.border} />
              <XAxis dataKey="bucket" tick={{ fontSize: 10, fill: T.textMuted, fontFamily: T.mono }} stroke={T.border} />
              <YAxis tick={{ fontSize: 10, fill: T.textMuted, fontFamily: T.mono }} stroke={T.border} />
              <Tooltip wrapperStyle={{ fontSize: 11, fontFamily: T.mono }} contentStyle={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 2, color: T.text }} labelStyle={{ color: T.textMuted }} />
              <Bar dataKey="count" radius={[3, 3, 0, 0]}>
                {idleHist.map((b, i) => {
                  const c = b.bucket === '>1y' ? '#DC2626' :
                            b.bucket === '90–365d' ? '#F59E0B' :
                            b.bucket === '30–90d' ? '#FCD34D' : '#10B981';
                  return <Cell key={i} fill={c} />;
                })}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </Card>
      </div>

      {/* Activity frequency table */}
      <Card title={`Activity frequency (${sortedActivities.length} unique activities)`} action={
        <Toggle label="Sort by" options={['occurrences', 'caseCoverage', 'avgDwellHours']} value={actSort} onChange={(v) => setActSort(v as any)} />
      }>
        <div style={{ overflow: 'auto', maxHeight: 'calc(100vh - 600px)' }}>
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={th}>#</th>
                <th style={th}>Activity</th>
                <th style={th}>Object</th>
                <th style={thNum}>Occurrences</th>
                <th style={th}>Distribution</th>
                <th style={thNum}>Case coverage</th>
                <th style={thNum}>Avg dwell</th>
                <th style={th}>Role</th>
              </tr>
            </thead>
            <tbody>
              {sortedActivities.map((a, i) => (
                <tr key={i}>
                  <td style={td}>{i + 1}</td>
                  <td style={td}><strong>{a.activity}</strong></td>
                  <td style={td}>
                    <span style={{ ...chip, background: colorForObjectType(a.objectTypeId, ots) + '22', color: colorForObjectType(a.objectTypeId, ots) }}>
                      {otName(a.objectTypeId)}
                    </span>
                  </td>
                  <td style={tdNum}>{a.occurrences.toLocaleString()}</td>
                  <td style={{ ...td, width: 200 }}>
                    <div style={{ height: 6, background: T.surfaceHi, borderRadius: 3, overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: `${(a.occurrences / maxOcc) * 100}%`, background: colorForObjectType(a.objectTypeId, ots) }} />
                    </div>
                  </td>
                  <td style={tdNum}>{a.caseCoveragePct}%</td>
                  <td style={tdNum}>{fmtH(a.avgDwellHours)}</td>
                  <td style={td}>
                    {a.isEntry && <span style={{ ...chip, background: T.accentDim, color: T.accentText }}>start</span>}
                    {a.isExit && <span style={{ ...chip, background: T.brandDim, color: T.brandText, marginLeft: 4 }}>end</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
};

// ── Bottlenecks tab ──────────────────────────────────────────────────────────

const BottlenecksPane: React.FC<{ process: Process; otName: (id: string | null | undefined) => string; filterCtx?: FilterCtx }> = ({ process, otName, filterCtx }) => {
  const [items, setItems] = useState<ProcessBottleneck[]>([]);
  const [loading, setLoading] = useState(true);
  const [sortKey, setSortKey] = useState<'avg_hours' | 'p95_hours' | 'case_count'>('avg_hours');

  useEffect(() => {
    setLoading(true);
    getBottlenecks(process.id, 30).then((r) => setItems(r.bottlenecks)).finally(() => setLoading(false));
  }, [process.id]);

  if (loading) return <Loading />;
  const sorted = [...items].sort((a, b) => (b as any)[sortKey] - (a as any)[sortKey]);
  const top10 = sorted.slice(0, 10).map((b, i) => ({
    ...b,
    label: `${(b.from_activity || '∅').slice(0, 12)} → ${b.to_activity.slice(0, 12)}`,
    rank: i + 1,
  }));
  const ots = process.included_object_type_ids;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <Card title={`Top 10 slowest transitions (${sortKey === 'avg_hours' ? 'avg' : sortKey === 'p95_hours' ? 'p95' : 'cases'})`}>
        <ResponsiveContainer width="100%" height={300}>
          <BarChart data={top10} layout="vertical" margin={{ left: 100 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={T.border} horizontal={false} />
            <XAxis type="number" tick={{ fontSize: 10, fill: T.textMuted, fontFamily: T.mono }} stroke={T.border} unit={sortKey === 'case_count' ? '' : 'h'} />
            <YAxis type="category" dataKey="label" tick={{ fontSize: 10, fill: T.textMuted, fontFamily: T.mono }} stroke={T.border} width={140} />
            <Tooltip wrapperStyle={{ fontSize: 11, fontFamily: T.mono }} contentStyle={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 2, color: T.text }} labelStyle={{ color: T.textMuted }} />
            <Bar dataKey={sortKey} radius={[0, 3, 3, 0]}>
              {top10.map((b, i) => {
                const cross = b.from_object_type_id !== b.to_object_type_id;
                return <Cell key={i} fill={cross ? '#DC2626' : '#7C3AED'} />;
              })}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </Card>

      <Card title={`All bottlenecks (${sorted.length})`} action={
        <Toggle label="Sort by" options={['avg_hours', 'p95_hours', 'case_count']} value={sortKey} onChange={(v) => setSortKey(v as any)} />
      }>
        <div style={{ overflow: 'auto', maxHeight: 'calc(100vh - 580px)' }}>
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={th}>From</th>
                <th style={th}>To</th>
                <th style={th}>Cross-object?</th>
                <th style={thNum}>Cases</th>
                <th style={thNum}>Avg (h)</th>
                <th style={thNum}>p95 (h)</th>
                <th style={thNum}>Max (h)</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((b, i) => {
                const cross = b.from_object_type_id !== b.to_object_type_id;
                return (
                  <tr key={i}>
                    <td style={td}>
                      <span style={{ ...chip, background: colorForObjectType(b.from_object_type_id, ots) + '22', color: colorForObjectType(b.from_object_type_id, ots) }}>{otName(b.from_object_type_id)}</span>
                      &nbsp;{b.from_activity || '∅'}
                    </td>
                    <td style={td}>
                      <span style={{ ...chip, background: colorForObjectType(b.to_object_type_id, ots) + '22', color: colorForObjectType(b.to_object_type_id, ots) }}>{otName(b.to_object_type_id)}</span>
                      &nbsp;{b.to_activity}
                    </td>
                    <td style={td}>{cross ? <span style={{ ...chip, background: T.dangerDim, color: T.danger }}>handoff</span> : ''}</td>
                    <td style={tdNum}>{b.case_count.toLocaleString()}</td>
                    <td style={tdNum}>{b.avg_hours}</td>
                    <td style={tdNum}>{b.p95_hours}</td>
                    <td style={tdNum}>{b.max_hours}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
};

// ── Cases tab ────────────────────────────────────────────────────────────────

const CasesPane: React.FC<{ process: Process; otName: (id: string | null | undefined) => string; filterCtx?: FilterCtx }> = ({ process, otName, filterCtx }) => {
  const [cases, setCases] = useState<ProcessCase[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState<'last_activity_at' | 'total_duration_days' | 'event_count' | 'days_since_last_activity'>('last_activity_at');
  const [sortDesc, setSortDesc] = useState(true);
  const [openCaseId, setOpenCaseId] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    getCases(process.id, 200).then((r) => setCases(r.cases)).finally(() => setLoading(false));
  }, [process.id]);

  if (loading) return <Loading />;
  const ots = process.included_object_type_ids;
  const activeFilter = filterCtx?.filter || [];
  const matchesFilter = (c: ProcessCase): boolean => {
    if (!activeFilter.length) return true;
    const stepKeys = new Set(c.steps.map((s) => `${s.object_type_id || ''}::${s.activity}`));
    return activeFilter.every((k) => stepKeys.has(k));
  };
  const filtered = cases.filter(matchesFilter).filter((c) => !search || c.case_id.toLowerCase().includes(search.toLowerCase()));
  const sorted = [...filtered].sort((a, b) => {
    const av = (a as any)[sortKey] || (sortKey === 'last_activity_at' ? '' : 0);
    const bv = (b as any)[sortKey] || (sortKey === 'last_activity_at' ? '' : 0);
    if (av < bv) return sortDesc ? 1 : -1;
    if (av > bv) return sortDesc ? -1 : 1;
    return 0;
  });

  const tHead = (k: typeof sortKey, label: string) => (
    <th style={{ ...th, cursor: 'pointer' }} onClick={() => {
      if (sortKey === k) setSortDesc(!sortDesc); else { setSortKey(k); setSortDesc(true); }
    }}>{label} {sortKey === k ? (sortDesc ? '↓' : '↑') : ''}</th>
  );

  return (
    <Card title={`${sorted.length} cases`} action={
      <input placeholder="Filter by case ID…" value={search} onChange={(e) => setSearch(e.target.value)}
        style={{ ...input, width: 220, padding: '4px 8px' }} />
    }>
      <div style={{ overflow: 'auto', maxHeight: 'calc(100vh - 260px)' }}>
        <table style={tableStyle}>
          <thead>
            <tr>
              <th style={th}>Case ID</th>
              <th style={th}>Spans</th>
              <th style={th}>Current activity</th>
              {tHead('event_count', 'Events')}
              {tHead('total_duration_days', 'Duration (d)')}
              {tHead('days_since_last_activity', 'Idle (d)')}
              <th style={th}>State</th>
              {tHead('last_activity_at', 'Last activity')}
            </tr>
          </thead>
          <tbody>
            {sorted.map((c) => (
              <tr key={c.case_id} style={{ cursor: 'pointer' }} onClick={() => setOpenCaseId(c.case_id)}>
                <td style={td}><code>{c.case_id}</code></td>
                <td style={td}>
                  <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
                    {c.object_types.map((ot) => (
                      <span key={ot} style={{ ...chip, background: colorForObjectType(ot, ots) + '22', color: colorForObjectType(ot, ots) }}>{otName(ot)}</span>
                    ))}
                  </div>
                </td>
                <td style={td}>{c.current_activity}</td>
                <td style={tdNum}>{c.event_count}</td>
                <td style={tdNum}>{c.total_duration_days}</td>
                <td style={tdNum}>{c.days_since_last_activity}</td>
                <td style={td}>
                  <span style={{ ...chip, background: c.state === 'stuck' ? T.dangerDim : T.successDim, color: c.state === 'stuck' ? T.danger : T.success }}>{c.state}</span>
                </td>
                <td style={td}>{c.last_activity_at ? new Date(c.last_activity_at).toLocaleString() : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {openCaseId && (
        <CaseDetail processId={process.id} caseId={openCaseId} onClose={() => setOpenCaseId(null)} ots={ots} otName={otName} />
      )}
    </Card>
  );
};

const CaseDetail: React.FC<{
  processId: string; caseId: string; onClose: () => void;
  ots: string[]; otName: (id: string | null | undefined) => string;
}> = ({ processId, caseId, onClose, ots, otName }) => {
  const [events, setEvents] = useState<CaseTimelineEvent[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    setLoading(true);
    getCaseTimeline(processId, caseId).then((r) => setEvents(r.events)).finally(() => setLoading(false));
  }, [processId, caseId]);

  return (
    <div style={overlay} onClick={onClose}>
      <div style={modal} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', padding: '12px 16px', borderBottom: `1px solid ${T.border}` }}>
          <div style={{ fontSize: 14, fontWeight: 600 }}>Case <code>{caseId}</code> timeline</div>
          <button onClick={onClose} style={btnGhost}>Close</button>
        </div>
        <div style={{ padding: 16, maxHeight: '70vh', overflow: 'auto' }}>
          {loading ? <Loading /> : (
            <table style={tableStyle}>
              <thead>
                <tr>
                  <th style={th}>#</th>
                  <th style={th}>Activity</th>
                  <th style={th}>Object</th>
                  <th style={th}>Timestamp</th>
                  <th style={thNum}>Δh</th>
                </tr>
              </thead>
              <tbody>
                {events.map((e, i) => (
                  <tr key={e.id}>
                    <td style={td}>{i + 1}</td>
                    <td style={td}>{e.activity}</td>
                    <td style={td}>
                      <span style={{ ...chip, background: colorForObjectType(e.object_type_id, ots) + '22', color: colorForObjectType(e.object_type_id, ots) }}>{otName(e.object_type_id)}</span>
                    </td>
                    <td style={td}>{new Date(e.timestamp).toLocaleString()}</td>
                    <td style={tdNum}>{e.duration_since_prev_hours ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
};

// ── Definition tab ───────────────────────────────────────────────────────────

const DefinitionPane: React.FC<{
  process: Process;
  objectTypes: { id: string; name: string }[];
  onSaved: () => void;
}> = ({ process, objectTypes, onSaved }) => {
  const [name, setName] = useState(process.name);
  const [desc, setDesc] = useState(process.description || '');
  const [caseKey, setCaseKey] = useState(process.case_key_attribute || '');
  const [otIds, setOtIds] = useState<string[]>(process.included_object_type_ids);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  useEffect(() => {
    setName(process.name);
    setDesc(process.description || '');
    setCaseKey(process.case_key_attribute || '');
    setOtIds(process.included_object_type_ids);
    setMsg('');
  }, [process.id]);

  const save = async () => {
    setBusy(true);
    try {
      await updateProcess(process.id, {
        name, description: desc || null,
        case_key_attribute: caseKey || null,
        included_object_type_ids: otIds,
      });
      onSaved();
      setMsg('Saved.');
    } catch (e) { setMsg(`Error: ${e}`); }
    finally { setBusy(false); }
  };

  const backfill = async () => {
    setBusy(true);
    try {
      const r = await backfillProcess(process.id);
      setMsg(`Backfilled: ${r.events_updated} events updated, ${r.cases_after} cases now exist`);
    } catch (e) { setMsg(`Error: ${e}`); }
    finally { setBusy(false); }
  };

  return (
    <Card title="Process Definition">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 720 }}>
        {process.is_implicit && (
          <div style={{ padding: 8, fontSize: 11, color: T.warning, background: T.warningDim, borderRadius: 2 }}>
            This is an auto-generated implicit process for a single object type.
            Saving makes it explicit (it will no longer be auto-regenerated).
          </div>
        )}
        <Field label="Name"><input style={input} value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="Description"><textarea style={{ ...input, minHeight: 60 }} value={desc} onChange={(e) => setDesc(e.target.value)} /></Field>
        <Field label="Case key attribute (record_snapshot field that joins objects)">
          <input style={input} value={caseKey} onChange={(e) => setCaseKey(e.target.value)} placeholder="e.g. patient_mrn or loan_id" />
        </Field>
        <Field label="Included object types">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 240, overflow: 'auto', border: `1px solid ${T.border}`, padding: 8, borderRadius: 4 }}>
            {objectTypes.map((ot) => (
              <label key={ot.id} style={{ fontSize: 12, display: 'flex', gap: 6, alignItems: 'center' }}>
                <input type="checkbox" checked={otIds.includes(ot.id)}
                  onChange={(e) => setOtIds(e.target.checked ? [...otIds, ot.id] : otIds.filter((x) => x !== ot.id))} />
                {ot.name}
              </label>
            ))}
          </div>
        </Field>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={save} style={btnPrimary} disabled={busy}>Save</button>
          {caseKey && <button onClick={backfill} style={btnGhost} disabled={busy}>Backfill case_key on historical events</button>}
          <span style={{ fontSize: 11, color: T.textMuted, alignSelf: 'center' }}>{msg}</span>
        </div>
      </div>
    </Card>
  );
};

// ── Process Manager Modal ────────────────────────────────────────────────────

const ProcessManagerModal: React.FC<{
  processes: Process[];
  objectTypes: { id: string; name: string }[];
  onClose: () => void;
  onChanged: () => void;
}> = ({ processes, objectTypes, onClose, onChanged }) => {
  const [tab, setTab] = useState<'create' | 'discover'>('create');
  const [suggestions, setSuggestions] = useState<DiscoverySuggestion[]>([]);
  const [loadingDiscover, setLoadingDiscover] = useState(false);
  const [name, setName] = useState('');
  const [desc, setDesc] = useState('');
  const [caseKey, setCaseKey] = useState('');
  const [otIds, setOtIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  const discover = async () => {
    setLoadingDiscover(true);
    try {
      const r = await autoDiscover();
      setSuggestions(r.suggestions);
    } finally { setLoadingDiscover(false); }
  };

  const create = async (preset?: DiscoverySuggestion) => {
    setBusy(true); setMsg('');
    try {
      const body: Partial<Process> = preset ? {
        name: preset.suggested_name,
        case_key_attribute: preset.case_key_attribute,
        included_object_type_ids: preset.included_object_type_ids,
      } : {
        name, description: desc || undefined,
        case_key_attribute: caseKey || undefined,
        included_object_type_ids: otIds,
      };
      await createProcess(body);
      setMsg('Created.');
      onChanged();
    } catch (e) { setMsg(`Error: ${e}`); }
    finally { setBusy(false); }
  };

  const remove = async (id: string) => {
    if (!confirm('Delete this process?')) return;
    await deleteProcess(id);
    onChanged();
  };

  const otName = (id: string) => objectTypes.find((o) => o.id === id)?.name || id.slice(0, 8);

  return (
    <div style={overlay} onClick={onClose}>
      <div style={{ ...modal, width: 760 }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', padding: '12px 16px', borderBottom: `1px solid ${T.border}` }}>
          <div style={{ fontSize: 14, fontWeight: 600 }}>Manage Processes</div>
          <button onClick={onClose} style={btnGhost}>Close</button>
        </div>
        <div style={{ padding: 16, maxHeight: '75vh', overflow: 'auto' }}>
          <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
            <button style={tab === 'create' ? btnPrimary : btnGhost} onClick={() => setTab('create')}>Create</button>
            <button style={tab === 'discover' ? btnPrimary : btnGhost} onClick={() => setTab('discover')}>Auto-discover</button>
          </div>

          {tab === 'create' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <Field label="Name"><input style={input} value={name} onChange={(e) => setName(e.target.value)} /></Field>
              <Field label="Description"><input style={input} value={desc} onChange={(e) => setDesc(e.target.value)} /></Field>
              <Field label="Case key attribute"><input style={input} value={caseKey} onChange={(e) => setCaseKey(e.target.value)} placeholder="e.g. patient_mrn" /></Field>
              <Field label="Included object types">
                <div style={{ display: 'flex', flexDirection: 'column', maxHeight: 240, overflow: 'auto', border: `1px solid ${T.border}`, padding: 8, borderRadius: 4, gap: 4 }}>
                  {objectTypes.map((ot) => (
                    <label key={ot.id} style={{ fontSize: 12, display: 'flex', gap: 6, alignItems: 'center' }}>
                      <input type="checkbox" checked={otIds.includes(ot.id)}
                        onChange={(e) => setOtIds(e.target.checked ? [...otIds, ot.id] : otIds.filter((x) => x !== ot.id))} />
                      {ot.name}
                    </label>
                  ))}
                </div>
              </Field>
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={() => create()} style={btnPrimary} disabled={busy || !name || !otIds.length}>Create</button>
                <span style={{ fontSize: 11, color: T.textMuted, alignSelf: 'center' }}>{msg}</span>
              </div>
            </div>
          )}

          {tab === 'discover' && (
            <div>
              <button onClick={discover} style={btnPrimary} disabled={loadingDiscover}>
                {loadingDiscover ? 'Scanning…' : 'Scan event log'}
              </button>
              {suggestions.length > 0 && (
                <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {suggestions.map((s, i) => (
                    <div key={i} style={{ border: `1px solid ${T.border}`, padding: 10, borderRadius: 4, background: T.surface }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                        <div style={{ fontSize: 13, fontWeight: 600 }}>{s.case_key_attribute}</div>
                        <div style={{ fontSize: 11, color: T.textMuted }}>conf {(s.confidence * 100).toFixed(0)}% · {s.candidate_case_count} cases</div>
                      </div>
                      <div style={{ fontSize: 11, color: T.textMuted, marginTop: 2 }}>
                        {s.included_object_type_ids.map(otName).join(' + ')}
                      </div>
                      <div style={{ fontSize: 11, color: T.textSubtle, marginTop: 4 }}>{s.rationale}</div>
                      <div style={{ marginTop: 8, display: 'flex', gap: 6 }}>
                        <button onClick={() => create(s)} style={btnPrimary} disabled={busy}>Create as process</button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          <div style={{ marginTop: 24 }}>
            <div style={{ fontSize: 12, color: T.textMuted, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>Existing</div>
            <table style={tableStyle}>
              <thead><tr><th style={th}>Name</th><th style={th}>Type</th><th style={th}>Object types</th><th></th></tr></thead>
              <tbody>
                {processes.map((p) => (
                  <tr key={p.id}>
                    <td style={td}>{p.name}</td>
                    <td style={td}>{p.is_implicit ? 'implicit' : 'defined'}</td>
                    <td style={td}>{p.included_object_type_ids.map(otName).join(', ')}</td>
                    <td style={td}>{!p.is_implicit && <button onClick={() => remove(p.id)} style={btnGhost}>Delete</button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
};

// ── Bits ─────────────────────────────────────────────────────────────────────

const Card: React.FC<{ title: string; children: React.ReactNode; action?: React.ReactNode; style?: React.CSSProperties }> = ({ title, children, action, style }) => (
  <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 6, ...style }}>
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '10px 14px', borderBottom: `1px solid ${T.border}`,
    }}>
      <div style={{ fontSize: 13, fontWeight: 500, color: T.text }}>{title}</div>
      {action}
    </div>
    <div style={{ padding: 14 }}>{children}</div>
  </div>
);

const Stat: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', padding: '6px 0', borderBottom: `1px dashed ${T.border}` }}>
    <span style={{ fontSize: 12, color: T.textMuted }}>{label}</span>
    <span style={{ fontSize: 13, fontWeight: 600, fontFamily: T.mono, color: T.text, fontVariantNumeric: 'tabular-nums' }}>{value}</span>
  </div>
);

const Field: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div>
    <div style={{ fontSize: 12, color: T.textMuted, marginBottom: 5, fontWeight: 500 }}>{label}</div>
    {children}
  </div>
);

const Toggle: React.FC<{ label: string; options: string[]; value: string; onChange: (v: string) => void }> = ({ label, options, value, onChange }) => (
  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
    <span style={muted}>{label}</span>
    <div style={{ display: 'inline-flex', border: `1px solid ${T.border}`, borderRadius: 4, overflow: 'hidden', background: T.surface }}>
      {options.map((opt) => (
        <button key={opt} onClick={() => onChange(opt)} style={{
          padding: '5px 12px', fontSize: 12,
          background: value === opt ? T.accentDim : 'transparent',
          color: value === opt ? T.accentText : T.textMuted,
          border: 'none', cursor: 'pointer',
          fontWeight: value === opt ? 500 : 400,
        }}>{opt.replace('_', ' ')}</button>
      ))}
    </div>
  </div>
);

const tableStyle: React.CSSProperties = { width: '100%', borderCollapse: 'collapse', fontSize: 12, color: T.text };
const th: React.CSSProperties = {
  textAlign: 'left', padding: '8px 10px', borderBottom: `1px solid ${T.border}`,
  color: T.textMuted, fontWeight: 500, fontSize: 11,
  background: T.surfaceCol,
  position: 'sticky', top: 0,
};
const thNum: React.CSSProperties = { ...th, textAlign: 'right' };
const td: React.CSSProperties = { padding: '8px 10px', borderBottom: `1px solid ${T.borderSoft}`, color: T.text, fontSize: 12 };
const tdNum: React.CSSProperties = { ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontFamily: T.mono };
const chip: React.CSSProperties = { fontSize: 11, padding: '2px 7px', borderRadius: 3, fontWeight: 500 };
const badge: React.CSSProperties = { fontSize: 10, fontWeight: 600, padding: '1px 6px', borderRadius: 2, marginRight: 4, marginTop: 4, display: 'inline-block' };
const input: React.CSSProperties = { padding: '6px 10px', fontSize: 13, border: `1px solid ${T.border}`, borderRadius: 4, width: '100%', boxSizing: 'border-box', background: T.surface, color: T.text, outline: 'none' };
const btnPrimary: React.CSSProperties = { padding: '6px 12px', fontSize: 13, background: T.accent, color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer', fontWeight: 500 };
const btnGhost: React.CSSProperties = { padding: '6px 12px', fontSize: 13, background: T.surface, color: T.textMuted, border: `1px solid ${T.border}`, borderRadius: 4, cursor: 'pointer', fontWeight: 400 };
const overlay: React.CSSProperties = { position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 };
const modal: React.CSSProperties = { background: T.surface, border: `1px solid ${T.border}`, borderRadius: 8, width: 1000, maxWidth: '95vw', boxShadow: '0 10px 40px rgba(0,0,0,0.15)' };
const muted: React.CSSProperties = { fontSize: 12, color: T.textMuted };
const mutedNote: React.CSSProperties = { fontSize: 12, color: T.textSubtle, padding: 24, textAlign: 'center' };

export default ProcessMiningV2;
