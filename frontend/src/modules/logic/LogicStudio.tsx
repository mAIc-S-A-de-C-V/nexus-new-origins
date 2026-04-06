import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useLogicStore, LogicFunction, Block } from '../../store/logicStore';
import { useUtilityStore } from '../../store/utilityStore';
import { Plus, Play, Save, Trash2, ChevronRight, CheckCircle, XCircle, Loader, BookOpen, Clock, Wrench } from 'lucide-react';

// ── Colour palette (light) ────────────────────────────────────────────────────
const C = {
  bg: '#F8FAFC', sidebar: '#F1F5F9', panel: '#FFFFFF', card: '#F8FAFC',
  border: '#E2E8F0', accent: '#7C3AED', accentDim: '#EDE9FE',
  text: '#0D1117', muted: '#64748B', dim: '#94A3B8',
  success: '#059669', error: '#DC2626', warn: '#D97706',
};

const BLOCK_TYPES = [
  { type: 'ontology_query', label: 'Ontology Query', color: '#3B82F6', desc: 'Fetch records from ontology' },
  { type: 'llm_call',       label: 'LLM Call',       color: '#7C3AED', desc: 'Call Claude with a prompt' },
  { type: 'send_email',     label: 'Send Email',     color: '#EC4899', desc: 'Send emails via SMTP' },
  { type: 'action',           label: 'Action',           color: '#F59E0B', desc: 'Propose a write action' },
  { type: 'ontology_update',  label: 'Ontology Update',  color: '#059669', desc: 'Write fields back to an ontology record' },
  { type: 'transform',        label: 'Transform',        color: '#10B981', desc: 'Transform data in memory' },
  { type: 'utility_call',     label: 'Utility Call',     color: '#0891B2', desc: 'Run a utility (OCR, scrape, geocode…)' },
];

const blockColor = (type: string) => BLOCK_TYPES.find((b) => b.type === type)?.color ?? C.dim;

function uid() { return Math.random().toString(36).slice(2, 9); }

// ── Block Editor ─────────────────────────────────────────────────────────────

// ── Filter row types ──────────────────────────────────────────────────────────

interface FilterRow { field: string; op: string; value: string; }

const OPS = [
  { value: '==',          label: 'equals' },
  { value: '!=',          label: 'not equals' },
  { value: 'contains',    label: 'contains' },
  { value: 'not_contains',label: 'does not contain' },
  { value: 'starts_with', label: 'starts with' },
  { value: '>',           label: 'greater than' },
  { value: '>=',          label: 'greater than or equal' },
  { value: '<',           label: 'less than' },
  { value: '<=',          label: 'less than or equal' },
  { value: 'is_empty',    label: 'is empty' },
  { value: 'is_not_empty',label: 'is not empty' },
];

const NO_VALUE_OPS = ['is_empty', 'is_not_empty'];

// ── FilterBuilder ─────────────────────────────────────────────────────────────

const FilterBuilder: React.FC<{
  filters: FilterRow[];
  properties: { name: string; display_name: string; data_type: string; sample_values: string[] }[];
  onChange: (filters: FilterRow[]) => void;
  inputSchema: { name: string; type: string }[];
}> = ({ filters, properties, onChange, inputSchema }) => {
  // Track which rows are in "custom" text mode separately from the value itself
  const [customRows, setCustomRows] = useState<Set<number>>(new Set());

  const sel: React.CSSProperties = {
    backgroundColor: C.bg, border: `1px solid ${C.border}`, color: C.text,
    padding: '5px 8px', fontSize: 12, outline: 'none', height: 30,
  };

  const addFilter = () => onChange([...filters, { field: properties[0]?.name || '', op: '==', value: '' }]);
  const removeFilter = (i: number) => {
    setCustomRows((prev) => { const s = new Set(prev); s.delete(i); return s; });
    onChange(filters.filter((_, idx) => idx !== i));
  };
  const updateFilter = (i: number, patch: Partial<FilterRow>) => {
    const next = filters.map((f, idx) => idx === i ? { ...f, ...patch } : f);
    onChange(next);
  };

  // Parameter options to show in every value dropdown
  const paramOptions = inputSchema.map((p) => ({
    label: `{inputs.${p.name}}`,
    value: `{inputs.${p.name}}`,
  }));

  return (
    <div>
      {filters.length === 0 && (
        <div style={{ fontSize: 12, color: C.dim, fontStyle: 'italic', marginBottom: 6 }}>
          No filters — returns all records
        </div>
      )}
      {filters.map((f, i) => {
        const prop = properties.find((p) => p.name === f.field);
        const samples = prop?.sample_values?.filter(Boolean) || [];
        const noVal = NO_VALUE_OPS.includes(f.op);
        const isCustom = customRows.has(i);
        // Show dropdown when we have samples OR parameters; otherwise plain input
        const hasOptions = samples.length > 0 || paramOptions.length > 0;

        return (
          <div key={i} style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 6, flexWrap: 'wrap' }}>
            {i > 0 && (
              <span style={{ fontSize: 11, color: C.accent, fontWeight: 600, minWidth: 28 }}>AND</span>
            )}

            {/* Field */}
            <select style={{ ...sel, flex: 1, minWidth: 120 }} value={f.field}
              onChange={(e) => updateFilter(i, { field: e.target.value, value: '' })}>
              <option value="">— field —</option>
              {properties.map((p) => (
                <option key={p.name} value={p.name}>{p.display_name || p.name}</option>
              ))}
            </select>

            {/* Operator */}
            <select style={{ ...sel, minWidth: 140 }} value={f.op}
              onChange={(e) => updateFilter(i, { op: e.target.value })}>
              {OPS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>

            {/* Value */}
            {!noVal && !isCustom && hasOptions && (
              <select
                style={{ ...sel, flex: 1, minWidth: 140 }}
                value={paramOptions.some((p) => p.value === f.value) ? f.value : (samples.includes(f.value) ? f.value : '')}
                onChange={(e) => {
                  if (e.target.value === '__custom__') {
                    setCustomRows((prev) => new Set(prev).add(i));
                    updateFilter(i, { value: '' });
                  } else {
                    updateFilter(i, { value: e.target.value });
                  }
                }}
              >
                <option value="">— select value —</option>
                {paramOptions.length > 0 && (
                  <optgroup label="Function Parameters">
                    {paramOptions.map((p) => (
                      <option key={p.value} value={p.value}>{p.label}</option>
                    ))}
                  </optgroup>
                )}
                <optgroup label="Built-in Time Variables">
                  {[
                    { value: '{now}',           label: '{now} — current UTC time' },
                    { value: '{now_minus_1d}',  label: '{now_minus_1d} — 1 day ago' },
                    { value: '{now_minus_3d}',  label: '{now_minus_3d} — 3 days ago' },
                    { value: '{now_minus_7d}',  label: '{now_minus_7d} — 7 days ago' },
                    { value: '{now_minus_14d}', label: '{now_minus_14d} — 14 days ago' },
                    { value: '{now_minus_30d}', label: '{now_minus_30d} — 30 days ago' },
                    { value: '{now_minus_90d}', label: '{now_minus_90d} — 90 days ago' },
                  ].map((t) => (
                    <option key={t.value} value={t.value}>{t.label}</option>
                  ))}
                </optgroup>
                {samples.length > 0 && (
                  <optgroup label="Known Values">
                    {samples.map((s) => <option key={s} value={s}>{s}</option>)}
                  </optgroup>
                )}
                <option value="__custom__">Custom value…</option>
              </select>
            )}

            {!noVal && !isCustom && !hasOptions && (
              <input
                style={{ ...sel, flex: 1, minWidth: 140 }}
                value={f.value}
                placeholder="value or {inputs.x}"
                onChange={(e) => updateFilter(i, { value: e.target.value })}
              />
            )}

            {!noVal && isCustom && (
              <div style={{ flex: 1, minWidth: 140, display: 'flex', gap: 4 }}>
                <input
                  autoFocus
                  style={{ ...sel, flex: 1 }}
                  value={f.value}
                  placeholder="custom value or {inputs.x}"
                  onChange={(e) => updateFilter(i, { value: e.target.value })}
                />
                <button
                  onClick={() => { setCustomRows((prev) => { const s = new Set(prev); s.delete(i); return s; }); updateFilter(i, { value: '' }); }}
                  style={{ ...sel, cursor: 'pointer', fontSize: 11, color: C.muted, whiteSpace: 'nowrap' }}
                  title="Back to dropdown"
                >
                  ↩
                </button>
              </div>
            )}

            <button onClick={() => removeFilter(i)}
              style={{ background: 'none', border: 'none', color: C.muted, cursor: 'pointer', padding: 2, lineHeight: 0, flexShrink: 0 }}>
              <Trash2 size={13} />
            </button>
          </div>
        );
      })}
      <button onClick={addFilter} style={{
        fontSize: 11, color: C.accent, border: `1px dashed ${C.accent}44`,
        backgroundColor: 'transparent', padding: '4px 10px', cursor: 'pointer',
        display: 'flex', gap: 4, alignItems: 'center', marginTop: 2,
      }}>
        <Plus size={11} /> Add filter
      </button>
    </div>
  );
};

// ── Block Editor ─────────────────────────────────────────────────────────────

const BlockEditor: React.FC<{
  block: Block;
  onChange: (b: Block) => void;
  onRemove: () => void;
  isOutput: boolean;
  onSetOutput: () => void;
  objectTypes: { id: string; name: string; display_name?: string; displayName?: string; properties?: any[] }[];
  inputSchema: { name: string; type: string }[];
}> = ({ block, onChange, onRemove, isOutput, onSetOutput, objectTypes, inputSchema }) => {
  const u = (patch: Partial<Block>) => onChange({ ...block, ...patch });
  const [otProperties, setOtProperties] = useState<any[]>([]);
  const { utilities, fetchUtilities } = useUtilityStore();

  useEffect(() => {
    if (block.type === 'utility_call' && utilities.length === 0) fetchUtilities();
  }, [block.type]);

  // When object_type changes, load its properties
  useEffect(() => {
    const typeName = block.config?.object_type as string;
    if (!typeName || block.type !== 'ontology_query') { setOtProperties([]); return; }
    const ot = objectTypes.find((o) => o.name === typeName || o.displayName === typeName || o.display_name === typeName);
    if (ot?.properties) {
      setOtProperties(ot.properties);
    } else if (ot?.id) {
      const ontologyUrl = import.meta.env.VITE_ONTOLOGY_SERVICE_URL || 'http://localhost:8004';
      fetch(`${ontologyUrl}/object-types/${ot.id}`, { headers: { 'x-tenant-id': 'tenant-001' } })
        .then((r) => r.json())
        .then((data) => setOtProperties(data.properties || []))
        .catch(() => setOtProperties([]));
    }
  }, [block.config?.object_type, objectTypes, block.type]);

  const inputStyle: React.CSSProperties = {
    width: '100%', backgroundColor: C.bg, border: `1px solid ${C.border}`,
    color: C.text, padding: '6px 8px', fontSize: 12, outline: 'none',
    fontFamily: 'monospace', boxSizing: 'border-box',
  };
  const labelStyle: React.CSSProperties = { fontSize: 11, color: C.muted, marginBottom: 3, display: 'block' };

  return (
    <div style={{
      border: `1px solid ${isOutput ? C.accent : C.border}`,
      backgroundColor: C.card, marginBottom: 8,
      outline: isOutput ? `1px solid ${C.accent}` : 'none',
    }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '7px 10px', borderBottom: `1px solid ${C.border}`,
        backgroundColor: C.sidebar,
      }}>
        <div style={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: blockColor(block.type), flexShrink: 0 }} />
        <input
          value={block.label || ''}
          onChange={(e) => u({ label: e.target.value })}
          placeholder={block.id}
          style={{ ...inputStyle, border: 'none', backgroundColor: 'transparent', padding: '0', fontFamily: 'inherit', flex: 1, fontSize: 13, fontWeight: 500 }}
        />
        <span style={{ fontSize: 10, color: blockColor(block.type), backgroundColor: C.bg, padding: '2px 6px', flexShrink: 0 }}>
          {block.type}
        </span>
        <span style={{ fontSize: 10, color: C.muted, fontFamily: 'monospace' }}>{block.id}</span>
        <button
          onClick={onSetOutput}
          title="Set as output block"
          style={{
            fontSize: 10, padding: '2px 6px', border: `1px solid ${isOutput ? C.accent : C.border}`,
            backgroundColor: isOutput ? C.accentDim : 'transparent', color: isOutput ? C.accent : C.dim,
            cursor: 'pointer', flexShrink: 0,
          }}
        >
          {isOutput ? 'OUTPUT' : 'set output'}
        </button>
        <button onClick={onRemove} style={{ background: 'none', border: 'none', color: C.muted, cursor: 'pointer', padding: 2, lineHeight: 0 }}>
          <Trash2 size={13} />
        </button>
      </div>

      {/* Body */}
      <div style={{ padding: 10, display: 'flex', flexDirection: 'column', gap: 10 }}>
        {block.type === 'ontology_query' && (
          <>
            <div>
              <label style={labelStyle}>Object Type</label>
              <select
                style={{ ...inputStyle, fontFamily: 'system-ui' }}
                value={(block.config?.object_type as string) || ''}
                onChange={(e) => u({ config: { ...block.config, object_type: e.target.value, filters: [] } })}
              >
                <option value="">— select an object type —</option>
                {objectTypes.map((ot) => (
                  <option key={ot.id} value={ot.name}>{ot.display_name || ot.displayName || ot.name}</option>
                ))}
              </select>
            </div>

            <div>
              <label style={labelStyle}>Filters</label>
              {!(block.config?.object_type as string) && (
                <div style={{ fontSize: 12, color: C.dim, fontStyle: 'italic' }}>Select an object type first</div>
              )}
              {!!(block.config?.object_type as string) && (
                <FilterBuilder
                  filters={(block.config?.filters as FilterRow[]) || []}
                  properties={otProperties}
                  onChange={(filters) => u({ config: { ...block.config, filters } })}
                  inputSchema={inputSchema}
                />
              )}
            </div>

            <div>
              <label style={labelStyle}>Limit</label>
              <input style={{ ...inputStyle, width: 80 }} type="number" value={(block.config?.limit as number) || 10}
                onChange={(e) => u({ config: { ...block.config, limit: parseInt(e.target.value) || 10 } })} />
            </div>
          </>
        )}

        {block.type === 'llm_call' && (
          <>
            <div>
              <label style={labelStyle}>system_prompt</label>
              <textarea style={{ ...inputStyle, resize: 'vertical', minHeight: 48 }} value={block.system_prompt || ''}
                onChange={(e) => u({ system_prompt: e.target.value })} />
            </div>
            <div>
              <label style={labelStyle}>prompt_template (use &#123;inputs.x&#125; or &#123;b1.result&#125;)</label>
              <textarea style={{ ...inputStyle, resize: 'vertical', minHeight: 80 }} value={block.prompt_template || ''}
                onChange={(e) => u({ prompt_template: e.target.value })} />
            </div>
            <div>
              <label style={labelStyle}>output_schema (JSON, optional)</label>
              <textarea style={{ ...inputStyle, resize: 'vertical', minHeight: 48, fontSize: 11 }}
                value={block.output_schema ? JSON.stringify(block.output_schema, null, 2) : ''}
                onChange={(e) => {
                  try { u({ output_schema: JSON.parse(e.target.value) }); }
                  catch { /* keep typing */ }
                }} />
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <div style={{ flex: 1 }}>
                <label style={labelStyle}>model</label>
                <select style={{ ...inputStyle }} value={block.model || 'claude-haiku-4-5-20251001'}
                  onChange={(e) => u({ model: e.target.value })}>
                  <option value="claude-haiku-4-5-20251001">Haiku 4.5</option>
                  <option value="claude-sonnet-4-6">Sonnet 4.6</option>
                  <option value="claude-opus-4-6">Opus 4.6</option>
                </select>
              </div>
              <div>
                <label style={labelStyle}>max_tokens</label>
                <input style={{ ...inputStyle, width: 90 }} type="number" value={block.max_tokens || 1024}
                  onChange={(e) => u({ max_tokens: parseInt(e.target.value) || 1024 })} />
              </div>
            </div>
          </>
        )}

        {block.type === 'send_email' && (
          <>
            <div style={{
              backgroundColor: '#FDF2F8', border: '1px solid #FBCFE8',
              padding: '8px 10px', fontSize: 11, color: '#9D174D', marginBottom: 4,
            }}>
              Sends one email per item in a list, or a single email if <code>to</code> is a string.
              Use <code style={{ backgroundColor: '#FCE7F3', padding: '0 3px' }}>{'{b1.result.records}'}</code> to reference previous blocks.
            </div>
            <div>
              <label style={labelStyle}>To (email address or <code>{'{block.result.owner_email}'}</code>)</label>
              <input style={inputStyle} value={block.to || ''} placeholder="sales@company.com or {b2.result.emails}"
                onChange={(e) => u({ to: e.target.value })} />
            </div>
            <div>
              <label style={labelStyle}>Subject</label>
              <input style={inputStyle} value={block.subject || ''} placeholder="Deal needs your attention: {inputs.deal_name}"
                onChange={(e) => u({ subject: e.target.value })} />
            </div>
            <div>
              <label style={labelStyle}>Body (plain text or use a previous block's output)</label>
              <textarea style={{ ...inputStyle, resize: 'vertical', minHeight: 100, fontFamily: 'system-ui' }}
                value={block.body || ''}
                placeholder={`Hi,\n\nThe following deals haven't moved:\n\n{b1.result.records}\n\nWhat's going on?`}
                onChange={(e) => u({ body: e.target.value })} />
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <div style={{ flex: 1 }}>
                <label style={labelStyle}>From name (optional)</label>
                <input style={inputStyle} value={block.from_name || ''} placeholder="Sales Manager"
                  onChange={(e) => u({ from_name: e.target.value })} />
              </div>
              <div style={{ flex: 1 }}>
                <label style={labelStyle}>BCC (optional)</label>
                <input style={inputStyle} value={block.bcc || ''} placeholder="you@company.com"
                  onChange={(e) => u({ bcc: e.target.value })} />
              </div>
            </div>
            <div style={{ fontSize: 11, color: C.dim }}>
              SMTP configured via <code>SMTP_HOST</code>, <code>SMTP_USER</code>, <code>SMTP_PASSWORD</code> env vars on the logic service.
            </div>
          </>
        )}

        {block.type === 'action' && (
          <>
            <div>
              <label style={labelStyle}>action_name</label>
              <input style={inputStyle} value={block.action_name || ''} placeholder="e.g. updateDealStage"
                onChange={(e) => u({ action_name: e.target.value })} />
            </div>
            <div>
              <label style={labelStyle}>params (JSON)</label>
              <textarea style={{ ...inputStyle, resize: 'vertical', minHeight: 64, fontSize: 11 }}
                value={block.params ? JSON.stringify(block.params, null, 2) : ''}
                onChange={(e) => {
                  try { u({ params: JSON.parse(e.target.value) }); }
                  catch { /* keep typing */ }
                }} />
            </div>
            <div>
              <label style={labelStyle}>reasoning</label>
              <input style={inputStyle} value={block.reasoning || ''} placeholder="Why is this action being proposed?"
                onChange={(e) => u({ reasoning: e.target.value })} />
            </div>
          </>
        )}

        {block.type === 'ontology_update' && (
          <>
            <div>
              <label style={labelStyle}>Object Type</label>
              <select style={inputStyle}
                value={(block.config as Record<string,string>)?.object_type_id || ''}
                onChange={(e) => u({ config: { ...(block.config as object || {}), object_type_id: e.target.value } })}>
                <option value="">— select object type —</option>
                {objectTypes.map((ot) => (
                  <option key={ot.id} value={ot.id}>
                    {ot.display_name || ot.displayName || ot.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label style={labelStyle}>match_field — field used to find the record</label>
              <input style={inputStyle} value={(block.config as Record<string,string>)?.match_field || ''}
                placeholder="e.g. borrower_id"
                onChange={(e) => u({ config: { ...(block.config as object || {}), match_field: e.target.value } })} />
            </div>
            <div>
              <label style={labelStyle}>match_value — use {'{'}{'{'}b1.result.records[0].borrower_id{'}'}{'}'}</label>
              <input style={inputStyle} value={(block.config as Record<string,string>)?.match_value || ''}
                placeholder="{b1.result.records[0].borrower_id}"
                onChange={(e) => u({ config: { ...(block.config as object || {}), match_value: e.target.value } })} />
            </div>
            <div>
              <label style={labelStyle}>fields (JSON) — field → value to write</label>
              <textarea style={{ ...inputStyle, resize: 'vertical', minHeight: 80, fontSize: 11 }}
                value={typeof (block.config as Record<string,unknown>)?.fields === 'object'
                  ? JSON.stringify((block.config as Record<string,unknown>).fields, null, 2)
                  : ((block.config as Record<string,string>)?.fields || '')}
                placeholder={'{\n  "risk_score": "{b4.result.risk_score}",\n  "risk_category": "{b4.result.risk_category}"\n}'}
                onChange={(e) => {
                  try { u({ config: { ...(block.config as object || {}), fields: JSON.parse(e.target.value) } }); }
                  catch { /* keep typing */ }
                }} />
            </div>
          </>
        )}

        {block.type === 'transform' && (
          <>
            <div>
              <label style={labelStyle}>operation</label>
              <select style={inputStyle} value={block.operation || 'pass'} onChange={(e) => u({ operation: e.target.value })}>
                <option value="pass">pass</option>
                <option value="extract_field">extract_field</option>
                <option value="format_string">format_string</option>
                <option value="filter_list">filter_list</option>
              </select>
            </div>
            <div>
              <label style={labelStyle}>source (e.g. b1.result)</label>
              <input style={inputStyle} value={block.source || ''} onChange={(e) => u({ source: e.target.value })} />
            </div>
            {(block.operation === 'extract_field' || block.operation === 'filter_list') && (
              <div>
                <label style={labelStyle}>field</label>
                <input style={inputStyle} value={block.field || ''} onChange={(e) => u({ field: e.target.value })} />
              </div>
            )}
            {block.operation === 'filter_list' && (
              <div>
                <label style={labelStyle}>value</label>
                <input style={inputStyle} value={block.value || ''} onChange={(e) => u({ value: e.target.value })} />
              </div>
            )}
            {block.operation === 'format_string' && (
              <div>
                <label style={labelStyle}>template</label>
                <input style={inputStyle} value={block.template || ''} onChange={(e) => u({ template: e.target.value })} />
              </div>
            )}
          </>
        )}

        {block.type === 'utility_call' && (() => {
          const selectedUtil = utilities.find((u2) => u2.id === block.utility_id);
          const paramsStr = block.utility_params ? JSON.stringify(block.utility_params, null, 2) : '{}';
          return (
            <>
              <div style={{
                backgroundColor: '#F0F9FF', border: '1px solid #BAE6FD',
                padding: '8px 10px', fontSize: 11, color: '#0369A1', marginBottom: 4, borderRadius: 2,
              }}>
                <Wrench size={11} style={{ display: 'inline', marginRight: 5 }} />
                Call a pre-built utility. Use <code>{'{'}{'{'}b1.result.field{'}'}{'}'}</code> references in params values.
              </div>
              <div>
                <label style={labelStyle}>Utility</label>
                <select
                  style={{ ...inputStyle, fontFamily: 'system-ui' }}
                  value={block.utility_id || ''}
                  onChange={(e) => u({ utility_id: e.target.value, utility_params: {} })}
                >
                  <option value="">— select a utility —</option>
                  {['Document', 'Web', 'Vision', 'Geo', 'Notify'].map((cat) => {
                    const items = utilities.filter((ut) => ut.category === cat);
                    if (!items.length) return null;
                    return (
                      <optgroup key={cat} label={cat}>
                        {items.map((ut) => (
                          <option key={ut.id} value={ut.id}>{ut.name}</option>
                        ))}
                      </optgroup>
                    );
                  })}
                </select>
              </div>

              {selectedUtil && (
                <div style={{ fontSize: 11, color: C.muted, padding: '4px 0' }}>
                  {selectedUtil.description}
                </div>
              )}

              {selectedUtil && (
                <div>
                  <label style={labelStyle}>
                    Params (JSON) — use {'{'}inputs.x{'}'} or {'{'}b1.result.field{'}'}
                  </label>
                  {selectedUtil.input_schema.length > 0 && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 6 }}>
                      {selectedUtil.input_schema.map((f) => (
                        <span key={f.name} style={{
                          fontSize: 10, padding: '1px 6px', borderRadius: 3,
                          backgroundColor: f.required ? '#FEF3C7' : C.bg,
                          border: `1px solid ${f.required ? '#FCD34D' : C.border}`,
                          color: f.required ? '#92400E' : C.muted,
                          cursor: 'pointer',
                        }} title={f.description}
                        onClick={() => {
                          try {
                            const current = JSON.parse(paramsStr) || {};
                            if (!(f.name in current)) {
                              current[f.name] = '';
                              u({ utility_params: current });
                            }
                          } catch { /* ignore */ }
                        }}>
                          {f.required ? '* ' : ''}{f.name}
                        </span>
                      ))}
                    </div>
                  )}
                  <textarea
                    style={{ ...inputStyle, resize: 'vertical', minHeight: 80, fontSize: 11 }}
                    value={paramsStr}
                    onChange={(e) => {
                      try { u({ utility_params: JSON.parse(e.target.value) }); }
                      catch { /* keep typing */ }
                    }}
                  />
                </div>
              )}
            </>
          );
        })()}
      </div>
    </div>
  );
};

// ── Run Trace Panel ───────────────────────────────────────────────────────────

const TracePanel: React.FC<{ run: any; blocks: Block[] }> = ({ run, blocks }) => {
  const trace = run?.trace || {};
  const blockIds = blocks.map((b) => b.id);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {blockIds.map((bid) => {
        const t = trace[bid];
        if (!t) return null;
        return (
          <div key={bid} style={{ border: `1px solid ${C.border}`, backgroundColor: C.card }}>
            <div style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '6px 10px', borderBottom: `1px solid ${C.border}`, backgroundColor: C.sidebar,
            }}>
              {t.status === 'completed' ? <CheckCircle size={12} color={C.success} /> : <XCircle size={12} color={C.error} />}
              <span style={{ fontSize: 12, fontWeight: 500, color: C.text }}>{bid}</span>
              <span style={{ marginLeft: 'auto', fontSize: 11, color: C.muted }}>{t.duration_ms}ms</span>
            </div>
            <pre style={{
              margin: 0, padding: 8, fontSize: 11, color: C.text,
              overflowX: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-all',
              maxHeight: 200, overflowY: 'auto',
            }}>
              {t.error ? `ERROR: ${t.error}` : JSON.stringify(t.result, null, 2)}
            </pre>
          </div>
        );
      })}
      {run?.output !== undefined && (
        <div style={{ border: `1px solid ${C.accent}`, backgroundColor: C.accentDim, padding: 10 }}>
          <div style={{ fontSize: 11, color: C.accent, marginBottom: 6, fontWeight: 600 }}>FINAL OUTPUT</div>
          <pre style={{ margin: 0, fontSize: 11, color: C.text, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
            {JSON.stringify(run.output, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
};

// ── Main LogicStudio ─────────────────────────────────────────────────────────

const LogicStudio: React.FC = () => {
  const {
    functions, selectedFn, lastRun, loading, running,
    fetchFunctions, selectFunction, createFunction, updateFunction,
    deleteFunction, publishFunction, runSync,
  } = useLogicStore();
  const { fetchUtilities } = useUtilityStore();

  const [localFn, setLocalFn] = useState<LogicFunction | null>(null);
  const [testInputs, setTestInputs] = useState('{}');
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState<'editor' | 'debug' | 'schedule'>('editor');
  const [objectTypes, setObjectTypes] = useState<{ id: string; name: string; display_name?: string; displayName?: string; properties?: any[] }[]>([]);

  // Schedule state
  const [schedules, setSchedules] = useState<any[]>([]);
  const [schedCron, setSchedCron] = useState('0 9 * * 1-5');
  const [schedLabel, setSchedLabel] = useState('Every weekday at 9am UTC');
  const [schedInputs, setSchedInputs] = useState('{}');
  const [schedSaving, setSchedSaving] = useState(false);

  const logicUrl = import.meta.env.VITE_LOGIC_SERVICE_URL || 'http://localhost:8012';

  const fetchSchedules = async (fnId: string) => {
    try {
      const r = await fetch(`${logicUrl}/logic/functions/${fnId}/schedules`, {
        headers: { 'x-tenant-id': 'tenant-001' },
      });
      const data = await r.json();
      setSchedules(Array.isArray(data) ? data : []);
    } catch { setSchedules([]); }
  };

  const createSchedule = async () => {
    if (!localFn) return;
    let inputs: any = {};
    try { inputs = JSON.parse(schedInputs); } catch { alert('Invalid JSON inputs'); return; }
    setSchedSaving(true);
    try {
      await fetch(`${logicUrl}/logic/functions/${localFn.id}/schedules`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-tenant-id': 'tenant-001' },
        body: JSON.stringify({ cron: schedCron, label: schedLabel, inputs, enabled: true }),
      });
      await fetchSchedules(localFn.id);
    } finally { setSchedSaving(false); }
  };

  const toggleSchedule = async (s: any) => {
    if (!localFn) return;
    await fetch(`${logicUrl}/logic/functions/${localFn.id}/schedules/${s.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'x-tenant-id': 'tenant-001' },
      body: JSON.stringify({ enabled: !s.enabled }),
    });
    await fetchSchedules(localFn.id);
  };

  const deleteSchedule = async (s: any) => {
    if (!localFn) return;
    await fetch(`${logicUrl}/logic/functions/${localFn.id}/schedules/${s.id}`, {
      method: 'DELETE',
      headers: { 'x-tenant-id': 'tenant-001' },
    });
    await fetchSchedules(localFn.id);
  };

  useEffect(() => {
    fetchFunctions();
    fetchUtilities();
    const ontologyUrl = import.meta.env.VITE_ONTOLOGY_SERVICE_URL || 'http://localhost:8004';
    fetch(`${ontologyUrl}/object-types`, { headers: { 'x-tenant-id': 'tenant-001' } })
      .then((r) => r.json())
      .then((data) => setObjectTypes(Array.isArray(data) ? data : []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (selectedFn) {
      setLocalFn(JSON.parse(JSON.stringify(selectedFn)));
      setDirty(false);
      fetchSchedules(selectedFn.id);
    } else {
      setLocalFn(null);
      setSchedules([]);
    }
  }, [selectedFn?.id]);

  const updateLocal = useCallback((patch: Partial<LogicFunction>) => {
    setLocalFn((prev) => prev ? { ...prev, ...patch } : prev);
    setDirty(true);
  }, []);

  const handleAddBlock = (type: Block['type']) => {
    const id = `b${uid()}`;
    const newBlock: Block = { id, type };
    updateLocal({ blocks: [...(localFn?.blocks || []), newBlock] });
  };

  const handleBlockChange = (idx: number, block: Block) => {
    const blocks = [...(localFn?.blocks || [])];
    blocks[idx] = block;
    updateLocal({ blocks });
  };

  const handleRemoveBlock = (idx: number) => {
    const blocks = [...(localFn?.blocks || [])];
    const removedId = blocks[idx].id;
    blocks.splice(idx, 1);
    const patch: Partial<LogicFunction> = { blocks };
    if (localFn?.output_block === removedId) patch.output_block = undefined;
    updateLocal(patch);
  };

  const handleSave = async () => {
    if (!localFn) return;
    setSaving(true);
    try {
      await updateFunction(localFn.id, {
        name: localFn.name,
        description: localFn.description,
        input_schema: localFn.input_schema,
        blocks: localFn.blocks,
        output_block: localFn.output_block,
      });
      setDirty(false);
    } finally {
      setSaving(false);
    }
  };

  const handleRun = async () => {
    if (!localFn) return;
    let inputs: Record<string, unknown> = {};
    try { inputs = JSON.parse(testInputs); } catch { alert('Invalid JSON inputs'); return; }
    setActiveTab('debug');
    await runSync(localFn.id, inputs);
  };

  const panelStyle: React.CSSProperties = {
    backgroundColor: C.panel, borderRight: `1px solid ${C.border}`,
    display: 'flex', flexDirection: 'column', overflow: 'hidden',
  };

  return (
    <div style={{ display: 'flex', height: '100%', backgroundColor: C.bg, color: C.text, fontFamily: 'system-ui, sans-serif' }}>

      {/* ── Left: function list ── */}
      <div style={{ ...panelStyle, width: 220, minWidth: 220 }}>
        <div style={{
          height: 52, display: 'flex', alignItems: 'center', padding: '0 14px',
          borderBottom: `1px solid ${C.border}`, gap: 8,
        }}>
          <BookOpen size={14} color={C.accent} />
          <span style={{ fontSize: 13, fontWeight: 600 }}>Logic Functions</span>
          <button
            onClick={async () => {
              const fn = await createFunction({ name: 'New Function', blocks: [], input_schema: [] });
              selectFunction(fn);
            }}
            style={{
              marginLeft: 'auto', backgroundColor: C.accentDim, color: C.accent,
              border: `1px solid ${C.accent}`, padding: '3px 8px', cursor: 'pointer', fontSize: 11,
              display: 'flex', alignItems: 'center', gap: 4,
            }}
          >
            <Plus size={11} /> New
          </button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '4px 0' }}>
          {loading && <div style={{ padding: 12, fontSize: 12, color: C.dim }}>Loading...</div>}
          {functions.map((fn) => (
            <button
              key={fn.id}
              onClick={() => selectFunction(fn)}
              style={{
                display: 'flex', flexDirection: 'column', alignItems: 'flex-start',
                width: '100%', padding: '8px 14px', gap: 2, border: 'none', cursor: 'pointer',
                backgroundColor: selectedFn?.id === fn.id ? C.accentDim : 'transparent',
                borderLeft: selectedFn?.id === fn.id ? `2px solid ${C.accent}` : '2px solid transparent',
                color: C.text,
              }}
            >
              <span style={{ fontSize: 13, fontWeight: selectedFn?.id === fn.id ? 500 : 400, textAlign: 'left' }}>
                {fn.name}
              </span>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <span style={{
                  fontSize: 9, padding: '1px 5px',
                  backgroundColor: fn.status === 'published' ? '#D1FAE5' : '#EDE9FE',
                  color: fn.status === 'published' ? C.success : C.accent,
                }}>
                  {fn.status.toUpperCase()}
                </span>
                <span style={{ fontSize: 10, color: C.dim }}>v{fn.version} · {fn.blocks.length} blocks</span>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* ── Center: editor ── */}
      {localFn ? (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {/* Toolbar */}
          <div style={{
            height: 52, display: 'flex', alignItems: 'center', gap: 8,
            padding: '0 52px 0 16px', borderBottom: `1px solid ${C.border}`,
            backgroundColor: C.panel, flexShrink: 0,
          }}>
            <input
              value={localFn.name}
              onChange={(e) => updateLocal({ name: e.target.value })}
              style={{
                backgroundColor: 'transparent', border: `1px solid ${dirty ? C.border : 'transparent'}`,
                color: C.text, fontSize: 15, fontWeight: 600, padding: '4px 8px', outline: 'none', width: 240,
              }}
            />
            {dirty && <span style={{ fontSize: 10, color: C.warn }}>unsaved</span>}
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
              <button
                onClick={() => {
                  if (confirm('Delete this function?')) deleteFunction(localFn.id);
                }}
                style={{ padding: '5px 10px', border: `1px solid ${C.border}`, backgroundColor: 'transparent', color: C.muted, cursor: 'pointer', fontSize: 12, display: 'flex', gap: 4, alignItems: 'center' }}
              >
                <Trash2 size={12} /> Delete
              </button>
              <button
                onClick={() => publishFunction(localFn.id)}
                style={{ padding: '5px 10px', border: `1px solid #A7F3D0`, backgroundColor: '#D1FAE5', color: C.success, cursor: 'pointer', fontSize: 12 }}
              >
                Publish
              </button>
              <button
                onClick={handleSave}
                disabled={saving || !dirty}
                style={{
                  padding: '5px 12px', border: `1px solid ${C.accent}`, backgroundColor: dirty ? C.accentDim : 'transparent',
                  color: dirty ? C.accent : C.muted, cursor: dirty ? 'pointer' : 'default', fontSize: 12,
                  display: 'flex', gap: 4, alignItems: 'center',
                }}
              >
                {saving ? <Loader size={12} /> : <Save size={12} />} Save
              </button>
            </div>
          </div>

          {/* Tab bar */}
          <div style={{ display: 'flex', borderBottom: `1px solid ${C.border}`, backgroundColor: C.panel, flexShrink: 0 }}>
            {([['editor', 'Builder'], ['debug', 'Debugger'], ['schedule', 'Schedule']] as const).map(([tab, label]) => (
              <button key={tab} onClick={() => setActiveTab(tab)} style={{
                padding: '8px 16px', fontSize: 12, border: 'none', cursor: 'pointer',
                backgroundColor: activeTab === tab ? C.card : 'transparent',
                color: activeTab === tab ? C.text : C.dim,
                borderBottom: activeTab === tab ? `2px solid ${C.accent}` : '2px solid transparent',
                display: 'flex', alignItems: 'center', gap: 5,
              }}>
                {tab === 'schedule' && <Clock size={11} />}
                {label}
                {tab === 'schedule' && schedules.filter(s => s.enabled).length > 0 && (
                  <span style={{ backgroundColor: C.accent, color: '#fff', borderRadius: 8, padding: '0 5px', fontSize: 9 }}>
                    {schedules.filter(s => s.enabled).length}
                  </span>
                )}
              </button>
            ))}
          </div>

          {activeTab === 'schedule' ? (
            <div style={{ flex: 1, overflowY: 'auto', padding: 16 }}>
              {/* Existing schedules */}
              {schedules.length > 0 && (
                <div style={{ marginBottom: 20 }}>
                  <div style={{ fontSize: 11, color: C.muted, fontWeight: 600, letterSpacing: '0.06em', marginBottom: 8 }}>ACTIVE SCHEDULES</div>
                  {schedules.map((s) => (
                    <div key={s.id} style={{
                      display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px',
                      border: `1px solid ${C.border}`, backgroundColor: C.panel, marginBottom: 6,
                    }}>
                      <div style={{
                        width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
                        backgroundColor: s.enabled ? C.success : C.dim,
                      }} />
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 13, fontWeight: 500, color: C.text }}>{s.label || s.cron}</div>
                        <div style={{ fontSize: 11, color: C.dim, marginTop: 2 }}>
                          cron: <code style={{ backgroundColor: C.sidebar, padding: '1px 5px' }}>{s.cron}</code>
                          {s.last_run_at && <span style={{ marginLeft: 8 }}>last run: {new Date(s.last_run_at).toLocaleString()}</span>}
                        </div>
                        {Object.keys(s.inputs || {}).length > 0 && (
                          <div style={{ fontSize: 11, color: C.dim, marginTop: 2 }}>
                            inputs: <code style={{ backgroundColor: C.sidebar, padding: '1px 5px' }}>{JSON.stringify(s.inputs)}</code>
                          </div>
                        )}
                      </div>
                      <button
                        onClick={() => toggleSchedule(s)}
                        style={{
                          padding: '4px 10px', fontSize: 11, cursor: 'pointer', border: `1px solid ${C.border}`,
                          backgroundColor: s.enabled ? '#FEF3C7' : C.accentDim,
                          color: s.enabled ? C.warn : C.accent,
                        }}
                      >
                        {s.enabled ? 'Pause' : 'Enable'}
                      </button>
                      <button
                        onClick={() => { if (confirm('Delete this schedule?')) deleteSchedule(s); }}
                        style={{ background: 'none', border: 'none', color: C.muted, cursor: 'pointer', padding: 4, lineHeight: 0 }}
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {/* Create new schedule */}
              <div style={{ border: `1px solid ${C.border}`, backgroundColor: C.panel }}>
                <div style={{ padding: '10px 14px', borderBottom: `1px solid ${C.border}`, backgroundColor: C.sidebar }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: C.text }}>Add Schedule</div>
                  <div style={{ fontSize: 11, color: C.dim, marginTop: 2 }}>
                    Uses standard 5-part cron syntax (UTC). The function runs automatically with the inputs you define below.
                  </div>
                </div>
                <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <div>
                    <div style={{ fontSize: 11, color: C.muted, marginBottom: 4 }}>LABEL</div>
                    <input
                      value={schedLabel}
                      onChange={(e) => setSchedLabel(e.target.value)}
                      style={{ width: '100%', backgroundColor: C.bg, border: `1px solid ${C.border}`, color: C.text, padding: '6px 10px', fontSize: 13, outline: 'none', boxSizing: 'border-box' }}
                      placeholder="Every weekday at 9am UTC"
                    />
                  </div>
                  <div>
                    <div style={{ fontSize: 11, color: C.muted, marginBottom: 4 }}>CRON EXPRESSION (UTC)</div>
                    <input
                      value={schedCron}
                      onChange={(e) => setSchedCron(e.target.value)}
                      style={{ width: '100%', backgroundColor: C.bg, border: `1px solid ${C.border}`, color: C.text, padding: '6px 10px', fontSize: 13, fontFamily: 'monospace', outline: 'none', boxSizing: 'border-box' }}
                      placeholder="0 9 * * 1-5"
                    />
                    <div style={{ fontSize: 10, color: C.dim, marginTop: 4 }}>
                      Examples: &nbsp;
                      {[
                        { label: 'Daily 9am', cron: '0 9 * * *' },
                        { label: 'Weekdays 9am', cron: '0 9 * * 1-5' },
                        { label: 'Mon 8am', cron: '0 8 * * 1' },
                        { label: 'Every hour', cron: '0 * * * *' },
                      ].map(({ label, cron }) => (
                        <button key={cron} onClick={() => setSchedCron(cron)} style={{
                          marginRight: 6, padding: '1px 7px', fontSize: 10, cursor: 'pointer',
                          backgroundColor: schedCron === cron ? C.accentDim : C.sidebar,
                          color: schedCron === cron ? C.accent : C.muted,
                          border: `1px solid ${schedCron === cron ? C.accent : C.border}`,
                        }}>
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: 11, color: C.muted, marginBottom: 4 }}>DEFAULT INPUTS (JSON)</div>
                    <textarea
                      value={schedInputs}
                      onChange={(e) => setSchedInputs(e.target.value)}
                      style={{
                        width: '100%', minHeight: 60, backgroundColor: C.bg, border: `1px solid ${C.border}`,
                        color: C.text, padding: 8, fontSize: 12, fontFamily: 'monospace', resize: 'vertical', outline: 'none', boxSizing: 'border-box',
                      }}
                      placeholder='{"since_date": "2026-03-01T00:00:00Z"}'
                    />
                    <div style={{ fontSize: 10, color: C.dim, marginTop: 2 }}>
                      Tip: use a relative date by passing a fixed anchor, or leave empty if your function has no required inputs.
                    </div>
                  </div>
                  <button
                    onClick={createSchedule}
                    disabled={schedSaving}
                    style={{
                      alignSelf: 'flex-start', padding: '7px 16px', backgroundColor: C.accentDim, color: C.accent,
                      border: `1px solid ${C.accent}`, cursor: schedSaving ? 'wait' : 'pointer', fontSize: 12,
                      display: 'flex', gap: 6, alignItems: 'center',
                    }}
                  >
                    {schedSaving ? <Loader size={12} /> : <Clock size={12} />}
                    {schedSaving ? 'Saving...' : 'Create Schedule'}
                  </button>
                </div>
              </div>
            </div>
          ) : activeTab === 'editor' ? (
            <div style={{ flex: 1, overflowY: 'auto', padding: 16 }}>
              {/* Input schema */}
              <div style={{ marginBottom: 20, border: `1px solid ${C.border}`, backgroundColor: C.panel }}>
                <div style={{
                  padding: '10px 14px', borderBottom: `1px solid ${C.border}`,
                  backgroundColor: C.sidebar, display: 'flex', alignItems: 'center', gap: 10,
                }}>
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 600, color: C.text }}>Function Parameters</div>
                    <div style={{ fontSize: 11, color: C.dim, marginTop: 2 }}>
                      Define inputs here, then use them in any block as{' '}
                      <code style={{ backgroundColor: C.accentDim, color: C.accent, padding: '1px 5px', borderRadius: 3 }}>{'{inputs.name}'}</code>
                    </div>
                  </div>
                  <button
                    onClick={() => updateLocal({ input_schema: [...localFn.input_schema, { name: '', type: 'string', required: true }] })}
                    style={{
                      marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 5,
                      backgroundColor: C.accentDim, color: C.accent, border: `1px solid ${C.accent}44`,
                      padding: '5px 12px', cursor: 'pointer', fontSize: 12, fontWeight: 500, whiteSpace: 'nowrap',
                    }}
                  >
                    <Plus size={13} /> Add Parameter
                  </button>
                </div>
                <div style={{ padding: localFn.input_schema.length ? '10px 14px' : '0' }}>
                  {localFn.input_schema.length === 0 && (
                    <div style={{
                      padding: '20px 14px', textAlign: 'center', color: C.dim, fontSize: 12,
                      borderTop: 'none',
                    }}>
                      No parameters yet — click <strong>Add Parameter</strong> to define runtime inputs
                    </div>
                  )}
                  {localFn.input_schema.map((f, i) => (
                    <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 8, alignItems: 'center' }}>
                      <div style={{ fontSize: 11, color: C.dim, width: 20, textAlign: 'right', flexShrink: 0 }}>{i + 1}</div>
                      <input
                        style={{ flex: 2, backgroundColor: C.bg, border: `1px solid ${C.border}`, color: C.text, padding: '6px 10px', fontSize: 13, outline: 'none' }}
                        value={f.name} placeholder="parameter_name (e.g. since_date)"
                        onChange={(e) => {
                          const schema = [...localFn.input_schema];
                          schema[i] = { ...schema[i], name: e.target.value };
                          updateLocal({ input_schema: schema });
                        }}
                      />
                      <select
                        style={{ flex: 1, backgroundColor: C.bg, border: `1px solid ${C.border}`, color: C.text, padding: '6px 10px', fontSize: 13, outline: 'none' }}
                        value={f.type}
                        onChange={(e) => {
                          const schema = [...localFn.input_schema];
                          schema[i] = { ...schema[i], type: e.target.value };
                          updateLocal({ input_schema: schema });
                        }}
                      >
                        {['string', 'number', 'boolean', 'object', 'array'].map((t) => <option key={t}>{t}</option>)}
                      </select>
                      {f.name && (
                        <code style={{ fontSize: 11, color: C.accent, backgroundColor: C.accentDim, padding: '3px 7px', whiteSpace: 'nowrap' }}>
                          {`{inputs.${f.name}}`}
                        </code>
                      )}
                      <button onClick={() => {
                        const schema = [...localFn.input_schema];
                        schema.splice(i, 1);
                        updateLocal({ input_schema: schema });
                      }} style={{ background: 'none', border: 'none', color: C.muted, cursor: 'pointer', padding: 2, lineHeight: 0 }}>
                        <Trash2 size={13} />
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              {/* Blocks */}
              <div style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 11, color: C.muted, marginBottom: 8, fontWeight: 600, letterSpacing: '0.06em' }}>
                  BLOCKS
                </div>
                {localFn.blocks.map((block, i) => (
                  <div key={block.id} style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', paddingTop: 12 }}>
                      <div style={{ width: 2, height: i === 0 ? 0 : 12, backgroundColor: C.border }} />
                      <div style={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: blockColor(block.type), flexShrink: 0 }} />
                    </div>
                    <div style={{ flex: 1 }}>
                      <BlockEditor
                        block={block}
                        onChange={(b) => handleBlockChange(i, b)}
                        onRemove={() => handleRemoveBlock(i)}
                        isOutput={localFn.output_block === block.id}
                        onSetOutput={() => updateLocal({ output_block: block.id })}
                        objectTypes={objectTypes}
                        inputSchema={localFn.input_schema || []}
                      />
                    </div>
                  </div>
                ))}

                {/* Add block buttons */}
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 4 }}>
                  {BLOCK_TYPES.map((bt) => (
                    <button
                      key={bt.type}
                      onClick={() => handleAddBlock(bt.type as Block['type'])}
                      style={{
                        fontSize: 11, padding: '4px 10px', cursor: 'pointer',
                        backgroundColor: 'transparent', color: bt.color,
                        border: `1px solid ${bt.color}44`,
                        display: 'flex', gap: 4, alignItems: 'center',
                      }}
                    >
                      <Plus size={11} /> {bt.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          ) : activeTab === 'debug' ? (
            <div style={{ flex: 1, overflowY: 'auto', padding: 16 }}>
              <div style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 11, color: C.muted, marginBottom: 4, fontWeight: 600, letterSpacing: '0.06em' }}>
                  TEST PARAMETERS (JSON)
                </div>
                <div style={{ fontSize: 11, color: C.dim, marginBottom: 6 }}>
                  Simulated inputs for the function — e.g. <code style={{ backgroundColor: C.sidebar, padding: '1px 4px' }}>{'{"deal_id": "123"}'}</code>
                </div>
                <textarea
                  value={testInputs}
                  onChange={(e) => setTestInputs(e.target.value)}
                  style={{
                    width: '100%', minHeight: 80, backgroundColor: C.bg, border: `1px solid ${C.border}`,
                    color: C.text, padding: 8, fontSize: 12, fontFamily: 'monospace', resize: 'vertical', outline: 'none', boxSizing: 'border-box',
                  }}
                />
                <button
                  onClick={handleRun}
                  disabled={running}
                  style={{
                    marginTop: 8, padding: '7px 16px', backgroundColor: C.accentDim, color: C.accent,
                    border: `1px solid ${C.accent}`, cursor: running ? 'wait' : 'pointer', fontSize: 12,
                    display: 'flex', gap: 6, alignItems: 'center',
                  }}
                >
                  {running ? <Loader size={13} style={{ animation: 'spin 0.6s linear infinite' }} /> : <Play size={13} />}
                  {running ? 'Running...' : 'Run Function'}
                </button>
              </div>

              {lastRun && (
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                    {lastRun.status === 'completed'
                      ? <CheckCircle size={14} color={C.success} />
                      : <XCircle size={14} color={C.error} />}
                    <span style={{ fontSize: 12, color: C.text }}>{lastRun.status}</span>
                    {lastRun.error && <span style={{ fontSize: 11, color: C.error }}>{lastRun.error}</span>}
                  </div>
                  <TracePanel run={lastRun} blocks={localFn.blocks} />
                </div>
              )}
            </div>
          ) : null}
        </div>
      ) : (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.dim, flexDirection: 'column', gap: 8 }}>
          <BookOpen size={32} color={C.border} />
          <div style={{ fontSize: 13 }}>Select or create a Logic Function</div>
        </div>
      )}

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
};

export default LogicStudio;
