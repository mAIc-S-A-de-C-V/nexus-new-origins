import React, { useState, useEffect } from 'react';
import { X, Zap, ExternalLink, Cpu, Trash2, GitBranch, Activity } from 'lucide-react';
import { ConnectorConfig } from '../../types/connector';
import { Badge } from '../../design-system/components/Badge';
import { Button } from '../../design-system/components/Button';
import { StatusDot } from '../../design-system/components/StatusDot';
import { ConnectorHealthBar } from './ConnectorHealthBar';
import { useConnectorStore } from '../../store/connectorStore';
import { usePipelineStore } from '../../store/pipelineStore';
import { useOntologyStore } from '../../store/ontologyStore';
import { useNavigationStore } from '../../store/navigationStore';
import { useInferenceStore } from '../../store/inferenceStore';
import { ObjectType, ObjectProperty } from '../../types/ontology';
import { Pipeline, PipelineNode, PipelineEdge } from '../../types/pipeline';

type TabId = 'overview' | 'configuration' | 'pipelines' | 'schema' | 'health';

const CONNECTOR_API = import.meta.env.VITE_CONNECTOR_SERVICE_URL || 'http://localhost:8001';
const INFERENCE_API = import.meta.env.VITE_INFERENCE_SERVICE_URL || 'http://localhost:8003';
const CORRELATION_API = import.meta.env.VITE_CORRELATION_ENGINE_URL || 'http://localhost:8008';
const ONTOLOGY_API = import.meta.env.VITE_ONTOLOGY_SERVICE_URL || 'http://localhost:8004';

interface ConnectorDetailPanelProps {
  connector: ConnectorConfig;
  onClose: () => void;
}

const TABS: { id: TabId; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'configuration', label: 'Configuration' },
  { id: 'pipelines', label: 'Pipelines' },
  { id: 'schema', label: 'Schema' },
  { id: 'health', label: 'Health' },
];

export const ConnectorDetailPanel: React.FC<ConnectorDetailPanelProps> = ({
  connector,
  onClose,
}) => {
  const [activeTab, setActiveTab] = useState<TabId>('overview');
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string; latency_ms: number } | null>(null);
  const [visible, setVisible] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const { removeConnector } = useConnectorStore();
  const { pipelines, fetchPipelines } = usePipelineStore();

  useEffect(() => {
    setVisible(true);
    setActiveTab('overview');
    setTestResult(null);
    setConfirmDelete(false);
    fetchPipelines();
  }, [connector.id]);

  const handleClose = () => {
    setVisible(false);
    setTimeout(onClose, 120);
  };

  const handleDelete = async () => {
    if (!confirmDelete) { setConfirmDelete(true); return; }
    setDeleting(true);
    try {
      await removeConnector(connector.id);
      handleClose();
    } catch {
      setDeleting(false);
      setConfirmDelete(false);
    }
  };

  const handleTestConnection = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch(`${CONNECTOR_API}/connectors/${connector.id}/test`, { method: 'POST' });
      const data = await res.json();
      setTestResult({ success: data.success, message: data.message, latency_ms: data.latency_ms });
    } catch (err: unknown) {
      setTestResult({ success: false, message: String(err), latency_ms: 0 });
    } finally {
      setTesting(false);
    }
  };

  const healthHistory: never[] = [];
  const pipelinesForConnector = pipelines.filter((p) => p.connectorIds?.includes(connector.id));

  const formatDate = (ts?: string) => {
    if (!ts) return '—';
    return new Date(ts).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  };

  return (
    <div style={{
      position: 'relative',
      width: '60%',
      minWidth: '480px',
      maxWidth: '860px',
      height: '100%',
      backgroundColor: '#FFFFFF',
      borderLeft: '1px solid #E2E8F0',
      display: 'flex',
      flexDirection: 'column',
      transform: visible ? 'translateX(0)' : 'translateX(100%)',
      transition: 'transform 120ms ease-out',
      flexShrink: 0,
      zIndex: 20,
    }}>
      {/* Header */}
      <div style={{
        padding: '16px 20px',
        borderBottom: '1px solid #E2E8F0',
        display: 'flex',
        alignItems: 'flex-start',
        gap: '12px',
        flexShrink: 0,
        backgroundColor: '#FFFFFF',
      }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
            <h2 style={{ fontSize: '16px', fontWeight: 600, color: '#0D1117' }}>
              {connector.name}
            </h2>
            <Badge label={connector.category} variant="category" />
            <StatusDot status={connector.status} showLabel size={8} />
          </div>
          <p style={{ fontSize: '12px', color: '#64748B' }}>
            {connector.description || `${connector.type} connector`}
          </p>
        </div>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexShrink: 0 }}>
          <Button
            variant="secondary"
            size="sm"
            icon={<Zap size={12} />}
            onClick={handleTestConnection}
            loading={testing}
          >
            Test
          </Button>
          <Button variant="primary" size="sm" icon={<ExternalLink size={12} />} onClick={() => setActiveTab('configuration')}>
            Configure
          </Button>
          <button
            onClick={handleDelete}
            disabled={deleting}
            title={confirmDelete ? 'Click again to confirm delete' : 'Delete connector'}
            style={{
              height: 28, padding: '0 10px',
              borderRadius: '4px',
              border: `1px solid ${confirmDelete ? '#FCA5A5' : '#E2E8F0'}`,
              backgroundColor: confirmDelete ? '#FEF2F2' : '#FFFFFF',
              color: confirmDelete ? '#DC2626' : '#94A3B8',
              fontSize: '12px', fontWeight: confirmDelete ? 500 : 400,
              display: 'flex', alignItems: 'center', gap: '4px',
              cursor: deleting ? 'wait' : 'pointer',
              transition: 'all 80ms',
              whiteSpace: 'nowrap',
            }}
            onMouseEnter={(e) => { if (!confirmDelete) (e.currentTarget as HTMLElement).style.borderColor = '#FCA5A5'; (e.currentTarget as HTMLElement).style.color = '#DC2626'; }}
            onMouseLeave={(e) => { if (!confirmDelete) { (e.currentTarget as HTMLElement).style.borderColor = '#E2E8F0'; (e.currentTarget as HTMLElement).style.color = '#94A3B8'; } }}
          >
            <Trash2 size={12} />
            {confirmDelete ? 'Confirm?' : ''}
          </button>
          <button
            onClick={handleClose}
            style={{
              width: 28, height: 28, borderRadius: '4px',
              border: '1px solid #E2E8F0', backgroundColor: '#FFFFFF',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              cursor: 'pointer', color: '#64748B',
              transition: 'background-color 80ms',
            }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = '#F8F9FA'; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = '#FFFFFF'; }}
          >
            <X size={14} />
          </button>
        </div>
      </div>

      {testResult && (
        <div style={{
          padding: '8px 20px',
          backgroundColor: testResult.success ? '#ECFDF5' : '#FEF2F2',
          borderBottom: '1px solid #E2E8F0',
          fontSize: '12px',
          color: testResult.success ? '#065F46' : '#991B1B',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '6px',
        }}>
          <span>{testResult.success ? 'OK' : 'Failed'}: {testResult.message}</span>
          {testResult.latency_ms > 0 && (
            <span style={{ color: testResult.success ? '#059669' : '#DC2626', fontFamily: 'var(--font-mono)', fontSize: '11px' }}>
              {testResult.latency_ms}ms
            </span>
          )}
        </div>
      )}

      {/* Tabs */}
      <div style={{
        display: 'flex',
        borderBottom: '1px solid #E2E8F0',
        padding: '0 20px',
        backgroundColor: '#FFFFFF',
        flexShrink: 0,
      }}>
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            style={{
              height: '36px',
              padding: '0 12px',
              fontSize: '13px',
              fontWeight: activeTab === tab.id ? 500 : 400,
              color: activeTab === tab.id ? '#2563EB' : '#64748B',
              borderBottom: activeTab === tab.id ? '2px solid #2563EB' : '2px solid transparent',
              backgroundColor: 'transparent',
              cursor: 'pointer',
              transition: 'color 80ms, border-color 80ms',
              whiteSpace: 'nowrap',
            }}
          >
            {tab.label}
            {tab.id === 'pipelines' && pipelinesForConnector.length > 0 && (
              <span style={{
                marginLeft: '5px', fontSize: '11px',
                backgroundColor: '#F1F5F9', color: '#64748B',
                padding: '1px 5px', borderRadius: '2px',
              }}>
                {pipelinesForConnector.length}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '20px' }}>
        {activeTab === 'overview' && (
          <OverviewTab connector={connector} formatDate={formatDate} />
        )}
        {activeTab === 'configuration' && (
          <ConfigurationTab connector={connector} testResult={testResult} onTest={handleTestConnection} testing={testing} />
        )}
        {activeTab === 'pipelines' && (
          <PipelinesTab pipelines={pipelinesForConnector} formatDate={formatDate} connectorId={connector.id} />
        )}
        {activeTab === 'schema' && (
          <SchemaTab connector={connector} />
        )}
        {activeTab === 'health' && (
          <HealthTab healthHistory={healthHistory} connector={connector} />
        )}
      </div>
    </div>
  );
};

const SYNC_OPTIONS = [
  { value: 'manual', label: 'Manual only' },
  { value: '1h', label: 'Every 1 hour' },
  { value: '6h', label: 'Every 6 hours' },
  { value: '12h', label: 'Every 12 hours' },
  { value: '24h', label: 'Every 24 hours (daily)' },
  { value: '7d', label: 'Every 7 days (weekly)' },
];

const OverviewTab: React.FC<{ connector: ConnectorConfig; formatDate: (ts?: string) => string }> = ({
  connector, formatDate,
}) => {
  const { updateConnector } = useConnectorStore();
  const [syncInterval, setSyncInterval] = React.useState<string>((connector.config?.syncInterval as string) || 'manual');
  const [savingSync, setSavingSync] = React.useState(false);

  const saveSync = async (val: string) => {
    setSyncInterval(val);
    setSavingSync(true);
    await updateConnector(connector.id, { config: { ...connector.config, syncInterval: val } });
    setSavingSync(false);
  };

  return (
  <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
    <div style={{
      display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px',
    }}>
      {[
        { label: 'Status', value: <StatusDot status={connector.status} showLabel /> },
        { label: 'Active Pipelines', value: connector.activePipelineCount },
        { label: 'Last Sync', value: formatDate(connector.lastSync) },
        { label: 'Rows (Last Sync)', value: connector.lastSyncRowCount?.toLocaleString() || '—' },
        { label: 'Auth Type', value: connector.authType },
        { label: 'Category', value: connector.category },
      ].map((stat) => (
        <div key={stat.label} style={{
          border: '1px solid #E2E8F0', borderRadius: '4px',
          padding: '12px',
        }}>
          <div style={{ fontSize: '11px', color: '#94A3B8', marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
            {stat.label}
          </div>
          <div style={{ fontSize: '14px', fontWeight: 500, color: '#0D1117' }}>
            {stat.value}
          </div>
        </div>
      ))}
    </div>

    <div>
      <div style={{ fontSize: '13px', fontWeight: 500, color: '#0D1117', marginBottom: '8px' }}>Tags</div>
      <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
        {connector.tags?.map((tag) => (
          <span key={tag} style={{
            backgroundColor: '#F1F5F9', color: '#475569',
            fontSize: '11px', padding: '2px 8px', borderRadius: '2px', fontWeight: 500,
          }}>
            {tag}
          </span>
        )) || <span style={{ color: '#94A3B8', fontSize: '12px' }}>No tags</span>}
      </div>
    </div>

    <div>
      <div style={{ fontSize: '13px', fontWeight: 500, color: '#0D1117', marginBottom: '8px' }}>Metadata</div>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <tbody>
          {[
            ['Connector ID', connector.id],
            ['Type', connector.type],
            ['Created', formatDate(connector.createdAt)],
            ['Last Updated', formatDate(connector.updatedAt)],
            ['Schema Hash', connector.schemaHash || '—'],
          ].map(([k, v]) => (
            <tr key={k}>
              <td style={{ padding: '6px 0', fontSize: '12px', color: '#64748B', width: '140px', borderBottom: '1px solid #F1F5F9' }}>{k}</td>
              <td style={{ padding: '6px 0', fontSize: '12px', color: '#0D1117', fontFamily: k === 'Schema Hash' || k === 'Connector ID' ? 'var(--font-mono)' : 'inherit', borderBottom: '1px solid #F1F5F9' }}>{v}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>

    {/* Sync Schedule */}
    <div>
      <div style={{ fontSize: '13px', fontWeight: 500, color: '#0D1117', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: 6 }}>
        Sync Schedule
        {savingSync && <span style={{ fontSize: 11, color: '#94A3B8' }}>Saving…</span>}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
        {SYNC_OPTIONS.map(opt => (
          <button
            key={opt.value}
            onClick={() => saveSync(opt.value)}
            style={{
              padding: '8px 10px', borderRadius: 6, cursor: 'pointer', textAlign: 'left',
              border: syncInterval === opt.value ? '2px solid #2563EB' : '1px solid #E2E8F0',
              backgroundColor: syncInterval === opt.value ? '#EFF6FF' : '#FAFAFA',
              color: syncInterval === opt.value ? '#2563EB' : '#374151',
              fontSize: 12, fontWeight: syncInterval === opt.value ? 600 : 400,
              transition: 'all 100ms',
            }}
          >
            {opt.label}
          </button>
        ))}
      </div>
      {syncInterval !== 'manual' && (
        <div style={{ marginTop: 8, fontSize: 12, color: '#64748B', backgroundColor: '#F1F5F9', borderRadius: 6, padding: '8px 12px' }}>
          This connector will sync automatically <strong>{SYNC_OPTIONS.find(o => o.value === syncInterval)?.label?.toLowerCase()}</strong>. Link a pipeline in the Pipelines tab to trigger it.
        </div>
      )}
    </div>
  </div>
  );
};

// ── Test result with structured step log ─────────────────────────────────────

interface TestStep { step: string; ok: boolean; detail: string; body_preview?: string; }

const TestResultDisplay: React.FC<{
  result: { success: boolean; message: string; latency_ms: number };
}> = ({ result }) => {
  let steps: TestStep[] | null = null;
  try {
    const parsed = JSON.parse(result.message);
    if (parsed.steps) steps = parsed.steps;
  } catch { /* plain text message */ }

  const bg = result.success ? '#F0FDF4' : '#FEF2F2';
  const headerColor = result.success ? '#166534' : '#991B1B';
  const iconOk = 'ok';
  const iconFail = 'x';

  return (
    <div style={{ backgroundColor: bg, borderTop: '1px solid #E2E8F0' }}>
      {/* Summary line */}
      <div style={{ padding: '10px 14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: headerColor }}>
          {result.success ? 'PASS' : 'FAIL'}
        </span>
        <span style={{ fontSize: 11, color: '#94A3B8' }}>
          {result.latency_ms}ms · {new Date().toLocaleTimeString()}
        </span>
      </div>

      {/* Step-by-step log */}
      {steps ? (
        <div style={{ borderTop: `1px solid ${result.success ? '#BBF7D0' : '#FECACA'}`, padding: '8px 14px 12px', display: 'flex', flexDirection: 'column', gap: 6 }}>
          {steps.map((s, i) => (
            <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
              <span style={{
                flexShrink: 0, fontSize: 11, fontWeight: 700, marginTop: 1,
                color: s.ok ? '#16A34A' : '#DC2626',
              }}>{s.ok ? iconOk : iconFail}</span>
              <div>
                <div style={{ fontSize: 11, fontFamily: 'monospace', color: s.ok ? '#166534' : '#991B1B', lineHeight: 1.5 }}>
                  {s.detail}
                </div>
                {s.body_preview && (
                  <div style={{
                    marginTop: 4, padding: '4px 8px', backgroundColor: '#1E1E2E',
                    borderRadius: 4, fontSize: 10, fontFamily: 'monospace', color: '#F8D7DA',
                    maxHeight: 80, overflowY: 'auto', whiteSpace: 'pre-wrap',
                  }}>
                    {s.body_preview}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      ) : (
        /* Fallback: plain text */
        <div style={{ padding: '0 14px 10px', fontSize: 11, fontFamily: 'monospace', color: headerColor }}>
          {result.message}
        </div>
      )}
    </div>
  );
};

// Small connector picker dropdown (excludes self)
const ConnectorPicker: React.FC<{ value: string; onChange: (id: string) => void; currentId: string; style: React.CSSProperties }> = ({ value, onChange, currentId, style }) => {
  const { connectors } = useConnectorStore();
  const selected = connectors.find((c) => c.id === value);
  return (
    <div>
      <select value={value} onChange={(e) => onChange(e.target.value)} style={{ ...style, cursor: 'pointer' }}>
        <option value="">— pick a connector —</option>
        {connectors.filter((c) => c.id !== currentId).map((c) => (
          <option key={c.id} value={c.id}>{c.name} ({c.type})</option>
        ))}
      </select>
      {selected && (
        <div style={{ marginTop: 4, fontSize: 11, color: '#16A34A' }}>
          {selected.baseUrl || '(no base URL)'} · {(selected.config?.method as string) || 'GET'} {(selected.config?.path as string) || '/'}
        </div>
      )}
    </div>
  );
};

const ConfigurationTab: React.FC<{
  connector: ConnectorConfig;
  testResult: { success: boolean; message: string; latency_ms: number } | null;
  onTest: () => void;
  testing: boolean;
}> = ({ connector, testResult, onTest, testing }) => {
  const { updateConnector } = useConnectorStore();
  const creds = connector.credentials || {};

  const [baseUrl, setBaseUrl] = useState(connector.baseUrl || '');
  const [endpointMethod, setEndpointMethod] = useState<string>((connector.config?.method as string) || 'GET');
  const [endpointPath, setEndpointPath] = useState<string>((connector.config?.path as string) || '');
  const [authType, setAuthType] = useState(connector.authType);

  // Detect token mode from stored credentials
  const detectTokenMode = (c: Record<string, string>): 'static' | 'dynamic' | 'connector' => {
    if (c.authConnectorId) return 'connector';
    if (c.tokenEndpointUrl) return 'dynamic';
    return 'static';
  };
  const [tokenMode, setTokenMode] = useState<'static' | 'dynamic' | 'connector'>(() => detectTokenMode(creds));
  const [token, setToken] = useState(creds.token || '');
  const [authEndpointUrl, setAuthEndpointUrl] = useState(creds.tokenEndpointUrl || '');
  const [authEndpointMethod, setAuthEndpointMethod] = useState(creds.tokenEndpointMethod || 'POST');
  const [authEndpointBody, setAuthEndpointBody] = useState(creds.tokenEndpointBody || '{"username": "", "password": ""}');
  const [tokenResponsePath, setTokenResponsePath] = useState(creds.tokenPath || 'token');
  const [authConnectorId, setAuthConnectorId] = useState(creds.authConnectorId || '');

  const [apiKeyName, setApiKeyName] = useState(creds.keyName || 'X-API-Key');
  const [apiKeyValue, setApiKeyValue] = useState(creds.keyValue || '');
  const [username, setUsername] = useState(creds.username || '');
  const [password, setPassword] = useState(creds.password || '');
  const [clientId, setClientId] = useState(creds.clientId || '');
  const [clientSecret, setClientSecret] = useState(creds.clientSecret || '');
  const [paginationStrategy, setPaginationStrategy] = useState<string>(connector.paginationStrategy || 'cursor');
  const [endpointBody, setEndpointBody] = useState<string>((connector.config?.body as string) || '');
  interface HeaderRule {
    key: string;
    type: 'static' | 'uuid' | 'randomIp' | 'connector';
    value: string;
    connectorId: string;
    fieldPath: string;
  }
  const parseHeaderRules = (h: unknown): HeaderRule[] => {
    if (!h || typeof h !== 'object') return [];
    return Object.entries(h as Record<string, string>).map(([key, val]) => {
      if (val === '{{$guid}}') return { key, type: 'uuid' as const, value: '', connectorId: '', fieldPath: '' };
      if (val === '{{$randomIP}}') return { key, type: 'randomIp' as const, value: '', connectorId: '', fieldPath: '' };
      const m = String(val).match(/^\{\{connector:([^:]+):(.+)\}\}$/);
      if (m) return { key, type: 'connector' as const, value: '', connectorId: m[1], fieldPath: m[2] };
      return { key, type: 'static' as const, value: String(val), connectorId: '', fieldPath: '' };
    });
  };
  const [headerRules, setHeaderRules] = useState<HeaderRule[]>(() => parseHeaderRules(connector.config?.headers));

  interface QueryParamRule {
    key: string;
    type: 'static' | 'today' | 'daysAgo' | 'lastRun' | 'connector';
    value: string;       // static value
    format: string;      // date format string
    daysAgo: string;     // for daysAgo type
    connectorId: string;
    fieldPath: string;
  }
  const parseQueryParamRules = (qp: unknown): QueryParamRule[] => {
    if (!qp || typeof qp !== 'object') return [];
    return Object.entries(qp as Record<string, string>).map(([key, val]) => {
      const s = String(val);
      let m;
      if (s === '{{$today}}' || (m = s.match(/^\{\{\$today:(.+)\}\}$/))) {
        return { key, type: 'today' as const, value: '', format: m ? m[1] : 'DD/MM/YYYY', daysAgo: '', connectorId: '', fieldPath: '' };
      }
      if ((m = s.match(/^\{\{\$daysAgo:(\d+):(.+)\}\}$/))) {
        return { key, type: 'daysAgo' as const, value: '', format: m[2], daysAgo: m[1], connectorId: '', fieldPath: '' };
      }
      if (s === '{{$lastRun}}' || (m = s.match(/^\{\{\$lastRun:(.+)\}\}$/))) {
        return { key, type: 'lastRun' as const, value: '', format: m ? m[1] : 'DD/MM/YYYY', daysAgo: '', connectorId: '', fieldPath: '' };
      }
      if ((m = s.match(/^\{\{connector:([^:]+):(.+)\}\}$/))) {
        return { key, type: 'connector' as const, value: '', format: '', daysAgo: '', connectorId: m[1], fieldPath: m[2] };
      }
      return { key, type: 'static' as const, value: s, format: '', daysAgo: '', connectorId: '', fieldPath: '' };
    });
  };
  const [queryParamRules, setQueryParamRules] = useState<QueryParamRule[]>(() =>
    parseQueryParamRules(connector.config?.queryParams)
  );

  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  // Reset when connector changes
  useEffect(() => {
    const c = connector.credentials || {};
    setBaseUrl(connector.baseUrl || '');
    setEndpointMethod((connector.config?.method as string) || 'GET');
    setEndpointPath((connector.config?.path as string) || '');
    setAuthType(connector.authType);
    setTokenMode(detectTokenMode(c));
    setToken(c.token || '');
    setAuthEndpointUrl(c.tokenEndpointUrl || '');
    setAuthEndpointMethod(c.tokenEndpointMethod || 'POST');
    setAuthEndpointBody(c.tokenEndpointBody || '{"username": "", "password": ""}');
    setTokenResponsePath(c.tokenPath || 'token');
    setAuthConnectorId(c.authConnectorId || '');
    setApiKeyName(c.keyName || 'X-API-Key');
    setApiKeyValue(c.keyValue || '');
    setUsername(c.username || '');
    setPassword(c.password || '');
    setClientId(c.clientId || '');
    setClientSecret(c.clientSecret || '');
    setPaginationStrategy(connector.paginationStrategy || 'cursor');
    setEndpointBody((connector.config?.body as string) || '');
    setHeaderRules(parseHeaderRules(connector.config?.headers));
    setQueryParamRules(parseQueryParamRules(connector.config?.queryParams));
    setSaved(false);
  }, [connector.id]);

  const handleSave = async () => {
    setSaving(true);
    setSaved(false);
    const credentials: Record<string, string> = {};
    if (authType === 'Bearer') {
      if (tokenMode === 'dynamic') {
        credentials.tokenEndpointUrl = authEndpointUrl;
        credentials.tokenEndpointMethod = authEndpointMethod;
        credentials.tokenEndpointBody = authEndpointBody;
        credentials.tokenPath = tokenResponsePath;
      } else if (tokenMode === 'connector') {
        credentials.authConnectorId = authConnectorId;
        credentials.tokenPath = tokenResponsePath;
      } else {
        credentials.token = token;
      }
    }
    if (authType === 'ApiKey') { credentials.keyName = apiKeyName; credentials.keyValue = apiKeyValue; }
    if (authType === 'Basic') { credentials.username = username; credentials.password = password; }
    if (authType === 'OAuth2') { credentials.clientId = clientId; credentials.clientSecret = clientSecret; }
    try {
      const existingConfig = connector.config || {};
      const builtHeaders: Record<string, string> = {};
      for (const r of headerRules) {
        if (!r.key.trim()) continue;
        if (r.type === 'uuid') builtHeaders[r.key] = '{{$guid}}';
        else if (r.type === 'randomIp') builtHeaders[r.key] = '{{$randomIP}}';
        else if (r.type === 'connector') builtHeaders[r.key] = `{{connector:${r.connectorId}:${r.fieldPath}}}`;
        else builtHeaders[r.key] = r.value;
      }
      const builtQueryParams: Record<string, string> = {};
      for (const r of queryParamRules) {
        if (!r.key.trim()) continue;
        if (r.type === 'today') builtQueryParams[r.key] = `{{$today:${r.format || 'DD/MM/YYYY'}}}`;
        else if (r.type === 'daysAgo') builtQueryParams[r.key] = `{{$daysAgo:${r.daysAgo || '7'}:${r.format || 'DD/MM/YYYY'}}}`;
        else if (r.type === 'lastRun') builtQueryParams[r.key] = `{{$lastRun:${r.format || 'DD/MM/YYYY'}}}`;
        else if (r.type === 'connector') builtQueryParams[r.key] = `{{connector:${r.connectorId}:${r.fieldPath}}}`;
        else builtQueryParams[r.key] = r.value;
      }
      const newConfig = { ...existingConfig };
      if (endpointMethod) newConfig.method = endpointMethod;
      if (endpointPath.trim()) newConfig.path = endpointPath.trim();
      if (endpointBody.trim()) { newConfig.body = endpointBody.trim(); } else { delete newConfig.body; }
      if (Object.keys(builtHeaders).length > 0) { newConfig.headers = builtHeaders; } else { delete newConfig.headers; }
      if (Object.keys(builtQueryParams).length > 0) { newConfig.queryParams = builtQueryParams; } else { delete newConfig.queryParams; }
      await updateConnector(connector.id, {
        baseUrl: baseUrl.trim() || undefined,
        authType,
        credentials,
        paginationStrategy: paginationStrategy as any,
        config: newConfig,
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
        <FieldGroup label="Base URL">
          <input
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder="https://api.example.com"
            style={inputStyle}
          />
        </FieldGroup>

        {connector.type === 'REST_API' && (
          <FieldGroup label="Endpoint">
            <div style={{ display: 'flex', gap: 6 }}>
              <select value={endpointMethod} onChange={(e) => setEndpointMethod(e.target.value)}
                style={{ ...inputStyle, width: 90, flexShrink: 0, cursor: 'pointer' }}>
                {['GET','POST','PUT','PATCH','DELETE'].map(m => <option key={m}>{m}</option>)}
              </select>
              <input value={endpointPath} onChange={(e) => setEndpointPath(e.target.value)}
                placeholder="/v1/resource?param=value" style={inputStyle} />
            </div>
          </FieldGroup>
        )}

        {connector.type === 'REST_API' && ['POST', 'PUT', 'PATCH'].includes(endpointMethod.toUpperCase()) && (
          <FieldGroup label="Request Body (JSON)">
            <textarea
              value={endpointBody}
              onChange={(e) => setEndpointBody(e.target.value)}
              rows={4}
              placeholder='{"key": "value"}'
              style={{ ...inputStyle, height: 'auto', padding: '8px 10px', fontFamily: 'monospace', fontSize: 12, resize: 'vertical' }}
            />
          </FieldGroup>
        )}

        {connector.type === 'REST_API' && (
          <FieldGroup label="Query Parameters">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {queryParamRules.map((rule, idx) => {
                const setRule = (patch: Partial<QueryParamRule>) =>
                  setQueryParamRules((prev) => prev.map((r, i) => i === idx ? { ...r, ...patch } : r));
                return (
                  <div key={idx} style={{ display: 'flex', gap: 6, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                    <input value={rule.key} onChange={(e) => setRule({ key: e.target.value })}
                      placeholder="param" style={{ ...inputStyle, width: 110, flexShrink: 0, fontFamily: 'monospace', fontSize: 12 }} />
                    <select value={rule.type} onChange={(e) => setRule({ type: e.target.value as QueryParamRule['type'] })}
                      style={{ ...inputStyle, width: 130, flexShrink: 0, cursor: 'pointer' }}>
                      <option value="static">Static value</option>
                      <option value="today">Today's date</option>
                      <option value="daysAgo">N days ago</option>
                      <option value="lastRun">Last pipeline run</option>
                      <option value="connector">From connector</option>
                    </select>

                    {rule.type === 'static' && (
                      <input value={rule.value} onChange={(e) => setRule({ value: e.target.value })}
                        placeholder="value" style={{ ...inputStyle, flex: 1 }} />
                    )}
                    {(rule.type === 'today' || rule.type === 'lastRun') && (
                      <input value={rule.format} onChange={(e) => setRule({ format: e.target.value })}
                        placeholder="DD/MM/YYYY" style={{ ...inputStyle, width: 120 }}
                        title="Date format: DD=day, MM=month, YYYY=year" />
                    )}
                    {rule.type === 'daysAgo' && (
                      <>
                        <input value={rule.daysAgo} onChange={(e) => setRule({ daysAgo: e.target.value })}
                          placeholder="7" type="number" min="0" style={{ ...inputStyle, width: 60 }} />
                        <span style={{ lineHeight: '34px', fontSize: 12, color: '#64748B', flexShrink: 0 }}>days ago</span>
                        <input value={rule.format} onChange={(e) => setRule({ format: e.target.value })}
                          placeholder="DD/MM/YYYY" style={{ ...inputStyle, width: 120 }}
                          title="Date format: DD=day, MM=month, YYYY=year" />
                      </>
                    )}
                    {rule.type === 'connector' && (
                      <>
                        <ConnectorPicker value={rule.connectorId} onChange={(id) => setRule({ connectorId: id })}
                          currentId={connector.id} style={{ ...inputStyle, flex: 1 }} />
                        <input value={rule.fieldPath} onChange={(e) => setRule({ fieldPath: e.target.value })}
                          placeholder="data.field" style={{ ...inputStyle, width: 110, fontFamily: 'monospace', fontSize: 12 }} />
                      </>
                    )}
                    <button type="button" onClick={() => setQueryParamRules((prev) => prev.filter((_, i) => i !== idx))}
                      style={{ padding: '6px 8px', border: '1px solid #E2E8F0', borderRadius: 4, background: 'none', cursor: 'pointer', color: '#94A3B8', flexShrink: 0 }}>×</button>
                  </div>
                );
              })}
              <button type="button"
                onClick={() => setQueryParamRules((prev) => [...prev, { key: '', type: 'static', value: '', format: 'DD/MM/YYYY', daysAgo: '7', connectorId: '', fieldPath: '' }])}
                style={{ alignSelf: 'flex-start', padding: '5px 10px', border: '1px dashed #CBD5E1', borderRadius: 4, background: 'none', cursor: 'pointer', fontSize: 12, color: '#64748B' }}>
                + Add Parameter
              </button>
            </div>
          </FieldGroup>
        )}

        {connector.type === 'REST_API' && (
          <FieldGroup label="Custom Headers">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {headerRules.map((rule, idx) => (
                <div key={idx} style={{ display: 'flex', gap: 6, alignItems: 'flex-start' }}>
                  {/* Key */}
                  <input
                    value={rule.key}
                    onChange={(e) => setHeaderRules((prev) => prev.map((r, i) => i === idx ? { ...r, key: e.target.value } : r))}
                    placeholder="header-name"
                    style={{ ...inputStyle, width: 140, flexShrink: 0, fontFamily: 'monospace', fontSize: 12 }}
                  />
                  {/* Type selector */}
                  <select
                    value={rule.type}
                    onChange={(e) => setHeaderRules((prev) => prev.map((r, i) => i === idx ? { ...r, type: e.target.value as HeaderRule['type'] } : r))}
                    style={{ ...inputStyle, width: 130, flexShrink: 0, cursor: 'pointer' }}
                  >
                    <option value="static">Static value</option>
                    <option value="uuid">UUID (auto)</option>
                    <option value="randomIp">Random IP</option>
                    <option value="connector">From connector</option>
                  </select>
                  {/* Value config */}
                  {rule.type === 'static' && (
                    <input
                      value={rule.value}
                      onChange={(e) => setHeaderRules((prev) => prev.map((r, i) => i === idx ? { ...r, value: e.target.value } : r))}
                      placeholder="value"
                      style={{ ...inputStyle, flex: 1 }}
                    />
                  )}
                  {rule.type === 'uuid' && (
                    <span style={{ flex: 1, fontSize: 11, color: '#94A3B8', padding: '8px 10px', backgroundColor: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: 4 }}>
                      Auto-generated UUID v4 per request
                    </span>
                  )}
                  {rule.type === 'randomIp' && (
                    <span style={{ flex: 1, fontSize: 11, color: '#94A3B8', padding: '8px 10px', backgroundColor: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: 4 }}>
                      Auto-generated random IP per request
                    </span>
                  )}
                  {rule.type === 'connector' && (
                    <div style={{ flex: 1, display: 'flex', gap: 6 }}>
                      <ConnectorPicker
                        value={rule.connectorId}
                        onChange={(id) => setHeaderRules((prev) => prev.map((r, i) => i === idx ? { ...r, connectorId: id } : r))}
                        currentId={connector.id}
                        style={{ ...inputStyle, flex: 1 }}
                      />
                      <input
                        value={rule.fieldPath}
                        onChange={(e) => setHeaderRules((prev) => prev.map((r, i) => i === idx ? { ...r, fieldPath: e.target.value } : r))}
                        placeholder="data.field"
                        style={{ ...inputStyle, width: 110, fontFamily: 'monospace', fontSize: 12 }}
                      />
                    </div>
                  )}
                  {/* Remove */}
                  <button
                    type="button"
                    onClick={() => setHeaderRules((prev) => prev.filter((_, i) => i !== idx))}
                    style={{ padding: '6px 8px', border: '1px solid #E2E8F0', borderRadius: 4, background: 'none', cursor: 'pointer', color: '#94A3B8', flexShrink: 0 }}
                  >×</button>
                </div>
              ))}
              <button
                type="button"
                onClick={() => setHeaderRules((prev) => [...prev, { key: '', type: 'static', value: '', connectorId: '', fieldPath: '' }])}
                style={{ alignSelf: 'flex-start', padding: '5px 10px', border: '1px dashed #CBD5E1', borderRadius: 4, background: 'none', cursor: 'pointer', fontSize: 12, color: '#64748B' }}
              >+ Add Header</button>
            </div>
          </FieldGroup>
        )}

        <FieldGroup label="Authentication Type">
          <select value={authType} onChange={(e) => setAuthType(e.target.value as typeof authType)} style={inputStyle}>
            <option value="Bearer">Bearer Token</option>
            <option value="ApiKey">API Key</option>
            <option value="OAuth2">OAuth 2.0</option>
            <option value="Basic">Basic Auth</option>
            <option value="None">None</option>
          </select>
        </FieldGroup>

        {authType === 'Bearer' && (
          <>
            {/* Three-mode toggle */}
            <FieldGroup label="Token Source">
              <div style={{ display: 'flex', border: '1px solid #E2E8F0', borderRadius: 5, overflow: 'hidden' }}>
                {([['static', 'Static token'], ['dynamic', 'Login endpoint'], ['connector', 'Use connector']] as const).map(([m, label]) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setTokenMode(m)}
                    style={{
                      flex: 1, padding: '7px 0', border: 'none', cursor: 'pointer',
                      fontSize: 12, fontWeight: tokenMode === m ? 600 : 400,
                      backgroundColor: tokenMode === m ? '#2563EB' : '#F8FAFC',
                      color: tokenMode === m ? '#fff' : '#64748B',
                      borderRight: m !== 'connector' ? '1px solid #E2E8F0' : 'none',
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </FieldGroup>

            {tokenMode === 'static' && (
              <FieldGroup label="Bearer Token">
                <input type="password" value={token} onChange={(e) => setToken(e.target.value)} placeholder="pat-na1-..." style={inputStyle} />
              </FieldGroup>
            )}

            {tokenMode === 'dynamic' && (
              <>
                <FieldGroup label="Login Endpoint URL">
                  <div style={{ display: 'flex', gap: 6 }}>
                    <select value={authEndpointMethod} onChange={(e) => setAuthEndpointMethod(e.target.value)}
                      style={{ ...inputStyle, width: 80, flexShrink: 0, cursor: 'pointer' }}>
                      <option>POST</option><option>GET</option>
                    </select>
                    <input value={authEndpointUrl} onChange={(e) => setAuthEndpointUrl(e.target.value)}
                      placeholder="https://api.example.com/login" style={inputStyle} />
                  </div>
                </FieldGroup>
                <FieldGroup label="Request Body (JSON)">
                  <textarea value={authEndpointBody} onChange={(e) => setAuthEndpointBody(e.target.value)} rows={3}
                    style={{ ...inputStyle, height: 'auto', padding: '8px 10px', fontFamily: 'monospace', fontSize: 12, resize: 'vertical' }} />
                </FieldGroup>
                <FieldGroup label="Token field in response">
                  <input value={tokenResponsePath} onChange={(e) => setTokenResponsePath(e.target.value)} placeholder="token" style={inputStyle} />
                </FieldGroup>
              </>
            )}

            {tokenMode === 'connector' && (
              <>
                <FieldGroup label="Auth Connector">
                  <ConnectorPicker value={authConnectorId} onChange={setAuthConnectorId} currentId={connector.id} style={inputStyle} />
                </FieldGroup>
                <FieldGroup label="Token field in response">
                  <input value={tokenResponsePath} onChange={(e) => setTokenResponsePath(e.target.value)} placeholder="token" style={inputStyle} />
                </FieldGroup>
              </>
            )}
          </>
        )}

        {authType === 'ApiKey' && (
          <>
            <FieldGroup label="Header Name">
              <input value={apiKeyName} onChange={(e) => setApiKeyName(e.target.value)} style={inputStyle} />
            </FieldGroup>
            <FieldGroup label="API Key">
              <input type="password" value={apiKeyValue} onChange={(e) => setApiKeyValue(e.target.value)} placeholder="Your API key" style={inputStyle} />
            </FieldGroup>
          </>
        )}

        {authType === 'Basic' && (
          <>
            <FieldGroup label="Username">
              <input value={username} onChange={(e) => setUsername(e.target.value)} style={inputStyle} />
            </FieldGroup>
            <FieldGroup label="Password">
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} style={inputStyle} />
            </FieldGroup>
          </>
        )}

        {authType === 'OAuth2' && (
          <>
            <FieldGroup label="Client ID">
              <input value={clientId} onChange={(e) => setClientId(e.target.value)} style={inputStyle} />
            </FieldGroup>
            <FieldGroup label="Client Secret">
              <input type="password" value={clientSecret} onChange={(e) => setClientSecret(e.target.value)} style={inputStyle} />
            </FieldGroup>
          </>
        )}

        <FieldGroup label="Pagination Strategy">
          <select value={paginationStrategy} onChange={(e) => setPaginationStrategy(e.target.value)} style={inputStyle}>
            <option value="cursor">Cursor-based</option>
            <option value="offset">Offset/Limit</option>
            <option value="page">Page Number</option>
            <option value="none">None</option>
          </select>
        </FieldGroup>
      </div>

      {/* Connection test panel */}
      <div style={{ border: '1px solid #E2E8F0', borderRadius: '4px', overflow: 'hidden' }}>
        <div style={{
          padding: '10px 14px', backgroundColor: '#F8FAFC',
          borderBottom: testResult ? '1px solid #E2E8F0' : 'none',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <div style={{ fontSize: '13px', fontWeight: 500, color: '#0D1117' }}>Connection Test</div>
          <Button variant="secondary" size="sm" icon={<Zap size={12} />} onClick={onTest} loading={testing}>
            {testing ? 'Testing...' : 'Test Connection'}
          </Button>
        </div>
        {testResult ? (
          <TestResultDisplay result={testResult} />
        ) : (
          <div style={{ padding: '10px 14px', fontSize: '12px', color: '#94A3B8' }}>
            Run a test to verify your credentials against {connector.type}.
          </div>
        )}
      </div>

      <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
        <Button variant="primary" size="sm" onClick={handleSave} loading={saving}>
          {saved ? 'Saved' : 'Save Configuration'}
        </Button>
        <Button variant="secondary" size="sm" onClick={() => {
          const c = connector.credentials || {};
          setBaseUrl(connector.baseUrl || '');
          setAuthType(connector.authType);
          setTokenMode(detectTokenMode(c));
          setToken(c.token || '');
          setAuthEndpointUrl(c.tokenEndpointUrl || '');
          setAuthEndpointMethod(c.tokenEndpointMethod || 'POST');
          setAuthEndpointBody(c.tokenEndpointBody || '{"username": "", "password": ""}');
          setTokenResponsePath(c.tokenPath || 'token');
          setAuthConnectorId(c.authConnectorId || '');
          setEndpointBody((connector.config?.body as string) || '');
          setSaved(false);
        }}>
          Cancel
        </Button>
      </div>
    </div>
  );
};

const PipelinesTab: React.FC<{
  pipelines: import('../../types/pipeline').Pipeline[];
  formatDate: (ts?: string) => string;
  connectorId: string;
}> = ({ pipelines, formatDate, connectorId }) => {
  const { navigateTo } = useNavigationStore();
  const { selectPipeline } = usePipelineStore();

  const statusColor: Record<string, string> = {
    RUNNING: '#059669', IDLE: '#94A3B8', FAILED: '#DC2626', PAUSED: '#D97706', DRAFT: '#6366F1',
  };

  const openPipeline = (id: string) => {
    selectPipeline(id);
    navigateTo('pipelines');
  };

  if (pipelines.length === 0) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px', padding: '48px 0' }}>
        <span style={{ fontSize: '13px', color: '#94A3B8' }}>No pipelines use this connector yet</span>
        <button
          onClick={() => navigateTo('pipelines')}
          style={{ height: '30px', padding: '0 14px', fontSize: '12px', fontWeight: 500, backgroundColor: '#2563EB', color: '#FFFFFF', border: 'none', borderRadius: '3px', cursor: 'pointer' }}
        >
          Open Pipeline Builder
        </button>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
      {pipelines.map((p) => (
        <div
          key={p.id}
          onClick={() => openPipeline(p.id)}
          style={{
            border: '1px solid #E2E8F0', borderRadius: '4px', padding: '10px 14px',
            cursor: 'pointer', backgroundColor: '#FFFFFF', transition: 'border-color 80ms',
            display: 'flex', alignItems: 'center', gap: '12px',
          }}
          onMouseEnter={(e) => (e.currentTarget.style.borderColor = '#2563EB')}
          onMouseLeave={(e) => (e.currentTarget.style.borderColor = '#E2E8F0')}
        >
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: '13px', fontWeight: 500, color: '#0D1117', marginBottom: '2px' }}>{p.name}</div>
            <div style={{ fontSize: '11px', color: '#94A3B8' }}>
              {p.nodes.length} nodes · last run {formatDate(p.lastRunAt)}
              {p.lastRunRowCount != null ? ` · ${p.lastRunRowCount.toLocaleString()} rows` : ''}
            </div>
          </div>
          <span style={{
            display: 'inline-flex', alignItems: 'center', gap: '4px',
            fontSize: '11px', color: statusColor[p.status] || '#64748B', fontWeight: 500,
          }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', backgroundColor: statusColor[p.status] || '#64748B', display: 'inline-block' }} />
            {p.status}
          </span>
          <ExternalLink size={12} color="#CBD5E1" />
        </div>
      ))}
      <button
        onClick={() => navigateTo('pipelines')}
        style={{ marginTop: '4px', height: '28px', padding: '0 12px', fontSize: '12px', border: '1px dashed #CBD5E1', borderRadius: '3px', backgroundColor: '#FAFAFA', color: '#64748B', cursor: 'pointer' }}
      >
        + New Pipeline
      </button>
    </div>
  );
};

interface CorrelationMatch {
  object_type_id: string;
  object_type_name: string;
  composite_score: number;
  field_name_overlap: number;
  semantic_type_overlap: number;
  primary_key_resolvable: boolean;
  conflicting_fields: string[];
  action: 'enrich' | 'link' | 'new_type';
  suggested_join_key?: { incoming: string; existing: string };
  pipeline_hint?: string;
}

interface CorrelationResult {
  matches: CorrelationMatch[];
  top_action: string;
  new_object_name: string;
}

const SchemaTab: React.FC<{ connector: ConnectorConfig }> = ({ connector }) => {
  const inferenceStore = useInferenceStore();
  const cached = inferenceStore.get(connector.id);

  const [inferring, setInferring] = useState(false);
  const [inferenceResult, setInferenceResult] = useState<Record<string, unknown> | null>(cached?.result || null);
  const [inferenceError, setInferenceError] = useState<string | null>(null);
  const [rawSchemaInput, setRawSchemaInput] = useState('');
  const [showInput, setShowInput] = useState(false);
  const [fetchedSchema, setFetchedSchema] = useState<{ schema: Record<string, unknown>; sample_rows: unknown[]; error?: string } | null>(
    cached?.sampleRows ? { schema: {}, sample_rows: cached.sampleRows } : null
  );
  const [fetchingSchema, setFetchingSchema] = useState(false);
  const [statusLog, setStatusLog] = useState<string[]>(cached?.statusLog || []);
  const [correlationResult, setCorrelationResult] = useState<CorrelationResult | null>((cached?.correlationResult as CorrelationResult) || null);
  const [correlating, setCorrelating] = useState(false);
  const [savingAction, setSavingAction] = useState<string | null>(null);
  const [savedActions, setSavedActions] = useState<Record<string, string>>({});
  const { addObjectType, objectTypes, updateObjectType } = useOntologyStore();
  const { navigateTo } = useNavigationStore();

  const log = (msg: string) => setStatusLog((prev) => [...prev, `${new Date().toLocaleTimeString()} — ${msg}`]);

  // Load inference from server if not in localStorage
  useEffect(() => {
    if (inferenceResult) return;
    fetch(`${CONNECTOR_API}/connectors/${connector.id}/inference`, {
      headers: { 'x-tenant-id': 'tenant-001' },
    })
      .then((r) => r.ok ? r.json() : null)
      .then((d) => {
        if (!d) return;
        const entry = d.inference_result as Record<string, unknown>;
        if (!entry) return;
        const result = entry.result as Record<string, unknown>;
        const corrResult = entry.correlationResult as CorrelationResult | null;
        const rows = entry.sampleRows as unknown[] | undefined;
        if (result) {
          setInferenceResult(result);
          if (corrResult) setCorrelationResult(corrResult);
          if (rows) setFetchedSchema({ schema: {}, sample_rows: rows });
          inferenceStore.save(connector.id, {
            result,
            correlationResult: corrResult ?? null,
            statusLog: [],
            sampleRows: rows,
          });
        }
      })
      .catch(() => {});
  }, [connector.id]);

  // Auto-fetch raw schema on mount if no cached result
  useEffect(() => {
    if (fetchedSchema || inferenceResult) return;
    setFetchingSchema(true);
    fetch(`${CONNECTOR_API}/connectors/${connector.id}/schema`)
      .then((r) => r.ok ? r.json() : null)
      .then((data) => { if (data) setFetchedSchema(data); })
      .catch(() => {})
      .finally(() => setFetchingSchema(false));
  }, [connector.id]);

  const buildProperties = (data: Record<string, unknown>): ObjectProperty[] =>
    ((data.fields as any[]) || []).map((f: any, i: number) => ({
      id: `prop-${i}`,
      name: f.suggested_name || f.source_field,
      displayName: f.suggested_name || f.source_field,
      semanticType: f.semantic_type || 'TEXT',
      dataType: f.data_type || 'string',
      piiLevel: f.pii_level || 'NONE',
      required: false,
      sourceConnectorId: connector.id,
      inferenceConfidence: f.confidence || 0,
      sampleValues: f.sample_values || [],
    }));

  const runInference = async () => {
    setInferring(true);
    setInferenceError(null);
    setInferenceResult(null);
    setCorrelationResult(null);
    setSavedActions({});
    setStatusLog([]);
    inferenceStore.clear(connector.id);

    try {
      let rawSchema: Record<string, unknown> = {};
      let sampleRows: unknown[] = [];

      if (rawSchemaInput.trim()) {
        log('Using pasted schema');
        try { rawSchema = JSON.parse(rawSchemaInput); } catch { log('Could not parse pasted JSON — sending as-is'); }
      } else {
        log(`Fetching schema from ${connector.type}...`);
        setFetchingSchema(true);
        try {
          const schemaRes = await fetch(`${CONNECTOR_API}/connectors/${connector.id}/schema`);
          if (schemaRes.ok) {
            const schemaData = await schemaRes.json();
            setFetchedSchema(schemaData);
            if (schemaData.error) {
              log(`Schema fetch warning: ${schemaData.error}`);
            } else {
              rawSchema = schemaData.schema || {};
              sampleRows = schemaData.sample_rows || [];
              const fieldCount = Object.keys((rawSchema as any).fields || rawSchema).length;
              log(`Schema fetched — ${fieldCount} fields, ${sampleRows.length} sample rows`);
            }
          } else {
            log(`Schema fetch failed (${schemaRes.status}) — sending empty schema`);
          }
        } catch (e: unknown) {
          log(`Schema fetch error: ${String(e)}`);
        } finally {
          setFetchingSchema(false);
        }
      }

      log('Sending to Claude for semantic analysis...');
      const res = await fetch(`${INFERENCE_API}/infer/schema`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ connector_id: connector.id, raw_schema: rawSchema, sample_rows: sampleRows }),
      });
      if (!res.ok) throw new Error(`Inference service returned ${res.status}`);
      const data = await res.json();
      const fieldCount = (data.fields || []).length;
      log(`Inference complete — ${fieldCount} fields labeled, ${Math.round((data.overall_confidence || 0) * 100)}% confidence`);
      setInferenceResult(data);

      // Step 3: run correlation against all existing object types
      let finalCorrResult: CorrelationResult | null = null;
      if (objectTypes.length > 0) {
        log(`Running correlation against ${objectTypes.length} existing object type${objectTypes.length > 1 ? 's' : ''}...`);
        setCorrelating(true);
        try {
          const backendOTs = objectTypes.map((ot) => ({
            id: ot.id, name: ot.name, display_name: ot.displayName,
            description: ot.description, version: ot.version,
            schema_health: ot.schemaHealth, tenant_id: ot.tenantId,
            source_connector_ids: ot.sourceConnectorIds,
            created_at: ot.createdAt, updated_at: ot.updatedAt,
            properties: ot.properties.map((p) => ({
              id: p.id, name: p.name, display_name: p.displayName,
              semantic_type: p.semanticType, data_type: p.dataType,
              pii_level: p.piiLevel, required: p.required,
              source_connector_id: p.sourceConnectorId,
              sample_values: p.sampleValues || [],
            })),
          }));
          const corrRes = await fetch(`${CORRELATION_API}/score-all`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ schema_a: data, object_types: backendOTs }),
          });
          if (corrRes.ok) {
            const corrData: CorrelationResult = await corrRes.json();
            finalCorrResult = corrData;
            setCorrelationResult(corrData);
            const topMatch = corrData.matches[0];
            if (topMatch && topMatch.action !== 'new_type') {
              log(`Correlation: best match "${topMatch.object_type_name}" — ${Math.round(topMatch.composite_score * 100)}% similarity (${topMatch.action})`);
            } else {
              log(`Correlation: no strong match found — recommend creating new object type "${data.suggested_object_type_name}"`);
            }
          }
        } catch (e) {
          log(`Correlation skipped: ${String(e)}`);
        } finally {
          setCorrelating(false);
        }
      } else {
        log('No existing object types to correlate against — ready to create new type');
        // Still surface the "Map to Ontology" button
        finalCorrResult = { matches: [], top_action: 'new_type', new_object_name: data.suggested_object_type_name as string || connector.name };
        setCorrelationResult(finalCorrResult);
      }

      // Persist inference result — localStorage for instant re-load, server for cross-device/restart
      inferenceStore.save(connector.id, {
        result: data,
        correlationResult: finalCorrResult,
        statusLog: [], // will be stale; log is display-only
        sampleRows: sampleRows,
      });
      fetch(`${CONNECTOR_API}/connectors/${connector.id}/inference`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'x-tenant-id': 'tenant-001' },
        body: JSON.stringify({ result: data, correlationResult: finalCorrResult, sampleRows }),
      }).catch(() => {}); // fire-and-forget
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      log(`Error: ${msg}`);
      setInferenceError(msg);
    } finally {
      setInferring(false);
    }
  };

  const handleEnrich = async (match: CorrelationMatch) => {
    if (!inferenceResult) return;
    setSavingAction(match.object_type_id);
    try {
      const existingOT = objectTypes.find((o) => o.id === match.object_type_id);
      if (!existingOT) throw new Error('Object type not found');
      const newProps = buildProperties(inferenceResult);
      const existingNames = new Set(existingOT.properties.map((p) => p.name));
      const toAdd = newProps.filter((p) => !existingNames.has(p.name));
      await updateObjectType(match.object_type_id, {
        properties: [...existingOT.properties, ...toAdd],
        sourceConnectorIds: [...new Set([...existingOT.sourceConnectorIds, connector.id])],
      });
      setSavedActions((prev) => ({ ...prev, [match.object_type_id]: `Added ${toAdd.length} fields to ${match.object_type_name}` }));
    } catch (err) {
      log(`Enrich failed: ${String(err)}`);
    } finally {
      setSavingAction(null);
    }
  };

  const handleCreateNew = async (name?: string, selectedFieldNames?: string[], syncFrequency?: string, eventLogMapping?: { caseIdField: string; activityField: string; timestampField: string }) => {
    if (!inferenceResult) return;
    setSavingAction('__new__');
    try {
      const objectTypeName = name || (inferenceResult.suggested_object_type_name as string) || connector.name;
      let props = buildProperties(inferenceResult);
      if (selectedFieldNames && selectedFieldNames.length > 0) {
        const nameSet = new Set(selectedFieldNames);
        props = props.filter((p) => nameSet.has(p.name));
      }
      const ot: ObjectType = {
        id: '', name: objectTypeName.replace(/\s+/g, ''),
        displayName: objectTypeName,
        description: `Schema inferred from ${connector.type} connector — ${connector.name}`,
        properties: props,
        sourceConnectorIds: [connector.id],
        version: 1, schemaHealth: 'healthy',
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
        tenantId: 'tenant-001',
      };
      const created = await addObjectType(ot);
      const freq = syncFrequency || '1h';
      const srcId = `node-src-${Date.now()}`;
      const sinkObjId = `node-sink-obj-${Date.now() + 1}`;
      const sinkEvtId = `node-sink-evt-${Date.now() + 2}`;

      const hasEventMapping = eventLogMapping && (
        eventLogMapping.timestampField || eventLogMapping.caseIdField || eventLogMapping.activityField
      );

      const nodes: PipelineNode[] = [
        { id: srcId, type: 'SOURCE', label: connector.name, config: { connectorId: connector.id, pollFrequency: freq }, position: { x: 80, y: 150 }, connectorId: connector.id },
        { id: sinkObjId, type: 'SINK_OBJECT', label: created.displayName, config: { objectTypeId: created.id }, position: { x: 360, y: 150 }, objectTypeId: created.id },
        ...(hasEventMapping ? [{
          id: sinkEvtId,
          type: 'SINK_EVENT' as const,
          label: 'Event Log',
          config: {
            objectTypeId: created.id,
            caseIdField: eventLogMapping!.caseIdField,
            activityField: eventLogMapping!.activityField,
            timestampField: eventLogMapping!.timestampField,
          },
          position: { x: 640, y: 150 },
          objectTypeId: created.id,
        }] : []),
      ];

      const edges = [
        { id: `e1-${Date.now()}`, source: srcId, target: sinkObjId },
        ...(hasEventMapping ? [{ id: `e2-${Date.now()}`, source: sinkObjId, target: sinkEvtId }] : []),
      ];

      const pipelineTemplate: Partial<Pipeline> = {
        name: `${connector.name} → ${created.displayName}`,
        description: `Feed ${connector.name} data into ${created.displayName}`,
        status: 'DRAFT',
        nodes,
        edges,
        connectorIds: [connector.id],
        targetObjectTypeId: created.id,
        tenantId: 'tenant-001',
      };
      setSavedActions((prev) => ({ ...prev, __new__: `Created "${created.displayName}" — opening pipeline...` }));
      setTimeout(() => navigateTo('pipelines', pipelineTemplate), 600);
    } catch (err) {
      log(`Create failed: ${String(err)}`);
    } finally {
      setSavingAction(null);
    }
  };

  const handleBuildPipeline = (match: CorrelationMatch) => {
    if (!inferenceResult) return;
    const now = new Date().toISOString();
    const srcId = `node-src-${Date.now()}`;
    const mapId = `node-map-${Date.now() + 1}`;
    const filterId = `node-filter-${Date.now() + 2}`;
    const sinkId = `node-sink-${Date.now() + 3}`;
    const nodes: PipelineNode[] = [
      { id: srcId, type: 'SOURCE', label: connector.name, config: { connectorId: connector.id }, position: { x: 80, y: 150 }, connectorId: connector.id },
      { id: mapId, type: 'MAP', label: match.pipeline_hint ? 'Extract / Transform' : 'Map Fields',
        config: {
          description: match.pipeline_hint || `Map fields from ${connector.name}`,
          joinKey: match.suggested_join_key || {},
        },
        position: { x: 320, y: 150 },
      },
      { id: filterId, type: 'FILTER', label: 'Filter', config: { description: 'Filter rows (confidence > 0.8)' }, position: { x: 560, y: 150 } },
      { id: sinkId, type: 'SINK_OBJECT', label: match.object_type_name, config: { objectTypeId: match.object_type_id }, position: { x: 800, y: 150 }, objectTypeId: match.object_type_id },
    ];
    const edges: PipelineEdge[] = [
      { id: `e1-${Date.now()}`, source: srcId, target: mapId },
      { id: `e2-${Date.now()}`, source: mapId, target: filterId },
      { id: `e3-${Date.now()}`, source: filterId, target: sinkId },
    ];
    const pipelineName = `${connector.name} → ${match.object_type_name}`;
    const template: Partial<Pipeline> = {
      name: pipelineName,
      description: match.pipeline_hint || `Link ${connector.name} to ${match.object_type_name}`,
      status: 'DRAFT',
      nodes,
      edges,
      connectorIds: [connector.id],
      targetObjectTypeId: match.object_type_id,
      tenantId: 'tenant-001',
    };
    navigateTo('pipelines', template);
  };

  const handleMapToExisting = (
    targetOtId: string,
    targetOtName: string,
    mode: 'enrich' | 'link' | 'nest',
    syncFrequency: string,
    mappings?: Record<string, { include: boolean; transform: string; targetName: string }>,
    nestConfig?: { nestFieldName: string; nestJoinSourceField: string; nestJoinTransform: string; nestJoinTargetField: string },
  ) => {
    const freq = syncFrequency || '1h';
    const srcId = `node-src-${Date.now()}`;
    const sinkId = `node-sink-${Date.now() + 4}`;
    let nodes: PipelineNode[];
    let edges: PipelineEdge[];

    if (mode === 'enrich') {
      const mapIdE = `node-map-${Date.now() + 1}`;
      nodes = [
        { id: srcId, type: 'SOURCE', label: connector.name, config: { connectorId: connector.id, pollFrequency: freq }, position: { x: 80, y: 150 }, connectorId: connector.id },
        { id: mapIdE, type: 'MAP', label: 'Map / Transform', config: { description: `Map fields to ${targetOtName}`, fieldMappings: mappings || {} }, position: { x: 300, y: 150 } },
        { id: sinkId, type: 'SINK_OBJECT', label: targetOtName, config: { objectTypeId: targetOtId }, position: { x: 540, y: 150 }, objectTypeId: targetOtId },
      ];
      edges = [
        { id: `e1-${Date.now()}`, source: srcId, target: mapIdE },
        { id: `e2-${Date.now()}`, source: mapIdE, target: sinkId },
      ];
    } else if (mode === 'nest') {
      const nc = nestConfig || { nestFieldName: 'meetings', nestJoinSourceField: '', nestJoinTransform: 'none', nestJoinTargetField: '' };
      const mapId = `node-map-${Date.now() + 1}`;
      const enrichId = `node-enrich-${Date.now() + 2}`;
      const dedupeId = `node-dedupe-${Date.now() + 3}`;
      nodes = [
        {
          id: srcId, type: 'SOURCE', label: connector.name,
          config: { connectorId: connector.id, pollFrequency: freq },
          position: { x: 80, y: 150 }, connectorId: connector.id,
        },
        {
          id: mapId, type: 'MAP', label: 'Extract join key',
          config: {
            description: `Extract company from ${nc.nestJoinSourceField || 'title'} to match ${targetOtName}`,
            fieldMappings: mappings || {},
            joinKeyExtraction: {
              sourceField: nc.nestJoinSourceField,
              transform: nc.nestJoinTransform,
              outputField: '__join_key__',
            },
          },
          position: { x: 310, y: 150 },
        },
        {
          id: enrichId, type: 'ENRICH', label: `Lookup ${targetOtName}`,
          config: {
            description: `Join to ${targetOtName} where ${nc.nestJoinTargetField || 'name'} matches extracted key`,
            lookupConnectorId: targetOtId,
            joinKey: `__join_key__ → ${nc.nestJoinTargetField || 'name'}`,
            lookupEndpoint: targetOtId,
            fields: `id,${nc.nestJoinTargetField || 'name'}`,
          },
          position: { x: 540, y: 150 },
        },
        {
          id: sinkId, type: 'SINK_OBJECT', label: `${targetOtName}.${nc.nestFieldName}[]`,
          config: {
            objectTypeId: targetOtId,
            writeMode: 'array_append',
            arrayField: nc.nestFieldName,
            mergeKey: nc.nestJoinTargetField || 'name',
          },
          position: { x: 780, y: 150 },
          objectTypeId: targetOtId,
        },
      ];
      edges = [
        { id: `e1-${Date.now()}`, source: srcId, target: mapId },
        { id: `e2-${Date.now()}`, source: mapId, target: enrichId },
        { id: `e3-${Date.now()}`, source: enrichId, target: sinkId },
      ];
    } else {
      const mapId = `node-map-${Date.now() + 1}`;
      const filterId = `node-filter-${Date.now() + 2}`;
      nodes = [
        { id: srcId, type: 'SOURCE', label: connector.name, config: { connectorId: connector.id, pollFrequency: freq }, position: { x: 80, y: 150 }, connectorId: connector.id },
        { id: mapId, type: 'MAP', label: 'Transform', config: { description: `Map fields to ${targetOtName}`, fieldMappings: mappings || {} }, position: { x: 300, y: 150 } },
        { id: filterId, type: 'FILTER', label: 'Filter', config: { description: 'Drop unmatched rows' }, position: { x: 520, y: 150 } },
        { id: sinkId, type: 'SINK_OBJECT', label: targetOtName, config: { objectTypeId: targetOtId }, position: { x: 740, y: 150 }, objectTypeId: targetOtId },
      ];
      edges = [
        { id: `e1-${Date.now()}`, source: srcId, target: mapId },
        { id: `e2-${Date.now()}`, source: mapId, target: filterId },
        { id: `e3-${Date.now()}`, source: filterId, target: sinkId },
      ];
    }

    const descriptions: Record<string, string> = {
      enrich: `Enrich ${targetOtName} from ${connector.name}`,
      link: `Link ${connector.name} to ${targetOtName}`,
      nest: `Nest ${connector.name} records into ${targetOtName}.${nestConfig?.nestFieldName || 'items'}[]`,
    };

    // For nest mode: add the array property to the target object type
    if (mode === 'nest' && nestConfig) {
      const targetOt = objectTypes.find((o) => o.id === targetOtId);
      if (targetOt) {
        const alreadyHas = targetOt.properties.some((p) => p.name === nestConfig.nestFieldName);
        if (!alreadyHas) {
          const newProp: ObjectProperty = {
            id: `prop-nest-${Date.now()}`,
            name: nestConfig.nestFieldName,
            displayName: nestConfig.nestFieldName.charAt(0).toUpperCase() + nestConfig.nestFieldName.slice(1).replace(/_/g, ' '),
            semanticType: 'TEXT',
            dataType: 'array',
            piiLevel: 'NONE',
            required: false,
            sourceConnectorId: connector.id,
            inferenceConfidence: 1.0,
            sampleValues: [],
            description: `Nested array from ${connector.name}`,
          };
          updateObjectType(targetOtId, { properties: [...targetOt.properties, newProp] });
        }
      }
    }

    const template: Partial<Pipeline> = {
      name: `${connector.name} → ${targetOtName}`,
      description: descriptions[mode],
      status: 'DRAFT', nodes, edges,
      connectorIds: [connector.id],
      targetObjectTypeId: targetOtId,
      tenantId: 'tenant-001',
    };
    navigateTo('pipelines', template);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>

      {/* Inference panel */}
      <div style={{ border: '1px solid #E2E8F0', borderRadius: '4px', overflow: 'hidden' }}>
        <div style={{
          padding: '12px 16px',
          backgroundColor: '#F8FAFC',
          borderBottom: '1px solid #E2E8F0',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <div>
            <div style={{ fontSize: '13px', fontWeight: 500, color: '#0D1117' }}>Schema Inference</div>
            <div style={{ fontSize: '11px', color: '#64748B', marginTop: '2px' }}>
              Claude analyzes your schema and labels each field with a semantic type and PII level
            </div>
          </div>
          <button
            onClick={runInference}
            disabled={inferring}
            style={{
              display: 'flex', alignItems: 'center', gap: '6px',
              height: '32px', padding: '0 14px',
              backgroundColor: inferring ? '#93C5FD' : '#2563EB',
              color: '#FFFFFF', border: 'none', borderRadius: '4px',
              fontSize: '12px', fontWeight: 500, cursor: inferring ? 'not-allowed' : 'pointer',
              flexShrink: 0,
            }}
          >
            <Cpu size={13} />
            {inferring ? 'Running...' : 'Run Inference'}
          </button>
        </div>

        <div style={{ padding: '12px 16px' }}>
          <button
            onClick={() => setShowInput((v) => !v)}
            style={{
              fontSize: '12px', color: '#2563EB', background: 'none',
              border: 'none', cursor: 'pointer', padding: 0, marginBottom: showInput ? '10px' : 0,
            }}
          >
            {showInput ? 'Hide' : '+ Paste raw schema / sample rows (optional)'}
          </button>

          {showInput && (
            <textarea
              value={rawSchemaInput}
              onChange={(e) => setRawSchemaInput(e.target.value)}
              placeholder={'Paste JSON schema or sample rows here, e.g.:\n{"fields": [{"name": "email", "type": "string"}, ...]}'}
              rows={6}
              style={{
                width: '100%', boxSizing: 'border-box',
                border: '1px solid #E2E8F0', borderRadius: '4px',
                padding: '8px 10px', fontSize: '12px',
                fontFamily: 'var(--font-mono)', color: '#0D1117',
                resize: 'vertical', outline: 'none',
              }}
            />
          )}
        </div>
      </div>

      {/* Status log */}
      {statusLog.length > 0 && (
        <div style={{
          backgroundColor: '#0D1117', borderRadius: '4px',
          padding: '10px 14px', fontFamily: 'var(--font-mono)', fontSize: '11px',
          color: '#94A3B8', display: 'flex', flexDirection: 'column', gap: '3px',
        }}>
          {statusLog.map((line, i) => (
            <div key={i} style={{ color: line.includes('Error') ? '#F87171' : line.includes('complete') ? '#34D399' : '#94A3B8' }}>
              {line}
            </div>
          ))}
          {(inferring || fetchingSchema) && (
            <div style={{ color: '#60A5FA' }}>...</div>
          )}
        </div>
      )}

      {/* Error */}
      {inferenceError && (
        <div style={{
          padding: '10px 14px', backgroundColor: '#FEF2F2',
          border: '1px solid #FECACA', borderRadius: '4px',
          fontSize: '12px', color: '#991B1B',
        }}>
          {inferenceError}
        </div>
      )}

      {/* Raw schema preview (before inference or when no inference result yet) */}
      {fetchedSchema && !inferenceResult && (
        <div style={{ border: '1px solid #E2E8F0', borderRadius: '4px', overflow: 'hidden' }}>
          <div style={{ padding: '10px 14px', backgroundColor: '#F8FAFC', borderBottom: '1px solid #E2E8F0', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '12px', fontWeight: 500, color: '#0D1117' }}>Raw Schema</span>
            <span style={{ fontSize: '11px', color: '#94A3B8' }}>
              {Object.keys(fetchedSchema.schema?.fields || fetchedSchema.schema || {}).length || 0} fields · {(fetchedSchema.sample_rows || []).length} sample rows
            </span>
            {fetchingSchema && <span style={{ fontSize: '11px', color: '#60A5FA' }}>loading…</span>}
          </div>
          {(fetchedSchema.sample_rows || []).length > 0 && (
            <div style={{ overflowX: 'auto', maxHeight: '220px', overflowY: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '11px' }}>
                <thead>
                  <tr style={{ backgroundColor: '#F8FAFC', position: 'sticky', top: 0 }}>
                    {Object.keys((fetchedSchema.sample_rows![0] as Record<string, unknown>) || {}).map((c) => (
                      <th key={c} style={{ padding: '5px 8px', textAlign: 'left', fontWeight: 600, color: '#64748B', borderBottom: '1px solid #E2E8F0', whiteSpace: 'nowrap', fontFamily: 'var(--font-mono)', fontSize: '10px' }}>{c}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {fetchedSchema.sample_rows!.slice(0, 5).map((row, i) => (
                    <tr key={i} style={{ borderBottom: '1px solid #F1F5F9' }}>
                      {Object.keys((row as Record<string, unknown>) || {}).map((c) => {
                        const val = (row as Record<string, unknown>)[c];
                        const display = val == null ? '' : typeof val === 'object' ? JSON.stringify(val) : String(val);
                        return (
                          <td key={c} style={{ padding: '4px 8px', color: '#0D1117', maxWidth: '140px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontFamily: 'var(--font-mono)', fontSize: '11px' }} title={display}>
                            {display || <span style={{ color: '#CBD5E1' }}>—</span>}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {fetchedSchema.error && (
            <div style={{ padding: '8px 14px', fontSize: '11px', color: '#D97706' }}>{fetchedSchema.error}</div>
          )}
        </div>
      )}

      {/* Inference result */}
      {inferenceResult && (() => {
        // Build merged field list: ALL raw API columns + any extra Claude labeled
        const inferredFields: any[] = (inferenceResult as any).fields || [];
        const inferredBySource = Object.fromEntries(inferredFields.map((f: any) => [f.source_field, f]));
        const rawCols: string[] = fetchedSchema?.sample_rows?.length
          ? Object.keys((fetchedSchema.sample_rows[0] as Record<string, unknown>) || {})
          : [];
        // All fields: raw cols first, then any inferred fields not in raw cols
        const extraInferred = inferredFields.filter((f: any) => !rawCols.includes(f.source_field));
        const allFieldKeys = [...rawCols, ...extraInferred.map((f: any) => f.source_field)];
        // Sample value picker: first non-empty value across all rows
        const sampleVal = (col: string) => {
          for (const row of (fetchedSchema?.sample_rows || [])) {
            const v = (row as Record<string, unknown>)[col];
            if (v == null) continue;
            const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
            if (s.trim()) return s;
          }
          return null;
        };
        return (
        <div>
          <div style={{ fontSize: '13px', fontWeight: 500, color: '#0D1117', marginBottom: '4px', display: 'flex', alignItems: 'center', gap: '8px' }}>
            Inference Result — {(inferenceResult as any).suggested_object_type_name}
            <span style={{ fontSize: '11px', fontWeight: 400, color: '#059669', backgroundColor: '#ECFDF5', padding: '2px 6px', borderRadius: '2px' }}>
              {Math.round(((inferenceResult as any).overall_confidence || 0) * 100)}% confidence
            </span>
            <span style={{ fontSize: '11px', color: '#94A3B8', fontWeight: 400 }}>
              {inferredFields.length} labeled · {rawCols.length - inferredFields.filter((f: any) => rawCols.includes(f.source_field)).length} unlabeled · {rawCols.length} raw cols
            </span>
          </div>
          <div style={{ fontSize: '11px', color: '#94A3B8', marginBottom: '10px' }}>
            Rows highlighted in <span style={{ color: '#64748B', backgroundColor: '#F8FAFC', padding: '0 4px', borderRadius: '2px' }}>grey</span> were not labeled by inference — you can still use them
          </div>
          <div style={{ border: '1px solid #E2E8F0', borderRadius: '4px', overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
              <thead>
                <tr style={{ backgroundColor: '#F8FAFC' }}>
                  {['Source Field', 'Canonical Name', 'Semantic Type', 'PII', 'Conf', 'Sample Value'].map((h) => (
                    <th key={h} style={{ padding: '6px 10px', textAlign: 'left', fontWeight: 500, color: '#64748B', borderBottom: '1px solid #E2E8F0', fontSize: '11px', whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {allFieldKeys.map((col, i) => {
                  const f = inferredBySource[col];
                  const sv = sampleVal(col);
                  const unlabeled = !f;
                  return (
                    <tr key={i} style={{ borderBottom: '1px solid #F1F5F9', backgroundColor: unlabeled ? '#FAFAFA' : 'transparent' }}>
                      <td style={{ padding: '5px 10px', fontFamily: 'var(--font-mono)', color: unlabeled ? '#94A3B8' : '#64748B', fontSize: '11px' }}>{col}</td>
                      <td style={{ padding: '5px 10px', fontWeight: unlabeled ? 400 : 500, color: unlabeled ? '#CBD5E1' : '#0D1117' }}>
                        {f?.suggested_name || <span style={{ color: '#CBD5E1', fontSize: '11px' }}>—</span>}
                      </td>
                      <td style={{ padding: '5px 10px' }}>
                        {f ? (
                          <span style={{ backgroundColor: '#EFF6FF', color: '#1D4ED8', padding: '1px 6px', borderRadius: '2px', fontSize: '11px' }}>{f.semantic_type}</span>
                        ) : (
                          <span style={{ color: '#CBD5E1', fontSize: '11px' }}>—</span>
                        )}
                      </td>
                      <td style={{ padding: '5px 10px' }}>
                        {f ? (
                          <span style={{
                            padding: '1px 6px', borderRadius: '2px', fontSize: '11px',
                            backgroundColor: f.pii_level === 'HIGH' ? '#FEF2F2' : f.pii_level === 'LOW' ? '#FFFBEB' : '#F1F5F9',
                            color: f.pii_level === 'HIGH' ? '#991B1B' : f.pii_level === 'LOW' ? '#92400E' : '#64748B',
                          }}>{f.pii_level}</span>
                        ) : <span style={{ color: '#CBD5E1', fontSize: '11px' }}>—</span>}
                      </td>
                      <td style={{ padding: '5px 10px', fontFamily: 'var(--font-mono)', color: '#94A3B8', fontSize: '11px' }}>
                        {f ? `${Math.round(f.confidence * 100)}%` : <span style={{ color: '#CBD5E1' }}>—</span>}
                      </td>
                      <td style={{ padding: '5px 10px', maxWidth: '180px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {sv ? (
                          <span style={{ fontSize: '11px', fontFamily: 'var(--font-mono)', color: '#475569', backgroundColor: '#F8FAFC', padding: '1px 5px', borderRadius: '2px' }} title={sv}>{sv}</span>
                        ) : (
                          <span style={{ fontSize: '11px', color: '#CBD5E1' }}>empty</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {(inferenceResult as any).warnings?.length > 0 && (
            <div style={{ marginTop: '10px', padding: '8px 12px', backgroundColor: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: '4px', fontSize: '12px', color: '#92400E' }}>
              {(inferenceResult as any).warnings.join(' · ')}
            </div>
          )}

          {/* Correlation Analysis */}
          <CorrelationPanel
            result={correlationResult}
            correlating={correlating}
            savingAction={savingAction}
            savedActions={savedActions}
            onEnrich={handleEnrich}
            onCreateNew={handleCreateNew}
            onBuildPipeline={handleBuildPipeline}
            onMapToExisting={handleMapToExisting}
            inferredName={(inferenceResult as any)?.suggested_object_type_name || connector.name}
            allFields={((inferenceResult as any)?.fields || []).map((f: any) => ({
              name: f.suggested_name || f.source_field,
              semanticType: f.semantic_type || 'TEXT',
              piiLevel: f.pii_level || 'NONE',
            }))}
            fieldSourceMap={Object.fromEntries(
              ((inferenceResult as any)?.fields || []).map((f: any) => [
                f.suggested_name || f.source_field,
                f.source_field,
              ])
            )}
            existingObjectTypes={objectTypes}
            sampleRows={fetchedSchema?.sample_rows}
          />
        </div>
        );
      })()}

      {!inferenceResult && !inferring && statusLog.length === 0 && (
        <div style={{ textAlign: 'center', padding: '24px 0', color: '#94A3B8', fontSize: '13px' }}>
          Click "Run Inference" — Claude will fetch your schema from {connector.type} and label each field.
        </div>
      )}
    </div>
  );
};

const HealthTab: React.FC<{
  healthHistory: Array<{ timestamp: string; successRate: number; avgLatencyMs: number; rowsProcessed: number; status: string }>;
  connector: ConnectorConfig;
}> = ({ healthHistory, connector }) => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
    {healthHistory.length > 0 ? (
      <>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px' }}>
          {[
            {
              label: 'Avg Success Rate',
              value: `${Math.round((healthHistory.reduce((s, h) => s + h.successRate, 0) / healthHistory.length) * 100)}%`,
              color: '#059669',
            },
            {
              label: 'Avg Latency',
              value: `${Math.round(healthHistory.reduce((s, h) => s + h.avgLatencyMs, 0) / healthHistory.length)}ms`,
              color: '#0D1117',
            },
            {
              label: 'Total Rows (24h)',
              value: healthHistory.reduce((s, h) => s + h.rowsProcessed, 0).toLocaleString(),
              color: '#0D1117',
            },
          ].map((stat) => (
            <div key={stat.label} style={{ border: '1px solid #E2E8F0', borderRadius: '4px', padding: '12px' }}>
              <div style={{ fontSize: '11px', color: '#94A3B8', marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{stat.label}</div>
              <div style={{ fontSize: '20px', fontWeight: 600, color: stat.color, fontFamily: 'var(--font-mono)' }}>{stat.value}</div>
            </div>
          ))}
        </div>

        <ConnectorHealthBar history={healthHistory as any} />

        <div>
          <div style={{ fontSize: '13px', fontWeight: 500, color: '#0D1117', marginBottom: '8px' }}>Sync Timeline</div>
          <table>
            <thead>
              <tr>
                <th>Time</th>
                <th>Status</th>
                <th>Success Rate</th>
                <th>Latency</th>
                <th>Rows</th>
              </tr>
            </thead>
            <tbody>
              {healthHistory.slice(-10).reverse().map((h, i) => (
                <tr key={i}>
                  <td style={{ fontSize: '12px', fontFamily: 'var(--font-mono)', color: '#64748B' }}>
                    {new Date(h.timestamp).toLocaleTimeString()}
                  </td>
                  <td>
                    <StatusDot status={h.status as any} showLabel size={6} />
                  </td>
                  <td style={{ fontSize: '12px', color: h.successRate >= 0.95 ? '#059669' : '#D97706', fontFamily: 'var(--font-mono)' }}>
                    {Math.round(h.successRate * 100)}%
                  </td>
                  <td style={{ fontSize: '12px', fontFamily: 'var(--font-mono)', color: '#64748B' }}>
                    {h.avgLatencyMs}ms
                  </td>
                  <td style={{ fontSize: '12px', fontFamily: 'var(--font-mono)', color: '#64748B' }}>
                    {h.rowsProcessed.toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </>
    ) : (
      <div style={{ textAlign: 'center', padding: '40px 0', color: '#94A3B8', fontSize: '13px' }}>
        No health history available
      </div>
    )}
  </div>
);

const simulateTransform = (value: string, transform: string): { output: string; note?: string } => {
  switch (transform) {
    case 'none':       return { output: value };
    case 'trim':       return { output: value.trim() };
    case 'lowercase':  return { output: value.toLowerCase() };
    case 'uppercase':  return { output: value.toUpperCase() };
    case 'extract_number': {
      const m = value.match(/[-+]?\d*\.?\d+/);
      return m ? { output: m[0] } : { output: '', note: 'No number found in input' };
    }
    case 'normalize_phone': {
      const digits = value.replace(/\D/g, '');
      if (digits.length === 10) return { output: `+1${digits}` };
      if (digits.length === 11 && digits[0] === '1') return { output: `+${digits}` };
      return { output: value, note: 'Unrecognized format — returned as-is' };
    }
    case 'format_date': {
      const d = new Date(value);
      return isNaN(d.getTime())
        ? { output: '', note: 'Could not parse date string' }
        : { output: d.toISOString() };
    }
    case 'extract_name':
      return { output: 'NLP required', note: 'spaCy PERSON entity extraction — not available in browser preview' };
    case 'extract_company': {
      // Browser heuristic: pick first capitalised token that isn't a stop word
      const stop = new Set(['zoom', 'maic', 'sesion', 'session', 'demo', 'meet', 'call', 'sync', 'con', 'de', 'la', 'el', 'y', 'and', 'the']);
      const tokens = value.split(/[\s|/\-&×x]+/).filter((w) => w.length > 2);
      const company = tokens.find((w) => !stop.has(w.toLowerCase()) && /^[A-Z]/.test(w));
      return company
        ? { output: company, note: 'Browser heuristic — production uses spaCy NER' }
        : { output: '(not found)', note: 'No company detected — production uses spaCy NER' };
    }
    default: return { output: value };
  }
};

const TransformSandbox: React.FC<{ transform: string; initialInput?: string }> = ({ transform, initialInput = '' }) => {
  const [input, setInput] = React.useState(initialInput);
  const result = input ? simulateTransform(input, transform) : null;
  return (
    <div style={{ backgroundColor: '#0D1117', borderTop: '1px solid #1E293B', padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
      <div style={{ fontSize: '10px', color: '#60A5FA', fontWeight: 600, fontFamily: 'var(--font-mono)' }}>Try it</div>
      <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Paste a sample value…"
          style={{
            flex: 1, height: '26px', padding: '0 8px',
            backgroundColor: '#1E293B', border: '1px solid #334155',
            borderRadius: '3px', fontSize: '12px', fontFamily: 'var(--font-mono)',
            color: '#E2E8F0', outline: 'none',
          }}
        />
        {input && (
          <button
            onClick={() => setInput('')}
            style={{ background: 'none', border: 'none', color: '#475569', cursor: 'pointer', fontSize: '12px', padding: '0 2px' }}
          >x</button>
        )}
      </div>
      {result && (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '10px', color: '#475569', fontFamily: 'var(--font-mono)' }}>output:</span>
            <span style={{
              fontSize: '12px', fontFamily: 'var(--font-mono)',
              color: result.output.startsWith('NLP') ? '#FBBF24' : '#34D399',
              backgroundColor: '#0F2027', padding: '1px 8px', borderRadius: '2px',
            }}>
              {result.output || '(empty)'}
            </span>
          </div>
          {result.note && (
            <div style={{ fontSize: '10px', color: '#64748B', marginTop: '3px', fontStyle: 'italic' }}>{result.note}</div>
          )}
        </div>
      )}
    </div>
  );
};

// ── Match helpers ─────────────────────────────────────────────────────────────
function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  );
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
  return dp[m][n];
}

function strSim(a: string, b: string, algorithm: 'exact' | 'fuzzy' | 'semantic'): number {
  if (!a || !b) return 0;
  const al = a.toLowerCase().trim(), bl = b.toLowerCase().trim();
  if (al === bl) return 1;
  if (algorithm === 'exact') return 0;
  if (algorithm === 'fuzzy') {
    const longer = al.length > bl.length ? al : bl;
    const dist = levenshtein(longer, al.length > bl.length ? bl : al);
    return (longer.length - dist) / longer.length;
  }
  // semantic: token overlap
  const at = new Set(al.split(/\W+/).filter(Boolean));
  const bt = new Set(bl.split(/\W+/).filter(Boolean));
  const inter = [...at].filter((t) => bt.has(t)).length;
  return inter / Math.max(at.size, bt.size, 1);
}

function parseNLRule(query: string): { algorithm: 'exact' | 'fuzzy' | 'semantic'; threshold: number; note: string } {
  const q = query.toLowerCase();
  if (q.includes('exact') || q.includes('strict') || q.includes('identical'))
    return { algorithm: 'exact', threshold: 100, note: 'Exact match — values must be identical (case-insensitive)' };
  if (q.includes('semantic') || q.includes('meaning') || q.includes('keyword') || q.includes('topic'))
    return { algorithm: 'semantic', threshold: 50, note: 'Semantic token overlap — matches shared keywords' };
  if (q.includes('loose') || q.includes('approximate') || q.includes('close') || q.includes('similar'))
    return { algorithm: 'fuzzy', threshold: 55, note: 'Loose fuzzy match — tolerates spelling variations' };
  if (q.includes('contain') || q.includes('start') || q.includes('begin'))
    return { algorithm: 'fuzzy', threshold: 60, note: 'Fuzzy prefix/containment match' };
  return { algorithm: 'fuzzy', threshold: 70, note: 'Fuzzy match (default)' };
}

// ── NL → transform code suggestions ─────────────────────────────────────────
function nlToCodeSuggestion(query: string, currentCode: string): { code: string; explanation: string } {
  const q = query.toLowerCase().trim();

  if (q.includes('first word') || q.match(/split.*space|first.*token/))
    return { code: `def transform(value):\n    if not value:\n        return None\n    return str(value).split()[0]`, explanation: 'Returns the first whitespace-separated token.' };

  if (q.match(/before.*(dash|hyphen|-)/))
    return { code: `def transform(value):\n    return str(value).split('-')[0].strip()`, explanation: 'Takes everything before the first dash.' };

  if (q.match(/before.*(slash|\/)/))
    return { code: `def transform(value):\n    return str(value).split('/')[0].strip()`, explanation: 'Takes everything before the first slash.' };

  if (q.match(/before.*pipe|\|/))
    return { code: `def transform(value):\n    return str(value).split('|')[0].strip()`, explanation: 'Takes everything before the pipe character.' };

  if (q.match(/ignore.*(maic|common|stop|word)|remove.*(maic|brand)/)) {
    const word = q.match(/ignore\s+["']?(\w+)["']?/)?.[1] || 'maic';
    return { code: `STOP = {'${word}', 'x', 'demo', 'session', 'sync', 'meet', 'call'}\n\ndef transform(value):\n    tokens = str(value).replace('|', ' ').replace('/', ' ').split()\n    kept = [t for t in tokens if t.lower() not in STOP and len(t) > 2]\n    return kept[0] if kept else value`, explanation: `Removes stop words like "${word}" and common filler tokens.` };
  }

  if (q.match(/lowercase|lower/))
    return { code: `${currentCode}\n    # apply lowercase\n    return value.lower() if isinstance(value, str) else value`, explanation: 'Adds lowercasing to the result.' };

  if (q.match(/strip|trim/))
    return { code: currentCode.replace('return ', 'return str(').replace(/(\n\s+return .+)/, '$1).strip()'), explanation: 'Strips leading/trailing whitespace from the output.' };

  if (q.match(/regex|pattern|match/)) {
    const pat = q.match(/["'`]([^"'`]+)["'`]/)?.[1] || '[A-Z][a-z]+';
    return { code: `import re\n\ndef transform(value):\n    match = re.search(r'${pat}', str(value))\n    return match.group() if match else None`, explanation: `Applies regex pattern: ${pat}` };
  }

  return {
    code: `# Custom transform based on: "${query}"\n# Edit the logic below:\ndef transform(value):\n    result = str(value) if value is not None else ''\n    # TODO: implement your logic here\n    return result`,
    explanation: `I couldn't auto-generate this exactly, but here's a starting template you can edit.`,
  };
}

interface ChatMessage { role: 'user' | 'bot'; text: string; code?: string }

const TransformEditorChat: React.FC<{
  transform: string;
  customCode: string;
  onCodeChange: (code: string) => void;
}> = ({ transform, customCode, onCodeChange }) => {
  const [messages, setMessages] = React.useState<ChatMessage[]>([
    { role: 'bot', text: 'Edit the transform code directly, or describe what you want and I\'ll generate it.' },
  ]);
  const [input, setInput] = React.useState('');
  const messagesEndRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = () => {
    const q = input.trim();
    if (!q) return;
    setMessages((m) => [...m, { role: 'user', text: q }]);
    setInput('');
    const { code, explanation } = nlToCodeSuggestion(q, customCode);
    setTimeout(() => {
      setMessages((m) => [...m, { role: 'bot', text: explanation, code }]);
    }, 320);
  };

  const applyCode = (code: string) => {
    onCodeChange(code);
    setMessages((m) => [...m, { role: 'bot', text: 'Applied to transform. The sandbox preview above has been updated.' }]);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* Code editor */}
      <div style={{ padding: '10px 12px', borderBottom: '1px solid #1E293B', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
          <span style={{ fontSize: '10px', fontWeight: 600, color: '#60A5FA', fontFamily: 'var(--font-mono)' }}>
            Python — {transform !== 'none' ? transform : 'custom'}
          </span>
          <span style={{ fontSize: '10px', color: '#475569' }}>browser-simulated · production runs spaCy/pandas</span>
        </div>
        <textarea
          value={customCode}
          onChange={(e) => onCodeChange(e.target.value)}
          spellCheck={false}
          style={{
            width: '100%', boxSizing: 'border-box',
            backgroundColor: '#0F172A', color: '#A5F3FC',
            border: '1px solid #334155', borderRadius: '3px',
            padding: '8px 10px', fontSize: '11px',
            fontFamily: 'var(--font-mono)', lineHeight: '1.6',
            resize: 'vertical', outline: 'none', minHeight: '100px',
          }}
        />
      </div>

      {/* Chat messages */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '8px 12px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
        {messages.map((msg, i) => (
          <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: '3px', alignItems: msg.role === 'user' ? 'flex-end' : 'flex-start' }}>
            <div style={{
              maxWidth: '85%', padding: '6px 10px', borderRadius: '8px',
              fontSize: '12px', lineHeight: 1.4,
              backgroundColor: msg.role === 'user' ? '#3730A3' : '#1E293B',
              color: msg.role === 'user' ? '#E0E7FF' : '#CBD5E1',
            }}>
              {msg.text}
            </div>
            {msg.code && (
              <div style={{ maxWidth: '90%', border: '1px solid #334155', borderRadius: '4px', overflow: 'hidden' }}>
                <pre style={{ margin: 0, padding: '6px 10px', backgroundColor: '#0F172A', color: '#86EFAC', fontSize: '11px', fontFamily: 'var(--font-mono)', lineHeight: 1.5 }}>
                  {msg.code}
                </pre>
                <button
                  onClick={() => applyCode(msg.code!)}
                  style={{ width: '100%', padding: '4px', backgroundColor: '#1E3A5F', color: '#60A5FA', border: 'none', borderTop: '1px solid #334155', fontSize: '11px', fontWeight: 600, cursor: 'pointer' }}
                >
                  ↑ Apply this code
                </button>
              </div>
            )}
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* Chat input */}
      <div style={{ padding: '8px 12px', borderTop: '1px solid #1E293B', display: 'flex', gap: '6px', flexShrink: 0 }}>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') handleSend(); }}
          placeholder='e.g. "take everything before the dash" or "ignore the word maic"'
          style={{
            flex: 1, height: '30px', padding: '0 10px',
            backgroundColor: '#1E293B', border: '1px solid #334155',
            borderRadius: '4px', fontSize: '12px', color: '#E2E8F0',
            outline: 'none', fontFamily: 'var(--font-interface)',
          }}
        />
        <button
          onClick={handleSend}
          style={{ height: '30px', padding: '0 12px', backgroundColor: '#4F46E5', color: '#FFFFFF', border: 'none', borderRadius: '4px', fontSize: '12px', fontWeight: 600, cursor: 'pointer' }}
        >
          →
        </button>
      </div>
    </div>
  );
};

const MatchSandboxModal: React.FC<{
  sourceRows: unknown[];
  sourceField: string;
  transform: string;
  targetObjectType?: { id: string; displayName: string; properties?: Array<{ name: string; displayName: string }>; sourceConnectorIds?: string[] };
  targetField: string;
  algorithm: 'exact' | 'fuzzy' | 'semantic';
  threshold: number;
  fieldSourceMap?: Record<string, string>;
  onClose: () => void;
  onApply: (cfg: { algorithm: 'exact' | 'fuzzy' | 'semantic'; threshold: number }) => void;
}> = ({ sourceRows, sourceField, transform, targetObjectType, targetField, algorithm: initAlg, threshold: initThresh, fieldSourceMap, onClose, onApply }) => {
  const targetObjectName = targetObjectType?.displayName || 'Target';
  const [algorithm, setAlgorithm] = React.useState<'exact' | 'fuzzy' | 'semantic'>(initAlg);
  const [threshold, setThreshold] = React.useState(initThresh);
  const [nlQuery, setNlQuery] = React.useState('');
  const [nlResult, setNlResult] = React.useState<{ note: string } | null>(null);
  const [newTarget, setNewTarget] = React.useState('');
  const [editorOpen, setEditorOpen] = React.useState(false);
  const [customCode, setCustomCode] = React.useState(TRANSFORM_CODE[transform] || TRANSFORM_CODE['none']);
  const [targetTransform, setTargetTransform] = React.useState<string>('none');
  const [targetLoading, setTargetLoading] = React.useState(false);
  const [targetValues, setTargetValues] = React.useState<string[]>([]);
  // which raw connector column is being used (shown to user so they can override)
  const [resolvedTargetCol, setResolvedTargetCol] = React.useState<string>('');
  const [availableCols, setAvailableCols] = React.useState<string[]>([]);

  // Resolve the original API field name from the canonical name
  const actualSourceField = (fieldSourceMap && fieldSourceMap[sourceField]) || sourceField;

  // Find the connector column that best matches the canonical targetField name
  const bestMatchingCol = (cols: string[], canonical: string): string => {
    if (!cols.length) return '';
    // exact match first
    if (cols.includes(canonical)) return canonical;
    // fuzzy: score each col against the canonical name and pick the highest
    let best = { col: cols[0], score: 0 };
    cols.forEach((col) => {
      const score = strSim(col.replace(/_/g, ''), canonical.replace(/_/g, ''), 'fuzzy');
      if (score > best.score) best = { col, score };
    });
    return best.score > 0.4 ? best.col : cols[0];
  };

  // Fetch real target values from the object type's source connectors
  React.useEffect(() => {
    const connectorIds = targetObjectType?.sourceConnectorIds || [];
    if (!connectorIds.length || !targetField) {
      setTargetValues([]);
      return;
    }
    setTargetLoading(true);
    Promise.all(
      connectorIds.map((cid) =>
        fetch(`${CONNECTOR_API}/connectors/${cid}/schema`)
          .then((r) => r.ok ? r.json() : null)
          .catch(() => null)
      )
    ).then((results) => {
      const values: string[] = [];
      let pickedCol = '';
      let cols: string[] = [];

      results.forEach((data) => {
        if (!data) return;
        const rows: unknown[] = data.sample_rows || [];
        if (!rows.length) return;

        // Discover all columns from first row
        const rowCols = Object.keys(rows[0] as Record<string, unknown>);
        if (!cols.length) {
          cols = rowCols;
          pickedCol = resolvedTargetCol || bestMatchingCol(rowCols, targetField);
        }

        rows.forEach((row) => {
          const r = row as Record<string, unknown>;
          const val = r[pickedCol];
          if (val !== null && val !== undefined && String(val).trim()) {
            values.push(String(val).trim());
          }
        });
      });

      setAvailableCols(cols);
      if (pickedCol) setResolvedTargetCol(pickedCol);
      const unique = [...new Set(values)].filter(Boolean).slice(0, 20);
      setTargetValues(unique);
    }).finally(() => setTargetLoading(false));
  }, [targetObjectType?.id, targetField, resolvedTargetCol]);

  // Extract source values — try custom code first, fall back to built-in simulate
  const applyCustomCode = (rawStr: string): string => {
    // If the user edited the code and it contains a recognisable built-in, delegate
    for (const opt of Object.keys(TRANSFORM_CODE)) {
      if (opt !== 'none' && customCode === TRANSFORM_CODE[opt]) return simulateTransform(rawStr, opt).output;
    }
    // Try to detect simple patterns from the custom code
    if (/\.split\(\s*\)\s*\[0\]/.test(customCode)) return rawStr.split(/\s+/)[0] || rawStr;
    if (/\.split\('([^']+)'\)\s*\[0\]/.test(customCode)) {
      const sep = customCode.match(/\.split\('([^']+)'\)/)?.[1] || ' ';
      return rawStr.split(sep)[0].trim();
    }
    if (/\.lower\(\)/.test(customCode)) return rawStr.toLowerCase();
    if (/\.upper\(\)/.test(customCode)) return rawStr.toUpperCase();
    if (/\.strip\(\)/.test(customCode)) return rawStr.trim();
    // Fall back to standard transform
    return simulateTransform(rawStr, transform).output;
  };

  const sourceItems = sourceRows.slice(0, 8).map((row) => {
    const raw = (row as Record<string, unknown>)[sourceField]
      ?? (row as Record<string, unknown>)[actualSourceField];
    const rawStr = raw !== null && raw !== undefined ? String(raw) : '';
    const extracted = rawStr ? applyCustomCode(rawStr) : '';
    return { raw: rawStr, extracted };
  }).filter((r) => r.raw);

  // Apply target transform before matching
  const transformedTargetValues = targetValues.map((tv) =>
    targetTransform !== 'none' ? simulateTransform(tv, targetTransform).output : tv
  );

  // Compute matches
  const matches = sourceItems.map((src) => {
    const scores = transformedTargetValues.map((tv, i) => ({ target: targetValues[i], transformed: tv, score: strSim(src.extracted, tv, algorithm) }));
    const best = scores.reduce((a, b) => (a.score > b.score ? a : b), { target: '', transformed: '', score: 0 });
    const matched = best.score * 100 >= threshold;
    return { ...src, best, matched, scores };
  });

  const matchCount = matches.filter((m) => m.matched).length;

  const handleNL = () => {
    if (!nlQuery.trim()) return;
    const parsed = parseNLRule(nlQuery);
    setAlgorithm(parsed.algorithm);
    setThreshold(parsed.threshold);
    setNlResult({ note: parsed.note });
  };

  const scoreColor = (score: number) => {
    if (score >= 0.85) return '#059669';
    if (score >= 0.6) return '#D97706';
    return '#DC2626';
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9999,
      backgroundColor: 'rgba(0,0,0,0.55)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{
        width: editorOpen ? '1200px' : '900px', maxWidth: '97vw', maxHeight: '90vh',
        backgroundColor: '#FFFFFF', borderRadius: '8px',
        boxShadow: '0 24px 64px rgba(0,0,0,0.3)',
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
        transition: 'width 200ms ease',
      }}>
        {/* Header */}
        <div style={{ padding: '14px 20px', borderBottom: '1px solid #E2E8F0', display: 'flex', alignItems: 'center', gap: '12px', flexShrink: 0, backgroundColor: '#F8FAFC' }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: '15px', fontWeight: 600, color: '#0D1117' }}>Match Sandbox</div>
            <div style={{ fontSize: '12px', color: '#64748B', marginTop: '2px' }}>
              <code style={{ backgroundColor: '#EEF2FF', color: '#4F46E5', padding: '1px 4px', borderRadius: '2px' }}>{sourceField}</code>
              {' '}→ {transform !== 'none' ? <code style={{ backgroundColor: '#FEF3C7', color: '#92400E', padding: '1px 4px', borderRadius: '2px' }}>{transform}</code> : null}
              {' '}→ match to{' '}
              <code style={{ backgroundColor: '#ECFDF5', color: '#065F46', padding: '1px 4px', borderRadius: '2px' }}>{targetObjectName}.{targetField || 'field'}</code>
              {targetTransform !== 'none' && <>{' '}→ <code style={{ backgroundColor: '#FEF3C7', color: '#92400E', padding: '1px 4px', borderRadius: '2px' }}>{targetTransform}</code></>}
            </div>
          </div>
          <button
            onClick={() => setEditorOpen((v) => !v)}
            style={{
              height: '28px', padding: '0 12px', borderRadius: '4px', fontSize: '11px', fontWeight: 600, cursor: 'pointer',
              border: `1px solid ${editorOpen ? '#6366F1' : '#E2E8F0'}`,
              backgroundColor: editorOpen ? '#EEF2FF' : '#FFFFFF',
              color: editorOpen ? '#4F46E5' : '#64748B',
              display: 'flex', alignItems: 'center', gap: '5px',
            }}
          >
            {'</>'} {editorOpen ? 'Hide editor' : 'Edit transform'}
          </button>
          <button onClick={onClose} style={{ width: 28, height: 28, borderRadius: '4px', border: '1px solid #E2E8F0', backgroundColor: '#FFFFFF', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#64748B', fontSize: '14px' }}>x</button>
        </div>

        {/* NL Rule bar */}
        <div style={{ padding: '10px 20px', borderBottom: '1px solid #E2E8F0', backgroundColor: '#FAFBFF', display: 'flex', gap: '8px', alignItems: 'center', flexShrink: 0 }}>
          <span style={{ fontSize: '11px', fontWeight: 600, color: '#7C3AED', whiteSpace: 'nowrap' }}>Describe rule:</span>
          <input
            value={nlQuery}
            onChange={(e) => setNlQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleNL(); }}
            placeholder={`e.g. "fuzzy match, allow minor variations" or "exact match only" or "semantic keyword overlap"`}
            style={{ flex: 1, height: '30px', padding: '0 10px', border: '1px solid #C4B5FD', borderRadius: '4px', fontSize: '12px', color: '#0D1117', outline: 'none', backgroundColor: '#FFFFFF' }}
          />
          <button
            onClick={handleNL}
            style={{ height: '30px', padding: '0 14px', backgroundColor: '#7C3AED', color: '#FFFFFF', border: 'none', borderRadius: '4px', fontSize: '12px', fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' }}
          >
            Apply →
          </button>
        </div>
        {nlResult && (
          <div style={{ padding: '5px 20px', backgroundColor: '#EDE9FE', fontSize: '11px', color: '#6D28D9', flexShrink: 0 }}>
            {nlResult.note}
          </div>
        )}

        <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'row' }}>
        {/* ── Editor panel (right side when open) ── */}
        {editorOpen && (
          <div style={{ width: '340px', flexShrink: 0, borderLeft: '1px solid #1E293B', backgroundColor: '#0D1117', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <div style={{ padding: '8px 12px', borderBottom: '1px solid #1E293B', fontSize: '11px', fontWeight: 600, color: '#60A5FA' }}>
              Transform Editor + Assistant
            </div>
            <div style={{ flex: 1, overflow: 'hidden' }}>
              <TransformEditorChat
                transform={transform}
                customCode={customCode}
                onCodeChange={setCustomCode}
              />
            </div>
          </div>
        )}
        <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          {/* Controls bar */}
          <div style={{ padding: '12px 20px', borderBottom: '1px solid #E2E8F0', display: 'flex', gap: '24px', alignItems: 'center', flexShrink: 0, backgroundColor: '#FFFFFF' }}>
            {/* Algorithm */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <label style={{ fontSize: '10px', fontWeight: 600, color: '#94A3B8', textTransform: 'uppercase' }}>Match Algorithm</label>
              <div style={{ display: 'flex', gap: '4px' }}>
                {(['exact', 'fuzzy', 'semantic'] as const).map((alg) => (
                  <button
                    key={alg}
                    onClick={() => setAlgorithm(alg)}
                    style={{
                      height: '26px', padding: '0 10px', fontSize: '11px', fontWeight: algorithm === alg ? 600 : 400,
                      borderRadius: '3px', border: `1px solid ${algorithm === alg ? '#7C3AED' : '#E2E8F0'}`,
                      backgroundColor: algorithm === alg ? '#7C3AED' : '#FFFFFF',
                      color: algorithm === alg ? '#FFFFFF' : '#64748B', cursor: 'pointer',
                    }}
                  >{alg}</button>
                ))}
              </div>
            </div>

            {/* Threshold slider */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', flex: 1, minWidth: '200px' }}>
              <label style={{ fontSize: '10px', fontWeight: 600, color: '#94A3B8', textTransform: 'uppercase', display: 'flex', justifyContent: 'space-between' }}>
                <span>Match Threshold</span>
                <span style={{ color: threshold >= 85 ? '#059669' : threshold >= 60 ? '#D97706' : '#DC2626', fontFamily: 'var(--font-mono)' }}>{threshold}%</span>
              </label>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span style={{ fontSize: '10px', color: '#94A3B8', whiteSpace: 'nowrap' }}>loose</span>
                <input
                  type="range" min={30} max={100} value={threshold}
                  onChange={(e) => setThreshold(Number(e.target.value))}
                  style={{ flex: 1, accentColor: '#7C3AED' }}
                />
                <span style={{ fontSize: '10px', color: '#94A3B8', whiteSpace: 'nowrap' }}>strict</span>
              </div>
            </div>

            {/* Stats */}
            <div style={{ flexShrink: 0, textAlign: 'right' }}>
              <div style={{ fontSize: '18px', fontWeight: 700, color: matchCount > 0 ? '#059669' : '#94A3B8' }}>{matchCount}/{sourceItems.length}</div>
              <div style={{ fontSize: '10px', color: '#64748B' }}>rows matched</div>
            </div>
          </div>

          {/* Main table */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '0 20px 20px' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 24px 1fr 80px', gap: '0', marginTop: '16px' }}>
              {/* Column headers */}
              <div style={{ fontSize: '10px', fontWeight: 700, color: '#94A3B8', textTransform: 'uppercase', padding: '0 0 8px' }}>
                Source: {sourceField} {transform !== 'none' ? `→ ${transform}` : ''}
              </div>
              <div />
              <div style={{ fontSize: '10px', fontWeight: 700, color: '#94A3B8', textTransform: 'uppercase', padding: '0 0 8px 8px', display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                <span>{targetObjectName}.{targetField || 'field'} (target)</span>
                <select
                  value={targetTransform}
                  onChange={(e) => setTargetTransform(e.target.value)}
                  title="Apply a transform to target values before matching"
                  style={{
                    height: '20px', fontSize: '10px', padding: '0 4px',
                    border: `1px solid ${targetTransform !== 'none' ? '#F59E0B' : '#E2E8F0'}`,
                    borderRadius: '3px',
                    backgroundColor: targetTransform !== 'none' ? '#FFFBEB' : '#F8FAFC',
                    color: targetTransform !== 'none' ? '#92400E' : '#94A3B8',
                    cursor: 'pointer', fontWeight: 500,
                  }}
                >
                  {TRANSFORM_OPTIONS.map((t) => (
                    <option key={t.value} value={t.value}>{t.label}</option>
                  ))}
                </select>
              </div>
              <div style={{ fontSize: '10px', fontWeight: 700, color: '#94A3B8', textTransform: 'uppercase', padding: '0 0 8px 8px' }}>Score</div>

              {/* Source rows */}
              {matches.map((row, i) => (
                <React.Fragment key={i}>
                  {/* Source cell */}
                  <div style={{
                    border: `1px solid ${row.matched ? '#A7F3D0' : '#FCA5A5'}`,
                    borderRadius: '4px', padding: '8px 10px', backgroundColor: row.matched ? '#F0FDF4' : '#FFF5F5',
                    marginBottom: '6px',
                  }}>
                    <div style={{ fontSize: '11px', color: '#94A3B8', fontFamily: 'var(--font-mono)', marginBottom: '2px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={row.raw}>
                      {row.raw}
                    </div>
                    {row.extracted && row.extracted !== row.raw && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                        <span style={{ fontSize: '9px', color: '#94A3B8' }}>extracted:</span>
                        <span style={{ fontSize: '13px', fontWeight: 600, color: '#0D1117', fontFamily: 'var(--font-mono)' }}>{row.extracted}</span>
                      </div>
                    )}
                    {(!row.extracted || row.extracted === row.raw) && (
                      <div style={{ fontSize: '13px', fontWeight: 600, color: '#0D1117', fontFamily: 'var(--font-mono)' }}>{row.raw}</div>
                    )}
                  </div>

                  {/* Arrow */}
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '6px', fontSize: '16px', color: row.matched ? '#059669' : '#94A3B8' }}>
                    {row.matched ? '→' : '↛'}
                  </div>

                  {/* Best target match */}
                  <div style={{
                    border: `1px solid ${row.matched ? '#A7F3D0' : '#E2E8F0'}`,
                    borderRadius: '4px', padding: '8px 10px',
                    backgroundColor: row.matched ? '#F0FDF4' : '#F8FAFC',
                    marginBottom: '6px', marginLeft: '8px',
                    display: 'flex', flexDirection: 'column', gap: '3px',
                  }}>
                    {row.matched ? (
                      <>
                        {targetTransform !== 'none' && row.best.target !== row.best.transformed && (
                          <div style={{ fontSize: '10px', color: '#94A3B8', fontFamily: 'var(--font-mono)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={row.best.target}>
                            {row.best.target}
                          </div>
                        )}
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          {targetTransform !== 'none' && <span style={{ fontSize: '9px', color: '#94A3B8' }}>transformed:</span>}
                          <span style={{ fontSize: '13px', fontWeight: 600, color: '#065F46', fontFamily: 'var(--font-mono)' }}>
                            {targetTransform !== 'none' ? row.best.transformed : row.best.target}
                          </span>
                          <span style={{ fontSize: '10px', backgroundColor: '#DCFCE7', color: '#065F46', padding: '1px 5px', borderRadius: '2px' }}>matched</span>
                        </div>
                      </>
                    ) : (
                      <span style={{ fontSize: '12px', color: '#94A3B8', fontStyle: 'italic' }}>
                        {row.best.score > 0
                          ? `closest: "${targetTransform !== 'none' ? row.best.transformed : row.best.target}" (${Math.round(row.best.score * 100)}%)`
                          : 'no match'}
                      </span>
                    )}
                  </div>

                  {/* Score */}
                  <div style={{ display: 'flex', alignItems: 'center', marginBottom: '6px', paddingLeft: '8px' }}>
                    <div style={{ width: '100%' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '2px' }}>
                        <span style={{ fontSize: '12px', fontWeight: 700, color: scoreColor(row.best.score), fontFamily: 'var(--font-mono)' }}>
                          {Math.round(row.best.score * 100)}%
                        </span>
                        <span style={{ fontSize: '9px', color: row.matched ? '#059669' : '#DC2626' }}>{row.matched ? 'ok' : 'no'}</span>
                      </div>
                      <div style={{ height: '4px', backgroundColor: '#F1F5F9', borderRadius: '2px', overflow: 'hidden' }}>
                        <div style={{ height: '100%', width: `${Math.round(row.best.score * 100)}%`, backgroundColor: scoreColor(row.best.score), borderRadius: '2px', transition: 'width 150ms' }} />
                      </div>
                    </div>
                  </div>
                </React.Fragment>
              ))}
            </div>

            {/* Target values editor */}
            <div style={{ marginTop: '20px', borderTop: '1px solid #E2E8F0', paddingTop: '14px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px', flexWrap: 'wrap' }}>
                <span style={{ fontSize: '11px', fontWeight: 600, color: '#64748B' }}>
                  {targetObjectName} — values from connector
                </span>
                {targetLoading && (
                  <span style={{ fontSize: '10px', color: '#60A5FA' }}>fetching…</span>
                )}
                {!targetLoading && resolvedTargetCol && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <span style={{ fontSize: '10px', color: '#94A3B8' }}>using column:</span>
                    <select
                      value={resolvedTargetCol}
                      onChange={(e) => setResolvedTargetCol(e.target.value)}
                      style={{ height: '20px', fontSize: '11px', fontFamily: 'var(--font-mono)', border: '1px solid #E2E8F0', borderRadius: '2px', color: '#059669', backgroundColor: '#ECFDF5', padding: '0 4px' }}
                    >
                      {availableCols.map((c) => <option key={c} value={c}>{c}</option>)}
                    </select>
                    {resolvedTargetCol !== targetField && (
                      <span style={{ fontSize: '10px', color: '#D97706', backgroundColor: '#FFFBEB', padding: '0 4px', borderRadius: '2px', border: '1px solid #FDE68A' }}>
                        ≠ {targetField}
                      </span>
                    )}
                  </div>
                )}
                {!targetLoading && !resolvedTargetCol && targetValues.length === 0 && (
                  <span style={{ fontSize: '10px', color: '#F87171' }}>
                    no source connector found on {targetObjectName} — add values manually
                  </span>
                )}
                <span style={{ fontWeight: 400, color: '#94A3B8', marginLeft: 'auto', fontSize: '10px' }}>
                  {targetValues.length} values loaded · edit to test
                </span>
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                {targetValues.map((tv, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '0', border: '1px solid #E2E8F0', borderRadius: '4px', overflow: 'hidden', backgroundColor: '#FFFFFF' }}>
                    <input
                      value={tv}
                      onChange={(e) => setTargetValues((prev) => prev.map((v, j) => j === i ? e.target.value : v))}
                      style={{ height: '26px', padding: '0 8px', border: 'none', fontSize: '12px', fontFamily: 'var(--font-mono)', color: '#0D1117', outline: 'none', minWidth: '80px', width: `${Math.max(80, tv.length * 8)}px` }}
                    />
                    <button
                      onClick={() => setTargetValues((prev) => prev.filter((_, j) => j !== i))}
                      style={{ height: '26px', width: '22px', border: 'none', borderLeft: '1px solid #F1F5F9', backgroundColor: '#F8FAFC', color: '#94A3B8', cursor: 'pointer', fontSize: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                    >x</button>
                  </div>
                ))}
                <div style={{ display: 'flex', border: '1px dashed #CBD5E1', borderRadius: '4px', overflow: 'hidden' }}>
                  <input
                    value={newTarget}
                    onChange={(e) => setNewTarget(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter' && newTarget.trim()) { setTargetValues((v) => [...v, newTarget.trim()]); setNewTarget(''); } }}
                    placeholder="+ add value"
                    style={{ height: '26px', padding: '0 8px', border: 'none', fontSize: '12px', color: '#64748B', outline: 'none', backgroundColor: 'transparent', width: '90px' }}
                  />
                </div>
              </div>
            </div>
          </div>
        </div>

        </div>{/* end inner flex-column */}
        {/* Footer */}
        <div style={{ padding: '12px 20px', borderTop: '1px solid #E2E8F0', display: 'flex', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#F8FAFC', flexShrink: 0 }}>
          <div style={{ fontSize: '12px', color: '#64748B' }}>
            <strong style={{ color: matchCount > 0 ? '#059669' : '#DC2626' }}>{matchCount}</strong> of {sourceItems.length} sample rows matched at{' '}
            <strong>{threshold}%</strong> threshold using <strong>{algorithm}</strong> algorithm
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button onClick={onClose} style={{ height: '32px', padding: '0 14px', fontSize: '12px', border: '1px solid #E2E8F0', borderRadius: '4px', backgroundColor: '#FFFFFF', color: '#64748B', cursor: 'pointer' }}>Cancel</button>
            <button
              onClick={() => onApply({ algorithm, threshold })}
              style={{ height: '32px', padding: '0 16px', fontSize: '12px', fontWeight: 600, backgroundColor: '#7C3AED', color: '#FFFFFF', border: 'none', borderRadius: '4px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px' }}
            >
              Apply to Pipeline
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

const SampleDataPreview: React.FC<{ rows: unknown[] }> = ({ rows }) => {
  const [collapsed, setCollapsed] = React.useState(false);
  const preview = rows.slice(0, 5);
  const cols = Object.keys((preview[0] as Record<string, unknown>) || {});
  if (cols.length === 0) return null;
  return (
    <div style={{ marginTop: '14px', border: '1px solid #E2E8F0', borderRadius: '4px', overflow: 'hidden' }}>
      <div
        onClick={() => setCollapsed((v) => !v)}
        style={{
          padding: '7px 12px', backgroundColor: '#F8FAFC', borderBottom: collapsed ? 'none' : '1px solid #E2E8F0',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer',
        }}
      >
        <span style={{ fontSize: '12px', fontWeight: 500, color: '#0D1117' }}>
          Sample Data <span style={{ fontWeight: 400, color: '#94A3B8', marginLeft: '4px' }}>{preview.length} rows</span>
        </span>
        <span style={{ fontSize: '11px', color: '#94A3B8' }}>{collapsed ? 'show' : 'hide'}</span>
      </div>
      {!collapsed && (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '11px' }}>
            <thead>
              <tr style={{ backgroundColor: '#F1F5F9' }}>
                {cols.map((c) => (
                  <th key={c} style={{ padding: '5px 10px', textAlign: 'left', fontWeight: 500, color: '#64748B', borderBottom: '1px solid #E2E8F0', whiteSpace: 'nowrap', fontFamily: 'var(--font-mono)' }}>
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {preview.map((row, i) => (
                <tr key={i} style={{ borderBottom: i < preview.length - 1 ? '1px solid #F1F5F9' : 'none' }}>
                  {cols.map((c) => {
                    const val = (row as Record<string, unknown>)[c];
                    const display = val === null || val === undefined ? '' : String(val);
                    return (
                      <td key={c} style={{ padding: '5px 10px', color: '#0D1117', maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontFamily: 'var(--font-mono)' }} title={display}>
                        {display}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

const piiColors: Record<string, string> = { HIGH: '#DC2626', MEDIUM: '#D97706', LOW: '#64748B', NONE: '#94A3B8' };

const FREQ_OPTIONS = [
  { value: 'on_demand', label: 'On demand (manual)' },
  { value: '15m',  label: 'Every 15 minutes' },
  { value: '1h',   label: 'Every hour' },
  { value: '6h',   label: 'Every 6 hours' },
  { value: '1d',   label: 'Every day' },
];

const TRANSFORM_OPTIONS = [
  { value: 'none',             label: 'No transform' },
  { value: 'trim',             label: 'Trim whitespace' },
  { value: 'lowercase',        label: 'Lowercase' },
  { value: 'uppercase',        label: 'Uppercase' },
  { value: 'extract_number',   label: 'Extract number' },
  { value: 'normalize_phone',  label: 'Normalize phone' },
  { value: 'format_date',      label: 'Parse → ISO date' },
  { value: 'extract_name',     label: 'Extract person name' },
  { value: 'extract_company',  label: 'Extract company name (NLP)' },
];

const TRANSFORM_CODE: Record<string, string> = {
  none: `# No transformation applied
def transform(value):
    return value`,

  trim: `# Strip leading/trailing whitespace
def transform(value):
    return str(value).strip() if value is not None else None`,

  lowercase: `# Convert string to lowercase
def transform(value):
    return str(value).lower() if value is not None else None`,

  uppercase: `# Convert string to uppercase
def transform(value):
    return str(value).upper() if value is not None else None`,

  extract_number: `# Extract first numeric value from a string
import re
def transform(value):
    match = re.search(r'[-+]?\\d*\\.?\\d+', str(value))
    return float(match.group()) if match else None`,

  normalize_phone: `# Normalize phone number to E.164 format (+1XXXXXXXXXX)
import re
def transform(value):
    digits = re.sub(r'\\D', '', str(value))
    if len(digits) == 10:
        return f'+1{digits}'
    elif len(digits) == 11 and digits[0] == '1':
        return f'+{digits}'
    return value  # return as-is if unrecognized`,

  format_date: `# Parse various date strings and output ISO 8601
from dateutil import parser as dateparser
def transform(value):
    try:
        return dateparser.parse(str(value)).isoformat()
    except Exception:
        return None`,

  extract_name: `# Extract full person name using spaCy NER
import spacy
nlp = spacy.load('en_core_web_sm')
def transform(value):
    doc = nlp(str(value))
    persons = [ent.text for ent in doc.ents if ent.label_ == 'PERSON']
    return persons[0] if persons else value`,

  extract_company: `# Extract company/organisation name using spaCy NER
import spacy
nlp = spacy.load('en_core_web_sm')
def transform(value):
    doc = nlp(str(value))
    orgs = [ent.text for ent in doc.ents if ent.label_ == 'ORG']
    return orgs[0] if orgs else value`,
};

const CreateNewObjectCard: React.FC<{
  inferredName: string;
  allFields: Array<{ name: string; semanticType: string; piiLevel: string }>;
  savedAction: string | undefined;
  saving: boolean;
  onCreateNew: (name?: string, selectedFieldNames?: string[], syncFrequency?: string, eventLogMapping?: { caseIdField: string; activityField: string; timestampField: string }) => void;
  fields: unknown[];
}> = ({ inferredName, allFields, savedAction, saving, onCreateNew }) => {
  const [expanded, setExpanded] = useState(false);
  const [nameInput, setNameInput] = useState(inferredName);
  const [selectedFields, setSelectedFields] = useState<Set<string>>(() => new Set(allFields.map((f) => f.name)));
  const [syncFrequency, setSyncFrequency] = useState('1h');

  // Auto-pick sensible defaults for event log mapping
  const datetimeFields = allFields.filter((f) => f.semanticType === 'DATETIME');
  const identifierFields = allFields.filter((f) => f.semanticType === 'IDENTIFIER');
  const statusFields = allFields.filter((f) => ['STATUS', 'CATEGORY', 'TEXT'].includes(f.semanticType));

  const [timestampField, setTimestampField] = useState(() => datetimeFields[0]?.name || '');
  const [caseIdField, setCaseIdField] = useState(() => identifierFields[0]?.name || '');
  const [activityField, setActivityField] = useState(() => statusFields[0]?.name || '');

  useEffect(() => { setNameInput(inferredName); }, [inferredName]);
  useEffect(() => { setSelectedFields(new Set(allFields.map((f) => f.name))); }, [allFields.length]);

  if (savedAction) {
    return (
      <div style={{ border: '1px solid #A7F3D0', borderRadius: '4px', padding: '10px 14px', backgroundColor: '#F0FDF4', display: 'flex', alignItems: 'center', gap: '8px' }}>
        <span style={{ fontSize: '12px', color: '#065F46', fontWeight: 500 }}>{savedAction}</span>
      </div>
    );
  }

  const toggleField = (name: string) => {
    setSelectedFields((prev) => {
      const next = new Set(prev);
      if (next.has(name)) { next.delete(name); } else { next.add(name); }
      return next;
    });
  };

  return (
    <div style={{ border: `1px solid ${expanded ? '#C7D2FE' : '#E2E8F0'}`, borderRadius: '4px', overflow: 'hidden', backgroundColor: '#FFFFFF' }}>
      {/* Header row */}
      <div style={{ padding: '10px 14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: '13px', fontWeight: 500, color: '#0D1117' }}>Create as new object type</div>
          <div style={{ fontSize: '11px', color: '#64748B', marginTop: '1px' }}>
            Name it, pick fields, then save to the ontology
          </div>
        </div>
        {!expanded && (
          <button
            onClick={() => setExpanded(true)}
            style={{
              display: 'flex', alignItems: 'center', gap: '6px',
              height: '30px', padding: '0 14px',
              backgroundColor: '#4F46E5', color: '#FFFFFF',
              border: 'none', borderRadius: '3px',
              fontSize: '12px', fontWeight: 500, cursor: 'pointer', whiteSpace: 'nowrap',
            }}
          >
            <GitBranch size={12} />
            Map to Ontology
          </button>
        )}
      </div>

      {/* Expanded form */}
      {expanded && (
        <div style={{ borderTop: '1px solid #E2E8F0', padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {/* Name input */}
          <div>
            <label style={{ fontSize: '11px', fontWeight: 500, color: '#64748B', display: 'block', marginBottom: '4px' }}>
              Object Type Name
            </label>
            <input
              value={nameInput}
              onChange={(e) => setNameInput(e.target.value)}
              placeholder="e.g. Client, MeetingTranscript"
              style={{
                width: '100%', height: '32px', padding: '0 8px',
                border: '1px solid #CBD5E1', borderRadius: '3px',
                fontSize: '13px', fontWeight: 500, color: '#0D1117',
                outline: 'none', boxSizing: 'border-box',
              }}
              onFocus={(e) => (e.currentTarget.style.borderColor = '#2563EB')}
              onBlur={(e) => (e.currentTarget.style.borderColor = '#CBD5E1')}
              autoFocus
            />
          </div>

          {/* Field selection */}
          {allFields.length > 0 && (
            <div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
                <label style={{ fontSize: '11px', fontWeight: 500, color: '#64748B' }}>
                  Fields ({selectedFields.size}/{allFields.length} selected)
                </label>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button onClick={() => setSelectedFields(new Set(allFields.map((f) => f.name)))} style={{ fontSize: '10px', color: '#2563EB', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>All</button>
                  <button onClick={() => setSelectedFields(new Set())} style={{ fontSize: '10px', color: '#94A3B8', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>None</button>
                </div>
              </div>
              <div style={{ maxHeight: '200px', overflowY: 'auto', border: '1px solid #E2E8F0', borderRadius: '3px' }}>
                {allFields.map((f, i) => (
                  <label
                    key={f.name}
                    style={{
                      display: 'flex', alignItems: 'center', gap: '8px',
                      padding: '5px 8px', cursor: 'pointer',
                      backgroundColor: i % 2 === 0 ? '#FAFAFA' : '#FFFFFF',
                      borderBottom: i < allFields.length - 1 ? '1px solid #F1F5F9' : 'none',
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={selectedFields.has(f.name)}
                      onChange={() => toggleField(f.name)}
                      style={{ margin: 0, flexShrink: 0 }}
                    />
                    <span style={{ fontSize: '12px', fontFamily: 'var(--font-mono)', color: '#0D1117', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {f.name}
                    </span>
                    <span style={{ fontSize: '10px', color: '#2563EB', backgroundColor: '#EFF6FF', padding: '1px 4px', borderRadius: '2px', flexShrink: 0 }}>
                      {f.semanticType}
                    </span>
                    <span style={{ fontSize: '10px', color: piiColors[f.piiLevel] || '#94A3B8', flexShrink: 0 }}>
                      {f.piiLevel}
                    </span>
                  </label>
                ))}
              </div>
            </div>
          )}

          {/* Sync frequency */}
          <div>
            <label style={{ fontSize: '11px', fontWeight: 500, color: '#64748B', display: 'block', marginBottom: '4px' }}>
              Sync Frequency
            </label>
            <select
              value={syncFrequency}
              onChange={(e) => setSyncFrequency(e.target.value)}
              style={{ width: '100%', height: '32px', padding: '0 8px', border: '1px solid #CBD5E1', borderRadius: '3px', fontSize: '13px', color: '#0D1117', backgroundColor: '#FFFFFF' }}
            >
              {FREQ_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>

          {/* Event Log Mapping */}
          <div style={{ borderTop: '1px solid #E2E8F0', paddingTop: '12px' }}>
            <div style={{ fontSize: '11px', fontWeight: 600, color: '#64748B', textTransform: 'uppercase', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <Activity size={11} />
              Event Log Mapping
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px' }}>
              {([
                { label: 'Timestamp field', value: timestampField, onChange: setTimestampField, preferred: datetimeFields },
                { label: 'Case ID field', value: caseIdField, onChange: setCaseIdField, preferred: identifierFields },
                { label: 'Activity field', value: activityField, onChange: setActivityField, preferred: statusFields },
              ] as const).map(({ label, value, onChange, preferred }) => (
                <div key={label}>
                  <label style={{ fontSize: '10px', fontWeight: 500, color: '#64748B', display: 'block', marginBottom: '3px' }}>
                    {label}
                  </label>
                  <select
                    value={value}
                    onChange={(e) => onChange(e.target.value)}
                    style={{ width: '100%', height: '28px', padding: '0 6px', border: '1px solid #CBD5E1', borderRadius: '3px', fontSize: '11px', color: '#0D1117', backgroundColor: '#FFFFFF' }}
                  >
                    <option value="">— none —</option>
                    {preferred.length > 0 && (
                      <>
                        {preferred.map((f) => (
                          <option key={f.name} value={f.name}>{f.name}</option>
                        ))}
                        <option disabled>──────────</option>
                      </>
                    )}
                    {allFields.filter((f) => !preferred.find((p) => p.name === f.name)).map((f) => (
                      <option key={f.name} value={f.name}>{f.name}</option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
            <div style={{ fontSize: '10px', color: '#94A3B8', marginTop: '6px' }}>
              These fields will be used when generating process events from this data.
            </div>
          </div>

          {/* Action buttons */}
          <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
            <button
              onClick={() => setExpanded(false)}
              style={{ height: '30px', padding: '0 12px', fontSize: '12px', border: '1px solid #E2E8F0', borderRadius: '3px', backgroundColor: '#FFFFFF', color: '#64748B', cursor: 'pointer' }}
            >
              Cancel
            </button>
            <button
              onClick={() => onCreateNew(
                nameInput.trim() || inferredName,
                Array.from(selectedFields),
                syncFrequency,
                { caseIdField, activityField, timestampField },
              )}
              disabled={saving || !nameInput.trim()}
              style={{
                display: 'flex', alignItems: 'center', gap: '6px',
                height: '30px', padding: '0 14px',
                backgroundColor: saving ? '#A5B4FC' : '#4F46E5',
                color: '#FFFFFF', border: 'none', borderRadius: '3px',
                fontSize: '12px', fontWeight: 500,
                cursor: saving || !nameInput.trim() ? 'not-allowed' : 'pointer',
                opacity: !nameInput.trim() ? 0.6 : 1,
              }}
            >
              <GitBranch size={12} />
              {saving ? 'Saving...' : `Create "${nameInput.trim() || inferredName}"`}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

const CorrelationPanel: React.FC<{
  result: CorrelationResult | null;
  correlating: boolean;
  savingAction: string | null;
  savedActions: Record<string, string>;
  onEnrich: (match: CorrelationMatch) => void;
  onCreateNew: (name?: string, selectedFieldNames?: string[], syncFrequency?: string, eventLogMapping?: { caseIdField: string; activityField: string; timestampField: string }) => void;
  onBuildPipeline: (match: CorrelationMatch) => void;
  onMapToExisting: (targetOtId: string, targetOtName: string, mode: 'enrich' | 'link' | 'nest', syncFrequency: string, mappings?: Record<string, { include: boolean; transform: string; targetName: string }>, nestConfig?: { nestFieldName: string; nestJoinSourceField: string; nestJoinTransform: string; nestJoinTargetField: string }) => void;
  inferredName: string;
  allFields: Array<{ name: string; semanticType: string; piiLevel: string }>;
  existingObjectTypes: Array<{ id: string; displayName: string; properties?: Array<{ name: string; displayName: string }> }>;
  sampleRows?: unknown[];
  fieldSourceMap?: Record<string, string>;
}> = ({ result, correlating, savingAction, savedActions, onEnrich, onCreateNew, onBuildPipeline, onMapToExisting, inferredName, allFields, existingObjectTypes, sampleRows, fieldSourceMap }) => {
  const [manualExpanded, setManualExpanded] = useState(false);
  const [manualTargetId, setManualTargetId] = useState('');
  const [manualMode, setManualMode] = useState<'enrich' | 'link' | 'nest'>('enrich');
  const [matchSandboxOpen, setMatchSandboxOpen] = useState(false);
  const [nestMatchAlgorithm, setNestMatchAlgorithm] = useState<'exact' | 'fuzzy' | 'semantic'>('fuzzy');
  const [nestMatchThreshold, setNestMatchThreshold] = useState(70);
  const [nestFieldName, setNestFieldName] = useState('meetings');
  const [nestJoinSourceField, setNestJoinSourceField] = useState('');
  const [nestJoinTransform, setNestJoinTransform] = useState('none');
  const [nestJoinTargetField, setNestJoinTargetField] = useState('');
  const [nestSandboxInput, setNestSandboxInput] = useState('');
  const [nestSandboxOpen, setNestSandboxOpen] = useState(false);
  const [manualFreq, setManualFreq] = useState('1h');
  // fieldMappings: sourceFieldName → { include, transform, targetName }
  const [fieldMappings, setFieldMappings] = useState<Record<string, { include: boolean; transform: string; targetName: string }>>({});
  // tracks which field row has its transform code expanded
  const [openCodeField, setOpenCodeField] = useState<string | null>(null);

  // Initialise field mappings when allFields or expanded changes
  useEffect(() => {
    if (!manualExpanded) return;
    const init: Record<string, { include: boolean; transform: string; targetName: string }> = {};
    allFields.forEach((f) => {
      init[f.name] = fieldMappings[f.name] || { include: true, transform: 'none', targetName: f.name };
    });
    setFieldMappings(init);
  }, [manualExpanded, allFields.length]);
  const actionConfig = {
    enrich: { label: 'Enrich', bg: '#ECFDF5', text: '#065F46', border: '#A7F3D0', desc: 'Merge new fields into this existing object type' },
    link:   { label: 'Link',   bg: '#EFF6FF', text: '#1D4ED8', border: '#BFDBFE', desc: 'Create a relationship via a join pipeline' },
    new_type: { label: 'New',  bg: '#F8FAFC', text: '#64748B', border: '#E2E8F0', desc: 'No strong match — create as new object type' },
  };

  if (correlating) {
    return (
      <div style={{ marginTop: '16px', padding: '14px 16px', border: '1px solid #E2E8F0', borderRadius: '4px', backgroundColor: '#F8FAFC' }}>
        <div style={{ fontSize: '12px', color: '#64748B', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ color: '#60A5FA' }}>...</span>
          Running correlation against existing object types
        </div>
      </div>
    );
  }

  if (!result) return null;

  const relevantMatches = result.matches.filter((m) => m.composite_score > 0.05 || result.matches.length === 0);

  return (
    <div style={{ marginTop: '16px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
      <div style={{ fontSize: '13px', fontWeight: 500, color: '#0D1117' }}>
        Ontology Correlation
        <span style={{ marginLeft: '8px', fontSize: '11px', fontWeight: 400, color: '#94A3B8' }}>
          {relevantMatches.length > 0
            ? `${relevantMatches.length} match${relevantMatches.length > 1 ? 'es' : ''} found`
            : 'No existing matches'}
        </span>
      </div>

      {relevantMatches.map((match) => {
        const conf = actionConfig[match.action];
        const isSaving = savingAction === match.object_type_id;
        const saved = savedActions[match.object_type_id];
        return (
          <div key={match.object_type_id} style={{
            border: `1px solid ${conf.border}`,
            borderRadius: '4px', backgroundColor: conf.bg, overflow: 'hidden',
          }}>
            <div style={{ padding: '10px 14px', display: 'flex', alignItems: 'flex-start', gap: '10px' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '3px' }}>
                  <span style={{ fontSize: '13px', fontWeight: 600, color: '#0D1117' }}>{match.object_type_name}</span>
                  <span style={{ fontSize: '11px', backgroundColor: conf.bg, color: conf.text, border: `1px solid ${conf.border}`, padding: '1px 6px', borderRadius: '2px', fontWeight: 600 }}>
                    {conf.label}
                  </span>
                  <span style={{ fontSize: '11px', fontFamily: 'var(--font-mono)', color: '#64748B' }}>
                    {Math.round(match.composite_score * 100)}% similarity
                  </span>
                </div>
                <div style={{ fontSize: '11px', color: '#64748B', marginBottom: match.pipeline_hint ? '6px' : 0 }}>
                  {conf.desc}
                  {match.suggested_join_key && (
                    <span style={{ marginLeft: '6px', fontFamily: 'var(--font-mono)', color: '#2563EB' }}>
                      via {match.suggested_join_key.incoming} → {match.suggested_join_key.existing}
                    </span>
                  )}
                </div>
                {match.pipeline_hint && (
                  <div style={{
                    fontSize: '11px', color: '#475569', backgroundColor: 'rgba(255,255,255,0.7)',
                    border: '1px solid #E2E8F0', borderRadius: '3px', padding: '6px 8px',
                    lineHeight: '1.5',
                  }}>
                    <span style={{ fontWeight: 600, color: '#0D1117' }}>Pipeline: </span>{match.pipeline_hint}
                  </div>
                )}
              </div>
              <div style={{ flexShrink: 0 }}>
                {saved ? (
                  <span style={{ fontSize: '12px', color: '#065F46', fontWeight: 500 }}>{saved}</span>
                ) : match.action === 'enrich' ? (
                  <button
                    onClick={() => onEnrich(match)}
                    disabled={!!savingAction}
                    style={{
                      height: '28px', padding: '0 12px', fontSize: '12px', fontWeight: 500,
                      backgroundColor: isSaving ? '#A7F3D0' : '#059669',
                      color: '#FFFFFF', border: 'none', borderRadius: '3px',
                      cursor: savingAction ? 'wait' : 'pointer',
                    }}
                  >
                    {isSaving ? 'Enriching...' : 'Enrich'}
                  </button>
                ) : match.action === 'link' ? (
                  <button
                    onClick={() => onBuildPipeline(match)}
                    style={{
                      height: '28px', padding: '0 12px', fontSize: '12px', fontWeight: 500,
                      backgroundColor: '#2563EB', color: '#FFFFFF',
                      border: 'none', borderRadius: '3px', cursor: 'pointer',
                    }}
                    title="Build a pipeline to link these object types"
                  >
                    Build Pipeline
                  </button>
                ) : null}
              </div>
            </div>
          </div>
        );
      })}

      {/* Create as new type — expandable with name + field selection */}
      <CreateNewObjectCard
        inferredName={inferredName}
        savedAction={savedActions['__new__']}
        saving={savingAction === '__new__'}
        onCreateNew={onCreateNew}
        fields={result?.new_object_name ? [] : []}
        allFields={allFields}
      />

      {/* Manual: add to existing object type */}
      {existingObjectTypes.length > 0 && (
        <div style={{ border: `1px solid ${manualExpanded ? '#FCD34D' : '#E2E8F0'}`, borderRadius: '4px', overflow: 'hidden', backgroundColor: '#FFFFFF' }}>
          <div style={{ padding: '10px 14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: '13px', fontWeight: 500, color: '#0D1117' }}>Add to existing object type</div>
              <div style={{ fontSize: '11px', color: '#64748B', marginTop: '1px' }}>
                Convert and merge data into an existing ontology object via a pipeline
              </div>
            </div>
            {!manualExpanded && (
              <button
                onClick={() => { setManualExpanded(true); if (!manualTargetId && existingObjectTypes[0]) setManualTargetId(existingObjectTypes[0].id); }}
                style={{ height: '28px', padding: '0 12px', fontSize: '12px', fontWeight: 500, backgroundColor: '#FFFFFF', color: '#0D1117', border: '1px solid #E2E8F0', borderRadius: '3px', cursor: 'pointer' }}
              >
                Choose...
              </button>
            )}
          </div>
          {manualExpanded && (
            <div style={{ borderTop: '1px solid #E2E8F0', padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {/* Target selector */}
              <div>
                <label style={{ fontSize: '11px', fontWeight: 500, color: '#64748B', display: 'block', marginBottom: '4px' }}>Target Object Type</label>
                <select
                  value={manualTargetId}
                  onChange={(e) => setManualTargetId(e.target.value)}
                  style={{ width: '100%', height: '32px', padding: '0 8px', border: '1px solid #CBD5E1', borderRadius: '3px', fontSize: '13px', color: '#0D1117', backgroundColor: '#FFFFFF' }}
                >
                  {existingObjectTypes.map((o) => (
                    <option key={o.id} value={o.id}>{o.displayName}</option>
                  ))}
                </select>
              </div>
              {/* Mode */}
              <div>
                <label style={{ fontSize: '11px', fontWeight: 500, color: '#64748B', display: 'block', marginBottom: '5px' }}>How to connect</label>
                <div style={{ display: 'flex', gap: '6px' }}>
                  {([
                    { value: 'enrich', label: 'Enrich (merge fields)', desc: 'Add flat fields to the object' },
                    { value: 'link',   label: 'Link (join pipeline)',  desc: 'Create a relationship edge' },
                    { value: 'nest',   label: 'Nest (array field)',    desc: 'Append records into a sub-array' },
                  ] as const).map((opt) => (
                    <label key={opt.value} style={{
                      display: 'flex', flexDirection: 'column', gap: '2px', cursor: 'pointer',
                      padding: '6px 10px', borderRadius: '3px', flex: 1,
                      border: `1px solid ${manualMode === opt.value ? (opt.value === 'nest' ? '#7C3AED' : '#2563EB') : '#E2E8F0'}`,
                      backgroundColor: manualMode === opt.value ? (opt.value === 'nest' ? '#F5F3FF' : '#EFF6FF') : '#FFFFFF',
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                        <input type="radio" checked={manualMode === opt.value} onChange={() => setManualMode(opt.value)} style={{ margin: 0 }} />
                        <span style={{ fontSize: '12px', fontWeight: 500, color: manualMode === opt.value ? (opt.value === 'nest' ? '#6D28D9' : '#1D4ED8') : '#374151' }}>
                          {opt.label}
                        </span>
                      </div>
                      <span style={{ fontSize: '10px', color: '#94A3B8', paddingLeft: '16px' }}>{opt.desc}</span>
                    </label>
                  ))}
                </div>
              </div>

              {/* Nest mode config */}
              {manualMode === 'nest' && (
                <div style={{ backgroundColor: '#F5F3FF', border: '1px solid #DDD6FE', borderRadius: '4px', padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <div style={{ fontSize: '11px', fontWeight: 600, color: '#6D28D9', marginBottom: '2px' }}>Nested Array Configuration</div>
                  {/* Array field name */}
                  <div>
                    <label style={{ fontSize: '11px', color: '#64748B', display: 'block', marginBottom: '3px' }}>
                      Array field name on <strong>{existingObjectTypes.find(o => o.id === manualTargetId)?.displayName || 'target'}</strong>
                    </label>
                    <input
                      value={nestFieldName}
                      onChange={(e) => setNestFieldName(e.target.value)}
                      placeholder="e.g. meetings"
                      style={{ width: '100%', height: '28px', padding: '0 8px', border: '1px solid #C4B5FD', borderRadius: '3px', fontSize: '12px', fontFamily: 'var(--font-mono)', color: '#0D1117', boxSizing: 'border-box', backgroundColor: '#FFFFFF' }}
                    />
                    <div style={{ fontSize: '10px', color: '#7C3AED', marginTop: '2px' }}>
                      Each incoming record will be appended as an item in <code style={{ backgroundColor: '#EDE9FE', padding: '0 3px', borderRadius: '2px' }}>{nestFieldName || '…'}[]</code>
                    </div>
                  </div>
                  {/* Join key */}
                  <div>
                    <label style={{ fontSize: '11px', color: '#64748B', display: 'block', marginBottom: '3px' }}>
                      Join key — how to match records to the target object
                    </label>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 140px 24px 1fr', gap: '6px', alignItems: 'center' }}>
                      <select
                        value={nestJoinSourceField}
                        onChange={(e) => setNestJoinSourceField(e.target.value)}
                        style={{ height: '28px', padding: '0 6px', border: '1px solid #C4B5FD', borderRadius: '3px', fontSize: '12px', color: '#0D1117', backgroundColor: '#FFFFFF' }}
                      >
                        <option value="">Source field…</option>
                        {allFields.map((f) => <option key={f.name} value={f.name}>{f.name}</option>)}
                      </select>
                      <select
                        value={nestJoinTransform}
                        onChange={(e) => setNestJoinTransform(e.target.value)}
                        style={{ height: '28px', padding: '0 6px', border: '1px solid #C4B5FD', borderRadius: '3px', fontSize: '11px', color: '#0D1117', backgroundColor: '#FFFFFF' }}
                      >
                        {TRANSFORM_OPTIONS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                      </select>
                      <span style={{ textAlign: 'center', fontSize: '12px', color: '#7C3AED', fontWeight: 600 }}>→</span>
                      <select
                        value={nestJoinTargetField}
                        onChange={(e) => setNestJoinTargetField(e.target.value)}
                        style={{ height: '28px', padding: '0 6px', border: '1px solid #C4B5FD', borderRadius: '3px', fontSize: '12px', fontFamily: 'var(--font-mono)', color: nestJoinTargetField ? '#0D1117' : '#94A3B8', backgroundColor: '#FFFFFF' }}
                      >
                        <option value="">Target field on {existingObjectTypes.find(o => o.id === manualTargetId)?.displayName || 'object'}…</option>
                        {(existingObjectTypes.find(o => o.id === manualTargetId)?.properties || []).map((p) => (
                          <option key={p.name} value={p.name}>{p.displayName || p.name}</option>
                        ))}
                      </select>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '4px' }}>
                      <div style={{ fontSize: '10px', color: '#94A3B8' }}>
                        Example: <code style={{ backgroundColor: '#EDE9FE', padding: '0 3px', borderRadius: '2px' }}>meeting_title</code> → extract_company → <code style={{ backgroundColor: '#EDE9FE', padding: '0 3px', borderRadius: '2px' }}>name</code>
                      </div>
                      <button
                        onClick={() => setNestSandboxOpen((v) => !v)}
                        style={{
                          display: 'flex', alignItems: 'center', gap: '4px',
                          height: '22px', padding: '0 8px',
                          backgroundColor: nestSandboxOpen ? '#0D1117' : '#EDE9FE',
                          color: nestSandboxOpen ? '#34D399' : '#7C3AED',
                          border: `1px solid ${nestSandboxOpen ? '#1E293B' : '#C4B5FD'}`,
                          borderRadius: '3px', fontSize: '10px', fontWeight: 600, cursor: 'pointer',
                        }}
                      >
                        {nestSandboxOpen ? 'close sandbox' : 'try transform'}
                      </button>
                    </div>
                  </div>

                  {/* Inline transform sandbox for join key */}
                  {nestSandboxOpen && (
                    <div style={{ border: '1px solid #C4B5FD', borderRadius: '4px', overflow: 'hidden' }}>
                      <div style={{ padding: '6px 10px', backgroundColor: '#EDE9FE', borderBottom: '1px solid #C4B5FD', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <span style={{ fontSize: '11px', fontWeight: 600, color: '#6D28D9' }}>
                          Transform Sandbox — {TRANSFORM_OPTIONS.find(t => t.value === nestJoinTransform)?.label}
                        </span>
                        <span style={{ fontSize: '10px', color: '#94A3B8' }}>Paste a real value from your data</span>
                      </div>
                      <TransformSandbox transform={nestJoinTransform} initialInput={nestJoinSourceField === 'meeting_title' ? 'Hilasal x maic - Demo / Q1' : ''} />
                    </div>
                  )}

                  {/* Match config summary + sandbox button */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', backgroundColor: '#EDE9FE', borderRadius: '3px', padding: '6px 8px' }}>
                    <div style={{ flex: 1, fontSize: '10px', color: '#6D28D9', lineHeight: 1.5 }}>
                      Pipeline: <strong>SOURCE</strong> → <strong>MAP</strong> → <strong>ENRICH</strong> ({nestMatchAlgorithm} match, {nestMatchThreshold}% threshold) → <strong>SINK</strong> (→ <code>{nestFieldName || '…'}[]</code>)
                    </div>
                    <button
                      onClick={() => setMatchSandboxOpen(true)}
                      style={{
                        display: 'flex', alignItems: 'center', gap: '5px', flexShrink: 0,
                        height: '26px', padding: '0 10px',
                        backgroundColor: '#7C3AED', color: '#FFFFFF',
                        border: 'none', borderRadius: '3px',
                        fontSize: '11px', fontWeight: 600, cursor: 'pointer',
                      }}
                    >
                      Open Match Sandbox
                    </button>
                  </div>
                </div>
              )}

              {matchSandboxOpen && (
                <MatchSandboxModal
                  sourceRows={sampleRows || []}
                  sourceField={nestJoinSourceField}
                  transform={nestJoinTransform}
                  targetObjectType={existingObjectTypes.find(o => o.id === manualTargetId)}
                  targetField={nestJoinTargetField}
                  algorithm={nestMatchAlgorithm}
                  threshold={nestMatchThreshold}
                  fieldSourceMap={fieldSourceMap}
                  onClose={() => setMatchSandboxOpen(false)}
                  onApply={(cfg) => {
                    setNestMatchAlgorithm(cfg.algorithm);
                    setNestMatchThreshold(cfg.threshold);
                    setMatchSandboxOpen(false);
                  }}
                />
              )}
              {/* Field mapping */}
              {allFields.length > 0 && (
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '5px' }}>
                    <label style={{ fontSize: '11px', fontWeight: 500, color: '#64748B' }}>
                      Field Mapping ({Object.values(fieldMappings).filter((f) => f.include).length}/{allFields.length} fields)
                    </label>
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <button onClick={() => setFieldMappings((prev) => { const n = {...prev}; Object.keys(n).forEach((k) => { n[k] = {...n[k], include: true}; }); return n; })} style={{ fontSize: '10px', color: '#2563EB', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>All</button>
                      <button onClick={() => setFieldMappings((prev) => { const n = {...prev}; Object.keys(n).forEach((k) => { n[k] = {...n[k], include: false}; }); return n; })} style={{ fontSize: '10px', color: '#94A3B8', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>None</button>
                    </div>
                  </div>
                  <div style={{ border: '1px solid #E2E8F0', borderRadius: '3px', maxHeight: '280px', overflowY: 'auto' }}>
                    {/* Header */}
                    <div style={{ display: 'grid', gridTemplateColumns: '28px 1fr 160px 24px 1fr', gap: '4px', padding: '4px 8px', backgroundColor: '#F8FAFC', borderBottom: '1px solid #E2E8F0' }}>
                      <span />
                      <span style={{ fontSize: '10px', fontWeight: 600, color: '#94A3B8', textTransform: 'uppercase' }}>Source Field</span>
                      <span style={{ fontSize: '10px', fontWeight: 600, color: '#94A3B8', textTransform: 'uppercase' }}>Transform</span>
                      <span />
                      <span style={{ fontSize: '10px', fontWeight: 600, color: '#94A3B8', textTransform: 'uppercase' }}>Target Field Name</span>
                    </div>
                    {allFields.map((f, i) => {
                      const m = fieldMappings[f.name] || { include: true, transform: 'none', targetName: f.name };
                      const setM = (patch: Partial<typeof m>) => setFieldMappings((prev) => ({ ...prev, [f.name]: { ...m, ...patch } }));
                      const codeOpen = openCodeField === f.name;
                      return (
                        <div key={f.name} style={{
                          borderBottom: i < allFields.length - 1 ? '1px solid #F1F5F9' : 'none',
                          opacity: m.include ? 1 : 0.45,
                          backgroundColor: i % 2 === 0 ? '#FFFFFF' : '#FAFAFA',
                        }}>
                          <div style={{ display: 'grid', gridTemplateColumns: '28px 1fr 160px 24px 1fr', gap: '4px', padding: '4px 8px', alignItems: 'center' }}>
                            <input type="checkbox" checked={m.include} onChange={(e) => setM({ include: e.target.checked })} style={{ margin: 0 }} />
                            <span style={{ fontSize: '12px', fontFamily: 'var(--font-mono)', color: '#0D1117', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={f.name}>
                              {f.name}
                              <span style={{ marginLeft: '4px', fontSize: '10px', color: '#2563EB' }}>{f.semanticType}</span>
                            </span>
                            <select
                              value={m.transform}
                              onChange={(e) => { setM({ transform: e.target.value }); setOpenCodeField(null); }}
                              disabled={!m.include}
                              style={{ height: '24px', fontSize: '11px', border: '1px solid #E2E8F0', borderRadius: '2px', color: '#0D1117', backgroundColor: '#FFFFFF', width: '100%' }}
                            >
                              {TRANSFORM_OPTIONS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                            </select>
                            <button
                              onClick={() => setOpenCodeField(codeOpen ? null : f.name)}
                              disabled={!m.include}
                              title="View transform source code"
                              style={{
                                height: '22px', width: '22px', border: `1px solid ${codeOpen ? '#6366F1' : '#E2E8F0'}`,
                                borderRadius: '2px', backgroundColor: codeOpen ? '#EEF2FF' : '#FFFFFF',
                                color: codeOpen ? '#4F46E5' : '#94A3B8',
                                fontSize: '10px', fontWeight: 700, fontFamily: 'var(--font-mono)',
                                cursor: m.include ? 'pointer' : 'not-allowed',
                                display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0,
                              }}
                            >
                              {'</>'}
                            </button>
                            <input
                              value={m.targetName}
                              onChange={(e) => setM({ targetName: e.target.value })}
                              disabled={!m.include}
                              style={{ height: '24px', padding: '0 6px', fontSize: '12px', fontFamily: 'var(--font-mono)', border: '1px solid #E2E8F0', borderRadius: '2px', color: '#0D1117', width: '100%', boxSizing: 'border-box' }}
                            />
                          </div>
                          {codeOpen && (
                            <div style={{ margin: '0 8px 6px', borderRadius: '3px', overflow: 'hidden', border: '1px solid #C7D2FE' }}>
                              <div style={{ padding: '4px 10px', backgroundColor: '#EEF2FF', borderBottom: '1px solid #C7D2FE', fontSize: '10px', fontWeight: 600, color: '#4F46E5', display: 'flex', justifyContent: 'space-between' }}>
                                <span>{TRANSFORM_OPTIONS.find((t) => t.value === m.transform)?.label || 'transform'}</span>
                                <span style={{ fontWeight: 400, color: '#6366F1' }}>Python</span>
                              </div>
                              <pre style={{
                                margin: 0, padding: '8px 10px',
                                backgroundColor: '#0D1117', color: '#A5F3FC',
                                fontSize: '11px', fontFamily: 'var(--font-mono)',
                                lineHeight: '1.6', overflowX: 'auto',
                                whiteSpace: 'pre',
                              }}>
                                {TRANSFORM_CODE[m.transform] || TRANSFORM_CODE['none']}
                              </pre>
                              <TransformSandbox transform={m.transform} />
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Frequency */}
              <div>
                <label style={{ fontSize: '11px', fontWeight: 500, color: '#64748B', display: 'block', marginBottom: '4px' }}>Sync Frequency</label>
                <select
                  value={manualFreq}
                  onChange={(e) => setManualFreq(e.target.value)}
                  style={{ width: '100%', height: '32px', padding: '0 8px', border: '1px solid #CBD5E1', borderRadius: '3px', fontSize: '13px', color: '#0D1117', backgroundColor: '#FFFFFF' }}
                >
                  {FREQ_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
              <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
                <button onClick={() => setManualExpanded(false)} style={{ height: '30px', padding: '0 12px', fontSize: '12px', border: '1px solid #E2E8F0', borderRadius: '3px', backgroundColor: '#FFFFFF', color: '#64748B', cursor: 'pointer' }}>Cancel</button>
                <button
                  onClick={() => {
                    const target = existingObjectTypes.find((o) => o.id === manualTargetId);
                    if (target) onMapToExisting(target.id, target.displayName, manualMode, manualFreq, fieldMappings, {
                      nestFieldName, nestJoinSourceField, nestJoinTransform, nestJoinTargetField,
                    });
                  }}
                  disabled={!manualTargetId}
                  style={{ height: '30px', padding: '0 14px', fontSize: '12px', fontWeight: 500, backgroundColor: manualMode === 'nest' ? '#7C3AED' : '#2563EB', color: '#FFFFFF', border: 'none', borderRadius: '3px', cursor: manualTargetId ? 'pointer' : 'not-allowed', display: 'flex', alignItems: 'center', gap: '6px' }}
                >
                  <GitBranch size={12} />
                  Build Pipeline
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

const FieldGroup: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div>
    <label style={{ display: 'block', fontSize: '12px', fontWeight: 500, color: '#64748B', marginBottom: '4px' }}>
      {label}
    </label>
    {children}
  </div>
);

const inputStyle: React.CSSProperties = {
  width: '100%',
  height: '32px',
  border: '1px solid #E2E8F0',
  borderRadius: '4px',
  padding: '0 10px',
  fontSize: '13px',
  color: '#0D1117',
  backgroundColor: '#FFFFFF',
  outline: 'none',
  fontFamily: 'var(--font-interface)',
};

export default ConnectorDetailPanel;
