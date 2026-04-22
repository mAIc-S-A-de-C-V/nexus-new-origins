import React, { useRef, useEffect, useState } from 'react';
import { Send, Sparkles, Loader2 } from 'lucide-react';
import { C } from './theme';

interface Props {
  onSend: (prompt: string) => void | Promise<void>;
  busy: boolean;
}

const SUGGESTIONS = [
  'Summarize what object types we have and how many records each holds',
  'Show a scatter plot of two numeric fields from a relevant object type',
  'Find the top 10 records by count, grouped by a categorical field',
  'Surface anomalies in the most recent records',
];

export const ChatBar: React.FC<Props> = ({ onSend, busy }) => {
  const [value, setValue] = useState('');
  const taRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = `${Math.min(ta.scrollHeight, 180)}px`;
  }, [value]);

  const submit = async () => {
    const v = value.trim();
    if (!v || busy) return;
    setValue('');
    await onSend(v);
  };

  return (
    <div style={{
      border: `1px solid ${C.border}`, borderRadius: 10,
      backgroundColor: C.panel, padding: 10, boxShadow: '0 1px 2px rgba(15,23,42,0.03)',
      display: 'flex', flexDirection: 'column', gap: 8,
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
        <div style={{
          width: 28, height: 28, borderRadius: '50%', flexShrink: 0,
          backgroundColor: C.accentLight, color: C.accent,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <Sparkles size={14} />
        </div>
        <textarea
          ref={taRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey || !e.shiftKey)) {
              if (!e.shiftKey) {
                e.preventDefault();
                void submit();
              }
            }
          }}
          disabled={busy}
          placeholder="Ask anything — e.g. 'show contracts by stage as a bar chart'"
          spellCheck={false}
          style={{
            flex: 1, border: 'none', outline: 'none', resize: 'none',
            fontSize: 13.5, lineHeight: 1.5, padding: '6px 0',
            fontFamily: 'inherit', color: C.text, backgroundColor: 'transparent',
            minHeight: 30,
          }}
        />
        <button
          onClick={() => void submit()}
          disabled={busy || !value.trim()}
          style={{
            width: 32, height: 32, borderRadius: 8,
            border: 'none', flexShrink: 0,
            backgroundColor: value.trim() && !busy ? C.accent : '#E2E8F0',
            color: '#FFF', display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: value.trim() && !busy ? 'pointer' : 'not-allowed',
          }}
        >
          {busy ? <Loader2 size={14} style={{ animation: 'spin 0.8s linear infinite' }} /> : <Send size={14} />}
        </button>
      </div>

      {value.trim() === '' && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {SUGGESTIONS.map((s) => (
            <button
              key={s}
              onClick={() => setValue(s)}
              style={{
                fontSize: 11, color: C.muted, backgroundColor: C.hover,
                padding: '4px 8px', borderRadius: 12, border: `1px solid ${C.border}`,
                cursor: 'pointer',
              }}
            >
              {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

export default ChatBar;
