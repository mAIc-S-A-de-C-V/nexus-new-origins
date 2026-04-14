import React, { useState } from 'react';
import {
  X, Database, GitBranch, ArrowRight, ChevronDown, ChevronUp,
  Network, Layers,
} from 'lucide-react';
import { TypeNode, RecordNode, GraphEdge, GraphMode, useGraphStore } from '../../store/graphStore';
import { typeColor } from './ObjectNode';

const C = {
  bg: '#F8FAFC',
  panel: '#FFFFFF',
  border: '#E2E8F0',
  accent: '#7C3AED',
  accentLight: '#EDE9FE',
  text: '#0D1117',
  muted: '#64748B',
  subtle: '#94A3B8',
};

// ── Type detail panel ─────────────────────────────────────────────────────────

interface TypeDetailProps {
  node: TypeNode;
  outEdges: GraphEdge[];
  inEdges: GraphEdge[];
  allNodes: TypeNode[];
  onOpenRecords: (typeId: string) => void;
  onClose: () => void;
}

const TypeDetailPanel: React.FC<TypeDetailProps> = ({
  node, outEdges, inEdges, allNodes, onOpenRecords, onClose,
}) => {
  const colors = typeColor(node.id);
  const [showAllProps, setShowAllProps] = useState(false);
  const displayProps = showAllProps ? node.properties : node.properties.slice(0, 8);

  const findTypeName = (id: string) =>
    allNodes.find((n) => n.id === id)?.display_name || id.slice(0, 8);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Header */}
      <div
        style={{
          padding: '12px 14px',
          backgroundColor: colors.badge,
          display: 'flex',
          alignItems: 'center',
          gap: 8,
        }}
      >
        <div
          style={{
            width: 28,
            height: 28,
            borderRadius: 6,
            backgroundColor: 'rgba(255,255,255,0.2)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 13,
            fontWeight: 800,
            color: '#fff',
            flexShrink: 0,
          }}
        >
          {node.display_name.charAt(0).toUpperCase()}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {node.display_name}
          </div>
          <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.75)' }}>
            v{node.version} · {node.record_count.toLocaleString()} records
          </div>
        </div>
        <button
          onClick={onClose}
          style={{
            width: 24, height: 24, borderRadius: 4, border: 'none',
            backgroundColor: 'rgba(255,255,255,0.15)', cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', flexShrink: 0,
          }}
        >
          <X size={13} />
        </button>
      </div>

      {/* Body */}
      <div style={{ flex: 1, overflowY: 'auto', padding: 14 }}>

        {node.description && (
          <p style={{ fontSize: 12, color: C.muted, marginBottom: 14, lineHeight: 1.5 }}>
            {node.description}
          </p>
        )}

        {/* Stat row */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
          <div style={{ flex: 1, padding: '8px 10px', backgroundColor: C.bg, borderRadius: 6, border: `1px solid ${C.border}` }}>
            <div style={{ fontSize: 18, fontWeight: 700, color: C.text }}>{node.record_count.toLocaleString()}</div>
            <div style={{ fontSize: 10, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Records</div>
          </div>
          <div style={{ flex: 1, padding: '8px 10px', backgroundColor: C.bg, borderRadius: 6, border: `1px solid ${C.border}` }}>
            <div style={{ fontSize: 18, fontWeight: 700, color: C.text }}>{node.properties.length}</div>
            <div style={{ fontSize: 10, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Properties</div>
          </div>
        </div>

        {/* Properties */}
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 10, fontWeight: 600, color: C.subtle, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>
            Properties
          </div>
          {displayProps.map((p) => (
            <div key={p.name} style={{ display: 'flex', gap: 6, padding: '3px 0', borderBottom: `1px solid ${C.bg}` }}>
              <span style={{ fontSize: 11, color: C.text, flex: 1, fontFamily: 'var(--font-mono, monospace)' }}>
                {p.name}
              </span>
              <span style={{ fontSize: 10, color: C.subtle, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                {p.data_type}
              </span>
            </div>
          ))}
          {node.properties.length > 8 && (
            <button
              onClick={() => setShowAllProps((v) => !v)}
              style={{ marginTop: 4, fontSize: 11, color: C.accent, background: 'none', border: 'none', cursor: 'pointer', padding: 0, display: 'flex', alignItems: 'center', gap: 3 }}
            >
              {showAllProps ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
              {showAllProps ? 'Show less' : `Show ${node.properties.length - 8} more`}
            </button>
          )}
        </div>

        {/* Links */}
        {(outEdges.length > 0 || inEdges.length > 0) && (
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 10, fontWeight: 600, color: C.subtle, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>
              Links
            </div>
            {outEdges.map((e) => (
              <div key={e.id} style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '4px 0', borderBottom: `1px solid ${C.bg}` }}>
                <ArrowRight size={11} color={colors.badge} />
                <span style={{ fontSize: 11, color: C.muted, flex: 1 }}>{findTypeName(e.target)}</span>
                <span style={{ fontSize: 9, color: C.subtle, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  {e.relationship_type}
                </span>
              </div>
            ))}
            {inEdges.map((e) => (
              <div key={e.id} style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '4px 0', borderBottom: `1px solid ${C.bg}` }}>
                <ArrowRight size={11} color={C.subtle} style={{ transform: 'rotate(180deg)' }} />
                <span style={{ fontSize: 11, color: C.muted, flex: 1 }}>{findTypeName(e.source)}</span>
                <span style={{ fontSize: 9, color: C.subtle, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  {e.relationship_type}
                </span>
              </div>
            ))}
          </div>
        )}

        {/* CTA */}
        <button
          onClick={() => onOpenRecords(node.id)}
          style={{
            width: '100%', height: 34, display: 'flex', alignItems: 'center', justifyContent: 'center',
            gap: 6, backgroundColor: C.accent, border: 'none', borderRadius: 6,
            cursor: 'pointer', fontSize: 12, fontWeight: 600, color: '#fff',
          }}
        >
          <Layers size={13} />
          Explore Records in Graph
        </button>
      </div>
    </div>
  );
};


// ── Record detail panel ───────────────────────────────────────────────────────

interface RecordDetailProps {
  node: RecordNode;
  outEdges: GraphEdge[];
  allTypeNodes: TypeNode[];
  onExpand: (recordId: string, targetTypeId: string, linkId: string) => void;
  onClose: () => void;
}

const RecordDetailPanel: React.FC<RecordDetailProps> = ({
  node, outEdges, allTypeNodes, onExpand, onClose,
}) => {
  const colors = typeColor(node.object_type_id);
  const entries = Object.entries(node.data).filter(([k]) => !k.startsWith('_'));

  const findTypeName = (id: string) =>
    allTypeNodes.find((n) => n.id === id)?.display_name || id.slice(0, 8);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Header */}
      <div style={{ padding: '10px 14px', backgroundColor: colors.bg, borderBottom: `1px solid ${colors.border}`, display: 'flex', alignItems: 'center', gap: 8 }}>
        <Database size={14} color={colors.badge} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: colors.text }}>{node.type_name}</div>
          <div style={{ fontSize: 9, color: C.subtle, fontFamily: 'var(--font-mono, monospace)' }}>
            {node.id.slice(0, 16)}…
          </div>
        </div>
        <button
          onClick={onClose}
          style={{ width: 24, height: 24, borderRadius: 4, border: `1px solid ${colors.border}`, backgroundColor: 'transparent', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.muted, flexShrink: 0 }}
        >
          <X size={13} />
        </button>
      </div>

      {/* Fields */}
      <div style={{ flex: 1, overflowY: 'auto', padding: 14 }}>
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 10, fontWeight: 600, color: C.subtle, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>
            Record Data
          </div>
          {entries.map(([k, v]) => (
            <div key={k} style={{ display: 'flex', flexDirection: 'column', gap: 1, padding: '5px 0', borderBottom: `1px solid ${C.bg}` }}>
              <span style={{ fontSize: 9, fontWeight: 600, color: C.subtle, textTransform: 'uppercase', letterSpacing: '0.04em', fontFamily: 'var(--font-mono, monospace)' }}>
                {k}
              </span>
              <span style={{ fontSize: 12, color: C.text, wordBreak: 'break-all', lineHeight: 1.4 }}>
                {v == null ? <span style={{ color: C.subtle, fontStyle: 'italic' }}>null</span> : String(v)}
              </span>
            </div>
          ))}
          {entries.length === 0 && (
            <div style={{ fontSize: 12, color: C.subtle, fontStyle: 'italic' }}>No data</div>
          )}
        </div>

        {/* Expand via links */}
        {outEdges.length > 0 && (
          <div>
            <div style={{ fontSize: 10, fontWeight: 600, color: C.subtle, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>
              Expand Via
            </div>
            {outEdges.map((e) => (
              <button
                key={e.id}
                onClick={() => onExpand(node.id, e.target, e.link_id || e.id)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  width: '100%', padding: '7px 10px', marginBottom: 4,
                  backgroundColor: C.bg, border: `1px solid ${C.border}`,
                  borderRadius: 6, cursor: 'pointer', textAlign: 'left',
                  transition: 'all 80ms',
                }}
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLElement).style.backgroundColor = C.accentLight;
                  (e.currentTarget as HTMLElement).style.borderColor = '#DDD6FE';
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLElement).style.backgroundColor = C.bg;
                  (e.currentTarget as HTMLElement).style.borderColor = C.border;
                }}
              >
                <GitBranch size={12} color={colors.badge} />
                <span style={{ fontSize: 11, color: C.text, flex: 1 }}>
                  {findTypeName(e.target)}
                </span>
                <span style={{ fontSize: 9, color: C.subtle, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  {e.relationship_type}
                </span>
                <ArrowRight size={11} color={C.subtle} />
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};


// ── Main detail panel ─────────────────────────────────────────────────────────

interface GraphDetailPanelProps {
  mode: GraphMode;
  selectedNodeId: string | null;
  typeNodes: TypeNode[];
  typeEdges: GraphEdge[];
  recordNodes: RecordNode[];
  recordEdges: GraphEdge[];
  onOpenRecords: (typeId: string) => void;
  onExpand: (recordId: string, targetTypeId: string, linkId: string) => void;
  onClose: () => void;
}

export const GraphDetailPanel: React.FC<GraphDetailPanelProps> = ({
  mode, selectedNodeId, typeNodes, typeEdges, recordNodes, recordEdges,
  onOpenRecords, onExpand, onClose,
}) => {
  if (!selectedNodeId) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 8, color: C.subtle }}>
        <Network size={28} color={C.border} />
        <div style={{ fontSize: 12, fontWeight: 500 }}>Select a node</div>
        <div style={{ fontSize: 11 }}>Click any node to inspect it</div>
      </div>
    );
  }

  if (mode === 'type_overview') {
    const node = typeNodes.find((n) => n.id === selectedNodeId);
    if (!node) return null;
    const outEdges = typeEdges.filter((e) => e.source === selectedNodeId);
    const inEdges = typeEdges.filter((e) => e.target === selectedNodeId);
    return (
      <TypeDetailPanel
        node={node}
        outEdges={outEdges}
        inEdges={inEdges}
        allNodes={typeNodes}
        onOpenRecords={onOpenRecords}
        onClose={onClose}
      />
    );
  }

  // Record focus mode
  const recordNode = recordNodes.find((n) => n.id === selectedNodeId);
  if (!recordNode) return null;

  // Find outgoing edges from this record and resolve which type they point to
  const outEdges = recordEdges.filter((e) => e.source === selectedNodeId);

  // Map edge target record IDs to their type IDs
  const enrichedEdges = outEdges.map((e) => {
    const targetRecord = recordNodes.find((n) => n.id === e.target);
    return {
      ...e,
      target: targetRecord?.object_type_id || e.target,
    };
  });

  return (
    <RecordDetailPanel
      node={recordNode}
      outEdges={enrichedEdges}
      allTypeNodes={typeNodes}
      onExpand={onExpand}
      onClose={onClose}
    />
  );
};
