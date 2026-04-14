import { create } from 'zustand';

const AUTH_API = import.meta.env.VITE_AUTH_SERVICE_URL || 'http://localhost:8011';

export type UserRole = 'admin' | 'analyst' | 'viewer';

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  tenant_id: string;
  modules: string[];
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

// Access token and tenant_id live in memory only (never localStorage)
let _inMemoryToken: string | null = null;
let _tenantId: string = 'tenant-001';

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
      _tenantId = data.user?.tenant_id || 'tenant-001';
      set({
        user: { ...data.user, modules: (data.user?.modules as string[]) || [] },
        accessToken: data.access_token,
        loading: false,
      });
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
    _inMemoryToken = token;
    try {
      const payload = JSON.parse(atob(token.split('.')[1]));
      _tenantId = payload.tenant_id || 'tenant-001';
      set({
        accessToken: token,
        user: {
          id: payload.sub,
          email: payload.email,
          name: payload.name || payload.email,
          role: payload.role as UserRole,
          tenant_id: payload.tenant_id,
          modules: (payload.modules as string[]) || [],
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
        _tenantId = 'tenant-001';
        return false;
      }
      const data = await res.json();
      _inMemoryToken = data.access_token;

      // Decode user info from the new JWT
      try {
        const payload = JSON.parse(atob(data.access_token.split('.')[1]));
        _tenantId = payload.tenant_id || 'tenant-001';
        set({
          accessToken: data.access_token,
          user: {
            id: payload.sub,
            email: payload.email,
            name: payload.name || payload.email,
            role: payload.role as UserRole,
            tenant_id: payload.tenant_id,
            modules: (payload.modules as string[]) || [],
          },
        });
      } catch {
        set({ accessToken: data.access_token });
      }
      return true;
    } catch {
      return false;
    }
  },

  logout: async () => {
    const token = _inMemoryToken;
    _inMemoryToken = null;
    _tenantId = 'tenant-001';
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

/** Get the current tenant_id for the logged-in user. */
export const getTenantId = () => _tenantId;

/** Get the current allowed modules for the logged-in user. */
export function getModules(): string[] {
  return useAuthStore.getState().user?.modules ?? [];
}
