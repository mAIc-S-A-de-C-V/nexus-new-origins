import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';

// ── Types ──────────────────────────────────────────────────────────────────

export type UserRole = 'ADMIN' | 'DATA_ENGINEER' | 'ANALYST' | 'VIEWER';

export interface MaicUser {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  password: string; // stored locally — prototype only
  createdAt: string;
  active: boolean;
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
  addUser: (data: Omit<MaicUser, 'id' | 'createdAt'>) => MaicUser;
  updateUser: (id: string, patch: Partial<MaicUser>) => void;
  deleteUser: (id: string) => void;
}

// ── Storage helpers ────────────────────────────────────────────────────────

const USERS_KEY = 'maic_users';
const SESSION_KEY = 'maic_session';

const DEFAULT_ADMIN: MaicUser = {
  id: 'user-001',
  name: 'Admin',
  email: 'admin@maic.ai',
  role: 'ADMIN',
  password: 'admin',
  createdAt: new Date().toISOString(),
  active: true,
};

function loadUsers(): MaicUser[] {
  try {
    const raw = localStorage.getItem(USERS_KEY);
    if (raw) return JSON.parse(raw) as MaicUser[];
  } catch { /* ignore */ }
  // Seed default admin on first run
  const seed = [DEFAULT_ADMIN];
  localStorage.setItem(USERS_KEY, JSON.stringify(seed));
  return seed;
}

function saveUsers(users: MaicUser[]) {
  localStorage.setItem(USERS_KEY, JSON.stringify(users));
}

function loadSession(users: MaicUser[]): MaicUser | null {
  try {
    const id = localStorage.getItem(SESSION_KEY);
    if (id) return users.find((u) => u.id === id && u.active) ?? null;
  } catch { /* ignore */ }
  return null;
}

// ── Context ────────────────────────────────────────────────────────────────

const AuthContext = createContext<AuthContextValue>({
  tenant: { id: 'tenant-001', name: 'maic', plan: 'enterprise' },
  currentUser: null,
  users: [],
  isAuthenticated: false,
  login: () => ({ success: false }),
  logout: () => {},
  addUser: () => DEFAULT_ADMIN,
  updateUser: () => {},
  deleteUser: () => {},
});

export const TenantProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [users, setUsers] = useState<MaicUser[]>(() => loadUsers());
  const [currentUser, setCurrentUser] = useState<MaicUser | null>(() => loadSession(loadUsers()));

  // Keep users in sync with localStorage
  useEffect(() => {
    saveUsers(users);
  }, [users]);

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

  const addUser = useCallback((data: Omit<MaicUser, 'id' | 'createdAt'>): MaicUser => {
    const user: MaicUser = {
      ...data,
      id: `user-${Date.now()}`,
      createdAt: new Date().toISOString(),
    };
    setUsers((prev) => [...prev, user]);
    return user;
  }, []);

  const updateUser = useCallback((id: string, patch: Partial<MaicUser>) => {
    setUsers((prev) => prev.map((u) => (u.id === id ? { ...u, ...patch } : u)));
    // Keep current user in sync
    if (currentUser?.id === id) {
      setCurrentUser((prev) => (prev ? { ...prev, ...patch } : prev));
    }
  }, [currentUser?.id]);

  const deleteUser = useCallback((id: string) => {
    setUsers((prev) => prev.filter((u) => u.id !== id));
  }, []);

  return (
    <AuthContext.Provider value={{
      tenant: { id: 'tenant-001', name: 'maic', plan: 'enterprise' },
      currentUser,
      users,
      isAuthenticated: currentUser !== null,
      login,
      logout,
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
