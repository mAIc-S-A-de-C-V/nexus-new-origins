import React, { useEffect, useState } from 'react';
import { X, Plus, Copy, Trash2, Lock, Globe, Mail, Check, Calendar, AlertCircle } from 'lucide-react';
import { getTenantId } from '../../store/authStore';

const ONTOLOGY_API = import.meta.env.VITE_ONTOLOGY_SERVICE_URL || 'http://localhost:8004';

const C = {
  bg: '#F8FAFC',
  panel: '#FFFFFF',
  border: '#E2E8F0',
  accent: '#7C3AED',
  text: '#0D1117',
  muted: '#64748B',
  danger: '#DC2626',
  success: '#16A34A',
};

interface Share {
  id: string;
  token: string;
  app_id: string;
  app_version_id: string;
  name: string;
  mode: 'submit' | 'view';
  access_mode: 'public' | 'password' | 'email_whitelist' | 'nexus_user';
  has_password: boolean;
  whitelist_emails: string[];
  max_uses: number | null;
  use_count: number;
  count_what: 'submissions' | 'sessions';
  expires_at: string | null;
  revoked_at: string | null;
  branding: Record<string, unknown>;
  rate_limit_qps: number;
  created_at: string;
}

interface Props {
  appId: string;
  appKind: 'dashboard' | 'app';
  onClose: () => void;
}

const ShareManagerModal: React.FC<Props> = ({ appId, appKind, onClose }) => {
  const [shares, setShares] = useState<Share[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [error, setError] = useState('');

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const r = await fetch(`${ONTOLOGY_API}/shares/apps/${appId}/shares`, {
        headers: { 'x-tenant-id': getTenantId() },
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = await r.json();
      setShares(data);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appId]);

  const revoke = async (id: string) => {
    if (!window.confirm('Revoke this share? The link will stop working immediately.')) return;
    await fetch(`${ONTOLOGY_API}/shares/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'x-tenant-id': getTenantId() },
      body: JSON.stringify({ revoked: true }),
    });
    await load();
  };

  const remove = async (id: string) => {
    if (!window.confirm('Permanently delete this share and its history?')) return;
    await fetch(`${ONTOLOGY_API}/shares/${id}`, {
      method: 'DELETE',
      headers: { 'x-tenant-id': getTenantId() },
    });
    await load();
  };

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, backgroundColor: 'rgba(15,23,42,0.55)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 720, maxWidth: '92vw', maxHeight: '88vh',
          backgroundColor: C.panel, borderRadius: 8, display: 'flex', flexDirection: 'column',
          overflow: 'hidden', boxShadow: '0 20px 50px rgba(0,0,0,0.18)',
        }}
      >
        <header style={headerStyle()}>
          <div>
            <h2 style={{ fontSize: 15, fontWeight: 600, color: C.text, margin: 0 }}>Share this {appKind}</h2>
            <p style={{ fontSize: 12, color: C.muted, margin: '4px 0 0 0' }}>
              External links pin to a snapshot — editing the app doesn't affect live shares.
            </p>
          </div>
          <button onClick={onClose} style={iconBtnStyle()}><X size={16} /></button>
        </header>

        <div style={{ flex: 1, overflowY: 'auto', padding: 18 }}>
          {error && (
            <div style={errorBoxStyle()}>
              <AlertCircle size={14} /> {error}
            </div>
          )}

          {!showCreate && (
            <button
              onClick={() => setShowCreate(true)}
              style={primaryBtnStyle()}
            >
              <Plus size={14} /> New share link
            </button>
          )}

          {showCreate && (
            <CreateShareForm
              appId={appId}
              defaultMode={appKind === 'app' ? 'submit' : 'view'}
              onCancel={() => setShowCreate(false)}
              onCreated={async () => {
                setShowCreate(false);
                await load();
              }}
            />
          )}

          <div style={{ marginTop: 18, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {loading && <div style={{ color: C.muted, fontSize: 12 }}>Loading…</div>}
            {!loading && shares.length === 0 && !showCreate && (
              <div style={{
                padding: 24, textAlign: 'center', color: C.muted, fontSize: 12,
                border: `1px dashed ${C.border}`, borderRadius: 6,
              }}>
                No shares yet. Create one above.
              </div>
            )}
            {shares.map((s) => (
              <ShareRow key={s.id} share={s} onRevoke={() => revoke(s.id)} onDelete={() => remove(s.id)} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

const ShareRow: React.FC<{ share: Share; onRevoke: () => void; onDelete: () => void }> = ({
  share,
  onRevoke,
  onDelete,
}) => {
  const [copied, setCopied] = useState(false);
  const url = `${window.location.origin}/s/${share.token}`;
  const exhausted = share.max_uses != null && share.use_count >= share.max_uses;
  const expired = share.expires_at && new Date(share.expires_at) < new Date();
  const revoked = !!share.revoked_at;
  const dead = exhausted || expired || revoked;

  const status: { label: string; color: string } = revoked
    ? { label: 'Revoked', color: C.danger }
    : expired
      ? { label: 'Expired', color: C.danger }
      : exhausted
        ? { label: 'Exhausted', color: C.danger }
        : { label: 'Active', color: C.success };

  const accessIcon =
    share.access_mode === 'password' ? <Lock size={11} />
      : share.access_mode === 'email_whitelist' ? <Mail size={11} />
        : <Globe size={11} />;

  const copy = async () => {
    await navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  return (
    <div style={{
      border: `1px solid ${C.border}`, borderRadius: 6, padding: 14,
      display: 'flex', flexDirection: 'column', gap: 10,
      backgroundColor: dead ? '#FAFAFA' : C.panel,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: C.text }}>{share.name}</div>
          <div style={{ fontSize: 11, color: C.muted, display: 'flex', gap: 10, alignItems: 'center' }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
              {accessIcon} {share.access_mode}
            </span>
            <span>· {share.mode}</span>
            <span>
              · {share.use_count}{share.max_uses != null ? ` / ${share.max_uses}` : ''} {share.count_what}
            </span>
            {share.expires_at && (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                <Calendar size={10} /> {new Date(share.expires_at).toLocaleDateString()}
              </span>
            )}
          </div>
        </div>
        <span style={{
          fontSize: 10, fontWeight: 600, padding: '3px 8px', borderRadius: 10,
          color: status.color, backgroundColor: dead ? '#FEE2E2' : '#DCFCE7',
        }}>{status.label}</span>
      </div>

      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        backgroundColor: C.bg, padding: '6px 10px', borderRadius: 4,
        border: `1px solid ${C.border}`,
      }}>
        <code style={{ flex: 1, fontSize: 11, color: C.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {url}
        </code>
        <button
          onClick={copy}
          style={{
            display: 'flex', alignItems: 'center', gap: 4,
            padding: '4px 8px', fontSize: 11, fontWeight: 600,
            border: `1px solid ${C.border}`, borderRadius: 4,
            backgroundColor: copied ? '#DCFCE7' : C.panel,
            color: copied ? C.success : C.text, cursor: 'pointer',
          }}
        >
          {copied ? <Check size={11} /> : <Copy size={11} />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>

      <div style={{ display: 'flex', gap: 8 }}>
        {!revoked && (
          <button onClick={onRevoke} style={secondaryBtnStyle()}>Revoke</button>
        )}
        <button onClick={onDelete} style={{ ...secondaryBtnStyle(), color: C.danger }}>
          <Trash2 size={11} /> Delete
        </button>
      </div>
    </div>
  );
};

const CreateShareForm: React.FC<{
  appId: string;
  defaultMode: 'submit' | 'view';
  onCancel: () => void;
  onCreated: () => void | Promise<void>;
}> = ({ appId, defaultMode, onCancel, onCreated }) => {
  const [name, setName] = useState('');
  const [mode, setMode] = useState<'submit' | 'view'>(defaultMode);
  const [accessMode, setAccessMode] = useState<'public' | 'password' | 'email_whitelist'>('public');
  const [password, setPassword] = useState('');
  const [whitelist, setWhitelist] = useState('');
  const [maxUses, setMaxUses] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [logoUrl, setLogoUrl] = useState('');
  const [primaryColor, setPrimaryColor] = useState('');
  const [hideChrome, setHideChrome] = useState(false);
  const [supportEmail, setSupportEmail] = useState('');
  const [rateLimit, setRateLimit] = useState('10');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const submit = async () => {
    setErr('');
    if (!name.trim()) { setErr('Name is required'); return; }
    if (accessMode === 'password' && !password) { setErr('Password required for password access'); return; }
    setBusy(true);
    try {
      const body: Record<string, unknown> = {
        name: name.trim(),
        mode,
        access_mode: accessMode,
        max_uses: maxUses ? Number(maxUses) : null,
        expires_at: expiresAt ? new Date(expiresAt).toISOString() : null,
        rate_limit_qps: Math.max(1, Number(rateLimit) || 10),
        branding: {
          ...(logoUrl ? { logo_url: logoUrl } : {}),
          ...(primaryColor ? { primary_color: primaryColor } : {}),
          ...(hideChrome ? { hide_chrome: true } : {}),
          ...(supportEmail ? { support_email: supportEmail } : {}),
        },
      };
      if (accessMode === 'password') body.password = password;
      if (accessMode === 'email_whitelist') {
        body.whitelist_emails = whitelist
          .split(/[\s,;]+/)
          .map((e) => e.trim())
          .filter(Boolean);
      }
      const r = await fetch(`${ONTOLOGY_API}/shares/apps/${appId}/shares`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-tenant-id': getTenantId() },
        body: JSON.stringify(body),
      });
      if (!r.ok) {
        const text = await r.text().catch(() => '');
        throw new Error(text.slice(0, 200) || `HTTP ${r.status}`);
      }
      await onCreated();
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{
      border: `1px solid ${C.border}`, borderRadius: 6, padding: 16,
      display: 'flex', flexDirection: 'column', gap: 12, backgroundColor: C.bg,
    }}>
      <FieldRow label="Name">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Customer onboarding form" style={inputStyle()} />
      </FieldRow>

      <FieldRow label="Type">
        <select value={mode} onChange={(e) => setMode(e.target.value as 'submit' | 'view')} style={inputStyle()}>
          <option value="submit">Submit-only (form)</option>
          <option value="view">View-only (dashboard)</option>
        </select>
      </FieldRow>

      <FieldRow label="Access">
        <select value={accessMode} onChange={(e) => setAccessMode(e.target.value as typeof accessMode)} style={inputStyle()}>
          <option value="public">Public (anyone with the link)</option>
          <option value="password">Password</option>
          <option value="email_whitelist">Email whitelist</option>
        </select>
      </FieldRow>

      {accessMode === 'password' && (
        <FieldRow label="Password">
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} style={inputStyle()} />
        </FieldRow>
      )}

      {accessMode === 'email_whitelist' && (
        <FieldRow label="Allowed emails">
          <textarea
            value={whitelist}
            onChange={(e) => setWhitelist(e.target.value)}
            placeholder="alice@example.com, bob@example.com"
            style={{ ...inputStyle(), height: 64, fontFamily: 'inherit' }}
          />
        </FieldRow>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <FieldRow label="Max uses (blank = unlimited)">
          <input type="number" min={1} value={maxUses} onChange={(e) => setMaxUses(e.target.value)} placeholder="e.g. 100" style={inputStyle()} />
        </FieldRow>
        <FieldRow label="Expires at">
          <input type="datetime-local" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} style={inputStyle()} />
        </FieldRow>
      </div>

      <FieldRow label="Rate limit (req/sec per share)">
        <input type="number" min={1} max={1000} value={rateLimit} onChange={(e) => setRateLimit(e.target.value)} style={inputStyle()} />
      </FieldRow>

      <details style={{ marginTop: 4 }}>
        <summary style={{ fontSize: 12, color: C.text, cursor: 'pointer', fontWeight: 500 }}>White-label branding</summary>
        <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <FieldRow label="Logo URL">
            <input value={logoUrl} onChange={(e) => setLogoUrl(e.target.value)} placeholder="https://…/logo.png" style={inputStyle()} />
          </FieldRow>
          <FieldRow label="Primary color">
            <input value={primaryColor} onChange={(e) => setPrimaryColor(e.target.value)} placeholder="#7C3AED" style={inputStyle()} />
          </FieldRow>
          <FieldRow label="Support email">
            <input type="email" value={supportEmail} onChange={(e) => setSupportEmail(e.target.value)} style={inputStyle()} />
          </FieldRow>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: C.text }}>
            <input type="checkbox" checked={hideChrome} onChange={(e) => setHideChrome(e.target.checked)} />
            Hide Nexus header
          </label>
        </div>
      </details>

      {err && (
        <div style={errorBoxStyle()}><AlertCircle size={14} /> {err}</div>
      )}

      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button onClick={onCancel} style={secondaryBtnStyle()} disabled={busy}>Cancel</button>
        <button onClick={submit} style={primaryBtnStyle()} disabled={busy}>
          {busy ? 'Creating…' : 'Create share'}
        </button>
      </div>
    </div>
  );
};

const FieldRow: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
    <span style={{ fontSize: 11, color: C.muted, fontWeight: 500 }}>{label}</span>
    {children}
  </label>
);

function headerStyle(): React.CSSProperties {
  return {
    padding: '14px 18px',
    borderBottom: `1px solid ${C.border}`,
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
  };
}

function iconBtnStyle(): React.CSSProperties {
  return {
    width: 28, height: 28, border: 'none', backgroundColor: 'transparent',
    color: C.muted, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
    borderRadius: 4,
  };
}

function primaryBtnStyle(): React.CSSProperties {
  return {
    display: 'flex', alignItems: 'center', gap: 5,
    padding: '7px 14px', fontSize: 12, fontWeight: 600,
    border: 'none', borderRadius: 5, backgroundColor: C.accent, color: '#fff', cursor: 'pointer',
  };
}

function secondaryBtnStyle(): React.CSSProperties {
  return {
    display: 'flex', alignItems: 'center', gap: 5,
    padding: '6px 12px', fontSize: 11, fontWeight: 500,
    border: `1px solid ${C.border}`, borderRadius: 4,
    backgroundColor: C.panel, color: C.text, cursor: 'pointer',
  };
}

function inputStyle(): React.CSSProperties {
  return {
    padding: '7px 10px', fontSize: 12, color: C.text,
    border: `1px solid ${C.border}`, borderRadius: 4,
    backgroundColor: C.panel, width: '100%',
  };
}

function errorBoxStyle(): React.CSSProperties {
  return {
    display: 'flex', alignItems: 'center', gap: 6,
    padding: '8px 10px', fontSize: 11, color: C.danger,
    backgroundColor: '#FEE2E2', borderRadius: 4, marginBottom: 8,
  };
}

export default ShareManagerModal;
