import React, { Suspense, lazy, useEffect } from 'react';
import { AppShell } from './shell/AppShell';
import { TenantProvider, useAuth } from './shell/TenantContext';
import LoginPage from './pages/LoginPage';
import ChangePasswordPage from './pages/ChangePasswordPage';
import SSOCallbackPage from './pages/SSOCallbackPage';

const ConnectorGrid   = lazy(() => import('./modules/connectors/ConnectorGrid'));
const OntologyGraph   = lazy(() => import('./modules/ontology/OntologyGraph'));
const PipelineBuilder = lazy(() => import('./modules/pipeline/PipelineBuilder'));
const LineageCanvas   = lazy(() => import('./modules/lineage/LineageCanvas'));
const EventLog        = lazy(() => import('./modules/events/EventLog'));
const ProcessMining   = lazy(() => import('./modules/process/ProcessMining'));
const AppsPage        = lazy(() => import('./modules/apps/AppsPage'));
const ProjectsModule  = lazy(() => import('./modules/projects/ProjectsModule'));
const FinanceModule   = lazy(() => import('./modules/finance/FinanceModule'));
const UsersPage       = lazy(() => import('./modules/users/UsersPage'));
const LogicStudio     = lazy(() => import('./modules/logic/LogicStudio'));
const AgentStudio     = lazy(() => import('./modules/agents/AgentStudio'));
const HumanActions    = lazy(() => import('./modules/agents/HumanActions'));

const LoadingSpinner: React.FC<{ message?: string }> = ({ message = 'Loading...' }) => (
  <div style={{
    display: 'flex', flexDirection: 'column', alignItems: 'center',
    justifyContent: 'center', height: '100%', gap: 12, color: '#475569',
    backgroundColor: '#F8FAFC',
  }}>
    <div style={{
      width: 20, height: 20, border: '2px solid #E2E8F0',
      borderTopColor: '#7C3AED', borderRadius: '50%',
      animation: 'spin 0.6s linear infinite',
    }} />
    <span style={{ fontSize: 12, letterSpacing: '0.04em' }}>{message}</span>
    <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
  </div>
);

const ComingSoonPage: React.FC<{ title: string }> = ({ title }) => (
  <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
    <div style={{
      height: 52, backgroundColor: '#fff', borderBottom: '1px solid #E2E8F0',
      display: 'flex', alignItems: 'center', padding: '0 24px', gap: 10,
    }}>
      <h1 style={{ fontSize: 15, fontWeight: 600, color: '#0D1117', margin: 0 }}>{title}</h1>
      <span style={{
        fontSize: 10, backgroundColor: '#F1F5F9', color: '#64748B',
        padding: '2px 8px', fontWeight: 600, letterSpacing: '0.06em',
      }}>
        COMING SOON
      </span>
    </div>
    <div style={{
      flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center',
      justifyContent: 'center', gap: 8, color: '#94A3B8',
    }}>
      <div style={{ fontSize: 13, fontWeight: 500 }}>This module is under construction</div>
      <div style={{ fontSize: 12 }}>Check back soon</div>
    </div>
  </div>
);

const renderPage = (page: string): React.ReactNode => {
  if (page.startsWith('app-')) {
    return (
      <Suspense fallback={<LoadingSpinner message="Loading app..." />}>
        <AppsPage />
      </Suspense>
    );
  }
  switch (page) {
    case 'connectors':
      return <Suspense fallback={<LoadingSpinner message="Loading connectors..." />}><ConnectorGrid /></Suspense>;
    case 'ontology':
      return <Suspense fallback={<LoadingSpinner message="Loading ontology..." />}><OntologyGraph /></Suspense>;
    case 'pipelines':
      return <Suspense fallback={<LoadingSpinner message="Loading pipelines..." />}><PipelineBuilder /></Suspense>;
    case 'lineage':
      return <Suspense fallback={<LoadingSpinner message="Loading lineage..." />}><LineageCanvas /></Suspense>;
    case 'events':
      return <Suspense fallback={<LoadingSpinner message="Loading event log..." />}><EventLog /></Suspense>;
    case 'apps':
      return <Suspense fallback={<LoadingSpinner message="Loading apps..." />}><AppsPage /></Suspense>;
    case 'projects':
      return <Suspense fallback={<LoadingSpinner message="Loading projects..." />}><ProjectsModule /></Suspense>;
    case 'finance':
      return <Suspense fallback={<LoadingSpinner message="Loading finance..." />}><FinanceModule /></Suspense>;
    case 'users':
      return <Suspense fallback={<LoadingSpinner message="Loading users..." />}><UsersPage /></Suspense>;
    case 'process':
      return <Suspense fallback={<LoadingSpinner message="Loading process mining..." />}><ProcessMining /></Suspense>;
    case 'logic':
      return <Suspense fallback={<LoadingSpinner message="Loading Logic Studio..." />}><LogicStudio /></Suspense>;
    case 'agents':
      return <Suspense fallback={<LoadingSpinner message="Loading Agent Studio..." />}><AgentStudio /></Suspense>;
    case 'human-actions':
      return <Suspense fallback={<LoadingSpinner message="Loading actions..." />}><HumanActions /></Suspense>;
    case 'settings':
      return <ComingSoonPage title="Settings" />;
    default:
      return <Suspense fallback={<LoadingSpinner />}><ConnectorGrid /></Suspense>;
  }
};

// ── Auth gate ──────────────────────────────────────────────────────────────

const AuthGate: React.FC = () => {
  const { isAuthenticated, currentUser } = useAuth();

  // Handle SSO callback URL (/auth/callback?token=...)
  if (window.location.pathname === '/auth/callback') {
    return <SSOCallbackPage />;
  }

  if (!isAuthenticated) return <LoginPage />;
  if (currentUser?.mustChangePassword) return <ChangePasswordPage />;

  return (
    <AppShell>
      {(page) => renderPage(page)}
    </AppShell>
  );
};

// ── App ────────────────────────────────────────────────────────────────────

function App() {
  return (
    <TenantProvider>
      <AuthGate />
    </TenantProvider>
  );
}

export default App;
