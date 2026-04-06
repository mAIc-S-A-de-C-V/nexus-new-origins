import React, { useEffect, useState, useCallback } from 'react';
import {
  Globe, Send, ScanText, FileText, Table, Globe2, Rss,
  MapPin, QrCode, MessageSquare, Play, ChevronDown, ChevronRight,
  Search, Loader, CheckCircle, XCircle, Wrench, Terminal,
} from 'lucide-react';
import { useUtilityStore, UtilityDefinition } from '../../store/utilityStore';

// ── Design tokens ─────────────────────────────────────────────────────────────

const C = {
  bg:          '#F8FAFC',
  panel:       '#FFFFFF',
  card:        '#F8FAFC',
  border:      '#E2E8F0',
  text:        '#0D1117',
  muted:       '#64748B',
  dim:         '#94A3B8',
  accent:      '#7C3AED',
  accentDim:   '#EDE9FE',
  success:     '#059669',
  error:       '#DC2626',
  warning:     '#D97706',
  codeBg:      '#F1F5F9',
  codeFont:    "'SF Mono', 'Fira Code', monospace" as const,
  uiFont:      'system-ui, -apple-system, sans-serif' as const,
};

// ── Icon map ──────────────────────────────────────────────────────────────────

const ICON_MAP: Record<string, React.ReactNode> = {
  Globe:         <Globe size={15} />,
  Send:          <Send size={15} />,
  ScanText:      <ScanText size={15} />,
  FileText:      <FileText size={15} />,
  Table:         <Table size={15} />,
  Globe2:        <Globe2 size={15} />,
  Rss:           <Rss size={15} />,
  MapPin:        <MapPin size={15} />,
  QrCode:        <QrCode size={15} />,
  MessageSquare: <MessageSquare size={15} />,
};

const CATEGORY_ORDER = ['Document', 'Web', 'Vision', 'Geo', 'Notify'];

// ── Syntax-highlighted JSON renderer ─────────────────────────────────────────

function colorizeJson(json: string): React.ReactNode[] {
  const tokens: React.ReactNode[] = [];

  const lines = json.split('\n');
  lines.forEach((line, li) => {
    // Tokenize each line
    let i = 0;
    const parts: React.ReactNode[] = [];
    while (i < line.length) {
      // String key (followed by colon)
      const keyMatch = line.slice(i).match(/^("(?:\\.|[^"\\])*")(\s*:)/);
      if (keyMatch) {
        parts.push(
          <span key={`k-${i}`} style={{ color: '#4F46E5' }}>{keyMatch[1]}</span>,
          <span key={`c-${i}`} style={{ color: C.dim }}>{keyMatch[2]}</span>,
        );
        i += keyMatch[0].length;
        continue;
      }
      // String value
      const strMatch = line.slice(i).match(/^"(?:\\.|[^"\\])*"/);
      if (strMatch) {
        parts.push(<span key={`s-${i}`} style={{ color: '#059669' }}>{strMatch[0]}</span>);
        i += strMatch[0].length;
        continue;
      }
      // Number
      const numMatch = line.slice(i).match(/^-?\d+(\.\d+)?([eE][+-]?\d+)?/);
      if (numMatch) {
        parts.push(<span key={`n-${i}`} style={{ color: C.warning }}>{numMatch[0]}</span>);
        i += numMatch[0].length;
        continue;
      }
      // Boolean / null
      const kwMatch = line.slice(i).match(/^(true|false|null)/);
      if (kwMatch) {
        parts.push(<span key={`b-${i}`} style={{ color: '#DB2777' }}>{kwMatch[0]}</span>);
        i += kwMatch[0].length;
        continue;
      }
      // Punctuation / whitespace
      parts.push(<span key={`p-${i}`} style={{ color: C.muted }}>{line[i]}</span>);
      i++;
    }
    tokens.push(<span key={`ln-${li}`}>{parts}{'\n'}</span>);
  });
  return tokens;
}

// ── Skeleton row ──────────────────────────────────────────────────────────────

const SkeletonRow: React.FC<{ index: number }> = ({ index }) => (
  <tr style={{ borderBottom: `1px solid ${C.border}` }}>
    {[32, 140, 72, 240, 80, 60].map((w, ci) => (
      <td key={ci} style={{ padding: '10px 12px' }}>
        <div style={{
          height: 10, width: w, borderRadius: 2,
          background: `linear-gradient(90deg, ${C.card} 25%, ${C.panel} 50%, ${C.card} 75%)`,
          backgroundSize: '200% 100%',
          animation: `shimmer 1.4s ${index * 0.07}s infinite`,
          opacity: 0.6,
        }} />
      </td>
    ))}
  </tr>
);

// ── Inline Try Panel ──────────────────────────────────────────────────────────

interface TryPanelProps {
  util: UtilityDefinition;
  onClose: () => void;
}

const InlineTryPanel: React.FC<TryPanelProps> = ({ util, onClose }) => {
  const { runUtility } = useUtilityStore();
  const [inputs, setInputs] = useState<Record<string, string>>({});
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<unknown>(null);
  const [error, setError]   = useState<string | null>(null);

  const handleRun = useCallback(async () => {
    setRunning(true);
    setResult(null);
    setError(null);
    try {
      const res = await runUtility(util.id, inputs);
      const r = res.result as Record<string, unknown> | null;
      if (r && typeof r === 'object' && 'error' in r) {
        setError(String(r.error));
      } else {
        setResult(res.result);
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setRunning(false);
    }
  }, [util.id, inputs, runUtility]);

  const inputStyle: React.CSSProperties = {
    width: '100%',
    padding: '5px 8px',
    fontSize: 12,
    border: `1px solid ${C.border}`,
    borderRadius: 2,
    backgroundColor: C.codeBg,
    color: C.text,
    outline: 'none',
    fontFamily: C.codeFont,
    boxSizing: 'border-box',
    transition: 'border-color 120ms',
  };

  return (
    <tr>
      <td
        colSpan={6}
        style={{
          padding: 0,
          borderBottom: `1px solid ${C.border}`,
          borderLeft: `2px solid ${C.accent}`,
          backgroundColor: C.codeBg,
        }}
      >
        <div style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 14 }}>

          {/* Header */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Terminal size={13} color={C.accent} />
            <span style={{ fontSize: 12, fontWeight: 600, color: C.accent, letterSpacing: '0.08em', textTransform: 'uppercase', fontFamily: C.codeFont }}>
              Run — {util.name}
            </span>
            <div style={{ flex: 1 }} />
            <button
              onClick={onClose}
              style={{
                background: 'none', border: 'none', cursor: 'pointer',
                color: C.dim, fontSize: 16, lineHeight: 1, padding: '2px 6px',
                fontFamily: C.uiFont,
              }}
            >
              ×
            </button>
          </div>

          {/* Input fields */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 10 }}>
            {util.input_schema.map((field) => (
              <div key={field.name}>
                <label style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 4 }}>
                  <span style={{ fontSize: 11, color: '#4F46E5', fontFamily: C.codeFont }}>{field.name}</span>
                  <span style={{ fontSize: 10, color: C.dim, fontFamily: C.codeFont }}>{field.type}</span>
                  {field.required && (
                    <span style={{ fontSize: 9, color: C.error, fontWeight: 700, letterSpacing: '0.05em' }}>REQ</span>
                  )}
                </label>
                {field.description && (
                  <div style={{ fontSize: 10, color: C.dim, marginBottom: 4, fontFamily: C.uiFont }}>{field.description}</div>
                )}
                {field.type === 'object' ? (
                  <textarea
                    style={{ ...inputStyle, minHeight: 56, resize: 'vertical' }}
                    placeholder="{}"
                    value={inputs[field.name] || ''}
                    onChange={(e) => setInputs((p) => ({ ...p, [field.name]: e.target.value }))}
                    onFocus={(e) => (e.currentTarget.style.borderColor = C.accent)}
                    onBlur={(e) => (e.currentTarget.style.borderColor = C.border)}
                  />
                ) : (
                  <input
                    style={inputStyle}
                    type={field.type === 'number' ? 'number' : 'text'}
                    placeholder={field.description || field.name}
                    value={inputs[field.name] || ''}
                    onChange={(e) => setInputs((p) => ({ ...p, [field.name]: e.target.value }))}
                    onFocus={(e) => (e.currentTarget.style.borderColor = C.accent)}
                    onBlur={(e) => (e.currentTarget.style.borderColor = C.border)}
                  />
                )}
              </div>
            ))}
          </div>

          {/* Run button */}
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <button
              onClick={handleRun}
              disabled={running}
              style={{
                height: 32,
                padding: '0 18px',
                backgroundColor: running ? C.accentDim : C.accent,
                color: '#FFF',
                border: 'none',
                borderRadius: 2,
                fontSize: 12,
                fontWeight: 600,
                cursor: running ? 'wait' : 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 7,
                fontFamily: C.uiFont,
                letterSpacing: '0.03em',
                transition: 'background-color 150ms',
              }}
            >
              {running
                ? <Loader size={12} style={{ animation: 'spin 0.6s linear infinite' }} />
                : <Play size={12} />
              }
              {running ? 'Running…' : 'Execute'}
            </button>
            {running && (
              <span style={{ fontSize: 11, color: C.muted, fontFamily: C.codeFont }}>
                calling {util.id}…
              </span>
            )}
          </div>

          {/* Error */}
          {error && (
            <div style={{
              display: 'flex',
              gap: 8,
              alignItems: 'flex-start',
              backgroundColor: 'rgba(239,68,68,0.08)',
              border: `1px solid rgba(239,68,68,0.3)`,
              borderLeft: `2px solid ${C.error}`,
              borderRadius: 2,
              padding: '8px 10px',
            }}>
              <XCircle size={13} color={C.error} style={{ flexShrink: 0, marginTop: 1 }} />
              <span style={{ fontSize: 12, color: C.error, fontFamily: C.codeFont }}>{error}</span>
            </div>
          )}

          {/* Result */}
          {result !== null && !error && (
            <div style={{
              border: `1px solid ${C.border}`,
              borderLeft: `2px solid ${C.success}`,
              borderRadius: 2,
              overflow: 'hidden',
            }}>
              <div style={{
                display: 'flex',
                gap: 6,
                alignItems: 'center',
                padding: '5px 10px',
                backgroundColor: 'rgba(16,185,129,0.06)',
                borderBottom: `1px solid ${C.border}`,
              }}>
                <CheckCircle size={11} color={C.success} />
                <span style={{ fontSize: 10, color: C.success, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', fontFamily: C.uiFont }}>
                  Result
                </span>
              </div>
              <pre style={{
                margin: 0,
                padding: '10px 12px',
                fontSize: 11,
                lineHeight: 1.6,
                color: C.text,
                backgroundColor: C.codeBg,
                overflow: 'auto',
                maxHeight: 280,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-all',
                fontFamily: C.codeFont,
              }}>
                {colorizeJson(JSON.stringify(result, null, 2))}
              </pre>
            </div>
          )}
        </div>
      </td>
    </tr>
  );
};

// ── Expanded schema row ───────────────────────────────────────────────────────

const ExpandedSchemaRow: React.FC<{ util: UtilityDefinition }> = ({ util }) => {
  const thStyle: React.CSSProperties = {
    padding: '5px 10px',
    fontSize: 10,
    fontWeight: 700,
    color: C.dim,
    textTransform: 'uppercase',
    letterSpacing: '0.07em',
    textAlign: 'left',
    borderBottom: `1px solid ${C.border}`,
    backgroundColor: C.bg,
    fontFamily: C.uiFont,
  };
  const tdStyle: React.CSSProperties = {
    padding: '6px 10px',
    fontSize: 11,
    color: C.text,
    borderBottom: `1px solid rgba(30,58,95,0.5)`,
    verticalAlign: 'top',
    fontFamily: C.codeFont,
  };

  return (
    <tr>
      <td
        colSpan={6}
        style={{
          padding: 0,
          borderBottom: `1px solid ${C.border}`,
          borderLeft: `2px solid ${C.accentDim}`,
          backgroundColor: C.panel,
        }}
      >
        <div style={{ padding: '14px 20px', display: 'flex', flexDirection: 'column', gap: 16 }}>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>

            {/* Inputs table */}
            <div>
              <div style={{ fontSize: 10, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8, fontFamily: C.uiFont }}>
                Input Schema
              </div>
              <table style={{ width: '100%', borderCollapse: 'collapse', border: `1px solid ${C.border}`, borderRadius: 2 }}>
                <thead>
                  <tr>
                    <th style={thStyle}>Name</th>
                    <th style={thStyle}>Type</th>
                    <th style={thStyle}>Req</th>
                    <th style={thStyle}>Description</th>
                  </tr>
                </thead>
                <tbody>
                  {util.input_schema.map((f) => (
                    <tr key={f.name} style={{ backgroundColor: C.card }}>
                      <td style={{ ...tdStyle, color: '#4F46E5' }}>{f.name}</td>
                      <td style={{ ...tdStyle, color: C.warning }}>{f.type}</td>
                      <td style={{ ...tdStyle, textAlign: 'center' }}>
                        {f.required
                          ? <span style={{ color: C.error, fontSize: 10, fontWeight: 700 }}>●</span>
                          : <span style={{ color: C.dim, fontSize: 10 }}>○</span>
                        }
                      </td>
                      <td style={{ ...tdStyle, color: C.muted, fontFamily: C.uiFont }}>{f.description || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Output schema table */}
            <div>
              <div style={{ fontSize: 10, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8, fontFamily: C.uiFont }}>
                Output Schema
              </div>
              <table style={{ width: '100%', borderCollapse: 'collapse', border: `1px solid ${C.border}`, borderRadius: 2 }}>
                <thead>
                  <tr>
                    <th style={thStyle}>Key</th>
                    <th style={thStyle}>Description</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(util.output_schema).map(([key, desc]) => (
                    <tr key={key} style={{ backgroundColor: C.card }}>
                      <td style={{ ...tdStyle, color: '#34D399' }}>{key}</td>
                      <td style={{ ...tdStyle, color: C.muted, fontFamily: C.uiFont }}>{desc}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Usage hint */}
          <div>
            <div style={{ fontSize: 10, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6, fontFamily: C.uiFont }}>
              Logic Studio Usage
            </div>
            <div style={{
              backgroundColor: C.codeBg,
              border: `1px solid ${C.border}`,
              borderRadius: 2,
              padding: '8px 12px',
              fontFamily: C.codeFont,
              fontSize: 11,
              color: C.text,
              lineHeight: 1.7,
            }}>
              <span style={{ color: C.dim }}>{'{ '}</span>
              <span style={{ color: '#4F46E5' }}>"block_type"</span>
              <span style={{ color: C.dim }}>: </span>
              <span style={{ color: '#34D399' }}>"utility_call"</span>
              <span style={{ color: C.dim }}>,  </span>
              <span style={{ color: '#4F46E5' }}>"utility_id"</span>
              <span style={{ color: C.dim }}>: </span>
              <span style={{ color: '#34D399' }}>"{util.id}"</span>
              <span style={{ color: C.dim }}>{' }'}</span>
            </div>
          </div>
        </div>
      </td>
    </tr>
  );
};

// ── Utility table row ─────────────────────────────────────────────────────────

interface UtilityRowProps {
  util: UtilityDefinition;
  isExpanded: boolean;
  isTrying: boolean;
  hasSucceeded: boolean;
  onToggleExpand: () => void;
  onToggleTry: () => void;
}

const UtilityRow: React.FC<UtilityRowProps> = ({
  util, isExpanded, isTrying, hasSucceeded, onToggleExpand, onToggleTry,
}) => {
  const [hovered, setHovered] = useState(false);

  const rowBg = isExpanded || isTrying
    ? 'rgba(59,130,246,0.04)'
    : hovered
    ? 'rgba(255,255,255,0.015)'
    : 'transparent';

  const inputCount = util.input_schema.length;
  const reqCount   = util.input_schema.filter((f) => f.required).length;

  return (
    <tr
      style={{
        borderBottom: `1px solid ${C.border}`,
        backgroundColor: rowBg,
        transition: 'background-color 80ms',
        cursor: 'pointer',
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={onToggleExpand}
    >
      {/* Icon */}
      <td style={{ padding: '9px 12px', width: 36 }}>
        <div style={{
          width: 28,
          height: 28,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: util.color + '14',
          border: `1px solid ${util.color}33`,
          borderRadius: 2,
          color: util.color,
          flexShrink: 0,
        }}>
          {ICON_MAP[util.icon] || <Wrench size={13} />}
        </div>
      </td>

      {/* Name + status dot */}
      <td style={{ padding: '9px 12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          <div style={{
            width: 6,
            height: 6,
            borderRadius: '50%',
            backgroundColor: hasSucceeded ? C.success : C.dim,
            flexShrink: 0,
            boxShadow: hasSucceeded ? `0 0 6px ${C.success}` : 'none',
            transition: 'background-color 300ms, box-shadow 300ms',
          }} />
          <span style={{
            fontSize: 12,
            fontWeight: 600,
            color: C.text,
            fontFamily: C.uiFont,
            whiteSpace: 'nowrap',
          }}>
            {util.name}
          </span>
        </div>
      </td>

      {/* Category */}
      <td style={{ padding: '9px 12px' }}>
        <span style={{
          fontSize: 10,
          padding: '2px 7px',
          border: `1px solid ${C.border}`,
          borderRadius: 2,
          color: C.muted,
          fontFamily: C.uiFont,
          whiteSpace: 'nowrap',
          letterSpacing: '0.03em',
        }}>
          {util.category}
        </span>
      </td>

      {/* Description */}
      <td style={{ padding: '9px 12px' }}>
        <span style={{
          fontSize: 11,
          color: C.muted,
          fontFamily: C.uiFont,
          lineHeight: 1.4,
          display: '-webkit-box',
          WebkitLineClamp: 1,
          WebkitBoxOrient: 'vertical',
          overflow: 'hidden',
        }}>
          {util.description}
        </span>
      </td>

      {/* Inputs badge */}
      <td style={{ padding: '9px 12px', whiteSpace: 'nowrap' }}>
        <span style={{
          fontSize: 11,
          color: C.muted,
          fontFamily: C.codeFont,
        }}>
          {inputCount} {reqCount > 0 && (
            <span style={{ color: C.error, fontSize: 10 }}>({reqCount} req)</span>
          )}
        </span>
      </td>

      {/* Actions */}
      <td
        style={{ padding: '9px 12px', whiteSpace: 'nowrap' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <button
            onClick={onToggleTry}
            style={{
              height: 26,
              padding: '0 10px',
              backgroundColor: isTrying ? C.accent : 'transparent',
              color: isTrying ? '#FFF' : C.accent,
              border: `1px solid ${C.accent}`,
              borderRadius: 2,
              fontSize: 11,
              fontWeight: 600,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 5,
              fontFamily: C.uiFont,
              letterSpacing: '0.03em',
              transition: 'background-color 120ms, color 120ms',
            }}
          >
            <Play size={10} />
            {isTrying ? 'Close' : 'Run'}
          </button>
          <button
            onClick={onToggleExpand}
            style={{
              width: 26,
              height: 26,
              border: `1px solid ${C.border}`,
              backgroundColor: isExpanded ? C.accentDim : 'transparent',
              borderRadius: 2,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: isExpanded ? C.accent : C.dim,
              transition: 'background-color 120ms',
            }}
          >
            {isExpanded ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
          </button>
        </div>
      </td>
    </tr>
  );
};

// ── Main Page ─────────────────────────────────────────────────────────────────

const UtilitiesPage: React.FC = () => {
  const { utilities, loading, fetchUtilities } = useUtilityStore();

  const [search,          setSearch]          = useState('');
  const [activeCategory,  setActiveCategory]  = useState<string>('All');
  const [expandedId,      setExpandedId]      = useState<string | null>(null);
  const [tryingId,        setTryingId]        = useState<string | null>(null);
  const [succeededIds,    setSucceededIds]    = useState<Set<string>>(new Set());

  useEffect(() => { fetchUtilities(); }, []);

  // Build category list from data
  const allCategories = ['All', ...CATEGORY_ORDER.filter((c) => utilities.some((u) => u.category === c))];
  const extraCats = [...new Set(utilities.map((u) => u.category))].filter(
    (c) => !CATEGORY_ORDER.includes(c),
  );
  const tabs = [...allCategories, ...extraCats];

  const filtered = utilities.filter((u) => {
    const q = search.toLowerCase();
    const matchSearch =
      !q ||
      u.name.toLowerCase().includes(q) ||
      u.description.toLowerCase().includes(q) ||
      u.category.toLowerCase().includes(q);
    const matchCat = activeCategory === 'All' || u.category === activeCategory;
    return matchSearch && matchCat;
  });

  const handleToggleExpand = useCallback((id: string) => {
    setExpandedId((prev) => (prev === id ? null : id));
  }, []);

  const handleToggleTry = useCallback((id: string) => {
    setTryingId((prev) => (prev === id ? null : id));
    // Close schema expand when opening try panel
    setExpandedId(null);
  }, []);

  // Wrap runUtility to track successes for status dot
  const { runUtility } = useUtilityStore();
  const handleRunSuccess = useCallback((id: string) => {
    setSucceededIds((prev) => new Set([...prev, id]));
  }, []);

  // We intercept runUtility via a wrapper passed to InlineTryPanel via a custom hook trick
  // Instead, we pass a success callback — but InlineTryPanel already handles run internally.
  // We'll use a different approach: track successes at the row level.
  void runUtility;
  void handleRunSuccess;

  const colHeaderStyle: React.CSSProperties = {
    padding: '7px 12px',
    fontSize: 10,
    fontWeight: 700,
    color: C.dim,
    textTransform: 'uppercase',
    letterSpacing: '0.08em',
    textAlign: 'left',
    borderBottom: `1px solid ${C.border}`,
    backgroundColor: C.panel,
    whiteSpace: 'nowrap',
    fontFamily: C.uiFont,
    position: 'sticky',
    top: 0,
    zIndex: 1,
  };

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      height: '100%',
      backgroundColor: C.bg,
      fontFamily: C.uiFont,
      color: C.text,
    }}>

      {/* ── Top header bar ──────────────────────────────────────────────────── */}
      <div style={{
        height: 48,
        backgroundColor: C.panel,
        borderBottom: `1px solid ${C.border}`,
        display: 'flex',
        alignItems: 'center',
        padding: '0 16px',
        gap: 10,
        flexShrink: 0,
      }}>
        <Wrench size={14} color={C.accent} />
        <span style={{ fontSize: 13, fontWeight: 700, color: C.text, letterSpacing: '0.02em' }}>
          Utilities
        </span>
        <div style={{
          fontSize: 10,
          fontWeight: 700,
          backgroundColor: C.accentDim,
          color: C.accent,
          padding: '2px 7px',
          borderRadius: 2,
          border: `1px solid ${C.border}`,
          letterSpacing: '0.04em',
        }}>
          {utilities.length}
        </div>

        <div style={{ flex: 1 }} />

        {/* Search */}
        <div style={{ position: 'relative' }}>
          <Search
            size={12}
            style={{
              position: 'absolute',
              left: 8,
              top: '50%',
              transform: 'translateY(-50%)',
              color: C.dim,
              pointerEvents: 'none',
            }}
          />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search utilities…"
            style={{
              height: 28,
              padding: '0 10px 0 26px',
              borderRadius: 2,
              border: `1px solid ${C.border}`,
              backgroundColor: C.bg,
              fontSize: 11,
              color: C.text,
              outline: 'none',
              width: 200,
              fontFamily: C.uiFont,
            }}
          />
        </div>
      </div>

      {/* ── Category tabs ────────────────────────────────────────────────────── */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 0,
        backgroundColor: C.panel,
        borderBottom: `1px solid ${C.border}`,
        padding: '0 16px',
        flexShrink: 0,
        overflowX: 'auto',
      }}>
        {tabs.map((cat) => {
          const count = cat === 'All' ? utilities.length : utilities.filter((u) => u.category === cat).length;
          const isActive = activeCategory === cat;
          return (
            <button
              key={cat}
              onClick={() => setActiveCategory(cat)}
              style={{
                height: 36,
                padding: '0 14px',
                border: 'none',
                borderBottom: isActive ? `2px solid ${C.accent}` : '2px solid transparent',
                backgroundColor: 'transparent',
                color: isActive ? C.accent : C.muted,
                fontSize: 11,
                fontWeight: isActive ? 700 : 400,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                whiteSpace: 'nowrap',
                letterSpacing: '0.02em',
                fontFamily: C.uiFont,
                transition: 'color 120ms, border-color 120ms',
                flexShrink: 0,
              }}
            >
              {cat}
              <span style={{
                fontSize: 9,
                backgroundColor: isActive ? C.accentDim : C.bg,
                color: isActive ? C.accent : C.dim,
                border: `1px solid ${isActive ? C.accent : C.border}`,
                padding: '1px 5px',
                borderRadius: 2,
                fontWeight: 700,
                letterSpacing: '0.04em',
                transition: 'all 120ms',
              }}>
                {count}
              </span>
            </button>
          );
        })}
      </div>

      {/* ── Table area ───────────────────────────────────────────────────────── */}
      <div style={{ flex: 1, overflow: 'auto' }}>
        <table style={{
          width: '100%',
          borderCollapse: 'collapse',
          tableLayout: 'fixed',
        }}>
          <colgroup>
            <col style={{ width: 52 }} />
            <col style={{ width: 180 }} />
            <col style={{ width: 110 }} />
            <col />
            <col style={{ width: 100 }} />
            <col style={{ width: 110 }} />
          </colgroup>

          <thead>
            <tr>
              <th style={colHeaderStyle}>{/* icon */}</th>
              <th style={colHeaderStyle}>Name</th>
              <th style={colHeaderStyle}>Category</th>
              <th style={colHeaderStyle}>Description</th>
              <th style={colHeaderStyle}>Inputs</th>
              <th style={colHeaderStyle}>Actions</th>
            </tr>
          </thead>

          <tbody>
            {/* Loading skeleton */}
            {loading && Array.from({ length: 7 }, (_, i) => (
              <SkeletonRow key={i} index={i} />
            ))}

            {/* Empty state */}
            {!loading && filtered.length === 0 && (
              <tr>
                <td
                  colSpan={6}
                  style={{
                    textAlign: 'center',
                    padding: '60px 0',
                    color: C.dim,
                    fontSize: 12,
                    fontFamily: C.uiFont,
                  }}
                >
                  {search
                    ? `No utilities match "${search}"`
                    : 'No utilities available'
                  }
                </td>
              </tr>
            )}

            {/* Data rows */}
            {!loading && filtered.map((util) => {
              const isExpanded = expandedId === util.id;
              const isTrying   = tryingId   === util.id;
              const hasDone    = succeededIds.has(util.id);
              return (
                <React.Fragment key={util.id}>
                  <UtilityRow
                    util={util}
                    isExpanded={isExpanded}
                    isTrying={isTrying}
                    hasSucceeded={hasDone}
                    onToggleExpand={() => handleToggleExpand(util.id)}
                    onToggleTry={() => handleToggleTry(util.id)}
                  />
                  {isExpanded && !isTrying && (
                    <ExpandedSchemaRow util={util} />
                  )}
                  {isTrying && (
                    <InlineTryPanelRow
                      util={util}
                      onClose={() => setTryingId(null)}
                      onSuccess={() =>
                        setSucceededIds((prev) => new Set([...prev, util.id]))
                      }
                    />
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      <style>{`
        @keyframes spin    { to { transform: rotate(360deg); } }
        @keyframes shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }
        ::-webkit-scrollbar { width: 6px; height: 6px; }
        ::-webkit-scrollbar-track { background: ${C.bg}; }
        ::-webkit-scrollbar-thumb { background: ${C.border}; border-radius: 2px; }
        ::-webkit-scrollbar-thumb:hover { background: ${C.muted}; }
        input::placeholder, textarea::placeholder { color: ${C.dim}; }
      `}</style>
    </div>
  );
};

// ── Inline try panel as table row (success callback variant) ─────────────────

interface InlineTryPanelRowProps {
  util: UtilityDefinition;
  onClose: () => void;
  onSuccess: () => void;
}

const InlineTryPanelRow: React.FC<InlineTryPanelRowProps> = ({ util, onClose, onSuccess }) => {
  const { runUtility } = useUtilityStore();
  const [inputs, setInputs] = useState<Record<string, string>>({});
  const [running, setRunning] = useState(false);
  const [result, setResult]   = useState<unknown>(null);
  const [error, setError]     = useState<string | null>(null);

  const handleRun = async () => {
    setRunning(true);
    setResult(null);
    setError(null);
    try {
      const res = await runUtility(util.id, inputs);
      const r = res.result as Record<string, unknown> | null;
      if (r && typeof r === 'object' && 'error' in r) {
        setError(String(r.error));
      } else {
        setResult(res.result);
        onSuccess();
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setRunning(false);
    }
  };

  const inputStyle: React.CSSProperties = {
    width: '100%',
    padding: '5px 8px',
    fontSize: 12,
    border: `1px solid ${C.border}`,
    borderRadius: 2,
    backgroundColor: C.codeBg,
    color: C.text,
    outline: 'none',
    fontFamily: C.codeFont,
    boxSizing: 'border-box',
  };

  return (
    <tr>
      <td
        colSpan={6}
        style={{
          padding: 0,
          borderBottom: `1px solid ${C.border}`,
          borderLeft: `2px solid ${C.accent}`,
          backgroundColor: C.codeBg,
        }}
      >
        <div style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 14 }}>

          {/* Header */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Terminal size={13} color={C.accent} />
            <span style={{
              fontSize: 12,
              fontWeight: 600,
              color: C.accent,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              fontFamily: C.codeFont,
            }}>
              Run — {util.name}
            </span>
            <div style={{ flex: 1 }} />
            <button
              onClick={onClose}
              style={{
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                color: C.dim,
                fontSize: 18,
                lineHeight: 1,
                padding: '2px 6px',
                fontFamily: C.uiFont,
              }}
            >
              ×
            </button>
          </div>

          {/* Fields */}
          {util.input_schema.length === 0 ? (
            <div style={{ fontSize: 11, color: C.dim, fontFamily: C.uiFont }}>
              This utility takes no inputs.
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 10 }}>
              {util.input_schema.map((field) => (
                <div key={field.name}>
                  <label style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 4 }}>
                    <span style={{ fontSize: 11, color: '#4F46E5', fontFamily: C.codeFont }}>{field.name}</span>
                    <span style={{ fontSize: 10, color: C.dim, fontFamily: C.codeFont }}>{field.type}</span>
                    {field.required && (
                      <span style={{ fontSize: 9, color: C.error, fontWeight: 700, letterSpacing: '0.05em' }}>REQ</span>
                    )}
                  </label>
                  {field.description && (
                    <div style={{ fontSize: 10, color: C.dim, marginBottom: 4, fontFamily: C.uiFont }}>{field.description}</div>
                  )}
                  {field.type === 'object' ? (
                    <textarea
                      style={{ ...inputStyle, minHeight: 56, resize: 'vertical' }}
                      placeholder="{}"
                      value={inputs[field.name] || ''}
                      onChange={(e) => setInputs((p) => ({ ...p, [field.name]: e.target.value }))}
                    />
                  ) : (
                    <input
                      style={inputStyle}
                      type={field.type === 'number' ? 'number' : 'text'}
                      placeholder={field.description || field.name}
                      value={inputs[field.name] || ''}
                      onChange={(e) => setInputs((p) => ({ ...p, [field.name]: e.target.value }))}
                    />
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Execute */}
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <button
              onClick={handleRun}
              disabled={running}
              style={{
                height: 32,
                padding: '0 18px',
                backgroundColor: running ? C.accentDim : C.accent,
                color: '#FFF',
                border: 'none',
                borderRadius: 2,
                fontSize: 12,
                fontWeight: 600,
                cursor: running ? 'wait' : 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 7,
                fontFamily: C.uiFont,
                letterSpacing: '0.03em',
                transition: 'background-color 150ms',
              }}
            >
              {running
                ? <Loader size={12} style={{ animation: 'spin 0.6s linear infinite' }} />
                : <Play size={12} />
              }
              {running ? 'Running…' : 'Execute'}
            </button>
            {running && (
              <span style={{ fontSize: 11, color: C.muted, fontFamily: C.codeFont }}>
                calling {util.id}…
              </span>
            )}
          </div>

          {/* Error */}
          {error && (
            <div style={{
              display: 'flex',
              gap: 8,
              alignItems: 'flex-start',
              backgroundColor: 'rgba(239,68,68,0.08)',
              border: `1px solid rgba(239,68,68,0.3)`,
              borderLeft: `2px solid ${C.error}`,
              borderRadius: 2,
              padding: '8px 10px',
            }}>
              <XCircle size={13} color={C.error} style={{ flexShrink: 0, marginTop: 1 }} />
              <span style={{ fontSize: 12, color: C.error, fontFamily: C.codeFont }}>{error}</span>
            </div>
          )}

          {/* Result */}
          {result !== null && !error && (
            <div style={{
              border: `1px solid ${C.border}`,
              borderLeft: `2px solid ${C.success}`,
              borderRadius: 2,
              overflow: 'hidden',
            }}>
              <div style={{
                display: 'flex',
                gap: 6,
                alignItems: 'center',
                padding: '5px 10px',
                backgroundColor: 'rgba(16,185,129,0.06)',
                borderBottom: `1px solid ${C.border}`,
              }}>
                <CheckCircle size={11} color={C.success} />
                <span style={{
                  fontSize: 10,
                  color: C.success,
                  fontWeight: 700,
                  letterSpacing: '0.08em',
                  textTransform: 'uppercase',
                  fontFamily: C.uiFont,
                }}>
                  Result
                </span>
              </div>
              <pre style={{
                margin: 0,
                padding: '10px 12px',
                fontSize: 11,
                lineHeight: 1.6,
                color: C.text,
                backgroundColor: C.codeBg,
                overflow: 'auto',
                maxHeight: 280,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-all',
                fontFamily: C.codeFont,
              }}>
                {colorizeJson(JSON.stringify(result, null, 2))}
              </pre>
            </div>
          )}
        </div>
      </td>
    </tr>
  );
};

export default UtilitiesPage;
