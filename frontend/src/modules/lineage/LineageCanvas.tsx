import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  ReactFlow, Background, Controls, MiniMap, BackgroundVariant,
  useNodesState, useEdgesState, Panel,
  type Node, type Edge, type NodeProps,
  MarkerType, Position, Handle,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import {
  RefreshCw, Search, X, ChevronRight, AlertTriangle,
  Zap, Database, GitBranch, Bot, Play, ArrowUpRight,
  Activity, Filter, Loader2, Link2,
} from 'lucide-react';
import { getTenantId } from '../../store/authStore';

const LINEAGE_API = import.meta.env.VITE_LINEAGE_SERVICE_URL || 'http://localhost:8017';

// ── Theme ─────────────────────────────────────────────────────────────────────
const C = {
  bg: '#F8FAFC', panel: '#FFFFFF', border: '#E2E8F0',
  accent: '#7C3AED', accentLight: '#EDE9FE',
  text: '#0D1117', muted: '#64748B', subtle: '#94A3B8',
  hover: '#F1F5F9',
  // Node type colors
  connector:    { bg: '#ECFEFF', border: '#06B6D4', icon: '#0891B2', text: '#164E63' },
  pipeline:     { bg: '#F5F3FF', border: '#8B5CF6', icon: '#7C3AED', text: '#4C1D95' },
  object_type:  { bg: '#F0FDF4', border: '#22C55E', icon: '#16A34A', text: '#14532D' },
  logic_function: { bg: '#FFFBEB', border: '#F59E0B', icon: '#D97706', text: '#78350F' },
  agent:        { bg: '#FFF1F2', border: '#FB7185', icon: '#E11D48', text: '#881337' },
  action:       { bg: '#EFF6FF', border: '#3B82F6', icon: '#2563EB', text: '#1E3A8A' },
};

const TYPE_LABELS: Record<string, string> = {
  connector: 'Connector',
  pipeline: 'Pipeline',
  object_type: 'Object Type',
  logic_function: 'Logic Function',
  agent: 'Agent',
  action: 'Action',
};

const TYPE_ICONS: Record<string, React.ReactNode> = {
  connector: <Link2 size={13} />,
  pipeline: <GitBranch size={13} />,
  object_type: <Database size={13} />,
  logic_function: <Zap size={13} />,
  agent: <Bot size={13} />,
  action: <Play size={13} />,
};

// ── Custom Node Components ─────────────────────────────────────────────────────

interface LineageNodeData extends Record<string, unknown> {
  label: string;
  type: string;
  status?: string;
  meta?: Record<string, unknown>;
  health?: { status: string; stale?: boolean; last_activity?: string; age_hours?: number };
  highlighted?: boolean;
  dimmed?: boolean;
  impacted?: boolean;
}

const LineageNode: React.FC<NodeProps> = ({ data, selected }) => {
  const d = data as LineageNodeData;
  const colors = C[d.type as keyof typeof C] as typeof C.connector || C.connector;
  const isStale = d.health?.stale;
  const isDisabled = d.status === 'disabled';
  const isImpacted = d.impacted;
  const isDimmed = d.dimmed && !selected;

  const borderColor = isImpacted ? '#F97316' : selected ? C.accent : isStale ? '#F97316' : colors.border;
  const bgColor = isImpacted ? '#FFF7ED' : colors.bg;
  const opacity = isDimmed ? 0.35 : 1;

  return (
    <div style={{
      width: 180, padding: '8px 10px',
      backgroundColor: bgColor,
      border: `2px solid ${borderColor}`,
      borderRadius: 8,
      boxShadow: selected ? `0 0 0 3px ${C.accentLight}` : '0 1px 4px rgba(0,0,0,0.08)',
      opacity,
      transition: 'opacity 150ms, border-color 150ms',
      position: 'relative',
    }}>
      <Handle type="target" position={Position.Left} style={{ background: colors.border, width: 8, height: 8 }} />
      <Handle type="source" position={Position.Right} style={{ background: colors.border, width: 8, height: 8 }} />

      {/* Type badge */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 4 }}>
        <span style={{ color: colors.icon }}>{TYPE_ICONS[d.type]}</span>
        <span style={{ fontSize: 9, fontWeight: 700, color: colors.icon, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          {TYPE_LABELS[d.type] || d.type}
        </span>
        {(isStale || isDisabled) && (
          <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center' }}>
            <AlertTriangle size={10} color="#F97316" />
          </span>
        )}
        {isImpacted && (
          <span style={{ marginLeft: 'auto', fontSize: 9, color: '#F97316', fontWeight: 700 }}>IMPACTED</span>
        )}
      </div>

      {/* Label */}
      <div style={{
        fontSize: 12, fontWeight: 600, color: colors.text,
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        lineHeight: 1.3,
      }}>
        {d.label}
      </div>

      {/* Meta line */}
      {d.meta && (() => {
        const meta = d.meta;
        if (d.type === 'connector') return (
          <div style={{ fontSize: 10, color: C.muted, marginTop: 3 }}>
            {meta.type as string} · {meta.status as string}
            {meta.last_sync ? ` · synced ${_timeAgo(meta.last_sync as string)}` : ''}
          </div>
        );
        if (d.type === 'pipeline') return (
          <div style={{ fontSize: 10, color: C.muted, marginTop: 3 }}>
            {meta.status as string}
            {meta.last_run_at ? ` · ran ${_timeAgo(meta.last_run_at as string)}` : ''}
          </div>
        );
        if (d.type === 'object_type') return (
          <div style={{ fontSize: 10, color: C.muted, marginTop: 3 }}>
            {(meta.record_count as number) > 0 ? `${(meta.record_count as number).toLocaleString()} records` : 'no records'}
          </div>
        );
        if (d.type === 'logic_function') return (
          <div style={{ fontSize: 10, color: C.muted, marginTop: 3 }}>
            {meta.block_count as number} blocks
            {meta.last_run_at ? ` · ran ${_timeAgo(meta.last_run_at as string)}` : ''}
          </div>
        );
        if (d.type === 'agent') return (
          <div style={{ fontSize: 10, color: meta.enabled ? '#16A34A' : C.muted, marginTop: 3 }}>
            {meta.enabled ? 'Enabled' : 'Disabled'} · {meta.tool_count as number} tools
          </div>
        );
        if (d.type === 'action') return (
          <div style={{ fontSize: 10, color: C.muted, marginTop: 3 }}>
            {(meta.pending_count as number) > 0 ? `${meta.pending_count} pending` : 'no pending'}
          </div>
        );
        return null;
      })()}
    </div>
  );
};

const nodeTypes = { lineage: LineageNode };

// ── Helpers ───────────────────────────────────────────────────────────────────

function _timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 2) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

// Simple dagre-style layout using layer positions
const TYPE_ORDER = ['connector', 'pipeline', 'object_type', 'logic_function', 'agent', 'action'];
const LAYER_X: Record<string, number> = {
  connector: 80,
  pipeline: 320,
  object_type: 560,
  logic_function: 800,
  agent: 1040,
  action: 1280,
};
const NODE_HEIGHT = 80;
const V_GAP = 20;

function computeLayout(nodes: RawNode[]): { id: string; x: number; y: number }[] {
  // Group by type
  const byType: Record<string, RawNode[]> = {};
  for (const n of nodes) {
    byType[n.type] = byType[n.type] || [];
    byType[n.type].push(n);
  }

  const positions: { id: string; x: number; y: number }[] = [];
  for (const type of TYPE_ORDER) {
    const group = byType[type] || [];
    const x = LAYER_X[type] ?? 80;
    const totalH = group.length * (NODE_HEIGHT + V_GAP);
    const startY = -totalH / 2 + (NODE_HEIGHT + V_GAP) / 2;
    group.forEach((n, i) => {
      positions.push({ id: n.id, x, y: startY + i * (NODE_HEIGHT + V_GAP) });
    });
  }
  return positions;
}

interface RawNode {
  id: string;
  type: string;
  label: string;
  status?: string;
  meta?: Record<string, unknown>;
  health?: Record<string, unknown>;
}

interface RawEdge {
  id: string;
  source: string;
  target: string;
  label?: string;
  animated?: boolean;
}

function rawToFlow(rawNodes: RawNode[], rawEdges: RawEdge[]): { nodes: Node[]; edges: Edge[] } {
  const positions = computeLayout(rawNodes);
  const posMap = new Map(positions.map((p) => [p.id, p]));

  const nodes: Node[] = rawNodes.map((n) => ({
    id: n.id,
    type: 'lineage',
    position: posMap.get(n.id) ?? { x: 0, y: 0 },
    data: {
      label: n.label,
      type: n.type,
      status: n.status,
      meta: n.meta,
      health: n.health,
    },
  }));

  const edges: Edge[] = rawEdges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    label: e.label,
    animated: e.animated ?? false,
    markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14, color: '#94A3B8' },
    style: { stroke: '#CBD5E1', strokeWidth: 1.5 },
    labelStyle: { fontSize: 10, fill: '#94A3B8', fontWeight: 500 },
    labelBgStyle: { fill: '#F8FAFC', fillOpacity: 0.9 },
    labelBgPadding: [3, 6] as [number, number],
  }));

  return { nodes, edges };
}

// ── Detail Panel ──────────────────────────────────────────────────────────────

const DetailPanel: React.FC<{
  node: Node | null;
  impactData: { affected_count: number; by_type: Record<string, { id: string; label: string }[]> } | null;
  impactLoading: boolean;
  onClose: () => void;
  onImpact: (nodeId: string) => void;
  onNavigate: (type: string) => void;
}> = ({ node, impactData, impactLoading, onClose, onImpact, onNavigate }) => {
  if (!node) return null;
  const d = node.data as LineageNodeData;
  const colors = C[d.type as keyof typeof C] as typeof C.connector || C.connector;
  const meta = d.meta || {};

  const navMap: Record<string, string> = {
    connector: 'connectors',
    pipeline: 'pipelines',
    object_type: 'ontology',
    logic_function: 'logic',
    agent: 'agents',
    action: 'human-actions',
  };

  return (
    <div style={{
      position: 'absolute', top: 0, right: 0, width: 300, height: '100%',
      backgroundColor: C.panel, borderLeft: `1px solid ${C.border}`,
      display: 'flex', flexDirection: 'column', zIndex: 10,
      boxShadow: '-4px 0 16px rgba(0,0,0,0.06)',
    }}>
      {/* Header */}
      <div style={{
        padding: '12px 14px', borderBottom: `1px solid ${C.border}`,
        display: 'flex', alignItems: 'flex-start', gap: 8,
      }}>
        <div style={{
          width: 32, height: 32, borderRadius: 6,
          backgroundColor: colors.bg, border: `1px solid ${colors.border}`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: colors.icon, flexShrink: 0,
        }}>
          {TYPE_ICONS[d.type]}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: C.text, lineHeight: 1.3 }}>{d.label}</div>
          <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>{TYPE_LABELS[d.type]}</div>
        </div>
        <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.subtle, padding: 2 }}>
          <X size={14} />
        </button>
      </div>

      {/* Meta */}
      <div style={{ padding: '12px 14px', borderBottom: `1px solid ${C.border}`, display: 'flex', flexDirection: 'column', gap: 6 }}>
        {Object.entries(meta).map(([k, v]) => {
          if (v == null || v === '' || k === 'id') return null;
          const label = k.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
          const val = typeof v === 'boolean' ? (v ? 'Yes' : 'No') : String(v);
          return (
            <div key={k} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 12 }}>
              <span style={{ color: C.muted, flexShrink: 0 }}>{label}</span>
              <span style={{ color: C.text, fontWeight: 500, textAlign: 'right', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {val}
              </span>
            </div>
          );
        })}
        {d.health && (
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
            <span style={{ color: C.muted }}>Health</span>
            <span style={{
              fontWeight: 600,
              color: d.health.status === 'fresh' || d.health.status === 'ok' ? '#16A34A'
                   : d.health.status === 'stale' ? '#F97316'
                   : C.muted,
            }}>
              {d.health.status}
              {d.health.age_hours ? ` (${d.health.age_hours}h old)` : ''}
            </span>
          </div>
        )}
      </div>

      {/* Actions */}
      <div style={{ padding: '10px 14px', borderBottom: `1px solid ${C.border}`, display: 'flex', gap: 8 }}>
        <button
          onClick={() => onImpact(node.id)}
          disabled={impactLoading}
          style={{
            flex: 1, height: 30, fontSize: 11, fontWeight: 600, cursor: 'pointer',
            borderRadius: 5, border: `1px solid ${C.border}`,
            backgroundColor: C.panel, color: C.text,
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
          }}
        >
          {impactLoading ? <Loader2 size={11} style={{ animation: 'spin 0.8s linear infinite' }} /> : <Activity size={11} />}
          Impact Analysis
        </button>
        {navMap[d.type] && (
          <button
            onClick={() => onNavigate(navMap[d.type])}
            style={{
              flex: 1, height: 30, fontSize: 11, fontWeight: 600, cursor: 'pointer',
              borderRadius: 5, border: 'none',
              backgroundColor: C.accent, color: '#fff',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
            }}
          >
            Open <ArrowUpRight size={11} />
          </button>
        )}
      </div>

      {/* Impact results */}
      {impactData && (
        <div style={{ flex: 1, overflowY: 'auto', padding: '12px 14px' }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: C.text, marginBottom: 8 }}>
            Impact Analysis — {impactData.affected_count} downstream node{impactData.affected_count !== 1 ? 's' : ''} affected
          </div>
          {Object.entries(impactData.by_type).map(([type, nodes]) => (
            <div key={type} style={{ marginBottom: 10 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>
                {TYPE_LABELS[type] || type} ({nodes.length})
              </div>
              {nodes.map((n) => (
                <div key={n.id} style={{ fontSize: 12, color: '#F97316', marginBottom: 2, paddingLeft: 8 }}>
                  · {n.label}
                </div>
              ))}
            </div>
          ))}
          {impactData.affected_count === 0 && (
            <div style={{ fontSize: 12, color: C.muted, fontStyle: 'italic' }}>No downstream nodes — this is a leaf node.</div>
          )}
        </div>
      )}
    </div>
  );
};

// ── Legend ─────────────────────────────────────────────────────────────────────

const Legend: React.FC<{ visibleTypes: Set<string>; onToggle: (t: string) => void }> = ({ visibleTypes, onToggle }) => (
  <div style={{
    position: 'absolute', bottom: 16, left: 16,
    backgroundColor: C.panel, border: `1px solid ${C.border}`,
    borderRadius: 8, padding: '8px 12px', zIndex: 10,
    boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
  }}>
    <div style={{ fontSize: 10, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>
      Node Types
    </div>
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {TYPE_ORDER.map((type) => {
        const colors = C[type as keyof typeof C] as typeof C.connector;
        const active = visibleTypes.has(type);
        return (
          <button
            key={type}
            onClick={() => onToggle(type)}
            style={{
              display: 'flex', alignItems: 'center', gap: 6, padding: '2px 4px',
              borderRadius: 4, background: 'none', border: 'none', cursor: 'pointer',
              opacity: active ? 1 : 0.35, transition: 'opacity 120ms',
            }}
          >
            <div style={{ width: 10, height: 10, borderRadius: 2, backgroundColor: colors?.border || C.border, flexShrink: 0 }} />
            <span style={{ fontSize: 11, color: C.text }}>{TYPE_LABELS[type]}</span>
          </button>
        );
      })}
    </div>
  </div>
);

// ── Main Component ─────────────────────────────────────────────────────────────

export const LineageCanvas: React.FC = () => {
  const [nodes, setNodes, onNodesChange] = useNodesState<Node<LineageNodeData>>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [selectedNode, setSelectedNode] = useState<Node | null>(null);
  const [impactData, setImpactData] = useState<{ affected_count: number; by_type: Record<string, { id: string; label: string }[]> } | null>(null);
  const [impactLoading, setImpactLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [visibleTypes, setVisibleTypes] = useState<Set<string>>(new Set(TYPE_ORDER));
  const [withHealth, setWithHealth] = useState(false);
  const rawRef = useRef<{ nodes: RawNode[]; edges: RawEdge[] } | null>(null);

  // Import navigation
  const navigateTo = useCallback((page: string) => {
    // Dispatch a custom event that AppShell/NavRail picks up via navigationStore
    window.dispatchEvent(new CustomEvent('nexus:navigate', { detail: { page } }));
  }, []);

  const fetchGraph = useCallback(async (healthy = false) => {
    setLoading(true);
    setError(null);
    try {
      const endpoint = healthy ? '/lineage/graph/health' : '/lineage/graph';
      const resp = await fetch(`${LINEAGE_API}${endpoint}`, {
        headers: { 'x-tenant-id': getTenantId() },
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json();
      rawRef.current = { nodes: data.nodes, edges: data.edges };
      setCounts(data.counts || {});
      applyFilters(data.nodes, data.edges, search, visibleTypes);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [search, visibleTypes]);

  const applyFilters = useCallback((
    rawNodes: RawNode[],
    rawEdges: RawEdge[],
    q: string,
    visible: Set<string>,
  ) => {
    // Filter by type visibility
    let filteredNodes = rawNodes.filter((n) => visible.has(n.type));

    // Filter by search query
    if (q.trim()) {
      const ql = q.trim().toLowerCase();
      const matchingIds = new Set(
        filteredNodes.filter((n) => n.label.toLowerCase().includes(ql)).map((n) => n.id)
      );
      filteredNodes = filteredNodes.map((n) => ({
        ...n,
        _dimmed: !matchingIds.has(n.id),
      })) as RawNode[];
    }

    // Only keep edges where both source and target exist
    const nodeIds = new Set(filteredNodes.map((n) => n.id));
    const filteredEdges = rawEdges.filter((e) => nodeIds.has(e.source) && nodeIds.has(e.target));

    const { nodes: flowNodes, edges: flowEdges } = rawToFlow(filteredNodes, filteredEdges);
    // Apply dimmed state
    const finalNodes = flowNodes.map((fn, i) => ({
      ...fn,
      data: { ...fn.data, dimmed: (filteredNodes[i] as RawNode & { _dimmed?: boolean })._dimmed },
    })) as Node<LineageNodeData>[];

    setNodes(finalNodes);
    setEdges(flowEdges);
  }, []);

  useEffect(() => {
    fetchGraph(withHealth);
  }, [withHealth]);

  useEffect(() => {
    if (!rawRef.current) return;
    applyFilters(rawRef.current.nodes, rawRef.current.edges, search, visibleTypes);
  }, [search, visibleTypes]);

  const handleNodeClick = useCallback((_: React.MouseEvent, node: Node) => {
    setSelectedNode(node);
    setImpactData(null);
  }, []);

  const handleImpact = useCallback(async (nodeId: string) => {
    setImpactLoading(true);
    try {
      const resp = await fetch(`${LINEAGE_API}/lineage/impact/${encodeURIComponent(nodeId)}`, {
        headers: { 'x-tenant-id': getTenantId() },
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json();
      setImpactData(data);

      // Highlight impacted nodes on the canvas
      if (rawRef.current) {
        const affectedIds = new Set<string>(data.affected_nodes?.map((n: RawNode) => n.id) || []);
        setNodes((nds) => nds.map((n) => ({
          ...n,
          data: {
            ...n.data,
            impacted: affectedIds.has(n.id),
            dimmed: !affectedIds.has(n.id) && n.id !== nodeId,
          },
        })) as Node<LineageNodeData>[]);
      }
    } catch (e) {
      console.error('Impact analysis failed:', e);
    } finally {
      setImpactLoading(false);
    }
  }, []);

  const clearImpact = useCallback(() => {
    setImpactData(null);
    if (rawRef.current) {
      applyFilters(rawRef.current.nodes, rawRef.current.edges, search, visibleTypes);
    }
  }, [search, visibleTypes, applyFilters]);

  const toggleType = useCallback((type: string) => {
    setVisibleTypes((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type); else next.add(type);
      return next;
    });
  }, []);

  // Stats bar counts
  const totalNodes = Object.values(counts).reduce((a, b) => a + b, 0);
  const totalEdges = edges.length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', backgroundColor: C.bg }}>
      {/* Header */}
      <div style={{
        height: 52, backgroundColor: C.panel, borderBottom: `1px solid ${C.border}`,
        display: 'flex', alignItems: 'center', padding: '0 16px', gap: 12, flexShrink: 0,
      }}>
        <h1 style={{ fontSize: 15, fontWeight: 600, color: C.text, margin: 0 }}>Data Lineage</h1>

        {/* Stats chips */}
        {!loading && !error && (
          <div style={{ display: 'flex', gap: 6 }}>
            {Object.entries(counts).map(([type, count]) => {
              const colors = C[type as keyof typeof C] as typeof C.connector;
              return (
                <span key={type} style={{
                  fontSize: 11, padding: '2px 8px', borderRadius: 10,
                  backgroundColor: colors?.bg || C.hover,
                  color: colors?.icon || C.muted, fontWeight: 600, border: `1px solid ${colors?.border || C.border}`,
                }}>
                  {count} {TYPE_LABELS[type] || type}{count !== 1 ? 's' : ''}
                </span>
              );
            })}
          </div>
        )}

        <div style={{ flex: 1 }} />

        {/* Search */}
        <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
          <Search size={12} style={{ position: 'absolute', left: 8, color: C.subtle }} />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search nodes…"
            style={{
              paddingLeft: 26, paddingRight: search ? 24 : 8, height: 28, width: 180,
              border: `1px solid ${C.border}`, borderRadius: 5, fontSize: 12,
              backgroundColor: C.panel, color: C.text, outline: 'none',
            }}
          />
          {search && (
            <button onClick={() => setSearch('')} style={{ position: 'absolute', right: 6, background: 'none', border: 'none', cursor: 'pointer', color: C.subtle, padding: 0, display: 'flex' }}>
              <X size={12} />
            </button>
          )}
        </div>

        {/* Health toggle */}
        <button
          onClick={() => setWithHealth((v) => !v)}
          style={{
            display: 'flex', alignItems: 'center', gap: 5, padding: '0 10px', height: 28,
            border: `1px solid ${withHealth ? C.accent : C.border}`, borderRadius: 5,
            backgroundColor: withHealth ? C.accentLight : C.panel,
            color: withHealth ? C.accent : C.muted, fontSize: 12, fontWeight: 500, cursor: 'pointer',
          }}
        >
          <Activity size={12} /> Health
        </button>

        {/* Refresh */}
        <button
          onClick={() => fetchGraph(withHealth)}
          disabled={loading}
          style={{
            display: 'flex', alignItems: 'center', gap: 5, padding: '0 10px', height: 28,
            border: `1px solid ${C.border}`, borderRadius: 5,
            backgroundColor: C.panel, color: C.muted, fontSize: 12, cursor: 'pointer',
          }}
        >
          <RefreshCw size={12} style={{ animation: loading ? 'spin 0.8s linear infinite' : 'none' }} />
          Refresh
        </button>
      </div>

      {/* Canvas */}
      <div style={{ flex: 1, position: 'relative' }}>
        {loading && (
          <div style={{
            position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center', gap: 10, zIndex: 5,
            backgroundColor: C.bg,
          }}>
            <Loader2 size={24} color={C.accent} style={{ animation: 'spin 0.8s linear infinite' }} />
            <span style={{ fontSize: 13, color: C.muted }}>Building lineage graph…</span>
          </div>
        )}

        {error && !loading && (
          <div style={{
            position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center', gap: 8,
          }}>
            <AlertTriangle size={24} color="#F97316" />
            <span style={{ fontSize: 13, color: C.text, fontWeight: 500 }}>Failed to load lineage</span>
            <span style={{ fontSize: 12, color: C.muted }}>{error}</span>
            <button
              onClick={() => fetchGraph(withHealth)}
              style={{ marginTop: 8, padding: '6px 16px', borderRadius: 5, border: `1px solid ${C.border}`, backgroundColor: C.panel, color: C.text, fontSize: 12, cursor: 'pointer' }}
            >
              Retry
            </button>
          </div>
        )}

        {!loading && !error && nodes.length === 0 && (
          <div style={{
            position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center', gap: 8,
          }}>
            <Database size={32} color={C.border} />
            <span style={{ fontSize: 13, color: C.muted }}>No nodes found</span>
            <span style={{ fontSize: 12, color: C.subtle }}>Connect data sources and build pipelines to see the lineage graph</span>
          </div>
        )}

        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onNodeClick={handleNodeClick}
          onPaneClick={() => { setSelectedNode(null); clearImpact(); }}
          nodeTypes={nodeTypes}
          fitView
          fitViewOptions={{ padding: 0.2 }}
          minZoom={0.1}
          maxZoom={2}
          style={{ backgroundColor: C.bg }}
        >
          <Background variant={BackgroundVariant.Dots} gap={20} size={1} color={C.border} />
          <Controls />
          <MiniMap
            nodeColor={(n) => {
              const d = (n.data as unknown) as LineageNodeData;
              const colors = C[d.type as keyof typeof C] as typeof C.connector;
              return colors?.border || C.border;
            }}
            style={{ backgroundColor: C.panel, border: `1px solid ${C.border}` }}
          />
        </ReactFlow>

        <Legend visibleTypes={visibleTypes} onToggle={toggleType} />

        {/* Detail panel */}
        {selectedNode && (
          <DetailPanel
            node={selectedNode}
            impactData={impactData}
            impactLoading={impactLoading}
            onClose={() => { setSelectedNode(null); clearImpact(); }}
            onImpact={handleImpact}
            onNavigate={navigateTo}
          />
        )}
      </div>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
};

export default LineageCanvas;
