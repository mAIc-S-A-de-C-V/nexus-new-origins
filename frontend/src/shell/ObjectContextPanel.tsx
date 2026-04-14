import React from 'react';
import { X, ExternalLink, Workflow, Bot, Plug, Network } from 'lucide-react';
import { useUiStore } from '../store/uiStore';
import { useNavigationStore } from '../store/navigationStore';

const TYPE_META = {
  objectType: { label: 'Object Type', icon: <Network size={14} />, color: '#1A3C6E', page: 'ontology' },
  pipeline:   { label: 'Pipeline',    icon: <Workflow size={14} />, color: '#7C3AED', page: 'pipelines' },
  agent:      { label: 'Agent',       icon: <Bot size={14} />,      color: '#059669', page: 'agents' },
  connector:  { label: 'Connector',   icon: <Plug size={14} />,     color: '#D97706', page: 'connectors' },
} as const;

export const ObjectContextPanel: React.FC = () => {
  const { activeObjectPanel, closeObjectPanel } = useUiStore();
  const { navigateTo } = useNavigationStore();

  if (!activeObjectPanel) return null;

  const meta = TYPE_META[activeObjectPanel.type];

  return (
    <>
      {/* Backdrop — click to close */}
      <div
        onClick={closeObjectPanel}
        style={{
          position: 'fixed', inset: 0,
          zIndex: 499,
          backgroundColor: 'transparent',
        }}
      />

      {/* Panel */}
      <div style={{
        position: 'fixed', right: 0, top: 0, bottom: 0,
        width: 480,
        backgroundColor: 'var(--color-surface)',
        borderLeft: '1px solid var(--color-border)',
        boxShadow: '-8px 0 32px rgba(0,0,0,0.12)',
        zIndex: 500,
        display: 'flex', flexDirection: 'column',
        animation: 'slideInRight 120ms ease-out',
      }}>
        {/* Header */}
        <div style={{
          height: 52,
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '0 16px',
          borderBottom: '1px solid var(--color-border)',
          flexShrink: 0,
        }}>
          <span style={{ color: meta.color, lineHeight: 0, flexShrink: 0 }}>
            {meta.icon}
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--color-text-subtle)' }}>
              {meta.label}
            </div>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {activeObjectPanel.label || activeObjectPanel.id}
            </div>
          </div>
          <button
            onClick={() => { navigateTo(meta.page); closeObjectPanel(); }}
            title={`Open in ${meta.label}`}
            style={{
              display: 'flex', alignItems: 'center', gap: 5,
              fontSize: 11, fontWeight: 500,
              color: 'var(--color-interactive)',
              backgroundColor: 'var(--color-interactive-dim)',
              border: '1px solid var(--color-interactive-border)',
              borderRadius: 4, padding: '4px 10px', cursor: 'pointer',
              transition: 'opacity 80ms',
              flexShrink: 0,
            }}
          >
            <ExternalLink size={11} />
            View in {meta.label}
          </button>
          <button
            onClick={closeObjectPanel}
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              color: 'var(--color-text-muted)', padding: 4,
              display: 'flex', alignItems: 'center',
            }}
          >
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: 20 }}>
          <PanelBody type={activeObjectPanel.type} id={activeObjectPanel.id} />
        </div>
      </div>
    </>
  );
};

// ── Panel body by type ────────────────────────────────────────────────────────

const PanelBody: React.FC<{ type: string; id: string }> = ({ type, id }) => {
  switch (type) {
    case 'pipeline':
      return <PipelinePanelBody id={id} />;
    case 'agent':
      return <AgentPanelBody id={id} />;
    case 'connector':
      return <ConnectorPanelBody id={id} />;
    case 'objectType':
      return <ObjectTypePanelBody id={id} />;
    default:
      return <PlaceholderBody label={type} id={id} />;
  }
};

const Row: React.FC<{ label: string; value: React.ReactNode }> = ({ label, value }) => (
  <div style={{
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    padding: '8px 0', borderBottom: '1px solid var(--color-border)',
    fontSize: 12,
  }}>
    <span style={{ color: 'var(--color-text-muted)', fontWeight: 500 }}>{label}</span>
    <span style={{ color: 'var(--color-text)' }}>{value}</span>
  </div>
);

const PipelinePanelBody: React.FC<{ id: string }> = ({ id }) => {
  const [pipeline, setPipeline] = React.useState<Record<string, unknown> | null>(null);
  const PIPELINE_API = import.meta.env.VITE_PIPELINE_SERVICE_URL || 'http://localhost:8002';
  const { getTenantId } = { getTenantId: () => '' };

  React.useEffect(() => {
    fetch(`${PIPELINE_API}/pipelines/${id}`, { headers: { 'x-tenant-id': (window as unknown as Record<string,unknown>).__tenantId as string || '' } })
      .then(r => r.ok ? r.json() : null)
      .then(setPipeline)
      .catch(() => {});
  }, [id]);

  if (!pipeline) return <LoadingState />;
  const nodes = (pipeline.nodes as unknown[])?.length ?? 0;
  const edges = (pipeline.edges as unknown[])?.length ?? 0;

  return (
    <div>
      <Row label="Name" value={<strong>{pipeline.name as string}</strong>} />
      <Row label="Nodes" value={nodes} />
      <Row label="Connections" value={edges} />
      <Row label="Status" value={
        <span style={{
          fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 10,
          backgroundColor: 'var(--color-status-green-dim)',
          color: 'var(--color-status-green)',
          border: '1px solid var(--color-status-green-border)',
        }}>Active</span>
      } />
    </div>
  );
};

const AgentPanelBody: React.FC<{ id: string }> = ({ id }) => {
  const [agent, setAgent] = React.useState<Record<string, unknown> | null>(null);
  const AGENT_API = import.meta.env.VITE_AGENT_SERVICE_URL || 'http://localhost:8013';

  React.useEffect(() => {
    fetch(`${AGENT_API}/agents/${id}`, { headers: { 'x-tenant-id': (window as unknown as Record<string,unknown>).__tenantId as string || '' } })
      .then(r => r.ok ? r.json() : null)
      .then(setAgent)
      .catch(() => {});
  }, [id]);

  if (!agent) return <LoadingState />;
  const tools = (agent.enabled_tools as string[]) ?? [];

  return (
    <div>
      <Row label="Name" value={<strong>{agent.name as string}</strong>} />
      <Row label="Model" value={<span style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>{agent.model as string}</span>} />
      <Row label="Max iterations" value={agent.max_iterations as number} />
      <Row label="Status" value={
        <span style={{
          fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 10,
          backgroundColor: agent.enabled ? 'var(--color-status-green-dim)' : 'var(--color-base)',
          color: agent.enabled ? 'var(--color-status-green)' : 'var(--color-text-muted)',
          border: `1px solid ${agent.enabled ? 'var(--color-status-green-border)' : 'var(--color-border)'}`,
        }}>{agent.enabled ? 'enabled' : 'disabled'}</span>
      } />
      {tools.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--color-text-subtle)', marginBottom: 6 }}>
            Tools ({tools.length})
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {tools.map((t) => (
              <span key={t} style={{
                fontSize: 10, fontFamily: 'var(--font-mono)', padding: '2px 8px',
                borderRadius: 3, backgroundColor: 'var(--color-brand-dim)',
                color: 'var(--color-brand)', border: '1px solid var(--color-brand-border)',
              }}>{t}</span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

const ConnectorPanelBody: React.FC<{ id: string }> = ({ id }) => {
  const [conn, setConn] = React.useState<Record<string, unknown> | null>(null);
  const CONNECTOR_API = import.meta.env.VITE_CONNECTOR_SERVICE_URL || 'http://localhost:8001';

  React.useEffect(() => {
    fetch(`${CONNECTOR_API}/connectors/${id}`, { headers: { 'x-tenant-id': (window as unknown as Record<string,unknown>).__tenantId as string || '' } })
      .then(r => r.ok ? r.json() : null)
      .then(setConn)
      .catch(() => {});
  }, [id]);

  if (!conn) return <LoadingState />;

  return (
    <div>
      <Row label="Name" value={<strong>{conn.name as string}</strong>} />
      <Row label="Type" value={conn.connector_type as string} />
      <Row label="Base URL" value={
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, wordBreak: 'break-all' }}>
          {conn.base_url as string}
        </span>
      } />
    </div>
  );
};

const ObjectTypePanelBody: React.FC<{ id: string }> = ({ id }) => {
  return (
    <div style={{ fontSize: 13, color: 'var(--color-text-muted)', textAlign: 'center', paddingTop: 32 }}>
      <Network size={32} style={{ display: 'block', margin: '0 auto 12px', color: 'var(--color-border)' }} />
      <div style={{ fontWeight: 600, color: 'var(--color-text)', marginBottom: 4 }}>{id}</div>
      <div style={{ fontSize: 12 }}>Open in Ontology for full details</div>
    </div>
  );
};

const PlaceholderBody: React.FC<{ label: string; id: string }> = ({ label, id }) => (
  <div style={{ padding: 16, fontSize: 12, color: 'var(--color-text-muted)' }}>
    <strong>{label}</strong>: {id}
  </div>
);

const LoadingState: React.FC = () => (
  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 40 }}>
    <div style={{
      width: 20, height: 20,
      border: '2px solid var(--color-border)',
      borderTopColor: 'var(--color-brand)',
      borderRadius: '50%',
      animation: 'spin 0.6s linear infinite',
    }} />
  </div>
);

export default ObjectContextPanel;
