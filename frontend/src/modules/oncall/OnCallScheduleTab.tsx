import React, { useEffect, useState } from 'react';
import { Plus, Trash2, Save } from 'lucide-react';
import { useRoutingStore, OnCallSchedule } from '../../store/routingStore';

const C = {
  bg: '#F8FAFC', panel: '#FFFFFF', border: '#E2E8F0',
  accent: '#7C3AED', accentLight: '#EDE9FE',
  text: '#0D1117', muted: '#64748B', subtle: '#94A3B8',
};

const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

const OnCallScheduleTab: React.FC = () => {
  const { schedules, fetchSchedules, createSchedule, updateSchedule, deleteSchedule } = useRoutingStore();
  const [edit, setEdit] = useState<OnCallSchedule | null>(null);
  const [draft, setDraft] = useState<{ name: string; timezone: string; weekly: Record<string, string> } | null>(null);

  useEffect(() => { void fetchSchedules(); }, [fetchSchedules]);

  const onEdit = (s: OnCallSchedule) => {
    setEdit(s);
    const rot = s.rotation as { weekly?: Record<string, string> } | unknown[];
    const weekly = (rot && typeof rot === 'object' && !Array.isArray(rot) && (rot as { weekly?: Record<string, string> }).weekly) || {};
    setDraft({ name: s.name, timezone: s.timezone, weekly });
  };

  const onNew = () => {
    setEdit(null);
    setDraft({ name: 'Weekly rotation', timezone: 'UTC', weekly: Object.fromEntries(DAYS.map(d => [d, ''])) });
  };

  const onSave = async () => {
    if (!draft) return;
    const body = { name: draft.name, timezone: draft.timezone, rotation: { weekly: draft.weekly } };
    if (edit) await updateSchedule(edit.id, body); else await createSchedule(body);
    await fetchSchedules();
    setDraft(null);
    setEdit(null);
  };

  return (
    <div style={{ padding: 24, display: 'flex', gap: 24, maxWidth: 1100 }}>
      <div style={{ flex: '0 0 320px' }}>
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 12 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: C.text, flex: 1 }}>Schedules</div>
          <button onClick={onNew} style={{ padding: '4px 10px', backgroundColor: C.accent, color: '#FFF', border: 'none', borderRadius: 4, fontSize: 12, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}>
            <Plus size={12} /> New
          </button>
        </div>
        {schedules.map(s => (
          <div key={s.id} onClick={() => onEdit(s)} style={{ padding: 10, border: `1px solid ${C.border}`, backgroundColor: edit?.id === s.id ? C.accentLight : C.panel, borderRadius: 4, marginBottom: 6, cursor: 'pointer' }}>
            <div style={{ fontSize: 13, fontWeight: 500, color: C.text }}>{s.name}</div>
            <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>{s.timezone}</div>
          </div>
        ))}
        {schedules.length === 0 && <div style={{ padding: 18, color: C.subtle, fontSize: 12, textAlign: 'center' }}>No schedules yet</div>}
      </div>

      <div style={{ flex: 1 }}>
        {!draft && <div style={{ color: C.subtle, fontSize: 13 }}>Select or create a schedule</div>}
        {draft && (
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, color: C.text, marginBottom: 12 }}>
              {edit ? 'Edit schedule' : 'New schedule'}
            </div>
            <div style={{ marginBottom: 10 }}>
              <label style={{ fontSize: 12, color: C.muted, display: 'block', marginBottom: 4 }}>Name</label>
              <input value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} style={{ height: 32, padding: '0 10px', border: `1px solid ${C.border}`, borderRadius: 4, fontSize: 13, color: C.text, backgroundColor: C.bg, width: '100%', boxSizing: 'border-box' }} />
            </div>
            <div style={{ marginBottom: 14 }}>
              <label style={{ fontSize: 12, color: C.muted, display: 'block', marginBottom: 4 }}>Timezone</label>
              <input value={draft.timezone} onChange={e => setDraft({ ...draft, timezone: e.target.value })} style={{ height: 32, padding: '0 10px', border: `1px solid ${C.border}`, borderRadius: 4, fontSize: 13, color: C.text, backgroundColor: C.bg, width: 240, boxSizing: 'border-box' }} placeholder="UTC, America/El_Salvador, …" />
            </div>
            <div style={{ fontSize: 12, fontWeight: 600, color: C.muted, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 8 }}>Weekly rotation — user id per day</div>
            <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', rowGap: 6, columnGap: 12, marginBottom: 16 }}>
              {DAYS.map(day => (
                <React.Fragment key={day}>
                  <span style={{ fontSize: 12, color: C.text, textTransform: 'capitalize', display: 'flex', alignItems: 'center' }}>{day}</span>
                  <input value={draft.weekly[day] || ''} onChange={e => setDraft({ ...draft, weekly: { ...draft.weekly, [day]: e.target.value } })} placeholder="user_id (leave blank for nobody)"
                          style={{ height: 30, padding: '0 10px', border: `1px solid ${C.border}`, borderRadius: 4, fontSize: 12, color: C.text, backgroundColor: C.bg, fontFamily: 'monospace' }} />
                </React.Fragment>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={onSave} style={{ padding: '7px 14px', backgroundColor: C.accent, color: '#FFF', border: 'none', borderRadius: 4, fontSize: 12, fontWeight: 500, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5 }}>
                <Save size={12} /> Save
              </button>
              {edit && <button onClick={async () => { await deleteSchedule(edit.id); await fetchSchedules(); setEdit(null); setDraft(null); }} style={{ padding: '7px 12px', backgroundColor: '#FEF2F2', border: `1px solid #FECACA`, color: '#DC2626', borderRadius: 4, fontSize: 12, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5 }}>
                <Trash2 size={12} /> Delete
              </button>}
              <button onClick={() => { setDraft(null); setEdit(null); }} style={{ padding: '7px 12px', backgroundColor: C.bg, border: `1px solid ${C.border}`, color: C.muted, borderRadius: 4, fontSize: 12, cursor: 'pointer' }}>
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default OnCallScheduleTab;
