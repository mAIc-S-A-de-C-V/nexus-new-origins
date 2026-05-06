import React, { useEffect, useState, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useAgentStore, AgentConfig, AgentSchedule, KnowledgeScopeEntry } from '../../store/agentStore';
import { useOntologyStore } from '../../store/ontologyStore';
import { getTenantId } from '../../store/authStore';
import { useNavigationStore } from '../../store/navigationStore';
import {
  Plus, Send, Trash2, Bot, Loader, Wrench, MessageCircle, MessageSquare, Database, Filter, X,
  Search, List, Zap, ShieldCheck, ListChecks, Network, CheckCircle, Clock, Play,
  Activity, Shield, RefreshCw, ChevronRight, Hash,
} from 'lucide-react';
import { CommentsPanel } from '../../components/CommentsPanel';

const C = {
  bg: '#F8FAFC', sidebar: '#F1F5F9', panel: '#FFFFFF', card: '#F8FAFC',
  border: '#E2E8F0', accent: '#7C3AED', accentDim: '#EDE9FE',
  text: '#0D1117', muted: '#64748B', dim: '#94A3B8',
  success: '#059669', successDim: '#ECFDF5',
  error: '#DC2626', errorDim: '#FEF2F2',
  warn: '#D97706', warnDim: '#FFFBEB',
};

const TOOL_META: Record<string, { label: string; desc: string; icon: React.ReactNode; color: string }> = {
  list_object_types:  { label: 'List Object Types',  desc: 'Discover what data exists — returns all types with record counts',          icon: <List size={14} />,       color: '#8B5CF6' },
  get_object_schema:  { label: 'Get Object Schema',  desc: 'Inspect field names + 3 sample rows before querying',                       icon: <Search size={14} />,     color: '#3B82F6' },
  query_records:      { label: 'Query Records',      desc: 'Server-side structured query — filters, aggregation, group-by',             icon: <Database size={14} />,   color: '#2563EB' },
  count_records:      { label: 'Count Records',      desc: 'Return total count with optional filters — never loads data into context',  icon: <Hash size={14} />,       color: '#0891B2' },
  logic_function_run: { label: 'Run Logic Function', desc: 'Execute a pre-built Logic Function workflow with inputs',                   icon: <Zap size={14} />,        color: '#F59E0B' },
  action_propose:     { label: 'Propose Action',     desc: 'Propose a write operation — goes to Human Actions queue',                  icon: <ShieldCheck size={14} />, color: '#EF4444' },
  list_actions:       { label: 'List Actions',       desc: 'Discover available write actions and their input schemas',                  icon: <ListChecks size={14} />, color: '#10B981' },
  agent_call:         { label: 'Call Sub-Agent',     desc: 'Delegate a subtask to another configured agent by name',                   icon: <Network size={14} />,    color: '#7C3AED' },
  process_mining:     { label: 'Process Mining',     desc: 'Analyze event logs for patterns, bottlenecks, anomalies & co-occurrences', icon: <Activity size={14} />,  color: '#0891B2' },
  utility_list:       { label: 'List Utilities',     desc: 'Discover available utilities (OCR, scrape, geocode, etc.)',                icon: <Wrench size={14} />,    color: '#6B7280' },
  utility_run:        { label: 'Run Utility',        desc: 'Execute a pre-built utility — OCR, PDF extract, web scrape, geocode…',    icon: <Wrench size={14} />,    color: '#6B7280' },
};

const TOOL_LABELS: Record<string, string> = Object.fromEntries(
  Object.entries(TOOL_META).map(([k, v]) => [k, v.label])
);

// ── Agent Config Panel ────────────────────────────────────────────────────────

const AgentConfigPanel: React.FC<{
  agent: AgentConfig;
  availableTools: string[];
  onSave: (data: Partial<AgentConfig>) => void;
  onDelete: () => void;
}> = ({ agent, availableTools, onSave, onDelete }) => {
  const [form, setForm] = useState({ ...agent });
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [tenantModels, setTenantModels] = useState<Array<{ id: string; label: string; provider: string }>>([]);

  useEffect(() => { setForm({ ...agent }); setDirty(false); }, [agent.id]);

  // Pull the tenant's registered LLM providers so their models show up in
  // the picker alongside the Claude defaults.
  useEffect(() => {
    const url = (import.meta.env.VITE_AGENT_SERVICE_URL || 'http://localhost:8013') + '/model-providers';
    fetch(url, { headers: { 'x-tenant-id': getTenantId() } })
      .then((r) => r.ok ? r.json() : [])
      .then((providers: Array<{ name: string; enabled: boolean; models: Array<{ id: string; label?: string }> }>) => {
        const flat: Array<{ id: string; label: string; provider: string }> = [];
        for (const p of (Array.isArray(providers) ? providers : [])) {
          if (p.enabled === false) continue;
          for (const m of (p.models || [])) {
            flat.push({ id: m.id, label: m.label || m.id, provider: p.name });
          }
        }
        setTenantModels(flat);
      })
      .catch(() => {});
  }, []);

  const u = (patch: Partial<AgentConfig>) => {
    setForm((f) => ({ ...f, ...patch }));
    setDirty(true);
  };

  const inputStyle: React.CSSProperties = {
    width: '100%', backgroundColor: C.bg, border: `1px solid ${C.border}`,
    color: C.text, padding: '6px 8px', fontSize: 12, outline: 'none', boxSizing: 'border-box',
  };

  const handleSave = async () => {
    setSaving(true);
    try { await onSave(form); setDirty(false); }
    finally { setSaving(false); }
  };

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div>
        <label style={{ fontSize: 11, color: C.muted, display: 'block', marginBottom: 4 }}>Name</label>
        <input style={inputStyle} value={form.name} onChange={(e) => u({ name: e.target.value })} />
      </div>
      <div>
        <label style={{ fontSize: 11, color: C.muted, display: 'block', marginBottom: 4 }}>Description</label>
        <input style={inputStyle} value={form.description || ''} onChange={(e) => u({ description: e.target.value })} placeholder="What does this agent do?" />
      </div>
      <div>
        <label style={{ fontSize: 11, color: C.muted, display: 'block', marginBottom: 4 }}>System Prompt</label>
        <textarea
          style={{ ...inputStyle, resize: 'vertical', minHeight: 120, fontFamily: 'system-ui' }}
          value={form.system_prompt}
          onChange={(e) => u({ system_prompt: e.target.value })}
        />
      </div>
      <div style={{ display: 'flex', gap: 12 }}>
        <div style={{ flex: 1 }}>
          <label style={{ fontSize: 11, color: C.muted, display: 'block', marginBottom: 4 }}>Model</label>
          <select style={inputStyle} value={form.model} onChange={(e) => u({ model: e.target.value })}>
            {tenantModels.length > 0 && (
              <optgroup label="Your providers">
                {tenantModels.map((m) => (
                  <option key={`tm-${m.id}`} value={m.id}>{m.label} — {m.provider}</option>
                ))}
              </optgroup>
            )}
            <optgroup label="Anthropic defaults">
              <option value="claude-haiku-4-5-20251001">Haiku 4.5</option>
              <option value="claude-sonnet-4-6">Sonnet 4.6</option>
              <option value="claude-opus-4-7">Opus 4.7</option>
            </optgroup>
          </select>
        </div>
        <div>
          <label style={{ fontSize: 11, color: C.muted, display: 'block', marginBottom: 4 }}>Max Iterations</label>
          <input
            type="number" style={{ ...inputStyle, width: 80 }}
            value={form.max_iterations}
            onChange={(e) => u({ max_iterations: parseInt(e.target.value) || 10 })}
          />
        </div>
      </div>

      {/* Tools */}
      <div>
        <label style={{ fontSize: 11, color: C.muted, display: 'block', marginBottom: 8, letterSpacing: '0.06em' }}>
          ENABLED TOOLS
        </label>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          {availableTools.map((tool) => {
            const enabled = form.enabled_tools.includes(tool);
            const meta = TOOL_META[tool];
            const color = meta?.color || '#6B7280';
            return (
              <div
                key={tool}
                onClick={() => {
                  const tools = enabled
                    ? form.enabled_tools.filter((t) => t !== tool)
                    : [...form.enabled_tools, tool];
                  u({ enabled_tools: tools });
                }}
                style={{
                  cursor: 'pointer',
                  borderRadius: 8,
                  border: `1.5px solid ${enabled ? color : C.border}`,
                  backgroundColor: enabled ? `${color}14` : C.panel,
                  padding: '10px 12px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 4,
                  transition: 'border-color 0.15s, background-color 0.15s',
                  userSelect: 'none',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                  <span style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    width: 24, height: 24, borderRadius: 6,
                    backgroundColor: enabled ? color : C.border,
                    color: '#fff', flexShrink: 0, transition: 'background-color 0.15s',
                  }}>
                    {meta?.icon}
                  </span>
                  <span style={{ fontSize: 12, fontWeight: 600, color: enabled ? color : C.text, flex: 1 }}>
                    {meta?.label || tool}
                  </span>
                  <span style={{
                    width: 14, height: 14, borderRadius: '50%', flexShrink: 0,
                    border: `2px solid ${enabled ? color : C.border}`,
                    backgroundColor: enabled ? color : 'transparent',
                    transition: 'all 0.15s',
                  }} />
                </div>
                {meta?.desc && (
                  <p style={{ margin: 0, fontSize: 10, color: C.dim, lineHeight: 1.4, paddingLeft: 31 }}>
                    {meta.desc}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
        <button
          onClick={handleSave}
          disabled={!dirty || saving}
          style={{
            padding: '7px 16px', fontSize: 12, cursor: dirty ? 'pointer' : 'default',
            backgroundColor: dirty ? C.accentDim : 'transparent',
            border: `1px solid ${dirty ? C.accent : C.border}`,
            color: dirty ? C.accent : C.dim,
          }}
        >
          {saving ? 'Saving...' : 'Save Agent'}
        </button>
        <button
          onClick={() => { if (confirm('Delete this agent?')) onDelete(); }}
          style={{
            padding: '7px 12px', fontSize: 12, cursor: 'pointer',
            backgroundColor: 'transparent', border: `1px solid ${C.border}`, color: C.muted,
            display: 'flex', gap: 4, alignItems: 'center',
          }}
        >
          <Trash2 size={12} /> Delete
        </button>
      </div>
    </div>
  );
};

// ── Knowledge Scope Panel ─────────────────────────────────────────────────────

const KnowledgePanel: React.FC<{ agent: AgentConfig }> = ({ agent }) => {
  const { objectTypes, fetchObjectTypes } = useOntologyStore();
  const { setKnowledgeScope } = useAgentStore();
  const [saving, setSaving] = useState(false);
  // local copy so edits don't immediately call the API on every keystroke
  const [scope, setScope] = useState<KnowledgeScopeEntry[] | null>(agent.knowledge_scope);
  const isRestricted = scope !== null;

  useEffect(() => { fetchObjectTypes(); }, []);
  useEffect(() => { setScope(agent.knowledge_scope); }, [agent.id]);

  const scopeIds = new Set((scope || []).map((e) => e.object_type_id));

  const toggleType = (otId: string, label: string) => {
    if (!isRestricted) return;
    if (scopeIds.has(otId)) {
      setScope((s) => (s || []).filter((e) => e.object_type_id !== otId));
    } else {
      setScope((s) => [...(s || []), { object_type_id: otId, label, filter: null }]);
    }
  };

  const updateFilter = (otId: string, filter: KnowledgeScopeEntry['filter']) => {
    setScope((s) => (s || []).map((e) => e.object_type_id === otId ? { ...e, filter } : e));
  };

  const handleSave = async () => {
    setSaving(true);
    try { await setKnowledgeScope(agent.id, scope); }
    finally { setSaving(false); }
  };

  const inputStyle: React.CSSProperties = {
    height: 28, padding: '0 8px', fontSize: 12, border: `1px solid ${C.border}`,
    backgroundColor: C.bg, color: C.text, outline: 'none', borderRadius: 3,
  };

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Restriction toggle */}
      <div style={{
        backgroundColor: isRestricted ? '#FFFBEB' : C.card,
        border: `1px solid ${isRestricted ? '#FDE68A' : C.border}`,
        borderRadius: 6, padding: '12px 16px',
        display: 'flex', alignItems: 'flex-start', gap: 12,
      }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 500, color: C.text, marginBottom: 4 }}>
            {isRestricted ? 'Restricted scope' : 'Unrestricted — can query any object type'}
          </div>
          <div style={{ fontSize: 12, color: C.muted }}>
            {isRestricted
              ? 'Agent can only query the object types selected below. New object types will not be accessible until added.'
              : 'Agent can query any object type in the ontology, including new types added in the future.'}
          </div>
        </div>
        <button
          onClick={() => setScope(isRestricted ? null : [])}
          style={{
            padding: '5px 12px', fontSize: 12, borderRadius: 4, cursor: 'pointer', fontWeight: 500,
            backgroundColor: isRestricted ? C.accentDim : C.bg,
            border: `1px solid ${isRestricted ? C.accent : C.border}`,
            color: isRestricted ? C.accent : C.muted, flexShrink: 0,
          }}
        >
          {isRestricted ? 'Make unrestricted' : 'Restrict scope'}
        </button>
      </div>

      {/* Object type list */}
      {isRestricted && (
        <div>
          <div style={{ fontSize: 11, color: C.muted, marginBottom: 10, letterSpacing: '0.06em' }}>
            OBJECT TYPES — toggle to include in agent scope
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {objectTypes.map((ot) => {
              const enabled = scopeIds.has(ot.id);
              const entry = (scope || []).find((e) => e.object_type_id === ot.id);
              return (
                <div key={ot.id} style={{
                  border: `1px solid ${enabled ? C.accent + '55' : C.border}`,
                  borderRadius: 5, overflow: 'hidden',
                  backgroundColor: enabled ? C.accentDim + '55' : C.panel,
                }}>
                  <div
                    style={{ padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}
                    onClick={() => toggleType(ot.id, ot.displayName || ot.name)}
                  >
                    <input type="checkbox" checked={enabled} readOnly style={{ accentColor: C.accent, flexShrink: 0 }} />
                    <Database size={13} color={enabled ? C.accent : C.dim} />
                    <span style={{ fontSize: 13, fontWeight: enabled ? 500 : 400, color: enabled ? C.text : C.muted, flex: 1 }}>
                      {ot.displayName || ot.name}
                    </span>
                    <span style={{ fontSize: 10, color: C.dim, fontFamily: 'monospace' }}>{ot.id}</span>
                    {enabled && entry?.filter && (
                      <span style={{
                        fontSize: 10, padding: '1px 6px', borderRadius: 10,
                        backgroundColor: '#EFF6FF', color: '#2563EB', border: '1px solid #BFDBFE',
                        display: 'flex', alignItems: 'center', gap: 3,
                      }}>
                        <Filter size={9} /> filtered
                      </span>
                    )}
                  </div>

                  {/* Inline filter row when enabled */}
                  {enabled && (
                    <div style={{
                      borderTop: `1px solid ${C.border}`, padding: '8px 14px 10px 38px',
                      backgroundColor: C.bg, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
                    }}>
                      <span style={{ fontSize: 11, color: C.muted }}>Filter (optional):</span>
                      <input
                        style={{ ...inputStyle, width: 120 }}
                        placeholder="field name"
                        value={entry?.filter?.field || ''}
                        onChange={(e) => updateFilter(ot.id, {
                          field: e.target.value,
                          op: entry?.filter?.op || '==',
                          value: entry?.filter?.value || '',
                        })}
                      />
                      <select
                        style={{ ...inputStyle, width: 60 }}
                        value={entry?.filter?.op || '=='}
                        onChange={(e) => updateFilter(ot.id, {
                          field: entry?.filter?.field || '',
                          op: e.target.value,
                          value: entry?.filter?.value || '',
                        })}
                      >
                        <option value="==">==</option>
                        <option value="!=">!=</option>
                        <option value=">">{'>'}</option>
                        <option value="<">{'<'}</option>
                      </select>
                      <input
                        style={{ ...inputStyle, width: 140 }}
                        placeholder="value"
                        value={entry?.filter?.value || ''}
                        onChange={(e) => updateFilter(ot.id, {
                          field: entry?.filter?.field || '',
                          op: entry?.filter?.op || '==',
                          value: e.target.value,
                        })}
                      />
                      {entry?.filter?.field && (
                        <button
                          onClick={() => updateFilter(ot.id, null)}
                          style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.dim, lineHeight: 0 }}
                          title="Clear filter"
                        >
                          <X size={13} />
                        </button>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div style={{ display: 'flex', gap: 8 }}>
        <button
          onClick={handleSave}
          disabled={saving}
          style={{
            padding: '7px 16px', fontSize: 12, cursor: saving ? 'default' : 'pointer',
            backgroundColor: C.accentDim, border: `1px solid ${C.accent}`,
            color: C.accent, borderRadius: 4, fontWeight: 500,
          }}
        >
          {saving ? 'Saving...' : 'Save scope'}
        </button>
      </div>
    </div>
  );
};

// ── Shared message bubble ────────────────────────────────────────────────────

const MsgBubble: React.FC<{ role: string; content: string; toolName?: string; toolInput?: unknown; toolResult?: unknown }> = ({ role, content, toolName, toolInput, toolResult }) => {
  const [open, setOpen] = useState(false);
  const isTool = role === 'tool_use' || role === 'tool_result';
  const colors = {
    user: { bg: C.accentDim, border: C.accent + '44', label: 'You', color: C.text },
    assistant: { bg: C.card, border: C.border, label: 'Agent', color: C.accent },
    tool_use: { bg: '#FFFBEB', border: '#FDE68A', label: TOOL_LABELS[toolName || ''] || toolName || 'Tool', color: C.warn },
    tool_result: { bg: '#F0FDF4', border: '#86EFAC', label: 'Result', color: C.success },
  }[role] || { bg: C.card, border: C.border, label: role, color: C.muted };

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', gap: 2,
      alignSelf: role === 'user' ? 'flex-end' : 'flex-start',
      maxWidth: isTool ? '90%' : '80%',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ fontSize: 10, color: colors.color, fontWeight: 500 }}>{colors.label}</span>
        {isTool && (
          <button onClick={() => setOpen(v => !v)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.dim, fontSize: 10, padding: 0 }}>
            {open ? '▲ hide' : '▼ details'}
          </button>
        )}
      </div>
      <div style={{
        backgroundColor: colors.bg, border: `1px solid ${colors.border}`,
        padding: '8px 12px', fontSize: 13, color: C.text,
        wordBreak: 'break-word',
      }}>
        {role === 'tool_use'
          ? <span style={{ fontSize: 12 }}>{open ? <pre style={{ margin: 0, fontSize: 11 }}>{JSON.stringify(toolInput, null, 2)}</pre> : `Calling ${TOOL_LABELS[toolName || ''] || toolName}…`}</span>
          : role === 'tool_result'
          ? open ? <pre style={{ margin: 0, fontSize: 11, overflowX: 'auto' }}>{JSON.stringify(toolResult, null, 2)}</pre> : <span style={{ fontSize: 12 }}>Done</span>
          : role === 'assistant'
          ? <div className="md-body"><ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown></div>
          : <span style={{ whiteSpace: 'pre-wrap' }}>{content}</span>
        }
      </div>
    </div>
  );
};

// ── Chat Panel (streaming) ────────────────────────────────────────────────────

const ChatPanel: React.FC<{ agentId: string }> = ({ agentId }) => {
  const {
    threads, selectedThread, messages, sending, streamingText, streamingTools,
    fetchThreads, createThread, selectThread, sendMessage,
  } = useAgentStore();
  const [input, setInput] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => { fetchThreads(agentId); }, [agentId]);
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages, streamingText, streamingTools]);

  const handleSend = async () => {
    if (!input.trim() || !selectedThread) return;
    const msg = input.trim();
    setInput('');
    await sendMessage(selectedThread.id, msg);
  };

  return (
    <div style={{ display: 'flex', height: '100%', overflow: 'hidden' }}>
      {/* Thread list */}
      <div style={{ width: 180, borderRight: `1px solid ${C.border}`, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div style={{ padding: '8px 10px', borderBottom: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 11, color: C.muted, flex: 1 }}>THREADS</span>
          <button onClick={() => createThread(agentId)} style={{ background: 'none', border: 'none', color: C.accent, cursor: 'pointer', padding: 0, lineHeight: 0 }}>
            <Plus size={14} />
          </button>
        </div>
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {threads.filter((t) => t.agent_id === agentId).map((thread) => (
            <button key={thread.id} onClick={() => selectThread(thread)} style={{
              width: '100%', padding: '8px 10px', border: 'none', cursor: 'pointer', textAlign: 'left',
              backgroundColor: selectedThread?.id === thread.id ? C.accentDim : 'transparent',
              borderLeft: selectedThread?.id === thread.id ? `2px solid ${C.accent}` : '2px solid transparent',
              color: C.text,
            }}>
              <div style={{ fontSize: 12, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{thread.title || 'Thread'}</div>
              <div style={{ fontSize: 10, color: C.dim, marginTop: 2 }}>{thread.created_at ? new Date(thread.created_at).toLocaleTimeString() : ''}</div>
            </button>
          ))}
        </div>
      </div>

      {selectedThread ? (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div style={{ flex: 1, overflowY: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
            {messages.map((msg) => (
              <MsgBubble key={msg.id} role={msg.role} content={msg.content}
                toolName={msg.tool_name} toolInput={msg.tool_input} toolResult={msg.tool_result} />
            ))}

            {/* Live streaming tool trace */}
            {sending && streamingTools.map((t, i) => (
              <div key={i} style={{
                alignSelf: 'flex-start', display: 'flex', alignItems: 'center', gap: 8,
                backgroundColor: t.status === 'done' ? '#F0FDF4' : '#FFFBEB',
                border: `1px solid ${t.status === 'done' ? '#86EFAC' : '#FDE68A'}`,
                padding: '6px 12px', fontSize: 12,
              }}>
                {t.status === 'calling'
                  ? <Loader size={11} style={{ animation: 'spin 0.6s linear infinite', color: C.warn }} />
                  : <CheckCircle size={11} color={C.success} />}
                <span style={{ color: t.status === 'done' ? C.success : C.warn }}>
                  {TOOL_LABELS[t.name] || t.name}
                </span>
              </div>
            ))}

            {/* Live streaming text */}
            {sending && streamingText && (
              <div style={{ alignSelf: 'flex-start', maxWidth: '80%' }}>
                <span style={{ fontSize: 10, color: C.accent, fontWeight: 500 }}>Agent</span>
                <div style={{ backgroundColor: C.card, border: `1px solid ${C.border}`, padding: '8px 12px', fontSize: 13, color: C.text, whiteSpace: 'pre-wrap', marginTop: 2 }}>
                  {streamingText}<span style={{ opacity: 0.4 }}>▌</span>
                </div>
              </div>
            )}

            {sending && !streamingText && streamingTools.length === 0 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: C.muted }}>
                <Loader size={12} style={{ animation: 'spin 0.6s linear infinite' }} />
                <span style={{ fontSize: 12 }}>Agent thinking...</span>
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          <div style={{ borderTop: `1px solid ${C.border}`, padding: 12, display: 'flex', gap: 8 }}>
            <input value={input} onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
              placeholder="Message the agent..." disabled={sending}
              style={{ flex: 1, backgroundColor: C.bg, border: `1px solid ${C.border}`, color: C.text, padding: '8px 12px', fontSize: 13, outline: 'none' }}
            />
            <button onClick={handleSend} disabled={sending || !input.trim()} style={{
              padding: '8px 14px', backgroundColor: C.accentDim, border: `1px solid ${C.accent}`,
              color: C.accent, cursor: sending || !input.trim() ? 'default' : 'pointer',
              display: 'flex', alignItems: 'center', gap: 4, fontSize: 12,
            }}>
              <Send size={13} />
            </button>
          </div>
        </div>
      ) : (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.dim, flexDirection: 'column', gap: 8 }}>
          <MessageCircle size={28} color={C.border} />
          <div style={{ fontSize: 13 }}>Create or select a thread</div>
        </div>
      )}
    </div>
  );
};

// ── Test Playground Panel ─────────────────────────────────────────────────────

const AGENT_API_URL = import.meta.env.VITE_AGENT_SERVICE_URL || 'http://localhost:8013';

interface TraceItem {
  role: string;
  text?: string;
  tool?: string;
  input?: unknown;
  result?: unknown;
  toolUseId?: string;
}

const TestPanel: React.FC<{ agent: AgentConfig }> = ({ agent }) => {
  const [input, setInput] = useState('');
  const [dryRun, setDryRun] = useState(true);
  const [running, setRunning] = useState(false);
  const [trace, setTrace] = useState<TraceItem[]>([]);
  const [finalText, setFinalText] = useState('');
  const [iterations, setIterations] = useState(0);
  const [error, setError] = useState('');
  const traceEndRef = React.useRef<HTMLDivElement | null>(null);

  // Auto-scroll the trace to the bottom as new events arrive so the user
  // sees the latest step without having to scroll manually.
  React.useEffect(() => {
    traceEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [trace.length]);

  const run = async () => {
    if (!input.trim()) return;
    setRunning(true);
    setTrace([]);
    setFinalText('');
    setError('');
    setIterations(0);

    try {
      const resp = await fetch(`${AGENT_API_URL}/agents/${agent.id}/test/stream`, {
        method: 'POST',
        headers: { 'x-tenant-id': getTenantId(), 'Content-Type': 'application/json', Accept: 'text/event-stream' },
        body: JSON.stringify({ message: input.trim(), dry_run: dryRun }),
      });
      if (!resp.body) {
        setError('Streaming response had no body');
        return;
      }
      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      // Track in-flight tool calls by tool_use_id so we can update each
      // entry from `tool_start` (skeleton) → `tool_calling` (full input)
      // → `tool_result` (final output) without duplicating timeline rows.
      const liveText: { idx: number } = { idx: -1 };

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        // Split out completed SSE events. Each event ends with \n\n.
        const events = buffer.split('\n\n');
        buffer = events.pop() || '';
        for (const ev of events) {
          const line = ev.trim();
          if (!line.startsWith('data:')) continue;
          let payload: Record<string, unknown> = {};
          try {
            payload = JSON.parse(line.slice(5).trim());
          } catch {
            continue;
          }
          const type = payload.type as string;
          setTrace((prev) => {
            const next = [...prev];
            if (type === 'text_delta') {
              const txt = String(payload.text || '');
              // Coalesce consecutive text_delta events into one timeline row.
              if (liveText.idx === -1 || next[liveText.idx]?.role !== 'text') {
                next.push({ role: 'text', text: txt });
                liveText.idx = next.length - 1;
              } else {
                next[liveText.idx] = { ...next[liveText.idx], text: (next[liveText.idx].text || '') + txt };
              }
            } else if (type === 'tool_start') {
              liveText.idx = -1; // text run ended
              next.push({
                role: 'tool_use',
                tool: String(payload.tool || ''),
                toolUseId: String(payload.tool_use_id || ''),
                input: undefined,
              });
            } else if (type === 'tool_calling') {
              // Fill in the input args on the most recent matching tool_use row.
              for (let i = next.length - 1; i >= 0; i--) {
                if (next[i].role === 'tool_use' && next[i].tool === payload.tool && next[i].input === undefined) {
                  next[i] = { ...next[i], input: payload.input };
                  break;
                }
              }
            } else if (type === 'tool_result') {
              liveText.idx = -1;
              next.push({ role: 'tool_result', tool: String(payload.tool || ''), result: payload.result });
            } else if (type === 'error') {
              setError(String(payload.error || ''));
            } else if (type === 'done') {
              setIterations(Number(payload.iterations || 0));
              if (payload.error) setError(String(payload.error));
            } else if (type === 'final_text' && typeof payload.text === 'string') {
              setFinalText(payload.text);
            }
            return next;
          });
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  };

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ backgroundColor: '#EFF6FF', border: '1px solid #BFDBFE', borderRadius: 5, padding: '10px 14px', fontSize: 12, color: '#1E40AF' }}>
        Test your agent without saving to a thread. <strong>Dry run</strong> mode prevents any write actions from executing.
      </div>

      <textarea
        value={input} onChange={(e) => setInput(e.target.value)}
        placeholder="Type a test message for the agent..."
        style={{ width: '100%', minHeight: 80, padding: '8px 10px', fontSize: 13, border: `1px solid ${C.border}`, backgroundColor: C.bg, color: C.text, outline: 'none', resize: 'vertical', boxSizing: 'border-box' }}
      />

      <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
        <button onClick={run} disabled={running || !input.trim()} style={{
          padding: '7px 20px', fontSize: 12, fontWeight: 500, borderRadius: 4,
          backgroundColor: running ? C.bg : C.accentDim, border: `1px solid ${C.accent}`,
          color: C.accent, cursor: running || !input.trim() ? 'default' : 'pointer',
          display: 'flex', alignItems: 'center', gap: 6,
        }}>
          {running ? <><Loader size={12} style={{ animation: 'spin 0.6s linear infinite' }} /> Running...</> : 'Run Test'}
        </button>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: C.muted, cursor: 'pointer' }}>
          <input type="checkbox" checked={dryRun} onChange={(e) => setDryRun(e.target.checked)} style={{ accentColor: C.accent }} />
          Dry run (no writes)
        </label>
        {iterations > 0 && <span style={{ fontSize: 11, color: C.dim }}>{iterations} iteration{iterations !== 1 ? 's' : ''}</span>}
      </div>

      {/* Trace — vertical timeline with connector line */}
      {(trace.length > 0 || running) && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div style={{ fontSize: 11, color: C.muted, letterSpacing: '0.06em', marginBottom: 6 }}>
            REASONING TRACE {running && <span style={{ color: C.accent }}>· live</span>}
          </div>
          <div style={{ position: 'relative', paddingLeft: 22 }}>
            {/* Connector line running through the dots */}
            <div style={{
              position: 'absolute', left: 9, top: 8, bottom: 8, width: 2,
              backgroundColor: C.border,
            }} />
            {trace.map((item, i) => {
              const isLast = i === trace.length - 1;
              const colors = (() => {
                if (item.role === 'tool_use') return { dot: '#D97706', bg: '#FFFBEB', border: '#FDE68A' };
                if (item.role === 'tool_result') return { dot: '#059669', bg: '#F0FDF4', border: '#86EFAC' };
                return { dot: C.muted, bg: C.card, border: C.border };
              })();
              return (
                <div key={i} style={{ position: 'relative', marginBottom: 8 }}>
                  {/* Dot on the connector line */}
                  <div style={{
                    position: 'absolute', left: -22, top: 8, width: 12, height: 12,
                    borderRadius: '50%', backgroundColor: colors.dot,
                    boxShadow: `0 0 0 3px ${C.bg}`,
                    transition: 'background-color 200ms ease',
                  }} />
                  {/* Pulse on the latest dot while still streaming */}
                  {isLast && running && (
                    <div className="status-dot-live" style={{
                      position: 'absolute', left: -22, top: 8, width: 12, height: 12,
                      borderRadius: '50%', backgroundColor: colors.dot, opacity: 0.4,
                    }} />
                  )}
                  <div style={{
                    padding: '8px 12px', fontSize: 12,
                    backgroundColor: colors.bg, border: `1px solid ${colors.border}`, borderRadius: 4,
                  }}>
                    {item.role === 'tool_use' && (
                      <>
                        <span style={{ fontWeight: 600, color: '#B45309' }}>
                          → {TOOL_LABELS[item.tool || ''] || item.tool || 'tool'}
                        </span>
                        <pre style={{ margin: '4px 0 0', fontSize: 11, color: C.muted, maxHeight: 200, overflow: 'auto' }}>
                          {item.input === undefined ? '…resolving args…' : JSON.stringify(item.input, null, 2)}
                        </pre>
                      </>
                    )}
                    {item.role === 'tool_result' && (
                      <>
                        <span style={{ fontWeight: 600, color: '#047857' }}>
                          ← {TOOL_LABELS[item.tool || ''] || item.tool || 'result'}
                        </span>
                        <pre style={{ margin: '4px 0 0', fontSize: 11, color: C.muted, maxHeight: 160, overflow: 'auto' }}>
                          {typeof item.result === 'string' ? item.result : JSON.stringify(item.result, null, 2)}
                        </pre>
                      </>
                    )}
                    {item.role === 'text' && (
                      <span style={{ color: C.text, whiteSpace: 'pre-wrap' }}>{item.text}</span>
                    )}
                  </div>
                </div>
              );
            })}
            <div ref={traceEndRef} />
          </div>
        </div>
      )}

      {finalText && (
        <div>
          <div style={{ fontSize: 11, color: C.muted, letterSpacing: '0.06em', marginBottom: 6 }}>FINAL RESPONSE</div>
          <div style={{ backgroundColor: C.accentDim, border: `1px solid ${C.accent}44`, padding: '12px 14px', fontSize: 13, color: C.text, borderRadius: 4 }}>
            <div className="md-body"><ReactMarkdown remarkPlugins={[remarkGfm]}>{finalText}</ReactMarkdown></div>
          </div>
        </div>
      )}

      {error && <div style={{ color: C.error, fontSize: 12, backgroundColor: '#FEF2F2', border: '1px solid #FCA5A5', padding: '8px 12px', borderRadius: 4 }}>{error}</div>}
    </div>
  );
};

// ── History Panel ─────────────────────────────────────────────────────────────

const HistoryPanel: React.FC<{ agent: AgentConfig }> = ({ agent }) => {
  const { updateAgent, fetchAgents } = useAgentStore();
  const [versions, setVersions] = useState<{ id: string; version_number: number; config_snapshot: Record<string, unknown>; created_at: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [restoring, setRestoring] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const r = await fetch(`${AGENT_API_URL}/agents/${agent.id}/versions`, { headers: { 'x-tenant-id': getTenantId() } });
      const data = await r.json();
      setVersions(Array.isArray(data) ? data : []);
    } finally { setLoading(false); }
  };

  useEffect(() => { load(); }, [agent.id]);

  const restore = async (versionId: string) => {
    if (!confirm('Restore this version? Current config will be replaced.')) return;
    setRestoring(versionId);
    try {
      const r = await fetch(`${AGENT_API_URL}/agents/${agent.id}/versions/${versionId}/restore`, {
        method: 'POST', headers: { 'x-tenant-id': getTenantId() },
      });
      if (r.ok) { await fetchAgents(); await load(); }
    } finally { setRestoring(null); }
  };

  if (loading) return <div style={{ padding: 24, color: C.dim, fontSize: 13 }}>Loading versions...</div>;

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: 20, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ fontSize: 11, color: C.muted, letterSpacing: '0.06em', marginBottom: 4 }}>
        VERSION HISTORY — saved on every config change
      </div>
      {versions.length === 0 && <div style={{ color: C.dim, fontSize: 13 }}>No versions saved yet. Edit and save the agent to create a version.</div>}
      {versions.map((v) => {
        const snap = v.config_snapshot as Record<string, unknown>;
        return (
          <div key={v.id} style={{ backgroundColor: C.panel, border: `1px solid ${C.border}`, borderRadius: 5, padding: '12px 14px', display: 'flex', alignItems: 'flex-start', gap: 12 }}>
            <div style={{ flex: 1 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: C.text }}>v{v.version_number}</span>
                <span style={{ fontSize: 11, color: C.dim }}>{v.created_at ? new Date(v.created_at).toLocaleString() : ''}</span>
              </div>
              <div style={{ fontSize: 11, color: C.muted }}>
                Model: <code style={{ fontSize: 11 }}>{String(snap.model || '').replace('claude-', '')}</code>
                {' · '}
                Tools: {((snap.enabled_tools as string[]) || []).length}
                {' · '}
                Prompt: {String(snap.system_prompt || '').slice(0, 50)}…
              </div>
            </div>
            <button
              onClick={() => restore(v.id)} disabled={restoring === v.id}
              style={{
                padding: '4px 12px', fontSize: 11, cursor: restoring === v.id ? 'default' : 'pointer',
                backgroundColor: C.bg, border: `1px solid ${C.border}`, color: C.muted, borderRadius: 3, flexShrink: 0,
              }}
            >
              {restoring === v.id ? 'Restoring...' : 'Restore'}
            </button>
          </div>
        );
      })}
    </div>
  );
};

// ── Analytics Panel ───────────────────────────────────────────────────────────

const AnalyticsPanel: React.FC<{ agent: AgentConfig }> = ({ agent }) => {
  const [data, setData] = useState<{
    total_runs: number; avg_iterations: number; error_rate: number;
    top_tools: { tool: string; count: number }[];
    runs_per_day: { date: string; count: number }[];
    recent_runs: { id: string; iterations: number; is_test: boolean; tool_count: number; error?: string; created_at: string }[];
  } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetch(`${AGENT_API_URL}/agents/${agent.id}/analytics`, { headers: { 'x-tenant-id': getTenantId() } })
      .then(r => r.ok ? r.json() : null)
      .then(d => setData(d && typeof d.total_runs === 'number' ? d : null))
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [agent.id]);

  if (loading) return <div style={{ padding: 24, color: C.dim, fontSize: 13 }}>Loading analytics...</div>;
  if (!data || !data.total_runs) return <div style={{ padding: 24, color: C.dim, fontSize: 13 }}>No runs yet. Chat with the agent or run a test to generate analytics.</div>;

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: 20, display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Summary cards */}
      <div style={{ display: 'flex', gap: 12 }}>
        {[
          { label: 'Total runs', value: data.total_runs },
          { label: 'Avg iterations', value: data.avg_iterations },
          { label: 'Error rate', value: `${data.error_rate}%` },
        ].map(({ label, value }) => (
          <div key={label} style={{ flex: 1, backgroundColor: C.panel, border: `1px solid ${C.border}`, borderRadius: 6, padding: '14px 16px' }}>
            <div style={{ fontSize: 22, fontWeight: 700, color: C.text, fontFamily: 'monospace' }}>{value}</div>
            <div style={{ fontSize: 11, color: C.muted, marginTop: 4 }}>{label}</div>
          </div>
        ))}
      </div>

      {/* Top tools */}
      {data.top_tools.length > 0 && (
        <div>
          <div style={{ fontSize: 11, color: C.muted, letterSpacing: '0.06em', marginBottom: 8 }}>TOP TOOLS</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {data.top_tools.map(({ tool, count }) => {
              const pct = Math.round(count / data.total_runs * 100);
              return (
                <div key={tool} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ fontSize: 12, color: C.text, width: 160, flexShrink: 0 }}>{TOOL_LABELS[tool] || tool}</span>
                  <div style={{ flex: 1, height: 6, backgroundColor: C.border, borderRadius: 3, overflow: 'hidden' }}>
                    <div style={{ width: `${Math.min(pct, 100)}%`, height: '100%', backgroundColor: C.accent }} />
                  </div>
                  <span style={{ fontSize: 11, color: C.dim, width: 40, textAlign: 'right' }}>{count}×</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Recent runs */}
      <div>
        <div style={{ fontSize: 11, color: C.muted, letterSpacing: '0.06em', marginBottom: 8 }}>RECENT RUNS</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {data.recent_runs.map((run) => (
            <div key={run.id} style={{
              display: 'flex', alignItems: 'center', gap: 10, padding: '6px 10px',
              backgroundColor: C.panel, border: `1px solid ${C.border}`,
              borderLeft: run.error ? '3px solid #DC2626' : `1px solid ${C.border}`,
              borderRadius: 4, fontSize: 12,
            }}>
              <span style={{ color: run.error ? C.error : C.success, flexShrink: 0 }}>{run.error ? '✗' : '✓'}</span>
              <span style={{ color: C.muted, fontSize: 10, flexShrink: 0 }}>{run.is_test ? 'TEST' : 'CHAT'}</span>
              <span style={{ color: C.text, flex: 1 }}>{run.iterations} iter · {run.tool_count} tool call{run.tool_count !== 1 ? 's' : ''}</span>
              <span style={{ color: C.dim, fontSize: 11 }}>{run.created_at ? new Date(run.created_at).toLocaleString() : ''}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

// ── Schedule Panel ────────────────────────────────────────────────────────────

const CRON_PRESETS = [
  { label: 'Every hour',       value: '0 * * * *' },
  { label: 'Every day 9am',   value: '0 9 * * *' },
  { label: 'Every Monday',    value: '0 9 * * 1' },
  { label: 'Every weekday',   value: '0 9 * * 1-5' },
  { label: 'Every 6 hours',   value: '0 */6 * * *' },
];

const SchedulePanel: React.FC<{ agent: AgentConfig }> = ({ agent }) => {
  const { schedules, fetchSchedules, createSchedule, updateSchedule, deleteSchedule, runScheduleNow } = useAgentStore();
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ name: '', prompt: '', cron_expression: '0 9 * * *', enabled: true });
  const [saving, setSaving] = useState(false);
  const [runningId, setRunningId] = useState<string | null>(null);

  useEffect(() => { fetchSchedules(agent.id); }, [agent.id]);

  const agentSchedules = schedules.filter((s) => s.agent_id === agent.id);

  const handleCreate = async () => {
    if (!form.name || !form.prompt) return;
    setSaving(true);
    try {
      await createSchedule(agent.id, form);
      setCreating(false);
      setForm({ name: '', prompt: '', cron_expression: '0 9 * * *', enabled: true });
    } finally { setSaving(false); }
  };

  const handleRunNow = async (s: AgentSchedule) => {
    setRunningId(s.id);
    try { await runScheduleNow(agent.id, s.id); }
    finally { setTimeout(() => setRunningId(null), 2000); }
  };

  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '7px 10px', fontSize: 12, borderRadius: 4,
    border: `1px solid ${C.border}`, backgroundColor: C.bg, color: C.text,
    outline: 'none', boxSizing: 'border-box',
  };

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <Clock size={14} color={C.accent} />
        <span style={{ fontSize: 13, fontWeight: 600 }}>Autonomous Schedules</span>
        <span style={{ fontSize: 11, color: C.muted, flex: 1 }}>
          Agent runs automatically on a cron schedule and pushes findings to Human Actions.
        </span>
        <button
          onClick={() => setCreating(true)}
          style={{
            padding: '5px 12px', fontSize: 11, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4,
            backgroundColor: C.accentDim, border: `1px solid ${C.accent}`, color: C.accent, borderRadius: 4,
          }}
        >
          <Plus size={11} /> New Schedule
        </button>
      </div>

      {creating && (
        <div style={{
          border: `1px solid ${C.accent}`, borderRadius: 8, padding: 16,
          backgroundColor: C.accentDim + '44', display: 'flex', flexDirection: 'column', gap: 10,
        }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: C.accent }}>New Schedule</div>
          <div>
            <label style={{ fontSize: 11, color: C.muted, display: 'block', marginBottom: 4 }}>Name</label>
            <input style={inputStyle} placeholder="e.g. Daily anomaly check" value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
          </div>
          <div>
            <label style={{ fontSize: 11, color: C.muted, display: 'block', marginBottom: 4 }}>Prompt (what the agent should do)</label>
            <textarea style={{ ...inputStyle, resize: 'vertical', minHeight: 80, fontFamily: 'inherit' }}
              placeholder="e.g. Analyze all Deal records for anomalies — flag any deals that have been in the same stage for more than 30 days, or any deals with unusual activity patterns."
              value={form.prompt}
              onChange={(e) => setForm((f) => ({ ...f, prompt: e.target.value }))}
            />
          </div>
          <div>
            <label style={{ fontSize: 11, color: C.muted, display: 'block', marginBottom: 4 }}>Schedule (cron expression)</label>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 6 }}>
              {CRON_PRESETS.map((p) => (
                <button key={p.value} onClick={() => setForm((f) => ({ ...f, cron_expression: p.value }))}
                  style={{
                    fontSize: 10, padding: '3px 8px', borderRadius: 4, cursor: 'pointer',
                    backgroundColor: form.cron_expression === p.value ? C.accentDim : C.bg,
                    border: `1px solid ${form.cron_expression === p.value ? C.accent : C.border}`,
                    color: form.cron_expression === p.value ? C.accent : C.muted,
                  }}>{p.label}</button>
              ))}
            </div>
            <input style={inputStyle} value={form.cron_expression}
              onChange={(e) => setForm((f) => ({ ...f, cron_expression: e.target.value }))}
              placeholder="0 9 * * *" />
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={handleCreate} disabled={saving || !form.name || !form.prompt}
              style={{
                padding: '7px 16px', fontSize: 12, borderRadius: 4, cursor: 'pointer', fontWeight: 500,
                backgroundColor: C.accentDim, border: `1px solid ${C.accent}`, color: C.accent,
              }}>{saving ? 'Saving…' : 'Create Schedule'}</button>
            <button onClick={() => setCreating(false)}
              style={{ padding: '7px 12px', fontSize: 12, borderRadius: 4, cursor: 'pointer', backgroundColor: 'transparent', border: `1px solid ${C.border}`, color: C.muted }}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {agentSchedules.length === 0 && !creating && (
        <div style={{ textAlign: 'center', padding: 40, color: C.dim, fontSize: 13 }}>
          No schedules yet. Create one to run this agent automatically.
        </div>
      )}

      {agentSchedules.map((s) => (
        <div key={s.id} style={{
          border: `1px solid ${s.enabled ? '#22C55E44' : C.border}`,
          borderRadius: 8, padding: 14, backgroundColor: s.enabled ? '#F0FDF444' : C.panel,
          display: 'flex', flexDirection: 'column', gap: 8,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {s.enabled && (
              <span style={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: '#22C55E', flexShrink: 0, animation: 'pulse-green 2s infinite' }} />
            )}
            <span style={{ fontSize: 13, fontWeight: 600, color: C.text, flex: 1 }}>{s.name}</span>
            <span style={{
              fontSize: 10, fontFamily: 'monospace', padding: '2px 6px', borderRadius: 4,
              backgroundColor: C.bg, border: `1px solid ${C.border}`, color: C.muted,
            }}>{s.cron_expression}</span>
            <button
              onClick={() => updateSchedule(agent.id, s.id, { enabled: !s.enabled })}
              style={{
                fontSize: 10, padding: '2px 8px', borderRadius: 10, cursor: 'pointer', fontWeight: 500,
                backgroundColor: s.enabled ? '#DCFCE7' : C.bg,
                border: `1px solid ${s.enabled ? '#22C55E' : C.border}`,
                color: s.enabled ? '#16A34A' : C.muted,
              }}
            >{s.enabled ? 'Active' : 'Paused'}</button>
            <button
              onClick={() => handleRunNow(s)}
              disabled={runningId === s.id}
              title="Run now"
              style={{
                background: 'none', border: 'none', cursor: 'pointer', color: C.accent,
                display: 'flex', alignItems: 'center', padding: 2,
              }}
            ><Play size={13} /></button>
            <button
              onClick={() => deleteSchedule(agent.id, s.id)}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.dim, padding: 2 }}
            ><Trash2 size={13} /></button>
          </div>
          <p style={{ margin: 0, fontSize: 12, color: C.muted, lineHeight: 1.5 }}>{s.prompt}</p>
          {s.last_run_at && (
            <div style={{ fontSize: 10, color: C.dim }}>
              Last run: {new Date(s.last_run_at).toLocaleString()}
            </div>
          )}
        </div>
      ))}
    </div>
  );
};

// ── Audit Panel ───────────────────────────────────────────────────────────────

interface AuditRun {
  id: string; agent_id: string; agent_name: string;
  pipeline_id: string | null; iterations: number;
  tool_calls: { tool: string; input?: Record<string, unknown>; result?: string }[];
  final_text: string | null; error: string | null; created_at: string;
}

const AuditPanel: React.FC<{ agent: AgentConfig }> = ({ agent }) => {
  const [runs, setRuns] = useState<AuditRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    fetch(`${AGENT_API_URL}/agents/runs/audit?agent_id=${agent.id}&limit=50`, {
      headers: { 'x-tenant-id': getTenantId() },
    })
      .then(r => r.ok ? r.json() : [])
      .then(setRuns)
      .catch(() => setRuns([]))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, [agent.id]);

  if (loading) return <div style={{ padding: 24, color: C.dim, fontSize: 13 }}>Loading audit log...</div>;
  if (!runs.length) return (
    <div style={{ padding: 24, color: C.dim, fontSize: 13 }}>
      No runs recorded yet. Runs will appear here after the agent fires from a pipeline or test.
    </div>
  );

  const fmt = (iso: string) => new Date(iso).toLocaleString();
  const toolColor = (tool: string) => {
    if (tool === 'action_propose') return '#7C3AED';
    if (tool === 'utility_run') return '#0891B2';
    if (tool === 'query_records') return '#2563EB';
    if (tool === 'get_object_schema') return '#3B82F6';
    return '#64748B';
  };

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <span style={{ fontSize: 11, color: C.muted, letterSpacing: '0.06em' }}>AGENT RUN AUDIT LOG ({runs.length})</span>
        <button onClick={load} style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.dim, fontSize: 11, display: 'flex', alignItems: 'center', gap: 4 }}>
          <RefreshCw size={11} /> Refresh
        </button>
      </div>

      {runs.map(run => {
        const isOpen = expanded === run.id;
        const hasError = !!run.error;
        const proposeCount = run.tool_calls.filter(t => t.tool === 'action_propose').length;

        return (
          <div key={run.id} style={{
            border: `1px solid ${C.border}`, borderRadius: 6,
            backgroundColor: C.panel, overflow: 'hidden',
            borderLeft: hasError ? '3px solid #DC2626' : '3px solid transparent',
          }}>
            {/* Row header */}
            <div
              onClick={() => setExpanded(isOpen ? null : run.id)}
              style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', cursor: 'pointer' }}
            >
              {/* Status dot */}
              <span style={{
                width: 7, height: 7, borderRadius: '50%', flexShrink: 0,
                backgroundColor: hasError ? '#DC2626' : '#16A34A',
              }} />
              <span style={{ fontSize: 12, color: C.dim, fontFamily: 'monospace', flexShrink: 0 }}>
                {fmt(run.created_at)}
              </span>
              <span style={{ fontSize: 13, fontWeight: 600, color: C.text, flex: 1 }}>
                {run.agent_name}
              </span>
              {run.pipeline_id && (
                <span style={{ fontSize: 11, padding: '2px 7px', borderRadius: 8, backgroundColor: '#EFF6FF', color: '#2563EB', border: '1px solid #BFDBFE' }}>
                  pipeline
                </span>
              )}
              {proposeCount > 0 && (
                <span style={{ fontSize: 11, padding: '2px 7px', borderRadius: 8, backgroundColor: '#F3E8FF', color: '#7C3AED', border: '1px solid #DDD6FE' }}>
                  {proposeCount} proposed
                </span>
              )}
              <span style={{ fontSize: 12, color: C.muted }}>{run.iterations} iter · {run.tool_calls.length} calls</span>
              {hasError && <span style={{ fontSize: 11, color: '#DC2626', fontWeight: 600 }}>FAILED</span>}
              <ChevronRight size={13} color={C.dim} style={{ transform: isOpen ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s' }} />
            </div>

            {/* Expanded detail */}
            {isOpen && (
              <div style={{ borderTop: `1px solid ${C.border}`, padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 10 }}>

                {/* Tool calls */}
                {run.tool_calls.length > 0 && (
                  <div>
                    <div style={{ fontSize: 10, color: C.muted, letterSpacing: '0.06em', marginBottom: 6 }}>TOOL CALLS</div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      {run.tool_calls.map((tc, i) => (
                        <div key={i} style={{ backgroundColor: C.bg, border: `1px solid ${C.border}`, borderRadius: 4, padding: '6px 10px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: tc.input ? 6 : 0 }}>
                            <span style={{
                              fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 3,
                              backgroundColor: toolColor(tc.tool) + '18', color: toolColor(tc.tool),
                              border: `1px solid ${toolColor(tc.tool)}44`,
                            }}>{tc.tool}</span>
                          </div>
                          {tc.input && Object.keys(tc.input).length > 0 && (
                            <pre style={{ margin: 0, fontSize: 10, color: C.muted, fontFamily: 'monospace', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                              {JSON.stringify(tc.input, null, 2).slice(0, 400)}
                            </pre>
                          )}
                          {tc.result && (
                            <div style={{ marginTop: 4, fontSize: 10, color: C.success, fontFamily: 'monospace', wordBreak: 'break-all' }}>
                              ↳ {tc.result.slice(0, 200)}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Final summary */}
                {run.final_text && (
                  <div>
                    <div style={{ fontSize: 10, color: C.muted, letterSpacing: '0.06em', marginBottom: 4 }}>AGENT SUMMARY</div>
                    <pre style={{ margin: 0, fontSize: 11, color: C.text, fontFamily: 'inherit', whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>
                      {run.final_text}
                    </pre>
                  </div>
                )}

                {/* Error */}
                {run.error && (
                  <div style={{ fontSize: 11, color: '#DC2626', fontFamily: 'monospace' }}>{run.error}</div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};

// ── Main AgentStudio ──────────────────────────────────────────────────────────

const AgentStudio: React.FC = () => {
  const {
    agents, selectedAgent, availableTools, loading, schedules,
    fetchAgents, selectAgent, createAgent, updateAgent, deleteAgent, fetchAvailableTools, fetchSchedules,
  } = useAgentStore();
  const { setBreadcrumbs, navigateTo } = useNavigationStore();

  const [rightTab, setRightTab] = useState<'config' | 'knowledge' | 'chat' | 'test' | 'history' | 'analytics' | 'schedule' | 'audit' | 'comments'>('config');

  useEffect(() => {
    fetchAgents();
    fetchAvailableTools();
    setBreadcrumbs([{ label: 'Agent Studio' }]);
  }, []);

  useEffect(() => {
    if (selectedAgent) {
      fetchSchedules(selectedAgent.id);
      setBreadcrumbs([
        { label: 'Agent Studio', page: 'agents' },
        { label: selectedAgent.name },
      ]);
    }
  }, [selectedAgent?.id]);

  const panelStyle: React.CSSProperties = {
    backgroundColor: C.panel, borderRight: `1px solid ${C.border}`,
    display: 'flex', flexDirection: 'column', overflow: 'hidden',
  };

  return (
    <div style={{ display: 'flex', height: '100%', backgroundColor: C.bg, color: C.text, fontFamily: 'system-ui, sans-serif' }}>

      {/* Left: agent list */}
      <div style={{ ...panelStyle, width: 220, minWidth: 220 }}>
        <div style={{
          height: 52, display: 'flex', alignItems: 'center', padding: '0 14px',
          borderBottom: `1px solid ${C.border}`, gap: 8,
        }}>
          <Bot size={14} color={C.accent} />
          <span style={{ fontSize: 13, fontWeight: 600 }}>Agents</span>
          <button
            onClick={async () => {
              const agent = await createAgent({
                name: 'New Agent',
                system_prompt: 'You are a helpful AI assistant with access to the Nexus data ontology.',
                model: 'claude-haiku-4-5-20251001',
                enabled_tools: ['list_object_types', 'get_object_schema', 'query_records', 'count_records'],
                max_iterations: 10,
              });
              selectAgent(agent);
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
          {agents.map((agent) => (
            <button
              key={agent.id}
              onClick={() => { selectAgent(agent); setRightTab('config'); }}
              style={{
                display: 'flex', flexDirection: 'column', alignItems: 'flex-start',
                width: '100%', padding: '8px 14px', gap: 4, border: 'none', cursor: 'pointer',
                backgroundColor: selectedAgent?.id === agent.id ? C.accentDim : 'transparent',
                borderLeft: selectedAgent?.id === agent.id ? `2px solid ${C.accent}` : '2px solid transparent',
                color: C.text,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, width: '100%' }}>
                <span style={{ fontSize: 13, fontWeight: selectedAgent?.id === agent.id ? 500 : 400, textAlign: 'left', flex: 1 }}>
                  {agent.name}
                </span>
                {schedules.some((s) => s.agent_id === agent.id && s.enabled) && (
                  <span title="Has active schedules" style={{
                    width: 8, height: 8, borderRadius: '50%', backgroundColor: '#22C55E', flexShrink: 0,
                    boxShadow: '0 0 0 0 rgba(34,197,94,0.7)',
                    animation: 'pulse-green 2s infinite',
                  }} />
                )}
              </div>
              <div style={{ display: 'flex', gap: 4, alignItems: 'center', flexWrap: 'wrap' }}>
                {agent.enabled_tools.slice(0, 2).map((t) => {
                  const meta = TOOL_META[t];
                  return (
                    <span key={t} style={{
                      fontSize: 9, padding: '1px 5px', backgroundColor: C.bg,
                      color: meta?.color || C.dim, border: `1px solid ${meta?.color ? meta.color + '44' : C.border}`,
                      borderRadius: 3, display: 'flex', alignItems: 'center', gap: 2,
                    }}>
                      {meta?.label || t.replace(/_/g, ' ')}
                    </span>
                  );
                })}
                {agent.enabled_tools.length > 2 && (
                  <span style={{ fontSize: 9, color: C.dim }}>+{agent.enabled_tools.length - 2}</span>
                )}
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Right: config + chat */}
      {selectedAgent ? (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {/* Tab bar */}
          <div style={{
            height: 52, display: 'flex', alignItems: 'center', gap: 0,
            borderBottom: `1px solid ${C.border}`, backgroundColor: C.panel, padding: '0 16px', flexShrink: 0,
          }}>
            <span style={{ fontSize: 15, fontWeight: 600, marginRight: 8 }}>{selectedAgent.name}</span>
            <button
              onClick={() => { navigateTo('evals'); }}
              title="Create eval suite for this agent"
              style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '4px 10px', fontSize: 11, fontWeight: 600, border: `1px solid ${C.border}`, borderRadius: 5, backgroundColor: C.panel, color: C.accent, cursor: 'pointer', marginRight: 12 }}
            >
              <CheckCircle size={11} /> Eval Suite
            </button>
            {([
              { id: 'config', label: 'Configure', icon: <Wrench size={12} /> },
              { id: 'knowledge', label: 'Knowledge', icon: <Database size={12} />, badge: Array.isArray(selectedAgent.knowledge_scope) ? selectedAgent.knowledge_scope.length : null },
              { id: 'chat', label: 'Chat', icon: <MessageCircle size={12} /> },
              { id: 'test', label: 'Test', icon: <CheckCircle size={12} /> },
              { id: 'schedule', label: 'Schedule', icon: <Clock size={12} />, badge: schedules.filter((s) => s.agent_id === selectedAgent.id && s.enabled).length || null },
              { id: 'history', label: 'History', icon: <Loader size={12} /> },
              { id: 'analytics', label: 'Analytics', icon: <Bot size={12} /> },
              { id: 'audit', label: 'Audit', icon: <Shield size={12} /> },
              { id: 'comments', label: 'Comments', icon: <MessageSquare size={12} /> },
            ] as const).map((tab) => (
              <button key={tab.id} onClick={() => setRightTab(tab.id as typeof rightTab)} style={{
                padding: '8px 12px', fontSize: 12, border: 'none', cursor: 'pointer',
                backgroundColor: 'transparent',
                color: rightTab === tab.id ? C.text : C.dim,
                borderBottom: rightTab === tab.id ? `2px solid ${C.accent}` : '2px solid transparent',
                height: '100%', display: 'flex', alignItems: 'center', gap: 5,
              }}>
                {tab.icon} {tab.label}
                {'badge' in tab && tab.badge !== null && tab.badge > 0 && (
                  <span style={{ fontSize: 9, backgroundColor: tab.id === 'schedule' ? '#DCFCE7' : C.accentDim, color: tab.id === 'schedule' ? '#16A34A' : C.accent, padding: '1px 5px', borderRadius: 8 }}>
                    {tab.badge}
                  </span>
                )}
              </button>
            ))}
          </div>

          {rightTab === 'config' && (
            <AgentConfigPanel agent={selectedAgent} availableTools={availableTools}
              onSave={(data) => updateAgent(selectedAgent.id, data)}
              onDelete={() => deleteAgent(selectedAgent.id)} />
          )}
          {rightTab === 'knowledge' && <KnowledgePanel agent={selectedAgent} />}
          {rightTab === 'chat' && <div style={{ flex: 1, overflow: 'hidden' }}><ChatPanel agentId={selectedAgent.id} /></div>}
          {rightTab === 'test' && <TestPanel agent={selectedAgent} />}
          {rightTab === 'schedule' && <SchedulePanel agent={selectedAgent} />}
          {rightTab === 'history' && <HistoryPanel agent={selectedAgent} />}
          {rightTab === 'analytics' && <AnalyticsPanel agent={selectedAgent} />}
          {rightTab === 'audit' && <AuditPanel agent={selectedAgent} />}
          {rightTab === 'comments' && (
            <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
              <CommentsPanel entityType="agent" entityId={selectedAgent.id} compact />
            </div>
          )}
        </div>
      ) : (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.dim, flexDirection: 'column', gap: 8 }}>
          <Bot size={32} color={C.border} />
          <div style={{ fontSize: 13 }}>Select or create an Agent</div>
        </div>
      )}

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes pulse-green {
          0% { box-shadow: 0 0 0 0 rgba(34,197,94,0.7); }
          70% { box-shadow: 0 0 0 6px rgba(34,197,94,0); }
          100% { box-shadow: 0 0 0 0 rgba(34,197,94,0); }
        }
        .md-body { line-height: 1.6; font-size: 13px; color: #0D1117; }
        .md-body h1,.md-body h2,.md-body h3 { font-size: 14px; font-weight: 600; margin: 8px 0 4px; }
        .md-body p { margin: 4px 0; }
        .md-body ul,.md-body ol { margin: 4px 0; padding-left: 18px; }
        .md-body li { margin: 2px 0; }
        .md-body strong { font-weight: 600; }
        .md-body code { font-family: monospace; font-size: 11px; background: #F1F5F9; padding: 1px 4px; border-radius: 3px; }
        .md-body pre { background: #F1F5F9; border-radius: 4px; padding: 8px; overflow-x: auto; margin: 6px 0; }
        .md-body pre code { background: none; padding: 0; }
        .md-body blockquote { border-left: 3px solid #E2E8F0; margin: 4px 0; padding-left: 10px; color: #64748B; }
        .md-body table { border-collapse: collapse; width: 100%; font-size: 12px; margin: 6px 0; }
        .md-body th,.md-body td { border: 1px solid #E2E8F0; padding: 4px 8px; text-align: left; }
        .md-body th { background: #F8FAFC; font-weight: 600; }
        .md-body a { color: #7C3AED; text-decoration: underline; }
        .md-body hr { border: none; border-top: 1px solid #E2E8F0; margin: 8px 0; }
      `}</style>
    </div>
  );
};

export default AgentStudio;
