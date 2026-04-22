import React, { useEffect, useState } from 'react';
import { BookOpen, Plus, Trash2, Sparkles } from 'lucide-react';
import { C } from './theme';
import { useWorkbenchStore } from '../../store/workbenchStore';
import NotebookEditor from './NotebookEditor';

export const WorkbenchPage: React.FC = () => {
  const { notebooks, currentNotebookId, loading, fetchNotebooks, createNotebook, deleteNotebook, openNotebook } = useWorkbenchStore();
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    void fetchNotebooks();
  }, [fetchNotebooks]);

  if (currentNotebookId) {
    return <NotebookEditor onBack={() => useWorkbenchStore.setState({ currentNotebookId: null })} />;
  }

  const handleCreate = async () => {
    setCreating(true);
    try {
      const nb = await createNotebook('Untitled Notebook');
      await openNotebook(nb.id);
    } finally {
      setCreating(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', backgroundColor: C.bg }}>
      {/* Header */}
      <div style={{
        height: 52, backgroundColor: C.panel, borderBottom: `1px solid ${C.border}`,
        display: 'flex', alignItems: 'center', padding: '0 20px', gap: 10, flexShrink: 0,
      }}>
        <BookOpen size={16} color={C.accent} />
        <h1 style={{ fontSize: 15, fontWeight: 600, color: C.text, margin: 0 }}>Workbench</h1>
        <span style={{ fontSize: 11, color: C.muted, marginLeft: 6 }}>
          Jupyter-style notebooks powered by Claude
        </span>
        <button
          onClick={() => void handleCreate()}
          disabled={creating}
          style={{
            marginLeft: 'auto', backgroundColor: C.accent, color: '#FFF', border: 'none',
            padding: '7px 12px', borderRadius: 6, fontSize: 12, fontWeight: 500,
            cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6,
          }}
        >
          <Plus size={13} /> New Notebook
        </button>
      </div>

      {/* Body */}
      <div style={{ flex: 1, overflowY: 'auto', padding: 24 }}>
        <div style={{ maxWidth: 1100, margin: '0 auto' }}>
          {loading && notebooks.length === 0 ? (
            <div style={{ color: C.muted, fontSize: 12 }}>Loading notebooks…</div>
          ) : notebooks.length === 0 ? (
            <EmptyState onCreate={handleCreate} />
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 14 }}>
              {notebooks.map((nb) => (
                <div
                  key={nb.id}
                  onClick={() => void openNotebook(nb.id)}
                  style={{
                    border: `1px solid ${C.border}`, borderRadius: 10, padding: 16,
                    backgroundColor: C.panel, cursor: 'pointer',
                    display: 'flex', flexDirection: 'column', gap: 8,
                    transition: 'box-shadow 100ms, transform 100ms',
                  }}
                  onMouseEnter={(e) => {
                    (e.currentTarget as HTMLElement).style.boxShadow = '0 4px 12px rgba(15,23,42,0.08)';
                  }}
                  onMouseLeave={(e) => {
                    (e.currentTarget as HTMLElement).style.boxShadow = 'none';
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <BookOpen size={14} color={C.accent} />
                    <div style={{ fontSize: 13.5, fontWeight: 600, color: C.text, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {nb.name}
                    </div>
                    <button
                      onClick={(e) => { e.stopPropagation(); void deleteNotebook(nb.id); }}
                      title="Delete notebook"
                      style={{
                        border: 'none', background: 'transparent', color: C.subtle,
                        cursor: 'pointer', padding: 2, display: 'flex',
                      }}
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                  <div style={{ fontSize: 11, color: C.muted, minHeight: 16 }}>
                    {nb.description || `${nb.cells.length} cell${nb.cells.length === 1 ? '' : 's'}`}
                  </div>
                  <div style={{ fontSize: 10, color: C.subtle, marginTop: 'auto' }}>
                    Updated {new Date(nb.updatedAt).toLocaleString()}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

const EmptyState: React.FC<{ onCreate: () => void }> = ({ onCreate }) => (
  <div style={{
    border: `1px dashed ${C.border}`, borderRadius: 12, padding: '48px 24px',
    textAlign: 'center', backgroundColor: C.panel,
  }}>
    <div style={{
      width: 48, height: 48, borderRadius: '50%', backgroundColor: C.accentLight,
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      color: C.accent, marginBottom: 14,
    }}>
      <Sparkles size={22} />
    </div>
    <div style={{ fontSize: 16, fontWeight: 600, color: C.text, marginBottom: 6 }}>
      Your first Workbench
    </div>
    <div style={{ fontSize: 12.5, color: C.muted, maxWidth: 480, margin: '0 auto 16px' }}>
      Ask questions in plain English. The agent generates SQL, Python, and charts inline — Jupyter-style.
    </div>
    <button
      onClick={onCreate}
      style={{
        backgroundColor: C.accent, color: '#FFF', border: 'none',
        padding: '9px 16px', borderRadius: 8, fontSize: 13, fontWeight: 500,
        cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6,
      }}
    >
      <Plus size={14} /> New Notebook
    </button>
  </div>
);

export default WorkbenchPage;
