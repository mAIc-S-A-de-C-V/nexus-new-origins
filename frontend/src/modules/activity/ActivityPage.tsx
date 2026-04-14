import React, { useState } from 'react';
import { Activity, ScrollText, ScanSearch } from 'lucide-react';

// Lazy-load the sub-pages to avoid bundling everything upfront
const EventLog     = React.lazy(() => import('../events/EventLog'));
const AuditLogPage = React.lazy(() => import('../audit/AuditLogPage'));
const ProcessMining = React.lazy(() => import('../process/ProcessMining'));

type Tab = 'events' | 'audit' | 'process';

const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
  { id: 'events',  label: 'Event Log',      icon: <Activity size={13} /> },
  { id: 'audit',   label: 'Audit Log',      icon: <ScrollText size={13} /> },
  { id: 'process', label: 'Process Mining', icon: <ScanSearch size={13} /> },
];

const ActivityPage: React.FC = () => {
  const [tab, setTab] = useState<Tab>('events');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* Tab bar */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 0,
        borderBottom: '1px solid #E2E8F0',
        backgroundColor: '#FFFFFF',
        flexShrink: 0,
        padding: '0 16px',
      }}>
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '10px 14px',
              fontSize: 13,
              border: 'none',
              cursor: 'pointer',
              backgroundColor: 'transparent',
              fontWeight: tab === t.id ? 500 : 400,
              color: tab === t.id ? '#2563EB' : '#64748B',
              borderBottom: tab === t.id ? '2px solid #2563EB' : '2px solid transparent',
              transition: 'color 80ms',
              whiteSpace: 'nowrap',
            }}
          >
            {t.icon}
            {t.label}
          </button>
        ))}
      </div>

      {/* Content — fill remaining height */}
      <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        <React.Suspense fallback={<div style={{ padding: 32, textAlign: 'center', color: '#94A3B8', fontSize: 13 }}>Loading...</div>}>
          {tab === 'events'  && <EventLog />}
          {tab === 'audit'   && <AuditLogPage />}
          {tab === 'process' && <ProcessMining />}
        </React.Suspense>
      </div>
    </div>
  );
};

export default ActivityPage;
