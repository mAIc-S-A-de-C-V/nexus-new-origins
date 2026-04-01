import React from 'react';
import NavRail from './NavRail';
import { NotificationBell } from './NotificationBell';
import NexusAssistant from './NexusAssistant';
import { useNavigationStore } from '../store/navigationStore';

interface AppShellProps {
  children: (page: string) => React.ReactNode;
}

export const AppShell: React.FC<AppShellProps> = ({ children }) => {
  const { currentPage, navigateTo } = useNavigationStore();

  return (
    <div style={{
      display: 'flex',
      height: '100vh',
      width: '100vw',
      overflow: 'hidden',
      backgroundColor: 'var(--color-base)',
    }}>
      <NavRail currentPage={currentPage} onNavigate={(page) => navigateTo(page)} />
      <main style={{
        flex: 1,
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        minWidth: 0,
      }}>
        {children(currentPage)}
      </main>

      {/* Global notification bell — fixed top-right */}
      <div style={{
        position: 'fixed',
        top: 10, right: 14,
        zIndex: 100,
      }}>
        <NotificationBell />
      </div>

      {/* Nexus Assistant — right-side panel */}
      <NexusAssistant />
    </div>
  );
};

export default AppShell;
