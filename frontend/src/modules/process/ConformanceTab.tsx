import React, { useEffect, useState } from 'react';
import { useConformanceStore } from '../../store/conformanceStore';
import { HappyPathEditor } from './HappyPathEditor';
import { ConformanceScoreCard } from './ConformanceScoreCard';
import { DeviationBreakdown } from './DeviationBreakdown';

interface Props {
  objectTypeId: string;
}

export const ConformanceTab: React.FC<Props> = ({ objectTypeId }) => {
  const {
    models, checkResult, hasModel, loading, checking,
    fetchModels, fetchSummary, checkConformance, deleteModel,
  } = useConformanceStore();

  const [activeModelId, setActiveModelId] = useState<string | null>(null);
  const [showEditor, setShowEditor] = useState(false);
  const [threshold, setThreshold] = useState(0.7);
  const [editingModel, setEditingModel] = useState<string | null>(null);

  useEffect(() => {
    if (!objectTypeId) return;
    fetchModels(objectTypeId).then(() => {
      fetchSummary(objectTypeId, threshold);
    });
  }, [objectTypeId]);

  const activeModel = models.find(m => m.id === (activeModelId || models.find(m => m.is_active)?.id));

  const handleRunCheck = async () => {
    if (!activeModel) return;
    await checkConformance(objectTypeId, activeModel.id, threshold);
  };

  if (!objectTypeId) return null;

  return (
    <div style={{ flex: 1, overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 0 }}>
      {/* Toolbar */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10, padding: '10px 16px',
        borderBottom: '1px solid #E2E8F0', flexShrink: 0, flexWrap: 'wrap',
      }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: '#0D1117' }}>Conformance Checking</span>

        {/* Model selector */}
        {models.length > 0 && (
          <select
            value={activeModelId || models.find(m => m.is_active)?.id || models[0]?.id || ''}
            onChange={e => setActiveModelId(e.target.value)}
            style={{
              height: 28, padding: '0 8px', borderRadius: 4, border: '1px solid #E2E8F0',
              backgroundColor: '#FFFFFF', fontSize: 12, color: '#0D1117', outline: 'none',
            }}
          >
            {models.map(m => (
              <option key={m.id} value={m.id}>
                {m.name}{m.is_active ? ' ★' : ''}
              </option>
            ))}
          </select>
        )}

        {/* Threshold */}
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#64748B' }}>
          Threshold
          <input
            type="number"
            min={0} max={1} step={0.05}
            value={threshold}
            onChange={e => setThreshold(Number(e.target.value))}
            style={{
              width: 56, height: 28, padding: '0 6px', borderRadius: 4,
              border: '1px solid #E2E8F0', fontSize: 12, outline: 'none',
            }}
          />
        </label>

        {/* Run check */}
        {activeModel && (
          <button
            onClick={handleRunCheck}
            disabled={checking}
            style={{
              height: 28, padding: '0 14px', backgroundColor: '#1E3A5F', color: '#FFFFFF',
              border: 'none', borderRadius: 4, fontSize: 12, fontWeight: 500,
              cursor: checking ? 'wait' : 'pointer',
            }}
          >
            {checking ? 'Checking…' : 'Run Check'}
          </button>
        )}

        {/* New model */}
        <button
          onClick={() => { setEditingModel(null); setShowEditor(true); }}
          style={{
            height: 28, padding: '0 12px', backgroundColor: '#F1F5F9', color: '#475569',
            border: '1px solid #E2E8F0', borderRadius: 4, fontSize: 12, cursor: 'pointer',
            marginLeft: 'auto',
          }}
        >
          + New Model
        </button>

        {/* Edit active model */}
        {activeModel && (
          <button
            onClick={() => { setEditingModel(activeModel.id); setShowEditor(true); }}
            style={{
              height: 28, padding: '0 12px', backgroundColor: '#F1F5F9', color: '#475569',
              border: '1px solid #E2E8F0', borderRadius: 4, fontSize: 12, cursor: 'pointer',
            }}
          >
            Edit Model
          </button>
        )}
      </div>

      {/* Editor */}
      {showEditor && (
        <HappyPathEditor
          objectTypeId={objectTypeId}
          modelId={editingModel}
          onClose={() => setShowEditor(false)}
          onSaved={(modelId) => {
            setShowEditor(false);
            setActiveModelId(modelId);
            fetchModels(objectTypeId).then(() => fetchSummary(objectTypeId, threshold));
          }}
        />
      )}

      {/* No model state */}
      {!loading && models.length === 0 && !showEditor && (
        <div style={{
          flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center',
          justifyContent: 'center', gap: 12, padding: 40,
        }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#0D1117' }}>No conformance model defined</div>
          <div style={{ fontSize: 12, color: '#64748B', maxWidth: 420, textAlign: 'center', lineHeight: 1.6 }}>
            Define a "happy path" — the expected sequence of stages a case should follow —
            and Nexus will score every case against it, highlighting skips, wrong-order steps, and unauthorized activities.
          </div>
          <button
            onClick={() => setShowEditor(true)}
            style={{
              height: 32, padding: '0 16px', backgroundColor: '#1E3A5F', color: '#FFFFFF',
              border: 'none', borderRadius: 4, fontSize: 12, fontWeight: 500, cursor: 'pointer',
            }}
          >
            Define Happy Path
          </button>
        </div>
      )}

      {/* Results */}
      {checkResult && !showEditor && (
        <div style={{ flex: 1, overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 0 }}>
          <ConformanceScoreCard result={checkResult} />
          <DeviationBreakdown result={checkResult} />
        </div>
      )}

      {!checkResult && hasModel === false && !loading && !showEditor && models.length > 0 && (
        <div style={{ padding: 24, fontSize: 12, color: '#94A3B8', textAlign: 'center' }}>
          Select a model and click "Run Check" to analyse conformance.
        </div>
      )}
    </div>
  );
};
