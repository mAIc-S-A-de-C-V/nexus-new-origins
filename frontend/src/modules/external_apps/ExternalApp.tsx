/**
 * <ExternalApp installId={...} /> renders a sandboxed third-party app.
 *
 * Lifecycle:
 *   1. Mount: fetch /app-installs/{id}/token → entry_url + token + expected origin
 *   2. Render iframe pointing at entry_url with sandbox attrs
 *   3. Listen for postMessage from iframe; reject anything not from the install's origin
 *   4. On {type:"ready"} → post {type:"init", token, ...} with strict targetOrigin
 *   5. On {type:"rpc_request"} → forward to apps-service /apps/rpc, reply with {type:"rpc_response"}
 *   6. On {type:"resize"} → adjust iframe height
 *   7. On {type:"crashed"} → render fallback
 *   8. Renew token automatically before expiry (host re-issues)
 *
 * Security:
 *   - sandbox="allow-scripts allow-forms allow-downloads allow-popups allow-popups-to-escape-sandbox"
 *     (no allow-same-origin — keeps app cross-origin to host)
 *   - event.origin strictly matched to install's resolved origin
 *   - All postMessage sends use explicit targetOrigin, never "*"
 *   - Token never lives in the iframe URL
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useUiStore } from '../../store/uiStore';
import { useAuth } from '../../shell/TenantContext';
import { useTranslation } from 'react-i18next';
import { callRpc, issueInstallToken } from './api';

interface Props {
  installId: string;
  height?: number | 'auto';
  onNavigate?: (to: string, newTab?: boolean) => void;
  onClose?: () => void;
}

interface SessionState {
  token: string;
  entryUrl: string;
  origin: string;
  appId: string;
  installId: string;
  tenantId: string;
  version: string;
  config: Record<string, unknown>;
  scopesGranted: string[];
  expiresAt: number;
}

const PROTOCOL = 1;

export const ExternalApp: React.FC<Props> = ({ installId, height = 'auto', onNavigate, onClose }) => {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const [session, setSession] = useState<SessionState | null>(null);
  const [iframeHeight, setIframeHeight] = useState<number>(typeof height === 'number' ? height : 600);
  const [error, setError] = useState<string | null>(null);
  const [crashed, setCrashed] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const { theme, density } = useUiStore();
  const { currentUser } = useAuth();
  const { i18n } = useTranslation();
  const locale = i18n.language || 'en';

  // ── Fetch session + token ─────────────────────────────────────────────────
  const fetchSession = useCallback(async (): Promise<SessionState | null> => {
    try {
      const r = await issueInstallToken(installId);
      const session: SessionState = {
        token: r.token,
        entryUrl: r.entry_url,
        origin: r.origin,
        appId: r.app_id,
        installId: r.install_id,
        tenantId: '',   // filled from auth context
        version: r.version,
        config: r.config || {},
        scopesGranted: r.scopes_granted || [],
        expiresAt: new Date(r.expires_at).getTime(),
      };
      return session;
    } catch (e) {
      setError((e as Error).message);
      return null;
    }
  }, [installId]);

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    fetchSession().then((s) => {
      if (!mounted) return;
      setSession(s);
      setLoading(false);
    });
    return () => { mounted = false; };
  }, [fetchSession]);

  // ── Auto-refresh token before expiry ──────────────────────────────────────
  useEffect(() => {
    if (!session) return;
    const msUntilRefresh = Math.max(15_000, session.expiresAt - Date.now() - 30_000);
    const id = setTimeout(async () => {
      const next = await fetchSession();
      if (!next) return;
      setSession(next);
      // Push the new token to the iframe via context_change (or a dedicated message)
      iframeRef.current?.contentWindow?.postMessage(
        { v: PROTOCOL, type: 'init_refresh', token: next.token, expires_at: next.expiresAt } as never,
        session.origin,
      );
    }, msUntilRefresh);
    return () => clearTimeout(id);
  }, [session?.expiresAt, fetchSession]);

  // ── postMessage handler ────────────────────────────────────────────────────
  const handleMessage = useCallback(async (ev: MessageEvent) => {
    if (!session) return;
    if (ev.origin !== session.origin) return;        // strict origin check
    const msg = ev.data as Record<string, unknown> | null;
    if (!msg || msg.v !== PROTOCOL) return;
    const iframeWindow = iframeRef.current?.contentWindow;
    if (!iframeWindow || ev.source !== iframeWindow) return;

    const post = (m: object) => iframeWindow.postMessage(m, session.origin);

    switch (msg.type) {
      case 'ready':
        post({
          v: PROTOCOL,
          type: 'init',
          token: session.token,
          install_id: session.installId,
          app_id: session.appId,
          version: session.version,
          tenant_id: currentUser?.id ? (await import('../../store/authStore')).getTenantId() : '',
          user: { id: currentUser?.id || '', email: currentUser?.email || '', role: (currentUser?.role || '').toString().toLowerCase() },
          config: session.config,
          scopes_granted: session.scopesGranted,
          theme,
          locale,
          density,
          host_origin: window.location.origin,
        });
        break;

      case 'rpc_request': {
        const requestId = msg.requestId as string;
        const method = msg.method as string;
        const args = (msg.args as Record<string, unknown>) || {};
        try {
          const reply = await callRpc(session.token, { requestId, method, args });
          post({
            v: PROTOCOL,
            type: 'rpc_response',
            requestId,
            ok: reply.ok,
            result: reply.result,
            error: reply.error,
            detail: reply.detail,
            required_scope: reply.required_scope,
            latency_ms: reply.latency_ms,
          });
        } catch (e) {
          post({ v: PROTOCOL, type: 'rpc_response', requestId, ok: false, error: 'host_error', detail: String(e) });
        }
        break;
      }

      case 'token_refresh_request': {
        const requestId = msg.requestId as string;
        const next = await fetchSession();
        if (next) {
          setSession(next);
          post({ v: PROTOCOL, type: 'token_refresh_reply', requestId, token: next.token, expires_at: new Date(next.expiresAt).toISOString() });
        } else {
          post({ v: PROTOCOL, type: 'token_refresh_reply', requestId, error: 'refresh_failed' });
        }
        break;
      }

      case 'resize':
        if (height === 'auto') {
          const h = Math.max(80, Math.min(4000, Number(msg.height) || 80));
          setIframeHeight(h);
        }
        break;

      case 'navigate':
        if (onNavigate) onNavigate(msg.to as string, Boolean(msg.newTab));
        else if (msg.newTab) window.open(msg.to as string, '_blank', 'noopener');
        else window.location.href = msg.to as string;
        break;

      case 'ui_signal': {
        const sig = msg.signal as { kind: string; level?: string; message?: string };
        if (sig.kind === 'toast') {
          // Hook into your toast system here. Use a console placeholder + DOM event.
          console.info('[app toast]', sig.level, sig.message);
          window.dispatchEvent(new CustomEvent('nexus:toast', { detail: sig }));
        } else if (sig.kind === 'close' && onClose) {
          onClose();
        }
        break;
      }

      case 'crashed':
        setCrashed(String(msg.error || 'unknown_error'));
        break;
    }
  }, [session, theme, locale, density, currentUser, fetchSession, height, onClose, onNavigate]);

  useEffect(() => {
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [handleMessage]);

  // ── Propagate theme / locale / density on change ──────────────────────────
  useEffect(() => {
    if (!session) return;
    iframeRef.current?.contentWindow?.postMessage(
      { v: PROTOCOL, type: 'context_change', theme, locale, density },
      session.origin,
    );
  }, [theme, locale, density, session?.origin]);

  // ── Render ────────────────────────────────────────────────────────────────
  // `allow-same-origin` is required: cross-origin isolation comes from the
  // iframe living on a different domain than the host (apps-service:8028 vs
  // frontend:3000), NOT from a null sandbox origin. Without this flag the
  // iframe's window.origin is "null", which (a) blocks the iframe from
  // loading its own ES-module assets — the browser treats `./assets/*.js`
  // as cross-origin from a null origin and CORS rejects — and (b) makes
  // postMessage targetOrigin matching impossible (target='<host>' never
  // equals 'null'). Real sandbox separation here is the different origin,
  // not the null-origin trick.
  const sandbox = useMemo(() => [
    'allow-scripts',
    'allow-same-origin',
    'allow-forms',
    'allow-downloads',
    'allow-popups',
    'allow-popups-to-escape-sandbox',
  ].join(' '), []);

  if (loading) {
    return (
      <div style={{ padding: 24, color: '#64748B', fontSize: 13 }}>Loading app…</div>
    );
  }
  if (error) {
    return (
      <div style={{ padding: 24, color: '#B91C1C', fontSize: 13 }}>
        Failed to load app: {error}
      </div>
    );
  }
  if (!session) return null;
  if (crashed) {
    return (
      <div style={{ padding: 24, color: '#B91C1C', fontSize: 13, border: '1px solid #FECACA', borderRadius: 4 }}>
        The app crashed: {crashed}
        <div style={{ marginTop: 8 }}>
          <button onClick={() => { setCrashed(null); setSession(null); fetchSession().then(setSession); }}>Reload</button>
        </div>
      </div>
    );
  }

  // Cache buster ensures token+version changes reload the iframe content
  const src = session.entryUrl + (session.entryUrl.includes('?') ? '&' : '?') +
    `app_id=${encodeURIComponent(session.appId)}&v=${encodeURIComponent(session.version)}`;

  return (
    <iframe
      ref={iframeRef}
      title={`Nexus app: ${session.appId}`}
      src={src}
      sandbox={sandbox}
      loading="lazy"
      style={{
        width: '100%',
        height: typeof height === 'number' ? height : iframeHeight,
        border: 'none',
        display: 'block',
      }}
      referrerPolicy="no-referrer"
      allow="clipboard-write *; clipboard-read *; fullscreen *"
    />
  );
};

export default ExternalApp;
