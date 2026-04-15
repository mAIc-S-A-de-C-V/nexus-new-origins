import React, { useState, useEffect } from 'react';
import { useOntologyStore } from '../../store/ontologyStore';
import { useProcessStore } from '../../store/processStore';
import { usePipelineStore } from '../../store/pipelineStore';
import { ProcessMap } from './ProcessMap';
import { VariantExplorer } from './VariantExplorer';
import { CaseBrowser } from './CaseBrowser';
import { AlertRulesPanel } from './AlertRulesPanel';
import { ConformanceTab } from './ConformanceTab';
import { EventConfigPanel } from './EventConfigPanel';
import { BottleneckPanel } from './BottleneckPanel';
import { OverviewTab } from './OverviewTab';
import { BenchmarkTab } from './BenchmarkTab';
import { KpiBanner } from './KpiBanner';

type TabId = 'map' | 'overview' | 'variants' | 'bottlenecks' | 'conformance' | 'benchmark' | 'cases' | 'alerts' | 'settings';

const TABS: { id: TabId; label: string }[] = [
  { id: 'map', label: 'Process Map' },
  { id: 'overview', label: 'Overview' },
  { id: 'variants', label: 'Variants' },
  { id: 'bottlenecks', label: 'Bottlenecks' },
  { id: 'conformance', label: 'Conformance' },
  { id: 'benchmark', label: 'Benchmark' },
  { id: 'cases', label: 'Cases' },
  { id: 'alerts', label: 'Alerts' },
  { id: 'settings', label: 'Settings' },
];

export const ProcessMining: React.FC = () => {
  const { objectTypes, fetchObjectTypes } = useOntologyStore();
  const { stats, fetchStats, fetchCases, fetchVariants, fetchTransitions, eventConfig, dateRange, setDateRange, attributeFilters, setAttributeFilters } = useProcessStore();
  const { pipelines, fetchPipelines } = usePipelineStore();
  const [activeTab, setActiveTab] = useState<TabId>('map');
  const [selectedOtId, setSelectedOtId] = useState('');
  const [selectedVariantId, setSelectedVariantId] = useState<string | undefined>();
  const [showFilterRow, setShowFilterRow] = useState(false);
  const [draftKey, setDraftKey] = useState('');
  const [draftVal, setDraftVal] = useState('');

  const attrEntries = Object.entries(attributeFilters);
  const hasActiveFilters = !!(dateRange || attrEntries.length > 0);

  useEffect(() => {
    fetchObjectTypes();
    fetchPipelines();
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
  }, [selectedOtId, eventConfig, dateRange, attributeFilters]);

  const selectedOt = objectTypes.find(o => o.id === selectedOtId);

  const pipelineList = pipelines.map(p => ({
    id: p.id,
    name: p.name,
    nodes: (p.nodes || []).map(n => ({
      type: n.type as string,
      config: (n.config || {}) as Record<string, unknown>,
    })),
  }));

  const addAttrFilter = () => {
    if (!draftKey.trim() || !draftVal.trim()) return;
    setAttributeFilters({ ...attributeFilters, [draftKey.trim()]: draftVal.trim() });
    setDraftKey('');
    setDraftVal('');
  };

  const removeAttrFilter = (key: string) => {
    const next = { ...attributeFilters };
    delete next[key];
    setAttributeFilters(next);
  };

  const selectStyle: React.CSSProperties = {
    height: 30, padding: '0 28px 0 10px', borderRadius: 6, border: '1px solid #E2E8F0',
    backgroundColor: '#FFFFFF', color: '#0D1117', fontSize: 12, fontWeight: 500,
    cursor: 'pointer', outline: 'none', appearance: 'none',
    backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'%3E%3Cpath d='M1 1l4 4 4-4' stroke='%2394A3B8' stroke-width='1.5' fill='none' stroke-linecap='round'/%3E%3C/svg%3E")`,
    backgroundRepeat: 'no-repeat', backgroundPosition: 'right 8px center', minWidth: 140,
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden', backgroundColor: '#FFFFFF' }}>

      {/* ── Row 1: Title + Object Type + Tabs ──────────────────────────── */}
      <div style={{
        display: 'flex', alignItems: 'center', padding: '0 20px',
        height: 48, borderBottom: '1px solid #E2E8F0', flexShrink: 0, gap: 16,
      }}>
        <h1 style={{ fontSize: 15, fontWeight: 600, color: '#0D1117', margin: 0, whiteSpace: 'nowrap' }}>
          Process Mining
        </h1>

        {/* Object type selector */}
        <select
          value={selectedOtId}
          onChange={e => { setSelectedOtId(e.target.value); setSelectedVariantId(undefined); }}
          style={selectStyle}
        >
          {objectTypes.map(ot => (
            <option key={ot.id} value={ot.id}>{ot.displayName || ot.name}</option>
          ))}
        </select>

        {/* Divider */}
        <div style={{ width: 1, height: 20, backgroundColor: '#E2E8F0' }} />

        {/* Tabs */}
        <div style={{ display: 'flex', gap: 1, backgroundColor: '#F1F5F9', borderRadius: 6, padding: 2 }}>
          {TABS.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              style={{
                height: 28, padding: '0 12px', borderRadius: 4,
                border: 'none',
                backgroundColor: activeTab === tab.id ? '#1E3A5F' : 'transparent',
                color: activeTab === tab.id ? '#FFFFFF' : '#64748B',
                fontSize: 11, fontWeight: 500, cursor: 'pointer',
                transition: 'all 100ms',
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Spacer */}
        <div style={{ flex: 1 }} />

        {/* Filter toggle */}
        <button
          onClick={() => setShowFilterRow(!showFilterRow)}
          style={{
            height: 28, padding: '0 10px', borderRadius: 5,
            border: hasActiveFilters ? '1px solid #BFDBFE' : '1px solid #E2E8F0',
            backgroundColor: hasActiveFilters ? '#EFF6FF' : '#FFFFFF',
            color: hasActiveFilters ? '#2563EB' : '#64748B',
            fontSize: 11, fontWeight: 500, cursor: 'pointer',
            display: 'flex', alignItems: 'center', gap: 5,
          }}
        >
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
            <path d="M2 4h12M4 8h8M6 12h4" />
          </svg>
          Filters
          {hasActiveFilters && (
            <span style={{
              fontSize: 9, fontWeight: 700, backgroundColor: '#2563EB', color: '#FFFFFF',
              borderRadius: 8, padding: '1px 5px', lineHeight: '14px',
            }}>
              {(dateRange ? 1 : 0) + attrEntries.length}
            </span>
          )}
        </button>

        {/* Settings hint */}
        {eventConfig.excluded_activities.length > 0 && activeTab !== 'settings' && (
          <button
            onClick={() => setActiveTab('settings')}
            style={{
              height: 28, padding: '0 10px', borderRadius: 5,
              border: '1px solid #BFDBFE', backgroundColor: '#EFF6FF',
              color: '#2563EB', fontSize: 11, fontWeight: 500, cursor: 'pointer',
              display: 'flex', alignItems: 'center', gap: 4,
            }}
            title="Activities excluded via Settings"
          >
            {eventConfig.excluded_activities.length} excluded
          </button>
        )}

      </div>

      {/* ── Row 2: Filter bar (collapsible) ────────────────────────────── */}
      {showFilterRow && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 12, padding: '8px 20px',
          borderBottom: '1px solid #E2E8F0', backgroundColor: '#F8FAFC', flexShrink: 0,
          flexWrap: 'wrap',
        }}>
          {/* Date range */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 10, fontWeight: 600, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Date</span>
            <input
              type="date"
              value={dateRange?.start || ''}
              onChange={e => {
                const start = e.target.value;
                if (start) setDateRange({ start, end: dateRange?.end || '' });
                else if (!dateRange?.end) setDateRange(null);
                else setDateRange({ start: '', end: dateRange.end });
              }}
              style={{
                height: 28, padding: '0 8px', borderRadius: 4, border: '1px solid #E2E8F0',
                backgroundColor: '#FFFFFF', color: '#0D1117', fontSize: 11, cursor: 'pointer', outline: 'none',
              }}
            />
            <span style={{ fontSize: 10, color: '#94A3B8' }}>to</span>
            <input
              type="date"
              value={dateRange?.end || ''}
              onChange={e => {
                const end = e.target.value;
                if (end) setDateRange({ start: dateRange?.start || '', end });
                else if (!dateRange?.start) setDateRange(null);
                else setDateRange({ start: dateRange.start, end: '' });
              }}
              style={{
                height: 28, padding: '0 8px', borderRadius: 4, border: '1px solid #E2E8F0',
                backgroundColor: '#FFFFFF', color: '#0D1117', fontSize: 11, cursor: 'pointer', outline: 'none',
              }}
            />
            {dateRange && (
              <button
                onClick={() => setDateRange(null)}
                style={{
                  height: 24, width: 24, borderRadius: 4, border: '1px solid #E2E8F0',
                  backgroundColor: '#FFFFFF', color: '#94A3B8', fontSize: 13, cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}
                title="Clear date filter"
              >×</button>
            )}
          </div>

          {/* Separator */}
          <div style={{ width: 1, height: 20, backgroundColor: '#E2E8F0' }} />

          {/* Attribute filters */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 10, fontWeight: 600, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Attributes</span>

            {/* Active filter pills */}
            {attrEntries.map(([k, v]) => (
              <span key={k} style={{
                display: 'inline-flex', alignItems: 'center', gap: 4,
                fontSize: 10, fontWeight: 600, padding: '3px 8px', borderRadius: 12,
                backgroundColor: '#F0FDF4', color: '#15803D', border: '1px solid #BBF7D0',
              }}>
                {k} = {v}
                <button onClick={() => removeAttrFilter(k)} style={{
                  border: 'none', background: 'none', color: '#15803D', cursor: 'pointer',
                  fontSize: 13, padding: 0, lineHeight: 1, marginLeft: 2,
                }}>×</button>
              </span>
            ))}

            {/* Add new filter */}
            <div style={{
              display: 'flex', alignItems: 'center', gap: 4,
              padding: '2px 4px', borderRadius: 6,
              backgroundColor: '#FFFFFF', border: '1px solid #E2E8F0',
            }}>
              <input
                value={draftKey}
                onChange={e => setDraftKey(e.target.value)}
                placeholder="field"
                style={{
                  width: 80, height: 24, padding: '0 6px', border: 'none',
                  fontSize: 11, outline: 'none', backgroundColor: 'transparent',
                }}
              />
              <span style={{ fontSize: 10, color: '#CBD5E1' }}>=</span>
              <input
                value={draftVal}
                onChange={e => setDraftVal(e.target.value)}
                placeholder="value"
                onKeyDown={e => { if (e.key === 'Enter') addAttrFilter(); }}
                style={{
                  width: 90, height: 24, padding: '0 6px', border: 'none',
                  fontSize: 11, outline: 'none', backgroundColor: 'transparent',
                }}
              />
              <button
                onClick={addAttrFilter}
                disabled={!draftKey.trim() || !draftVal.trim()}
                style={{
                  height: 22, padding: '0 8px', borderRadius: 4, border: 'none',
                  backgroundColor: draftKey.trim() && draftVal.trim() ? '#1E3A5F' : '#F1F5F9',
                  color: draftKey.trim() && draftVal.trim() ? '#FFFFFF' : '#94A3B8',
                  fontSize: 10, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap',
                }}
              >+ Add</button>
            </div>
          </div>

          {/* Clear all */}
          {hasActiveFilters && (
            <>
              <div style={{ flex: 1 }} />
              <button
                onClick={() => { setDateRange(null); setAttributeFilters({}); }}
                style={{
                  height: 26, padding: '0 10px', borderRadius: 4,
                  border: '1px solid #FECACA', backgroundColor: '#FEF2F2',
                  color: '#DC2626', fontSize: 10, fontWeight: 600, cursor: 'pointer',
                }}
              >Clear all filters</button>
            </>
          )}
        </div>
      )}

      {/* ── KPI Banner ─────────────────────────────────────────────────── */}
      {stats && activeTab !== 'settings' && activeTab !== 'overview' && (
        <KpiBanner stats={stats} />
      )}

      {/* ── Content ────────────────────────────────────────────────────── */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        {activeTab === 'map' && <ProcessMap objectTypeId={selectedOtId} />}
        {activeTab === 'overview' && <OverviewTab objectTypeId={selectedOtId} />}
        {activeTab === 'variants' && (
          <VariantExplorer
            objectTypeId={selectedOtId}
            onSelectVariant={vid => { setSelectedVariantId(vid); setActiveTab('cases'); }}
          />
        )}
        {activeTab === 'cases' && (
          <CaseBrowser objectTypeId={selectedOtId} filterVariantId={selectedVariantId} />
        )}
        {activeTab === 'bottlenecks' && (
          <BottleneckPanel objectTypeId={selectedOtId} />
        )}
        {activeTab === 'conformance' && (
          <ConformanceTab objectTypeId={selectedOtId} />
        )}
        {activeTab === 'benchmark' && <BenchmarkTab objectTypeId={selectedOtId} />}
        {activeTab === 'alerts' && (
          <AlertRulesPanel objectTypeId={selectedOtId} />
        )}
        {activeTab === 'settings' && (
          <EventConfigPanel objectTypeId={selectedOtId} pipelines={pipelineList} />
        )}
      </div>

      {/* ── Status bar ─────────────────────────────────────────────────── */}
      <div style={{
        height: 28, backgroundColor: '#0D1117', borderTop: '1px solid #1E293B',
        display: 'flex', alignItems: 'center', padding: '0 20px', gap: 16, flexShrink: 0,
      }}>
        <span style={{ fontSize: 10, color: '#475569', fontFamily: 'var(--font-mono)' }}>
          {selectedOt ? `${selectedOt.displayName || selectedOt.name}` : ''} · process mining
        </span>
        {stats && (
          <span style={{ fontSize: 10, color: '#475569', fontFamily: 'var(--font-mono)' }}>
            {stats.total_cases} cases · {stats.variant_count} variants · {stats.rework_rate}% rework
          </span>
        )}
        {eventConfig.excluded_activities.length > 0 && (
          <span style={{ fontSize: 10, color: '#3B82F6', fontFamily: 'var(--font-mono)' }}>
            · {eventConfig.excluded_activities.length} activities filtered
          </span>
        )}
      </div>
    </div>
  );
};

export default ProcessMining;
