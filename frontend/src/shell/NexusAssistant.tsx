import React, { useState, useRef, useEffect } from 'react';
import { X, Plus, ArrowLeft, Send, Loader, Trash2, MessageSquare } from 'lucide-react';
import { useAssistantStore, AssistantMessage } from '../store/assistantStore';
import { useNavigationStore } from '../store/navigationStore';

const INFERENCE_URL = import.meta.env.VITE_INFERENCE_SERVICE_URL || 'http://localhost:8003';
const LOGIC_URL     = import.meta.env.VITE_LOGIC_SERVICE_URL     || 'http://localhost:8012';
const ONTOLOGY_URL  = import.meta.env.VITE_ONTOLOGY_SERVICE_URL  || 'http://localhost:8004';

async function fetchLiveContext(currentPage: string) {
  const h = { 'x-tenant-id': 'tenant-001' };
  const [fnsRes, otsRes] = await Promise.allSettled([
    fetch(`${LOGIC_URL}/logic/functions`, { headers: h }).then(r => r.json()),
    fetch(`${ONTOLOGY_URL}/object-types`,  { headers: h }).then(r => r.json()),
  ]);
  const functions: any[]     = fnsRes.status === 'fulfilled' ? (fnsRes.value || []) : [];
  const object_types: any[]  = otsRes.status === 'fulfilled' ? (otsRes.value || []) : [];
  const functionsWithSchedules = await Promise.all(
    functions.map(async (fn: any) => {
      try {
        const s = await fetch(`${LOGIC_URL}/logic/functions/${fn.id}/schedules`, { headers: h }).then(r => r.json());
        return { ...fn, schedules: Array.isArray(s) ? s : [] };
      } catch { return { ...fn, schedules: [] }; }
    })
  );
  return { current_page: currentPage, functions: functionsWithSchedules, object_types };
}

// ── Markdown-lite renderer ────────────────────────────────────────────────────
function Markdown({ text }: { text: string }) {
  const lines = text.split('\n');
  const elements: React.ReactNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    if (line.startsWith('### ')) {
      elements.push(<div key={i} style={{ fontSize: 12, fontWeight: 700, color: '#0D1117', marginTop: 10, marginBottom: 2 }}>{line.slice(4)}</div>);
    } else if (line.startsWith('## ')) {
      elements.push(<div key={i} style={{ fontSize: 13, fontWeight: 700, color: '#0D1117', marginTop: 12, marginBottom: 3 }}>{line.slice(3)}</div>);
    } else if (line.startsWith('# ')) {
      elements.push(<div key={i} style={{ fontSize: 14, fontWeight: 700, color: '#0D1117', marginTop: 12, marginBottom: 4 }}>{line.slice(2)}</div>);
    } else if (line.startsWith('- ') || line.startsWith('* ')) {
      elements.push(
        <div key={i} style={{ display: 'flex', gap: 6, marginBottom: 2 }}>
          <span style={{ color: '#7C3AED', flexShrink: 0, marginTop: 1 }}>•</span>
          <span>{inlineFormat(line.slice(2))}</span>
        </div>
      );
    } else if (line.startsWith('```')) {
      const lang = line.slice(3);
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith('```')) {
        codeLines.push(lines[i]);
        i++;
      }
      elements.push(
        <pre key={i} style={{
          backgroundColor: '#F1F5F9', border: '1px solid #E2E8F0',
          padding: '8px 10px', fontSize: 11, fontFamily: 'monospace',
          overflowX: 'auto', margin: '6px 0', whiteSpace: 'pre-wrap', wordBreak: 'break-all',
        }}>
          {codeLines.join('\n')}
        </pre>
      );
    } else if (line === '') {
      if (i > 0 && lines[i - 1] !== '') elements.push(<div key={i} style={{ height: 6 }} />);
    } else {
      elements.push(<div key={i} style={{ marginBottom: 2 }}>{inlineFormat(line)}</div>);
    }
    i++;
  }
  return <>{elements}</>;
}

function inlineFormat(text: string): React.ReactNode {
  const parts = text.split(/(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*)/g);
  return parts.map((p, i) => {
    if (p.startsWith('`') && p.endsWith('`'))
      return <code key={i} style={{ backgroundColor: '#EDE9FE', color: '#7C3AED', padding: '1px 5px', borderRadius: 3, fontSize: 11 }}>{p.slice(1, -1)}</code>;
    if (p.startsWith('**') && p.endsWith('**'))
      return <strong key={i}>{p.slice(2, -2)}</strong>;
    if (p.startsWith('*') && p.endsWith('*'))
      return <em key={i}>{p.slice(1, -1)}</em>;
    return p;
  });
}

// ── Main panel ────────────────────────────────────────────────────────────────
const NexusAssistant: React.FC = () => {
  const { currentPage } = useNavigationStore();
  const {
    open, setOpen, activeId, conversations,
    newConversation, selectConversation, deleteConversation, addMessage,
  } = useAssistantStore();

  const [view, setView]     = useState<'list' | 'chat'>('list');
  const [input, setInput]   = useState('');
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef  = useRef<HTMLTextAreaElement>(null);

  const activeConvo = conversations.find(c => c.id === activeId) ?? null;

  useEffect(() => {
    if (activeId) setView('chat');
  }, [activeId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [activeConvo?.messages.length, loading]);

  useEffect(() => {
    if (view === 'chat' && open) setTimeout(() => inputRef.current?.focus(), 120);
  }, [view, open]);

  const openChat = (id: string) => { selectConversation(id); setView('chat'); };

  const startNew = () => { newConversation(); setView('chat'); };

  const send = async () => {
    const text = input.trim();
    if (!text || loading || !activeId) return;
    setInput('');

    const userMsg: AssistantMessage = { role: 'user', content: text };
    addMessage(activeId, userMsg);
    setLoading(true);

    const convo = conversations.find(c => c.id === activeId);
    const history = [...(convo?.messages ?? []), userMsg];

    try {
      const context = await fetchLiveContext(currentPage).catch(() => ({ current_page: currentPage }));
      const res = await fetch(`${INFERENCE_URL}/infer/help`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: history, context }),
      });
      const data = await res.json();
      addMessage(activeId, { role: 'assistant', content: data.answer || 'No response.' });
    } catch {
      addMessage(activeId, { role: 'assistant', content: "Couldn't reach the inference service." });
    } finally {
      setLoading(false);
    }
  };

  if (!open) return null;

  const C = {
    bg: '#F8FAFC', sidebar: '#F1F5F9', panel: '#FFFFFF',
    border: '#E2E8F0', accent: '#7C3AED', accentDim: '#EDE9FE',
    text: '#0D1117', muted: '#64748B', dim: '#94A3B8',
    dark: '#080E18', darkBorder: '#131C2E',
  };

  return (
    <>
      {/* Backdrop — clicking outside closes */}
      <div
        onClick={() => setOpen(false)}
        style={{ position: 'fixed', inset: 0, zIndex: 149, backgroundColor: 'rgba(0,0,0,0.15)' }}
      />

      {/* Panel */}
      <div style={{
        position: 'fixed', top: 0, right: 0, bottom: 0, width: 420,
        backgroundColor: C.panel, borderLeft: `1px solid ${C.border}`,
        boxShadow: '-4px 0 24px rgba(0,0,0,0.12)',
        display: 'flex', flexDirection: 'column',
        zIndex: 150, fontFamily: 'system-ui, sans-serif',
      }}>

        {/* Header */}
        <div style={{
          height: 52, display: 'flex', alignItems: 'center', gap: 10,
          padding: '0 16px', borderBottom: `1px solid ${C.border}`,
          backgroundColor: C.dark, flexShrink: 0,
        }}>
          {view === 'chat' && (
            <button onClick={() => setView('list')} style={{ background: 'none', border: 'none', color: '#64748B', cursor: 'pointer', padding: 4, lineHeight: 0 }}>
              <ArrowLeft size={16} />
            </button>
          )}
          <span style={{ color: '#F8FAFC', fontSize: 14, fontWeight: 600, flex: 1 }}>
            {view === 'chat' && activeConvo ? activeConvo.title : 'Nexus Assistant'}
          </span>
          <button
            onClick={startNew}
            style={{
              display: 'flex', alignItems: 'center', gap: 5,
              padding: '5px 10px', fontSize: 12, cursor: 'pointer',
              backgroundColor: C.accentDim, color: C.accent,
              border: `1px solid ${C.accent}44`,
            }}
          >
            <Plus size={12} /> New chat
          </button>
          <button onClick={() => setOpen(false)} style={{ background: 'none', border: 'none', color: '#475569', cursor: 'pointer', padding: 4, lineHeight: 0 }}>
            <X size={16} />
          </button>
        </div>

        {/* ── Conversation list ── */}
        {view === 'list' && (
          <div style={{ flex: 1, overflowY: 'auto' }}>
            {conversations.length === 0 ? (
              <div style={{ padding: 32, textAlign: 'center', color: C.dim }}>
                <MessageSquare size={32} color={C.border} style={{ marginBottom: 12 }} />
                <div style={{ fontSize: 13, marginBottom: 6 }}>No conversations yet</div>
                <div style={{ fontSize: 12, color: C.dim, marginBottom: 16 }}>Ask anything about your Nexus setup</div>
                <button onClick={startNew} style={{
                  padding: '8px 18px', backgroundColor: C.accentDim, color: C.accent,
                  border: `1px solid ${C.accent}`, cursor: 'pointer', fontSize: 13,
                  display: 'inline-flex', alignItems: 'center', gap: 6,
                }}>
                  <Plus size={13} /> Start a conversation
                </button>
              </div>
            ) : (
              <div style={{ padding: '6px 0' }}>
                {/* Quick suggestions */}
                <div style={{ padding: '10px 16px 6px', borderBottom: `1px solid ${C.border}` }}>
                  <div style={{ fontSize: 10, color: C.dim, fontWeight: 600, letterSpacing: '0.06em', marginBottom: 8 }}>QUICK START</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                    {[
                      'How do I use {now_minus_7d} in filters?',
                      'How do I set up a schedule?',
                      'How do I send batch emails from a function?',
                      'How do I reference a previous block output?',
                    ].map((s) => (
                      <button key={s} onClick={() => {
                        const id = newConversation();
                        setView('chat');
                        setTimeout(() => { setInput(s); }, 50);
                      }} style={{
                        fontSize: 11, padding: '4px 9px', cursor: 'pointer',
                        backgroundColor: C.sidebar, color: C.muted,
                        border: `1px solid ${C.border}`, borderRadius: 12,
                      }}>
                        {s}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Conversation list */}
                <div style={{ padding: '8px 0' }}>
                  <div style={{ padding: '4px 16px 6px', fontSize: 10, color: C.dim, fontWeight: 600, letterSpacing: '0.06em' }}>CONVERSATIONS</div>
                  {conversations.map((c) => (
                    <div
                      key={c.id}
                      onClick={() => openChat(c.id)}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 10,
                        padding: '10px 16px', cursor: 'pointer',
                        borderBottom: `1px solid ${C.border}`,
                        backgroundColor: activeId === c.id ? C.accentDim : 'transparent',
                      }}
                      onMouseEnter={(e) => { if (activeId !== c.id) (e.currentTarget as HTMLElement).style.backgroundColor = C.sidebar; }}
                      onMouseLeave={(e) => { if (activeId !== c.id) (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent'; }}
                    >
                      <MessageSquare size={14} color={activeId === c.id ? C.accent : C.dim} style={{ flexShrink: 0 }} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, color: C.text, fontWeight: activeId === c.id ? 500 : 400, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {c.title}
                        </div>
                        <div style={{ fontSize: 10, color: C.dim, marginTop: 1 }}>
                          {c.messages.length} message{c.messages.length !== 1 ? 's' : ''} · {new Date(c.updatedAt).toLocaleDateString()}
                        </div>
                      </div>
                      <button
                        onClick={(e) => { e.stopPropagation(); deleteConversation(c.id); }}
                        style={{ background: 'none', border: 'none', color: C.dim, cursor: 'pointer', padding: 4, lineHeight: 0, flexShrink: 0 }}
                        onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = '#DC2626'; }}
                        onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = C.dim; }}
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── Chat view ── */}
        {view === 'chat' && activeConvo && (
          <>
            <div style={{ flex: 1, overflowY: 'auto', padding: '16px 16px 8px', display: 'flex', flexDirection: 'column', gap: 14 }}>

              {activeConvo.messages.length === 0 && (
                <div style={{ textAlign: 'center', color: C.dim, padding: '40px 0' }}>
                  <MessageSquare size={28} color={C.border} style={{ marginBottom: 10 }} />
                  <div style={{ fontSize: 13 }}>Start the conversation</div>
                  <div style={{ fontSize: 12, marginTop: 4 }}>I can see your functions, schedules, and object types in real time.</div>
                </div>
              )}

              {activeConvo.messages.map((m, i) => (
                <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'flex-start',
                  flexDirection: m.role === 'user' ? 'row-reverse' : 'row' }}>
                  {/* Avatar */}
                  <div style={{
                    width: 28, height: 28, borderRadius: '50%', flexShrink: 0,
                    backgroundColor: m.role === 'user' ? C.accentDim : C.dark,
                    border: `1px solid ${m.role === 'user' ? C.accent + '44' : C.darkBorder}`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 10, fontWeight: 700,
                    color: m.role === 'user' ? C.accent : '#A78BFA',
                  }}>
                    {m.role === 'user' ? 'U' : 'N'}
                  </div>
                  <div style={{
                    maxWidth: '82%',
                    backgroundColor: m.role === 'user' ? C.accentDim : C.sidebar,
                    border: `1px solid ${m.role === 'user' ? C.accent + '33' : C.border}`,
                    padding: '10px 13px', fontSize: 13, lineHeight: 1.55,
                    color: C.text,
                  }}>
                    {m.role === 'assistant'
                      ? <Markdown text={m.content} />
                      : <span style={{ whiteSpace: 'pre-wrap' }}>{m.content}</span>}
                  </div>
                </div>
              ))}

              {loading && (
                <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                  <div style={{
                    width: 28, height: 28, borderRadius: '50%', backgroundColor: C.dark,
                    border: `1px solid ${C.darkBorder}`, display: 'flex', alignItems: 'center',
                    justifyContent: 'center', flexShrink: 0,
                  }}>
                    <span style={{ fontSize: 10, fontWeight: 700, color: '#A78BFA' }}>N</span>
                  </div>
                  <div style={{ backgroundColor: C.sidebar, border: `1px solid ${C.border}`, padding: '10px 14px' }}>
                    <Loader size={14} color={C.accent} style={{ animation: 'spin 0.7s linear infinite' }} />
                  </div>
                </div>
              )}

              <div ref={bottomRef} />
            </div>

            {/* Input */}
            <div style={{ padding: '10px 16px 14px', borderTop: `1px solid ${C.border}`, flexShrink: 0 }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
                <textarea
                  ref={inputRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
                  placeholder="Ask anything about your Nexus setup… (Enter to send)"
                  rows={2}
                  style={{
                    flex: 1, resize: 'none', padding: '9px 12px', fontSize: 13,
                    backgroundColor: C.bg, border: `1px solid ${C.border}`,
                    color: C.text, outline: 'none', fontFamily: 'inherit', lineHeight: 1.5,
                  }}
                />
                <button
                  onClick={send}
                  disabled={loading || !input.trim()}
                  style={{
                    width: 38, height: 38, flexShrink: 0,
                    backgroundColor: input.trim() && !loading ? C.accent : C.sidebar,
                    color: input.trim() && !loading ? '#fff' : C.dim,
                    border: 'none', cursor: input.trim() && !loading ? 'pointer' : 'default',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    transition: 'background-color 0.15s',
                  }}
                >
                  <Send size={15} />
                </button>
              </div>
              <div style={{ fontSize: 10, color: C.dim, marginTop: 5 }}>
                Context-aware — sees your functions, schedules & ontology in real time
              </div>
            </div>
          </>
        )}
      </div>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </>
  );
};

export default NexusAssistant;
