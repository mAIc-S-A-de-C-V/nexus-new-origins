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

interface AppShellProps {
  children: (page: string) => React.ReactNode;
}

export const AppShell: React.FC<AppShellProps> = ({ children }) => {
  const { currentPage, navigateTo } = useNavigationStore();

  // Mount global keyboard handler
  useGlobalKeyboard();

  return (
    <div style={{
      display: 'flex',
      height: '100vh',
      width: '100vw',
      overflow: 'hidden',
      backgroundColor: 'var(--color-base)',
    }}>
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
  );
};

export default AppShell;
