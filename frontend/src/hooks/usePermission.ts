/**
 * Role-based permission hook.
 *
 * Works with both the existing TenantContext (current) and the new authStore (future).
 * Priority: new authStore user → fall back to TenantContext user.
 *
 * Roles (new auth service): admin > analyst > viewer
 * Roles (existing TenantContext): ADMIN > DATA_ENGINEER > ANALYST > VIEWER
 *
 * Usage:
 *   const can = usePermission();
 *   if (can.write) { ... }
 *   if (can.admin) { ... }
 */
import { useAuth } from '../shell/TenantContext';
import { useAuthStore } from '../store/authStore';

type Permission = {
  /** Can read/view all data */
  read: boolean;
  /** Can create/edit/run pipelines, configure connectors, manage alert rules */
  write: boolean;
  /** Full admin: user management, delete, system config */
  admin: boolean;
  /** Current role string for display */
  role: string;
};

export function usePermission(): Permission {
  // New auth store (RS256 JWT from auth-service)
  const { user: newUser } = useAuthStore();
  // Existing TenantContext (legacy local auth)
  const { currentUser } = useAuth();

  if (newUser) {
    const role = newUser.role;
    return {
      read: true,
      write: role === 'admin' || role === 'analyst',
      admin: role === 'admin',
      role,
    };
  }

  if (currentUser) {
    const role = currentUser.role;
    const isAdmin = role === 'ADMIN';
    const isAnalyst = role === 'ANALYST' || role === 'DATA_ENGINEER';
    return {
      read: true,
      write: isAdmin || isAnalyst,
      admin: isAdmin,
      role: role.toLowerCase(),
    };
  }

  return { read: false, write: false, admin: false, role: 'unauthenticated' };
}
