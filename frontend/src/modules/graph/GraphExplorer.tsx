import React, { useEffect, useCallback } from 'react';
import { ReactFlowProvider } from '@xyflow/react';
import { useGraphStore } from '../../store/graphStore';
import { useNavigationStore } from '../../store/navigationStore';
import { GraphSidebar } from './GraphSidebar';
import { GraphCanvas } from './GraphCanvas';
import { GraphDetailPanel } from './GraphDetailPanel';

const C = {
  border: '#E2E8F0',
  panel: '#FFFFFF',
};

const GraphExplorer: React.FC = () => {
  const {
    mode, typeNodes, typeEdges, recordNodes, recordEdges,
    selectedNodeId, loading, error, pendingTypeId,
    fetchSummary, startRecordGraph, expandNode,
    setSelectedNode, setMode, setPendingTypeId, clearRecordGraph,
  } = useGraphStore();

  // Load type overview on mount
  useEffect(() => {
    fetchSummary();
  }, []);

  // Handle "Open in Graph" from other modules
  useEffect(() => {
    if (pendingTypeId && typeNodes.length > 0) {
      setSelectedNode(pendingTypeId);
      setMode('type_overview');
      setPendingTypeId(null);
    }
  }, [pendingTypeId, typeNodes.length]);

  const handleSelectType = useCallback((typeId: string) => {
    setSelectedNode(typeId);
    if (mode === 'record_focus') {
      // In record mode, clicking a type shows records
      startRecordGraph(typeId, undefined, 2, 80);
    } else {
      setMode('type_overview');
    }
  }, [mode, setSelectedNode, setMode, startRecordGraph]);

  const handleSwitchMode = useCallback((newMode: 'type_overview' | 'record_focus') => {
    if (newMode === 'type_overview') {
      clearRecordGraph();
      setSelectedNode(null);
    }
    setMode(newMode);
  }, [setMode, clearRecordGraph, setSelectedNode]);

  const handleOpenRecords = useCallback((typeId: string) => {
    setMode('record_focus');
    startRecordGraph(typeId, undefined, 2, 80);
  }, [setMode, startRecordGraph]);

  const handleSearchRecord = useCallback((typeId: string, _query: string) => {
    // For now, load records of the type — future: filter by query
    startRecordGraph(typeId, undefined, 2, 80);
  }, [startRecordGraph]);

  const handleExpand = useCallback((recordId: string, targetTypeId: string, linkId: string) => {
    expandNode(recordId, targetTypeId, linkId);
  }, [expandNode]);

  const handleCloseDetail = useCallback(() => {
    setSelectedNode(null);
  }, [setSelectedNode]);

  return (
    <div style={{ display: 'flex', height: '100%', backgroundColor: '#F8FAFC' }}>
      {/* Left sidebar */}
      <GraphSidebar
        typeNodes={typeNodes}
        mode={mode}
        loading={loading}
        selectedNodeId={selectedNodeId}
        onSelectType={handleSelectType}
        onSwitchMode={handleSwitchMode}
        onRefresh={fetchSummary}
        onSearchRecord={handleSearchRecord}
      />

      {/* Canvas */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', position: 'relative' }}>
        {/* Toolbar */}
        <div style={{
          height: 44, flexShrink: 0, backgroundColor: C.panel,
          borderBottom: `1px solid ${C.border}`,
          display: 'flex', alignItems: 'center', padding: '0 16px', gap: 10,
        }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: '#374151' }}>
            {mode === 'type_overview'
              ? `${typeNodes.length} object types`
              : `${recordNodes.length} records`}
          </span>

          {mode === 'record_focus' && recordNodes.length > 0 && (
            <>
              <span style={{ fontSize: 11, color: '#9CA3AF' }}>·</span>
              <span style={{ fontSize: 11, color: '#9CA3AF' }}>
                {[...new Set(recordNodes.map((n) => n.object_type_id))].length} types in view
              </span>
              <button
                onClick={() => handleSwitchMode('type_overview')}
                style={{
                  marginLeft: 'auto', height: 26, padding: '0 10px', borderRadius: 4,
                  border: '1px solid #E2E8F0', backgroundColor: '#fff',
                  cursor: 'pointer', fontSize: 11, color: '#64748B',
                  display: 'flex', alignItems: 'center', gap: 4,
                }}
              >
                ← Back to Type Overview
              </button>
            </>
          )}

          {error && (
            <span style={{ marginLeft: 'auto', fontSize: 11, color: '#DC2626', backgroundColor: '#FEF2F2', padding: '3px 8px', borderRadius: 4 }}>
              {error}
            </span>
          )}
        </div>

        <ReactFlowProvider>
          <GraphCanvas
            mode={mode}
            typeNodes={typeNodes}
            typeEdges={typeEdges}
            recordNodes={recordNodes}
            recordEdges={recordEdges}
            selectedNodeId={selectedNodeId}
            onSelectNode={setSelectedNode}
          />
        </ReactFlowProvider>
      </div>

      {/* Right detail panel */}
      <div style={{
        width: 280,
        flexShrink: 0,
        borderLeft: `1px solid ${C.border}`,
        backgroundColor: C.panel,
        overflow: 'hidden',
      }}>
        <GraphDetailPanel
          mode={mode}
          selectedNodeId={selectedNodeId}
          typeNodes={typeNodes}
          typeEdges={typeEdges}
          recordNodes={recordNodes}
          recordEdges={recordEdges}
          onOpenRecords={handleOpenRecords}
          onExpand={handleExpand}
          onClose={handleCloseDetail}
        />
      </div>
    </div>
  );
};

export default GraphExplorer;
