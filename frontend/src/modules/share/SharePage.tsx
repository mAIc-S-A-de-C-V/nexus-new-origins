import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Lock, AlertTriangle } from 'lucide-react';
import AppCanvas from '../apps/AppCanvas';
import { NexusApp, AppComponent } from '../../types/app';
import {
  setShareMode,
  clearShareMode,
  installShareFetchInterceptor,
  uninstallShareFetchInterceptor,
} from '../../lib/shareMode';

const ONTOLOGY_API = import.meta.env.VITE_ONTOLOGY_SERVICE_URL || 'http://localhost:8004';

type Phase = 'loading' | 'auth' | 'ready' | 'dead';

interface GateInfo {
  ok: boolean;
  reason: string;
  mode: 'submit' | 'view';
  access_mode: 'public' | 'password' | 'email_whitelist' | 'nexus_user';
  name: string;
  branding: {
    logo_url?: string;
    primary_color?: string;
    hide_chrome?: boolean;
    support_email?: string;
    name?: string;
  };
  expires_at: string | null;
}

const C = {
  bg: '#F8FAFC',
  panel: '#FFFFFF',
  border: '#E2E8F0',
  accent: '#7C3AED',
  text: '#0D1117',
  muted: '#64748B',
  danger: '#DC2626',
};

function extractToken(): string | null {
  const m = window.location.pathname.match(/^\/s\/([A-Za-z0-9_-]+)/);
  return m ? m[1] : null;
}

const SharePage: React.FC = () => {
  const token = useMemo(extractToken, []);
  const [phase, setPhase] = useState<Phase>('loading');
  const [gate, setGate] = useState<GateInfo | null>(null);
  const [app, setApp] = useState<NexusApp | null>(null);
  const [error, setError] = useState<string>('');
  const [pwd, setPwd] = useState('');
  const [email, setEmail] = useState('');
  const [authBusy, setAuthBusy] = useState(false);
  const accent = gate?.branding?.primary_color || C.accent;

  // Install share-mode fetch interceptor for the lifetime of this tree.
  useEffect(() => {
    installShareFetchInterceptor();
    return () => {
      uninstallShareFetchInterceptor();
      clearShareMode();
    };
  }, []);

  // Probe the gate.
  useEffect(() => {
    if (!token) {
      setPhase('dead');
      setError('Invalid share link');
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(`${ONTOLOGY_API}/s/${token}`);
        if (!r.ok) {
          setPhase('dead');
          setError(`Share unavailable (${r.status})`);
          return;
        }
        const data: GateInfo = await r.json();
        if (cancelled) return;
        setGate(data);
        if (!data.ok) {
          setPhase('dead');
          setError(data.reason || 'unavailable');
          return;
        }
        if (data.access_mode === 'public') {
          // Auto-mint a session for public shares so the same code path
          // applies for all access modes downstream.
          await runAuth({ mode: 'public' }, data);
        } else {
          setPhase('auth');
        }
      } catch (e) {
        setPhase('dead');
        setError(String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const runAuth = useCallback(
    async (
      payload: { mode: 'public' } | { mode: 'password'; password: string } | { mode: 'email'; email: string },
      gateInfo: GateInfo,
    ) => {
      if (!token) return;
      setAuthBusy(true);
      setError('');
      try {
        const body =
          payload.mode === 'password'
            ? { password: payload.password }
            : payload.mode === 'email'
              ? { email: payload.email }
              : {};
        const r = await fetch(`${ONTOLOGY_API}/s/${token}/auth`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        if (!r.ok) {
          const text = await r.text().catch(() => '');
          let msg = `Authentication failed (${r.status})`;
          try {
            const j = JSON.parse(text);
            if (j?.detail) msg = j.detail;
          } catch {
            /* ignore */
          }
          setError(msg);
          setPhase('auth');
          return;
        }
        const { session } = await r.json();
        // Activate share-mode singleton; AppCanvas + interceptor read this.
        setShareMode({
          token,
          sessionJwt: session,
          branding: gateInfo.branding || {},
          appId: '',
        });
        // Now fetch the pinned app snapshot.
        const appRes = await fetch(`${ONTOLOGY_API}/s/${token}/app`, {
          headers: { 'X-Share-Session': session },
        });
        if (!appRes.ok) {
          setError(`Failed to load app (${appRes.status})`);
          setPhase('auth');
          return;
        }
        const raw = await appRes.json();
        // Re-shape the snapshot into the NexusApp the canvas expects.
        const settings = (raw.settings || {}) as Record<string, unknown>;
        const nexusApp: NexusApp = {
          id: raw.id,
          name: raw.name,
          description: raw.description || '',
          icon: raw.icon || '',
          components: (raw.components || []) as AppComponent[],
          objectTypeIds: raw.object_type_ids || [],
          createdAt: '',
          updatedAt: '',
          kind: raw.kind || 'dashboard',
          actions: (settings.actions as NexusApp['actions']) || [],
          variables: (settings.variables as NexusApp['variables']) || [],
          events: (settings.events as NexusApp['events']) || [],
          filterBar: settings.filter_bar as NexusApp['filterBar'] | undefined,
        };
        setApp(nexusApp);
        setPhase('ready');
      } catch (e) {
        setError(String(e));
        setPhase('auth');
      } finally {
        setAuthBusy(false);
      }
    },
    [token],
  );

  // Submit-mode: when the form completes, surface a thank-you screen.
  // We watch for the runtime's onSuccess hook by listening for the
  // FormWidget's emitted action result. Simpler proxy: AppCanvas displays
  // a toast on success — for now we just rely on that and keep this UI
  // available. In Phase 2 we can hook a tighter "after first submit" flow.
  // (No-op for v1.)

  const headerName = gate?.branding?.name || gate?.name || 'Shared form';

  if (!token) {
    return (
      <div style={pageStyle()}>
        <div style={cardStyle()}>
          <AlertTriangle size={28} color={C.danger} />
          <h1 style={{ fontSize: 16, color: C.text, margin: 0 }}>Invalid share link</h1>
        </div>
      </div>
    );
  }

  if (phase === 'loading') {
    return (
      <div style={pageStyle()}>
        <div style={cardStyle()}>
          <div style={{ color: C.muted, fontSize: 13 }}>Loading…</div>
        </div>
      </div>
    );
  }

  if (phase === 'dead') {
    return (
      <div style={pageStyle()}>
        <div style={cardStyle()}>
          <AlertTriangle size={28} color={C.danger} />
          <h1 style={{ fontSize: 16, color: C.text, margin: 0 }}>{headerName}</h1>
          <p style={{ fontSize: 13, color: C.muted, margin: 0 }}>
            {error === 'expired'
              ? 'This share link has expired.'
              : error === 'revoked'
                ? 'This share link has been revoked.'
                : error === 'exhausted'
                  ? 'This share link has reached its usage limit.'
                  : error || 'This share link is no longer available.'}
          </p>
          {gate?.branding?.support_email && (
            <a href={`mailto:${gate.branding.support_email}`} style={{ fontSize: 12, color: accent }}>
              Contact support
            </a>
          )}
        </div>
      </div>
    );
  }

  if (phase === 'auth' && gate) {
    return (
      <div style={pageStyle()}>
        <div style={cardStyle()}>
          {gate.branding?.logo_url ? (
            <img src={gate.branding.logo_url} alt="" style={{ maxWidth: 160, maxHeight: 60 }} />
          ) : (
            <Lock size={24} color={accent} />
          )}
          <h1 style={{ fontSize: 16, color: C.text, margin: 0 }}>{headerName}</h1>
          {gate.access_mode === 'password' ? (
            <>
              <p style={{ fontSize: 12, color: C.muted, margin: 0 }}>Enter the password to continue.</p>
              <input
                type="password"
                value={pwd}
                onChange={(e) => setPwd(e.target.value)}
                placeholder="Password"
                style={inputStyle()}
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && pwd) runAuth({ mode: 'password', password: pwd }, gate);
                }}
              />
              <button
                style={btnStyle(accent)}
                disabled={!pwd || authBusy}
                onClick={() => runAuth({ mode: 'password', password: pwd }, gate)}
              >
                {authBusy ? 'Checking…' : 'Continue'}
              </button>
            </>
          ) : gate.access_mode === 'email_whitelist' ? (
            <>
              <p style={{ fontSize: 12, color: C.muted, margin: 0 }}>
                Enter your email to continue. Only invited emails can access this link.
              </p>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                style={inputStyle()}
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && email) runAuth({ mode: 'email', email }, gate);
                }}
              />
              <button
                style={btnStyle(accent)}
                disabled={!email || authBusy}
                onClick={() => runAuth({ mode: 'email', email }, gate)}
              >
                {authBusy ? 'Checking…' : 'Continue'}
              </button>
            </>
          ) : (
            <p style={{ fontSize: 12, color: C.muted, margin: 0 }}>
              This share requires sign-in. Not yet supported in v1.
            </p>
          )}
          {error && <div style={{ fontSize: 12, color: C.danger }}>{error}</div>}
        </div>
      </div>
    );
  }

  if (phase === 'ready' && app && gate) {
    return (
      <div style={{ minHeight: '100vh', backgroundColor: C.bg }}>
        {!gate.branding?.hide_chrome && (
          <header
            style={{
              padding: '14px 24px',
              backgroundColor: C.panel,
              borderBottom: `1px solid ${C.border}`,
              display: 'flex',
              alignItems: 'center',
              gap: 12,
            }}
          >
            {gate.branding?.logo_url ? (
              <img src={gate.branding.logo_url} alt="" style={{ height: 28 }} />
            ) : null}
            <div style={{ fontSize: 14, fontWeight: 600, color: C.text }}>{headerName}</div>
          </header>
        )}
        <div style={{ padding: '0 0' }}>
          <AppCanvas app={app} />
        </div>
        {gate.branding?.support_email && (
          <footer style={{ padding: 16, textAlign: 'center', fontSize: 11, color: C.muted }}>
            Need help? <a href={`mailto:${gate.branding.support_email}`} style={{ color: accent }}>{gate.branding.support_email}</a>
          </footer>
        )}
      </div>
    );
  }

  return null;
};

function pageStyle(): React.CSSProperties {
  return {
    minHeight: '100vh',
    backgroundColor: C.bg,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  };
}

function cardStyle(): React.CSSProperties {
  return {
    backgroundColor: C.panel,
    border: `1px solid ${C.border}`,
    borderRadius: 8,
    padding: 28,
    minWidth: 320,
    maxWidth: 420,
    display: 'flex',
    flexDirection: 'column',
    gap: 14,
    alignItems: 'flex-start',
    boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
  };
}

function inputStyle(): React.CSSProperties {
  return {
    width: '100%',
    padding: '8px 10px',
    border: `1px solid ${C.border}`,
    borderRadius: 6,
    fontSize: 13,
    color: C.text,
    backgroundColor: C.bg,
  };
}

function btnStyle(accent: string): React.CSSProperties {
  return {
    width: '100%',
    padding: '8px 12px',
    backgroundColor: accent,
    color: '#fff',
    border: 'none',
    borderRadius: 6,
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
  };
}

export default SharePage;
