import React from 'react';
import NavRail from './NavRail';
import { NotificationBell } from './NotificationBell';
import NexusAssistant from './NexusAssistant';
import { CommandPalette } from './CommandPalette';
import { ObjectContextPanel } from './ObjectContextPanel';
import { Breadcrumb } from '../design-system/components/Breadcrumb';
import { ThemeToggle } from '../design-system/components/ThemeToggle';
import { useNavigationStore } from '../store/navigationStore';
import { useGlobalKeyboard } from '../hooks/useGlobalKeyboard';
import { useAuthStore } from '../store/authStore';

interface AppShellProps {
  children: (page: string) => React.ReactNode;
}

const ImpersonationBanner: React.FC = () => {
  const user = useAuthStore(s => s.user);
  if (!user?.impersonated_by) return null;

  const exitImpersonation = () => {
    sessionStorage.removeItem('_nexus_impersonation_token');
    sessionStorage.removeItem('_nexus_original_token');
    window.location.reload();
  };

  return (
    <>
      <style>{`@keyframes impersonatePulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.7; } }`}</style>
      <div style={{
        backgroundColor: '#DC2626', color: '#fff', padding: '6px 16px',
        fontSize: 12, display: 'flex',
        alignItems: 'center', justifyContent: 'center', gap: 12,
        fontWeight: 500, animation: 'impersonatePulse 2s ease-in-out infinite',
        borderBottom: '2px solid #991B1B',
      }}>
        <span style={{
          backgroundColor: '#fff', color: '#DC2626', padding: '1px 8px',
          borderRadius: 10, fontSize: 10, fontWeight: 700, letterSpacing: '0.05em',
        }}>
          IMPERSONATING
        </span>
        <span>{user.name} ({user.email}) in {user.tenant_id}</span>
        <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.7)' }}>
          by {user.impersonated_by}
        </span>
        <button
          onClick={exitImpersonation}
          style={{
            background: '#fff', border: 'none',
            color: '#DC2626', padding: '3px 14px', borderRadius: 4, fontSize: 11,
            cursor: 'pointer', fontWeight: 700, marginLeft: 8,
          }}
        >
          Exit Impersonation
        </button>
      </div>
    </>
  );
};

export const AppShell: React.FC<AppShellProps> = ({ children }) => {
  const { currentPage, navigateTo } = useNavigationStore();

  // Mount global keyboard handler
  useGlobalKeyboard();

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      height: '100vh',
      width: '100vw',
      overflow: 'hidden',
      backgroundColor: 'var(--color-base)',
    }}>
      <ImpersonationBanner />
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
      <NavRail currentPage={currentPage} onNavigate={(page) => navigateTo(page)} />

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0 }}>
        {/* Breadcrumb bar */}
        <Breadcrumb />

        <main style={{
          flex: 1,
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          minWidth: 0,
        }}>
          {children(currentPage)}
        </main>
      </div>

      {/* Nexus Assistant — right-side panel */}
      <NexusAssistant />

      {/* Object context panel */}
      <ObjectContextPanel />

      {/* Global command palette — Cmd+K */}
      <CommandPalette />

    </div>
    </div>
  );
};

export default AppShell;
