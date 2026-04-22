import React, { useRef, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Play, Trash2, Loader2, FileCode, FileText, Code2 } from 'lucide-react';
import { C } from '../theme';
import type { Cell } from '../../../types/notebook';
import CellOutput from './CellOutput';

interface Props {
  cell: Cell;
  index: number;
  onRun: () => void;
  onDelete: () => void;
  onChange: (source: string) => void;
}

const KIND_LABEL: Record<Cell['kind'], { label: string; icon: React.ReactNode; color: string }> = {
  markdown: { label: 'MARKDOWN', icon: <FileText size={11} />, color: C.muted },
  python:   { label: 'PYTHON',   icon: <Code2 size={11} />,    color: C.accent },
  sql:      { label: 'SQL',      icon: <FileCode size={11} />, color: '#2563EB' },
};

export const NotebookCell: React.FC<Props> = ({ cell, index, onRun, onDelete, onChange }) => {
  const taRef = useRef<HTMLTextAreaElement>(null);
  const meta = KIND_LABEL[cell.kind];

  // Auto-size textarea
  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = `${Math.min(ta.scrollHeight, 600)}px`;
  }, [cell.source]);

  const canRun = cell.kind !== 'markdown';

  return (
    <div style={{
      display: 'flex', gap: 10, alignItems: 'flex-start',
      padding: '2px 0',
    }}>
      {/* Gutter: exec count + run button */}
      <div style={{
        width: 44, flexShrink: 0, paddingTop: 8, display: 'flex',
        flexDirection: 'column', alignItems: 'center', gap: 6,
      }}>
        {canRun && (
          <button
            title="Run cell (Shift+Enter)"
            onClick={onRun}
            disabled={cell.running}
            style={{
              width: 28, height: 28, borderRadius: '50%',
              border: `1px solid ${C.border}`, backgroundColor: C.panel,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              cursor: cell.running ? 'wait' : 'pointer', padding: 0,
              color: C.accent,
            }}
          >
            {cell.running
              ? <Loader2 size={13} style={{ animation: 'spin 0.8s linear infinite' }} />
              : <Play size={12} fill={C.accent} />}
          </button>
        )}
        <div style={{ fontSize: 9, color: C.subtle, fontFamily: 'ui-monospace, monospace' }}>
          {String(index + 1).padStart(2, '0')}
        </div>
      </div>

      {/* Cell body */}
      <div style={{
        flex: 1, minWidth: 0,
        border: `1px solid ${C.border}`, borderRadius: 6,
        backgroundColor: C.panel,
        overflow: 'hidden',
      }}>
        {/* Kind header + delete */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '4px 10px', fontSize: 9, fontWeight: 600, letterSpacing: '0.06em',
          color: meta.color, backgroundColor: '#FAFBFC', borderBottom: `1px solid ${C.border}`,
        }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            {meta.icon} {meta.label}
          </span>
          <span style={{ marginLeft: 'auto', color: C.subtle, fontWeight: 400 }}>
            {cell.source.split('\n').length} line{cell.source.split('\n').length === 1 ? '' : 's'}
          </span>
          <button
            onClick={onDelete}
            title="Delete cell"
            style={{
              border: 'none', background: 'transparent', color: C.subtle,
              cursor: 'pointer', padding: 2, display: 'flex',
            }}
          >
            <Trash2 size={12} />
          </button>
        </div>

        {/* Source editor */}
        {cell.kind === 'markdown' ? (
          <MarkdownEditor source={cell.source} onChange={onChange} />
        ) : (
          <textarea
            ref={taRef}
            value={cell.source}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.shiftKey && e.key === 'Enter') {
                e.preventDefault();
                onRun();
              }
            }}
            spellCheck={false}
            style={{
              width: '100%', border: 'none', outline: 'none',
              padding: '10px 12px', fontSize: 12.5, lineHeight: 1.55,
              fontFamily: 'ui-monospace, SFMono-Regular, "JetBrains Mono", Menlo, monospace',
              color: C.code, backgroundColor: C.panel,
              resize: 'vertical', minHeight: 40, boxSizing: 'border-box',
              tabSize: 4,
            }}
            placeholder={cell.kind === 'python' ? '# Python — df = nexus.query(...)\n' : '-- SQL'}
          />
        )}

        {/* Output */}
        {cell.kind !== 'markdown' && cell.output && (
          <div style={{
            borderTop: `1px solid ${C.border}`, padding: 10,
            backgroundColor: '#FCFDFE',
          }}>
            <CellOutput output={cell.output} />
          </div>
        )}
      </div>
    </div>
  );
};

const MarkdownEditor: React.FC<{ source: string; onChange: (s: string) => void }> = ({ source, onChange }) => {
  const [editing, setEditing] = React.useState(source.trim().length === 0);
  const taRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (editing && taRef.current) {
      const ta = taRef.current;
      ta.style.height = 'auto';
      ta.style.height = `${Math.min(ta.scrollHeight, 400)}px`;
    }
  }, [editing, source]);

  if (editing) {
    return (
      <textarea
        ref={taRef}
        value={source}
        autoFocus
        onChange={(e) => onChange(e.target.value)}
        onBlur={() => { if (source.trim()) setEditing(false); }}
        spellCheck={false}
        style={{
          width: '100%', border: 'none', outline: 'none',
          padding: '10px 12px', fontSize: 13, lineHeight: 1.55,
          color: C.text, backgroundColor: C.panel,
          resize: 'vertical', minHeight: 40, boxSizing: 'border-box',
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        }}
        placeholder="Markdown…"
      />
    );
  }

  return (
    <div
      onDoubleClick={() => setEditing(true)}
      style={{ padding: '10px 14px', fontSize: 13.5, lineHeight: 1.55, color: C.text, cursor: 'text' }}
    >
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{source || '*(empty)*'}</ReactMarkdown>
    </div>
  );
};

export default NotebookCell;
