/**
 * EmailSetupModal — link an IMAP mailbox to Nexus.
 *
 * Mirrors the WhatsApp pattern: per-connector linked-account state. Users
 * pick a provider preset (Gmail / Outlook / Yahoo / iCloud / Zoho / FastMail
 * / Custom), the IMAP host + port autofills, they paste an app-password
 * (instructions linked per provider), then test & save.
 *
 * No OAuth callback infrastructure — app-password is the universal path.
 * Layer Gmail OAuth on later if a customer asks.
 */
import React, { useEffect, useMemo, useState } from 'react';
import {
  X, Mail, CheckCircle2, AlertCircle, Loader2,
  ExternalLink, Eye, EyeOff,
} from 'lucide-react';
import { useConnectorStore } from '../../store/connectorStore';
import { getTenantId } from '../../store/authStore';

const CONNECTOR_API = import.meta.env.VITE_CONNECTOR_SERVICE_URL || 'http://localhost:8001';

interface Props {
  onClose: () => void;
}

interface ProviderPreset {
  key: 'gmail' | 'outlook' | 'yahoo' | 'icloud' | 'zoho' | 'fastmail' | 'custom';
  label: string;
  host: string;
  port: number;
  badge: string;            // emoji / short logo
  appPasswordUrl?: string;  // direct link to where the user gets an app password
  guide: string[];          // 3-5 step bullets
}

const PROVIDERS: ProviderPreset[] = [
  {
    key: 'gmail',
    label: 'Gmail',
    host: 'imap.gmail.com',
    port: 993,
    badge: '✉',
    appPasswordUrl: 'https://myaccount.google.com/apppasswords',
    guide: [
      'Turn on 2-Step Verification (Account → Security)',
      'Open https://myaccount.google.com/apppasswords',
      'Select "Mail" + "Other (Nexus)" → Generate',
      'Copy the 16-character password and paste below',
    ],
  },
  {
    key: 'outlook',
    label: 'Outlook / Microsoft 365',
    host: 'outlook.office365.com',
    port: 993,
    badge: '◆',
    appPasswordUrl: 'https://account.microsoft.com/security',
    guide: [
      'Turn on 2-Step Verification (account.microsoft.com → Security)',
      'Open Advanced security options → App passwords',
      'Click "Create a new app password"',
      'Copy the password and paste below',
    ],
  },
  {
    key: 'yahoo',
    label: 'Yahoo Mail',
    host: 'imap.mail.yahoo.com',
    port: 993,
    badge: 'Y!',
    appPasswordUrl: 'https://login.yahoo.com/account/security',
    guide: [
      'Open Yahoo Account Security',
      'Click "Generate app password"',
      'Name it "Nexus" and generate',
      'Copy the password and paste below',
    ],
  },
  {
    key: 'icloud',
    label: 'iCloud Mail',
    host: 'imap.mail.me.com',
    port: 993,
    badge: '',
    appPasswordUrl: 'https://appleid.apple.com/account/manage',
    guide: [
      'Open appleid.apple.com → Sign-In and Security',
      'Click "App-Specific Passwords" → Generate',
      'Label it "Nexus"',
      'Copy the password (shown once) and paste below',
    ],
  },
  {
    key: 'zoho',
    label: 'Zoho Mail',
    host: 'imap.zoho.com',
    port: 993,
    badge: 'Z',
    appPasswordUrl: 'https://accounts.zoho.com/u/h#security/apppassword',
    guide: [
      'Open Zoho Account → Security → App Passwords',
      'Click "Generate New Password" — name it "Nexus"',
      'Copy the password and paste below',
    ],
  },
  {
    key: 'fastmail',
    label: 'FastMail',
    host: 'imap.fastmail.com',
    port: 993,
    badge: 'F',
    appPasswordUrl: 'https://app.fastmail.com/settings/security/integrations',
    guide: [
      'Open Settings → Privacy & Security → Integrations',
      'Click "New app password" → name it "Nexus"',
      'Choose access "IMAP & POP" → Generate',
      'Copy and paste below',
    ],
  },
  {
    key: 'custom',
    label: 'Custom IMAP',
    host: '',
    port: 993,
    badge: '⚙',
    guide: [
      'Get the IMAP host + port from your provider (usually port 993, SSL)',
      'Use your email and app-password (or main password if 2FA is off)',
    ],
  },
];

const C = {
  bg: '#F8FAFC',
  panel: '#FFFFFF',
  border: '#E2E8F0',
  accent: '#0EA5E9',
  text: '#0D1117',
  muted: '#64748B',
  danger: '#DC2626',
  success: '#16A34A',
};

type Step = 'pick' | 'config' | 'linked';

export const EmailSetupModal: React.FC<Props> = ({ onClose }) => {
  const { addConnector } = useConnectorStore();
  const [step, setStep] = useState<Step>('pick');
  const [provider, setProvider] = useState<ProviderPreset>(PROVIDERS[0]);
  const [name, setName] = useState('');
  const [imapHost, setImapHost] = useState(PROVIDERS[0].host);
  const [imapPort, setImapPort] = useState<number>(PROVIDERS[0].port);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [defaultFolder, setDefaultFolder] = useState('INBOX');
  const [showPassword, setShowPassword] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [linkedSummary, setLinkedSummary] = useState<string>('');

  // When the provider changes, autofill host/port unless user has typed
  // something different already.
  const setProviderAndAutofill = (p: ProviderPreset) => {
    setProvider(p);
    if (p.host) setImapHost(p.host);
    if (p.port) setImapPort(p.port);
    setTestResult(null);
    setStep('config');
  };

  // Use the authStore helper, NOT localStorage — the persisted nexus_auth
  // entry holds the logged-in admin's tenant, but `getTenantId()` returns
  // the active access-token's tenant which honors impersonation. Reading
  // localStorage directly meant we created the connector under the
  // impersonated tenant (via addConnector → getTenantId in the store) but
  // tested it under the admin tenant, producing a 404 on /test.
  const tenantId = getTenantId();

  const canTestOrSave = useMemo(() => {
    return name.trim() && imapHost.trim() && imapPort > 0 && username.trim() && password.trim();
  }, [name, imapHost, imapPort, username, password]);

  // ── Test connection (creates a temp connector, calls /test, deletes it
  //    on failure; on success keeps it and moves to linked step). ────────

  const handleTest = async () => {
    if (!canTestOrSave) return;
    setTesting(true);
    setTestResult(null);
    try {
      const created = await addConnector({
        name: name.trim(),
        type: 'EMAIL_INBOX',
        category: 'Messaging',
        description: `Linked mailbox: ${username.trim()}`,
        authType: 'Basic',
        status: 'idle',
        credentials: {
          imap_host: imapHost.trim(),
          imap_port: String(imapPort),
          username: username.trim(),
          password,
          use_ssl: 'true',
        },
        config: {
          provider: provider.key,
          default_folder: defaultFolder.trim() || 'INBOX',
        },
        tags: ['messaging', 'email', provider.key],
        visibility: 'tenant',
      } as Parameters<typeof addConnector>[0]);

      const r = await fetch(`${CONNECTOR_API}/connectors/${created.id}/test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-tenant-id': tenantId },
      });
      const json = await r.json().catch(() => ({}));
      const ok = !!json?.success;
      // Order: server's structured error (.error) → server message → FastAPI
      // detail (used for 404/422 etc.) → HTTP status fallback → generic.
      // Without `.detail` a 404 here showed "Test failed" with no explanation —
      // exactly the symptom that made the impersonation/tenant bug invisible.
      const fallbackHttp = !r.ok ? `HTTP ${r.status} — ${r.statusText || 'request failed'}` : '';
      const failureMsg = json?.error || json?.message || json?.detail || fallbackHttp || 'Test failed';
      setTestResult({ ok, message: ok ? (json?.message || 'Connected') : failureMsg });
      if (ok) {
        setLinkedSummary(json?.message || `Linked ${username.trim()}`);
        setStep('linked');
      } else {
        // Keep the created connector around so user can retry config; they
        // can also cancel and the row stays as 'error' — easy to delete later.
      }
    } catch (e) {
      setTestResult({ ok: false, message: String(e) });
    } finally {
      setTesting(false);
    }
  };

  // ── Render ───────────────────────────────────────────────────────────

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
          width: 720, maxWidth: '94vw', maxHeight: '90vh',
          backgroundColor: C.panel, borderRadius: 8,
          display: 'flex', flexDirection: 'column', overflow: 'hidden',
          boxShadow: '0 20px 50px rgba(0,0,0,0.18)',
        }}
      >
        <header style={{
          padding: '14px 18px', borderBottom: `1px solid ${C.border}`,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{
              width: 32, height: 32, borderRadius: 8,
              backgroundColor: '#E0F2FE',
              color: C.accent,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <Mail size={16} />
            </div>
            <div>
              <h2 style={{ fontSize: 14, fontWeight: 600, color: C.text, margin: 0 }}>Link an email mailbox</h2>
              <p style={{ fontSize: 11, color: C.muted, margin: '2px 0 0 0' }}>
                One connector = one mailbox. Add as many as you need.
              </p>
            </div>
          </div>
          <button onClick={onClose} style={iconBtnStyle()}><X size={16} /></button>
        </header>

        {step === 'pick' && <ProviderPicker onPick={setProviderAndAutofill} />}

        {step === 'config' && (
          <ConfigStep
            provider={provider}
            name={name} setName={setName}
            imapHost={imapHost} setImapHost={setImapHost}
            imapPort={imapPort} setImapPort={setImapPort}
            username={username} setUsername={setUsername}
            password={password} setPassword={setPassword}
            defaultFolder={defaultFolder} setDefaultFolder={setDefaultFolder}
            showPassword={showPassword} setShowPassword={setShowPassword}
            testing={testing} testResult={testResult}
            canTestOrSave={!!canTestOrSave}
            onChangeProvider={() => setStep('pick')}
            onTest={handleTest}
          />
        )}

        {step === 'linked' && (
          <LinkedStep
            summary={linkedSummary}
            providerLabel={provider.label}
            email={username}
            onDone={onClose}
          />
        )}

        {saveError && <div style={errorBoxStyle()}><AlertCircle size={14} /> {saveError}</div>}
      </div>
    </div>
  );
};

// ── Step 1: Pick a provider ────────────────────────────────────────────

const ProviderPicker: React.FC<{ onPick: (p: ProviderPreset) => void }> = ({ onPick }) => (
  <div style={{ padding: 18, overflowY: 'auto' }}>
    <div style={{ fontSize: 12, color: C.muted, marginBottom: 12 }}>
      Pick your provider. Hosts and ports autofill — you only need an app password.
    </div>
    <div style={{
      display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10,
    }}>
      {PROVIDERS.map((p) => (
        <button
          key={p.key}
          onClick={() => onPick(p)}
          style={{
            display: 'flex', flexDirection: 'column', alignItems: 'flex-start',
            gap: 6, padding: 14, borderRadius: 8,
            border: `1px solid ${C.border}`, backgroundColor: C.panel,
            cursor: 'pointer', textAlign: 'left',
            transition: 'border-color 0.12s, box-shadow 0.12s',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.borderColor = C.accent;
            e.currentTarget.style.boxShadow = '0 1px 4px rgba(14,165,233,0.18)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.borderColor = C.border;
            e.currentTarget.style.boxShadow = 'none';
          }}
        >
          <div style={{
            width: 28, height: 28, borderRadius: 6,
            backgroundColor: '#F1F5F9',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 14, color: C.text, fontWeight: 600,
          }}>{p.badge}</div>
          <div style={{ fontSize: 12, fontWeight: 600, color: C.text }}>{p.label}</div>
          {p.host ? (
            <div style={{ fontSize: 10, color: C.muted, fontFamily: 'monospace' }}>{p.host}:{p.port}</div>
          ) : (
            <div style={{ fontSize: 10, color: C.muted, fontStyle: 'italic' }}>Manual host & port</div>
          )}
        </button>
      ))}
    </div>
  </div>
);

// ── Step 2: Config + test ──────────────────────────────────────────────

const ConfigStep: React.FC<{
  provider: ProviderPreset;
  name: string; setName: (v: string) => void;
  imapHost: string; setImapHost: (v: string) => void;
  imapPort: number; setImapPort: (v: number) => void;
  username: string; setUsername: (v: string) => void;
  password: string; setPassword: (v: string) => void;
  defaultFolder: string; setDefaultFolder: (v: string) => void;
  showPassword: boolean; setShowPassword: (v: boolean) => void;
  testing: boolean;
  testResult: { ok: boolean; message: string } | null;
  canTestOrSave: boolean;
  onChangeProvider: () => void;
  onTest: () => void;
}> = (p) => (
  <div style={{ padding: 18, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 14 }}>
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '10px 12px', borderRadius: 6, backgroundColor: C.bg,
      border: `1px solid ${C.border}`,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{
          width: 26, height: 26, borderRadius: 6,
          backgroundColor: C.panel, border: `1px solid ${C.border}`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 13, fontWeight: 600,
        }}>{p.provider.badge}</div>
        <div>
          <div style={{ fontSize: 12, fontWeight: 600, color: C.text }}>{p.provider.label}</div>
          {p.provider.host ? (
            <div style={{ fontSize: 10, color: C.muted, fontFamily: 'monospace' }}>{p.provider.host}:{p.provider.port}</div>
          ) : null}
        </div>
      </div>
      <button onClick={p.onChangeProvider} style={linkBtnStyle()}>change</button>
    </div>

    <Field label="Connector name (shown in Connectors list)">
      <input
        value={p.name} onChange={(e) => p.setName(e.target.value)}
        placeholder={`${p.provider.label} — main inbox`}
        style={inputStyle()}
      />
    </Field>

    <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 10 }}>
      <Field label="IMAP host">
        <input value={p.imapHost} onChange={(e) => p.setImapHost(e.target.value)} style={inputStyle()} />
      </Field>
      <Field label="Port">
        <input
          type="number" min={1} max={65535}
          value={p.imapPort}
          onChange={(e) => p.setImapPort(Number(e.target.value) || 993)}
          style={inputStyle()}
        />
      </Field>
    </div>

    <Field label="Email address">
      <input
        type="email" value={p.username}
        onChange={(e) => p.setUsername(e.target.value)}
        placeholder="you@example.com"
        style={inputStyle()}
        autoComplete="username"
      />
    </Field>

    <Field label="App password">
      <div style={{ position: 'relative' }}>
        <input
          type={p.showPassword ? 'text' : 'password'}
          value={p.password} onChange={(e) => p.setPassword(e.target.value)}
          placeholder="provider-issued app password"
          style={{ ...inputStyle(), paddingRight: 36 }}
          autoComplete="new-password"
        />
        <button
          type="button"
          onClick={() => p.setShowPassword(!p.showPassword)}
          style={{
            position: 'absolute', right: 6, top: 6,
            width: 24, height: 24, border: 'none', background: 'transparent',
            color: C.muted, cursor: 'pointer', display: 'flex',
            alignItems: 'center', justifyContent: 'center',
          }}
        >
          {p.showPassword ? <EyeOff size={14} /> : <Eye size={14} />}
        </button>
      </div>
    </Field>

    <Field label="Default folder">
      <input
        value={p.defaultFolder} onChange={(e) => p.setDefaultFolder(e.target.value)}
        placeholder="INBOX"
        style={inputStyle()}
      />
    </Field>

    {/* Provider-specific guide */}
    {p.provider.guide.length > 0 && (
      <div style={{
        padding: 12, borderRadius: 6, backgroundColor: '#F0F9FF',
        border: '1px solid #BAE6FD',
        display: 'flex', flexDirection: 'column', gap: 6,
      }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: '#0369A1' }}>
          How to get an app password for {p.provider.label}
        </div>
        <ol style={{ margin: 0, paddingLeft: 20, fontSize: 11, color: '#0C4A6E', lineHeight: 1.5 }}>
          {p.provider.guide.map((g, i) => <li key={i}>{g}</li>)}
        </ol>
        {p.provider.appPasswordUrl && (
          <a
            href={p.provider.appPasswordUrl}
            target="_blank" rel="noreferrer"
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 4,
              fontSize: 11, fontWeight: 600, color: '#0369A1',
              textDecoration: 'none', marginTop: 4,
            }}
          >
            Open the app-password page <ExternalLink size={11} />
          </a>
        )}
      </div>
    )}

    {/* Test result */}
    {p.testResult && (
      <div style={{
        padding: 10, borderRadius: 6,
        backgroundColor: p.testResult.ok ? '#DCFCE7' : '#FEE2E2',
        color: p.testResult.ok ? C.success : C.danger,
        display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, fontWeight: 500,
      }}>
        {p.testResult.ok ? <CheckCircle2 size={14} /> : <AlertCircle size={14} />}
        {p.testResult.message}
      </div>
    )}

    {/* Actions */}
    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
      <button
        onClick={p.onTest}
        disabled={!p.canTestOrSave || p.testing}
        style={primaryBtnStyle(!p.canTestOrSave || p.testing)}
      >
        {p.testing ? <Loader2 size={13} className="spin" /> : null}
        {p.testing ? 'Testing…' : 'Test & Link'}
      </button>
    </div>
  </div>
);

// ── Step 3: Linked confirmation ────────────────────────────────────────

const LinkedStep: React.FC<{
  summary: string;
  providerLabel: string;
  email: string;
  onDone: () => void;
}> = ({ summary, providerLabel, email, onDone }) => (
  <div style={{
    padding: 30, display: 'flex', flexDirection: 'column',
    alignItems: 'center', gap: 16, textAlign: 'center',
  }}>
    <div style={{
      width: 56, height: 56, borderRadius: '50%',
      backgroundColor: '#DCFCE7', color: C.success,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <CheckCircle2 size={28} />
    </div>
    <div>
      <div style={{ fontSize: 15, fontWeight: 600, color: C.text }}>Mailbox linked</div>
      <div style={{ fontSize: 12, color: C.muted, marginTop: 4 }}>
        {providerLabel} · <code>{email}</code>
      </div>
      <div style={{ fontSize: 12, color: C.muted, marginTop: 8 }}>{summary}</div>
    </div>
    <div style={{
      padding: 12, borderRadius: 6, backgroundColor: '#F0F9FF',
      border: '1px solid #BAE6FD', fontSize: 11, color: '#0C4A6E',
      lineHeight: 1.5, maxWidth: 480, textAlign: 'left',
    }}>
      <strong>Next:</strong> open the connector card to view its detected schema, then build a pipeline that
      pulls into a new <code>EmailMessage</code> ObjectType. Run on a schedule to keep your inbox synced.
    </div>
    <button onClick={onDone} style={primaryBtnStyle(false)}>Done</button>
  </div>
);

// ── Shared bits ────────────────────────────────────────────────────────

const Field: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
    <span style={{ fontSize: 11, color: C.muted, fontWeight: 600 }}>{label}</span>
    {children}
  </label>
);

function inputStyle(): React.CSSProperties {
  return {
    width: '100%', padding: '7px 10px', fontSize: 12, color: C.text,
    border: `1px solid ${C.border}`, borderRadius: 4, backgroundColor: C.panel,
    outline: 'none',
  };
}

function iconBtnStyle(): React.CSSProperties {
  return {
    width: 28, height: 28, border: 'none', backgroundColor: 'transparent',
    color: C.muted, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
    borderRadius: 4,
  };
}

function primaryBtnStyle(disabled: boolean): React.CSSProperties {
  return {
    display: 'inline-flex', alignItems: 'center', gap: 6,
    padding: '7px 14px', fontSize: 12, fontWeight: 600,
    border: 'none', borderRadius: 5,
    backgroundColor: disabled ? '#E2E8F0' : C.accent,
    color: disabled ? '#94A3B8' : '#fff',
    cursor: disabled ? 'default' : 'pointer',
  };
}

function linkBtnStyle(): React.CSSProperties {
  return {
    fontSize: 11, fontWeight: 600, color: C.accent,
    border: 'none', backgroundColor: 'transparent', cursor: 'pointer',
  };
}

function errorBoxStyle(): React.CSSProperties {
  return {
    margin: 16, padding: 10, borderRadius: 4,
    backgroundColor: '#FEE2E2', color: C.danger,
    display: 'flex', alignItems: 'center', gap: 6, fontSize: 11,
  };
}

export default EmailSetupModal;
