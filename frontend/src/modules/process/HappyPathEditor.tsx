import React, { useEffect, useState } from 'react';
import { GripVertical, X, Plus } from 'lucide-react';
import { useConformanceStore, ConformanceModel } from '../../store/conformanceStore';

interface Props {
  objectTypeId: string;
  modelId: string | null;       // null = create new
  onClose: () => void;
  onSaved: (modelId: string) => void;
}

export const HappyPathEditor: React.FC<Props> = ({ objectTypeId, modelId, onClose, onSaved }) => {
  const { models, createModel, updateModel } = useConformanceStore();
  const existing = modelId ? models.find(m => m.id === modelId) : null;

  const [name, setName] = useState(existing?.name || '');
  const [activities, setActivities] = useState<string[]>(existing?.activities || ['']);
  const [isActive, setIsActive] = useState(existing?.is_active ?? true);
  const [saving, setSaving] = useState(false);
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [overIdx, setOverIdx] = useState<number | null>(null);

  useEffect(() => {
    if (existing) {
      setName(existing.name);
      setActivities([...existing.activities]);
      setIsActive(existing.is_active);
    }
  }, [modelId]);

  const addActivity = () => setActivities(prev => [...prev, '']);

  const removeActivity = (idx: number) =>
    setActivities(prev => prev.filter((_, i) => i !== idx));

  const updateActivity = (idx: number, val: string) =>
    setActivities(prev => prev.map((a, i) => (i === idx ? val : a)));

  const handleDragStart = (idx: number) => setDragIdx(idx);
  const handleDragOver = (e: React.DragEvent, idx: number) => {
    e.preventDefault();
    setOverIdx(idx);
  };
  const handleDrop = (targetIdx: number) => {
    if (dragIdx === null || dragIdx === targetIdx) return;
    const next = [...activities];
    const [item] = next.splice(dragIdx, 1);
    next.splice(targetIdx, 0, item);
    setActivities(next);
    setDragIdx(null);
    setOverIdx(null);
  };

  const handleSave = async () => {
    const clean = activities.map(a => a.trim()).filter(Boolean);
    if (!name.trim() || clean.length === 0) return;
    setSaving(true);
    try {
      if (modelId && existing) {
        await updateModel(objectTypeId, modelId, { name: name.trim(), activities: clean, is_active: isActive });
        onSaved(modelId);
      } else {
        const model = await createModel(objectTypeId, name.trim(), clean);
        onSaved(model.id);
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{
      margin: '12px 16px',
      border: '1px solid #1E3A5F', borderRadius: 6,
      backgroundColor: '#F8FAFC', padding: 16,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 14 }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: '#0D1117', flex: 1 }}>
          {modelId ? 'Edit Happy Path' : 'New Happy Path Model'}
        </span>
        <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94A3B8' }}>
          <X size={14} />
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 10, marginBottom: 14, alignItems: 'end' }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 11, color: '#64748B' }}>
          Model name
          <input
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="e.g. Standard Deal Flow"
            style={inputStyle}
          />
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#64748B', paddingBottom: 2 }}>
          <input type="checkbox" checked={isActive} onChange={e => setIsActive(e.target.checked)} />
          Active (default for this object type)
        </label>
      </div>

      <div style={{ fontSize: 11, color: '#64748B', marginBottom: 8 }}>
        Expected stage sequence — drag to reorder
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 12 }}>
        {activities.map((act, idx) => (
          <div
            key={idx}
            draggable
            onDragStart={() => handleDragStart(idx)}
            onDragOver={e => handleDragOver(e, idx)}
            onDrop={() => handleDrop(idx)}
            style={{
              display: 'flex', alignItems: 'center', gap: 8,
              backgroundColor: overIdx === idx ? '#EFF6FF' : '#FFFFFF',
              border: `1px solid ${overIdx === idx ? '#93C5FD' : '#E2E8F0'}`,
              borderRadius: 4, padding: '4px 8px',
              transition: 'border-color 80ms',
            }}
          >
            <span style={{ color: '#CBD5E1', cursor: 'grab', lineHeight: 0 }}>
              <GripVertical size={14} />
            </span>
            <span style={{
              width: 20, height: 20, borderRadius: '50%',
              backgroundColor: '#1E3A5F', color: '#FFFFFF',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 10, fontWeight: 700, flexShrink: 0,
            }}>
              {idx + 1}
            </span>
            <input
              value={act}
              onChange={e => updateActivity(idx, e.target.value)}
              placeholder={`Stage ${idx + 1}`}
              style={{ ...inputStyle, flex: 1, border: 'none', backgroundColor: 'transparent', padding: '0 4px' }}
            />
            {activities.length > 1 && (
              <button
                onClick={() => removeActivity(idx)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#CBD5E1', padding: 0 }}
              >
                <X size={12} />
              </button>
            )}
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 8 }}>
        <button
          onClick={addActivity}
          style={{
            height: 28, padding: '0 12px',
            display: 'flex', alignItems: 'center', gap: 5,
            backgroundColor: '#F1F5F9', color: '#475569',
            border: '1px solid #E2E8F0', borderRadius: 4, fontSize: 12, cursor: 'pointer',
          }}
        >
          <Plus size={12} />
          Add stage
        </button>
        <button
          onClick={handleSave}
          disabled={saving || !name.trim() || activities.every(a => !a.trim())}
          style={{
            height: 28, padding: '0 14px',
            backgroundColor: '#1E3A5F', color: '#FFFFFF',
            border: 'none', borderRadius: 4, fontSize: 12, fontWeight: 500,
            cursor: saving ? 'wait' : 'pointer',
            opacity: (!name.trim() || activities.every(a => !a.trim())) ? 0.5 : 1,
          }}
        >
          {saving ? 'Saving…' : (modelId ? 'Save changes' : 'Create model')}
        </button>
        <button
          onClick={onClose}
          style={{
            height: 28, padding: '0 12px',
            backgroundColor: 'transparent', color: '#94A3B8',
            border: '1px solid #E2E8F0', borderRadius: 4, fontSize: 12, cursor: 'pointer',
          }}
        >
          Cancel
        </button>
      </div>
    </div>
  );
};

const inputStyle: React.CSSProperties = {
  height: 28, padding: '0 8px', borderRadius: 4,
  border: '1px solid #E2E8F0', backgroundColor: '#FFFFFF',
  fontSize: 12, color: '#0D1117', outline: 'none',
};
