import React, { useState, useEffect } from 'react';
import {
  Bell, Plus, Trash2, ToggleLeft, ToggleRight, Zap, Clock, RefreshCw,
  ChevronDown, ChevronRight, Check, X, Link, AlertTriangle, AlertCircle,
  Mail, Webhook,
} from 'lucide-react';
import { useAlertStore, AlertRule, RuleType, ChannelConfig } from '../../store/alertStore';

const C = {
  bg: '#F8FAFC', panel: '#FFFFFF', border: '#E2E8F0',
  accent: '#7C3AED', accentLight: '#EDE9FE',
  text: '#0D1117', muted: '#64748B', subtle: '#94A3B8', hover: '#F1F5F9',
  success: '#22C55E', warning: '#F59E0B', error: '#EF4444',
  critical: '#EF4444', criticalLight: '#FEF2F2',
  warningLight: '#FFFBEB',
};

const RULE_TYPE_META: Record<RuleType, { label: string; color: string; bg: string; icon: React.ReactNode; desc: string }> = {
  stuck_case:           { label: 'Stuck Case',          color: '#7C3AED', bg: '#EDE9FE', icon: <Clock size={14} />,        desc: 'Fire when a case has not moved for N hours' },
  slow_transition:      { label: 'Slow Transition',     color: '#2563EB', bg: '#DBEAFE', icon: <ChevronRight size={14} />, desc: 'Fire when a step-to-step transition exceeds a threshold' },
  rework_spike:         { label: 'Rework Spike',        color: '#D97706', bg: '#FEF3C7', icon: <RefreshCw size={14} />,    desc: 'Fire when rework percentage spikes above a threshold' },
  case_volume_anomaly:  { label: 'Volume Anomaly',      color: '#DC2626', bg: '#FEE2E2', icon: <AlertTriangle size={14} />,desc: 'Fire when case volume drops sharply in a window' },
};

const inp: React.CSSProperties = {
  height: 32, padding: '0 10px', border: `1px solid ${C.border}`, borderRadius: 4,
  fontSize: 13, color: C.text, backgroundColor: C.bg, outline: 'none', boxSizing: 'border-box',
};

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function snoozeUntil(hours: number) {
  return new Date(Date.now() + hours * 3600000).toISOString();
}

// ── Rules Tab ────────────────────────────────────────────────────────────────

type EditState = Partial<AlertRule> & { isNew?: boolean };

const RulesTab: React.FC = () => {
  const { rules, loadingRules, createRule, updateRule, deleteRule, testRule } = useAlertStore();
  const [selected, setSelected] = useState<string | null>(null);
  const [edit, setEdit] = useState<EditState | null>(null);
  const [testResult, setTestResult] = useState<{ triggered: boolean; result: unknown } | null>(null);
  const [saving, setSaving] = useState(false);

  const startNew = () => {
    setSelected(null);
    setTestResult(null);
    setEdit({
      isNew: true, name: '', rule_type: 'stuck_case', object_type_id: null,
      config: { threshold_hours: 24, severity: 'warning' }, cooldown_minutes: 60, enabled: true,
    });
  };

  const selectRule = (r: AlertRule) => {
    setSelected(r.id);
    setTestResult(null);
    setEdit({ ...r });
  };

  const handleTypeChange = (t: RuleType) => {
    const defaults: Record<RuleType, Record<string, unknown>> = {
      stuck_case:          { threshold_hours: 24, severity: 'warning' },
      slow_transition:     { from_activity: '', to_activity: '', threshold_hours: 4, severity: 'warning' },
      rework_spike:        { threshold_pct: 20, min_cases: 10 },
      case_volume_anomaly: { drop_pct: 50, window_hours: 1 },
    };
    setEdit(e => e ? { ...e, rule_type: t, config: defaults[t] } : e);
  };

  const setConfig = (key: string, val: unknown) =>
    setEdit(e => e ? { ...e, config: { ...e.config, [key]: val } } : e);

  const save = async () => {
    if (!edit) return;
    setSaving(true);
    try {
      if (edit.isNew) {
        await createRule({
          name: edit.name || 'New Rule',
          rule_type: edit.rule_type || 'stuck_case',
          object_type_id: edit.object_type_id ?? null,
          config: edit.config || {},
          cooldown_minutes: edit.cooldown_minutes ?? 60,
          enabled: edit.enabled ?? true,
        });
      } else if (edit.id) {
        await updateRule(edit.id, {
          name: edit.name, config: edit.config,
          cooldown_minutes: edit.cooldown_minutes, enabled: edit.enabled,
        });
      }
      setEdit(null);
      setSelected(null);
    } finally {
      setSaving(false);
    }
  };

  const runTest = async () => {
    if (!selected) return;
    const res = await testRule(selected);
    setTestResult(res);
  };

  const cfg = edit?.config || {};

  return (
    <div style={{ display: 'flex', height: '100%', overflow: 'hidden' }}>
      {/* Left panel */}
      <div style={{ width: 320, flexShrink: 0, borderRight: `1px solid ${C.border}`, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div style={{ padding: '10px 12px', borderBottom: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: C.text }}>Rules ({rules.length})</span>
          <button onClick={startNew} style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '5px 10px', borderRadius: 4, fontSize: 12, fontWeight: 500, backgroundColor: C.accent, color: '#FFF', border: 'none', cursor: 'pointer' }}>
            <Plus size={11} /> New Rule
          </button>
        </div>
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {loadingRules && <div style={{ padding: 20, textAlign: 'center', color: C.subtle, fontSize: 13 }}>Loading…</div>}
          {!loadingRules && rules.length === 0 && <div style={{ padding: 20, textAlign: 'center', color: C.subtle, fontSize: 13 }}>No rules yet</div>}
          {rules.map(r => {
            const meta = RULE_TYPE_META[r.rule_type];
            const active = selected === r.id;
            return (
              <div key={r.id} onClick={() => selectRule(r)} style={{ padding: '10px 12px', borderBottom: `1px solid ${C.border}`, backgroundColor: active ? C.accentLight : 'transparent', cursor: 'pointer', transition: 'background 80ms' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                  <span style={{ fontSize: 13, fontWeight: 500, color: active ? C.accent : C.text, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.name}</span>
                  <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                    <button onClick={e => { e.stopPropagation(); runTest(); }} title="Test" style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.subtle, lineHeight: 0, padding: 2 }}><Zap size={12} /></button>
                    <button onClick={e => { e.stopPropagation(); deleteRule(r.id); if (selected === r.id) { setSelected(null); setEdit(null); } }} title="Delete" style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.subtle, lineHeight: 0, padding: 2 }}><Trash2 size={12} /></button>
                    <button onClick={e => { e.stopPropagation(); updateRule(r.id, { enabled: !r.enabled }); }} title="Toggle" style={{ background: 'none', border: 'none', cursor: 'pointer', color: r.enabled ? C.success : C.subtle, lineHeight: 0, padding: 2 }}>
                      {r.enabled ? <ToggleRight size={15} /> : <ToggleLeft size={15} />}
                    </button>
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontSize: 11, padding: '1px 6px', borderRadius: 10, backgroundColor: meta.bg, color: meta.color, fontWeight: 500 }}>{meta.label}</span>
                  {r.last_fired && <span style={{ fontSize: 11, color: C.subtle }}>fired {timeAgo(r.last_fired)}</span>}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Right panel */}
      <div style={{ flex: 1, overflowY: 'auto', padding: 24 }}>
        {!edit ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', color: C.subtle, gap: 8 }}>
            <Bell size={32} color={C.border} />
            <div style={{ fontSize: 14 }}>Select a rule to edit or create a new one</div>
          </div>
        ) : (
          <div style={{ maxWidth: 520 }}>
            {/* Test result banner */}
            {testResult && (
              <div style={{ marginBottom: 16, padding: '10px 14px', borderRadius: 6, backgroundColor: testResult.triggered ? C.criticalLight : '#F0FDF4', border: `1px solid ${testResult.triggered ? '#FECACA' : '#BBF7D0'}`, fontSize: 13 }}>
                <span style={{ fontWeight: 600, color: testResult.triggered ? C.error : C.success }}>{testResult.triggered ? 'Would trigger' : 'Would not trigger'}</span>
                <pre style={{ marginTop: 6, fontSize: 11, color: C.muted, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>{JSON.stringify(testResult.result, null, 2)}</pre>
              </div>
            )}

            <div style={{ marginBottom: 16 }}>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 500, color: C.muted, marginBottom: 4 }}>Rule Name</label>
              <input value={edit.name || ''} onChange={e => setEdit(x => x ? { ...x, name: e.target.value } : x)} style={{ ...inp, width: '100%' }} placeholder="e.g. Flag stalled intake cases" />
            </div>

            <div style={{ marginBottom: 16 }}>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 500, color: C.muted, marginBottom: 8 }}>Rule Type</label>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                {(Object.entries(RULE_TYPE_META) as [RuleType, typeof RULE_TYPE_META[RuleType]][]).map(([t, m]) => (
                  <div key={t} onClick={() => handleTypeChange(t)} style={{ padding: '10px 12px', borderRadius: 6, border: `2px solid ${edit.rule_type === t ? m.color : C.border}`, backgroundColor: edit.rule_type === t ? m.bg : C.bg, cursor: 'pointer', transition: 'all 100ms' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4, color: m.color }}>{m.icon}<span style={{ fontSize: 12, fontWeight: 600 }}>{m.label}</span></div>
                    <div style={{ fontSize: 11, color: C.muted }}>{m.desc}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* Dynamic config */}
            <div style={{ marginBottom: 16, padding: '12px 14px', backgroundColor: C.bg, border: `1px solid ${C.border}`, borderRadius: 6 }}>
              <div style={{ fontSize: 12, fontWeight: 500, color: C.muted, marginBottom: 10 }}>Configuration</div>
              {edit.rule_type === 'stuck_case' && <>
                <Row label="Threshold hours"><input type="number" value={Number(cfg.threshold_hours ?? 24)} onChange={e => setConfig('threshold_hours', Number(e.target.value))} style={{ ...inp, width: 80 }} /></Row>
                <Row label="Severity"><SeveritySelect value={String(cfg.severity ?? 'warning')} onChange={v => setConfig('severity', v)} /></Row>
              </>}
              {edit.rule_type === 'slow_transition' && <>
                <Row label="From activity"><input value={String(cfg.from_activity ?? '')} onChange={e => setConfig('from_activity', e.target.value)} style={{ ...inp, width: '100%' }} /></Row>
                <Row label="To activity"><input value={String(cfg.to_activity ?? '')} onChange={e => setConfig('to_activity', e.target.value)} style={{ ...inp, width: '100%' }} /></Row>
                <Row label="Threshold hours"><input type="number" value={Number(cfg.threshold_hours ?? 4)} onChange={e => setConfig('threshold_hours', Number(e.target.value))} style={{ ...inp, width: 80 }} /></Row>
                <Row label="Severity"><SeveritySelect value={String(cfg.severity ?? 'warning')} onChange={v => setConfig('severity', v)} /></Row>
              </>}
              {edit.rule_type === 'rework_spike' && <>
                <Row label="Threshold %"><input type="number" min={0} max={100} value={Number(cfg.threshold_pct ?? 20)} onChange={e => setConfig('threshold_pct', Number(e.target.value))} style={{ ...inp, width: 80 }} /></Row>
                <Row label="Min cases"><input type="number" value={Number(cfg.min_cases ?? 10)} onChange={e => setConfig('min_cases', Number(e.target.value))} style={{ ...inp, width: 80 }} /></Row>
              </>}
              {edit.rule_type === 'case_volume_anomaly' && <>
                <Row label="Drop %"><input type="number" min={0} max={100} value={Number(cfg.drop_pct ?? 50)} onChange={e => setConfig('drop_pct', Number(e.target.value))} style={{ ...inp, width: 80 }} /></Row>
                <Row label="Window hours"><input type="number" value={Number(cfg.window_hours ?? 1)} onChange={e => setConfig('window_hours', Number(e.target.value))} style={{ ...inp, width: 80 }} /></Row>
              </>}
            </div>

            <div style={{ marginBottom: 20 }}>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 500, color: C.muted, marginBottom: 6 }}>
                Cooldown — {edit.cooldown_minutes ?? 60} min
              </label>
              <input type="range" min={15} max={480} step={15} value={edit.cooldown_minutes ?? 60} onChange={e => setEdit(x => x ? { ...x, cooldown_minutes: Number(e.target.value) } : x)} style={{ width: '100%', accentColor: C.accent }} />
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: C.subtle, marginTop: 2 }}><span>15m</span><span>8h</span></div>
            </div>

            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={save} disabled={saving} style={{ padding: '7px 18px', borderRadius: 4, fontSize: 13, fontWeight: 500, backgroundColor: C.accent, color: '#FFF', border: 'none', cursor: saving ? 'not-allowed' : 'pointer' }}>
                {saving ? 'Saving…' : 'Save'}
              </button>
              <button onClick={() => { setEdit(null); setSelected(null); }} style={{ padding: '7px 14px', borderRadius: 4, fontSize: 13, backgroundColor: C.bg, color: C.muted, border: `1px solid ${C.border}`, cursor: 'pointer' }}>Cancel</button>
              {!edit.isNew && selected && <button onClick={runTest} style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 5, padding: '7px 14px', borderRadius: 4, fontSize: 13, backgroundColor: C.accentLight, color: C.accent, border: `1px solid ${C.border}`, cursor: 'pointer' }}><Zap size={12} /> Test</button>}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

const Row: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
    <span style={{ fontSize: 12, color: C.muted, minWidth: 120 }}>{label}</span>
    {children}
  </div>
);

const SeveritySelect: React.FC<{ value: string; onChange: (v: string) => void }> = ({ value, onChange }) => (
  <select value={value} onChange={e => onChange(e.target.value)} style={{ ...inp, width: 120 }}>
    <option value="warning">Warning</option>
    <option value="critical">Critical</option>
  </select>
);

// ── History Tab ──────────────────────────────────────────────────────────────

const HistoryTab: React.FC = () => {
  const { notifications, loadingNotifications, markRead, markAllRead, deleteNotification, snoozeNotification } = useAlertStore();
  const [filter, setFilter] = useState<'all' | 'unread' | 'critical' | 'warning'>('all');
  const [range, setRange] = useState<'24h' | '7d' | '30d'>('7d');
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [snoozeOpen, setSnoozeOpen] = useState<string | null>(null);

  const rangeMs: Record<string, number> = { '24h': 86400000, '7d': 604800000, '30d': 2592000000 };

  const visible = notifications.filter(n => {
    if (filter === 'unread' && n.read) return false;
    if (filter === 'critical' && n.severity !== 'critical') return false;
    if (filter === 'warning' && n.severity !== 'warning') return false;
    if (Date.now() - new Date(n.fired_at).getTime() > rangeMs[range]) return false;
    if (search && !n.rule_name.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const snoozeOptions = [
    { label: '1 hour', hours: 1 }, { label: '4 hours', hours: 4 },
    { label: '24 hours', hours: 24 }, { label: '1 week', hours: 168 },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* Filter bar */}
      <div style={{ padding: '10px 16px', borderBottom: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', flexShrink: 0 }}>
        {(['all', 'unread', 'critical', 'warning'] as const).map(f => (
          <button key={f} onClick={() => setFilter(f)} style={{ padding: '4px 10px', borderRadius: 14, fontSize: 12, fontWeight: 500, border: `1px solid ${filter === f ? C.accent : C.border}`, backgroundColor: filter === f ? C.accentLight : 'transparent', color: filter === f ? C.accent : C.muted, cursor: 'pointer', textTransform: 'capitalize' }}>{f}</button>
        ))}
        <div style={{ width: 1, height: 18, backgroundColor: C.border, margin: '0 4px' }} />
        {(['24h', '7d', '30d'] as const).map(r => (
          <button key={r} onClick={() => setRange(r)} style={{ padding: '4px 10px', borderRadius: 14, fontSize: 12, fontWeight: 500, border: `1px solid ${range === r ? C.accent : C.border}`, backgroundColor: range === r ? C.accentLight : 'transparent', color: range === r ? C.accent : C.muted, cursor: 'pointer' }}>{r}</button>
        ))}
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search rule name…" style={{ ...inp, flex: 1, minWidth: 160 }} />
        <button onClick={() => markAllRead()} style={{ padding: '4px 12px', borderRadius: 4, fontSize: 12, border: `1px solid ${C.border}`, backgroundColor: C.bg, color: C.muted, cursor: 'pointer' }}>Mark all read</button>
      </div>

      {/* List */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {loadingNotifications && <div style={{ padding: 24, textAlign: 'center', color: C.subtle, fontSize: 13 }}>Loading…</div>}
        {!loadingNotifications && visible.length === 0 && (
          <div style={{ padding: 48, textAlign: 'center', color: C.subtle, fontSize: 13 }}>
            <Bell size={28} color={C.border} style={{ marginBottom: 8 }} /><br />No notifications match your filters
          </div>
        )}
        {visible.map(n => {
          const isExp = expanded === n.id;
          const rowBg = n.read ? C.panel : n.severity === 'critical' ? '#FFF5F5' : '#FFFDF7';
          return (
            <div key={n.id} style={{ borderBottom: `1px solid ${C.border}`, backgroundColor: rowBg }}>
              <div style={{ padding: '10px 16px', display: 'flex', alignItems: 'flex-start', gap: 10, cursor: 'pointer' }} onClick={() => setExpanded(isExp ? null : n.id)}>
                <div style={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: n.severity === 'critical' ? C.critical : C.warning, flexShrink: 0, marginTop: 5 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
                    <span style={{ fontSize: 13, fontWeight: n.read ? 400 : 600, color: C.text }}>{n.rule_name}</span>
                    {!n.read && <span style={{ width: 6, height: 6, borderRadius: '50%', backgroundColor: C.accent }} />}
                  </div>
                  <div style={{ fontSize: 12, color: C.muted }}>{n.message}</div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                  <span style={{ fontSize: 11, color: C.subtle }}>{timeAgo(n.fired_at)}</span>
                  {!n.read && <button onClick={e => { e.stopPropagation(); markRead(n.id); }} title="Mark read" style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.success, lineHeight: 0 }}><Check size={13} /></button>}
                  <div style={{ position: 'relative' }}>
                    <button onClick={e => { e.stopPropagation(); setSnoozeOpen(snoozeOpen === n.id ? null : n.id); }} title="Snooze" style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.subtle, lineHeight: 0, display: 'flex', alignItems: 'center', gap: 2 }}><Clock size={13} /><ChevronDown size={10} /></button>
                    {snoozeOpen === n.id && (
                      <div style={{ position: 'absolute', right: 0, top: 22, zIndex: 20, backgroundColor: C.panel, border: `1px solid ${C.border}`, borderRadius: 6, padding: 4, boxShadow: '0 4px 12px rgba(0,0,0,.08)', minWidth: 120 }}>
                        {snoozeOptions.map(o => (
                          <button key={o.hours} onClick={e => { e.stopPropagation(); snoozeNotification(n.id, snoozeUntil(o.hours)); setSnoozeOpen(null); }} style={{ display: 'block', width: '100%', padding: '6px 10px', background: 'none', border: 'none', cursor: 'pointer', fontSize: 12, color: C.text, textAlign: 'left', borderRadius: 4 }}>{o.label}</button>
                        ))}
                      </div>
                    )}
                  </div>
                  <button onClick={e => { e.stopPropagation(); deleteNotification(n.id); }} title="Dismiss" style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.subtle, lineHeight: 0 }}><X size={13} /></button>
                </div>
              </div>
              {isExp && (
                <div style={{ padding: '0 16px 12px 34px' }}>
                  <pre style={{ margin: 0, fontSize: 11, color: C.muted, backgroundColor: C.bg, border: `1px solid ${C.border}`, borderRadius: 4, padding: '8px 10px', overflowX: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                    {JSON.stringify(n.details, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

// ── Channels Tab ─────────────────────────────────────────────────────────────

const ChannelsTab: React.FC = () => {
  const { webhooks, channels, fetchWebhooks, createWebhook, deleteWebhook, fetchChannels, updateChannels, testChannels } = useAlertStore();
  const [webhookUrl, setWebhookUrl] = useState('');
  const [adding, setAdding] = useState(false);
  const [secretModal, setSecretModal] = useState<{ id: string; url: string; secret: string } | null>(null);
  const [form, setForm] = useState<ChannelConfig>({ email_enabled: false, email_recipients: '', slack_enabled: false, slack_webhook_url: '' });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; slack?: string; email?: string } | null>(null);

  useEffect(() => {
    if (channels) setForm(channels);
  }, [channels]);

  const addWebhook = async () => {
    if (!webhookUrl.trim()) return;
    setAdding(true);
    try {
      const res = await createWebhook(webhookUrl.trim());
      setSecretModal(res);
      setWebhookUrl('');
    } finally {
      setAdding(false);
    }
  };

  const saveChannels = async () => {
    setSaving(true);
    try {
      await updateChannels(form);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } finally {
      setSaving(false);
    }
  };

  const runTest = async () => {
    const res = await testChannels();
    setTestResult(res);
    setTimeout(() => setTestResult(null), 5000);
  };

  return (
    <div style={{ overflowY: 'auto', height: '100%', padding: 24 }}>
      <div style={{ maxWidth: 560 }}>
        {/* Secret modal */}
        {secretModal && (
          <div style={{ position: 'fixed', inset: 0, zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,.4)' }}>
            <div style={{ backgroundColor: C.panel, borderRadius: 8, padding: 24, width: 440, boxShadow: '0 8px 32px rgba(0,0,0,.15)' }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: C.text, marginBottom: 6 }}>Webhook Created</div>
              <div style={{ fontSize: 12, color: C.error, fontWeight: 500, marginBottom: 12 }}>Save your secret — it won't be shown again</div>
              <div style={{ marginBottom: 8 }}>
                <div style={{ fontSize: 11, color: C.muted, marginBottom: 4 }}>URL</div>
                <code style={{ display: 'block', fontSize: 12, padding: '6px 10px', backgroundColor: C.bg, border: `1px solid ${C.border}`, borderRadius: 4 }}>{secretModal.url}</code>
              </div>
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 11, color: C.muted, marginBottom: 4 }}>Signing Secret</div>
                <code style={{ display: 'block', fontSize: 12, padding: '6px 10px', backgroundColor: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: 4, wordBreak: 'break-all' }}>{secretModal.secret}</code>
              </div>
              <button onClick={() => setSecretModal(null)} style={{ padding: '7px 18px', borderRadius: 4, fontSize: 13, fontWeight: 500, backgroundColor: C.accent, color: '#FFF', border: 'none', cursor: 'pointer' }}>I've saved it</button>
            </div>
          </div>
        )}

        {/* Webhooks */}
        <div style={{ fontSize: 14, fontWeight: 600, color: C.text, marginBottom: 12, paddingBottom: 8, borderBottom: `1px solid ${C.border}` }}>
          Outbound Webhooks
        </div>
        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          <input value={webhookUrl} onChange={e => setWebhookUrl(e.target.value)} placeholder="https://your-service.com/webhook" onKeyDown={e => e.key === 'Enter' && addWebhook()} style={{ ...inp, flex: 1 }} />
          <button onClick={addWebhook} disabled={adding || !webhookUrl.trim()} style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '0 14px', height: 32, borderRadius: 4, fontSize: 13, fontWeight: 500, backgroundColor: webhookUrl.trim() ? C.accent : C.bg, color: webhookUrl.trim() ? '#FFF' : C.muted, border: `1px solid ${webhookUrl.trim() ? C.accent : C.border}`, cursor: webhookUrl.trim() ? 'pointer' : 'not-allowed' }}>
            <Plus size={12} /> Add
          </button>
        </div>
        {webhooks.length === 0 && <div style={{ fontSize: 12, color: C.subtle, marginBottom: 16, padding: '10px 0' }}>No webhooks configured</div>}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 28 }}>
          {webhooks.map(w => (
            <div key={w.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', backgroundColor: C.bg, border: `1px solid ${C.border}`, borderRadius: 6 }}>
              <Webhook size={13} color={C.muted} style={{ flexShrink: 0 }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12, fontWeight: 500, color: C.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{w.url}</div>
                <div style={{ fontSize: 11, color: C.subtle }}>{new Date(w.created_at).toLocaleDateString()} · {w.enabled ? <span style={{ color: C.success }}>active</span> : <span style={{ color: C.muted }}>disabled</span>}</div>
              </div>
              <button onClick={() => deleteWebhook(w.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.subtle, lineHeight: 0, padding: 4 }}><Trash2 size={13} /></button>
            </div>
          ))}
        </div>

        {/* Delivery channels */}
        <div style={{ fontSize: 14, fontWeight: 600, color: C.text, marginBottom: 12, paddingBottom: 8, borderBottom: `1px solid ${C.border}` }}>
          Delivery Channels
        </div>

        <div style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
            <Mail size={14} color={C.muted} />
            <span style={{ fontSize: 13, fontWeight: 500, color: C.text }}>Email</span>
            <ToggleBtn value={form.email_enabled} onChange={v => setForm(f => ({ ...f, email_enabled: v }))} />
          </div>
          {form.email_enabled && (
            <input value={form.email_recipients} onChange={e => setForm(f => ({ ...f, email_recipients: e.target.value }))} placeholder="Comma-separated recipients" style={{ ...inp, width: '100%' }} />
          )}
        </div>

        <div style={{ marginBottom: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
            <Link size={14} color={C.muted} />
            <span style={{ fontSize: 13, fontWeight: 500, color: C.text }}>Slack</span>
            <ToggleBtn value={form.slack_enabled} onChange={v => setForm(f => ({ ...f, slack_enabled: v }))} />
          </div>
          {form.slack_enabled && (
            <input value={form.slack_webhook_url} onChange={e => setForm(f => ({ ...f, slack_webhook_url: e.target.value }))} placeholder="https://hooks.slack.com/services/…" style={{ ...inp, width: '100%' }} />
          )}
        </div>

        {testResult && (
          <div style={{ marginBottom: 12, padding: '8px 12px', borderRadius: 6, backgroundColor: testResult.ok ? '#F0FDF4' : C.criticalLight, border: `1px solid ${testResult.ok ? '#BBF7D0' : '#FECACA'}`, fontSize: 12, color: testResult.ok ? C.success : C.error }}>
            {testResult.ok ? 'Test delivered successfully' : 'Test failed'}{testResult.email ? ` · Email: ${testResult.email}` : ''}{testResult.slack ? ` · Slack: ${testResult.slack}` : ''}
          </div>
        )}

        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={saveChannels} disabled={saving} style={{ padding: '7px 18px', borderRadius: 4, fontSize: 13, fontWeight: 500, backgroundColor: saved ? '#F0FDF4' : C.accent, color: saved ? C.success : '#FFF', border: `1px solid ${saved ? '#BBF7D0' : C.accent}`, cursor: 'pointer' }}>
            {saving ? 'Saving…' : saved ? 'Saved' : 'Save'}
          </button>
          <button onClick={runTest} style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '7px 14px', borderRadius: 4, fontSize: 13, backgroundColor: C.bg, color: C.muted, border: `1px solid ${C.border}`, cursor: 'pointer' }}>
            <Zap size={12} /> Test Channels
          </button>
        </div>
      </div>
    </div>
  );
};

const ToggleBtn: React.FC<{ value: boolean; onChange: (v: boolean) => void }> = ({ value, onChange }) => (
  <button onClick={() => onChange(!value)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: value ? C.success : C.subtle, lineHeight: 0, padding: 0 }}>
    {value ? <ToggleRight size={20} /> : <ToggleLeft size={20} />}
  </button>
);

// ── Page shell ────────────────────────────────────────────────────────────────

type TabId = 'rules' | 'history' | 'channels';

const TABS: { id: TabId; label: string }[] = [
  { id: 'rules',    label: 'Rules' },
  { id: 'history',  label: 'History' },
  { id: 'channels', label: 'Channels' },
];

export const AlertsPage: React.FC = () => {
  const [tab, setTab] = useState<TabId>('rules');
  const { fetchRules, fetchNotifications, fetchWebhooks, fetchChannels, unreadCount } = useAlertStore();

  useEffect(() => {
    fetchRules();
    fetchNotifications();
    fetchWebhooks();
    fetchChannels();
  }, []);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', backgroundColor: C.bg, overflow: 'hidden' }}>
      {/* Header */}
      <div style={{ height: 52, backgroundColor: C.panel, borderBottom: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', padding: '0 24px', gap: 16, flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Bell size={16} color={C.accent} />
          <h1 style={{ fontSize: 15, fontWeight: 600, color: C.text, margin: 0 }}>Alert Center</h1>
          {unreadCount > 0 && (
            <span style={{ fontSize: 11, fontWeight: 700, padding: '1px 6px', borderRadius: 10, backgroundColor: C.error, color: '#FFF' }}>{unreadCount}</span>
          )}
        </div>
        <div style={{ display: 'flex', gap: 2, marginLeft: 'auto' }}>
          {TABS.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)} style={{ padding: '5px 14px', borderRadius: 4, fontSize: 13, fontWeight: tab === t.id ? 600 : 400, backgroundColor: tab === t.id ? C.accentLight : 'transparent', color: tab === t.id ? C.accent : C.muted, border: `1px solid ${tab === t.id ? C.accent : 'transparent'}`, cursor: 'pointer', transition: 'all 100ms' }}>
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Tab content */}
      <div style={{ flex: 1, overflow: 'hidden' }}>
        {tab === 'rules'    && <RulesTab />}
        {tab === 'history'  && <HistoryTab />}
        {tab === 'channels' && <ChannelsTab />}
      </div>
    </div>
  );
};

export default AlertsPage;
