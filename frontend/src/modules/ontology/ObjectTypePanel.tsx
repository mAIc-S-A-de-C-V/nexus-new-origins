import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X, GitCommit, ChevronDown, ChevronUp, Trash2, Pencil, Check, Maximize2, Search, GitBranch, Play, ArrowRight, Clock, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { ObjectType, ObjectTypeVersion, SchemaDiff } from '../../types/ontology';
import { PropertyList } from './PropertyList';
import { SchemaDiffViewer } from './SchemaDiffViewer';
import { Badge } from '../../design-system/components/Badge';
import { useOntologyStore } from '../../store/ontologyStore';
import { usePipelineStore } from '../../store/pipelineStore';
import { nodeColors } from '../../design-system/tokens';

const CONNECTOR_API = import.meta.env.VITE_CONNECTOR_SERVICE_URL || 'http://localhost:8001';
const ONTOLOGY_API = import.meta.env.VITE_ONTOLOGY_SERVICE_URL || 'http://localhost:8004';
const PIPELINE_API = import.meta.env.VITE_PIPELINE_SERVICE_URL || 'http://localhost:8002';

type TabId = 'properties' | 'data' | 'pipeline' | 'versions' | 'diff' | 'links';

interface ObjectTypePanelProps {
  objectType: ObjectType;
  onClose: () => void;
}

const BASE_TABS: { id: TabId; label: string }[] = [
  { id: 'properties', label: 'Properties' },
  { id: 'data', label: 'Data' },
  { id: 'versions', label: 'Version History' },
  { id: 'diff', label: 'Schema Diff' },
  { id: 'links', label: 'Links' },
];

const healthConfig: Record<string, { label: string; bg: string; text: string }> = {
  healthy: { label: 'Healthy', bg: '#ECFDF5', text: '#065F46' },
  warning: { label: 'Warning', bg: '#FEFCE8', text: '#713F12' },
  degraded: { label: 'Degraded', bg: '#FEF2F2', text: '#991B1B' },
};

export const ObjectTypePanel: React.FC<ObjectTypePanelProps> = ({ objectType, onClose }) => {
  const [activeTab, setActiveTab] = useState<TabId>('properties');
  const [visible, setVisible] = useState(true);
  const [versions, setVersions] = useState<ObjectTypeVersion[]>([]);
  const [diff, setDiff] = useState<SchemaDiff | undefined>(undefined);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [nameInput, setNameInput] = useState(objectType.displayName);
  const [savingName, setSavingName] = useState(false);
  const [dataRows, setDataRows] = React.useState<unknown[]>([]);
  const [dataLoading, setDataLoading] = React.useState(false);
  const [dataError, setDataError] = React.useState<string | null>(null);
  const { fetchVersions, fetchDiff, removeObjectType, updateObjectType } = useOntologyStore();

  useEffect(() => {
    setActiveTab('properties');
    setVersions([]);
    setDiff(undefined);
    setConfirmDelete(false);
    setEditingName(false);
    setNameInput(objectType.displayName);
  }, [objectType.id]);

  useEffect(() => {
    if (activeTab === 'versions' && versions.length === 0) {
      fetchVersions(objectType.id).then(setVersions);
    }
    if (activeTab === 'diff' && !diff && objectType.version > 1) {
      fetchDiff(objectType.id, objectType.version - 1, objectType.version).then((d) => {
        if (d) setDiff(d);
      });
    }
  }, [activeTab, objectType.id]);

  const [dataSyncing, setDataSyncing] = React.useState(false);
  const [dataSource, setDataSource] = React.useState<'persisted' | 'live'>('persisted');
  const { pipelines, fetchPipelines, runPipeline } = usePipelineStore();

  const sourcePipeline = React.useMemo(
    () => pipelines.find((p) => p.id === objectType.sourcePipelineId),
    [pipelines, objectType.sourcePipelineId]
  );

  useEffect(() => {
    if (objectType.sourcePipelineId && pipelines.length === 0) fetchPipelines();
  }, [objectType.sourcePipelineId]);

  const handleRunPipeline = React.useCallback(async () => {
    if (!objectType.sourcePipelineId) return;
    setDataSyncing(true);
    try {
      await runPipeline(objectType.sourcePipelineId);
      // Poll for completion then reload data
      let attempts = 0;
      const poll = setInterval(async () => {
        attempts++;
        const res = await fetch(`${import.meta.env.VITE_PIPELINE_SERVICE_URL || 'http://localhost:8002'}/pipelines/${objectType.sourcePipelineId}/runs`);
        if (res.ok) {
          const runs = await res.json();
          const latest = runs[0];
          if (latest && (latest.status === 'COMPLETED' || latest.status === 'FAILED')) {
            clearInterval(poll);
            if (latest.status === 'COMPLETED') await loadData();
            setDataSyncing(false);
          }
        }
        if (attempts > 30) { clearInterval(poll); setDataSyncing(false); }
      }, 2000);
    } catch {
      setDataSyncing(false);
    }
  }, [objectType.sourcePipelineId, runPipeline]);

  const loadData = React.useCallback(async () => {
    if (!objectType.sourceConnectorIds.length && !objectType.sourcePipelineId) return;
    setDataLoading(true);
    setDataError(null);
    try {
      // Always try persisted records first (pipeline-pushed or previously synced)
      const recordsRes = await fetch(`${ONTOLOGY_API}/object-types/${objectType.id}/records`);
      if (recordsRes.ok) {
        const recordsData = await recordsRes.json();
        if (recordsData.records?.length > 0) {
          setDataRows(recordsData.records);
          setDataSource('persisted');
          return;
        }
      }
      // Pipeline-backed but no records yet — tell the user to run the pipeline
      if (objectType.sourcePipelineId) {
        setDataRows([]);
        setDataSource('persisted');
        return;
      }
      // Connector-backed fallback: live schema fetch
      const results = await Promise.all(
        objectType.sourceConnectorIds.map((cid) =>
          fetch(`${CONNECTOR_API}/connectors/${cid}/schema`)
            .then((r) => r.ok ? r.json() : null)
            .catch(() => null)
        )
      );
      const rows: unknown[] = [];
      results.forEach((data) => { if (data?.sample_rows) rows.push(...data.sample_rows); });
      if (rows.length === 0 && results.every((r) => r === null)) {
        setDataError('Could not reach connector service');
      }
      setDataRows(rows);
      setDataSource('live');
    } finally {
      setDataLoading(false);
    }
  }, [objectType.id, objectType.sourceConnectorIds, objectType.sourcePipelineId]);

  const handleSync = React.useCallback(async () => {
    if (objectType.sourcePipelineId) {
      await handleRunPipeline();
      return;
    }
    setDataSyncing(true);
    try {
      await fetch(`${ONTOLOGY_API}/object-types/${objectType.id}/records/sync`, { method: 'POST' });
      await loadData();
    } finally {
      setDataSyncing(false);
    }
  }, [objectType.id, objectType.sourcePipelineId, loadData, handleRunPipeline]);

  useEffect(() => {
    if (activeTab !== 'data') return;
    loadData();
  }, [activeTab, objectType.id]);

  const handleClose = () => {
    setVisible(false);
    setTimeout(onClose, 120);
  };

  const handleDelete = async () => {
    if (!confirmDelete) { setConfirmDelete(true); return; }
    setDeleting(true);
    try {
      await removeObjectType(objectType.id);
      handleClose();
    } catch {
      setDeleting(false);
      setConfirmDelete(false);
    }
  };

  const handleSaveName = async () => {
    const trimmed = nameInput.trim();
    if (!trimmed || trimmed === objectType.displayName) { setEditingName(false); return; }
    setSavingName(true);
    try {
      await updateObjectType(objectType.id, {
        displayName: trimmed,
        name: trimmed.replace(/\s+/g, ''),
      });
      setEditingName(false);
    } finally {
      setSavingName(false);
    }
  };

  const hConf = healthConfig[objectType.schemaHealth] || healthConfig.healthy;

  return (
    <div style={{
      width: '420px',
      backgroundColor: '#FFFFFF',
      borderLeft: '1px solid #E2E8F0',
      display: 'flex',
      flexDirection: 'column',
      flexShrink: 0,
      transform: visible ? 'translateX(0)' : 'translateX(100%)',
      transition: 'transform 120ms ease-out',
    }}>
      {/* Header */}
      <div style={{
        padding: '14px 16px',
        borderBottom: '1px solid #E2E8F0',
        display: 'flex',
        alignItems: 'flex-start',
        gap: '10px',
      }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '3px' }}>
            {editingName ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flex: 1 }}>
                <input
                  value={nameInput}
                  onChange={(e) => setNameInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleSaveName(); if (e.key === 'Escape') setEditingName(false); }}
                  autoFocus
                  style={{
                    fontSize: '15px', fontWeight: 600, color: '#0D1117',
                    border: '1px solid #2563EB', borderRadius: '3px',
                    padding: '1px 6px', outline: 'none', width: '160px',
                  }}
                />
                <button
                  onClick={handleSaveName}
                  disabled={savingName}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#059669', padding: '2px' }}
                >
                  <Check size={14} />
                </button>
                <button
                  onClick={() => { setEditingName(false); setNameInput(objectType.displayName); }}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94A3B8', padding: '2px' }}
                >
                  <X size={14} />
                </button>
              </div>
            ) : (
              <>
                <h2 style={{ fontSize: '15px', fontWeight: 600, color: '#0D1117' }}>{objectType.displayName}</h2>
                <button
                  onClick={() => setEditingName(true)}
                  title="Rename"
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#CBD5E1', padding: '2px' }}
                  onMouseEnter={(e) => (e.currentTarget.style.color = '#64748B')}
                  onMouseLeave={(e) => (e.currentTarget.style.color = '#CBD5E1')}
                >
                  <Pencil size={12} />
                </button>
                <span style={{
                  fontSize: '11px', backgroundColor: hConf.bg, color: hConf.text,
                  padding: '1px 6px', borderRadius: '2px', fontWeight: 500,
                }}>
                  {hConf.label}
                </span>
              </>
            )}
          </div>
          <p style={{ fontSize: '12px', color: '#64748B' }}>
            {objectType.description || 'No description'} · v{objectType.version} · {objectType.properties.length} properties
          </p>
        </div>

        <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexShrink: 0 }}>
          {/* Delete button */}
          <button
            onClick={handleDelete}
            disabled={deleting}
            title={confirmDelete ? 'Click again to confirm' : 'Delete object type'}
            style={{
              height: 28, padding: '0 8px',
              borderRadius: '4px',
              border: `1px solid ${confirmDelete ? '#FCA5A5' : '#E2E8F0'}`,
              backgroundColor: confirmDelete ? '#FEF2F2' : '#FFFFFF',
              color: confirmDelete ? '#DC2626' : '#94A3B8',
              fontSize: '11px', fontWeight: confirmDelete ? 600 : 400,
              display: 'flex', alignItems: 'center', gap: '4px',
              cursor: deleting ? 'wait' : 'pointer',
              transition: 'all 80ms', whiteSpace: 'nowrap',
            }}
            onMouseEnter={(e) => { if (!confirmDelete) { (e.currentTarget as HTMLElement).style.borderColor = '#FCA5A5'; (e.currentTarget as HTMLElement).style.color = '#DC2626'; } }}
            onMouseLeave={(e) => { if (!confirmDelete) { (e.currentTarget as HTMLElement).style.borderColor = '#E2E8F0'; (e.currentTarget as HTMLElement).style.color = '#94A3B8'; } }}
          >
            <Trash2 size={12} />
            {confirmDelete ? 'Confirm?' : ''}
          </button>

          <button onClick={handleClose} style={{
            width: 28, height: 28, borderRadius: '4px',
            border: '1px solid #E2E8F0', backgroundColor: '#FFFFFF',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: 'pointer', color: '#64748B',
          }}>
            <X size={14} />
          </button>
        </div>
      </div>

      {/* Pipeline backing or source connectors */}
      {objectType.sourcePipelineId ? (
        <div style={{
          padding: '8px 16px',
          borderBottom: '1px solid #E2E8F0',
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          backgroundColor: '#FFFBEB',
        }}>
          <GitBranch size={13} style={{ color: '#D97706', flexShrink: 0 }} />
          <span style={{ fontSize: '11px', color: '#92400E', fontWeight: 500 }}>
            Backed by pipeline:
          </span>
          <span style={{ fontSize: '11px', color: '#0D1117', fontWeight: 600 }}>
            {sourcePipeline?.name || objectType.sourcePipelineId}
          </span>
          <span style={{ fontSize: '10px', color: '#D97706', marginLeft: 'auto',
            backgroundColor: '#FEF3C7', padding: '1px 6px', borderRadius: '2px', fontWeight: 500 }}>
            Pipeline-owned
          </span>
        </div>
      ) : (
        <div style={{
          padding: '8px 16px',
          borderBottom: '1px solid #E2E8F0',
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          flexWrap: 'wrap',
        }}>
          <span style={{ fontSize: '11px', color: '#94A3B8', marginRight: '2px' }}>Fed by:</span>
          {objectType.sourceConnectorIds.length > 0
            ? objectType.sourceConnectorIds.map((id) => (
                <Badge key={id} label={id} bg="#F1F5F9" color="#475569" size="sm" />
              ))
            : <span style={{ fontSize: '11px', color: '#CBD5E1' }}>No sources configured</span>
          }
        </div>
      )}

      {/* Tabs */}
      <div style={{ display: 'flex', borderBottom: '1px solid #E2E8F0', padding: '0 8px', flexShrink: 0, overflowX: 'auto' }}>
        {[
          ...BASE_TABS.slice(0, 2),
          ...(objectType.sourcePipelineId ? [{ id: 'pipeline' as TabId, label: 'Pipeline' }] : []),
          ...BASE_TABS.slice(2),
        ].map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            style={{
              height: '36px', padding: '0 10px', fontSize: '12px',
              fontWeight: activeTab === tab.id ? 500 : 400,
              color: activeTab === tab.id ? (tab.id === 'pipeline' ? '#D97706' : '#2563EB') : '#64748B',
              borderBottom: activeTab === tab.id ? `2px solid ${tab.id === 'pipeline' ? '#D97706' : '#2563EB'}` : '2px solid transparent',
              backgroundColor: 'transparent', cursor: 'pointer',
              transition: 'color 80ms', whiteSpace: 'nowrap', flexShrink: 0,
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '16px' }}>
        {activeTab === 'properties' && (
          <PropertyList properties={objectType.properties} />
        )}

        {activeTab === 'data' && (
          <DataTab
            rows={dataRows}
            loading={dataLoading}
            error={dataError}
            hasConnectors={objectType.sourceConnectorIds.length > 0 || !!objectType.sourcePipelineId}
            objectTypeName={objectType.displayName}
            arrayProperties={objectType.properties.filter((p) => p.dataType === 'array' || p.name.endsWith('[]'))}
            properties={objectType.properties}
            onSync={handleSync}
            syncing={dataSyncing}
            dataSource={dataSource}
            isPipelineBacked={!!objectType.sourcePipelineId}
            pipelineName={sourcePipeline?.name}
          />
        )}

        {activeTab === 'versions' && (
          <VersionHistory versions={versions} currentVersion={objectType.version} />
        )}

        {activeTab === 'diff' && diff && (
          <SchemaDiffViewer diff={diff} />
        )}

        {activeTab === 'diff' && !diff && (
          <div style={{ textAlign: 'center', padding: '40px 0', color: '#94A3B8', fontSize: '13px' }}>
            {objectType.version <= 1
              ? 'No diff available — this is the first version'
              : 'Loading diff...'}
          </div>
        )}

        {activeTab === 'pipeline' && objectType.sourcePipelineId && (
          <PipelineAuditTab
            pipelineId={objectType.sourcePipelineId}
            pipeline={sourcePipeline}
          />
        )}

        {activeTab === 'links' && (
          <div style={{ textAlign: 'center', padding: '40px 0', color: '#94A3B8', fontSize: '13px' }}>
            Open the Ontology Graph to view relationship links
          </div>
        )}
      </div>
    </div>
  );
};

// ── Pipeline Audit Tab ────────────────────────────────────────────────────────

interface NodeAudit {
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

const PipelineAuditTab: React.FC<{
  pipelineId: string;
  pipeline: import('../../types/pipeline').Pipeline | undefined;
}> = ({ pipelineId, pipeline }) => {
  const [audits, setAudits] = useState<Record<string, NodeAudit>>({});
  const [runMeta, setRunMeta] = useState<{ id: string; status: string; started_at: string; rows_in: number; rows_out: number } | null>(null);
  const [loading, setLoading] = useState(false);
  const [expandedNode, setExpandedNode] = useState<string | null>(null);
  const [expandedSample, setExpandedSample] = useState<'in' | 'out' | null>(null);

  useEffect(() => {
    if (!pipelineId) return;
    setLoading(true);
    fetch(`${PIPELINE_API}/pipelines/${pipelineId}/runs`, { headers: { 'x-tenant-id': 'tenant-001' } })
      .then((r) => r.ok ? r.json() : [])
      .then(async (runs: { id: string; status: string; started_at: string; rows_in: number; rows_out: number }[]) => {
        const latest = runs.find((r) => r.status === 'COMPLETED') || runs[0];
        if (!latest) { setLoading(false); return; }
        setRunMeta(latest);
        const res = await fetch(`${PIPELINE_API}/pipelines/${pipelineId}/runs/${latest.id}/audit`, {
          headers: { 'x-tenant-id': 'tenant-001' },
        });
        if (res.ok) {
          const data = await res.json();
          setAudits(data.node_audits || {});
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [pipelineId]);

  // Topological order from the pipeline definition
  const orderedNodes = React.useMemo(() => {
    if (!pipeline?.nodes) return [];
    const adj: Record<string, string[]> = {};
    const inDeg: Record<string, number> = {};
    pipeline.nodes.forEach((n) => { adj[n.id] = []; inDeg[n.id] = 0; });
    pipeline.edges?.forEach((e) => {
      adj[e.source]?.push(e.target);
      inDeg[e.target] = (inDeg[e.target] || 0) + 1;
    });
    const queue = pipeline.nodes.filter((n) => !inDeg[n.id]).map((n) => n.id);
    const result: string[] = [];
    while (queue.length) {
      const id = queue.shift()!;
      result.push(id);
      adj[id]?.forEach((nxt) => { inDeg[nxt]--; if (!inDeg[nxt]) queue.push(nxt); });
    }
    return result.map((id) => pipeline.nodes.find((n) => n.id === id)!).filter(Boolean);
  }, [pipeline]);

  if (loading) return <div style={{ padding: 20, color: '#94A3B8', fontSize: 12, textAlign: 'center' }}>Loading pipeline audit…</div>;

  if (!runMeta) {
    return (
      <div style={{ textAlign: 'center', padding: '40px 0' }}>
        <Clock size={28} color="#CBD5E1" style={{ marginBottom: 10 }} />
        <div style={{ fontSize: 13, color: '#94A3B8' }}>No runs yet</div>
        <div style={{ fontSize: 11, color: '#CBD5E1', marginTop: 4 }}>Run the pipeline from the Data tab to see step-by-step audit data</div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
      {/* Run summary bar */}
      <div style={{ padding: '8px 0 12px', marginBottom: 8, borderBottom: '1px solid #F1F5F9', display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={{ fontSize: 11, color: '#64748B' }}>
          Last run: <strong style={{ color: '#0D1117' }}>{new Date(runMeta.started_at).toLocaleString()}</strong>
        </span>
        <span style={{ fontSize: 11, padding: '2px 7px', borderRadius: 3, backgroundColor: runMeta.status === 'COMPLETED' ? '#DCFCE7' : '#FFE4E6', color: runMeta.status === 'COMPLETED' ? '#15803D' : '#BE123C', fontWeight: 600 }}>
          {runMeta.status}
        </span>
        <span style={{ fontSize: 11, color: '#64748B' }}>
          {runMeta.rows_in} in → <strong style={{ color: '#0D1117' }}>{runMeta.rows_out}</strong> out
        </span>
      </div>

      {/* Step list */}
      {orderedNodes.map((node, idx) => {
        const audit = audits[node.id];
        const color = nodeColors[node.type] || '#64748B';
        const isExpanded = expandedNode === node.id;
        const isLast = idx === orderedNodes.length - 1;
        const hasDropped = audit && audit.dropped > 0;

        return (
          <div key={node.id}>
            {/* Step row */}
            <div
              onClick={() => {
                setExpandedNode(isExpanded ? null : node.id);
                setExpandedSample(null);
              }}
              style={{
                display: 'flex', alignItems: 'center', gap: 10, padding: '9px 0',
                cursor: 'pointer', borderRadius: 4,
                backgroundColor: isExpanded ? '#F8FAFC' : 'transparent',
              }}
            >
              {/* Node type badge */}
              <div style={{ width: 28, height: 28, borderRadius: 6, backgroundColor: color, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <span style={{ fontSize: 8, fontWeight: 700, color: '#fff', letterSpacing: '0.03em' }}>
                  {node.type.replace('_', ' ').split(' ').map((w: string) => w[0]).join('').slice(0, 3)}
                </span>
              </div>

              {/* Label + type */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12, fontWeight: 500, color: '#0D1117', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{node.label}</div>
                <div style={{ fontSize: 10, color: '#94A3B8' }}>{node.type}</div>
              </div>

              {/* Stats */}
              {audit ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                  <span style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: '#64748B' }}>{audit.rows_in}</span>
                  <ArrowRight size={10} color={hasDropped ? '#F59E0B' : '#94A3B8'} />
                  <span style={{ fontSize: 11, fontFamily: 'var(--font-mono)', fontWeight: 600, color: hasDropped ? '#C2410C' : '#0D1117' }}>{audit.rows_out}</span>
                  {hasDropped && (
                    <span style={{ fontSize: 10, backgroundColor: '#FFF7ED', color: '#C2410C', padding: '1px 5px', borderRadius: 3, border: '1px solid #FED7AA' }}>
                      -{audit.dropped}
                    </span>
                  )}
                  <span style={{ fontSize: 10, color: '#CBD5E1' }}>{audit.duration_ms}ms</span>
                </div>
              ) : (
                <span style={{ fontSize: 10, color: '#CBD5E1' }}>no data</span>
              )}

              <ChevronDown size={12} color="#94A3B8" style={{ transform: isExpanded ? 'rotate(180deg)' : 'none', transition: 'transform 150ms', flexShrink: 0 }} />
            </div>

            {/* Expanded audit detail */}
            {isExpanded && audit && (
              <div style={{ marginLeft: 38, marginBottom: 4, border: '1px solid #E2E8F0', borderRadius: 6, overflow: 'hidden', backgroundColor: '#FAFAFA' }}>
                {/* Node-specific stats */}
                {audit.stats && Object.keys(audit.stats).length > 0 && (
                  <div style={{ padding: '8px 12px', borderBottom: '1px solid #F1F5F9' }}>
                    {audit.node_type === 'FILTER' && (
                      <div style={{ fontSize: 11, color: hasDropped ? '#C2410C' : '#16A34A', fontWeight: 500 }}>
                        <AlertTriangle size={10} style={{ verticalAlign: 'middle', marginRight: 4 }} />
                        {audit.dropped} rows dropped — <span style={{ fontFamily: 'var(--font-mono)', color: '#64748B', fontSize: 10 }}>{String(audit.stats.expression || '').slice(0, 80)}</span>
                      </div>
                    )}
                    {audit.node_type === 'ENRICH' && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <div style={{ flex: 1, height: 5, backgroundColor: '#E2E8F0', borderRadius: 3, overflow: 'hidden' }}>
                          <div style={{ height: '100%', width: `${Math.round(Number(audit.stats.match_rate || 0) * 100)}%`, backgroundColor: Number(audit.stats.match_rate) >= 0.8 ? '#16A34A' : '#F59E0B', borderRadius: 3 }} />
                        </div>
                        <span style={{ fontSize: 11, fontWeight: 600, fontFamily: 'var(--font-mono)', color: '#0D1117' }}>{Math.round(Number(audit.stats.match_rate || 0) * 100)}% matched</span>
                        <span style={{ fontSize: 10, color: '#94A3B8' }}>{String(audit.stats.matched)} / {String(audit.stats.matched + (audit.stats.unmatched as number || 0))}</span>
                      </div>
                    )}
                    {audit.node_type === 'MAP' && audit.stats.mappings && (
                      <div>
                        <div style={{ fontSize: 10, fontWeight: 600, color: '#94A3B8', marginBottom: 4, textTransform: 'uppercase' }}>Field Renames</div>
                        {Object.entries(audit.stats.mappings as Record<string, string>).slice(0, 5).map(([from, to]) => (
                          <div key={from} style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 10, fontFamily: 'var(--font-mono)', marginBottom: 2 }}>
                            <span style={{ color: '#64748B' }}>{from}</span>
                            <ArrowRight size={8} color="#94A3B8" />
                            <span style={{ color: '#0D1117', fontWeight: 500 }}>{to}</span>
                          </div>
                        ))}
                      </div>
                    )}
                    {(audit.node_type === 'DEDUPE') && (
                      <div style={{ fontSize: 11, color: '#6D28D9', fontWeight: 500 }}>
                        {String(audit.stats.duplicates_removed || 0)} duplicates removed
                      </div>
                    )}
                    {(audit.node_type === 'SINK_OBJECT') && (
                      <div style={{ fontSize: 11, color: '#1D4ED8' }}>
                        Written to ontology — {String(audit.stats.write_mode || 'upsert')} mode
                      </div>
                    )}
                  </div>
                )}

                {/* Sample data toggle */}
                <div style={{ display: 'flex', borderBottom: expandedSample ? '1px solid #F1F5F9' : 'none' }}>
                  {(['in', 'out'] as const).map((side) => {
                    const count = side === 'in' ? audit.sample_in.length : audit.sample_out.length;
                    return (
                      <button key={side} onClick={(e) => { e.stopPropagation(); setExpandedSample(expandedSample === side ? null : side); }}
                        style={{
                          flex: 1, padding: '7px 0', fontSize: 11, border: 'none', cursor: 'pointer',
                          backgroundColor: expandedSample === side ? '#EFF6FF' : 'transparent',
                          color: expandedSample === side ? '#2563EB' : '#64748B',
                          fontWeight: expandedSample === side ? 600 : 400,
                          borderRight: side === 'in' ? '1px solid #F1F5F9' : 'none',
                        }}
                      >
                        Sample {side === 'in' ? 'In' : 'Out'} ({count})
                      </button>
                    );
                  })}
                </div>

                {expandedSample && (
                  <div style={{ overflowX: 'auto', maxHeight: 220, overflowY: 'auto' }}>
                    {(() => {
                      const rows = expandedSample === 'in' ? audit.sample_in : audit.sample_out;
                      if (!rows.length) return <div style={{ padding: '12px', fontSize: 11, color: '#94A3B8', textAlign: 'center' }}>No records</div>;
                      const cols = Array.from(new Set(rows.flatMap((r) => Object.keys(r)))).slice(0, 10);
                      return (
                        <table style={{ borderCollapse: 'collapse', fontSize: 10, width: '100%' }}>
                          <thead>
                            <tr style={{ backgroundColor: '#F8FAFC' }}>
                              {cols.map((c) => (
                                <th key={c} style={{ padding: '4px 8px', textAlign: 'left', fontWeight: 600, color: '#64748B', borderBottom: '1px solid #E2E8F0', whiteSpace: 'nowrap', fontFamily: 'var(--font-mono)', fontSize: 9 }}>{c}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {rows.map((row, i) => (
                              <tr key={i} style={{ borderBottom: '1px solid #F8FAFC', backgroundColor: i % 2 === 0 ? '#fff' : '#FAFAFA' }}>
                                {cols.map((c) => {
                                  const v = row[c];
                                  const s = v == null ? '' : String(v);
                                  return (
                                    <td key={c} style={{ padding: '4px 8px', fontFamily: 'var(--font-mono)', maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: s ? '#0D1117' : '#CBD5E1' }} title={s}>
                                      {s || <span style={{ fontStyle: 'italic' }}>null</span>}
                                    </td>
                                  );
                                })}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      );
                    })()}
                  </div>
                )}
              </div>
            )}

            {/* Connector line between steps */}
            {!isLast && (
              <div style={{ marginLeft: 13, width: 2, height: 8, backgroundColor: '#E2E8F0' }} />
            )}
          </div>
        );
      })}

      {orderedNodes.length === 0 && (
        <div style={{ textAlign: 'center', padding: '20px 0', color: '#94A3B8', fontSize: 12 }}>
          Pipeline definition not loaded — open Pipeline Builder to view steps
        </div>
      )}
    </div>
  );
};

// ── Full-screen DB Viewer modal ──────────────────────────────────────────────
// ── Cell value renderer ─────────────────────────────────────────────────────

function CellValue({ val, highlight }: { val: unknown; highlight: boolean }) {
  if (val === null || val === undefined) {
    return <span style={{ color: '#CBD5E1', fontSize: '11px', fontStyle: 'italic' }}>null</span>;
  }
  if (Array.isArray(val)) {
    if (val.length === 0) {
      return <span style={{ color: '#CBD5E1', fontSize: '11px' }}>[ ]</span>;
    }
    return (
      <span style={{
        display: 'inline-flex', alignItems: 'center', gap: 4,
        backgroundColor: '#EFF6FF', color: '#1D4ED8',
        border: '1px solid #BFDBFE', borderRadius: 4,
        padding: '1px 7px', fontSize: '11px', fontWeight: 500, whiteSpace: 'nowrap',
      }}>
        {val.length} {val.length === 1 ? 'item' : 'items'}
      </span>
    );
  }
  const s = String(val);
  return (
    <span style={{ color: highlight ? '#92400E' : '#0D1117' }}>
      {highlight ? (
        <mark style={{ backgroundColor: '#FEF3C7', color: '#92400E', borderRadius: 2, padding: '0 1px' }}>{s}</mark>
      ) : s}
    </span>
  );
}

// ── Expanded field renderer (shows array contents) ────────────────────────

function ExpandedFieldValue({ col, val }: { col: string; val: unknown }) {
  if (val === null || val === undefined) {
    return <span style={{ fontSize: '12px', color: '#CBD5E1', fontStyle: 'italic' }}>null</span>;
  }
  if (Array.isArray(val)) {
    if (val.length === 0) {
      return <span style={{ fontSize: '12px', color: '#CBD5E1' }}>No items</span>;
    }
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 4 }}>
        {(val as Record<string, unknown>[]).map((item, idx) => (
          <div key={idx} style={{
            backgroundColor: '#F0F9FF', border: '1px solid #BAE6FD',
            borderRadius: 4, padding: '8px 10px', fontSize: '11px',
          }}>
            {typeof item === 'object' && item !== null
              ? Object.entries(item).filter(([, v]) => v != null).slice(0, 8).map(([k, v]) => (
                  <div key={k} style={{ display: 'flex', gap: 6, marginBottom: 2 }}>
                    <span style={{ color: '#64748B', fontWeight: 600, flexShrink: 0 }}>{k}:</span>
                    <span style={{ color: '#0D1117', wordBreak: 'break-all' }}>
                      {typeof v === 'object' ? JSON.stringify(v) : String(v)}
                    </span>
                  </div>
                ))
              : String(item)}
          </div>
        ))}
      </div>
    );
  }
  return (
    <span style={{ fontSize: '12px', color: '#0D1117', fontFamily: 'var(--font-mono)', wordBreak: 'break-all', lineHeight: '1.5' }}>
      {String(val)}
    </span>
  );
}

// Colours for semantic type badges in column headers
const SEMANTIC_COLORS: Record<string, { bg: string; text: string }> = {
  IDENTIFIER: { bg: '#EEF2FF', text: '#4338CA' },
  DATETIME:   { bg: '#F0FDF4', text: '#15803D' },
  CURRENCY:   { bg: '#FEF9C3', text: '#854D0E' },
  STATUS:     { bg: '#FFF7ED', text: '#9A3412' },
  CATEGORY:   { bg: '#F5F3FF', text: '#6D28D9' },
  TEXT:       { bg: '#F8FAFC', text: '#475569' },
  QUANTITY:   { bg: '#ECFDF5', text: '#065F46' },
  URL:        { bg: '#EFF6FF', text: '#1D4ED8' },
  PHONE:      { bg: '#FDF4FF', text: '#7E22CE' },
};

/** Normalise a field name for fuzzy matching: strip underscores, lowercase */
function normField(s: string) { return s.replace(/_/g, '').replace(/\[\]$/, '').toLowerCase(); }

/** Build a map from raw record column name → matching ObjectProperty (fuzzy) */
function buildColMap(
  cols: string[],
  props: import('../../types/ontology').ObjectProperty[]
): Record<string, import('../../types/ontology').ObjectProperty | undefined> {
  const out: Record<string, import('../../types/ontology').ObjectProperty | undefined> = {};
  for (const col of cols) {
    const norm = normField(col);
    // Exact name match first
    let match = props.find((p) => p.name === col || p.name === col.replace(/\[\]$/, ''));
    // Fuzzy: normalised names
    if (!match) match = props.find((p) => normField(p.name) === norm);
    // Partial: one contains the other
    if (!match) match = props.find((p) => norm.includes(normField(p.name)) || normField(p.name).includes(norm));
    out[col] = match;
  }
  return out;
}

const DBViewerModal: React.FC<{
  rows: unknown[];
  objectTypeName: string;
  properties?: import('../../types/ontology').ObjectProperty[];
  onClose: () => void;
}> = ({ rows, objectTypeName, properties = [], onClose }) => {
  const [colFilter, setColFilter] = useState('');
  const [rowFilter, setRowFilter] = useState('');
  const [expandedRow, setExpandedRow] = useState<number | null>(null);
  // Union keys across ALL rows (not just rows[0]) so sparse array columns always appear
  const _colSet = new Set<string>();
  rows.forEach((r) => Object.keys(r as Record<string, unknown>).forEach((k) => _colSet.add(k)));
  // Also surface array property names defined on the type even if no row has data yet
  properties.forEach((p) => {
    if (p.dataType === 'array' || p.name.endsWith('[]')) {
      _colSet.add(p.name.endsWith('[]') ? p.name : `${p.name}[]`);
    }
  });
  const allCols = Array.from(_colSet);
  const colMap = buildColMap(allCols, properties);
  const cols = colFilter
    ? allCols.filter((c) => c.toLowerCase().includes(colFilter.toLowerCase()))
    : allCols;

  // Search ignores array fields (can't meaningfully search [object Object])
  const filteredRows = rowFilter
    ? rows.filter((row) =>
        Object.entries(row as Record<string, unknown>).some(([, v]) =>
          !Array.isArray(v) && String(v ?? '').toLowerCase().includes(rowFilter.toLowerCase())
        )
      )
    : rows;

  return createPortal(
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 10000, backgroundColor: 'rgba(0,0,0,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{ width: '99vw', height: '99vh', backgroundColor: '#FFFFFF', borderRadius: '6px', display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: '0 8px 40px rgba(0,0,0,0.18)', border: '1px solid #E2E8F0' }}>
        {/* Header */}
        <div style={{ padding: '10px 16px', borderBottom: '1px solid #E2E8F0', display: 'flex', alignItems: 'center', gap: '12px', flexShrink: 0, backgroundColor: '#F8FAFC' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '14px', fontWeight: 600, color: '#0D1117' }}>{objectTypeName}</span>
            <span style={{ fontSize: '12px', color: '#64748B' }}>
              {filteredRows.length} rows · {cols.length}{cols.length !== allCols.length ? `/${allCols.length}` : ''} columns
            </span>
            {properties.length > 0 && (() => {
              const SYSTEM_COLS = new Set(['_pipeline_id', '_pipeline_run_at', '_pipeline_name', '_synced_at']);
              const userCols = allCols.filter((c) => !SYSTEM_COLS.has(c));
              const mapped = userCols.filter((c) => colMap[c]).length;
              const unmapped = userCols.length - mapped;
              return unmapped > 0 ? (
                <span style={{ fontSize: '11px', backgroundColor: '#FFFBEB', color: '#B45309', border: '1px solid #FDE68A', padding: '2px 8px', borderRadius: '3px', fontWeight: 500 }}>
                  {unmapped} column{unmapped > 1 ? 's' : ''} unmapped · {mapped} mapped
                </span>
              ) : (
                <span style={{ fontSize: '11px', backgroundColor: '#F0FDF4', color: '#15803D', border: '1px solid #BBF7D0', padding: '2px 8px', borderRadius: '3px', fontWeight: 500 }}>
                  all {mapped} columns mapped
                </span>
              );
            })()}
          </div>
          <div style={{ display: 'flex', gap: '8px', marginLeft: 'auto', alignItems: 'center' }}>
            {/* Column filter */}
            <div style={{ position: 'relative' }}>
              <Search size={12} style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', color: '#94A3B8' }} />
              <input
                value={colFilter}
                onChange={(e) => setColFilter(e.target.value)}
                placeholder="filter columns…"
                style={{ height: '30px', paddingLeft: '26px', paddingRight: '10px', backgroundColor: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: '4px', color: '#0D1117', fontSize: '12px', outline: 'none', width: '160px' }}
              />
            </div>
            {/* Row search */}
            <div style={{ position: 'relative' }}>
              <Search size={12} style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', color: '#94A3B8' }} />
              <input
                value={rowFilter}
                onChange={(e) => setRowFilter(e.target.value)}
                placeholder="search values…"
                style={{ height: '30px', paddingLeft: '26px', paddingRight: '10px', backgroundColor: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: '4px', color: '#0D1117', fontSize: '12px', outline: 'none', width: '180px' }}
              />
            </div>
            <button onClick={onClose} style={{ height: '30px', width: '30px', backgroundColor: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: '4px', color: '#64748B', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <X size={14} />
            </button>
          </div>
        </div>

        {/* Table */}
        <div style={{ flex: 1, overflow: 'auto' }}>
          <table style={{ borderCollapse: 'collapse', fontSize: '12px', width: '100%' }}>
            <thead style={{ position: 'sticky', top: 0, zIndex: 1 }}>
              <tr style={{ backgroundColor: '#F8FAFC' }}>
                <th style={{ padding: '7px 10px', width: '36px', textAlign: 'center', color: '#94A3B8', borderBottom: '1px solid #E2E8F0', fontSize: '11px', fontWeight: 400 }}>#</th>
                {cols.map((c) => {
                  const prop = colMap[c];
                  const sc = prop ? (SEMANTIC_COLORS[prop.semanticType] || SEMANTIC_COLORS.TEXT) : null;
                  const mapped = !!prop;
                  return (
                    <th key={c} style={{ padding: '7px 12px', textAlign: 'left', fontWeight: 600, borderBottom: '1px solid #E2E8F0', whiteSpace: 'nowrap', fontSize: '11px', borderRight: '1px solid #F1F5F9', backgroundColor: mapped ? undefined : '#FFFBEB' }}>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                        <span style={{ fontFamily: 'var(--font-mono)', color: mapped ? '#475569' : '#B45309' }}>{c}</span>
                        {prop ? (
                          <span style={{ fontSize: '9px', fontWeight: 700, padding: '1px 4px', borderRadius: '2px', backgroundColor: sc!.bg, color: sc!.text, letterSpacing: '0.04em', fontFamily: 'var(--font-interface)' }}>
                            {prop.semanticType}
                          </span>
                        ) : (
                          <span style={{ fontSize: '9px', fontWeight: 600, color: '#B45309', fontFamily: 'var(--font-interface)' }}>
                            unmapped
                          </span>
                        )}
                      </div>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {filteredRows.map((row, i) => {
                const isExpanded = expandedRow === i;
                const rowData = row as Record<string, unknown>;
                return (
                  <React.Fragment key={i}>
                    <tr
                      onClick={() => setExpandedRow(isExpanded ? null : i)}
                      style={{ borderBottom: '1px solid #F1F5F9', cursor: 'pointer', backgroundColor: isExpanded ? '#EFF6FF' : i % 2 === 0 ? '#FFFFFF' : '#FAFAFA' }}
                      onMouseEnter={(e) => { if (!isExpanded) (e.currentTarget as HTMLElement).style.backgroundColor = '#F8FAFC'; }}
                      onMouseLeave={(e) => { if (!isExpanded) (e.currentTarget as HTMLElement).style.backgroundColor = i % 2 === 0 ? '#FFFFFF' : '#FAFAFA'; }}
                    >
                      <td style={{ padding: '6px 10px', textAlign: 'center', color: '#CBD5E1', fontFamily: 'var(--font-mono)', fontSize: '11px' }}>{i + 1}</td>
                      {cols.map((c) => {
                        const val = rowData[c];
                        const highlight = rowFilter && !Array.isArray(val) && String(val ?? '').toLowerCase().includes(rowFilter.toLowerCase());
                        return (
                          <td key={c} style={{ padding: '6px 12px', maxWidth: '240px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontFamily: 'var(--font-mono)', fontSize: '12px', borderRight: '1px solid #F1F5F9', backgroundColor: highlight ? '#FEF3C7' : undefined }}>
                            <CellValue val={val} highlight={!!highlight} />
                          </td>
                        );
                      })}
                    </tr>
                    {isExpanded && (
                      <tr style={{ backgroundColor: '#F8FAFC', borderBottom: '1px solid #BAE6FD' }}>
                        <td colSpan={cols.length + 1} style={{ padding: '14px 20px' }}>
                          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '10px' }}>
                            {allCols.map((c) => {
                              const val = rowData[c];
                              const isArray = Array.isArray(val);
                              return (
                                <div
                                  key={c}
                                  style={{
                                    gridColumn: isArray && (val as unknown[]).length > 0 ? 'span 2' : undefined,
                                    display: 'flex', flexDirection: 'column', gap: '4px',
                                    backgroundColor: '#FFFFFF', border: '1px solid #E2E8F0',
                                    borderRadius: '6px', padding: '10px 12px',
                                  }}
                                >
                                  <span style={{ fontSize: '10px', fontWeight: 600, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.04em', fontFamily: 'var(--font-mono)' }}>
                                    {c}
                                    {isArray && (
                                      <span style={{ marginLeft: 6, backgroundColor: '#EFF6FF', color: '#1D4ED8', border: '1px solid #BFDBFE', borderRadius: 3, padding: '0 5px', fontSize: '9px', fontWeight: 600 }}>
                                        {(val as unknown[]).length}
                                      </span>
                                    )}
                                  </span>
                                  <ExpandedFieldValue col={c} val={val} />
                                </div>
                              );
                            })}
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Footer */}
        <div style={{ padding: '7px 16px', borderTop: '1px solid #E2E8F0', backgroundColor: '#F8FAFC', display: 'flex', gap: '16px', fontSize: '11px', color: '#94A3B8', flexShrink: 0, alignItems: 'center' }}>
          <span><strong style={{ color: '#475569' }}>{filteredRows.length}</strong> rows</span>
          <span><strong style={{ color: '#475569' }}>{allCols.length}</strong> columns</span>
          {rowFilter && <span style={{ color: '#D97706' }}>matching "{rowFilter}"</span>}
          {colFilter && <span style={{ color: '#2563EB' }}>columns containing "{colFilter}"</span>}
          <span style={{ marginLeft: 'auto' }}>click any row to expand all fields</span>
        </div>
      </div>
    </div>
  , document.body);
};

const DataTab: React.FC<{
  rows: unknown[];
  loading: boolean;
  error: string | null;
  hasConnectors: boolean;
  objectTypeName: string;
  arrayProperties?: import('../../types/ontology').ObjectProperty[];
  properties?: import('../../types/ontology').ObjectProperty[];
  onSync?: () => void;
  syncing?: boolean;
  dataSource?: 'persisted' | 'live';
  isPipelineBacked?: boolean;
  pipelineName?: string;
}> = ({ rows, loading, error, hasConnectors, objectTypeName, arrayProperties = [], properties = [], onSync, syncing, dataSource, isPipelineBacked, pipelineName }) => {
  const [modalOpen, setModalOpen] = useState(false);

  if (!hasConnectors) {
    return (
      <div style={{ textAlign: 'center', padding: '40px 0', color: '#94A3B8', fontSize: '13px' }}>
        No source connectors configured — connect a data source first
      </div>
    );
  }
  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: '40px 0', color: '#60A5FA', fontSize: '13px' }}>
        Fetching records…
      </div>
    );
  }
  if (error) {
    return (
      <div style={{ padding: '12px', backgroundColor: '#FEF2F2', border: '1px solid #FECACA', borderRadius: '4px', fontSize: '12px', color: '#991B1B' }}>
        {error}
      </div>
    );
  }
  if (rows.length === 0) {
    return (
      <div style={{ textAlign: 'center', padding: '40px 0', color: '#94A3B8', fontSize: '13px', display: 'flex', flexDirection: 'column', gap: '12px', alignItems: 'center' }}>
        {isPipelineBacked ? (
          <>
            <GitBranch size={24} style={{ color: '#D97706' }} />
            <span>No records yet — run the pipeline to populate this object type</span>
            {onSync && (
              <button
                onClick={onSync}
                disabled={syncing}
                style={{
                  height: '32px', padding: '0 16px', borderRadius: '4px',
                  border: 'none', backgroundColor: '#D97706',
                  color: '#FFFFFF', fontSize: '12px', fontWeight: 600,
                  cursor: syncing ? 'wait' : 'pointer', display: 'flex', alignItems: 'center', gap: '6px',
                }}
              >
                <Play size={12} />
                {syncing ? 'Running…' : `Run ${pipelineName || 'Pipeline'}`}
              </button>
            )}
          </>
        ) : (
          <span>No sample data available from connector</span>
        )}
      </div>
    );
  }

  // Union keys across all rows + always include defined array property names
  const _previewColSet = new Set<string>();
  rows.forEach((r) => Object.keys(r as Record<string, unknown>).forEach((k) => _previewColSet.add(k)));
  arrayProperties.forEach((p) => {
    _previewColSet.add(p.name.endsWith('[]') ? p.name : `${p.name}[]`);
  });
  const cols = Array.from(_previewColSet);
  const preview = rows.slice(0, 3);

  return (
    <>
      {modalOpen && <DBViewerModal rows={rows} objectTypeName={objectTypeName} properties={properties} onClose={() => setModalOpen(false)} />}

      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {/* Header row: expand button + source badge + sync button */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <div
            onClick={() => setModalOpen(true)}
            style={{ flex: 1, display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', padding: '6px 8px', borderRadius: '4px', border: '1px solid #E2E8F0', backgroundColor: '#F8FAFC', transition: 'background 80ms' }}
            onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#EFF6FF')}
            onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = '#F8FAFC')}
          >
            <Maximize2 size={12} color="#2563EB" />
            <span style={{ fontSize: '12px', fontWeight: 500, color: '#2563EB' }}>
              {rows.length} records · {cols.length} columns
            </span>
            {dataSource === 'persisted' && (
              <span style={{ fontSize: '10px', color: '#059669', backgroundColor: '#ECFDF5', padding: '1px 5px', borderRadius: '2px', marginLeft: '2px' }}>saved</span>
            )}
            {dataSource === 'live' && (
              <span style={{ fontSize: '10px', color: '#D97706', backgroundColor: '#FFFBEB', padding: '1px 5px', borderRadius: '2px', marginLeft: '2px' }}>live preview · run sync to persist</span>
            )}
          </div>
          {onSync && (
            <button
              onClick={onSync}
              disabled={syncing}
              title={isPipelineBacked ? `Run pipeline to refresh records` : 'Pull from all source connectors and save merged records'}
              style={{
                height: '32px', padding: '0 12px', borderRadius: '4px', flexShrink: 0,
                border: `1px solid ${isPipelineBacked ? '#D97706' : '#2563EB'}`,
                backgroundColor: syncing ? '#FEF3C7' : isPipelineBacked ? '#D97706' : '#2563EB',
                color: syncing ? '#92400E' : '#FFFFFF', fontSize: '12px', fontWeight: 500,
                cursor: syncing ? 'wait' : 'pointer', whiteSpace: 'nowrap',
                display: 'flex', alignItems: 'center', gap: '5px',
              }}
            >
              {isPipelineBacked ? <Play size={11} /> : null}
              {syncing ? (isPipelineBacked ? 'Running…' : 'Syncing…') : isPipelineBacked ? 'Run Pipeline' : '↻ Sync'}
            </button>
          )}
        </div>

        {/* Preview table (3 rows) */}
        <div style={{ overflowX: 'auto', border: '1px solid #E2E8F0', borderRadius: '4px' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '11px' }}>
            <thead>
              <tr style={{ backgroundColor: '#F8FAFC' }}>
                {cols.map((c) => (
                  <th key={c} style={{ padding: '5px 8px', textAlign: 'left', fontWeight: 600, color: '#64748B', borderBottom: '1px solid #E2E8F0', whiteSpace: 'nowrap', fontFamily: 'var(--font-mono)', fontSize: '10px' }}>
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {preview.map((row, i) => (
                <tr key={i} onClick={() => setModalOpen(true)} style={{ borderBottom: i < preview.length - 1 ? '1px solid #F1F5F9' : 'none', cursor: 'pointer' }}>
                  {cols.map((c) => {
                    const val = (row as Record<string, unknown>)[c];
                    const display = val === null || val === undefined ? '' : String(val);
                    return (
                      <td key={c} style={{ padding: '5px 8px', color: '#0D1117', maxWidth: '160px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontFamily: 'var(--font-mono)', fontSize: '11px' }} title={display}>
                        {display || <span style={{ color: '#CBD5E1' }}>—</span>}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div style={{ fontSize: '11px', color: '#94A3B8', textAlign: 'right' }}>
          showing 3 of {rows.length} rows — <span style={{ color: '#2563EB', cursor: 'pointer', textDecoration: 'underline' }} onClick={() => setModalOpen(true)}>view all {rows.length}</span>
        </div>

        {arrayProperties.length > 0 && (
          <div style={{ marginTop: '16px', border: '1px solid #EDE9FE', borderRadius: '4px', overflow: 'hidden' }}>
            <div style={{ padding: '7px 12px', backgroundColor: '#F5F3FF', borderBottom: '1px solid #EDE9FE', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span style={{ fontSize: '11px', fontWeight: 600, color: '#6D28D9' }}>Nested Array Properties</span>
              <span style={{ fontSize: '10px', color: '#7C3AED', backgroundColor: '#EDE9FE', padding: '1px 5px', borderRadius: '2px' }}>not in flat table</span>
            </div>
            {arrayProperties.map((p) => {
              const propName = p.name.endsWith('[]') ? p.name : `${p.name}[]`;
              return (
                <div key={p.id} style={{ padding: '8px 12px', borderBottom: '1px solid #F5F3FF', display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <span style={{ fontSize: '12px', fontFamily: 'var(--font-mono)', fontWeight: 600, color: '#6D28D9' }}>{propName}</span>
                  <span style={{ fontSize: '11px', color: '#94A3B8', flex: 1 }}>
                    {p.description || 'Nested array — linked records from a separate connector'}
                  </span>
                  <span style={{ fontSize: '10px', color: '#94A3B8', fontFamily: 'var(--font-mono)', backgroundColor: '#F8FAFC', padding: '1px 6px', borderRadius: '2px', border: '1px solid #E2E8F0', whiteSpace: 'nowrap' }}>
                    {p.sourceConnectorId ? `source: ${p.sourceConnectorId.slice(0, 8)}…` : 'nested'}
                  </span>
                </div>
              );
            })}
            <div style={{ padding: '6px 12px', backgroundColor: '#FAFAFA' }}>
              <span style={{ fontSize: '10px', color: '#94A3B8' }}>
                Array properties contain nested records from linked connectors and are joined at query time — they don't appear as flat columns
              </span>
            </div>
          </div>
        )}
      </div>
    </>
  );
};

const VersionHistory: React.FC<{ versions: ObjectTypeVersion[]; currentVersion: number }> = ({
  versions, currentVersion,
}) => {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  if (versions.length === 0) {
    return (
      <div style={{ textAlign: 'center', padding: '40px 0', color: '#94A3B8', fontSize: '13px' }}>
        No version history available
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
      {versions.map((v) => {
        const isCurrent = v.version === currentVersion;
        const isExpanded = expandedId === v.id;

        return (
          <div key={v.id} style={{
            border: `1px solid ${isCurrent ? '#2563EB' : '#E2E8F0'}`,
            borderRadius: '4px', overflow: 'hidden',
          }}>
            <div
              onClick={() => setExpandedId(isExpanded ? null : v.id)}
              style={{
                padding: '10px 12px',
                display: 'flex', alignItems: 'center', gap: '10px',
                cursor: 'pointer', backgroundColor: isCurrent ? '#EFF6FF' : '#FFFFFF',
              }}
            >
              <GitCommit size={14} color={isCurrent ? '#2563EB' : '#94A3B8'} />
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span style={{ fontSize: '12px', fontWeight: 600, fontFamily: 'var(--font-mono)', color: '#0D1117' }}>
                    v{v.version}
                  </span>
                  {isCurrent && (
                    <span style={{ fontSize: '10px', color: '#2563EB', backgroundColor: '#DBEAFE', padding: '1px 5px', borderRadius: '2px' }}>
                      current
                    </span>
                  )}
                </div>
                <div style={{ fontSize: '11px', color: '#64748B', marginTop: '1px' }}>
                  {v.changeDescription || 'Schema update'} · {new Date(v.createdAt).toLocaleDateString()}
                </div>
              </div>
              {isExpanded ? <ChevronUp size={14} color="#94A3B8" /> : <ChevronDown size={14} color="#94A3B8" />}
            </div>

            {isExpanded && (
              <div style={{ padding: '10px 12px', borderTop: '1px solid #E2E8F0', backgroundColor: '#FAFAFA' }}>
                <div style={{ fontSize: '11px', color: '#64748B', marginBottom: '6px' }}>
                  Created by {v.createdBy} on {new Date(v.createdAt).toLocaleString()}
                </div>
                <div style={{ fontSize: '12px', color: '#0D1117', fontWeight: 500 }}>
                  {v.snapshot.properties.length} properties
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};

export default ObjectTypePanel;
