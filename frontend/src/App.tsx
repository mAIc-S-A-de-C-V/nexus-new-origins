import React, { Suspense, lazy, useEffect } from 'react';
import { AppShell } from './shell/AppShell';
import { TenantProvider, useAuth } from './shell/TenantContext';
import LoginPage from './pages/LoginPage';
import ChangePasswordPage from './pages/ChangePasswordPage';
import SSOCallbackPage from './pages/SSOCallbackPage';
import { useUiStore } from './store/uiStore';
import { SearchModal } from './shell/SearchModal';

const ConnectorGrid   = lazy(() => import('./modules/connectors/ConnectorGrid'));
const OntologyGraph   = lazy(() => import('./modules/ontology/OntologyGraph'));
const PipelineBuilder = lazy(() => import('./modules/pipeline/PipelineBuilder'));
const AppsPage        = lazy(() => import('./modules/apps/AppsPage'));
const WorkbenchPage   = lazy(() => import('./modules/workbench/WorkbenchPage'));
const ProjectsModule  = lazy(() => import('./modules/projects/ProjectsModule'));
const FinanceModule   = lazy(() => import('./modules/finance/FinanceModule'));
const LogicStudio     = lazy(() => import('./modules/logic/LogicStudio'));
const AgentStudio     = lazy(() => import('./modules/agents/AgentStudio'));
const HumanActions    = lazy(() => import('./modules/agents/HumanActions'));
const UtilitiesPage   = lazy(() => import('./modules/utilities/UtilitiesPage'));
const SettingsPage    = lazy(() => import('./modules/settings/SettingsPage'));
const EvalsPage       = lazy(() => import('./modules/evals/EvalsPage'));
const ActivityPage    = lazy(() => import('./modules/activity/ActivityPage'));
const DataHubPage     = lazy(() => import('./modules/data/DataHubPage'));
const AdminHubPage    = lazy(() => import('./modules/admin/AdminHubPage'));
const ValuePage       = lazy(() => import('./modules/value/ValuePage'));
const SuperAdminPage  = lazy(() => import('./modules/superadmin/SuperAdminPage'));
const ProcessMiningV2 = lazy(() => import('./modules/process_v2/ProcessMiningV2'));
const OperationsModule = lazy(() => import('./modules/operations/OperationsModule'));
const SharePage       = lazy(() => import('./modules/share/SharePage'));

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
    case 'graph':
      return <Suspense fallback={<LoadingSpinner message="Loading ontology..." />}><OntologyGraph /></Suspense>;
    case 'pipelines':
      return <Suspense fallback={<LoadingSpinner message="Loading pipelines..." />}><PipelineBuilder /></Suspense>;
    case 'apps':
    case 'apps-app':
      return <Suspense fallback={<LoadingSpinner message="Loading apps..." />}><AppsPage /></Suspense>;
    case 'workbench':
      return <Suspense fallback={<LoadingSpinner message="Loading workbench..." />}><WorkbenchPage /></Suspense>;
    case 'projects':
      return <Suspense fallback={<LoadingSpinner message="Loading projects..." />}><ProjectsModule /></Suspense>;
    case 'finance':
      return <Suspense fallback={<LoadingSpinner message="Loading finance..." />}><FinanceModule /></Suspense>;
    case 'logic':
      return <Suspense fallback={<LoadingSpinner message="Loading Logic Studio..." />}><LogicStudio /></Suspense>;
    case 'agents':
      return <Suspense fallback={<LoadingSpinner message="Loading Agent Studio..." />}><AgentStudio /></Suspense>;
    case 'human-actions':
      return <Suspense fallback={<LoadingSpinner message="Loading actions..." />}><HumanActions /></Suspense>;
    case 'utilities':
      return <Suspense fallback={<LoadingSpinner message="Loading utilities..." />}><UtilitiesPage /></Suspense>;
    case 'settings':
      return <Suspense fallback={<LoadingSpinner message="Loading settings..." />}><SettingsPage /></Suspense>;
    case 'evals':
      return <Suspense fallback={<LoadingSpinner message="Loading Evals..." />}><EvalsPage /></Suspense>;
    case 'value':
      return <Suspense fallback={<LoadingSpinner message="Loading Value Monitor..." />}><ValuePage /></Suspense>;
    case 'activity':
      return <Suspense fallback={<LoadingSpinner message="Loading Activity..." />}><ActivityPage /></Suspense>;
    case 'operations':
      return <Suspense fallback={<LoadingSpinner message="Loading Operations..." />}><OperationsModule /></Suspense>;
    case 'data':
      return <Suspense fallback={<LoadingSpinner message="Loading Data..." />}><DataHubPage /></Suspense>;
    case 'admin':
      return <Suspense fallback={<LoadingSpinner message="Loading Admin..." />}><AdminHubPage /></Suspense>;
    case 'platform':
      return <Suspense fallback={<LoadingSpinner message="Loading Platform..." />}><SuperAdminPage /></Suspense>;
    default:
      return <Suspense fallback={<LoadingSpinner />}><ConnectorGrid /></Suspense>;
  }
};

// ── Theme + density sync ───────────────────────────────────────────────────

const ThemeSync: React.FC = () => {
  const { theme, density } = useUiStore();
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);
  useEffect(() => {
    document.documentElement.setAttribute('data-density', density);
  }, [density]);
  return null;
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

  // Hidden route: object-centric process mining v2. Not linked from nav —
  // accessible only by typing /pminingv2 in the URL bar.
  if (window.location.pathname === '/pminingv2') {
    return (
      <Suspense fallback={<LoadingSpinner message="Loading Process Mining v2..." />}>
        <ProcessMiningV2 />
      </Suspense>
    );
  }

  return (
    <>
      <SearchModal />
      <AppShell>
        {(page) => renderPage(page)}
      </AppShell>
    </>
  );
};

// ── App ────────────────────────────────────────────────────────────────────

function App() {
  // Public share viewer — no tenant context, no auth gate. Token in the URL
  // is the credential. Path takes the form /s/<token>.
  if (window.location.pathname.startsWith('/s/')) {
    return (
      <Suspense fallback={<LoadingSpinner message="Loading…" />}>
        <SharePage />
      </Suspense>
    );
  }
  return (
    <TenantProvider>
      <ThemeSync />
      <AuthGate />
    </TenantProvider>
  );
}

export default App;
