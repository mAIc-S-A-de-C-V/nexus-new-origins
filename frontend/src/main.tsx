import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';
import './i18n';
import { getAccessToken, getTenantId } from './store/authStore';
import { isShareMode } from './lib/shareMode';

// Global fetch interceptor: inject x-tenant-id and Authorization into every fetch call.
// This covers all direct fetch() calls in stores/components that hardcode 'tenant-001'.
//
// Skipped entirely when share-mode is active: the public viewer hits token-scoped
// endpoints and must not leak tenant credentials. lib/shareMode installs its own
// rewriter that injects X-Share-Session for those requests.
const _origFetch = window.fetch.bind(window);
window.fetch = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  if (isShareMode()) {
    return _origFetch(input, init);
  }
  const token = getAccessToken();
  const tenantId = getTenantId();
  const headers = new Headers(init?.headers);
  if (!headers.has('x-tenant-id')) {
    headers.set('x-tenant-id', tenantId);
  }
  if (token && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  return _origFetch(input, { ...init, headers });
};

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
