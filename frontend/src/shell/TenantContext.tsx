import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';

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
  login: (email: string, password: string) => { success: boolean; error?: string };
  logout: () => void;
  changePassword: (userId: string, newPassword: string) => void;
  addUser: (data: Omit<MaicUser, 'id' | 'createdAt'>) => MaicUser;
  updateUser: (id: string, patch: Partial<MaicUser>) => void;
  deleteUser: (id: string) => void;
}

// ── Constants ─────────────────────────────────────────────────────────────

const SESSION_KEY = 'maic_session';
const PM_API = (import.meta.env.VITE_PROJECT_MGMT_URL || 'http://localhost:9000');
const TENANT_ID = 'tenant-001';
const H = { 'Content-Type': 'application/json', 'x-tenant-id': TENANT_ID };

const DEFAULT_ADMIN: MaicUser = {
  id: 'user-001',
  name: 'Admin',
  email: 'admin@maic.ai',
  role: 'ADMIN',
  password: 'admin',
  createdAt: new Date().toISOString(),
  active: true,
  mustChangePassword: false,
};

// ── Backend sync helpers ──────────────────────────────────────────────────

async function fetchUsersFromBackend(): Promise<MaicUser[]> {
  try {
    const res = await fetch(`${PM_API}/projects/users`, { headers: H });
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data) ? data as MaicUser[] : [];
  } catch {
    return [];
  }
}

async function saveUserToBackend(user: MaicUser): Promise<void> {
  try {
    await fetch(`${PM_API}/projects/users`, {
      method: 'POST',
      headers: H,
      body: JSON.stringify(user),
    });
  } catch { /* ignore */ }
}

async function deleteUserFromBackend(id: string): Promise<void> {
  try {
    await fetch(`${PM_API}/projects/users/${id}`, { method: 'DELETE', headers: H });
  } catch { /* ignore */ }
}

// ── Context ────────────────────────────────────────────────────────────────

const AuthContext = createContext<AuthContextValue>({
  tenant: { id: 'tenant-001', name: 'maic', plan: 'enterprise' },
  currentUser: null,
  users: [],
  isAuthenticated: false,
  login: () => ({ success: false }),
  logout: () => {},
  changePassword: () => {},
  addUser: () => DEFAULT_ADMIN,
  updateUser: () => {},
  deleteUser: () => {},
});

export const TenantProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [users, setUsers] = useState<MaicUser[]>([DEFAULT_ADMIN]);
  const [currentUser, setCurrentUser] = useState<MaicUser | null>(null);
  const [loaded, setLoaded] = useState(false);

  // On mount: load users from backend, fall back to default admin
  useEffect(() => {
    fetchUsersFromBackend().then(async (backendUsers) => {
      let resolved: MaicUser[];
      if (backendUsers.length === 0) {
        // First boot — seed the admin into backend
        await saveUserToBackend(DEFAULT_ADMIN);
        resolved = [DEFAULT_ADMIN];
      } else {
        resolved = backendUsers;
      }
      setUsers(resolved);

      // Restore session
      try {
        const id = localStorage.getItem(SESSION_KEY);
        if (id) {
          const user = resolved.find((u) => u.id === id && u.active);
          if (user) setCurrentUser(user);
        }
      } catch { /* ignore */ }

      setLoaded(true);
    });
  }, []);

  const login = useCallback((email: string, password: string): { success: boolean; error?: string } => {
    const user = users.find(
      (u) => u.email.toLowerCase() === email.toLowerCase() && u.password === password && u.active,
    );
    if (!user) return { success: false, error: 'Invalid credentials' };
    localStorage.setItem(SESSION_KEY, user.id);
    setCurrentUser(user);
    return { success: true };
  }, [users]);

  const logout = useCallback(() => {
    localStorage.removeItem(SESSION_KEY);
    setCurrentUser(null);
  }, []);

  const changePassword = useCallback((userId: string, newPassword: string) => {
    setUsers((prev) => {
      const next = prev.map((u) =>
        u.id === userId ? { ...u, password: newPassword, mustChangePassword: false } : u,
      );
      const updated = next.find((u) => u.id === userId);
      if (updated) saveUserToBackend(updated);
      return next;
    });
    setCurrentUser((prev) =>
      prev && prev.id === userId ? { ...prev, password: newPassword, mustChangePassword: false } : prev,
    );
  }, []);

  const addUser = useCallback((data: Omit<MaicUser, 'id' | 'createdAt'>): MaicUser => {
    const user: MaicUser = {
      ...data,
      id: `user-${Date.now()}`,
      createdAt: new Date().toISOString(),
    };
    setUsers((prev) => [...prev, user]);
    saveUserToBackend(user);
    return user;
  }, []);

  const updateUser = useCallback((id: string, patch: Partial<MaicUser>) => {
    setUsers((prev) => {
      const next = prev.map((u) => (u.id === id ? { ...u, ...patch } : u));
      const updated = next.find((u) => u.id === id);
      if (updated) saveUserToBackend(updated);
      return next;
    });
    if (currentUser?.id === id) {
      setCurrentUser((prev) => (prev ? { ...prev, ...patch } : prev));
    }
  }, [currentUser?.id]);

  const deleteUser = useCallback((id: string) => {
    setUsers((prev) => prev.filter((u) => u.id !== id));
    deleteUserFromBackend(id);
  }, []);

  // Don't render until users are loaded (avoids flash of login for valid sessions)
  if (!loaded) return null;

  return (
    <AuthContext.Provider value={{
      tenant: { id: 'tenant-001', name: 'maic', plan: 'enterprise' },
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
