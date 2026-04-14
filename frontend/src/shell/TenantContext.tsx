import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { useAuthStore, getAccessToken, getTenantId } from '../store/authStore';

// ── Types ──────────────────────────────────────────────────────────────────

export type UserRole = 'ADMIN' | 'DATA_ENGINEER' | 'ANALYST' | 'VIEWER';

export interface MaicUser {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  password: string;
  createdAt: string;
  active: boolean;
  mustChangePassword?: boolean;
  createdBy?: string;
  /** If set, user can only see these module IDs. Null/empty = all modules. ADMINs always see all. */
  allowed_modules?: string[];
}

interface Tenant {
  id: string;
  name: string;
  plan: 'starter' | 'professional' | 'enterprise';
}

interface AuthContextValue {
  tenant: Tenant;
  currentUser: MaicUser | null;
  users: MaicUser[];
  isAuthenticated: boolean;
  login: (email: string, password: string) => Promise<{ success: boolean; error?: string }>;
  logout: () => void;
  changePassword: (userId: string, newPassword: string) => void;
  addUser: (data: Omit<MaicUser, 'id' | 'createdAt'>) => MaicUser;
  updateUser: (id: string, patch: Partial<MaicUser>) => void;
  deleteUser: (id: string) => void;
}

// ── Constants ─────────────────────────────────────────────────────────────

const AUTH_API = import.meta.env.VITE_AUTH_SERVICE_URL || 'http://localhost:8011';

// ── Role mapping ──────────────────────────────────────────────────────────

function mapRole(role: string): UserRole {
  switch (role) {
    case 'admin': return 'ADMIN';
    case 'analyst': return 'ANALYST';
    case 'viewer': return 'VIEWER';
    default: return 'VIEWER';
  }
}

function mapRoleToApi(role: UserRole): string {
  switch (role) {
    case 'ADMIN': return 'admin';
    case 'DATA_ENGINEER': return 'analyst';
    case 'ANALYST': return 'analyst';
    case 'VIEWER': return 'viewer';
  }
}

function mapApiUser(u: Record<string, unknown>): MaicUser {
  return {
    id: u.id as string,
    name: (u.name as string) || (u.email as string),
    email: u.email as string,
    role: mapRole(u.role as string),
    password: '',
    createdAt: (u.created_at as string) || new Date().toISOString(),
    active: (u.is_active as boolean) ?? true,
    mustChangePassword: false,
  };
}

// ── Auth fetch helper ─────────────────────────────────────────────────────

function authHeaders(json = true): Record<string, string> {
  const token = getAccessToken();
  const tenantId = getTenantId();
  const h: Record<string, string> = { 'x-tenant-id': tenantId };
  if (json) h['Content-Type'] = 'application/json';
  if (token) h['Authorization'] = `Bearer ${token}`;
  return h;
}

async function fetchUsersFromApi(tenantId: string): Promise<MaicUser[]> {
  try {
    const token = getAccessToken();
    const res = await fetch(`${AUTH_API}/auth/users`, {
      headers: {
        'x-tenant-id': tenantId,
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    });
    if (!res.ok) return [];
    const data = await res.json();
    return (data.users || []).map(mapApiUser);
  } catch {
    return [];
  }
}

// ── Context ────────────────────────────────────────────────────────────────

const AuthContext = createContext<AuthContextValue>({
  tenant: { id: 'tenant-001', name: 'maic', plan: 'enterprise' },
  currentUser: null,
  users: [],
  isAuthenticated: false,
  login: async () => ({ success: false }),
  logout: () => {},
  changePassword: () => {},
  addUser: () => ({ id: '', name: '', email: '', role: 'VIEWER', password: '', createdAt: '', active: true }),
  updateUser: () => {},
  deleteUser: () => {},
});

export const TenantProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const authState = useAuthStore();
  const [users, setUsers] = useState<MaicUser[]>([]);
  const [loaded, setLoaded] = useState(false);

  // Derive currentUser from authStore
  const currentUser: MaicUser | null = authState.user
    ? {
        id: authState.user.id,
        name: authState.user.name,
        email: authState.user.email,
        role: mapRole(authState.user.role),
        password: '',
        createdAt: new Date().toISOString(),
        active: true,
        mustChangePassword: false,
      }
    : null;

  const tenantId = authState.user?.tenant_id || 'tenant-001';
  const tenant: Tenant = { id: tenantId, name: tenantId, plan: 'enterprise' };

  // On mount: try to restore session via refresh token cookie
  useEffect(() => {
    authState.refresh().then(() => setLoaded(true));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // When user changes (login → new tenant, or logout), reload users list
  useEffect(() => {
    if (authState.user) {
      fetchUsersFromApi(authState.user.tenant_id).then(setUsers);
    } else {
      setUsers([]);
    }
  }, [authState.user?.tenant_id]); // eslint-disable-line react-hooks/exhaustive-deps

  const login = useCallback(async (email: string, password: string): Promise<{ success: boolean; error?: string }> => {
    try {
      await authState.login(email, password);
      return { success: true };
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Invalid credentials';
      return { success: false, error: msg };
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const logout = useCallback(() => {
    authState.logout();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const changePassword = useCallback((userId: string, newPassword: string) => {
    fetch(`${AUTH_API}/auth/users/${userId}`, {
      method: 'PATCH',
      headers: authHeaders(),
      body: JSON.stringify({ password: newPassword }),
    }).catch(() => {});
    setUsers((prev) => prev.map((u) => u.id === userId ? { ...u, mustChangePassword: false } : u));
  }, []);

  const addUser = useCallback((data: Omit<MaicUser, 'id' | 'createdAt'>): MaicUser => {
    // Optimistic: return immediately so caller can show credentials
    const tempUser: MaicUser = {
      ...data,
      id: `temp-${Date.now()}`,
      createdAt: new Date().toISOString(),
    };
    setUsers((prev) => [...prev, tempUser]);

    // Async: create via auth service and replace temp entry
    fetch(`${AUTH_API}/auth/users`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({
        email: data.email,
        name: data.name,
        role: mapRoleToApi(data.role),
        password: data.password || undefined,
        allowed_modules: data.allowed_modules ?? null,
      }),
    })
      .then((res) => res.json())
      .then((created) => {
        setUsers((prev) => prev.map((u) => u.id === tempUser.id ? mapApiUser(created) : u));
      })
      .catch(() => {
        setUsers((prev) => prev.filter((u) => u.id !== tempUser.id));
      });

    return tempUser;
  }, []);

  const updateUser = useCallback((id: string, patch: Partial<MaicUser>) => {
    setUsers((prev) => prev.map((u) => u.id === id ? { ...u, ...patch } : u));

    const body: Record<string, unknown> = {};
    if (patch.name !== undefined) body.name = patch.name;
    if (patch.role !== undefined) body.role = mapRoleToApi(patch.role as UserRole);
    if (patch.active !== undefined) body.is_active = patch.active;
    if (patch.password) body.password = patch.password;
    if ('allowed_modules' in patch) body.allowed_modules = patch.allowed_modules ?? null;

    fetch(`${AUTH_API}/auth/users/${id}`, {
      method: 'PATCH',
      headers: authHeaders(),
      body: JSON.stringify(body),
    }).catch(() => {
      fetchUsersFromApi(tenantId).then(setUsers);
    });
  }, [tenantId]);

  const deleteUser = useCallback((id: string) => {
    setUsers((prev) => prev.filter((u) => u.id !== id));
    fetch(`${AUTH_API}/auth/users/${id}`, {
      method: 'DELETE',
      headers: authHeaders(false),
    }).catch(() => {
      fetchUsersFromApi(tenantId).then(setUsers);
    });
  }, [tenantId]);

  if (!loaded) return null;

  return (
    <AuthContext.Provider value={{
      tenant,
      currentUser,
      users,
      isAuthenticated: currentUser !== null,
      login,
      logout,
      changePassword,
      addUser,
      updateUser,
      deleteUser,
    }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useTenant = () => useContext(AuthContext);
export const useUser = () => useContext(AuthContext).currentUser;
export const useAuth = () => useContext(AuthContext);

export default AuthContext;
