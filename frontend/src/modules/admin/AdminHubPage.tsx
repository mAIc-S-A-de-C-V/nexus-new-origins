import React, { useState } from 'react';
import { Users, Building2 } from 'lucide-react';

const UsersPage        = React.lazy(() => import('../users/UsersPage'));
const AdminConsolePage = React.lazy(() => import('./AdminConsolePage'));

type Tab = 'users' | 'tenants';

const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
  { id: 'users',   label: 'Users',   icon: <Users size={13} /> },
  { id: 'tenants', label: 'Tenants', icon: <Building2 size={13} /> },
];

const AdminHubPage: React.FC = () => {
  const [tab, setTab] = useState<Tab>('users');

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
          {tab === 'users'   && <UsersPage />}
          {tab === 'tenants' && <AdminConsolePage />}
        </React.Suspense>
      </div>
    </div>
  );
};

export default AdminHubPage;
