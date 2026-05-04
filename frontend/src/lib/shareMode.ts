/**
 * Share-mode runtime singleton.
 *
 * The public SharePage installs a token + session here on mount; widget code
 * inside AppCanvas checks `getShareMode()` to:
 *   1. Route record/aggregate fetches through `/s/{token}/...` instead of
 *      `/object-types/...`.
 *   2. Route form submissions to `/s/{token}/submit` instead of
 *      `/object-types/{ot}/records/ingest`.
 *
 * Server-side scope enforcement is the real protection — this is just the
 * client-side plumbing. Even if a widget skipped the check, the share
 * session JWT can't reach the tenant-scoped endpoints anyway.
 */

interface ShareModeState {
  active: boolean;
  token: string;
  sessionJwt: string;
  branding: Record<string, unknown>;
  appId: string;
}

let _state: ShareModeState | null = null;

export function setShareMode(s: Omit<ShareModeState, 'active'>): void {
  _state = { ...s, active: true };
}

export function clearShareMode(): void {
  _state = null;
}

export function getShareMode(): ShareModeState | null {
  return _state;
}

export function isShareMode(): boolean {
  return !!_state?.active;
}

/**
 * URL rewriter — given a fetch input that targets the ontology service,
 * convert it into the share-token equivalent. Returns null if the URL
 * doesn't match a rewritable pattern (caller falls back to original).
 *
 * Patterns handled:
 *   /object-types/{ot}/records?...        -> /s/{token}/records?ot={ot}&...
 *   /object-types/{ot}/aggregate          -> /s/{token}/aggregate?ot={ot}
 *   /apps/{id}                            -> /s/{token}/app  (we already have it)
 */
export function rewriteForShare(urlStr: string, token: string): string | null {
  let url: URL;
  try {
    url = new URL(urlStr);
  } catch {
    return null;
  }

  const recordsMatch = url.pathname.match(/^\/object-types\/([^/]+)\/records\/?$/);
  if (recordsMatch) {
    const ot = recordsMatch[1];
    const params = new URLSearchParams(url.search);
    params.set('ot', ot);
    return `${url.origin}/s/${token}/records?${params.toString()}`;
  }

  const aggMatch = url.pathname.match(/^\/object-types\/([^/]+)\/aggregate\/?$/);
  if (aggMatch) {
    const ot = aggMatch[1];
    return `${url.origin}/s/${token}/aggregate?ot=${encodeURIComponent(ot)}`;
  }

  const appByIdMatch = url.pathname.match(/^\/apps\/[^/]+\/?$/);
  if (appByIdMatch) {
    return `${url.origin}/s/${token}/app`;
  }

  return null;
}

/**
 * Fetch wrapper installed globally while SharePage is mounted. Rewrites
 * known ontology paths to share-token paths and swaps `x-tenant-id` for
 * `x-share-session`. Untouched for fetches that don't match a pattern —
 * those will hit the original endpoint and (correctly) 401, surfacing
 * "this widget isn't supported in share mode" rather than silently leaking.
 */
let _origFetch: typeof window.fetch | null = null;

export function installShareFetchInterceptor(): void {
  if (_origFetch !== null) return;
  _origFetch = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const state = getShareMode();
    if (!state?.active) {
      return _origFetch!(input, init);
    }
    const urlStr =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;

    const rewritten = rewriteForShare(urlStr, state.token);
    if (!rewritten) {
      // Not an ontology read we care about — pass through. Will likely
      // 401 server-side if it's tenant-scoped, which is what we want.
      return _origFetch!(input, init);
    }

    // Strip auth + tenant headers from the original init; inject share session.
    const newHeaders = new Headers(init?.headers || {});
    newHeaders.delete('x-tenant-id');
    newHeaders.delete('X-Tenant-Id');
    newHeaders.delete('Authorization');
    newHeaders.set('X-Share-Session', state.sessionJwt);
    return _origFetch!(rewritten, { ...init, headers: newHeaders });
  };
}

export function uninstallShareFetchInterceptor(): void {
  if (_origFetch !== null) {
    window.fetch = _origFetch;
    _origFetch = null;
  }
}
