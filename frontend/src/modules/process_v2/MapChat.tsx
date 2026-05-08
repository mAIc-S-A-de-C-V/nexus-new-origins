// Side-panel chat for the Process Map. Builds a textual context blob from the
// current process state (transitions, top variants, stats, active filter) and
// posts to /infer/chat. Markdown answers render inline. Mirrors the v1 pattern
// from modules/process/OverviewTab.tsx but without the widget-extraction step.

import React, { useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  ProcessTransition, ProcessVariant, ProcessStats, Process,
} from './api';

const INFERENCE_API = import.meta.env.VITE_INFERENCE_SERVICE_URL || 'http://localhost:8003';

type ChatMsg = { role: 'user' | 'assistant'; text: string };

interface Props {
  process: Process;
  stats: ProcessStats | null;
  transitions: ProcessTransition[];
  variants: ProcessVariant[];
  totalCases: number;
  filter: string[];
  otName: (id: string | null | undefined) => string;
  onClose: () => void;
}

function buildContext(p: Props): string {
  const parts: string[] = [];
  parts.push(`Process: ${p.process.name}`);
  if (p.process.description) parts.push(`Description: ${p.process.description}`);
  if (p.process.case_key_attribute) parts.push(`Case key: ${p.process.case_key_attribute}`);
  parts.push(`Object types: ${p.process.included_object_type_ids.map(p.otName).filter(Boolean).join(', ') || '(none)'}`);

  if (p.stats) {
    parts.push(
      `Stats — total cases: ${p.stats.total_cases}, ` +
      `avg duration ${p.stats.avg_duration_days}d, ` +
      `${p.stats.variant_count} variants, ` +
      `rework rate ${(p.stats.rework_rate * 100).toFixed(1)}%, ` +
      `stuck cases ${p.stats.stuck_cases}.`
    );
  }

  if (p.filter.length) {
    parts.push(`Active activity filter (cases must include ALL): ${p.filter.join(', ')}.`);
  }

  if (p.variants.length) {
    parts.push(`Top 5 variants:`);
    for (const v of p.variants.slice(0, 5)) {
      parts.push(
        `  · #${v.rank} (${v.case_count} cases, ${v.frequency_pct}%, avg ${v.avg_duration_days}d): ` +
        v.steps.map((s) => `${p.otName(s.object_type_id)}::${s.activity}`).join(' → ')
      );
    }
  }

  if (p.transitions.length) {
    parts.push(`Top 10 transitions by frequency:`);
    const top = [...p.transitions].sort((a, b) => b.count - a.count).slice(0, 10);
    for (const t of top) {
      parts.push(
        `  · ${p.otName(t.from_object_type_id)}::${t.from_activity ?? 'START'} → ` +
        `${p.otName(t.to_object_type_id)}::${t.to_activity} ` +
        `(${t.count} cases, avg ${t.avg_hours.toFixed(1)}h, p95 ${t.p95_hours.toFixed(1)}h, ${t.speed})`
      );
    }
  }

  return parts.join('\n');
}

const SYSTEM_PROMPT = `You are a process mining analyst. Answer questions about the process data concisely and precisely.

RULES:
- NEVER use emojis.
- Use markdown: headers (##), bold (**text**), bullet lists, tables.
- Cite specific numbers from the context — variant counts, transition durations, percentages.
- If the user asks for a summary, give 3-5 bullets covering the dominant flow, biggest dwell, and any anomalies.
- If the user asks "what should I automate?", recommend transitions where avg_hours > 24 with high case_count.
- If the user asks something the data does not answer, say so plainly. Do not speculate.`;

export const MapChat: React.FC<Props> = (props) => {
  const { onClose } = props;
  const [msgs, setMsgs] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState('');
  const [thinking, setThinking] = useState(false);
  const endRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [msgs, thinking]);

  const send = async () => {
    const q = input.trim();
    if (!q || thinking) return;
    setInput('');
    setMsgs((m) => [...m, { role: 'user', text: q }]);
    setThinking(true);
    try {
      const ctx = buildContext(props);
      const res = await fetch(`${INFERENCE_API}/infer/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question: `${SYSTEM_PROMPT}\n\nProcess Data Context:\n${ctx}\n\nUser: ${q}`,
          object_type_name: props.process.name,
          fields: ['total_cases', 'variant_count', 'avg_duration_days', 'rework_rate'],
          records: props.stats ? [props.stats] : [],
        }),
      });
      const data = await res.json();
      setMsgs((m) => [...m, { role: 'assistant', text: data.answer || data.detail || 'No response.' }]);
    } catch {
      setMsgs((m) => [...m, { role: 'assistant', text: 'Could not reach AI service.' }]);
    } finally {
      setThinking(false);
    }
  };

  const suggestions = [
    'Summarize the dominant path',
    'What is the biggest bottleneck?',
    'Where would automation save the most time?',
    'Which variants look like rework?',
  ];

  return (
    <div style={{
      position: 'absolute', top: 0, right: 0, bottom: 0, width: 380,
      background: '#FFFFFF', borderLeft: '1px solid #E2E8F0',
      display: 'flex', flexDirection: 'column',
      boxShadow: '-6px 0 18px rgba(15,23,42,0.06)',
      zIndex: 10,
    }}>
      <div style={{
        padding: '10px 12px', borderBottom: '1px solid #E2E8F0',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#0D1117' }}>Ask about this process</div>
          <div style={{ fontSize: 10, color: '#94A3B8', marginTop: 1 }}>{props.process.name}</div>
        </div>
        <button onClick={onClose} style={{
          padding: '4px 10px', fontSize: 12, border: '1px solid #E2E8F0',
          background: '#F8FAFC', color: '#64748B', borderRadius: 4, cursor: 'pointer',
        }}>Close</button>
      </div>

      <div style={{ padding: '8px 12px', borderBottom: '1px solid #F1F5F9', display: 'flex', gap: 4, flexWrap: 'wrap' }}>
        {suggestions.map((s) => (
          <button key={s} onClick={() => setInput(s)} style={{
            padding: '3px 7px', borderRadius: 12, border: '1px solid #E2E8F0',
            background: '#F8FAFC', color: '#64748B', fontSize: 10, cursor: 'pointer', whiteSpace: 'nowrap',
          }}>{s}</button>
        ))}
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '12px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        {msgs.length === 0 && (
          <div style={{ color: '#94A3B8', fontSize: 11, textAlign: 'center', marginTop: 24, lineHeight: 1.6 }}>
            Ask anything about the map — variants, dwell times, bottlenecks,
            <br />or "what should I automate?".
          </div>
        )}
        {msgs.map((m, i) => (
          <div key={i} style={{ alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start', maxWidth: '95%' }}>
            {m.role === 'user' ? (
              <div style={{
                padding: '7px 11px', borderRadius: '12px 12px 2px 12px',
                background: '#1E3A5F', color: '#fff', fontSize: 12, lineHeight: 1.5,
              }}>{m.text}</div>
            ) : (
              <div style={{
                padding: '9px 12px', borderRadius: '12px 12px 12px 2px',
                background: '#F8FAFC', border: '1px solid #E2E8F0', color: '#0D1117',
                fontSize: 12, lineHeight: 1.5,
              }}>
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{m.text}</ReactMarkdown>
              </div>
            )}
          </div>
        ))}
        {thinking && (
          <div style={{
            padding: '9px 12px', borderRadius: '12px 12px 12px 2px',
            background: '#F8FAFC', border: '1px solid #E2E8F0',
            color: '#94A3B8', fontSize: 12, alignSelf: 'flex-start',
          }}>Analyzing…</div>
        )}
        <div ref={endRef} />
      </div>

      <div style={{ padding: '10px 12px', borderTop: '1px solid #E2E8F0', display: 'flex', gap: 6 }}>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') send(); }}
          placeholder="Ask about the process…"
          style={{
            flex: 1, height: 32, padding: '0 10px', borderRadius: 6,
            border: '1px solid #E2E8F0', fontSize: 12, outline: 'none', background: '#F8FAFC',
          }}
        />
        <button
          onClick={send}
          disabled={!input.trim() || thinking}
          style={{
            height: 32, padding: '0 12px', borderRadius: 6, border: 'none',
            background: input.trim() ? '#1E3A5F' : '#F1F5F9',
            color: input.trim() ? '#fff' : '#94A3B8',
            fontSize: 12, fontWeight: 600, cursor: 'pointer',
          }}
        >Send</button>
      </div>
    </div>
  );
};

export default MapChat;
