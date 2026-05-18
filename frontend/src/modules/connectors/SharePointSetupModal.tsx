/**
 * SharePointSetupModal — link a Microsoft SharePoint site to Nexus.
 *
 * Per-tenant Azure AD app: each Nexus tenant registers their own multi-tenant
 * Azure AD app and supplies the client_id, client_secret, and Azure tenant id
 * here. The OAuth2 authorization-code flow then issues access + refresh tokens
 * which the connector stores encrypted on the row.
 *
 * Flow:
 *   1. azure       — user enters client_id, client_secret, Azure tenant id,
 *                    redirect URI; we create a draft connector + ask backend
 *                    for the authorize URL.
 *   2. consent     — user opens the authorize URL in a popup, Azure redirects
 *                    back to /sharepoint/oauth/callback, which posts a message
 *                    back to this window via window.opener.postMessage.
 *   3. pick        — user picks a Site and a Drive from the lists fetched
 *                    via /connectors/{id}/sharepoint/sites and /drives.
 *   4. done        — connector saved with config.site_id + config.drive_id.
 *
 * Demo mode short-circuits everything: a single checkbox creates a connector
 * with config.demoMode=true and no Azure creds. Useful for testing the linker
 * app without real SharePoint access.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  X, FolderTree, CheckCircle2, AlertCircle, Loader2, ExternalLink,
} from 'lucide-react';
import { useConnectorStore } from '../../store/connectorStore';
import { getTenantId, getAccessToken } from '../../store/authStore';

const CONNECTOR_API = import.meta.env.VITE_CONNECTOR_SERVICE_URL || 'http://localhost:8001';

interface Props {
  onClose: () => void;
}

interface Site { id: string; name: string; display_name: string; web_url: string; description: string; }
interface Drive { id: string; site_id: string; name: string; drive_type: string; web_url: string; }

type Step = 'azure' | 'consent' | 'pick' | 'done';

const C = {
  panel: '#FFFFFF',
  border: '#E2E8F0',
  accent: '#0078D4',
  text: '#0D1117',
  muted: '#64748B',
  danger: '#DC2626',
  success: '#16A34A',
  bgSoft: '#F8FAFC',
};


export const SharePointSetupModal: React.FC<Props> = ({ onClose }) => {
  const { addConnector, updateConnector } = useConnectorStore();
  const [step, setStep] = useState<Step>('azure');
  const [name, setName] = useState('');
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [azureTenantId, setAzureTenantId] = useState('common');
  const [redirectUri, setRedirectUri] = useState(
    `${window.location.origin}/api/connectors/sharepoint/oauth/callback`
  );
  const [demoMode, setDemoMode] = useState(false);

  const [connectorId, setConnectorId] = useState<string | null>(null);
  const [authorizeUrl, setAuthorizeUrl] = useState<string | null>(null);
  const [oauthError, setOauthError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [sites, setSites] = useState<Site[]>([]);
  const [drives, setDrives] = useState<Drive[]>([]);
  const [selectedSite, setSelectedSite] = useState<Site | null>(null);
  const [selectedDrive, setSelectedDrive] = useState<Drive | null>(null);
  const [siteFilter, setSiteFilter] = useState('');

  const popupRef = useRef<Window | null>(null);
  const tenantId = getTenantId();

  // ── Listen for OAuth callback postMessage ────────────────────────────────
  useEffect(() => {
    const onMsg = (ev: MessageEvent) => {
      const d = ev.data;
      if (!d || typeof d !== 'object') return;
      if (d.type === 'sharepoint:connected' && d.connector_id === connectorId) {
        popupRef.current?.close();
        setStep('pick');
        loadSites();
      } else if (d.type === 'sharepoint:error') {
        setOauthError(String(d.message || 'OAuth failed'));
      }
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, [connectorId]);

  const canSubmitAzure = useMemo(() => {
    if (demoMode) return !!name.trim();
    return (
      !!name.trim() && !!clientId.trim() && !!clientSecret.trim() &&
      !!azureTenantId.trim() && !!redirectUri.trim()
    );
  }, [name, clientId, clientSecret, azureTenantId, redirectUri, demoMode]);

  // ── Create the (draft) connector + fetch authorize URL ──────────────────

  const submitAzure = async () => {
    if (!canSubmitAzure) return;
    setWorking(true);
    setError(null);
    setOauthError(null);
    try {
      const created = await addConnector({
        name: name.trim(),
        type: 'SHAREPOINT',
        category: 'Doc',
        description: demoMode
          ? 'SharePoint (demo mode — synthetic data)'
          : `SharePoint site — Azure tenant ${azureTenantId}`,
        authType: demoMode ? 'None' : 'OAuth2',
        status: 'idle',
        credentials: demoMode ? {} : {
          client_id: clientId.trim(),
          client_secret: clientSecret.trim(),
          tenant_id: azureTenantId.trim(),
          redirect_uri: redirectUri.trim(),
          scope: 'Files.Read.All Sites.Read.All offline_access',
        },
        config: { demoMode, max_items: 5000 },
        tags: demoMode ? ['doc', 'sharepoint', 'demo'] : ['doc', 'sharepoint'],
        visibility: 'tenant',
      } as Parameters<typeof addConnector>[0]);

      setConnectorId(created.id);

      if (demoMode) {
        // Skip OAuth entirely — go straight to site/drive picker.
        setStep('pick');
        await loadSites(created.id);
      } else {
        // Ask backend for the Azure authorize URL.
        const r = await fetch(
          `${CONNECTOR_API}/connectors/${created.id}/sharepoint/oauth/start`,
          {
            method: 'POST',
            headers: authHeaders(),
          }
        );
        const j = await r.json();
        if (!r.ok) throw new Error(j.detail || j.message || `HTTP ${r.status}`);
        setAuthorizeUrl(j.authorize_url);
        setStep('consent');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setWorking(false);
    }
  };

  const openConsent = () => {
    if (!authorizeUrl) return;
    setOauthError(null);
    const w = 600, h = 720;
    const left = window.screenX + (window.outerWidth - w) / 2;
    const top = window.screenY + (window.outerHeight - h) / 2;
    popupRef.current = window.open(
      authorizeUrl,
      'nexus-sharepoint-oauth',
      `width=${w},height=${h},left=${left},top=${top}`
    );
  };

  // ── Site + drive listing ────────────────────────────────────────────────

  const loadSites = async (cid?: string) => {
    const id = cid || connectorId;
    if (!id) return;
    setWorking(true);
    setError(null);
    try {
      const r = await fetch(
        `${CONNECTOR_API}/connectors/${id}/sharepoint/sites?search=${encodeURIComponent(siteFilter)}`,
        { headers: authHeaders() }
      );
      const j = await r.json();
      if (!r.ok) throw new Error(j.detail || j.message || `HTTP ${r.status}`);
      setSites(j.sites || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setWorking(false);
    }
  };

  const selectSite = async (s: Site) => {
    if (!connectorId) return;
    setSelectedSite(s);
    setSelectedDrive(null);
    setDrives([]);
    setWorking(true);
    setError(null);
    try {
      const r = await fetch(
        `${CONNECTOR_API}/connectors/${connectorId}/sharepoint/drives?site_id=${encodeURIComponent(s.id)}`,
        { headers: authHeaders() }
      );
      const j = await r.json();
      if (!r.ok) throw new Error(j.detail || j.message || `HTTP ${r.status}`);
      setDrives(j.drives || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setWorking(false);
    }
  };

  const saveSelection = async () => {
    if (!connectorId || !selectedSite || !selectedDrive) return;
    setWorking(true);
    setError(null);
    try {
      await updateConnector(connectorId, {
        config: {
          demoMode,
          site_id: selectedSite.id,
          drive_id: selectedDrive.id,
          max_items: 5000,
        },
        status: 'active',
      } as Partial<Parameters<typeof updateConnector>[1]>);
      setStep('done');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setWorking(false);
    }
  };

  const authHeaders = (): Record<string, string> => {
    const h: Record<string, string> = {
      'Content-Type': 'application/json',
      'x-tenant-id': tenantId,
    };
    const tok = getAccessToken?.();
    if (tok) h['Authorization'] = `Bearer ${tok}`;
    return h;
  };

  // ── Render ──────────────────────────────────────────────────────────────

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
              backgroundColor: '#DBEAFE',
              color: C.accent,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <FolderTree size={16} />
            </div>
            <div>
              <h2 style={{ fontSize: 14, fontWeight: 600, color: C.text, margin: 0 }}>
                Link a SharePoint site
              </h2>
              <p style={{ fontSize: 11, color: C.muted, margin: '2px 0 0 0' }}>
                Per-tenant Azure AD app — supply your own client_id / secret.
              </p>
            </div>
          </div>
          <button onClick={onClose} style={iconBtnStyle()}><X size={16} /></button>
        </header>

        <Stepper step={step} />

        <div style={{ padding: 18, overflow: 'auto', flex: 1 }}>
          {step === 'azure' && (
            <AzureStep
              name={name} setName={setName}
              clientId={clientId} setClientId={setClientId}
              clientSecret={clientSecret} setClientSecret={setClientSecret}
              azureTenantId={azureTenantId} setAzureTenantId={setAzureTenantId}
              redirectUri={redirectUri} setRedirectUri={setRedirectUri}
              demoMode={demoMode} setDemoMode={setDemoMode}
            />
          )}
          {step === 'consent' && (
            <ConsentStep
              authorizeUrl={authorizeUrl}
              oauthError={oauthError}
              onOpen={openConsent}
              redirectUri={redirectUri}
            />
          )}
          {step === 'pick' && (
            <PickStep
              sites={sites}
              drives={drives}
              selectedSite={selectedSite}
              selectedDrive={selectedDrive}
              siteFilter={siteFilter}
              setSiteFilter={setSiteFilter}
              onSearchSites={() => loadSites()}
              onSelectSite={selectSite}
              onSelectDrive={setSelectedDrive}
              loading={working}
              demoMode={demoMode}
            />
          )}
          {step === 'done' && (
            <DoneStep
              siteName={selectedSite?.display_name || selectedSite?.name || ''}
              driveName={selectedDrive?.name || ''}
              demoMode={demoMode}
              onDone={onClose}
            />
          )}

          {error && (
            <div style={errorBoxStyle()}>
              <AlertCircle size={14} /> {error}
            </div>
          )}
        </div>

        {step !== 'done' && (
          <footer style={{
            padding: 14, borderTop: `1px solid ${C.border}`,
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          }}>
            <span style={{ fontSize: 11, color: C.muted }}>
              {step === 'azure' && (demoMode
                ? 'Demo mode — no Azure credentials required.'
                : 'Step 1 of 3 — Azure AD app credentials')}
              {step === 'consent' && 'Step 2 of 3 — Microsoft consent'}
              {step === 'pick' && 'Step 3 of 3 — Site + drive selection'}
            </span>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={onClose} style={secondaryBtnStyle()}>Cancel</button>
              {step === 'azure' && (
                <button
                  onClick={submitAzure}
                  disabled={!canSubmitAzure || working}
                  style={primaryBtnStyle(!canSubmitAzure || working)}
                >
                  {working ? <Loader2 size={14} className="spin" /> : null}
                  {demoMode ? 'Create demo connector' : 'Next: Connect Microsoft'}
                </button>
              )}
              {step === 'consent' && (
                <button
                  onClick={openConsent}
                  disabled={!authorizeUrl}
                  style={primaryBtnStyle(!authorizeUrl)}
                >
                  Open Microsoft consent <ExternalLink size={12} />
                </button>
              )}
              {step === 'pick' && (
                <button
                  onClick={saveSelection}
                  disabled={!selectedSite || !selectedDrive || working}
                  style={primaryBtnStyle(!selectedSite || !selectedDrive || working)}
                >
                  {working ? <Loader2 size={14} className="spin" /> : null}
                  Save connector
                </button>
              )}
            </div>
          </footer>
        )}
      </div>
    </div>
  );
};


// ── Step bodies ───────────────────────────────────────────────────────────

const Stepper: React.FC<{ step: Step }> = ({ step }) => {
  const order: Step[] = ['azure', 'consent', 'pick', 'done'];
  const idx = order.indexOf(step);
  return (
    <div style={{ display: 'flex', gap: 4, padding: '8px 18px', backgroundColor: C.bgSoft, borderBottom: `1px solid ${C.border}` }}>
      {order.slice(0, 3).map((s, i) => (
        <div key={s} style={{
          flex: 1, height: 3, borderRadius: 2,
          backgroundColor: i <= idx ? C.accent : '#E2E8F0',
        }} />
      ))}
    </div>
  );
};


interface AzureStepProps {
  name: string; setName: (v: string) => void;
  clientId: string; setClientId: (v: string) => void;
  clientSecret: string; setClientSecret: (v: string) => void;
  azureTenantId: string; setAzureTenantId: (v: string) => void;
  redirectUri: string; setRedirectUri: (v: string) => void;
  demoMode: boolean; setDemoMode: (v: boolean) => void;
}

const AzureStep: React.FC<AzureStepProps> = (p) => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
    <Field label="Connector name">
      <input
        type="text" value={p.name} onChange={(e) => p.setName(e.target.value)}
        placeholder="e.g. MAIC SharePoint" style={inputStyle()}
      />
    </Field>

    <label style={{
      display: 'flex', gap: 8, alignItems: 'center', padding: 8, borderRadius: 4,
      backgroundColor: p.demoMode ? '#F0F9FF' : 'transparent',
      border: `1px dashed ${p.demoMode ? '#BAE6FD' : C.border}`, cursor: 'pointer',
    }}>
      <input type="checkbox" checked={p.demoMode} onChange={(e) => p.setDemoMode(e.target.checked)} />
      <span style={{ fontSize: 12, color: C.text }}>
        <strong>Demo mode</strong> — use synthetic SharePoint data (no Azure app needed). Good for trying the connector and building the linker app.
      </span>
    </label>

    {!p.demoMode && (
      <>
        <div style={{
          padding: 10, borderRadius: 4, backgroundColor: '#FFFBEB',
          border: '1px solid #FDE68A', fontSize: 11, color: '#92400E', lineHeight: 1.5,
        }}>
          <strong>Before continuing</strong>, in portal.azure.com register a multi-tenant app:
          add API permissions <code>Files.Read.All</code>, <code>Sites.Read.All</code>, <code>offline_access</code>;
          add the redirect URI shown below; generate a client secret and paste it here.
        </div>

        <Field label="Azure client ID">
          <input
            type="text" value={p.clientId} onChange={(e) => p.setClientId(e.target.value)}
            placeholder="00000000-0000-0000-0000-000000000000" style={inputStyle()}
          />
        </Field>
        <Field label="Azure client secret">
          <input
            type="password" value={p.clientSecret} onChange={(e) => p.setClientSecret(e.target.value)}
            placeholder="value (not the secret ID)" style={inputStyle()}
          />
        </Field>
        <Field label="Azure AD tenant ID (or 'common' for multi-tenant)">
          <input
            type="text" value={p.azureTenantId} onChange={(e) => p.setAzureTenantId(e.target.value)}
            placeholder="common" style={inputStyle()}
          />
        </Field>
        <Field label="Redirect URI (register this exact value in Azure)">
          <input
            type="text" value={p.redirectUri} onChange={(e) => p.setRedirectUri(e.target.value)}
            style={inputStyle()}
          />
        </Field>
      </>
    )}
  </div>
);


interface ConsentStepProps {
  authorizeUrl: string | null;
  oauthError: string | null;
  onOpen: () => void;
  redirectUri: string;
}

const ConsentStep: React.FC<ConsentStepProps> = ({ authorizeUrl, oauthError, onOpen, redirectUri }) => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
    <div style={{
      padding: 12, borderRadius: 4, backgroundColor: '#F0F9FF',
      border: '1px solid #BAE6FD', fontSize: 12, color: '#075985', lineHeight: 1.5,
    }}>
      Click <strong>Open Microsoft consent</strong> below. A popup will open to Microsoft's
      sign-in page. Sign in with an account that has access to the SharePoint sites
      you want to link, then approve the requested permissions.
    </div>
    <div style={{
      padding: 12, borderRadius: 4, backgroundColor: C.bgSoft,
      border: `1px solid ${C.border}`, fontSize: 11, color: C.muted, lineHeight: 1.5,
      wordBreak: 'break-all',
    }}>
      Microsoft will redirect to: <code>{redirectUri}</code><br />
      That URL must match what you registered in your Azure AD app exactly.
    </div>
    {oauthError && (
      <div style={errorBoxStyle()}>
        <AlertCircle size={14} /> {oauthError}
      </div>
    )}
    {!authorizeUrl && <Loader2 size={14} className="spin" />}
    <p style={{ fontSize: 11, color: C.muted }}>
      After you approve, this window will automatically move to the next step.
    </p>
  </div>
);


interface PickStepProps {
  sites: Site[];
  drives: Drive[];
  selectedSite: Site | null;
  selectedDrive: Drive | null;
  siteFilter: string;
  setSiteFilter: (v: string) => void;
  onSearchSites: () => void;
  onSelectSite: (s: Site) => void;
  onSelectDrive: (d: Drive) => void;
  loading: boolean;
  demoMode: boolean;
}

const PickStep: React.FC<PickStepProps> = (p) => (
  <div style={{ display: 'flex', gap: 12 }}>
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
      <strong style={{ fontSize: 12, color: C.text }}>Sites</strong>
      {!p.demoMode && (
        <div style={{ display: 'flex', gap: 6 }}>
          <input
            type="text" placeholder="Search sites…" value={p.siteFilter}
            onChange={(e) => p.setSiteFilter(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') p.onSearchSites(); }}
            style={inputStyle()}
          />
          <button onClick={p.onSearchSites} style={secondaryBtnStyle()}>Search</button>
        </div>
      )}
      <div style={{ border: `1px solid ${C.border}`, borderRadius: 4, height: 320, overflow: 'auto' }}>
        {p.loading && p.sites.length === 0 && <Loader2 size={14} className="spin" style={{ margin: 12 }} />}
        {p.sites.map((s) => (
          <div
            key={s.id}
            onClick={() => p.onSelectSite(s)}
            style={{
              padding: '8px 10px', borderBottom: `1px solid ${C.border}`,
              cursor: 'pointer',
              backgroundColor: p.selectedSite?.id === s.id ? '#EFF6FF' : 'transparent',
            }}
          >
            <div style={{ fontSize: 12, color: C.text, fontWeight: 600 }}>
              {s.display_name || s.name}
            </div>
            {s.description && (
              <div style={{ fontSize: 10, color: C.muted, marginTop: 2 }}>{s.description}</div>
            )}
          </div>
        ))}
      </div>
    </div>

    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
      <strong style={{ fontSize: 12, color: C.text }}>Drives</strong>
      <div style={{ border: `1px solid ${C.border}`, borderRadius: 4, height: 320, overflow: 'auto' }}>
        {!p.selectedSite && (
          <div style={{ padding: 12, fontSize: 11, color: C.muted }}>
            Pick a site on the left to see its document libraries.
          </div>
        )}
        {p.drives.map((d) => (
          <div
            key={d.id}
            onClick={() => p.onSelectDrive(d)}
            style={{
              padding: '8px 10px', borderBottom: `1px solid ${C.border}`,
              cursor: 'pointer',
              backgroundColor: p.selectedDrive?.id === d.id ? '#EFF6FF' : 'transparent',
            }}
          >
            <div style={{ fontSize: 12, color: C.text, fontWeight: 600 }}>{d.name}</div>
            <div style={{ fontSize: 10, color: C.muted, marginTop: 2 }}>{d.drive_type}</div>
          </div>
        ))}
      </div>
    </div>
  </div>
);


interface DoneStepProps {
  siteName: string;
  driveName: string;
  demoMode: boolean;
  onDone: () => void;
}

const DoneStep: React.FC<DoneStepProps> = ({ siteName, driveName, demoMode, onDone }) => (
  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14, padding: 24 }}>
    <CheckCircle2 size={48} color={C.success} />
    <h3 style={{ fontSize: 14, fontWeight: 600, color: C.text, margin: 0 }}>
      SharePoint connector is live{demoMode ? ' (demo mode)' : ''}
    </h3>
    <p style={{ fontSize: 12, color: C.muted, textAlign: 'center', margin: 0, maxWidth: 460 }}>
      Linked <strong>{siteName}</strong> → <strong>{driveName}</strong>. You can now
      build pipelines or a folder-linker app that pulls files from this drive.
    </p>
    <button onClick={onDone} style={primaryBtnStyle(false)}>Done</button>
  </div>
);


// ── Style helpers ─────────────────────────────────────────────────────────

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

function secondaryBtnStyle(): React.CSSProperties {
  return {
    padding: '7px 14px', fontSize: 12, fontWeight: 600,
    border: `1px solid ${C.border}`, borderRadius: 5,
    backgroundColor: 'transparent', color: C.text, cursor: 'pointer',
  };
}

function errorBoxStyle(): React.CSSProperties {
  return {
    marginTop: 12, padding: 10, borderRadius: 4,
    backgroundColor: '#FEE2E2', color: C.danger,
    display: 'flex', alignItems: 'center', gap: 6, fontSize: 11,
  };
}

export default SharePointSetupModal;
