/**
 * Client to apps-service. All calls authenticated as the current user.
 *
 * Mirrors the surface in nexus-apps-sdk so the host can re-use type names
 * without a circular dep — these are platform-internal HTTP DTOs, not the
 * SDK's iframe-bound RPC envelope.
 */
import { getAccessToken, getTenantId } from '../../store/authStore';
import type {
  AppCatalogEntry, AppInstallEntry, AppVersionEntry,
  TenantSurface, ScopeCatalogEntry, AuditEntry,
} from './types';

// Resolution order matches DevelopTab: env var > current window origin >
// literal localhost. The window-origin fallback lets prod builds that
// don't bake VITE_APPS_SERVICE_URL talk to apps-service on the same domain
// without breaking dev (where the env var is always set explicitly).
const APPS_API: string = (() => {
  const fromEnv = import.meta.env.VITE_APPS_SERVICE_URL;
  if (fromEnv) return fromEnv as string;
  if (typeof window !== 'undefined' && window.location?.origin) return window.location.origin;
  return 'http://localhost:8028';
})();

function headers(json = true): Record<string, string> {
  const h: Record<string, string> = { 'x-tenant-id': getTenantId() };
  const t = getAccessToken();
  if (t) h.Authorization = `Bearer ${t}`;
  if (json) h['Content-Type'] = 'application/json';
  return h;
}

async function j<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(`${APPS_API}${path}`, { ...init, headers: { ...headers(init?.method !== 'GET'), ...(init?.headers || {}) } });
  if (!r.ok) {
    let detail: unknown;
    try { detail = await r.json(); } catch { detail = await r.text(); }
    const msg = typeof detail === 'string' ? detail : JSON.stringify(detail);
    throw new Error(`${init?.method || 'GET'} ${path} → ${r.status}: ${msg}`);
  }
  return (await r.json()) as T;
}

// ── Registry / catalog ───────────────────────────────────────────────────────
export const listCatalog = () => j<AppCatalogEntry[]>('/app-registry/apps');
export const getAppWithVersions = (app_id: string) => j<{ app: AppCatalogEntry; versions: AppVersionEntry[] }>(`/app-registry/apps/${app_id}`);

// ── Installs ────────────────────────────────────────────────────────────────
export const listInstalls   = () => j<AppInstallEntry[]>('/app-installs');
export const getInstall     = (id: string) => j<AppInstallEntry>(`/app-installs/${id}`);
export const installApp     = (body: { app_id: string; version: string; scopes_granted: string[]; config?: Record<string, unknown> }) =>
  j<AppInstallEntry>('/app-installs', { method: 'POST', body: JSON.stringify(body) });
export const patchInstall   = (id: string, body: Partial<{ scopes_granted: string[]; scopes_denied: string[]; enabled: boolean; config: Record<string, unknown>; version: string }>) =>
  j<AppInstallEntry>(`/app-installs/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
export const uninstallApp   = (id: string) => fetch(`${APPS_API}/app-installs/${id}`, { method: 'DELETE', headers: headers(false) }).then(r => { if (!r.ok) throw new Error('uninstall failed'); });
export const issueInstallToken = (id: string) =>
  j<{ token: string; expires_at: string; entry_url: string; origin: string; install_id: string; app_id: string; version: string; config: Record<string, unknown>; scopes_granted: string[] }>(`/app-installs/${id}/token`, { method: 'POST', body: '{}' });

// ── Surfaces (used by NavRail, AppEditor widget catalog, object menus) ───
export const tenantSurfaces = () => j<TenantSurface[]>('/apps-for-tenant/surfaces');

// ── Audit ───────────────────────────────────────────────────────────────────
export const installAudit = (id: string, params?: { limit?: number; offset?: number }) => {
  const q = new URLSearchParams();
  if (params?.limit  !== undefined) q.set('limit',  String(params.limit));
  if (params?.offset !== undefined) q.set('offset', String(params.offset));
  return j<AuditEntry[]>(`/app-installs/${id}/audit${q.toString() ? '?' + q.toString() : ''}`);
};

// ── Scopes catalog (for admin install form) ─────────────────────────────────
export const scopeCatalog = () => j<ScopeCatalogEntry[]>('/apps/scopes/catalog');

// ── AI build brief (with live tenant overlay) ───────────────────────────────
export async function fetchAiContext(): Promise<string> {
  const r = await fetch(`${APPS_API}/app-studio/ai-context`, { headers: headers(false) });
  if (!r.ok) throw new Error(`ai-context: ${r.status}`);
  return r.text();
}

export async function downloadAiContext(filename = 'NEXUS_APP_BRIEF.md'): Promise<void> {
  const text = await fetchAiContext();
  const blob = new Blob([text], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; document.body.appendChild(a); a.click();
  setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 100);
}

// ── RPC dispatcher's outbound endpoint (called by ExternalApp host) ─────────
export interface RpcRequest { requestId: string; method: string; args?: Record<string, unknown> }
export interface RpcReply { requestId: string; ok: boolean; result?: unknown; error?: string; detail?: string; required_scope?: string; latency_ms?: number }

export async function callRpc(token: string, req: RpcRequest): Promise<RpcReply> {
  const r = await fetch(`${APPS_API}/apps/rpc`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(req),
  });
  if (!r.ok) {
    const txt = await r.text();
    return { requestId: req.requestId, ok: false, error: 'http_' + r.status, detail: txt };
  }
  return (await r.json()) as RpcReply;
}

// ── Functions ───────────────────────────────────────────────────────────────
export interface FunctionEntry {
  id: string; install_id: string; tenant_id: string; function_name: string;
  trigger_type: string; trigger_config: Record<string, unknown>;
  timeout_ms: number; enabled: boolean;
  last_run_at?: string; last_run_status?: string; created_at: string;
}
export interface FunctionRun {
  id: string; function_id: string; install_id: string; tenant_id: string;
  trigger: string; input?: Record<string, unknown>; output?: Record<string, unknown>;
  logs?: string; status: string; error_message?: string; duration_ms?: number;
  started_at: string; finished_at?: string;
}
export const listFunctions    = (install_id?: string) => {
  const q = install_id ? `?install_id=${install_id}` : '';
  return j<FunctionEntry[]>(`/apps/functions${q}`);
};
export const runFunctionNow   = (function_id: string, inputs?: Record<string, unknown>) =>
  j<{ run_id: string }>(`/apps/functions/${function_id}/run`, { method: 'POST', body: JSON.stringify({ inputs: inputs || {} }) });
export const listFunctionRuns = (function_id: string, limit = 50) =>
  j<FunctionRun[]>(`/apps/functions/${function_id}/runs?limit=${limit}`);
export const getFunctionRun   = (run_id: string) => j<FunctionRun>(`/apps/functions/runs/${run_id}`);
