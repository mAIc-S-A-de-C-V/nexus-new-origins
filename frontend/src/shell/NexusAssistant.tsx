import React, { useState, useRef, useEffect } from 'react';
import {
  X, Plus, ArrowLeft, Send, Loader, Trash2, MessageSquare,
  Database, HelpCircle, GitBranch, Code, Network, AlertTriangle, BarChart2, Zap,
  Check, XCircle, Play, Layers,
  type LucideIcon,
} from 'lucide-react';
import { useAssistantStore, AssistantMessage } from '../store/assistantStore';
import { useNavigationStore } from '../store/navigationStore';
import { useOntologyStore } from '../store/ontologyStore';
import { getTenantId } from '../store/authStore';

const INFERENCE_URL  = import.meta.env.VITE_INFERENCE_SERVICE_URL  || 'http://localhost:8003';
const LOGIC_URL      = import.meta.env.VITE_LOGIC_SERVICE_URL      || 'http://localhost:8012';
const ONTOLOGY_URL   = import.meta.env.VITE_ONTOLOGY_SERVICE_URL   || 'http://localhost:8004';
const CONNECTOR_URL  = import.meta.env.VITE_CONNECTOR_SERVICE_URL  || 'http://localhost:8001';
const PIPELINE_URL   = import.meta.env.VITE_PIPELINE_SERVICE_URL   || 'http://localhost:8002';

function fetchWithTimeout(url: string, opts: RequestInit, ms = 5000): Promise<any> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return fetch(url, { ...opts, signal: controller.signal })
    .then(r => r.json())
    .finally(() => clearTimeout(timer));
}

async function fetchLiveContext(currentPage: string) {
  const tenantId = getTenantId();
  const h = { 'x-tenant-id': tenantId };
  const opt = { headers: h };

  const [fnsRes, otsRes, connRes, pipRes] = await Promise.allSettled([
    fetchWithTimeout(`${LOGIC_URL}/logic/functions`, opt),
    fetchWithTimeout(`${ONTOLOGY_URL}/object-types`, opt),
    fetchWithTimeout(`${CONNECTOR_URL}/connectors`,  opt),
    fetchWithTimeout(`${PIPELINE_URL}/pipelines`,    opt),
  ]);

  const functions: any[]    = fnsRes.status  === 'fulfilled' ? (fnsRes.value  || []) : [];
  const object_types: any[] = otsRes.status  === 'fulfilled' ? (otsRes.value  || []) : [];
  const rawConnectors: any[] = connRes.status === 'fulfilled' ? (connRes.value || []) : [];
  const pipelines: any[]    = pipRes.status  === 'fulfilled' ? (pipRes.value  || []) : [];

  const connectors = rawConnectors.map((c: any) => ({
    id: c.id,
    name: c.name,
    type: c.type,
    status: c.status,
    base_url: c.base_url,
    description: c.description,
    last_sync: c.last_sync,
    last_sync_row_count: c.last_sync_row_count,
    active_pipeline_count: c.active_pipeline_count,
    config: c.config ? {
      endpoint: c.config.endpoint,
      queryParams: c.config.queryParams,
    } : undefined,
    tags: c.tags,
  }));

  const functionsWithSchedules = await Promise.all(
    functions.map(async (fn: any) => {
      try {
        const s = await fetchWithTimeout(`${LOGIC_URL}/logic/functions/${fn.id}/schedules`, opt);
        return { ...fn, schedules: Array.isArray(s) ? s : [] };
      } catch { return { ...fn, schedules: [] }; }
    })
  );

  const objectTypesWithRecords = await Promise.all(
    object_types.slice(0, 8).map(async (ot: any) => {
      try {
        const r = await fetchWithTimeout(
          `${ONTOLOGY_URL}/object-types/${ot.id}/records?limit=25`,
          opt, 8000
        );
        return { ...ot, recent_records: (r.records || []).slice(0, 25), total_records: r.total || 0 };
      } catch { return ot; }
    })
  );

  return {
    current_page: currentPage,
    functions: functionsWithSchedules,
    object_types: objectTypesWithRecords,
    connectors,
    pipelines,
  };
}

// ── Action types ─────────────────────────────────────────────────────────────
interface NexusAction {
  type: 'create_pipeline' | 'create_logic' | 'run_pipeline';
  name: string;
  summary: string[];
  payload: Record<string, unknown>;
}

const ACTION_LABELS: Record<string, string> = {
  create_pipeline: 'Create Pipeline',
  create_logic: 'Create Logic Function',
  run_pipeline: 'Run Pipeline',
};

const ACTION_ICONS: Record<string, React.ReactNode> = {
  create_pipeline: <GitBranch size={14} />,
  create_logic: <Code size={14} />,
  run_pipeline: <Play size={14} />,
};

function ActionConfirmCard({
  action,
  onConfirm,
  onReject,
  status,
}: {
  action: NexusAction;
  onConfirm: () => void;
  onReject: () => void;
  status: 'pending' | 'executing' | 'done' | 'error' | 'rejected';
}) {
  const label = ACTION_LABELS[action.type] || action.type;
  const icon = ACTION_ICONS[action.type] || <Layers size={14} />;

  return (
    <div style={{
      border: '1px solid #BFDBFE',
      borderRadius: 8,
      backgroundColor: '#EFF6FF',
      padding: '12px 14px',
      margin: '8px 0',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <div style={{
          width: 28, height: 28, borderRadius: 6,
          backgroundColor: '#2563EB', color: '#fff',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>{icon}</div>
        <div>
          <div style={{ fontSize: 12, fontWeight: 600, color: '#1E293B' }}>{label}</div>
          <div style={{ fontSize: 11, color: '#64748B' }}>{action.name}</div>
        </div>
      </div>

      <div style={{ marginBottom: 10 }}>
        {action.summary.map((s, i) => (
          <div key={i} style={{ display: 'flex', gap: 6, marginBottom: 2, fontSize: 12, color: '#334155' }}>
            <span style={{ color: '#2563EB', flexShrink: 0 }}>•</span>
            <span>{s}</span>
          </div>
        ))}
      </div>

      {status === 'pending' && (
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={onConfirm}
            style={{
              display: 'flex', alignItems: 'center', gap: 5,
              padding: '6px 14px', fontSize: 12, fontWeight: 500,
              backgroundColor: '#2563EB', color: '#fff',
              border: 'none', borderRadius: 4, cursor: 'pointer',
            }}
          >
            <Check size={13} /> Confirm
          </button>
          <button
            onClick={onReject}
            style={{
              display: 'flex', alignItems: 'center', gap: 5,
              padding: '6px 14px', fontSize: 12, fontWeight: 500,
              backgroundColor: '#fff', color: '#64748B',
              border: '1px solid #E2E8F0', borderRadius: 4, cursor: 'pointer',
            }}
          >
            <XCircle size={13} /> Cancel
          </button>
        </div>
      )}
      {status === 'executing' && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#2563EB' }}>
          <Loader size={13} style={{ animation: 'spin 0.7s linear infinite' }} /> Executing…
        </div>
      )}
      {status === 'done' && (
        <div style={{ fontSize: 12, color: '#059669', fontWeight: 500 }}>
          <Check size={13} style={{ verticalAlign: 'middle', marginRight: 4 }} />
          Created successfully
        </div>
      )}
      {status === 'error' && (
        <div style={{ fontSize: 12, color: '#DC2626', fontWeight: 500 }}>
          Failed — check logs
        </div>
      )}
      {status === 'rejected' && (
        <div style={{ fontSize: 12, color: '#64748B' }}>Cancelled</div>
      )}
    </div>
  );
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
      const lang = line.slice(3).trim();
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith('```')) {
        codeLines.push(lines[i]);
        i++;
      }
      // Hide action blocks (any format) — parent renders them as ActionConfirmCard
      const codeText = codeLines.join('\n');
      let isAction = lang === 'nexus-action';
      if (!isAction) {
        try {
          const obj = JSON.parse(codeText);
          if (obj?.type && obj?.summary && ['create_pipeline', 'create_logic', 'run_pipeline'].includes(obj.type)) {
            isAction = true;
          }
        } catch {
          // Try to find action JSON even if there's extra whitespace/content
          if (codeText.includes('"create_pipeline"') || codeText.includes('"create_logic"') || codeText.includes('"run_pipeline"')) {
            const found = extractAction(codeText);
            if (found) isAction = true;
          }
        }
      }
      if (!isAction) {
        elements.push(
          <pre key={i} style={{
            backgroundColor: '#F1F5F9', border: '1px solid #E2E8F0',
            padding: '8px 10px', fontSize: 11, fontFamily: 'monospace',
            overflowX: 'auto', margin: '6px 0', whiteSpace: 'pre-wrap', wordBreak: 'break-all',
          }}>
            {codeLines.join('\n')}
          </pre>
        );
      }
    } else if (line === '') {
      if (i > 0 && lines[i - 1] !== '') elements.push(<div key={i} style={{ height: 6 }} />);
    } else if (line.trimStart().startsWith('{"type"') && (line.includes('"create_pipeline"') || line.includes('"create_logic"') || line.includes('"run_pipeline"'))) {
      // Bare action JSON line — skip rendering, handled by ActionConfirmCard
    } else {
      elements.push(<div key={i} style={{ marginBottom: 2 }}>{inlineFormat(line)}</div>);
    }
    i++;
  }
  return <>{elements}</>;
}

/** Extract a nexus-action JSON from a message, if present */
function extractAction(text: string): NexusAction | null {
  // Find the start of an action-shaped JSON anywhere in the text
  const needle = '"type"';
  const actionTypes = ['create_pipeline', 'create_logic', 'run_pipeline'];
  let searchFrom = 0;
  while (searchFrom < text.length) {
    const idx = text.indexOf(needle, searchFrom);
    if (idx === -1) break;
    // Walk backwards to find the opening {
    let braceStart = -1;
    for (let j = idx - 1; j >= 0; j--) {
      if (text[j] === '{') { braceStart = j; break; }
      if (text[j] !== ' ' && text[j] !== '"' && text[j] !== '\n' && text[j] !== '`') break;
    }
    if (braceStart === -1) { searchFrom = idx + 1; continue; }
    // Walk forward with bracket counting to find the matching }
    let depth = 0;
    let braceEnd = -1;
    let inString = false;
    let escaped = false;
    for (let j = braceStart; j < text.length; j++) {
      const ch = text[j];
      if (escaped) { escaped = false; continue; }
      if (ch === '\\' && inString) { escaped = true; continue; }
      if (ch === '"') { inString = !inString; continue; }
      if (inString) continue;
      if (ch === '{') depth++;
      if (ch === '}') { depth--; if (depth === 0) { braceEnd = j; break; } }
    }
    if (braceEnd === -1) { searchFrom = idx + 1; continue; }
    const candidate = text.slice(braceStart, braceEnd + 1);
    try {
      const obj = JSON.parse(candidate);
      if (obj?.type && obj?.summary && actionTypes.includes(obj.type)) {
        return obj as NexusAction;
      }
    } catch { /* not valid JSON */ }
    searchFrom = idx + 1;
  }
  return null;
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

// ── Action cards ──────────────────────────────────────────────────────────────
interface ActionDef {
  title: string;
  description: string;
  prefill: string;
  Icon: LucideIcon;
}

const ACTIONS: ActionDef[] = [
  { title: 'Create Pipeline',       Icon: GitBranch,     description: 'Describe a pipeline in plain English',       prefill: 'Create a pipeline that ' },
  { title: 'Create Logic Function', Icon: Code,          description: 'Describe business logic to generate',        prefill: 'Create a logic function that ' },
  { title: 'Explain Lineage',       Icon: Network,       description: 'Explain data flow for a record type',        prefill: 'Explain the lineage for ' },
  { title: 'Surface Anomalies',     Icon: AlertTriangle, description: 'Find data quality issues',                   prefill: 'Surface anomalies in ' },
  { title: 'Run Evaluation',        Icon: BarChart2,     description: "Evaluate a pipeline's accuracy",             prefill: 'Run an evaluation on ' },
];

interface ActionCardProps extends ActionDef {
  onSelect: (prefill: string) => void;
}

function ActionCard({ title, description, prefill, Icon, onSelect }: ActionCardProps) {
  return (
    <div
      onClick={() => onSelect(prefill)}
      style={{
        border: '1px solid #E2E8F0',
        borderRadius: 6,
        padding: '10px 12px',
        cursor: 'pointer',
        backgroundColor: '#F8FAFC',
        transition: 'all 80ms',
      }}
      onMouseEnter={e => {
        e.currentTarget.style.backgroundColor = '#EFF6FF';
        e.currentTarget.style.borderColor = '#93C5FD';
      }}
      onMouseLeave={e => {
        e.currentTarget.style.backgroundColor = '#F8FAFC';
        e.currentTarget.style.borderColor = '#E2E8F0';
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
        <Icon size={14} style={{ color: '#2563EB' }} />
        <span style={{ fontSize: 12, fontWeight: 600, color: '#1E293B' }}>{title}</span>
      </div>
      <p style={{ fontSize: 11, color: '#64748B', margin: 0 }}>{description}</p>
    </div>
  );
}

// ── Main panel ────────────────────────────────────────────────────────────────
const NexusAssistant: React.FC = () => {
  const { currentPage } = useNavigationStore();
  const {
    open, setOpen, activeId, conversations,
    newConversation, selectConversation, deleteConversation, addMessage,
    updateMessageContent, updateMessageStreaming, setMessageFeedback, setStreamingMessageId,
  } = useAssistantStore();
  const { objectTypes, fetchObjectTypes } = useOntologyStore();

  const [view, setView]     = useState<'list' | 'chat'>('list');
  const [input, setInput]   = useState('');
  const [loading, setLoading] = useState(false);
  const [chatMode, setChatMode] = useState<'help' | 'data' | 'actions'>('help');
  const [selectedObjectTypeId, setSelectedObjectTypeId] = useState<string>('');
  const [actionStatuses, setActionStatuses] = useState<Record<string, 'pending' | 'executing' | 'done' | 'error' | 'rejected'>>({});
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef  = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (open && chatMode === 'data' && objectTypes.length === 0) {
      fetchObjectTypes();
    }
  }, [open, chatMode]);

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

  const executeAction = async (msgId: string, action: NexusAction) => {
    setActionStatuses(s => ({ ...s, [msgId]: 'executing' }));
    const tenantId = getTenantId();
    const headers: Record<string, string> = { 'Content-Type': 'application/json', 'x-tenant-id': tenantId };

    try {
      let url = '';
      let body: Record<string, unknown> = {};

      if (action.type === 'create_pipeline') {
        url = `${INFERENCE_URL}/infer/create-pipeline`;
        body = action.payload;
      } else if (action.type === 'create_logic') {
        url = `${INFERENCE_URL}/infer/create-logic`;
        body = action.payload;
      } else if (action.type === 'run_pipeline') {
        const pid = action.payload.pipeline_id as string;
        url = `${PIPELINE_URL}/pipelines/${pid}/run`;
        body = {};
      }

      const resp = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
      if (!resp.ok) {
        const errText = await resp.text();
        throw new Error(`${resp.status}: ${errText.slice(0, 200)}`);
      }
      const data = await resp.json();

      // Check if the backend reports failure (created: false)
      if (data.created === false) {
        setActionStatuses(s => ({ ...s, [msgId]: 'error' }));
        if (activeId) {
          addMessage(activeId, {
            id: crypto.randomUUID(),
            role: 'assistant',
            content: `Failed to create **${action.name}**: ${data.message || 'Unknown error'}`,
            timestamp: new Date().toISOString(),
          });
        }
        return;
      }

      setActionStatuses(s => ({ ...s, [msgId]: 'done' }));

      // Add a result message
      if (activeId) {
        const resultText = action.type === 'run_pipeline'
          ? `Pipeline run started.`
          : `**${action.name}** created successfully.${data.pipeline_id ? ` ID: \`${data.pipeline_id}\`` : ''}${data.function_id ? ` ID: \`${data.function_id}\`` : ''}`;
        addMessage(activeId, {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: resultText,
          timestamp: new Date().toISOString(),
        });
      }
    } catch (err) {
      setActionStatuses(s => ({ ...s, [msgId]: 'error' }));
      if (activeId) {
        addMessage(activeId, {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: `Action failed: ${err instanceof Error ? err.message : 'Unknown error'}`,
          timestamp: new Date().toISOString(),
        });
      }
    }
  };

  const rejectAction = (msgId: string) => {
    setActionStatuses(s => ({ ...s, [msgId]: 'rejected' }));
    if (activeId) {
      addMessage(activeId, {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: 'Action cancelled. Let me know if you want to adjust the plan.',
        timestamp: new Date().toISOString(),
      });
    }
  };

  const send = async () => {
    const text = input.trim();
    if (!text || loading || !activeId) return;
    setInput('');

    const now = new Date().toISOString();
    const userMsg: AssistantMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: text,
      timestamp: now,
    };
    addMessage(activeId, userMsg);
    setLoading(true);

    const convo = conversations.find(c => c.id === activeId);
    const history = [...(convo?.messages ?? []), userMsg];

    try {
      if (chatMode === 'data' && selectedObjectTypeId) {
        const ot = objectTypes.find(o => o.id === selectedObjectTypeId);
        let records: unknown[] = [];
        try {
          const r = await fetch(
            `${ONTOLOGY_URL}/object-types/${selectedObjectTypeId}/records?limit=100`,
            { headers: { 'x-tenant-id': getTenantId() } },
          );
          if (r.ok) { const d = await r.json(); records = d.records || []; }
        } catch { /* ignore */ }

        const res = await fetch(`${INFERENCE_URL}/infer/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-tenant-id': getTenantId() },
          body: JSON.stringify({
            question: text,
            object_type_id: selectedObjectTypeId,
            object_type_name: ot?.displayName || ot?.name || selectedObjectTypeId,
            fields: (ot?.properties || []).map((p: { name: string }) => p.name),
            records: records.slice(0, 50),
          }),
        });
        const data = await res.json();
        addMessage(activeId, {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: data.answer || 'No response.',
          timestamp: new Date().toISOString(),
        });
      } else {
        // Streaming platform help mode
        const context = await fetchLiveContext(currentPage).catch(() => ({ current_page: currentPage }));
        const response = await fetch(`${INFERENCE_URL}/infer/stream-help`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-tenant-id': getTenantId() },
          body: JSON.stringify({ messages: history, context }),
        });

        const assistantMsgId = crypto.randomUUID();
        addMessage(activeId, {
          id: assistantMsgId,
          role: 'assistant',
          content: '',
          streaming: true,
          timestamp: new Date().toISOString(),
        });
        setStreamingMessageId(assistantMsgId);

        const reader = response.body!.getReader();
        const decoder = new TextDecoder();
        let accumulated = '';

        outer: while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = decoder.decode(value);
          const lines = chunk.split('\n');
          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const data = line.slice(6).trim();
              if (data === '[DONE]') break outer;
              try {
                const parsed = JSON.parse(data);
                if (parsed.text) {
                  accumulated += parsed.text;
                  updateMessageContent(assistantMsgId, accumulated);
                }
                if (parsed.error) {
                  updateMessageContent(assistantMsgId, `Error: ${parsed.error}`);
                }
              } catch { /* ignore malformed SSE lines */ }
            }
          }
        }

        setStreamingMessageId(null);
        updateMessageStreaming(assistantMsgId, false);
      }
    } catch {
      addMessage(activeId, {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: "Couldn't reach the inference service.",
        timestamp: new Date().toISOString(),
      });
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
      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes blink { 0%,100%{opacity:1} 50%{opacity:0} }
      `}</style>

      {/* Backdrop */}
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
            {/* Actions panel */}
            {chatMode === 'actions' ? (
              <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 8, overflowY: 'auto', flex: 1 }}>
                <p style={{ fontSize: 11, color: '#64748B', margin: '0 0 4px' }}>
                  Quick actions — click to start a conversation
                </p>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  {ACTIONS.map(action => (
                    <ActionCard
                      key={action.title}
                      {...action}
                      onSelect={(prefill) => {
                        setInput(prefill);
                        setChatMode('help');
                        setTimeout(() => inputRef.current?.focus(), 50);
                      }}
                    />
                  ))}
                </div>
              </div>
            ) : (
              <div style={{ flex: 1, overflowY: 'auto', padding: '16px 16px 8px', display: 'flex', flexDirection: 'column', gap: 14 }}>

                {activeConvo.messages.length === 0 && (
                  <div style={{ textAlign: 'center', color: C.dim, padding: '40px 0' }}>
                    <MessageSquare size={28} color={C.border} style={{ marginBottom: 10 }} />
                    <div style={{ fontSize: 13 }}>Start the conversation</div>
                    <div style={{ fontSize: 12, marginTop: 4 }}>I can see your functions, schedules, and object types in real time.</div>
                  </div>
                )}

                {activeConvo.messages.map((m) => (
                  <div key={m.id} style={{ display: 'flex', gap: 10, alignItems: 'flex-start',
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
                    <div style={{ maxWidth: '82%' }}>
                      <div style={{
                        backgroundColor: m.role === 'user' ? C.accentDim : C.sidebar,
                        border: `1px solid ${m.role === 'user' ? C.accent + '33' : C.border}`,
                        padding: '10px 13px', fontSize: 13, lineHeight: 1.55,
                        color: C.text,
                      }}>
                        {m.role === 'assistant'
                          ? <Markdown text={m.content} />
                          : <span style={{ whiteSpace: 'pre-wrap' }}>{m.content}</span>}
                        {m.streaming && (
                          <span style={{
                            display: 'inline-block', width: 8, height: 14,
                            backgroundColor: '#2563EB', marginLeft: 2,
                            animation: 'blink 1s step-end infinite',
                            verticalAlign: 'text-bottom',
                          }} />
                        )}
                        {(() => {
                          if (m.role !== 'assistant' || m.streaming) return null;
                          const action = extractAction(m.content);
                          if (!action) return null;
                          const status = actionStatuses[m.id] || 'pending';
                          return (
                            <ActionConfirmCard
                              action={action}
                              status={status}
                              onConfirm={() => executeAction(m.id, action)}
                              onReject={() => rejectAction(m.id)}
                            />
                          );
                        })()}
                      </div>
                      {m.role === 'assistant' && !m.streaming && (
                        <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
                          <button
                            onClick={() => setMessageFeedback(m.id, 'up')}
                            style={{
                              background: 'none', border: 'none', cursor: 'pointer', padding: '2px 4px',
                              fontSize: 12, opacity: m.feedback === 'up' ? 1 : 0.4,
                              color: m.feedback === 'up' ? '#16A34A' : '#64748B',
                            }}
                            title="Helpful"
                          >👍</button>
                          <button
                            onClick={() => setMessageFeedback(m.id, 'down')}
                            style={{
                              background: 'none', border: 'none', cursor: 'pointer', padding: '2px 4px',
                              fontSize: 12, opacity: m.feedback === 'down' ? 1 : 0.4,
                              color: m.feedback === 'down' ? '#DC2626' : '#64748B',
                            }}
                            title="Not helpful"
                          >👎</button>
                        </div>
                      )}
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
            )}

            {/* Input area (always shown in chat view) */}
            <div style={{ padding: '10px 16px 14px', borderTop: `1px solid ${C.border}`, flexShrink: 0 }}>
              {/* Mode toggle */}
              <div style={{ display: 'flex', gap: 4, marginBottom: 8 }}>
                <button
                  onClick={() => setChatMode('help')}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 5,
                    height: 26, padding: '0 10px', borderRadius: 4, fontSize: 11, fontWeight: 500,
                    border: `1px solid ${chatMode === 'help' ? C.accent : C.border}`,
                    backgroundColor: chatMode === 'help' ? C.accentDim : 'transparent',
                    color: chatMode === 'help' ? C.accent : C.muted, cursor: 'pointer',
                  }}
                >
                  <HelpCircle size={11} /> Platform Help
                </button>
                <button
                  onClick={() => { setChatMode('data'); if (objectTypes.length === 0) fetchObjectTypes(); }}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 5,
                    height: 26, padding: '0 10px', borderRadius: 4, fontSize: 11, fontWeight: 500,
                    border: `1px solid ${chatMode === 'data' ? C.accent : C.border}`,
                    backgroundColor: chatMode === 'data' ? C.accentDim : 'transparent',
                    color: chatMode === 'data' ? C.accent : C.muted, cursor: 'pointer',
                  }}
                >
                  <Database size={11} /> Analyze Data
                </button>
                <button
                  onClick={() => setChatMode('actions')}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 5,
                    height: 26, padding: '0 10px', borderRadius: 4, fontSize: 11, fontWeight: 500,
                    border: `1px solid ${chatMode === 'actions' ? C.accent : C.border}`,
                    backgroundColor: chatMode === 'actions' ? C.accentDim : 'transparent',
                    color: chatMode === 'actions' ? C.accent : C.muted, cursor: 'pointer',
                  }}
                >
                  <Zap size={11} /> Actions
                </button>
              </div>

              {/* Object type selector (data mode only) */}
              {chatMode === 'data' && (
                <select
                  value={selectedObjectTypeId}
                  onChange={e => setSelectedObjectTypeId(e.target.value)}
                  style={{
                    width: '100%', height: 30, marginBottom: 8, padding: '0 8px',
                    border: `1px solid ${C.border}`, borderRadius: 4,
                    fontSize: 12, color: selectedObjectTypeId ? C.text : C.dim,
                    backgroundColor: C.bg,
                  }}
                >
                  <option value="">Select object type to analyze…</option>
                  {objectTypes.map(ot => (
                    <option key={ot.id} value={ot.id}>{ot.displayName || ot.name}</option>
                  ))}
                </select>
              )}

              {chatMode !== 'actions' && (
                <>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
                    <textarea
                      ref={inputRef}
                      value={input}
                      onChange={(e) => setInput(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
                      placeholder={chatMode === 'data'
                        ? 'Ask a question about your data… (e.g. "How many records have status pending?")'
                        : 'Ask anything about your Nexus setup… (Enter to send)'}
                      rows={2}
                      style={{
                        flex: 1, resize: 'none', padding: '9px 12px', fontSize: 13,
                        backgroundColor: C.bg, border: `1px solid ${C.border}`,
                        color: C.text, outline: 'none', fontFamily: 'inherit', lineHeight: 1.5,
                      }}
                    />
                    <button
                      onClick={send}
                      disabled={loading || !input.trim() || (chatMode === 'data' && !selectedObjectTypeId)}
                      style={{
                        width: 38, height: 38, flexShrink: 0,
                        backgroundColor: (input.trim() && !loading && (chatMode !== 'data' || selectedObjectTypeId)) ? C.accent : C.sidebar,
                        color: (input.trim() && !loading && (chatMode !== 'data' || selectedObjectTypeId)) ? '#fff' : C.dim,
                        border: 'none', cursor: (input.trim() && !loading && (chatMode !== 'data' || selectedObjectTypeId)) ? 'pointer' : 'default',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        transition: 'background-color 0.15s',
                      }}
                    >
                      <Send size={15} />
                    </button>
                  </div>
                  <div style={{ fontSize: 10, color: C.dim, marginTop: 5 }}>
                    {chatMode === 'data'
                      ? 'Fetches up to 50 records and asks Claude to analyze them'
                      : 'Context-aware — sees your functions, schedules & ontology in real time'}
                  </div>
                </>
              )}
            </div>
          </>
        )}
      </div>
    </>
  );
};

export default NexusAssistant;
