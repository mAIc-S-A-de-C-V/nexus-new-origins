import React, { Suspense, lazy } from 'react';
import { AppShell } from './shell/AppShell';

const ConnectorGrid = lazy(() => import('./modules/connectors/ConnectorGrid'));
const OntologyGraph = lazy(() => import('./modules/ontology/OntologyGraph'));
const PipelineBuilder = lazy(() => import('./modules/pipeline/PipelineBuilder'));
const LineageCanvas = lazy(() => import('./modules/lineage/LineageCanvas'));
const EventLog = lazy(() => import('./modules/events/EventLog'));
const AppsPage = lazy(() => import('./modules/apps/AppsPage'));

const LoadingSpinner: React.FC<{ message?: string }> = ({ message = 'Loading...' }) => (
  <div style={{
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    height: '100%',
    gap: '12px',
    color: '#94A3B8',
  }}>
    <div style={{
      width: 24,
      height: 24,
      border: '2px solid #E2E8F0',
      borderTopColor: '#2563EB',
      borderRadius: '50%',
      animation: 'spin 0.6s linear infinite',
    }} />
    <span style={{ fontSize: '13px' }}>{message}</span>
    <style>{`
      @keyframes spin {
        to { transform: rotate(360deg); }
      }
    `}</style>
  </div>
);

const ComingSoonPage: React.FC<{ title: string }> = ({ title }) => (
  <div style={{
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
  }}>
    <div style={{
      height: 52,
      backgroundColor: '#FFFFFF',
      borderBottom: '1px solid #E2E8F0',
      display: 'flex',
      alignItems: 'center',
      padding: '0 24px',
      gap: '10px',
    }}>
      <h1 style={{ fontSize: '16px', fontWeight: 500, color: '#0D1117' }}>{title}</h1>
      <span style={{
        fontSize: '11px',
        backgroundColor: '#F1F5F9',
        color: '#64748B',
        padding: '2px 8px',
        borderRadius: '2px',
        fontWeight: 500,
      }}>
        Coming Soon
      </span>
    </div>
    <div style={{
      flex: 1,
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      gap: '8px',
      color: '#94A3B8',
    }}>
      <div style={{ fontSize: '14px', fontWeight: 500 }}>This module is under construction</div>
      <div style={{ fontSize: '12px' }}>Check back soon for updates</div>
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
      return (
        <Suspense fallback={<LoadingSpinner message="Loading connectors..." />}>
          <ConnectorGrid />
        </Suspense>
      );
    case 'ontology':
      return (
        <Suspense fallback={<LoadingSpinner message="Loading ontology graph..." />}>
          <OntologyGraph />
        </Suspense>
      );
    case 'pipelines':
      return (
        <Suspense fallback={<LoadingSpinner message="Loading pipeline builder..." />}>
          <PipelineBuilder />
        </Suspense>
      );
    case 'lineage':
      return (
        <Suspense fallback={<LoadingSpinner message="Loading lineage..." />}>
          <LineageCanvas />
        </Suspense>
      );
    case 'events':
      return (
        <Suspense fallback={<LoadingSpinner message="Loading event log..." />}>
          <EventLog />
        </Suspense>
      );
    case 'apps':
      return (
        <Suspense fallback={<LoadingSpinner message="Loading apps..." />}>
          <AppsPage />
        </Suspense>
      );
    case 'settings':
      return <ComingSoonPage title="Settings" />;
    default:
      return (
        <Suspense fallback={<LoadingSpinner />}>
          <ConnectorGrid />
        </Suspense>
      );
  }
};

function App() {
  return (
    <AppShell>
      {(page) => renderPage(page)}
    </AppShell>
  );
}

export default App;
