/**
 * Role-based permission hook.
 *
 * Wired to the authStore (JWT from auth-service).
 * Falls back to safe defaults when no user is present.
 *
 * Roles: admin > analyst > viewer
 *
 * Usage:
 *   const { canWrite, isAdmin, canAccess } = usePermission();
 *   if (canWrite) { ... }
 *   if (canAccess('connectors')) { ... }
 */
import { useAuthStore } from '../store/authStore';

export function usePermission() {
  const user = useAuthStore((s) => s.user);
  const role = user?.role ?? 'viewer';
  const modules = user?.modules ?? [];  // empty = access to ALL (backward compat)

  return {
    isSuperAdmin: role === 'superadmin',
    isAdmin: role === 'admin' || role === 'superadmin',
    canWrite: role === 'admin' || role === 'superadmin' || role === 'analyst',
    canDelete: role === 'admin' || role === 'superadmin',
    canRead: true,
    // Module access: if modules array is empty, allow all (default for existing users)
    canAccess: (module: string) => modules.length === 0 || modules.includes(module),
    role,
    modules,
  };
}
