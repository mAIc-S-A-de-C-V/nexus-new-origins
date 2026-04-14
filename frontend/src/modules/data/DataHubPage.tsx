import React, { useState } from 'react';
import { BarChart3, ShieldCheck } from 'lucide-react';

const DataExplorer    = React.lazy(() => import('../explorer/DataExplorer'));
const DataQualityPage = React.lazy(() => import('../quality/DataQualityPage'));

type Tab = 'explorer' | 'quality';

const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
  { id: 'explorer', label: 'Data Explorer', icon: <BarChart3 size={13} /> },
  { id: 'quality',  label: 'Data Quality',  icon: <ShieldCheck size={13} /> },
];

const DataHubPage: React.FC = () => {
  const [tab, setTab] = useState<Tab>('explorer');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      <div style={{
        display: 'flex', alignItems: 'center',
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
            }}
          >
            {t.icon}
            {t.label}
          </button>
        ))}
      </div>
      <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        <React.Suspense fallback={<div style={{ padding: 32, textAlign: 'center', color: '#94A3B8', fontSize: 13 }}>Loading...</div>}>
          {tab === 'explorer' && <DataExplorer />}
          {tab === 'quality'  && <DataQualityPage />}
        </React.Suspense>
      </div>
    </div>
  );
};

export default DataHubPage;
