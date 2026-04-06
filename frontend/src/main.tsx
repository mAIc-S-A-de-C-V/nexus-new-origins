import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';
import { getAccessToken, getTenantId } from './store/authStore';

// Global fetch interceptor: inject x-tenant-id and Authorization into every fetch call.
// This covers all direct fetch() calls in stores/components that hardcode 'tenant-001'.
const _origFetch = window.fetch.bind(window);
window.fetch = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
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
