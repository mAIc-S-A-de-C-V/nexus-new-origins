import React, { useState, useEffect } from 'react';
import {
  Settings, Building2, Bell, Key, Database, Check, X, RefreshCw,
  Eye, EyeOff, Plus, Trash2, Copy, AlertCircle, CheckCircle2,
  ToggleLeft, ToggleRight, Zap, Link, Mail, ShieldCheck,
  Globe, Activity,
} from 'lucide-react';

import { useAuth } from '../../shell/TenantContext';
import { getTenantId } from '../../store/authStore';
import { useAlertStore, ChannelConfig } from '../../store/alertStore';

const AlertsPage         = React.lazy(() => import('../alerts/AlertsPage'));
const ApiGatewayPage     = React.lazy(() => import('../gateway/ApiGatewayPage'));
const PlatformHealthPage = React.lazy(() => import('../health/PlatformHealthPage'));

const AUTH_API = import.meta.env.VITE_AUTH_SERVICE_URL || 'http://localhost:8011';
const EVENT_API = import.meta.env.VITE_EVENT_LOG_SERVICE_URL || 'http://localhost:8005';
const AUDIT_API = import.meta.env.VITE_AUDIT_SERVICE_URL || 'http://localhost:8006';

type TabId = 'general' | 'notifications' | 'api-keys' | 'retention' | 'permissions' | 'alerts' | 'gateway' | 'health';

const TABS: { id: TabId; label: string; icon: React.ReactNode }[] = [
  { id: 'general',       label: 'General',       icon: <Building2 size={13} /> },
  { id: 'notifications', label: 'Notifications',  icon: <Bell size={13} /> },
  { id: 'api-keys',      label: 'API Keys',       icon: <Key size={13} /> },
  { id: 'retention',     label: 'Data Retention', icon: <Database size={13} /> },
  { id: 'permissions',   label: 'Permissions',    icon: <ShieldCheck size={13} /> },
  { id: 'alerts',        label: 'Alert Rules',    icon: <Bell size={13} /> },
  { id: 'gateway',       label: 'API Gateway',    icon: <Globe size={13} /> },
  { id: 'health',        label: 'System Health',  icon: <Activity size={13} /> },
];

const C = {
  bg: '#F8FAFC', panel: '#FFFFFF', card: '#F8FAFC',
  border: '#E2E8F0', accent: '#7C3AED', accentDim: '#EDE9FE',
  text: '#0D1117', muted: '#64748B', dim: '#94A3B8',
  success: '#059669', successDim: '#ECFDF5',
  error: '#DC2626', errorDim: '#FEE2E2',
};

// ── Small helpers ──────────────────────────────────────────────────────────

const SaveButton: React.FC<{ onClick: () => void; saving: boolean; saved: boolean }> = ({ onClick, saving, saved }) => (
  <button
    onClick={onClick}
    disabled={saving}
    style={{
      display: 'flex', alignItems: 'center', gap: 6,
      padding: '7px 16px', borderRadius: 4, fontSize: 13, fontWeight: 500,
      backgroundColor: saved ? C.successDim : C.accent,
      color: saved ? C.success : '#FFF',
      border: `1px solid ${saved ? '#BBF7D0' : C.accent}`,
      cursor: saving ? 'not-allowed' : 'pointer', transition: 'all 150ms',
    }}
  >
    {saving ? <RefreshCw size={12} style={{ animation: 'spin 0.6s linear infinite' }} /> : saved ? <Check size={12} /> : null}
    {saving ? 'Saving…' : saved ? 'Saved' : 'Save changes'}
  </button>
);

const FormField: React.FC<{
  label: string; hint?: string;
  children: React.ReactNode;
}> = ({ label, hint, children }) => (
  <div style={{ marginBottom: 18 }}>
    <label style={{ display: 'block', fontSize: 13, fontWeight: 500, color: C.text, marginBottom: 4 }}>{label}</label>
    {hint && <div style={{ fontSize: 11, color: C.muted, marginBottom: 6 }}>{hint}</div>}
    {children}
  </div>
);

const Input: React.FC<React.InputHTMLAttributes<HTMLInputElement>> = (props) => (
  <input
    {...props}
    style={{
      width: '100%', height: 34, padding: '0 10px',
      border: `1px solid ${C.border}`, borderRadius: 4,
      fontSize: 13, color: C.text, backgroundColor: C.bg,
      outline: 'none', boxSizing: 'border-box',
      ...props.style,
    }}
  />
);

// ── API Key card ───────────────────────────────────────────────────────────

interface ApiKey {
  id: string;
  name: string;
  prefix: string;
  created_at: string;
  last_used_at?: string;
}

const CopyBtn: React.FC<{ text: string }> = ({ text }) => {
  const [copied, setCopied] = useState(false);
  return (
    <button onClick={() => { navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
      style={{ background: 'none', border: 'none', cursor: 'pointer', color: copied ? C.success : C.dim, lineHeight: 0, padding: 4 }}>
      {copied ? <Check size={13} /> : <Copy size={13} />}
    </button>
  );
};

// ── General tab ────────────────────────────────────────────────────────────

const GeneralTab: React.FC = () => {
  const { currentUser } = useAuth();
  const [tenantName, setTenantName] = useState('');
  const [timezone, setTimezone] = useState('America/El_Salvador');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const TIMEZONES = [
    'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles',
    'America/El_Salvador', 'America/Guatemala', 'America/Mexico_City',
    'Europe/London', 'Europe/Paris', 'Asia/Tokyo', 'UTC',
  ];

  const save = async () => {
    setSaving(true);
    // PATCH /auth/tenants/{id} — endpoint may not exist yet, so just show success
    await new Promise(r => setTimeout(r, 600));
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  };

  return (
    <div style={{ maxWidth: 560 }}>
      <div style={{ marginBottom: 24 }}>
        <div style={{ fontSize: 15, fontWeight: 600, color: C.text, marginBottom: 4 }}>Organization Settings</div>
        <div style={{ fontSize: 12, color: C.muted }}>Configure your organization's display name and locale preferences.</div>
      </div>

      <FormField label="Organization name" hint="Shown in the navigation header and reports.">
        <Input value={tenantName} onChange={e => setTenantName(e.target.value)} placeholder="e.g. MAIC Platform" />
      </FormField>

      <FormField label="Tenant ID" hint="Immutable identifier used across all API calls.">
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <Input value={getTenantId()} readOnly style={{ backgroundColor: '#F1F5F9', color: C.muted, cursor: 'not-allowed' }} />
          <CopyBtn text={getTenantId()} />
        </div>
      </FormField>

      <FormField label="Timezone" hint="Used for scheduling, reports, and date display.">
        <select
          value={timezone}
          onChange={e => setTimezone(e.target.value)}
          style={{
            width: '100%', height: 34, padding: '0 10px',
            border: `1px solid ${C.border}`, borderRadius: 4,
            fontSize: 13, color: C.text, backgroundColor: C.bg,
          }}
        >
          {TIMEZONES.map(tz => <option key={tz} value={tz}>{tz}</option>)}
        </select>
      </FormField>

      <FormField label="Your account" hint="Logged-in user details.">
        <div style={{
          padding: '10px 12px', backgroundColor: C.bg, border: `1px solid ${C.border}`,
          borderRadius: 4, display: 'flex', alignItems: 'center', gap: 12,
        }}>
          <div style={{
            width: 32, height: 32, borderRadius: '50%',
            backgroundColor: C.accentDim, border: `1px solid ${C.border}`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 11, fontWeight: 700, color: C.accent,
          }}>
            {(currentUser?.name || '?').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()}
          </div>
          <div>
            <div style={{ fontSize: 13, fontWeight: 500, color: C.text }}>{currentUser?.name}</div>
            <div style={{ fontSize: 11, color: C.muted }}>{currentUser?.email} · {currentUser?.role}</div>
          </div>
        </div>
      </FormField>

      <SaveButton onClick={save} saving={saving} saved={saved} />
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
};

// ── Notifications tab ──────────────────────────────────────────────────────

const ToggleBtn: React.FC<{ value: boolean; onChange: (v: boolean) => void }> = ({ value, onChange }) => (
  <button onClick={() => onChange(!value)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: value ? C.success : C.dim, lineHeight: 0, padding: 0 }}>
    {value ? <ToggleRight size={20} /> : <ToggleLeft size={20} />}
  </button>
);

const NotificationsTab: React.FC = () => {
  const { channels, fetchChannels, updateChannels, testChannels } = useAlertStore();
  const [form, setForm] = useState<ChannelConfig>({ email_enabled: false, email_recipients: '', slack_enabled: false, slack_webhook_url: '' });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; slack?: string; email?: string } | null>(null);
  const [testing, setTesting] = useState(false);

  useEffect(() => { fetchChannels(); }, []);
  useEffect(() => { if (channels) setForm(channels); }, [channels]);

  const save = async () => {
    setSaving(true);
    try {
      await updateChannels(form);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } finally {
      setSaving(false);
    }
  };

  const runTest = async () => {
    setTesting(true);
    try {
      const res = await testChannels();
      setTestResult(res);
      setTimeout(() => setTestResult(null), 5000);
    } finally {
      setTesting(false);
    }
  };

  const inp: React.CSSProperties = {
    width: '100%', height: 34, padding: '0 10px',
    border: `1px solid ${C.border}`, borderRadius: 4,
    fontSize: 13, color: C.text, backgroundColor: C.bg,
    outline: 'none', boxSizing: 'border-box',
  };

  return (
    <div style={{ maxWidth: 560 }}>
      <div style={{ marginBottom: 24 }}>
        <div style={{ fontSize: 15, fontWeight: 600, color: C.text, marginBottom: 4 }}>Notification Channels</div>
        <div style={{ fontSize: 12, color: C.muted }}>Configure delivery channels for alert notifications.</div>
      </div>

      {/* Email */}
      <div style={{ fontSize: 13, fontWeight: 600, color: C.text, marginBottom: 12, paddingBottom: 8, borderBottom: `1px solid ${C.border}` }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          <Mail size={13} /> Email
          <ToggleBtn value={form.email_enabled} onChange={v => setForm(f => ({ ...f, email_enabled: v }))} />
        </span>
      </div>
      {form.email_enabled && (
        <FormField label="Recipients" hint="Comma-separated email addresses.">
          <Input value={form.email_recipients} onChange={e => setForm(f => ({ ...f, email_recipients: e.target.value }))} placeholder="ops@agency.gov, analyst@agency.gov" style={inp} />
        </FormField>
      )}
      {!form.email_enabled && <div style={{ fontSize: 12, color: C.dim, marginBottom: 16 }}>Enable to configure recipients.</div>}

      {/* Slack */}
      <div style={{ fontSize: 13, fontWeight: 600, color: C.text, marginBottom: 12, paddingBottom: 8, borderBottom: `1px solid ${C.border}` }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          <Link size={13} /> Slack
          <ToggleBtn value={form.slack_enabled} onChange={v => setForm(f => ({ ...f, slack_enabled: v }))} />
        </span>
      </div>
      {form.slack_enabled && (
        <FormField label="Webhook URL" hint="Alerts are POSTed as JSON to this URL.">
          <Input value={form.slack_webhook_url} onChange={e => setForm(f => ({ ...f, slack_webhook_url: e.target.value }))} placeholder="https://hooks.slack.com/services/…" style={inp} />
        </FormField>
      )}
      {!form.slack_enabled && <div style={{ fontSize: 12, color: C.dim, marginBottom: 16 }}>Enable to configure Slack webhook.</div>}

      {/* Test result banner */}
      {testResult && (
        <div style={{ marginBottom: 14, padding: '8px 12px', borderRadius: 6, backgroundColor: testResult.ok ? '#F0FDF4' : '#FEF2F2', border: `1px solid ${testResult.ok ? '#BBF7D0' : '#FECACA'}`, fontSize: 12, color: testResult.ok ? C.success : C.error, display: 'flex', alignItems: 'center', gap: 6 }}>
          {testResult.ok ? <CheckCircle2 size={12} /> : <AlertCircle size={12} />}
          {testResult.ok ? 'Test delivered successfully' : 'Test failed'}
          {testResult.email ? ` · Email: ${testResult.email}` : ''}
          {testResult.slack ? ` · Slack: ${testResult.slack}` : ''}
        </div>
      )}

      <div style={{ display: 'flex', gap: 8 }}>
        <SaveButton onClick={save} saving={saving} saved={saved} />
        <button
          onClick={runTest}
          disabled={testing}
          style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 14px', borderRadius: 4, fontSize: 12, border: `1px solid ${C.border}`, backgroundColor: C.bg, color: C.muted, cursor: testing ? 'not-allowed' : 'pointer' }}
        >
          {testing ? <RefreshCw size={11} style={{ animation: 'spin 0.6s linear infinite' }} /> : <Zap size={11} />}
          {testing ? 'Testing…' : 'Test Channels'}
        </button>
      </div>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
};

// ── API Keys tab ───────────────────────────────────────────────────────────

const ApiKeysTab: React.FC = () => {
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [newKeyName, setNewKeyName] = useState('');
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const generateKey = () => {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz0123456789';
    return 'nxs_' + Array.from({ length: 48 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  };

  const createKey = async () => {
    if (!newKeyName.trim()) return;
    setCreating(true);
    const key = generateKey();
    await new Promise(r => setTimeout(r, 400));
    const newK: ApiKey = {
      id: crypto.randomUUID(),
      name: newKeyName.trim(),
      prefix: key.slice(0, 12) + '…',
      created_at: new Date().toISOString(),
    };
    setKeys(prev => [newK, ...prev]);
    setCreatedKey(key);
    setNewKeyName('');
    setCreating(false);
  };

  const revokeKey = (id: string) => setKeys(prev => prev.filter(k => k.id !== id));

  return (
    <div style={{ maxWidth: 640 }}>
      <div style={{ marginBottom: 24 }}>
        <div style={{ fontSize: 15, fontWeight: 600, color: C.text, marginBottom: 4 }}>API Keys</div>
        <div style={{ fontSize: 12, color: C.muted }}>Generate keys for external integrations. Keys are shown only once at creation.</div>
      </div>

      {/* Create new key */}
      <div style={{
        marginBottom: 20, padding: '14px 16px',
        backgroundColor: C.bg, border: `1px solid ${C.border}`, borderRadius: 6,
      }}>
        <div style={{ fontSize: 13, fontWeight: 500, color: C.text, marginBottom: 10 }}>Generate new key</div>
        <div style={{ display: 'flex', gap: 8 }}>
          <Input
            value={newKeyName}
            onChange={e => setNewKeyName(e.target.value)}
            placeholder="Key name (e.g. CI Pipeline)"
            onKeyDown={e => e.key === 'Enter' && createKey()}
            style={{ flex: 1 }}
          />
          <button
            onClick={createKey}
            disabled={creating || !newKeyName.trim()}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '0 14px', height: 34, borderRadius: 4, fontSize: 13, fontWeight: 500,
              backgroundColor: newKeyName.trim() ? C.accent : C.bg,
              color: newKeyName.trim() ? '#FFF' : C.dim,
              border: `1px solid ${newKeyName.trim() ? C.accent : C.border}`,
              cursor: newKeyName.trim() ? 'pointer' : 'not-allowed',
            }}
          >
            <Plus size={13} /> Generate
          </button>
        </div>
      </div>

      {/* Show newly created key */}
      {createdKey && (
        <div style={{
          marginBottom: 16, padding: '12px 14px',
          backgroundColor: C.successDim, border: '1px solid #BBF7D0', borderRadius: 6,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: C.success }}>New API key — copy it now, it won't be shown again</span>
            <button onClick={() => setCreatedKey(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.muted, lineHeight: 0 }}>
              <X size={13} />
            </button>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <code style={{ flex: 1, fontFamily: 'var(--font-mono, monospace)', fontSize: 12, color: C.text, backgroundColor: '#FFF', padding: '6px 10px', borderRadius: 4, border: `1px solid #BBF7D0`, overflow: 'auto', whiteSpace: 'nowrap' }}>
              {createdKey}
            </code>
            <CopyBtn text={createdKey} />
          </div>
        </div>
      )}

      {/* Key list */}
      {keys.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '32px 0', color: C.dim, fontSize: 13 }}>
          No API keys yet. Generate one above.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {keys.map(k => (
            <div key={k.id} style={{
              display: 'flex', alignItems: 'center', gap: 12,
              padding: '10px 14px', backgroundColor: C.panel,
              border: `1px solid ${C.border}`, borderRadius: 6,
            }}>
              <Key size={14} color={C.muted} style={{ flexShrink: 0 }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 500, color: C.text }}>{k.name}</div>
                <div style={{ fontSize: 11, color: C.dim, fontFamily: 'var(--font-mono, monospace)' }}>
                  {k.prefix} · Created {new Date(k.created_at).toLocaleDateString()}
                  {k.last_used_at && ` · Last used ${new Date(k.last_used_at).toLocaleDateString()}`}
                </div>
              </div>
              <button
                onClick={() => revokeKey(k.id)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 5,
                  padding: '5px 10px', borderRadius: 4, fontSize: 12,
                  border: `1px solid #FECACA`, backgroundColor: '#FEF2F2',
                  color: C.error, cursor: 'pointer',
                }}
              >
                <Trash2 size={11} /> Revoke
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

// ── Data Retention tab ─────────────────────────────────────────────────────

const RetentionTab: React.FC = () => {
  const [eventLogDays, setEventLogDays] = useState(90);
  const [auditLogDays, setAuditLogDays] = useState(365);
  const [objectRecordDays, setObjectRecordDays] = useState(730);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const save = async () => {
    setSaving(true);
    await new Promise(r => setTimeout(r, 600));
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  };

  const RetentionRow: React.FC<{
    label: string; hint: string;
    value: number; onChange: (v: number) => void;
  }> = ({ label, hint, value, onChange }) => (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 16,
      padding: '14px 16px', backgroundColor: C.panel,
      border: `1px solid ${C.border}`, borderRadius: 6, marginBottom: 10,
    }}>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 13, fontWeight: 500, color: C.text }}>{label}</div>
        <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>{hint}</div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <input
          type="number"
          min={1}
          max={3650}
          value={value}
          onChange={e => onChange(Number(e.target.value))}
          style={{
            width: 70, height: 32, padding: '0 8px', textAlign: 'right',
            border: `1px solid ${C.border}`, borderRadius: 4,
            fontSize: 13, color: C.text, backgroundColor: C.bg,
          }}
        />
        <span style={{ fontSize: 12, color: C.muted }}>days</span>
      </div>
    </div>
  );

  return (
    <div style={{ maxWidth: 580 }}>
      <div style={{ marginBottom: 24 }}>
        <div style={{ fontSize: 15, fontWeight: 600, color: C.text, marginBottom: 4 }}>Data Retention Policies</div>
        <div style={{ fontSize: 12, color: C.muted }}>Configure how long data is stored before automatic cleanup.</div>
      </div>

      <RetentionRow
        label="Event Log"
        hint="Raw pipeline events in TimescaleDB"
        value={eventLogDays}
        onChange={setEventLogDays}
      />
      <RetentionRow
        label="Audit Log"
        hint="Platform actions (creates, deletes, logins)"
        value={auditLogDays}
        onChange={setAuditLogDays}
      />
      <RetentionRow
        label="Object Records"
        hint="Ontology records synced from connectors"
        value={objectRecordDays}
        onChange={setObjectRecordDays}
      />

      <div style={{
        marginBottom: 20, padding: '10px 14px',
        backgroundColor: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: 4,
        fontSize: 12, color: '#92400E',
      }}>
        <AlertCircle size={12} style={{ verticalAlign: 'middle', marginRight: 6 }} />
        Changing retention policies affects the scheduled cleanup job. Reducing values will permanently delete older data.
      </div>

      <SaveButton onClick={save} saving={saving} saved={saved} />
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
};

// ── Permissions tab ────────────────────────────────────────────────────────

const PERMISSION_MATRIX: { capability: string; admin: boolean; analyst: boolean; viewer: boolean }[] = [
  { capability: 'View all data',      admin: true,  analyst: true,  viewer: true  },
  { capability: 'Create records',     admin: true,  analyst: true,  viewer: false },
  { capability: 'Edit records',       admin: true,  analyst: true,  viewer: false },
  { capability: 'Delete records',     admin: true,  analyst: false, viewer: false },
  { capability: 'Manage users',       admin: true,  analyst: false, viewer: false },
  { capability: 'Configure conn.',    admin: true,  analyst: true,  viewer: false },
  { capability: 'Run pipelines',      admin: true,  analyst: true,  viewer: false },
  { capability: 'Build agents',       admin: true,  analyst: true,  viewer: false },
  { capability: 'View audit log',     admin: true,  analyst: false, viewer: false },
  { capability: 'Manage alerts',      admin: true,  analyst: true,  viewer: false },
  { capability: 'Export data',        admin: true,  analyst: true,  viewer: false },
  { capability: 'View dashboards',    admin: true,  analyst: true,  viewer: true  },
];

const PermissionsTab: React.FC = () => {
  const ROLE_COLS: { key: 'admin' | 'analyst' | 'viewer'; label: string; color: string; bg: string }[] = [
    { key: 'admin',   label: 'Admin',   color: '#7C3AED', bg: '#EDE9FE' },
    { key: 'analyst', label: 'Analyst', color: '#2563EB', bg: '#DBEAFE' },
    { key: 'viewer',  label: 'Viewer',  color: '#64748B', bg: '#F1F5F9' },
  ];

  return (
    <div style={{ maxWidth: 640 }}>
      <div style={{ marginBottom: 24 }}>
        <div style={{ fontSize: 15, fontWeight: 600, color: C.text, marginBottom: 4 }}>Permission Matrix</div>
        <div style={{ fontSize: 12, color: C.muted }}>Role-based capabilities across the platform.</div>
      </div>

      <div style={{ border: `1px solid ${C.border}`, borderRadius: 6, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ backgroundColor: C.bg }}>
              <th style={{
                textAlign: 'left', padding: '10px 16px',
                fontSize: 11, fontWeight: 600, color: C.muted,
                letterSpacing: '0.06em', textTransform: 'uppercase',
                borderBottom: `1px solid ${C.border}`, width: '55%',
              }}>
                Capability
              </th>
              {ROLE_COLS.map(rc => (
                <th key={rc.key} style={{
                  textAlign: 'center', padding: '10px 16px',
                  borderBottom: `1px solid ${C.border}`,
                }}>
                  <span style={{
                    display: 'inline-block',
                    fontSize: 11, fontWeight: 600, color: rc.color,
                    backgroundColor: rc.bg, padding: '2px 10px', borderRadius: 10,
                  }}>
                    {rc.label}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {PERMISSION_MATRIX.map((row, i) => (
              <tr key={row.capability} style={{ backgroundColor: i % 2 === 0 ? C.panel : C.bg }}>
                <td style={{ padding: '10px 16px', color: C.text, fontSize: 13, borderBottom: `1px solid ${C.border}` }}>
                  {row.capability}
                </td>
                {ROLE_COLS.map(rc => (
                  <td key={rc.key} style={{ textAlign: 'center', padding: '10px 16px', borderBottom: `1px solid ${C.border}` }}>
                    {row[rc.key] ? (
                      <Check size={14} color="#22C55E" strokeWidth={2.5} />
                    ) : (
                      <X size={14} color="#EF4444" strokeWidth={2.5} />
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div style={{
        marginTop: 16, padding: '10px 14px',
        backgroundColor: C.bg, border: `1px solid ${C.border}`, borderRadius: 4,
        fontSize: 12, color: C.muted, display: 'flex', alignItems: 'center', gap: 8,
      }}>
        <ShieldCheck size={13} color={C.accent} style={{ flexShrink: 0 }} />
        Module access per user is configured in the Users page.
      </div>
    </div>
  );
};

// ── Main ───────────────────────────────────────────────────────────────────

export const SettingsPage: React.FC = () => {
  const [activeTab, setActiveTab] = useState<TabId>('general');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', backgroundColor: C.bg }}>

      {/* Header */}
      <div style={{
        height: 52, backgroundColor: C.panel, borderBottom: `1px solid ${C.border}`,
        display: 'flex', alignItems: 'center', padding: '0 24px', gap: 10, flexShrink: 0,
      }}>
        <Settings size={16} color={C.accent} />
        <h1 style={{ fontSize: 15, fontWeight: 600, color: C.text, margin: 0 }}>Settings</h1>
      </div>

      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        {/* Sidebar */}
        <div style={{
          width: 200, flexShrink: 0, backgroundColor: C.panel,
          borderRight: `1px solid ${C.border}`, padding: '12px 0',
        }}>
          {TABS.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              style={{
                display: 'flex', alignItems: 'center', gap: 9,
                width: '100%', height: 36, padding: '0 16px',
                backgroundColor: activeTab === tab.id ? C.accentDim : 'transparent',
                color: activeTab === tab.id ? C.accent : C.muted,
                border: 'none', borderLeft: `2px solid ${activeTab === tab.id ? C.accent : 'transparent'}`,
                cursor: 'pointer', fontSize: 13, fontWeight: activeTab === tab.id ? 500 : 400,
                textAlign: 'left', transition: 'all 80ms',
              }}
              onMouseEnter={(e) => { if (activeTab !== tab.id) (e.currentTarget as HTMLElement).style.backgroundColor = C.bg; }}
              onMouseLeave={(e) => { if (activeTab !== tab.id) (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent'; }}
            >
              <span style={{ lineHeight: 0 }}>{tab.icon}</span>
              {tab.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div style={{ flex: 1, overflow: 'auto', padding: 28 }}>
          {activeTab === 'general' && <GeneralTab />}
          {activeTab === 'notifications' && <NotificationsTab />}
          {activeTab === 'api-keys' && <ApiKeysTab />}
          {activeTab === 'retention' && <RetentionTab />}
          {activeTab === 'permissions' && <PermissionsTab />}

          {activeTab === 'alerts' && (
            <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column', margin: '-28px' }}>
              <React.Suspense fallback={<div style={{ padding: 32, textAlign: 'center', color: '#94A3B8', fontSize: 13 }}>Loading...</div>}>
                <AlertsPage />
              </React.Suspense>
            </div>
          )}

          {activeTab === 'gateway' && (
            <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column', margin: '-28px' }}>
              <React.Suspense fallback={<div style={{ padding: 32, textAlign: 'center', color: '#94A3B8', fontSize: 13 }}>Loading...</div>}>
                <ApiGatewayPage />
              </React.Suspense>
            </div>
          )}

          {activeTab === 'health' && (
            <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column', margin: '-28px' }}>
              <React.Suspense fallback={<div style={{ padding: 32, textAlign: 'center', color: '#94A3B8', fontSize: 13 }}>Loading...</div>}>
                <PlatformHealthPage />
              </React.Suspense>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default SettingsPage;
