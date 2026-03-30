import { create } from 'zustand';

const AUTH_API = import.meta.env.VITE_AUTH_SERVICE_URL || 'http://localhost:8011';

export type UserRole = 'admin' | 'analyst' | 'viewer';

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  tenant_id: string;
}

interface AuthState {
  user: AuthUser | null;
  accessToken: string | null;
  loading: boolean;
  error: string | null;

  login: (email: string, password: string, tenantId?: string) => Promise<void>;
  loginWithOIDC: (provider: 'google' | 'okta' | 'azure') => void;
  handleOIDCCallback: (token: string) => Promise<void>;
  refresh: () => Promise<boolean>;
  logout: () => Promise<void>;
  clearError: () => void;
}

// Access token lives in memory only (never localStorage)
let _inMemoryToken: string | null = null;

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  accessToken: null,
  loading: false,
  error: null,

  login: async (email, password, tenantId = 'tenant-001') => {
    set({ loading: true, error: null });
    try {
      const res = await fetch(`${AUTH_API}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email, password, tenant_id: tenantId }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || 'Login failed');
      }

      const data = await res.json();
      _inMemoryToken = data.access_token;
      set({ user: data.user, accessToken: data.access_token, loading: false });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Login failed';
      set({ loading: false, error: msg });
      throw e;
    }
  },

  loginWithOIDC: (provider) => {
    window.location.href = `${AUTH_API}/auth/oidc/${provider}`;
  },

  handleOIDCCallback: async (token: string) => {
    // Token comes from URL param after OIDC redirect
    _inMemoryToken = token;
    // Decode user info from JWT payload (no signature verify needed client-side)
    try {
      const payload = JSON.parse(atob(token.split('.')[1]));
      set({
        accessToken: token,
        user: {
          id: payload.sub,
          email: payload.email,
          name: payload.email,
          role: payload.role as UserRole,
          tenant_id: payload.tenant_id,
        },
      });
    } catch {
      set({ error: 'Failed to parse auth token' });
    }
  },

  refresh: async () => {
    try {
      const res = await fetch(`${AUTH_API}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ refresh_token: null }),
      });
      if (!res.ok) {
        set({ user: null, accessToken: null });
        _inMemoryToken = null;
        return false;
      }
      const data = await res.json();
      _inMemoryToken = data.access_token;
      set({ accessToken: data.access_token });
      return true;
    } catch {
      return false;
    }
  },

  logout: async () => {
    const token = _inMemoryToken;
    _inMemoryToken = null;
    set({ user: null, accessToken: null });
    try {
      await fetch(`${AUTH_API}/auth/logout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ refresh_token: token }),
      });
    } catch {
      // best-effort
    }
  },

  clearError: () => set({ error: null }),
}));

/** Get the current in-memory access token for API calls. */
export const getAccessToken = () => _inMemoryToken;
