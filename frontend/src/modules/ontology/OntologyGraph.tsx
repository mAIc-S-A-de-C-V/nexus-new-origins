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
import { PipelineStepNode } from './PipelineStepNode';
import { ObjectTypePanel } from './ObjectTypePanel';
import { Button } from '../../design-system/components/Button';
import { useOntologyStore } from '../../store/ontologyStore';
import { useConnectorStore } from '../../store/connectorStore';
import { usePipelineStore } from '../../store/pipelineStore';
import { ObjectType } from '../../types/ontology';

function genId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return genId();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}

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
  pipelineStepNode: PipelineStepNode,
};

// Column x positions
const COL_CONNECTOR = 60;
const COL_STEP_START = 280; // first step x
const STEP_PITCH = 160;     // horizontal gap between steps
const ROW_GAP = 220;        // vertical gap between rows

const CONNECTOR_API = (import.meta.env.VITE_CONNECTOR_SERVICE_URL || 'http://localhost:8001');
const PIPELINE_API = (import.meta.env.VITE_PIPELINE_SERVICE_URL || 'http://localhost:8002');

function inferSemanticType(name: string, value: unknown): import('../../types/ontology').SemanticType {
  const n = name.toLowerCase();
  if (n === 'id' || n.endsWith('_id') || n.includes('object_id')) return 'IDENTIFIER';
  if (n.includes('email')) return 'EMAIL';
  if (n.includes('phone')) return 'PHONE';
  if (n.includes('date') || n.endsWith('_at') || n.includes('time') || n.includes('createdate')) return 'DATETIME';
  if (n.includes('amount') || n.includes('revenue') || n.includes('price') || n.includes('cost')) return 'CURRENCY';
  if (n.includes('status') || n.includes('stage') || n.includes('lifecycle')) return 'STATUS';
  if (n.includes('url') || n.includes('domain') || n.includes('website') || n.includes('link')) return 'URL';
  if (n.includes('name') || n.includes('firstname') || n.includes('lastname')) return 'PERSON_NAME';
  if (typeof value === 'boolean') return 'BOOLEAN';
  if (typeof value === 'number') return 'QUANTITY';
  return 'TEXT';
}

interface ConnectorField { name: string; sample: string; semanticType: import('../../types/ontology').SemanticType; }

// ── Step audit panel ──────────────────────────────────────────────────────────

interface SelectedStep {
  pipelineId: string;
  nodeId: string | null; // null for AUTH steps
  stepType: string;
  label: string;
  pipelineName: string;
}

interface NodeAuditData {
  node_id: string;
  node_type: string;
  node_label: string;
  rows_in: number;
  rows_out: number;
  dropped: number;
  duration_ms: number;
  started_at: string;
  sample_in: Record<string, unknown>[];
  sample_out: Record<string, unknown>[];
  stats: Record<string, unknown>;
}

const StepMiniTable: React.FC<{ rows: Record<string, unknown>[] }> = ({ rows }) => {
  if (!rows || rows.length === 0) return <div style={{ fontSize: 11, color: '#94A3B8', padding: '6px 0' }}>No sample data</div>;
  const cols = Array.from(new Set(rows.flatMap(r => Object.keys(r)))).slice(0, 6);
  return (
    <div style={{ overflowX: 'auto', marginTop: 4 }}>
      <table style={{ fontSize: 10, borderCollapse: 'collapse', width: '100%', minWidth: 'max-content' }}>
        <thead>
          <tr>
            {cols.map(c => (
              <th key={c} style={{ padding: '3px 6px', textAlign: 'left', color: '#94A3B8', fontWeight: 500, borderBottom: '1px solid #E2E8F0', whiteSpace: 'nowrap' }}>{c}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.slice(0, 3).map((row, i) => (
            <tr key={i} style={{ backgroundColor: i % 2 === 0 ? '#FFFFFF' : '#F8FAFC' }}>
              {cols.map(c => (
                <td key={c} style={{ padding: '3px 6px', color: '#374151', borderBottom: '1px solid #F1F5F9', maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {String(row[c] ?? '')}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

const StepAuditPanel: React.FC<{ step: SelectedStep; onClose: () => void }> = ({ step, onClose }) => {
  const [audit, setAudit] = useState<NodeAuditData | null>(null);
  const [loading, setLoading] = useState(true);
  const [noRun, setNoRun] = useState(false);
  const [sampleTab, setSampleTab] = useState<'in' | 'out'>('out');

  useEffect(() => {
    setLoading(true);
    setAudit(null);
    setNoRun(false);

    fetch(`${PIPELINE_API}/pipelines/${step.pipelineId}/runs`, { headers: { 'x-tenant-id': 'tenant-001' } })
      .then(r => r.json())
      .then(async (runs: { id: string; status: string }[]) => {
        const latest = runs.find(r => r.status === 'COMPLETED' || r.status === 'FAILED' || r.status === 'RUNNING');
        if (!latest) { setNoRun(true); setLoading(false); return; }
        const auditRes = await fetch(`${PIPELINE_API}/pipelines/${step.pipelineId}/runs/${latest.id}/audit`, { headers: { 'x-tenant-id': 'tenant-001' } });
        const data = await auditRes.json();
        const nodeAudits: Record<string, NodeAuditData> = data.node_audits || {};
        setAudit(step.nodeId ? (nodeAudits[step.nodeId] || null) : null);
        setLoading(false);
      })
      .catch(() => { setLoading(false); });
  }, [step.pipelineId, step.nodeId]);

  const color = NODE_TYPE_COLOR[step.stepType] || '#374151';

  return (
    <div style={{ width: 300, backgroundColor: '#FFFFFF', borderLeft: '1px solid #E2E8F0', display: 'flex', flexDirection: 'column', flexShrink: 0, overflow: 'hidden' }}>
      {/* Header */}
      <div style={{ backgroundColor: color, padding: '12px 14px', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
        <div>
          <div style={{ fontSize: 9, fontWeight: 700, color: 'rgba(255,255,255,0.65)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
            {step.stepType.replace('_', ' ')} · {step.pipelineName}
          </div>
          <div style={{ fontSize: 14, fontWeight: 600, color: '#FFFFFF', marginTop: 2 }}>{step.label}</div>
        </div>
        <button onClick={onClose} style={{ color: 'rgba(255,255,255,0.7)', background: 'none', border: 'none', cursor: 'pointer', padding: 2, marginTop: 1 }}>
          <X size={15} />
        </button>
      </div>

      {/* Body */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '14px' }}>
        {loading ? (
          <div style={{ fontSize: 12, color: '#94A3B8', padding: '20px 0', textAlign: 'center' }}>Loading audit data...</div>
        ) : noRun ? (
          <div style={{ fontSize: 12, color: '#94A3B8', padding: '20px 0', textAlign: 'center' }}>No pipeline runs yet</div>
        ) : !audit ? (
          <div style={{ fontSize: 12, color: '#94A3B8', padding: '20px 0', textAlign: 'center' }}>
            {step.nodeId === null ? 'Auth step — no row-level data' : 'No audit data for this step'}
          </div>
        ) : (
          <>
            {/* Row funnel */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 18, fontWeight: 700, color: '#1E3A5F', fontFamily: 'var(--font-mono)' }}>{audit.rows_in.toLocaleString()}</div>
                <div style={{ fontSize: 10, color: '#94A3B8', marginTop: 1 }}>rows in</div>
              </div>
              <div style={{ flex: 1, height: 1, backgroundColor: '#E2E8F0' }} />
              {audit.dropped > 0 && (
                <>
                  <div style={{ fontSize: 10, color: '#DC2626', fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap' }}>−{audit.dropped}</div>
                  <div style={{ flex: 1, height: 1, backgroundColor: '#E2E8F0' }} />
                </>
              )}
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 18, fontWeight: 700, color: '#059669', fontFamily: 'var(--font-mono)' }}>{audit.rows_out.toLocaleString()}</div>
                <div style={{ fontSize: 10, color: '#94A3B8', marginTop: 1 }}>rows out</div>
              </div>
            </div>

            {/* Duration */}
            <div style={{ fontSize: 11, color: '#94A3B8', marginBottom: 14 }}>
              <span style={{ color: '#64748B', fontFamily: 'var(--font-mono)' }}>{audit.duration_ms}ms</span>
              {' · '}
              {new Date(audit.started_at).toLocaleTimeString()}
            </div>

            {/* Stats */}
            {audit.stats && Object.keys(audit.stats).length > 0 && (
              <div style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: '#64748B', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Stats</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {Object.entries(audit.stats).map(([k, v]) => (
                    <div key={k} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11 }}>
                      <span style={{ color: '#94A3B8' }}>{k.replace(/_/g, ' ')}</span>
                      <span style={{ color: '#374151', fontFamily: 'var(--font-mono)' }}>{String(v)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Sample data */}
            <div>
              <div style={{ fontSize: 11, fontWeight: 600, color: '#64748B', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Sample Data</div>
              <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
                {(['in', 'out'] as const).map(t => (
                  <button key={t} onClick={() => setSampleTab(t)} style={{
                    fontSize: 11, padding: '2px 10px', borderRadius: 3, cursor: 'pointer',
                    border: `1px solid ${sampleTab === t ? color : '#E2E8F0'}`,
                    backgroundColor: sampleTab === t ? color : '#F8FAFC',
                    color: sampleTab === t ? '#FFFFFF' : '#64748B',
                  }}>
                    {t === 'in' ? 'Before' : 'After'}
                  </button>
                ))}
              </div>
              <StepMiniTable rows={sampleTab === 'in' ? audit.sample_in : audit.sample_out} />
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export const OntologyGraph: React.FC = () => {
  const { objectTypes, links, fetchObjectTypes, fetchLinks, addObjectType, removeObjectType } = useOntologyStore();
  const { connectors, fetchConnectors } = useConnectorStore();
  const { pipelines, fetchPipelines, addPipeline } = usePipelineStore();
  const [selectedObjectType, setSelectedObjectType] = useState<ObjectType | null>(null);
  const [selectedStepNode, setSelectedStepNode] = useState<SelectedStep | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createName, setCreateName] = useState('');
  const [createDesc, setCreateDesc] = useState('');
  const [createConnectorId, setCreateConnectorId] = useState('');
  const [createFrequency, setCreateFrequency] = useState('1h');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState('');
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; ot: ObjectType } | null>(null);
  const [connectorFields, setConnectorFields] = useState<ConnectorField[]>([]);
  const [selectedFields, setSelectedFields] = useState<Set<string>>(new Set());
  const [loadingFields, setLoadingFields] = useState(false);

  const handleCreateObjectType = async () => {
    if (!createName.trim()) { setCreateError('Name is required'); return; }
    setCreating(true);
    setCreateError('');
    try {
      const chosenFields = connectorFields.filter(f => selectedFields.has(f.name));
      const properties = chosenFields.map(f => ({
        id: genId(),
        name: f.name,
        displayName: f.name.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
        semanticType: f.semanticType,
        dataType: f.semanticType === 'QUANTITY' || f.semanticType === 'CURRENCY' ? 'number' : 'string',
        piiLevel: (f.semanticType === 'EMAIL' || f.semanticType === 'PHONE' || f.semanticType === 'PERSON_NAME' ? 'MEDIUM' : 'NONE') as import('../../types/ontology').PiiLevel,
        required: false,
      }));

      const created = await addObjectType({
        id: '',
        name: createName.trim().toLowerCase().replace(/\s+/g, '_'),
        displayName: createName.trim(),
        description: createDesc.trim() || undefined,
        properties,
        sourceConnectorIds: createConnectorId ? [createConnectorId] : [],
        version: 1,
        schemaHealth: 'healthy',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        tenantId: 'default',
      });

      // Auto-create pipeline if a connector was selected
      if (createConnectorId) {
        const connector = connectors.find(c => c.id === createConnectorId);
        const srcId = genId();
        const mapId = genId();
        const sinkId = genId();
        const mappings = chosenFields.map(f => ({ source: f.name, target: f.name }));
        await addPipeline({
          id: '',
          name: `${createName.trim()} Pipeline`,
          status: 'DRAFT',
          nodes: [
            {
              id: srcId,
              type: 'SOURCE',
              label: connector?.name || 'Source',
              config: { connectorId: createConnectorId, pollFrequency: createFrequency },
              position: { x: 100, y: 200 },
            },
            ...(mappings.length > 0 ? [{
              id: mapId,
              type: 'MAP' as const,
              label: 'Map Fields',
              config: { mappings },
              position: { x: 280, y: 200 },
            }] : []),
            {
              id: sinkId,
              type: 'SINK_OBJECT',
              label: createName.trim(),
              config: { objectTypeId: created.id, writeMode: 'upsert' },
              position: { x: mappings.length > 0 ? 460 : 400, y: 200 },
            },
          ],
          edges: mappings.length > 0
            ? [{ id: genId(), source: srcId, target: mapId }, { id: genId(), source: mapId, target: sinkId }]
            : [{ id: genId(), source: srcId, target: sinkId }],
          connectorIds: [createConnectorId],
          targetObjectTypeId: created.id,
          version: 1,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          tenantId: 'default',
        });
      }

      setShowCreateModal(false);
      setCreateName('');
      setCreateDesc('');
      setCreateConnectorId('');
      setCreateFrequency('1h');
      setConnectorFields([]);
      setSelectedFields(new Set());
      setSelectedObjectType(created);
    } catch (e: unknown) {
      setCreateError(e instanceof Error ? e.message : 'Failed to create');
    } finally {
      setCreating(false);
    }
  };

  useEffect(() => {
    fetchObjectTypes();
    fetchLinks();
    fetchConnectors();
    fetchPipelines();
  }, []);

  useEffect(() => {
    if (!createConnectorId) { setConnectorFields([]); setSelectedFields(new Set()); return; }
    setLoadingFields(true);
    fetch(`${CONNECTOR_API}/connectors/${createConnectorId}/sample`, { headers: { 'x-tenant-id': 'tenant-001' } })
      .then(r => r.json())
      .then(data => {
        const row: Record<string, unknown> = data.row || (data.rows && data.rows[0]) || {};
        const fields: ConnectorField[] = Object.entries(row)
          .filter(([k]) => !k.startsWith('_'))
          .map(([k, v]) => ({
            name: k,
            sample: String(v ?? '').slice(0, 50),
            semanticType: inferSemanticType(k, v),
          }));
        setConnectorFields(fields);
        setSelectedFields(new Set(fields.map(f => f.name)));
      })
      .catch(() => setConnectorFields([]))
      .finally(() => setLoadingFields(false));
  }, [createConnectorId]);

  const buildGraph = useCallback(() => {
    const flowNodes: Node[] = [];
    const flowEdges: Edge[] = [];

    // Only show connectors that are referenced by at least one object type or pipeline
    const usedConnectorIds = new Set<string>([
      ...objectTypes.flatMap((o) => o.sourceConnectorIds),
      ...pipelines.flatMap((p) => p.connectorIds),
    ]);
    const relevantConnectors = connectors.filter((c) => usedConnectorIds.has(c.id));

    // Calculate max step count across all pipelines to know where to put object type nodes
    const maxSteps = Math.max(
      ...pipelines.map((p) => {
        const authCount = p.connectorIds.filter((cId) => {
          const c = connectors.find((co) => co.id === cId);
          return c?.credentials && (c.credentials as Record<string, unknown>).tokenEndpointUrl;
        }).length;
        return authCount + p.nodes.length;
      }),
      1
    );
    const COL_OBJECT = COL_STEP_START + maxSteps * STEP_PITCH + 100;

    // --- Object type Y positions (primary layout axis) ---
    const otYMap = new Map<string, number>();
    objectTypes.forEach((ot, i) => { otYMap.set(ot.id, i * ROW_GAP + 40); });

    // Helper: resolve the effective target OT id for a pipeline —
    // uses targetObjectTypeId first, then falls back to the SINK node's config.objectTypeId
    const resolveSinkOtId = (p: Pipeline): string | undefined =>
      p.targetObjectTypeId ||
      (p.nodes.find((n) => n.type === 'SINK_OBJECT' || n.type === 'SINK_EVENT')
        ?.config as Record<string, unknown>
      )?.objectTypeId as string | undefined;

    // --- Pipeline Y: align to target object type, or fall back to index ---
    const pipelineYMap = new Map<string, number>();
    // Track how many pipelines share the same OT row (offset them slightly)
    const otPipelineCount = new Map<string, number>();
    pipelines.forEach((p, pIdx) => {
      const effectiveOtId = resolveSinkOtId(p);
      const baseY = effectiveOtId && otYMap.has(effectiveOtId)
        ? otYMap.get(effectiveOtId)!
        : pIdx * ROW_GAP + 40;
      const count = otPipelineCount.get(effectiveOtId || '') ?? 0;
      // Offset multiple pipelines targeting the same OT
      const offsetY = baseY + count * 70;
      otPipelineCount.set(effectiveOtId || '', count + 1);
      pipelineYMap.set(p.id, offsetY);
    });

    // --- Connector Y: average of the pipeline Ys they feed ---
    const connectorYMap = new Map<string, number>();
    relevantConnectors.forEach((c, i) => {
      const myPipelines = pipelines.filter((p) => p.connectorIds.includes(c.id));
      if (myPipelines.length > 0) {
        const avgY = myPipelines.reduce((sum, p) => sum + (pipelineYMap.get(p.id) ?? 0), 0) / myPipelines.length;
        connectorYMap.set(c.id, avgY);
      } else {
        connectorYMap.set(c.id, i * ROW_GAP + 40);
      }
    });

    // --- Connector nodes ---
    relevantConnectors.forEach((c) => {
      flowNodes.push({
        id: `con-${c.id}`,
        type: 'connectorNode',
        position: { x: COL_CONNECTOR, y: connectorYMap.get(c.id) ?? 40 },
        data: { connector: c },
      });
    });

    // --- Pipeline step chains ---
    pipelines.forEach((p, pIdx) => {
      const pipelineY = pipelineYMap.get(p.id) ?? pIdx * ROW_GAP + 40;

      // Build ordered list of step node IDs for this pipeline (for chaining edges)
      const stepNodeIds: string[] = [];

      // Auth steps: one per connector that has a tokenEndpointUrl
      p.connectorIds.forEach((cId) => {
        const c = connectors.find((co) => co.id === cId);
        if (!c) return;
        const creds = (c.credentials as Record<string, unknown>) || {};
        if (!creds.tokenEndpointUrl) return;
        const stepId = `step-${p.id}-auth-${cId}`;
        stepNodeIds.push(stepId);
        const loginUrl = String(creds.tokenEndpointUrl);
        flowNodes.push({
          id: stepId,
          type: 'pipelineStepNode',
          position: { x: COL_STEP_START, y: pipelineY },
          data: {
            stepType: 'AUTH',
            label: c.name,
            subtitle: loginUrl.replace(/^https?:\/\/[^/]+/, '') || loginUrl,
            onStepClick: () => {
              setSelectedStepNode({ pipelineId: p.id, nodeId: null, stepType: 'AUTH', label: c.name, pipelineName: p.name });
              setSelectedObjectType(null);
            },
          },
        });
      });

      // Sort pipeline nodes topologically (SOURCE first, SINK last)
      const NODE_ORDER: Record<string, number> = {
        SOURCE: 0, FILTER: 1, MAP: 2, CAST: 2, ENRICH: 3,
        FLATTEN: 3, DEDUPE: 4, VALIDATE: 5, SINK_OBJECT: 99, SINK_EVENT: 99,
      };
      const sortedPipelineNodes = [...p.nodes].sort(
        (a, b) => (NODE_ORDER[a.type] ?? 50) - (NODE_ORDER[b.type] ?? 50)
      );

      sortedPipelineNodes.forEach((node) => {
        const stepId = `step-${p.id}-node-${node.id}`;
        stepNodeIds.push(stepId);
        const label =
          (node.config as Record<string, unknown>)?.label as string ||
          node.label ||
          node.id;
        flowNodes.push({
          id: stepId,
          type: 'pipelineStepNode',
          position: {
            x: COL_STEP_START + stepNodeIds.indexOf(stepId) * STEP_PITCH,
            y: pipelineY,
          },
          data: {
            stepType: node.type,
            label,
            pipelineName: p.name,
            onStepClick: () => {
              setSelectedStepNode({ pipelineId: p.id, nodeId: node.id, stepType: node.type, label, pipelineName: p.name });
              setSelectedObjectType(null);
            },
          },
        });
      });

      // Fix positions now that we know all stepNodeIds (indexOf was called mid-loop)
      stepNodeIds.forEach((sid, idx) => {
        const n = flowNodes.find((fn) => fn.id === sid);
        if (n) n.position = { x: COL_STEP_START + idx * STEP_PITCH, y: pipelineY };
      });

      // Connector → first step edges (one edge per connector)
      if (stepNodeIds.length > 0) {
        p.connectorIds.forEach((cId) => {
          if (!usedConnectorIds.has(cId)) return;
          flowEdges.push({
            id: `e-con-${cId}-pipe-${p.id}`,
            source: `con-${cId}`,
            target: stepNodeIds[0],
            markerEnd: { type: MarkerType.ArrowClosed, color: '#94A3B8' },
            style: { stroke: '#CBD5E1', strokeWidth: 1.5 },
          });
        });
      } else {
        // No steps — connect connector directly to object type
        p.connectorIds.forEach((cId) => {
          if (!usedConnectorIds.has(cId)) return;
          flowEdges.push({
            id: `e-con-${cId}-pipe-${p.id}`,
            source: `con-${cId}`,
            target: p.targetObjectTypeId || `con-${cId}`,
            markerEnd: { type: MarkerType.ArrowClosed, color: '#94A3B8' },
            style: { stroke: '#CBD5E1', strokeWidth: 1.5 },
          });
        });
      }

      // Step-to-step edges within the chain
      for (let i = 0; i < stepNodeIds.length - 1; i++) {
        flowEdges.push({
          id: `e-step-${p.id}-${i}`,
          source: stepNodeIds[i],
          target: stepNodeIds[i + 1],
          markerEnd: { type: MarkerType.ArrowClosed, color: '#94A3B8' },
          style: { stroke: '#CBD5E1', strokeWidth: 1.5 },
        });
      }

      // Last step → ObjectType edge (use targetObjectTypeId OR SINK node config fallback)
      const effectiveSinkOtId = resolveSinkOtId(p);
      if (effectiveSinkOtId && stepNodeIds.length > 0) {
        const isLive = p.status === 'RUNNING';
        flowEdges.push({
          id: `e-pipe-${p.id}-ot-${effectiveSinkOtId}`,
          source: stepNodeIds[stepNodeIds.length - 1],
          target: effectiveSinkOtId,
          animated: isLive,
          markerEnd: { type: MarkerType.ArrowClosed, color: isLive ? '#6366F1' : '#A5B4FC' },
          style: { stroke: isLive ? '#6366F1' : '#A5B4FC', strokeWidth: isLive ? 2 : 1.5 },
        });
      }
    });

    // --- ObjectType nodes ---
    const runningTargetIds = new Set(
      pipelines
        .filter((p) => p.status === 'RUNNING')
        .map((p) => resolveSinkOtId(p))
        .filter(Boolean) as string[]
    );

    objectTypes.forEach((ot) => {
      flowNodes.push({
        id: ot.id,
        type: 'objectTypeNode',
        position: { x: COL_OBJECT, y: otYMap.get(ot.id) ?? 40 },
        data: { objectType: ot, isReceivingData: runningTargetIds.has(ot.id) },
      });

      // Direct connector → objectType edges (for connectors not covered by a pipeline)
      const pipelineConnectorIds = new Set(
        pipelines
          .filter((p) => resolveSinkOtId(p) === ot.id)
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
      setSelectedStepNode(null);
    }
  }, [objectTypes]);

  const onNodeDoubleClick: NodeMouseHandler = useCallback((_event, node) => {
    if (node.id.startsWith('step-')) {
      const pipeline = pipelines.find((p) => node.id.startsWith(`step-${p.id}-`));
      if (!pipeline) return;
      const suffix = node.id.slice(`step-${pipeline.id}-`.length);
      const isAuth = suffix.startsWith('auth-');
      const nodeId = isAuth ? null : suffix.slice('node-'.length);
      const data = node.data as { stepType?: string; label?: string; pipelineName?: string };
      setSelectedStepNode({
        pipelineId: pipeline.id,
        nodeId,
        stepType: (data.stepType as string) || 'SOURCE',
        label: (data.label as string) || '',
        pipelineName: pipeline.name,
      });
      setSelectedObjectType(null);
    }
  }, [pipelines]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* Header */}
      <div style={{
        height: 52, backgroundColor: '#FFFFFF', borderBottom: '1px solid #E2E8F0',
        display: 'flex', alignItems: 'center', padding: '0 52px 0 16px', gap: '12px', flexShrink: 0,
      }}>
        <h1 style={{ fontSize: '16px', fontWeight: 500, color: '#0D1117' }}>Ontology Graph</h1>

        <div style={{ display: 'flex', gap: '6px', alignItems: 'center', marginLeft: '8px' }}>
          {objectTypes.map((ot) => (
            <button
              key={ot.id}
              onClick={() => setSelectedObjectType(ot)}
              onContextMenu={(e) => { e.preventDefault(); setCtxMenu({ x: e.clientX, y: e.clientY, ot }); }}
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
          <Button variant="primary" size="sm" icon={<Plus size={12} />} onClick={() => { setCreateName(''); setCreateDesc(''); setCreateError(''); setCreateConnectorId(''); setConnectorFields([]); setSelectedFields(new Set()); setShowCreateModal(true); }}>New Object Type</Button>
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

        {/* Step audit panel */}
        {selectedStepNode && (
          <StepAuditPanel
            step={selectedStepNode}
            onClose={() => setSelectedStepNode(null)}
          />
        )}
      </div>


      {/* Tab right-click context menu */}
      {ctxMenu && createPortal(
        <>
          <div onMouseDown={() => setCtxMenu(null)} style={{ position: 'fixed', inset: 0, zIndex: 9998 }} />
          <div
            onMouseDown={e => e.stopPropagation()}
            style={{
              position: 'fixed', left: ctxMenu.x, top: ctxMenu.y, zIndex: 9999,
              backgroundColor: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: '4px',
              boxShadow: '0 8px 24px rgba(0,0,0,0.15)', minWidth: '160px', padding: '4px 0',
            }}
          >
            <button
              onMouseDown={() => { setCtxMenu(null); setSelectedObjectType(ctxMenu.ot); }}
              style={{ display: 'block', width: '100%', textAlign: 'left', padding: '8px 14px', background: 'none', border: 'none', fontSize: '13px', cursor: 'pointer', color: '#0D1117' }}
            >
              Open
            </button>
            <div style={{ height: '1px', backgroundColor: '#F1F5F9', margin: '3px 0' }} />
            <button
              onMouseDown={async () => {
                const ot = ctxMenu.ot;
                setCtxMenu(null);
                if (!confirm(`Delete "${ot.name}"? This cannot be undone.`)) return;
                if (selectedObjectType?.id === ot.id) setSelectedObjectType(null);
                await removeObjectType(ot.id);
              }}
              style={{ display: 'block', width: '100%', textAlign: 'left', padding: '8px 14px', background: 'none', border: 'none', fontSize: '13px', cursor: 'pointer', color: '#DC2626' }}
            >
              Delete
            </button>
          </div>
        </>,
        document.body
      )}

      {/* New Object Type modal */}
      {showCreateModal && createPortal(
        <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999 }}>
          <div style={{ backgroundColor: '#FFFFFF', borderRadius: '4px', width: 560, maxHeight: '90vh', display: 'flex', flexDirection: 'column', padding: '24px', boxShadow: '0 20px 60px rgba(0,0,0,0.3)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px', flexShrink: 0 }}>
              <h2 style={{ fontSize: '15px', fontWeight: 600, color: '#0D1117' }}>New Object Type</h2>
              <button onClick={() => setShowCreateModal(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#64748B', padding: 4 }}><X size={16} /></button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', overflowY: 'auto', flex: 1 }}>
              <div>
                <label style={{ fontSize: '12px', fontWeight: 500, color: '#374151', display: 'block', marginBottom: '6px' }}>Display Name <span style={{ color: '#DC2626' }}>*</span></label>
                <input
                  autoFocus
                  value={createName}
                  onChange={e => setCreateName(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Escape') setShowCreateModal(false); }}
                  placeholder="e.g. Deal"
                  style={{ width: '100%', height: '36px', border: '1px solid #E2E8F0', borderRadius: '3px', padding: '0 10px', fontSize: '13px', boxSizing: 'border-box', outline: 'none' }}
                />
                {createName.trim() && (
                  <p style={{ fontSize: '11px', color: '#94A3B8', marginTop: '4px' }}>
                    ID: <code style={{ fontFamily: 'var(--font-mono)' }}>{createName.trim().toLowerCase().replace(/\s+/g, '_')}</code>
                  </p>
                )}
              </div>
              <div>
                <label style={{ fontSize: '12px', fontWeight: 500, color: '#374151', display: 'block', marginBottom: '6px' }}>Description</label>
                <textarea
                  value={createDesc}
                  onChange={e => setCreateDesc(e.target.value)}
                  placeholder="Optional description..."
                  rows={2}
                  style={{ width: '100%', border: '1px solid #E2E8F0', borderRadius: '3px', padding: '8px 10px', fontSize: '13px', resize: 'none', boxSizing: 'border-box', outline: 'none', fontFamily: 'inherit' }}
                />
              </div>

              <div style={{ height: '1px', backgroundColor: '#F1F5F9', margin: '4px 0', flexShrink: 0 }} />
              <p style={{ fontSize: '11px', color: '#94A3B8', margin: '-8px 0 0' }}>Optional — auto-creates a pipeline that feeds this object</p>

              <div>
                <label style={{ fontSize: '12px', fontWeight: 500, color: '#374151', display: 'block', marginBottom: '6px' }}>Source Connector</label>
                <select
                  value={createConnectorId}
                  onChange={e => setCreateConnectorId(e.target.value)}
                  style={{ width: '100%', height: '36px', border: '1px solid #E2E8F0', borderRadius: '3px', padding: '0 10px', fontSize: '13px', boxSizing: 'border-box', outline: 'none', background: '#FFFFFF' }}
                >
                  <option value="">None (create manually later)</option>
                  {connectors.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>

              {createConnectorId && (
                <div>
                  <label style={{ fontSize: '12px', fontWeight: 500, color: '#374151', display: 'block', marginBottom: '6px' }}>Sync Frequency</label>
                  <select
                    value={createFrequency}
                    onChange={e => setCreateFrequency(e.target.value)}
                    style={{ width: '100%', height: '36px', border: '1px solid #E2E8F0', borderRadius: '3px', padding: '0 10px', fontSize: '13px', boxSizing: 'border-box', outline: 'none', background: '#FFFFFF' }}
                  >
                    {['on_demand','5m','15m','30m','1h','6h','12h','1d'].map(f => <option key={f} value={f}>{f}</option>)}
                  </select>
                </div>
              )}

              {/* Field picker */}
              {createConnectorId && (
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                    <label style={{ fontSize: '12px', fontWeight: 500, color: '#374151' }}>
                      Fields {loadingFields ? '(loading…)' : connectorFields.length > 0 ? `(${selectedFields.size} / ${connectorFields.length} selected)` : ''}
                    </label>
                    {connectorFields.length > 0 && (
                      <div style={{ display: 'flex', gap: '8px' }}>
                        <button onClick={() => setSelectedFields(new Set(connectorFields.map(f => f.name)))} style={{ fontSize: '11px', color: '#2563EB', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>All</button>
                        <button onClick={() => setSelectedFields(new Set())} style={{ fontSize: '11px', color: '#64748B', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>None</button>
                      </div>
                    )}
                  </div>
                  {loadingFields ? (
                    <div style={{ fontSize: '12px', color: '#94A3B8', padding: '12px', border: '1px solid #F1F5F9', borderRadius: '3px', textAlign: 'center' }}>Fetching fields from connector…</div>
                  ) : connectorFields.length > 0 ? (
                    <div style={{ border: '1px solid #E2E8F0', borderRadius: '3px', maxHeight: '220px', overflowY: 'auto' }}>
                      {connectorFields.map((f, i) => (
                        <div
                          key={f.name}
                          onClick={() => setSelectedFields(prev => {
                            const next = new Set(prev);
                            next.has(f.name) ? next.delete(f.name) : next.add(f.name);
                            return next;
                          })}
                          style={{
                            display: 'flex', alignItems: 'center', gap: '10px', padding: '7px 10px',
                            cursor: 'pointer', userSelect: 'none',
                            backgroundColor: i % 2 === 0 ? '#FFFFFF' : '#F8FAFC',
                            borderBottom: i < connectorFields.length - 1 ? '1px solid #F1F5F9' : 'none',
                          }}
                        >
                          <input type="checkbox" checked={selectedFields.has(f.name)} readOnly style={{ margin: 0, flexShrink: 0 }} />
                          <span style={{ fontSize: '12px', fontWeight: 500, color: '#0D1117', minWidth: '140px', fontFamily: 'var(--font-mono)' }}>{f.name}</span>
                          <span style={{ fontSize: '10px', color: '#FFFFFF', backgroundColor: '#64748B', borderRadius: '2px', padding: '1px 5px', flexShrink: 0 }}>{f.semanticType}</span>
                          <span style={{ fontSize: '11px', color: '#94A3B8', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{f.sample || '—'}</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div style={{ fontSize: '12px', color: '#94A3B8', padding: '12px', border: '1px solid #F1F5F9', borderRadius: '3px', textAlign: 'center' }}>No sample data available — fields can be mapped in the pipeline editor</div>
                  )}
                </div>
              )}

              {createError && <p style={{ fontSize: '12px', color: '#DC2626' }}>{createError}</p>}
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '4px', flexShrink: 0 }}>
                <button onClick={() => setShowCreateModal(false)} style={{ height: '32px', padding: '0 14px', border: '1px solid #E2E8F0', borderRadius: '3px', background: '#FFFFFF', fontSize: '13px', cursor: 'pointer', color: '#374151' }}>Cancel</button>
                <button onClick={handleCreateObjectType} disabled={creating} style={{ height: '32px', padding: '0 14px', border: 'none', borderRadius: '3px', background: '#2563EB', color: '#FFFFFF', fontSize: '13px', cursor: creating ? 'not-allowed' : 'pointer', opacity: creating ? 0.7 : 1 }}>
                  {creating ? 'Creating…' : (createConnectorId ? 'Create + Pipeline' : 'Create')}
                </button>
              </div>
            </div>
          </div>
        </div>,
        document.body
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
