import React, { useEffect, useState, useRef } from 'react';
import { useAgentStore, AgentConfig, KnowledgeScopeEntry } from '../../store/agentStore';
import { useOntologyStore } from '../../store/ontologyStore';
import { Plus, Send, Trash2, Bot, Loader, Wrench, MessageCircle, Database, Filter, X } from 'lucide-react';

const C = {
  bg: '#F8FAFC', sidebar: '#F1F5F9', panel: '#FFFFFF', card: '#F8FAFC',
  border: '#E2E8F0', accent: '#7C3AED', accentDim: '#EDE9FE',
  text: '#0D1117', muted: '#64748B', dim: '#94A3B8',
  success: '#059669', error: '#DC2626', warn: '#D97706',
};

const TOOL_LABELS: Record<string, string> = {
  ontology_search: 'Ontology Search',
  list_object_types: 'List Object Types',
  logic_function_run: 'Run Logic Function',
  action_propose: 'Propose Action',
  list_actions: 'List Actions',
};

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

  useEffect(() => { setForm({ ...agent }); setDirty(false); }, [agent.id]);

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
            <option value="claude-haiku-4-5-20251001">Haiku 4.5</option>
            <option value="claude-sonnet-4-6">Sonnet 4.6</option>
            <option value="claude-opus-4-6">Opus 4.6</option>
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
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {availableTools.map((tool) => {
            const enabled = form.enabled_tools.includes(tool);
            return (
              <label key={tool} style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={enabled}
                  onChange={() => {
                    const tools = enabled
                      ? form.enabled_tools.filter((t) => t !== tool)
                      : [...form.enabled_tools, tool];
                    u({ enabled_tools: tools });
                  }}
                  style={{ accentColor: C.accent }}
                />
                <span style={{ fontSize: 12, color: C.text }}>{TOOL_LABELS[tool] || tool}</span>
                <span style={{ fontSize: 10, color: C.dim, marginLeft: 'auto', fontFamily: 'monospace' }}>{tool}</span>
              </label>
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

// ── Chat Panel ────────────────────────────────────────────────────────────────

const ChatPanel: React.FC<{ agentId: string }> = ({ agentId }) => {
  const {
    threads, selectedThread, messages, sending,
    fetchThreads, createThread, selectThread, sendMessage,
  } = useAgentStore();
  const [input, setInput] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => { fetchThreads(agentId); }, [agentId]);
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  const handleSend = async () => {
    if (!input.trim() || !selectedThread) return;
    const msg = input.trim();
    setInput('');
    await sendMessage(selectedThread.id, msg);
  };

  const roleColor = (role: string) => {
    if (role === 'user') return C.text;
    if (role === 'assistant') return C.accent;
    if (role === 'tool_use') return C.warn;
    if (role === 'tool_result') return C.success;
    return C.muted;
  };

  const roleLabel = (role: string) => {
    if (role === 'user') return 'You';
    if (role === 'assistant') return 'Agent';
    if (role === 'tool_use') return 'Tool Call';
    if (role === 'tool_result') return 'Tool Result';
    return role;
  };

  return (
    <div style={{ display: 'flex', height: '100%', overflow: 'hidden' }}>
      {/* Thread list */}
      <div style={{
        width: 180, borderRight: `1px solid ${C.border}`, display: 'flex',
        flexDirection: 'column', overflow: 'hidden',
      }}>
        <div style={{
          padding: '8px 10px', borderBottom: `1px solid ${C.border}`,
          display: 'flex', alignItems: 'center', gap: 6,
        }}>
          <span style={{ fontSize: 11, color: C.muted, flex: 1 }}>THREADS</span>
          <button
            onClick={() => createThread(agentId)}
            style={{ background: 'none', border: 'none', color: C.accent, cursor: 'pointer', padding: 0, lineHeight: 0 }}
          >
            <Plus size={14} />
          </button>
        </div>
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {threads.filter((t) => t.agent_id === agentId).map((thread) => (
            <button
              key={thread.id}
              onClick={() => selectThread(thread)}
              style={{
                width: '100%', padding: '8px 10px', border: 'none', cursor: 'pointer', textAlign: 'left',
                backgroundColor: selectedThread?.id === thread.id ? C.accentDim : 'transparent',
                borderLeft: selectedThread?.id === thread.id ? `2px solid ${C.accent}` : '2px solid transparent',
                color: C.text,
              }}
            >
              <div style={{ fontSize: 12, fontWeight: 400, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {thread.title || `Thread`}
              </div>
              <div style={{ fontSize: 10, color: C.dim, marginTop: 2 }}>
                {thread.created_at ? new Date(thread.created_at).toLocaleTimeString() : ''}
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Messages */}
      {selectedThread ? (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div style={{ flex: 1, overflowY: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
            {messages.map((msg) => (
              <div key={msg.id} style={{
                display: 'flex', flexDirection: 'column', gap: 2,
                alignSelf: msg.role === 'user' ? 'flex-end' : 'flex-start',
                maxWidth: '80%',
              }}>
                <span style={{ fontSize: 10, color: roleColor(msg.role), fontWeight: 500 }}>
                  {roleLabel(msg.role)}
                </span>
                <div style={{
                  backgroundColor: msg.role === 'user' ? C.accentDim : C.card,
                  border: `1px solid ${msg.role === 'user' ? C.accent + '44' : C.border}`,
                  padding: '8px 12px', fontSize: 13, color: C.text,
                  whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                }}>
                  {msg.role === 'tool_use' && msg.tool_name
                    ? `${TOOL_LABELS[msg.tool_name] || msg.tool_name}\n${JSON.stringify(msg.tool_input, null, 2)}`
                    : msg.role === 'tool_result'
                    ? <pre style={{ margin: 0, fontSize: 11, overflowX: 'auto' }}>{JSON.stringify(msg.tool_result, null, 2)}</pre>
                    : msg.content
                  }
                </div>
              </div>
            ))}
            {sending && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: C.muted }}>
                <Loader size={12} style={{ animation: 'spin 0.6s linear infinite' }} />
                <span style={{ fontSize: 12 }}>Agent thinking...</span>
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          {/* Input */}
          <div style={{ borderTop: `1px solid ${C.border}`, padding: 12, display: 'flex', gap: 8 }}>
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
              placeholder="Message the agent..."
              disabled={sending}
              style={{
                flex: 1, backgroundColor: C.bg, border: `1px solid ${C.border}`,
                color: C.text, padding: '8px 12px', fontSize: 13, outline: 'none',
              }}
            />
            <button
              onClick={handleSend}
              disabled={sending || !input.trim()}
              style={{
                padding: '8px 14px', backgroundColor: C.accentDim, border: `1px solid ${C.accent}`,
                color: C.accent, cursor: sending || !input.trim() ? 'default' : 'pointer',
                display: 'flex', alignItems: 'center', gap: 4, fontSize: 12,
              }}
            >
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

// ── Main AgentStudio ──────────────────────────────────────────────────────────

const AgentStudio: React.FC = () => {
  const {
    agents, selectedAgent, availableTools, loading,
    fetchAgents, selectAgent, createAgent, updateAgent, deleteAgent, fetchAvailableTools,
  } = useAgentStore();

  const [rightTab, setRightTab] = useState<'config' | 'knowledge' | 'chat'>('config');

  useEffect(() => { fetchAgents(); fetchAvailableTools(); }, []);

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
                enabled_tools: ['ontology_search', 'list_object_types'],
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
                width: '100%', padding: '8px 14px', gap: 2, border: 'none', cursor: 'pointer',
                backgroundColor: selectedAgent?.id === agent.id ? C.accentDim : 'transparent',
                borderLeft: selectedAgent?.id === agent.id ? `2px solid ${C.accent}` : '2px solid transparent',
                color: C.text,
              }}
            >
              <span style={{ fontSize: 13, fontWeight: selectedAgent?.id === agent.id ? 500 : 400, textAlign: 'left' }}>
                {agent.name}
              </span>
              <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                {agent.enabled_tools.slice(0, 2).map((t) => (
                  <span key={t} style={{
                    fontSize: 9, padding: '1px 4px', backgroundColor: C.bg,
                    color: C.dim, border: `1px solid ${C.border}`,
                  }}>{t.replace('_', ' ')}</span>
                ))}
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
            height: 52, display: 'flex', alignItems: 'center', gap: 0, paddingRight: 52,
            borderBottom: `1px solid ${C.border}`, backgroundColor: C.panel, padding: '0 16px', flexShrink: 0,
          }}>
            <span style={{ fontSize: 15, fontWeight: 600, marginRight: 20 }}>{selectedAgent.name}</span>
            {(['config', 'knowledge', 'chat'] as const).map((tab) => (
              <button key={tab} onClick={() => setRightTab(tab)} style={{
                padding: '8px 14px', fontSize: 12, border: 'none', cursor: 'pointer',
                backgroundColor: 'transparent',
                color: rightTab === tab ? C.text : C.dim,
                borderBottom: rightTab === tab ? `2px solid ${C.accent}` : '2px solid transparent',
                height: '100%',
              }}>
                {tab === 'config' ? (
                  <span style={{ display: 'flex', gap: 5, alignItems: 'center' }}><Wrench size={12} /> Configure</span>
                ) : tab === 'knowledge' ? (
                  <span style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
                    <Database size={12} /> Knowledge
                    {selectedAgent.knowledge_scope !== null && (
                      <span style={{
                        fontSize: 9, backgroundColor: C.accentDim, color: C.accent,
                        padding: '1px 5px', borderRadius: 8, marginLeft: 2,
                      }}>
                        {selectedAgent.knowledge_scope.length}
                      </span>
                    )}
                  </span>
                ) : (
                  <span style={{ display: 'flex', gap: 5, alignItems: 'center' }}><MessageCircle size={12} /> Chat</span>
                )}
              </button>
            ))}
          </div>

          {rightTab === 'config' ? (
            <AgentConfigPanel
              agent={selectedAgent}
              availableTools={availableTools}
              onSave={(data) => updateAgent(selectedAgent.id, data)}
              onDelete={() => deleteAgent(selectedAgent.id)}
            />
          ) : rightTab === 'knowledge' ? (
            <KnowledgePanel agent={selectedAgent} />
          ) : (
            <div style={{ flex: 1, overflow: 'hidden' }}>
              <ChatPanel agentId={selectedAgent.id} />
            </div>
          )}
        </div>
      ) : (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.dim, flexDirection: 'column', gap: 8 }}>
          <Bot size={32} color={C.border} />
          <div style={{ fontSize: 13 }}>Select or create an Agent</div>
        </div>
      )}

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
};

export default AgentStudio;
