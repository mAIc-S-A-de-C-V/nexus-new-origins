import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  FileText, Upload, Loader, CheckCircle, XCircle, Trash2, Download,
  ArrowUpToLine, RefreshCw, ChevronRight, ChevronLeft, Image as ImageIcon,
} from 'lucide-react';

import {
  createJob, deleteJob, downloadCsv, getJob, listJobProducts, listJobs,
  pushToOntology, PdfJob, PdfProduct,
} from '../../api/pdfExtractor';
import { useOntologyStore } from '../../store/ontologyStore';

// ── Design tokens (match UtilitiesPage palette) ────────────────────────────

const C = {
  bg:        '#F8FAFC',
  panel:     '#FFFFFF',
  card:      '#F8FAFC',
  border:    '#E2E8F0',
  text:      '#0D1117',
  muted:     '#64748B',
  dim:       '#94A3B8',
  accent:    '#7C3AED',
  accentDim: '#EDE9FE',
  success:   '#059669',
  error:     '#DC2626',
  warning:   '#D97706',
  codeBg:    '#F1F5F9',
  uiFont:    'system-ui, -apple-system, sans-serif' as const,
};

const STATUS_STYLES: Record<PdfJob['status'], { color: string; bg: string; label: string }> = {
  pending:   { color: '#475569', bg: '#F1F5F9', label: 'Pending' },
  running:   { color: C.accent, bg: C.accentDim, label: 'Running' },
  completed: { color: C.success, bg: '#D1FAE5', label: 'Completed' },
  failed:    { color: C.error,   bg: '#FEE2E2', label: 'Failed' },
};

const POLL_INTERVAL_MS = 1500;

// ── Helpers ────────────────────────────────────────────────────────────────

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleString(); } catch { return iso; }
}

function isInFlight(status: PdfJob['status']): boolean {
  return status === 'pending' || status === 'running';
}

function specRowText(specs: Record<string, string>): string {
  const entries = Object.entries(specs || {});
  if (!entries.length) return '';
  return entries.map(([k, v]) => `${k}: ${v}`).join(' • ');
}

// ── Upload card ───────────────────────────────────────────────────────────

const UploadCard: React.FC<{ onCreated: (job: PdfJob) => void }> = ({ onCreated }) => {
  const [file, setFile] = useState<File | null>(null);
  const [pageRange, setPageRange] = useState('');
  // 120 strikes a good balance: text and small spec tables remain legible
  // for the vision LLM, but the pixmap memory per page drops ~40% vs 150,
  // which is the difference between completing a 100+ MB catalog and the
  // worker being SIGKILL'd by the kernel mid-job.
  const [dpi, setDpi] = useState(120);
  const [model, setModel] = useState('claude-opus-4-7');
  const [schemaPrompt, setSchemaPrompt] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [busy, setBusy] = useState(false);
  const [uploadPct, setUploadPct] = useState<number>(0);
  const [err, setErr] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // If the component unmounts (modal closed) mid-upload, abort the request
  // so it doesn't keep eating uplink bandwidth in the background.
  useEffect(() => () => { abortRef.current?.abort(); }, []);

  const onPickFile = useCallback((files: FileList | null) => {
    const first = files?.[0];
    if (!first) return;
    if (!first.name.toLowerCase().endsWith('.pdf')) {
      setErr('Please choose a PDF file.');
      return;
    }
    setErr(null);
    setFile(first);
  }, []);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    onPickFile(e.dataTransfer.files);
  }, [onPickFile]);

  const submit = useCallback(async () => {
    if (!file) return;
    // Replace any in-flight upload's abort handle with a fresh one.
    abortRef.current?.abort();
    abortRef.current = new AbortController();
    setBusy(true);
    setUploadPct(0);
    setErr(null);
    try {
      const job = await createJob({
        file,
        model: model || undefined,
        dpi,
        pageRange: pageRange.trim() || undefined,
        schemaPrompt: schemaPrompt.trim() || undefined,
        onUploadProgress: (pct) => setUploadPct(pct),
        signal: abortRef.current.signal,
      });
      onCreated(job);
      setFile(null);
      setPageRange('');
      setSchemaPrompt('');
      setUploadPct(0);
      if (inputRef.current) inputRef.current.value = '';
    } catch (e: unknown) {
      const isAbort = (e as { code?: string; name?: string })?.code === 'ERR_CANCELED'
        || (e as { name?: string })?.name === 'CanceledError';
      const msg = isAbort
        ? 'Upload cancelled'
        : (e instanceof Error ? e.message : 'Upload failed');
      setErr(msg);
    } finally {
      setBusy(false);
    }
  }, [file, model, dpi, pageRange, schemaPrompt, onCreated]);

  const cancelUpload = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  return (
    <div style={{
      background: C.panel, border: `1px solid ${C.border}`, borderRadius: 8,
      padding: 16,
    }}>
      <div style={{ fontSize: 13, fontWeight: 600, color: C.text, marginBottom: 12 }}>
        New extraction
      </div>

      <div
        onDragOver={(e) => e.preventDefault()}
        onDrop={onDrop}
        onClick={() => inputRef.current?.click()}
        style={{
          border: `2px dashed ${file ? C.accent : C.border}`,
          borderRadius: 8,
          padding: '24px 16px',
          textAlign: 'center',
          cursor: 'pointer',
          background: file ? C.accentDim : C.card,
          transition: 'background 120ms, border-color 120ms',
        }}
      >
        <Upload size={20} color={file ? C.accent : C.muted} style={{ marginBottom: 6 }} />
        <div style={{ fontSize: 13, color: file ? C.accent : C.muted, fontWeight: 500 }}>
          {file ? file.name : 'Drop a PDF here or click to choose'}
        </div>
        {file && (
          <div style={{ fontSize: 11, color: C.muted, marginTop: 4 }}>
            {(file.size / 1024 / 1024).toFixed(2)} MB
          </div>
        )}
        <input
          ref={inputRef}
          type="file"
          accept="application/pdf,.pdf"
          style={{ display: 'none' }}
          onChange={(e) => onPickFile(e.target.files)}
        />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 12 }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ fontSize: 11, fontWeight: 600, color: C.muted, letterSpacing: 0.04 }}>
            Page range
          </span>
          <input
            type="text"
            placeholder="e.g. 13-20 (blank = all)"
            value={pageRange}
            onChange={(e) => setPageRange(e.target.value)}
            style={{
              padding: '8px 10px', fontSize: 13, border: `1px solid ${C.border}`,
              borderRadius: 6, background: C.panel, color: C.text,
              fontFamily: C.uiFont,
            }}
          />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ fontSize: 11, fontWeight: 600, color: C.muted, letterSpacing: 0.04 }}>
            DPI
          </span>
          <input
            type="number"
            min={72}
            max={400}
            value={dpi}
            onChange={(e) => setDpi(Number(e.target.value) || 150)}
            style={{
              padding: '8px 10px', fontSize: 13, border: `1px solid ${C.border}`,
              borderRadius: 6, background: C.panel, color: C.text,
              fontFamily: C.uiFont,
            }}
          />
        </label>
      </div>

      <button
        type="button"
        onClick={() => setShowAdvanced((v) => !v)}
        style={{
          marginTop: 10, fontSize: 11, color: C.muted, background: 'none',
          border: 'none', cursor: 'pointer', padding: 0, fontWeight: 600,
          letterSpacing: 0.04,
        }}
      >
        {showAdvanced ? '▾ Hide advanced' : '▸ Advanced (model, custom prompt)'}
      </button>
      {showAdvanced && (
        <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: 11, fontWeight: 600, color: C.muted, letterSpacing: 0.04 }}>
              Vision model
            </span>
            <input
              type="text"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              style={{
                padding: '8px 10px', fontSize: 13, border: `1px solid ${C.border}`,
                borderRadius: 6, background: C.panel, color: C.text,
                fontFamily: C.uiFont,
              }}
            />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: 11, fontWeight: 600, color: C.muted, letterSpacing: 0.04 }}>
              Custom schema prompt (blank = default product-catalog prompt)
            </span>
            <textarea
              rows={6}
              value={schemaPrompt}
              onChange={(e) => setSchemaPrompt(e.target.value)}
              placeholder="Leave blank to use the default product-catalog prompt."
              style={{
                padding: '8px 10px', fontSize: 12, border: `1px solid ${C.border}`,
                borderRadius: 6, background: C.panel, color: C.text,
                fontFamily: "'SF Mono', monospace", resize: 'vertical',
              }}
            />
          </label>
        </div>
      )}

      {err && (
        <div style={{
          marginTop: 10, padding: '8px 10px', fontSize: 12, color: C.error,
          background: '#FEE2E2', borderRadius: 6,
        }}>
          {err}
        </div>
      )}

      <button
        type="button"
        disabled={!file || busy}
        onClick={submit}
        style={{
          marginTop: 12, width: '100%', padding: '10px 14px', fontSize: 13,
          fontWeight: 600, color: '#fff',
          background: !file || busy ? C.dim : C.accent,
          border: 'none', borderRadius: 6,
          cursor: !file || busy ? 'not-allowed' : 'pointer',
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
        }}
      >
        {busy ? <Loader size={14} className="spin" /> : <Upload size={14} />}
        {busy
          ? (uploadPct >= 100 ? 'Processing…' : `Uploading… ${uploadPct}%`)
          : 'Start extraction'}
      </button>

      {busy && (
        <>
          <div style={{ marginTop: 8, height: 4, background: C.card, borderRadius: 2, overflow: 'hidden' }}>
            <div style={{
              width: `${uploadPct}%`, height: '100%', background: C.accent,
              transition: 'width 150ms',
            }} />
          </div>
          <button
            type="button"
            onClick={cancelUpload}
            style={{
              marginTop: 6, fontSize: 11, color: C.muted,
              background: 'none', border: 'none', cursor: 'pointer',
              padding: 0, alignSelf: 'flex-start',
            }}
          >
            Cancel upload
          </button>
        </>
      )}
    </div>
  );
};

// ── Jobs list ─────────────────────────────────────────────────────────────

const JobsList: React.FC<{
  jobs: PdfJob[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onRefresh: () => void;
  onDelete: (id: string) => void;
}> = ({ jobs, selectedId, onSelect, onRefresh, onDelete }) => (
  <div style={{
    background: C.panel, border: `1px solid ${C.border}`, borderRadius: 8,
    display: 'flex', flexDirection: 'column', minHeight: 0,
  }}>
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '12px 14px', borderBottom: `1px solid ${C.border}`,
    }}>
      <div style={{ fontSize: 13, fontWeight: 600, color: C.text }}>Jobs</div>
      <button
        type="button"
        onClick={onRefresh}
        title="Refresh"
        style={{
          background: 'none', border: 'none', cursor: 'pointer',
          color: C.muted, padding: 4,
        }}
      >
        <RefreshCw size={14} />
      </button>
    </div>
    <div style={{ overflowY: 'auto', flex: 1 }}>
      {jobs.length === 0 && (
        <div style={{ padding: 24, textAlign: 'center', color: C.dim, fontSize: 12 }}>
          No jobs yet. Upload a PDF to get started.
        </div>
      )}
      {jobs.map((j) => {
        const style = STATUS_STYLES[j.status];
        const selected = j.id === selectedId;
        return (
          <div
            key={j.id}
            onClick={() => onSelect(j.id)}
            style={{
              padding: '10px 14px',
              borderBottom: `1px solid ${C.border}`,
              cursor: 'pointer',
              background: selected ? C.accentDim : 'transparent',
              transition: 'background 120ms',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
              <div style={{
                display: 'flex', alignItems: 'center', gap: 6, minWidth: 0,
                fontSize: 12, fontWeight: 600, color: C.text,
              }}>
                <FileText size={13} color={C.muted} />
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {j.filename}
                </span>
              </div>
              <span style={{
                fontSize: 10, fontWeight: 700, letterSpacing: 0.04,
                color: style.color, background: style.bg,
                padding: '2px 8px', borderRadius: 999,
                whiteSpace: 'nowrap', textTransform: 'uppercase',
              }}>
                {style.label}
              </span>
            </div>
            <div style={{
              marginTop: 4, display: 'flex', justifyContent: 'space-between',
              fontSize: 11, color: C.muted,
            }}>
              <span>
                {j.total_pages != null
                  ? `${j.pages_done}/${j.total_pages} pages`
                  : `${j.pages_done} pages`}
                {' · '}
                {j.products_found} rows
              </span>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onDelete(j.id); }}
                title="Delete"
                style={{
                  background: 'none', border: 'none', cursor: 'pointer',
                  color: C.dim, padding: 0,
                }}
              >
                <Trash2 size={12} />
              </button>
            </div>
          </div>
        );
      })}
    </div>
  </div>
);

// ── Push to ontology modal ────────────────────────────────────────────────

const PushToOntologyModal: React.FC<{
  job: PdfJob;
  onClose: () => void;
  onPushed: (job: PdfJob) => void;
}> = ({ job, onClose, onPushed }) => {
  const { objectTypes, fetchObjectTypes } = useOntologyStore();
  const [selected, setSelected] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (objectTypes.length === 0) {
      fetchObjectTypes().catch((e: unknown) => {
        setErr(e instanceof Error ? e.message : 'Failed to load ontology objects');
      });
    }
  }, [fetchObjectTypes, objectTypes.length]);

  const submit = useCallback(async () => {
    if (!selected) return;
    setBusy(true);
    setErr(null);
    try {
      const updated = await pushToOntology(job.id, selected);
      onPushed(updated);
      onClose();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Push failed');
    } finally {
      setBusy(false);
    }
  }, [job.id, selected, onPushed, onClose]);

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.5)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      zIndex: 1000,
    }}>
      <div style={{
        background: C.panel, border: `1px solid ${C.border}`, borderRadius: 8,
        width: 520, maxWidth: '90vw', padding: 18,
        boxShadow: '0 10px 32px rgba(0,0,0,0.18)',
      }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: C.text, marginBottom: 12 }}>
          Push to ontology
        </div>
        <div style={{ fontSize: 12, color: C.muted, marginBottom: 14 }}>
          Pick an ontology object type. Each extracted product becomes one record;
          rows with the same SKU upsert.
        </div>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ fontSize: 11, fontWeight: 600, color: C.muted, letterSpacing: 0.04 }}>
            Target object type
          </span>
          <select
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
            style={{
              padding: '8px 10px', fontSize: 13, border: `1px solid ${C.border}`,
              borderRadius: 6, background: C.panel, color: C.text,
              fontFamily: C.uiFont,
            }}
          >
            <option value="">— choose —</option>
            {objectTypes.map((ot) => (
              <option key={ot.id} value={ot.id}>
                {ot.displayName || ot.name} ({ot.name})
              </option>
            ))}
          </select>
        </label>
        {err && (
          <div style={{
            marginTop: 10, padding: '8px 10px', fontSize: 12, color: C.error,
            background: '#FEE2E2', borderRadius: 6,
          }}>
            {err}
          </div>
        )}
        <div style={{ marginTop: 16, display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button
            type="button" onClick={onClose}
            style={{
              padding: '8px 14px', fontSize: 13, fontWeight: 600,
              color: C.text, background: C.card, border: `1px solid ${C.border}`,
              borderRadius: 6, cursor: 'pointer',
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!selected || busy}
            onClick={submit}
            style={{
              padding: '8px 14px', fontSize: 13, fontWeight: 600, color: '#fff',
              background: !selected || busy ? C.dim : C.accent,
              border: 'none', borderRadius: 6,
              cursor: !selected || busy ? 'not-allowed' : 'pointer',
            }}
          >
            {busy ? 'Pushing…' : 'Push'}
          </button>
        </div>
      </div>
    </div>
  );
};

// ── Job detail ────────────────────────────────────────────────────────────

const JobDetail: React.FC<{
  job: PdfJob;
  products: PdfProduct[];
  loadingProducts: boolean;
  onJobUpdated: (job: PdfJob) => void;
}> = ({ job, products, loadingProducts, onJobUpdated }) => {
  const [pushOpen, setPushOpen] = useState(false);
  const style = STATUS_STYLES[job.status];

  const progressPct = useMemo(() => {
    if (!job.total_pages || job.total_pages === 0) return 0;
    return Math.min(100, Math.round((job.pages_done / job.total_pages) * 100));
  }, [job.pages_done, job.total_pages]);

  return (
    <div style={{
      background: C.panel, border: `1px solid ${C.border}`, borderRadius: 8,
      display: 'flex', flexDirection: 'column', minHeight: 0, flex: 1,
    }}>
      {/* Header */}
      <div style={{
        padding: '12px 16px', borderBottom: `1px solid ${C.border}`,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
          <FileText size={16} color={C.muted} />
          <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
            <div style={{
              fontSize: 14, fontWeight: 700, color: C.text,
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              {job.filename}
            </div>
            <div style={{ fontSize: 11, color: C.muted }}>
              Created {formatDate(job.created_at)} · {job.model} · DPI {job.dpi}
              {job.page_range ? ` · pages ${job.page_range}` : ''}
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{
            fontSize: 10, fontWeight: 700, letterSpacing: 0.04,
            color: style.color, background: style.bg,
            padding: '2px 8px', borderRadius: 999, textTransform: 'uppercase',
          }}>
            {style.label}
          </span>
          {job.status === 'completed' && (
            <>
              <button
                type="button"
                onClick={() => downloadCsv(job.id, `${job.filename.replace(/\.pdf$/i, '')}.csv`)}
                style={{
                  padding: '6px 10px', fontSize: 12, fontWeight: 600, color: C.text,
                  background: C.card, border: `1px solid ${C.border}`,
                  borderRadius: 6, cursor: 'pointer',
                  display: 'inline-flex', alignItems: 'center', gap: 6,
                }}
              >
                <Download size={12} /> CSV
              </button>
              <button
                type="button"
                onClick={() => setPushOpen(true)}
                style={{
                  padding: '6px 10px', fontSize: 12, fontWeight: 600, color: '#fff',
                  background: C.accent, border: 'none',
                  borderRadius: 6, cursor: 'pointer',
                  display: 'inline-flex', alignItems: 'center', gap: 6,
                }}
              >
                <ArrowUpToLine size={12} /> Push to ontology
              </button>
            </>
          )}
        </div>
      </div>

      {/* Progress + error banner */}
      {(isInFlight(job.status) || job.status === 'failed') && (
        <div style={{ padding: '10px 16px', borderBottom: `1px solid ${C.border}` }}>
          {isInFlight(job.status) && (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: C.muted, marginBottom: 4 }}>
                <span>
                  {job.total_pages != null
                    ? `Page ${job.pages_done} of ${job.total_pages}`
                    : `Page ${job.pages_done} · counting…`}
                </span>
                <span>{job.products_found} rows so far</span>
              </div>
              <div style={{ height: 6, background: C.card, borderRadius: 3, overflow: 'hidden' }}>
                <div style={{
                  width: `${progressPct}%`, height: '100%', background: C.accent,
                  transition: 'width 240ms',
                }} />
              </div>
            </>
          )}
          {job.status === 'failed' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: C.error }}>
              <XCircle size={14} />
              <span>{job.error || 'Job failed'}</span>
            </div>
          )}
        </div>
      )}

      {job.pushed_to_object_type_id && (
        <div style={{
          padding: '8px 16px', borderBottom: `1px solid ${C.border}`,
          fontSize: 11, color: C.success,
          display: 'flex', alignItems: 'center', gap: 6,
        }}>
          <CheckCircle size={12} />
          Pushed to ontology object type
          <code style={{ background: C.codeBg, padding: '1px 6px', borderRadius: 4, fontSize: 11 }}>
            {job.pushed_to_object_type_id}
          </code>
          on {formatDate(job.pushed_at)}
        </div>
      )}

      {/* Results table */}
      <div style={{ flex: 1, overflow: 'auto' }}>
        {loadingProducts && products.length === 0 ? (
          <div style={{ padding: 24, textAlign: 'center', color: C.dim, fontSize: 12 }}>
            Loading rows…
          </div>
        ) : products.length === 0 ? (
          <div style={{ padding: 24, textAlign: 'center', color: C.dim, fontSize: 12 }}>
            {job.status === 'completed'
              ? 'No products extracted from this PDF.'
              : 'Rows will appear here as pages finish.'}
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ background: C.card, position: 'sticky', top: 0, zIndex: 1 }}>
                <th style={thStyle}>Img</th>
                <th style={thStyle}>Pg</th>
                <th style={thStyle}>Category</th>
                <th style={{ ...thStyle, minWidth: 220 }}>Name</th>
                <th style={thStyle}>SKU internal</th>
                <th style={thStyle}>SKU ref</th>
                <th style={{ ...thStyle, minWidth: 280 }}>Specs</th>
                <th style={thStyle}>Accessories</th>
              </tr>
            </thead>
            <tbody>
              {products.map((p) => (
                <tr key={p.id} style={{ borderBottom: `1px solid ${C.border}` }}>
                  <td style={tdStyle}>
                    {p.image_url ? (
                      <a href={p.image_url} target="_blank" rel="noopener noreferrer">
                        <img
                          src={p.image_url}
                          alt=""
                          style={{ width: 48, height: 48, objectFit: 'cover', borderRadius: 4, border: `1px solid ${C.border}` }}
                          loading="lazy"
                        />
                      </a>
                    ) : (
                      <div style={{
                        width: 48, height: 48, borderRadius: 4, border: `1px dashed ${C.border}`,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        color: C.dim,
                      }}>
                        <ImageIcon size={14} />
                      </div>
                    )}
                  </td>
                  <td style={tdStyle}>{p.page}</td>
                  <td style={{ ...tdStyle, color: C.muted }}>{p.category || ''}</td>
                  <td style={{ ...tdStyle, fontWeight: 600, color: C.text }}>{p.name || ''}</td>
                  <td style={{ ...tdStyle, fontFamily: "'SF Mono', monospace", fontSize: 11 }}>
                    {p.sku_internal || ''}
                  </td>
                  <td style={{ ...tdStyle, fontFamily: "'SF Mono', monospace", fontSize: 11 }}>
                    {p.sku_ref || ''}
                  </td>
                  <td style={{ ...tdStyle, color: C.muted, maxWidth: 360, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {specRowText(p.specifications)}
                  </td>
                  <td style={{ ...tdStyle, color: C.muted, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {(p.accessories || []).join(' • ')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {pushOpen && (
        <PushToOntologyModal
          job={job}
          onClose={() => setPushOpen(false)}
          onPushed={onJobUpdated}
        />
      )}
    </div>
  );
};

const thStyle: React.CSSProperties = {
  textAlign: 'left',
  padding: '8px 10px',
  fontSize: 10,
  fontWeight: 700,
  color: C.muted,
  letterSpacing: 0.04,
  textTransform: 'uppercase',
  borderBottom: `1px solid ${C.border}`,
};
const tdStyle: React.CSSProperties = {
  padding: '8px 10px',
  verticalAlign: 'top',
};

// ── Page ──────────────────────────────────────────────────────────────────

const PdfExtractorPage: React.FC = () => {
  const [jobs, setJobs] = useState<PdfJob[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [products, setProducts] = useState<PdfProduct[]>([]);
  const [loadingProducts, setLoadingProducts] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const pollRef = useRef<number | null>(null);

  const refresh = useCallback(async () => {
    try {
      const list = await listJobs();
      setJobs(list);
      setLoadError(null);
      if (list.length && !selectedId) {
        setSelectedId(list[0].id);
      }
    } catch (e: unknown) {
      setLoadError(e instanceof Error ? e.message : 'Failed to load jobs');
    }
  }, [selectedId]);

  // Initial load
  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selectedJob = useMemo(
    () => jobs.find((j) => j.id === selectedId) || null,
    [jobs, selectedId],
  );

  // Reload products when the selection changes or the selected job finishes.
  useEffect(() => {
    if (!selectedId) {
      setProducts([]);
      return;
    }
    let cancelled = false;
    (async () => {
      setLoadingProducts(true);
      try {
        const list = await listJobProducts(selectedId);
        if (!cancelled) setProducts(list);
      } catch {
        if (!cancelled) setProducts([]);
      } finally {
        if (!cancelled) setLoadingProducts(false);
      }
    })();
    return () => { cancelled = true; };
  }, [selectedId, selectedJob?.status, selectedJob?.products_found]);

  // Polling: keep the in-flight job's status fresh.
  useEffect(() => {
    const hasInFlight = jobs.some((j) => isInFlight(j.status));
    if (!hasInFlight) {
      if (pollRef.current) window.clearInterval(pollRef.current);
      pollRef.current = null;
      return;
    }
    if (pollRef.current) return;
    pollRef.current = window.setInterval(async () => {
      try {
        const list = await listJobs();
        setJobs(list);
        setLoadError(null); // clear any earlier transient error once polls succeed
        // If the currently selected job is in-flight, also refresh its detail
        // so progress_log / pages_done advance even when listJobs returns a
        // stale view from a different replica.
        if (selectedId) {
          const sel = list.find((j) => j.id === selectedId);
          if (sel && isInFlight(sel.status)) {
            try {
              const fresh = await getJob(selectedId);
              setJobs((prev) => prev.map((j) => (j.id === fresh.id ? fresh : j)));
            } catch { /* ignore transient errors */ }
          }
        }
      } catch { /* ignore */ }
    }, POLL_INTERVAL_MS);
    return () => {
      if (pollRef.current) window.clearInterval(pollRef.current);
      pollRef.current = null;
    };
  }, [jobs, selectedId]);

  const onCreated = useCallback((job: PdfJob) => {
    setJobs((prev) => [job, ...prev.filter((j) => j.id !== job.id)]);
    setSelectedId(job.id);
  }, []);

  const onDelete = useCallback(async (id: string) => {
    if (!window.confirm('Delete this job and its extracted rows?')) return;
    try {
      await deleteJob(id);
      setJobs((prev) => prev.filter((j) => j.id !== id));
      if (selectedId === id) setSelectedId(null);
    } catch (e: unknown) {
      window.alert(e instanceof Error ? e.message : 'Delete failed');
    }
  }, [selectedId]);

  const onJobUpdated = useCallback((job: PdfJob) => {
    setJobs((prev) => prev.map((j) => (j.id === job.id ? job : j)));
  }, []);

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', height: '100%',
      background: C.bg, fontFamily: C.uiFont,
    }}>
      {/* Header */}
      <div style={{
        height: 52, background: C.panel, borderBottom: `1px solid ${C.border}`,
        display: 'flex', alignItems: 'center', padding: '0 24px', gap: 10,
      }}>
        <FileText size={16} color={C.accent} />
        <h1 style={{ fontSize: 15, fontWeight: 600, color: C.text, margin: 0 }}>
          PDF Extractor
        </h1>
        <span style={{
          fontSize: 10, background: C.codeBg, color: C.muted,
          padding: '2px 8px', fontWeight: 600, letterSpacing: '0.06em',
        }}>
          STANDALONE
        </span>
      </div>

      {loadError && (
        <div style={{
          padding: '8px 24px', fontSize: 12, color: C.error,
          background: '#FEE2E2', borderBottom: `1px solid ${C.border}`,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
        }}>
          <span>{loadError}</span>
          <button
            type="button"
            onClick={() => setLoadError(null)}
            style={{
              background: 'none', border: 'none', color: C.error,
              cursor: 'pointer', fontSize: 14, padding: 0, lineHeight: 1,
            }}
            title="Dismiss"
          >
            ×
          </button>
        </div>
      )}

      <div style={{
        flex: 1, display: 'grid',
        gridTemplateColumns: sidebarOpen ? '320px 1fr' : '40px 1fr',
        gap: 16, padding: 16, minHeight: 0,
      }}>
        <div style={{
          display: 'flex', flexDirection: 'column', gap: 16, minHeight: 0,
        }}>
          {sidebarOpen ? (
            <>
              <UploadCard onCreated={onCreated} />
              <JobsList
                jobs={jobs}
                selectedId={selectedId}
                onSelect={setSelectedId}
                onRefresh={refresh}
                onDelete={onDelete}
              />
              <button
                type="button"
                onClick={() => setSidebarOpen(false)}
                style={{
                  alignSelf: 'flex-start', padding: 4, color: C.muted,
                  background: 'none', border: 'none', cursor: 'pointer',
                  display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11,
                }}
              >
                <ChevronLeft size={12} /> Collapse
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => setSidebarOpen(true)}
              style={{
                padding: 4, color: C.muted,
                background: 'none', border: 'none', cursor: 'pointer',
              }}
              title="Expand"
            >
              <ChevronRight size={14} />
            </button>
          )}
        </div>

        {selectedJob ? (
          <JobDetail
            job={selectedJob}
            products={products}
            loadingProducts={loadingProducts}
            onJobUpdated={onJobUpdated}
          />
        ) : (
          <div style={{
            background: C.panel, border: `1px solid ${C.border}`, borderRadius: 8,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: C.dim, fontSize: 13,
          }}>
            Select a job to see its extracted rows.
          </div>
        )}
      </div>

      <style>{`
        .spin { animation: pdfx-spin 0.7s linear infinite; }
        @keyframes pdfx-spin { to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
};

export default PdfExtractorPage;
