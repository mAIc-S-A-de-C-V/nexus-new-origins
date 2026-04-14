import React, { useState } from 'react';
import { Search, Database, Layers, Network, RefreshCw, Loader2, ChevronRight } from 'lucide-react';
import { TypeNode, GraphMode, useGraphStore } from '../../store/graphStore';
import { typeColor } from './ObjectNode';

const C = {
  bg: '#F8FAFC',
  panel: '#FFFFFF',
  border: '#E2E8F0',
  accent: '#7C3AED',
  accentLight: '#EDE9FE',
  text: '#0D1117',
  muted: '#64748B',
  subtle: '#94A3B8',
};

interface GraphSidebarProps {
  typeNodes: TypeNode[];
  mode: GraphMode;
  loading: boolean;
  selectedNodeId: string | null;
  onSelectType: (id: string) => void;
  onSwitchMode: (mode: GraphMode) => void;
  onRefresh: () => void;
  onSearchRecord: (typeId: string, query: string) => void;
}

export const GraphSidebar: React.FC<GraphSidebarProps> = ({
  typeNodes, mode, loading, selectedNodeId,
  onSelectType, onSwitchMode, onRefresh, onSearchRecord,
}) => {
  const [typeSearch, setTypeSearch] = useState('');
  const [recordSearch, setRecordSearch] = useState('');
  const [selectedSearchType, setSelectedSearchType] = useState('');

  const filteredTypes = typeNodes.filter((t) =>
    !typeSearch || t.display_name.toLowerCase().includes(typeSearch.toLowerCase())
  );

  const totalRecords = typeNodes.reduce((acc, t) => acc + t.record_count, 0);

  return (
    <div
      style={{
        width: 240,
        flexShrink: 0,
        borderRight: `1px solid ${C.border}`,
        backgroundColor: C.panel,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      {/* Header */}
      <div style={{ padding: '14px 14px 10px', borderBottom: `1px solid ${C.border}`, flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
          <Network size={15} color={C.accent} />
          <span style={{ fontSize: 14, fontWeight: 700, color: C.text }}>Object Graph</span>
          <button
            onClick={onRefresh}
            disabled={loading}
            style={{
              marginLeft: 'auto', width: 26, height: 26, borderRadius: 4,
              border: `1px solid ${C.border}`, backgroundColor: 'transparent',
              cursor: loading ? 'not-allowed' : 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: C.muted, opacity: loading ? 0.5 : 1,
            }}
            title="Refresh graph"
          >
            {loading
              ? <Loader2 size={12} style={{ animation: 'spin 0.8s linear infinite' }} />
              : <RefreshCw size={12} />
            }
          </button>
        </div>
        <div style={{ fontSize: 11, color: C.subtle }}>
          {typeNodes.length} types · {totalRecords.toLocaleString()} records
        </div>
      </div>

      {/* Mode toggle */}
      <div style={{ padding: '8px 10px', borderBottom: `1px solid ${C.border}`, flexShrink: 0 }}>
        <div style={{ display: 'flex', gap: 4, backgroundColor: C.bg, borderRadius: 6, padding: 3 }}>
          <button
            onClick={() => onSwitchMode('type_overview')}
            style={{
              flex: 1, height: 28, borderRadius: 4, border: 'none',
              backgroundColor: mode === 'type_overview' ? C.panel : 'transparent',
              boxShadow: mode === 'type_overview' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
              cursor: 'pointer', fontSize: 11, fontWeight: mode === 'type_overview' ? 600 : 400,
              color: mode === 'type_overview' ? C.text : C.muted,
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
              transition: 'all 100ms',
            }}
          >
            <Network size={11} /> Types
          </button>
          <button
            onClick={() => onSwitchMode('record_focus')}
            style={{
              flex: 1, height: 28, borderRadius: 4, border: 'none',
              backgroundColor: mode === 'record_focus' ? C.panel : 'transparent',
              boxShadow: mode === 'record_focus' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
              cursor: 'pointer', fontSize: 11, fontWeight: mode === 'record_focus' ? 600 : 400,
              color: mode === 'record_focus' ? C.text : C.muted,
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
              transition: 'all 100ms',
            }}
          >
            <Layers size={11} /> Records
          </button>
        </div>
      </div>

      {/* Type search */}
      <div style={{ padding: '8px 10px', borderBottom: `1px solid ${C.border}`, flexShrink: 0 }}>
        <div style={{ position: 'relative' }}>
          <Search size={11} style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', color: C.subtle }} />
          <input
            value={typeSearch}
            onChange={(e) => setTypeSearch(e.target.value)}
            placeholder="Search object types…"
            style={{
              width: '100%', height: 28, paddingLeft: 26, paddingRight: 8,
              border: `1px solid ${C.border}`, borderRadius: 4, fontSize: 11,
              color: C.text, backgroundColor: C.bg, outline: 'none', boxSizing: 'border-box',
            }}
          />
        </div>
      </div>

      {/* Object type list */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '4px 6px' }}>
        {filteredTypes.length === 0 && (
          <div style={{ padding: '20px 8px', textAlign: 'center', fontSize: 11, color: C.subtle }}>
            {loading ? 'Loading…' : 'No object types found'}
          </div>
        )}
        {filteredTypes.map((t) => {
          const colors = typeColor(t.id);
          const isSelected = selectedNodeId === t.id && mode === 'type_overview';
          return (
            <button
              key={t.id}
              onClick={() => onSelectType(t.id)}
              style={{
                display: 'flex', alignItems: 'center', gap: 8, width: '100%',
                padding: '6px 8px', border: 'none', borderRadius: 6, textAlign: 'left',
                backgroundColor: isSelected ? C.accentLight : 'transparent',
                cursor: 'pointer', transition: 'background-color 80ms',
                marginBottom: 1,
              }}
              onMouseEnter={(e) => {
                if (!isSelected) (e.currentTarget as HTMLElement).style.backgroundColor = C.bg;
              }}
              onMouseLeave={(e) => {
                if (!isSelected) (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent';
              }}
            >
              <div
                style={{
                  width: 20,
                  height: 20,
                  borderRadius: 4,
                  backgroundColor: isSelected ? C.accent : colors.badge,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 9,
                  fontWeight: 800,
                  color: '#fff',
                  flexShrink: 0,
                }}
              >
                {t.display_name.charAt(0).toUpperCase()}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12, fontWeight: isSelected ? 600 : 400, color: isSelected ? C.accent : C.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {t.display_name}
                </div>
                <div style={{ fontSize: 10, color: C.subtle }}>
                  {t.record_count.toLocaleString()} records
                </div>
              </div>
              <ChevronRight size={11} color={isSelected ? C.accent : C.subtle} />
            </button>
          );
        })}
      </div>

      {/* Record search — only shown in record mode */}
      {mode === 'record_focus' && (
        <div style={{ padding: '10px', borderTop: `1px solid ${C.border}`, flexShrink: 0 }}>
          <div style={{ fontSize: 10, fontWeight: 600, color: C.subtle, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>
            Start from Record
          </div>
          <select
            value={selectedSearchType}
            onChange={(e) => setSelectedSearchType(e.target.value)}
            style={{
              width: '100%', height: 28, marginBottom: 6,
              border: `1px solid ${C.border}`, borderRadius: 4, fontSize: 11,
              color: C.text, backgroundColor: C.bg, padding: '0 8px', outline: 'none',
            }}
          >
            <option value="">Select type…</option>
            {typeNodes.map((t) => (
              <option key={t.id} value={t.id}>{t.display_name}</option>
            ))}
          </select>
          <div style={{ display: 'flex', gap: 6 }}>
            <div style={{ position: 'relative', flex: 1 }}>
              <Search size={10} style={{ position: 'absolute', left: 7, top: '50%', transform: 'translateY(-50%)', color: C.subtle }} />
              <input
                value={recordSearch}
                onChange={(e) => setRecordSearch(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && selectedSearchType) {
                    onSearchRecord(selectedSearchType, recordSearch);
                  }
                }}
                placeholder="Search or press Enter"
                style={{
                  width: '100%', height: 28, paddingLeft: 22, paddingRight: 6,
                  border: `1px solid ${C.border}`, borderRadius: 4, fontSize: 10,
                  color: C.text, backgroundColor: C.bg, outline: 'none', boxSizing: 'border-box',
                }}
              />
            </div>
            <button
              disabled={!selectedSearchType}
              onClick={() => selectedSearchType && onSearchRecord(selectedSearchType, recordSearch)}
              style={{
                height: 28, padding: '0 10px', borderRadius: 4,
                border: 'none', cursor: selectedSearchType ? 'pointer' : 'not-allowed',
                backgroundColor: selectedSearchType ? C.accent : C.border,
                color: '#fff', fontSize: 11, fontWeight: 600, flexShrink: 0,
                opacity: selectedSearchType ? 1 : 0.5,
              }}
            >
              Go
            </button>
          </div>
        </div>
      )}

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
};
