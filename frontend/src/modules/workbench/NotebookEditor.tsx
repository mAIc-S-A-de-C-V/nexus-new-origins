import React, { useEffect, useMemo } from 'react';
import { ArrowLeft, BookOpen, FileText, Code2 } from 'lucide-react';
import { C } from './theme';
import { useWorkbenchStore } from '../../store/workbenchStore';
import ChatBar from './ChatBar';
import NotebookCell from './cells/NotebookCell';

function uid(): string {
  return (globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2) + Date.now().toString(36));
}

interface Props {
  onBack: () => void;
}

export const NotebookEditor: React.FC<Props> = ({ onBack }) => {
  const {
    notebooks, currentNotebookId, generating,
    updateCell, runCell, removeCell, appendCells,
    generateFromPrompt, ensureKernel, saveNotebook, renameNotebook, closeNotebook,
  } = useWorkbenchStore();

  const nb = useMemo(
    () => notebooks.find((n) => n.id === currentNotebookId),
    [notebooks, currentNotebookId],
  );

  // Spin up the kernel eagerly so the first prompt doesn't eat the latency.
  useEffect(() => {
    if (currentNotebookId) {
      void ensureKernel();
    }
    return () => { void closeNotebook(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentNotebookId]);

  if (!nb) {
    return (
      <div style={{ padding: 24, color: C.muted }}>No notebook selected.</div>
    );
  }

  const addCell = (kind: 'markdown' | 'python') => {
    appendCells([{ id: uid(), kind, source: '' }]);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', backgroundColor: C.bg }}>
      {/* Header */}
      <div style={{
        height: 52, backgroundColor: C.panel, borderBottom: `1px solid ${C.border}`,
        display: 'flex', alignItems: 'center', padding: '0 16px', gap: 10, flexShrink: 0,
      }}>
        <button
          onClick={onBack}
          style={{
            border: `1px solid ${C.border}`, backgroundColor: C.panel, padding: '6px 10px',
            borderRadius: 6, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6,
            color: C.muted, fontSize: 12,
          }}
        >
          <ArrowLeft size={13} /> Notebooks
        </button>

        <BookOpen size={16} color={C.accent} />
        <input
          value={nb.name}
          onChange={(e) => {
            // optimistic rename
            useWorkbenchStore.setState((s) => ({
              notebooks: s.notebooks.map((n) => (n.id === nb.id ? { ...n, name: e.target.value } : n)),
            }));
          }}
          onBlur={() => void renameNotebook(nb.name)}
          style={{
            flex: 1, border: 'none', outline: 'none', fontSize: 15, fontWeight: 600,
            color: C.text, backgroundColor: 'transparent',
          }}
        />

        <button
          onClick={() => void saveNotebook()}
          style={{
            fontSize: 11, color: C.muted, backgroundColor: 'transparent',
            border: `1px solid ${C.border}`, padding: '5px 10px', borderRadius: 6, cursor: 'pointer',
          }}
        >
          Save
        </button>
      </div>

      {/* Cells list (scroll) */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px 120px' }}>
        <div style={{ maxWidth: 960, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 10 }}>
          {nb.cells.length === 0 && !generating && (
            <div style={{
              border: `1px dashed ${C.border}`, borderRadius: 10,
              padding: '28px 20px', textAlign: 'center', color: C.muted,
              backgroundColor: C.panel,
            }}>
              <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 4, color: C.text }}>
                Blank notebook
              </div>
              <div style={{ fontSize: 12 }}>
                Ask a question below — the agent will generate cells, execute them, and render the results.
              </div>
            </div>
          )}

          {nb.cells.map((cell, i) => (
            <NotebookCell
              key={cell.id}
              cell={cell}
              index={i}
              onRun={() => { void runCell(cell.id); }}
              onDelete={() => removeCell(cell.id)}
              onChange={(source) => updateCell(cell.id, { source })}
            />
          ))}

          {generating && (
            <div style={{ padding: 16, color: C.muted, fontSize: 12, display: 'flex', gap: 8, alignItems: 'center' }}>
              <span className="wb-pulse" style={{
                width: 8, height: 8, borderRadius: '50%', backgroundColor: C.accent,
                animation: 'wbPulse 1s ease-in-out infinite',
              }} />
              Generating cells…
            </div>
          )}

          {/* Manual add row */}
          <div style={{ display: 'flex', gap: 8, paddingTop: 4 }}>
            <button
              onClick={() => addCell('markdown')}
              style={{
                fontSize: 11, color: C.muted, backgroundColor: C.panel,
                border: `1px solid ${C.border}`, padding: '5px 10px', borderRadius: 6,
                display: 'inline-flex', alignItems: 'center', gap: 5, cursor: 'pointer',
              }}
            >
              <FileText size={11} /> + Markdown
            </button>
            <button
              onClick={() => addCell('python')}
              style={{
                fontSize: 11, color: C.muted, backgroundColor: C.panel,
                border: `1px solid ${C.border}`, padding: '5px 10px', borderRadius: 6,
                display: 'inline-flex', alignItems: 'center', gap: 5, cursor: 'pointer',
              }}
            >
              <Code2 size={11} /> + Python
            </button>
          </div>
        </div>
      </div>

      {/* Chat bar (sticky at bottom) */}
      <div style={{
        position: 'sticky', bottom: 0, left: 0, right: 0,
        padding: '12px 20px 16px', backgroundColor: C.bg,
        borderTop: `1px solid ${C.border}`, flexShrink: 0,
      }}>
        <div style={{ maxWidth: 960, margin: '0 auto' }}>
          <ChatBar
            busy={generating}
            onSend={(p) => generateFromPrompt(p)}
          />
        </div>
      </div>

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes wbPulse { 0%, 100% { opacity: 0.35; } 50% { opacity: 1; } }
        .workbench-html-output table { border-collapse: collapse; }
        .workbench-html-output th, .workbench-html-output td {
          border: 1px solid #E2E8F0; padding: 4px 8px; text-align: left; font-size: 11px;
        }
        .workbench-html-output th { background-color: #F8FAFC; font-weight: 600; }
      `}</style>
    </div>
  );
};

export default NotebookEditor;
