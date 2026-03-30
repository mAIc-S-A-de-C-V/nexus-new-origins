import React, { useEffect, useState } from 'react';
import { Plus, Trash2, Play, ToggleLeft, ToggleRight, ChevronDown, ChevronRight } from 'lucide-react';
import { useAlertStore, AlertRule, RuleType } from '../../store/alertStore';

const RULE_TYPE_META: Record<RuleType, { label: string; description: string; configFields: ConfigField[] }> = {
  stuck_case: {
    label: 'Stuck Case',
    description: 'Fire when a case has not progressed for N hours.',
    configFields: [
      { key: 'threshold_hours', label: 'Hours without progress', type: 'number', default: 72 },
    ],
  },
  slow_transition: {
    label: 'Slow Transition',
    description: 'Fire when a specific step-to-step transition exceeds an average time.',
    configFields: [
      { key: 'from_activity', label: 'From stage', type: 'text', default: '' },
      { key: 'to_activity', label: 'To stage', type: 'text', default: '' },
      { key: 'threshold_hours', label: 'Threshold (hours)', type: 'number', default: 48 },
    ],
  },
  rework_spike: {
    label: 'Rework Spike',
    description: 'Fire when the % of cases with repeated stages exceeds a threshold.',
    configFields: [
      { key: 'threshold_pct', label: 'Rework % threshold', type: 'number', default: 20 },
    ],
  },
  case_volume_anomaly: {
    label: 'Volume Anomaly',
    description: 'Fire when recent case volume drops significantly vs baseline.',
    configFields: [
      { key: 'window_hours', label: 'Recent window (hours)', type: 'number', default: 24 },
      { key: 'min_drop_pct', label: 'Min drop % to trigger', type: 'number', default: 50 },
    ],
  },
};

interface ConfigField {
  key: string;
  label: string;
  type: 'text' | 'number';
  default: string | number;
}

interface Props {
  objectTypeId: string;
}

const severityColor = { warning: '#F59E0B', critical: '#EF4444' };

export const AlertRulesPanel: React.FC<Props> = ({ objectTypeId }) => {
  const { rules, loadingRules, fetchRules, createRule, updateRule, deleteRule, testRule } = useAlertStore();
  const [showCreate, setShowCreate] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<Record<string, { triggered: boolean; result: unknown } | null>>({});
  const [testing, setTesting] = useState<string | null>(null);

  useEffect(() => {
    fetchRules();
  }, []);

  const handleTest = async (id: string) => {
    setTesting(id);
    try {
      const res = await testRule(id);
      setTestResults(prev => ({ ...prev, [id]: res }));
    } finally {
      setTesting(null);
    }
  };

  return (
    <div style={{ flex: 1, overflow: 'auto', padding: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 16, gap: 12 }}>
        <h2 style={{ fontSize: 13, fontWeight: 600, color: '#0D1117', margin: 0 }}>Alert Rules</h2>
        <button
          onClick={() => setShowCreate(v => !v)}
          style={{
            display: 'flex', alignItems: 'center', gap: 6,
            height: 28, padding: '0 12px',
            backgroundColor: '#1E3A5F', color: '#FFFFFF',
            border: 'none', borderRadius: 4, fontSize: 12, fontWeight: 500,
            cursor: 'pointer',
          }}
        >
          <Plus size={13} />
          New Rule
        </button>
      </div>

      {showCreate && (
        <CreateRuleForm
          objectTypeId={objectTypeId}
          onSave={async (rule) => {
            await createRule(rule);
            setShowCreate(false);
          }}
          onCancel={() => setShowCreate(false)}
        />
      )}

      {loadingRules && (
        <div style={{ fontSize: 12, color: '#94A3B8', padding: '20px 0' }}>Loading rules…</div>
      )}

      {!loadingRules && rules.length === 0 && !showCreate && (
        <div style={{
          padding: 24, border: '1px dashed #E2E8F0', borderRadius: 6,
          textAlign: 'center', color: '#94A3B8', fontSize: 12,
        }}>
          No alert rules configured. Click "New Rule" to get started.
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {rules.map(rule => {
          const meta = RULE_TYPE_META[rule.rule_type as RuleType];
          const isExpanded = expandedId === rule.id;
          const testResult = testResults[rule.id];

          return (
            <div
              key={rule.id}
              style={{
                border: '1px solid #E2E8F0', borderRadius: 6, overflow: 'hidden',
                backgroundColor: '#FAFAFA',
              }}
            >
              {/* Rule header */}
              <div style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '10px 14px', cursor: 'pointer',
              }}
                onClick={() => setExpandedId(isExpanded ? null : rule.id)}
              >
                {isExpanded ? <ChevronDown size={13} color="#64748B" /> : <ChevronRight size={13} color="#64748B" />}

                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: '#0D1117' }}>{rule.name}</div>
                  <div style={{ fontSize: 11, color: '#94A3B8' }}>
                    {meta?.label} · cooldown {rule.cooldown_minutes}m
                    {rule.last_fired && ` · last fired ${new Date(rule.last_fired).toLocaleString()}`}
                  </div>
                </div>

                {/* Enable toggle */}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    updateRule(rule.id, { enabled: !rule.enabled });
                  }}
                  style={{ backgroundColor: 'transparent', border: 'none', cursor: 'pointer', padding: 0 }}
                  title={rule.enabled ? 'Disable' : 'Enable'}
                >
                  {rule.enabled
                    ? <ToggleRight size={20} color="#10B981" />
                    : <ToggleLeft size={20} color="#94A3B8" />}
                </button>

                {/* Test button */}
                <button
                  onClick={(e) => { e.stopPropagation(); handleTest(rule.id); }}
                  disabled={testing === rule.id}
                  title="Test now (ignores cooldown)"
                  style={{
                    display: 'flex', alignItems: 'center', gap: 4,
                    height: 26, padding: '0 10px',
                    backgroundColor: '#F1F5F9', color: '#475569',
                    border: '1px solid #E2E8F0', borderRadius: 4,
                    fontSize: 11, fontWeight: 500, cursor: 'pointer',
                  }}
                >
                  <Play size={11} />
                  {testing === rule.id ? '…' : 'Test'}
                </button>

                {/* Delete */}
                <button
                  onClick={(e) => { e.stopPropagation(); deleteRule(rule.id); }}
                  style={{ backgroundColor: 'transparent', border: 'none', cursor: 'pointer', color: '#94A3B8', padding: 2 }}
                  title="Delete rule"
                >
                  <Trash2 size={13} />
                </button>
              </div>

              {/* Test result banner */}
              {testResult !== undefined && testResult !== null && (
                <div style={{
                  padding: '6px 14px', fontSize: 11,
                  backgroundColor: testResult.triggered ? '#FEF3C7' : '#F0FDF4',
                  borderTop: '1px solid #E2E8F0',
                  color: testResult.triggered ? '#92400E' : '#166534',
                }}>
                  {testResult.triggered
                    ? `Would fire: ${(testResult.result as Record<string, unknown>)?.message}`
                    : 'No alert condition detected with current data.'}
                </div>
              )}

              {/* Expanded config editor */}
              {isExpanded && meta && (
                <RuleConfigEditor
                  rule={rule}
                  meta={meta}
                  onSave={(updates) => updateRule(rule.id, updates)}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};


// ── Create form ────────────────────────────────────────────────────────────────

const CreateRuleForm: React.FC<{
  objectTypeId: string;
  onSave: (rule: Omit<AlertRule, 'id' | 'created_at' | 'last_fired'>) => Promise<void>;
  onCancel: () => void;
}> = ({ objectTypeId, onSave, onCancel }) => {
  const [name, setName] = useState('');
  const [ruleType, setRuleType] = useState<RuleType>('stuck_case');
  const [cooldown, setCooldown] = useState(60);
  const [config, setConfig] = useState<Record<string, unknown>>({});
  const [saving, setSaving] = useState(false);

  const meta = RULE_TYPE_META[ruleType];

  const handleSave = async () => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      const fullConfig = { object_type_id: objectTypeId, ...config };
      await onSave({
        name: name.trim(),
        rule_type: ruleType,
        object_type_id: objectTypeId,
        config: fullConfig,
        cooldown_minutes: cooldown,
        enabled: true,
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{
      border: '1px solid #1E3A5F', borderRadius: 6, padding: 16,
      marginBottom: 12, backgroundColor: '#F8FAFC',
    }}>
      <div style={{ fontSize: 13, fontWeight: 600, color: '#0D1117', marginBottom: 12 }}>New Alert Rule</div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 }}>
        <label style={labelStyle}>
          Rule name
          <input
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="e.g. Deals stuck 3 days"
            style={inputStyle}
          />
        </label>

        <label style={labelStyle}>
          Rule type
          <select
            value={ruleType}
            onChange={e => { setRuleType(e.target.value as RuleType); setConfig({}); }}
            style={inputStyle}
          >
            {(Object.entries(RULE_TYPE_META) as [RuleType, (typeof RULE_TYPE_META)[RuleType]][]).map(([k, v]) => (
              <option key={k} value={k}>{v.label}</option>
            ))}
          </select>
        </label>
      </div>

      <div style={{ fontSize: 11, color: '#64748B', marginBottom: 10 }}>{meta.description}</div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 10, marginBottom: 12 }}>
        {meta.configFields.map(f => (
          <label key={f.key} style={labelStyle}>
            {f.label}
            <input
              type={f.type}
              value={String(config[f.key] ?? f.default)}
              onChange={e => setConfig(prev => ({
                ...prev,
                [f.key]: f.type === 'number' ? Number(e.target.value) : e.target.value,
              }))}
              style={inputStyle}
            />
          </label>
        ))}
        <label style={labelStyle}>
          Cooldown (minutes)
          <input
            type="number"
            value={cooldown}
            onChange={e => setCooldown(Number(e.target.value))}
            style={inputStyle}
          />
        </label>
      </div>

      <div style={{ display: 'flex', gap: 8 }}>
        <button
          onClick={handleSave}
          disabled={saving || !name.trim()}
          style={{
            height: 28, padding: '0 14px',
            backgroundColor: '#1E3A5F', color: '#FFFFFF',
            border: 'none', borderRadius: 4, fontSize: 12, fontWeight: 500,
            cursor: saving ? 'wait' : 'pointer', opacity: !name.trim() ? 0.5 : 1,
          }}
        >
          {saving ? 'Saving…' : 'Save Rule'}
        </button>
        <button
          onClick={onCancel}
          style={{
            height: 28, padding: '0 14px',
            backgroundColor: '#F1F5F9', color: '#475569',
            border: '1px solid #E2E8F0', borderRadius: 4, fontSize: 12, cursor: 'pointer',
          }}
        >
          Cancel
        </button>
      </div>
    </div>
  );
};


// ── Config editor (inside expanded rule) ──────────────────────────────────────

const RuleConfigEditor: React.FC<{
  rule: AlertRule;
  meta: typeof RULE_TYPE_META[RuleType];
  onSave: (updates: Partial<Pick<AlertRule, 'name' | 'config' | 'cooldown_minutes' | 'enabled'>>) => void;
}> = ({ rule, meta, onSave }) => {
  const [config, setConfig] = useState<Record<string, unknown>>(rule.config);
  const [cooldown, setCooldown] = useState(rule.cooldown_minutes);
  const [dirty, setDirty] = useState(false);

  return (
    <div style={{ padding: '12px 14px', borderTop: '1px solid #E2E8F0', backgroundColor: '#FFFFFF' }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 10, marginBottom: 10 }}>
        {meta.configFields.map(f => (
          <label key={f.key} style={labelStyle}>
            {f.label}
            <input
              type={f.type}
              value={String(config[f.key] ?? f.default)}
              onChange={e => {
                setConfig(prev => ({
                  ...prev,
                  [f.key]: f.type === 'number' ? Number(e.target.value) : e.target.value,
                }));
                setDirty(true);
              }}
              style={inputStyle}
            />
          </label>
        ))}
        <label style={labelStyle}>
          Cooldown (minutes)
          <input
            type="number"
            value={cooldown}
            onChange={e => { setCooldown(Number(e.target.value)); setDirty(true); }}
            style={inputStyle}
          />
        </label>
      </div>
      {dirty && (
        <button
          onClick={() => { onSave({ config, cooldown_minutes: cooldown }); setDirty(false); }}
          style={{
            height: 26, padding: '0 12px',
            backgroundColor: '#1E3A5F', color: '#FFFFFF',
            border: 'none', borderRadius: 4, fontSize: 11, fontWeight: 500, cursor: 'pointer',
          }}
        >
          Save changes
        </button>
      )}
    </div>
  );
};

// ── Shared styles ──────────────────────────────────────────────────────────────

const labelStyle: React.CSSProperties = {
  display: 'flex', flexDirection: 'column', gap: 4,
  fontSize: 11, color: '#64748B', fontWeight: 500,
};

const inputStyle: React.CSSProperties = {
  height: 28, padding: '0 8px', borderRadius: 4,
  border: '1px solid #E2E8F0', backgroundColor: '#FFFFFF',
  fontSize: 12, color: '#0D1117', outline: 'none',
};
