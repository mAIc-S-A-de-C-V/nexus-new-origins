import React, { useState, useEffect } from 'react';
import { useOntologyStore } from '../../store/ontologyStore';
import { useProcessStore } from '../../store/processStore';
import { ProcessMap } from './ProcessMap';
import { VariantExplorer } from './VariantExplorer';
import { CaseBrowser } from './CaseBrowser';

type TabId = 'map' | 'variants' | 'cases';

const TABS: { id: TabId; label: string }[] = [
  { id: 'map', label: 'Process Map' },
  { id: 'variants', label: 'Variants' },
  { id: 'cases', label: 'Cases' },
];

const StatCard: React.FC<{ label: string; value: string | number; sub?: string; alert?: boolean }> = ({ label, value, sub, alert }) => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
    <div style={{ fontSize: 18, fontWeight: 700, color: alert ? '#DC2626' : '#0D1117', fontFamily: 'var(--font-mono)', lineHeight: 1 }}>
      {value}
    </div>
    <div style={{ fontSize: 10, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</div>
    {sub && <div style={{ fontSize: 10, color: '#64748B' }}>{sub}</div>}
  </div>
);

export const ProcessMining: React.FC = () => {
  const { objectTypes, fetchObjectTypes } = useOntologyStore();
  const { stats, fetchStats, fetchCases, fetchVariants, fetchTransitions } = useProcessStore();
  const [activeTab, setActiveTab] = useState<TabId>('map');
  const [selectedOtId, setSelectedOtId] = useState('');
  const [selectedVariantId, setSelectedVariantId] = useState<string | undefined>();

  useEffect(() => {
    fetchObjectTypes();
  }, []);

  useEffect(() => {
    if (objectTypes.length && !selectedOtId) {
      setSelectedOtId(objectTypes[0].id);
    }
  }, [objectTypes]);

  useEffect(() => {
    if (selectedOtId) {
      fetchStats(selectedOtId);
      fetchTransitions(selectedOtId);
      fetchVariants(selectedOtId);
      fetchCases(selectedOtId);
    }
  }, [selectedOtId]);

  const selectedOt = objectTypes.find(o => o.id === selectedOtId);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden', backgroundColor: '#FFFFFF' }}>
      {/* Header */}
      <div style={{
        height: 52, backgroundColor: '#FFFFFF', borderBottom: '1px solid #E2E8F0',
        display: 'flex', alignItems: 'center', padding: '0 16px', gap: 16, flexShrink: 0,
      }}>
        <h1 style={{ fontSize: 16, fontWeight: 500, color: '#0D1117', margin: 0 }}>Process Mining</h1>

        {/* Object type selector */}
        <select
          value={selectedOtId}
          onChange={e => { setSelectedOtId(e.target.value); setSelectedVariantId(undefined); }}
          style={{
            height: 28, padding: '0 28px 0 10px', borderRadius: 4, border: '1px solid #E2E8F0',
            backgroundColor: '#FFFFFF', color: '#0D1117', fontSize: 12, fontWeight: 500,
            cursor: 'pointer', outline: 'none', appearance: 'none',
            backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'%3E%3Cpath d='M1 1l4 4 4-4' stroke='%2394A3B8' stroke-width='1.5' fill='none' stroke-linecap='round'/%3E%3C/svg%3E")`,
            backgroundRepeat: 'no-repeat', backgroundPosition: 'right 8px center', minWidth: 140,
          }}
        >
          {objectTypes.map(ot => (
            <option key={ot.id} value={ot.id}>{ot.displayName || ot.name}</option>
          ))}
        </select>

        {/* Tabs */}
        <div style={{ display: 'flex', gap: 2, marginLeft: 8 }}>
          {TABS.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              style={{
                height: 28, padding: '0 14px', borderRadius: 4, border: '1px solid #E2E8F0',
                backgroundColor: activeTab === tab.id ? '#1E3A5F' : '#FFFFFF',
                color: activeTab === tab.id ? '#FFFFFF' : '#64748B',
                fontSize: 12, fontWeight: 500, cursor: 'pointer',
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Stats row */}
        {stats && (
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 24, alignItems: 'center' }}>
            <StatCard label="Cases" value={stats.total_cases.toLocaleString()} />
            <div style={{ width: 1, height: 24, backgroundColor: '#E2E8F0' }} />
            <StatCard label="Avg Duration" value={`${stats.avg_duration_days}d`} />
            <div style={{ width: 1, height: 24, backgroundColor: '#E2E8F0' }} />
            <StatCard label="Variants" value={stats.variant_count} />
            <div style={{ width: 1, height: 24, backgroundColor: '#E2E8F0' }} />
            <StatCard label="Rework Rate" value={`${stats.rework_rate}%`} alert={stats.rework_rate > 10} />
            <div style={{ width: 1, height: 24, backgroundColor: '#E2E8F0' }} />
            <StatCard label="Stuck" value={stats.stuck_cases} alert={stats.stuck_cases > 0} />
          </div>
        )}
      </div>

      {/* Content */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        {activeTab === 'map' && <ProcessMap objectTypeId={selectedOtId} />}
        {activeTab === 'variants' && (
          <VariantExplorer
            objectTypeId={selectedOtId}
            onSelectVariant={vid => { setSelectedVariantId(vid); setActiveTab('cases'); }}
          />
        )}
        {activeTab === 'cases' && (
          <CaseBrowser objectTypeId={selectedOtId} filterVariantId={selectedVariantId} />
        )}
      </div>

      {/* Status bar */}
      <div style={{
        height: 32, backgroundColor: '#0D1117', borderTop: '1px solid #1E293B',
        display: 'flex', alignItems: 'center', padding: '0 16px', gap: 16, flexShrink: 0,
      }}>
        <span style={{ fontSize: 11, color: '#475569', fontFamily: 'var(--font-mono)' }}>
          {selectedOt ? `${selectedOt.displayName || selectedOt.name}` : ''} · process mining
        </span>
        {stats && (
          <span style={{ fontSize: 11, color: '#475569', fontFamily: 'var(--font-mono)' }}>
            {stats.total_cases} cases · {stats.variant_count} variants · {stats.rework_rate}% rework
          </span>
        )}
      </div>
    </div>
  );
};

export default ProcessMining;
