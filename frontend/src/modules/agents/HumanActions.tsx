import React, { useState, useEffect, useCallback } from 'react';
import {
  CheckCircle, XCircle, Clock, Bot, User, AlertTriangle, AlertCircle,
  Plus, Trash2, Edit2, Shield, ToggleLeft, ToggleRight,
  Filter, RefreshCw, ChevronRight, Inbox, History, Settings,
  ArrowUpCircle, Info, Layers,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useHumanActionsStore, ActionExecution } from '../../store/humanActionsStore';
import { getTenantId } from '../../store/authStore';
import { useNavigationStore } from '../../store/navigationStore';
import { CheckpointGate } from '../audit/CheckpointGate';

const AGENT_API = import.meta.env.VITE_AGENT_SERVICE_URL || 'http://localhost:8013';
const DEDUP_AGENT_NAME = 'Action Deduplicator';

const ONTOLOGY_API = import.meta.env.VITE_ONTOLOGY_SERVICE_URL || 'http://localhost:8004';

const C = {
  bg: '#F8F9FA',
  sidebar: '#FFFFFF',
  panel: '#FFFFFF',
  border: '#E2E8F0',
  borderLight: '#EEF1F5',
  text: '#0D1117',
  muted: '#64748B',
  dim: '#94A3B8',
  accent: '#2563EB',
  accentDim: '#EFF6FF',
  accentBorder: '#BFDBFE',
  success: '#059669',
  successDim: '#ECFDF5',
  successBorder: '#6EE7B7',
  error: '#DC2626',
  errorDim: '#FEF2F2',
  errorBorder: '#FECACA',
  warn: '#D97706',
  warnDim: '#FFFBEB',
  warnBorder: '#FDE68A',
  critical: '#7C2D12',
  criticalDim: '#FFF7ED',
  criticalBorder: '#FED7AA',
  navy: '#1A3C6E',
  rowHover: '#F1F5F9',
  selected: '#EFF6FF',
  selectedBorder: '#2563EB',
};

// ── Types ─────────────────────────────────────────────────────────────────────

interface ActionDefinition {
  id: string;
  name: string;
  description?: string;
  input_schema: Record<string, unknown>;
  requires_confirmation: boolean;
  allowed_roles: string[];
  writes_to_object_type?: string;
  enabled: boolean;
  notify_email?: string;
  created_at?: string;
}

type SeverityLevel = 'critical' | 'high' | 'medium' | 'low' | null;

function getSeverity(exec: ActionExecution): SeverityLevel {
  const sev = (exec.inputs as Record<string, unknown>)?.severity as string | undefined;
  if (!sev) return null;
  if (sev === 'critical') return 'critical';
  if (sev === 'high') return 'high';
  if (sev === 'medium') return 'medium';
  return 'low';
}

function severityColor(s: SeverityLevel) {
  if (s === 'critical') return { bg: C.criticalDim, text: C.critical, border: C.criticalBorder };
  if (s === 'high')     return { bg: C.errorDim,    text: C.error,    border: C.errorBorder };
  if (s === 'medium')   return { bg: C.warnDim,     text: C.warn,     border: C.warnBorder };
  return { bg: C.bg, text: C.muted, border: C.border };
}

function severityIcon(s: SeverityLevel) {
  if (s === 'critical') return <AlertCircle size={13} />;
  if (s === 'high')     return <AlertTriangle size={13} />;
  if (s === 'medium')   return <ArrowUpCircle size={13} />;
  return <Info size={13} />;
}

function timeAgo(iso?: string) {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

// ── Map Widget (CartoDB dark tiles via OpenLayers) ────────────────────────────

const MapWidget: React.FC<{ lat: number; lon: number }> = ({ lat, lon }) => {
  const mapId = React.useId().replace(/:/g, '');
  const mapRef = React.useRef<unknown>(null);

  React.useEffect(() => {
    // Load OpenLayers dynamically if not already present
    const OL_CSS = 'https://cdn.jsdelivr.net/npm/ol@9.1.0/ol.css';
    const OL_JS  = 'https://cdn.jsdelivr.net/npm/ol@9.1.0/dist/ol.js';

    function initMap() {
      const ol = (window as unknown as Record<string, unknown>).ol as Record<string, unknown>;
      if (!ol || mapRef.current) return;

      const fromLonLat = (ol.proj as Record<string, unknown>).fromLonLat as (c: number[]) => number[];
      const center = fromLonLat([lon, lat]);

      const marker = new (ol.Feature as new (opts: unknown) => unknown)({
        geometry: new ((ol.geom as Record<string, unknown>).Point as new (c: number[]) => unknown)(center),
      });
      (marker as { setStyle: (s: unknown) => void }).setStyle(
        new ((ol.style as Record<string, unknown>).Style as new (opts: unknown) => unknown)({
          image: new ((ol.style as Record<string, unknown>).Circle as new (opts: unknown) => unknown)({
            radius: 7,
            fill: new ((ol.style as Record<string, unknown>).Fill as new (opts: unknown) => unknown)({ color: '#EF4444' }),
            stroke: new ((ol.style as Record<string, unknown>).Stroke as new (opts: unknown) => unknown)({ color: '#fff', width: 2 }),
          }),
        })
      );

      const vectorSource = new ((ol.source as Record<string, unknown>).Vector as new (opts: unknown) => unknown)({
        features: [marker],
      });

      mapRef.current = new ((ol as Record<string, unknown>).Map as new (opts: unknown) => unknown)({
        target: mapId,
        layers: [
          new ((ol.layer as Record<string, unknown>).Tile as new (opts: unknown) => unknown)({
            source: new ((ol.source as Record<string, unknown>).XYZ as new (opts: unknown) => unknown)({
              url: 'https://basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png',
              attributions: '© CartoDB',
            }),
          }),
          new ((ol.layer as Record<string, unknown>).Vector as new (opts: unknown) => unknown)({ source: vectorSource }),
        ],
        view: new ((ol as Record<string, unknown>).View as new (opts: unknown) => unknown)({
          center,
          zoom: 13,
        }),
        controls: [],
      });
    }

    // Add CSS if missing
    if (!document.querySelector(`link[href="${OL_CSS}"]`)) {
      const link = document.createElement('link');
      link.rel = 'stylesheet'; link.href = OL_CSS;
      document.head.appendChild(link);
    }

    // Load JS if missing, then init
    if ((window as unknown as Record<string, unknown>).ol) {
      initMap();
    } else if (!document.querySelector(`script[src="${OL_JS}"]`)) {
      const script = document.createElement('script');
      script.src = OL_JS;
      script.onload = initMap;
      document.head.appendChild(script);
    } else {
      // Script tag exists but not loaded yet — wait
      const poll = setInterval(() => {
        if ((window as unknown as Record<string, unknown>).ol) { clearInterval(poll); initMap(); }
      }, 100);
    }

    return () => {
      if (mapRef.current) {
        ((mapRef.current as Record<string, unknown>).setTarget as (t: undefined) => void)(undefined);
        mapRef.current = null;
      }
    };
  }, [lat, lon, mapId]);

  return (
    <section>
      <div style={{ fontSize: 11, fontWeight: 700, color: C.dim, textTransform: 'uppercase',
        letterSpacing: '0.07em', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
        <span>📍</span> Location
        <span style={{ fontSize: 10, fontWeight: 400, color: C.dim, fontFamily: 'monospace', marginLeft: 4 }}>
          {lat.toFixed(5)}, {lon.toFixed(5)}
        </span>
      </div>
      <div style={{ borderRadius: 8, overflow: 'hidden', border: '1px solid #1E2530' }}>
        <div id={mapId} style={{ width: '100%', height: 220, background: '#0d1117' }} />
        <div style={{ padding: '6px 10px', backgroundColor: '#0d1117', borderTop: '1px solid #1E2530',
          fontSize: 10, color: '#8b949e', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>© CartoDB</span>
          <a href={`https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=14/${lat}/${lon}`}
            target="_blank" rel="noopener noreferrer"
            style={{ color: '#58a6ff', textDecoration: 'none', fontSize: 10 }}>
            Open full map ↗
          </a>
        </div>
      </div>
    </section>
  );
};

// ── Queue Row (Palantir-style compact row) ────────────────────────────────────

const QueueRow: React.FC<{
  exec: ActionExecution;
  selected: boolean;
  checked?: boolean;
  onCheck?: (e: React.MouseEvent) => void;
  onClick: () => void;
}> = ({ exec, selected, checked, onCheck, onClick }) => {
  const sev = getSeverity(exec);
  const sc  = severityColor(sev);
  const title = (exec.inputs as Record<string, unknown>)?.title as string | undefined;
  const category = (exec.inputs as Record<string, unknown>)?.category as string | undefined;
  const isAgent = exec.source === 'agent';

  return (
    <div
      onClick={onClick}
      style={{
        display: 'flex', alignItems: 'center', gap: 10, padding: '10px 16px',
        cursor: 'pointer', borderBottom: `1px solid ${C.borderLight}`,
        backgroundColor: selected ? C.selected : 'transparent',
        borderLeft: `3px solid ${selected ? C.selectedBorder : 'transparent'}`,
        transition: 'background 0.1s',
      }}
      onMouseEnter={e => { if (!selected) (e.currentTarget as HTMLDivElement).style.backgroundColor = C.rowHover; }}
      onMouseLeave={e => { if (!selected) (e.currentTarget as HTMLDivElement).style.backgroundColor = 'transparent'; }}
    >
      {/* Bulk select checkbox */}
      {onCheck !== undefined && (
        <input
          type="checkbox"
          checked={!!checked}
          onClick={(e) => { e.stopPropagation(); onCheck(e); }}
          onChange={() => {}}
          style={{ accentColor: C.accent, cursor: 'pointer', width: 13, height: 13, flexShrink: 0 }}
        />
      )}
      {/* Severity indicator */}
      {sev ? (
        <span style={{
          fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 3,
          backgroundColor: sc.bg, color: sc.text, border: `1px solid ${sc.border}`,
          display: 'inline-flex', alignItems: 'center', gap: 3, flexShrink: 0, textTransform: 'uppercase',
        }}>
          {severityIcon(sev)} {sev}
        </span>
      ) : (
        <span style={{
          fontSize: 10, fontWeight: 600, padding: '2px 6px', borderRadius: 3,
          backgroundColor: C.accentDim, color: C.accent, border: `1px solid ${C.accentBorder}`,
          flexShrink: 0,
        }}>
          ACTION
        </span>
      )}

      {/* Content */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12.5, fontWeight: 600, color: C.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {title || exec.action_name}
        </div>
        <div style={{ fontSize: 11, color: C.muted, display: 'flex', gap: 6, alignItems: 'center', marginTop: 1 }}>
          <span style={{ fontFamily: 'monospace' }}>{exec.action_name}</span>
          {category && <><span>·</span><span>{category}</span></>}
        </div>
      </div>

      {/* Source + time */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2, flexShrink: 0 }}>
        <span style={{
          fontSize: 10, padding: '1px 6px', borderRadius: 8, fontWeight: 500,
          backgroundColor: isAgent ? C.accentDim : '#F1F5F9',
          color: isAgent ? C.accent : C.muted,
          border: `1px solid ${isAgent ? C.accentBorder : C.border}`,
          display: 'inline-flex', alignItems: 'center', gap: 3,
        }}>
          {isAgent ? <Bot size={8} /> : <User size={8} />}
          {isAgent ? `Agent` : exec.source || 'manual'}
        </span>
        <span style={{ fontSize: 10, color: C.dim }}>{timeAgo(exec.created_at)}</span>
      </div>

      <ChevronRight size={13} color={C.dim} style={{ flexShrink: 0 }} />
    </div>
  );
};

// ── Rich text renderer (URLs → links/images) ─────────────────────────────────

const URL_REGEX = /(https?:\/\/[^\s,|"'<>]+)/g;
const IMAGE_EXTENSIONS = /\.(jpg|jpeg|png|gif|webp|svg)(\?.*)?$/i;

function RichText({ text, style }: { text: string; style?: React.CSSProperties }) {
  const parts = text.split(URL_REGEX);
  const images: string[] = [];
  const nodes = parts.map((part, i) => {
    if (URL_REGEX.test(part)) {
      URL_REGEX.lastIndex = 0;
      if (IMAGE_EXTENSIONS.test(part)) {
        images.push(part);
        return null; // rendered below
      }
      return (
        <a key={i} href={part} target="_blank" rel="noopener noreferrer"
          style={{ color: C.accent, textDecoration: 'underline', wordBreak: 'break-all' }}>
          {part}
        </a>
      );
    }
    return <span key={i}>{part}</span>;
  });

  return (
    <div>
      <p style={{ margin: 0, ...style }}>{nodes}</p>
      {images.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 10 }}>
          {images.map((src, i) => (
            <a key={i} href={src} target="_blank" rel="noopener noreferrer">
              <img src={src} alt="attachment" style={{
                maxWidth: '100%', maxHeight: 220, borderRadius: 5,
                border: `1px solid ${C.border}`, objectFit: 'cover',
              }}
              onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
              />
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Detail Panel (right side) ─────────────────────────────────────────────────

const DetailPanel: React.FC<{
  exec: ActionExecution;
  mode: 'pending' | 'history';
  onConfirm: (id: string) => void;
  onReject: (id: string, reason: string) => void;
}> = ({ exec, mode, onConfirm, onReject }) => {
  const [rejecting, setRejecting] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [acting, setActing] = useState(false);
  const { t } = useTranslation();

  const sev  = getSeverity(exec);
  const sc   = severityColor(sev);
  const inputs = (exec.inputs || {}) as Record<string, unknown>;
  const title       = inputs.title as string | undefined;
  const reason      = inputs.reason as string | undefined;
  const description = inputs.description as string | undefined;
  const location    = inputs.location as string | undefined;
  const category    = inputs.category as string | undefined;
  // Collect flat rec_* fields into a structured metadata object
  const REC_LABELS: Record<string, string> = {
    rec_complaint_id: 'ID',
    rec_tipo_alerta:  'Alert Type',
    rec_alerta_calle: 'Street / Tweet',
    rec_latitud:      'Latitude',
    rec_longitud:     'Longitude',
    rec_fecha:        'Date',
    rec_hora:         'Time',
    // legacy nested object support
    record_data:      '',
  };
  const recFields = Object.entries(inputs).filter(([k]) => k.startsWith('rec_'));
  const recordData = inputs.record_data as Record<string, unknown> | undefined;
  const hasMetadata = recFields.length > 0 || (recordData && Object.keys(recordData).length > 0);

  // Detect lat/long for map widget — search all input fields
  const allFields: Record<string, unknown> = { ...inputs, ...(recordData || {}) };
  const findCoord = (patterns: string[]) => {
    const key = Object.keys(allFields).find(k =>
      patterns.some(p => k.toLowerCase().includes(p))
    );
    return key ? parseFloat(String(allFields[key])) : null;
  };
  const mapLat = findCoord(['latitud', 'latitude', '_lat', 'lat_']);
  const mapLon = findCoord(['longitud', 'longitude', '_lon', '_lng', 'lon_', 'lng_']);
  const hasMap = mapLat !== null && mapLon !== null && !isNaN(mapLat) && !isNaN(mapLon);

  // Fields shown elsewhere — excluded from the bottom "proposed inputs" table
  const SHOWN_INLINE = new Set([
    'title', 'reason', 'description', 'location', 'record_data',
    ...recFields.map(([k]) => k),
  ]);
  const displayFields = Object.entries(inputs).filter(([k]) => !SHOWN_INLINE.has(k));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>

      {/* Detail header */}
      <div style={{
        padding: '18px 24px 14px', borderBottom: `1px solid ${C.border}`,
        backgroundColor: C.panel, flexShrink: 0,
      }}>
        {sev && (
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 5, marginBottom: 8,
            fontSize: 11, fontWeight: 700, padding: '3px 8px', borderRadius: 4, textTransform: 'uppercase',
            backgroundColor: sc.bg, color: sc.text, border: `1px solid ${sc.border}`,
          }}>
            {severityIcon(sev)} {t(`humanActions.severity.${sev}`, sev)} {t('common.status', 'severity').toLowerCase()}
          </div>
        )}
        <div style={{ fontSize: 16, fontWeight: 700, color: C.text, marginBottom: 4 }}>
          {title || exec.action_name}
        </div>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ fontSize: 12, fontFamily: 'monospace', color: C.accent,
            backgroundColor: C.accentDim, padding: '2px 8px', borderRadius: 4, border: `1px solid ${C.accentBorder}` }}>
            {exec.action_name}
          </span>
          {category && (
            <span style={{ fontSize: 12, color: C.muted, backgroundColor: C.bg,
              padding: '2px 8px', borderRadius: 4, border: `1px solid ${C.border}` }}>
              {category}
            </span>
          )}
          <span style={{ fontSize: 11, color: C.dim }}>
            {exec.created_at ? new Date(exec.created_at).toLocaleString() : ''}
          </span>
        </div>
      </div>

      {/* Scrollable body */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 20 }}>

        {/* Source */}
        <section>
          <div style={{ fontSize: 11, fontWeight: 700, color: C.dim, textTransform: 'uppercase',
            letterSpacing: '0.07em', marginBottom: 8 }}>{t('humanActions.proposedBy')}</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px',
            backgroundColor: C.bg, borderRadius: 6, border: `1px solid ${C.border}` }}>
            {exec.source === 'agent' ? <Bot size={16} color={C.accent} /> : <User size={16} color={C.muted} />}
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: C.text }}>
                {exec.source === 'agent' ? t('humanActions.aiAgent') : exec.source || 'Manual'}
              </div>
              {exec.source_id && (
                <div style={{ fontSize: 11, color: C.dim, fontFamily: 'monospace' }}>{exec.source_id}</div>
              )}
            </div>
          </div>
        </section>

        {/* Source record / original complaint */}
        {(hasMetadata || description || reason) && (
          <section>
            <div style={{ fontSize: 11, fontWeight: 700, color: C.dim, textTransform: 'uppercase',
              letterSpacing: '0.07em', marginBottom: 8 }}>{t('humanActions.sourceRecord')}</div>
            <div style={{
              backgroundColor: '#FAFBFC', borderRadius: 6,
              border: `1px solid ${C.border}`, borderLeft: `3px solid ${C.navy}`,
              overflow: 'hidden',
            }}>
              {/* Location bar */}
              {location && (
                <div style={{ padding: '8px 14px', borderBottom: `1px solid ${C.borderLight}`,
                  fontSize: 11, fontWeight: 600, color: C.navy,
                  display: 'flex', alignItems: 'center', gap: 5,
                  backgroundColor: 'rgba(26,60,110,0.04)',
                }}>
                  <span>📍</span> {location}
                </div>
              )}

              {/* Flat rec_* fields (primary path for new proposals) */}
              {recFields.length > 0 && (() => {
                const rows = recFields.filter(([k]) => k !== 'rec_complaint_id' || true);
                return (
                  <div>
                    {rows.map(([k, v], i) => {
                      const label = REC_LABELS[k] || k.replace(/^rec_/, '').replace(/_/g, ' ');
                      const isUrl = typeof v === 'string' && (v.startsWith('http://') || v.startsWith('https://'));
                      const isImg = isUrl && /\.(jpg|jpeg|png|gif|webp)(\?.*)?$/i.test(v as string);
                      return (
                        <div key={k} style={{
                          display: 'flex', padding: '7px 14px', fontSize: 12,
                          backgroundColor: i % 2 === 0 ? '#FAFBFC' : C.panel,
                          borderBottom: i < rows.length - 1 ? `1px solid ${C.borderLight}` : 'none',
                          alignItems: isImg ? 'flex-start' : 'center',
                        }}>
                          <div style={{ width: 130, flexShrink: 0, fontSize: 11, fontWeight: 600,
                            color: C.muted, fontFamily: 'monospace', textTransform: 'capitalize' }}>
                            {label}
                          </div>
                          <div style={{ flex: 1, color: C.text, wordBreak: 'break-word', fontSize: 12 }}>
                            {isImg ? (
                              <a href={v as string} target="_blank" rel="noopener noreferrer">
                                <img src={v as string} alt={label} style={{
                                  maxWidth: '100%', maxHeight: 180, borderRadius: 4,
                                  border: `1px solid ${C.border}`, objectFit: 'cover',
                                }} onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }} />
                              </a>
                            ) : isUrl ? (
                              <a href={v as string} target="_blank" rel="noopener noreferrer"
                                style={{ color: C.accent, textDecoration: 'underline', wordBreak: 'break-all' }}>
                                {v as string}
                              </a>
                            ) : (
                              <span>{v === null || v === undefined ? '—' : String(v)}</span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                );
              })()}

              {/* Legacy: nested record_data object */}
              {!recFields.length && recordData && Object.keys(recordData).length > 0 && (
                <div>
                  {Object.entries(recordData).map(([k, v], i, arr) => {
                    const isUrl = typeof v === 'string' && (v.startsWith('http://') || v.startsWith('https://'));
                    const isImg = isUrl && /\.(jpg|jpeg|png|gif|webp)(\?.*)?$/i.test(v as string);
                    return (
                      <div key={k} style={{
                        display: 'flex', padding: '7px 14px', fontSize: 12,
                        backgroundColor: i % 2 === 0 ? '#FAFBFC' : C.panel,
                        borderBottom: i < arr.length - 1 ? `1px solid ${C.borderLight}` : 'none',
                        alignItems: isImg ? 'flex-start' : 'center',
                      }}>
                        <div style={{ width: 130, flexShrink: 0, fontSize: 11, fontWeight: 600,
                          color: C.muted, fontFamily: 'monospace' }}>{k}</div>
                        <div style={{ flex: 1, color: C.text, wordBreak: 'break-word', fontSize: 12 }}>
                          {isImg ? (
                            <a href={v as string} target="_blank" rel="noopener noreferrer">
                              <img src={v as string} alt={k} style={{
                                maxWidth: '100%', maxHeight: 180, borderRadius: 4,
                                border: `1px solid ${C.border}`, objectFit: 'cover',
                              }} onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }} />
                            </a>
                          ) : isUrl ? (
                            <a href={v as string} target="_blank" rel="noopener noreferrer"
                              style={{ color: C.accent, textDecoration: 'underline' }}>{v as string}</a>
                          ) : (
                            <span>{v === null || v === undefined ? '—' : String(v)}</span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Fallback: plain description when no structured fields */}
              {!hasMetadata && (description || reason) && (
                <div style={{ padding: '14px 16px' }}>
                  <RichText
                    text={description || reason || ''}
                    style={{ fontSize: 13, color: C.text, lineHeight: 1.65, whiteSpace: 'pre-wrap' }}
                  />
                </div>
              )}

              {/* Description summary below the table */}
              {hasMetadata && description && (
                <div style={{ padding: '10px 14px', borderTop: `1px solid ${C.borderLight}`,
                  fontSize: 12.5, color: C.muted, lineHeight: 1.6, fontStyle: 'italic' }}>
                  {description}
                </div>
              )}
            </div>
          </section>
        )}

        {/* Map widget — auto-shown when lat/long detected */}
        {hasMap && (
          <MapWidget lat={mapLat!} lon={mapLon!} />
        )}

        {/* Agent reasoning (why it was flagged) */}
        {exec.reasoning && (
          <section>
            <div style={{ fontSize: 11, fontWeight: 700, color: C.dim, textTransform: 'uppercase',
              letterSpacing: '0.07em', marginBottom: 8 }}>{t('humanActions.whyFlagged')}</div>
            <div style={{
              padding: '12px 16px', backgroundColor: C.accentDim, borderRadius: 6,
              border: `1px solid ${C.accentBorder}`, borderLeft: `3px solid ${C.accent}`,
            }}>
              <p style={{ fontSize: 13, color: C.text, margin: 0, lineHeight: 1.6 }}>
                {exec.reasoning}
              </p>
            </div>
          </section>
        )}

        {/* Proposed changes (inputs as structured table) */}
        <section>
          <div style={{ fontSize: 11, fontWeight: 700, color: C.dim, textTransform: 'uppercase',
            letterSpacing: '0.07em', marginBottom: 8 }}>{t('humanActions.proposedInputs')}</div>
          <div style={{ border: `1px solid ${C.border}`, borderRadius: 6, overflow: 'hidden' }}>
            {displayFields.length === 0 ? (
              <div style={{ padding: '12px 16px', fontSize: 12, color: C.dim }}>No inputs</div>
            ) : (
              displayFields.map(([k, v], i) => (
                <div key={k} style={{
                  display: 'flex', padding: '9px 14px', fontSize: 12,
                  backgroundColor: i % 2 === 0 ? C.panel : C.bg,
                  borderBottom: i < displayFields.length - 1 ? `1px solid ${C.borderLight}` : 'none',
                }}>
                  <div style={{ width: 160, flexShrink: 0, fontWeight: 600, color: C.muted, fontFamily: 'monospace', fontSize: 11 }}>
                    {k}
                  </div>
                  <div style={{ color: C.text, fontFamily: typeof v === 'object' ? 'monospace' : 'inherit',
                    fontSize: typeof v === 'object' ? 11 : 12, wordBreak: 'break-word' }}>
                    {typeof v === 'object' ? JSON.stringify(v, null, 2) : String(v ?? '')}
                  </div>
                </div>
              ))
            )}
          </div>
        </section>

        {/* Outcome (history only) */}
        {mode === 'history' && (
          <section>
            <div style={{ fontSize: 11, fontWeight: 700, color: C.dim, textTransform: 'uppercase',
              letterSpacing: '0.07em', marginBottom: 8 }}>{t('humanActions.outcome')}</div>
            {exec.status === 'completed' ? (
              <div style={{ padding: '12px 16px', backgroundColor: C.successDim, borderRadius: 6,
                border: `1px solid ${C.successBorder}`, display: 'flex', alignItems: 'center', gap: 8 }}>
                <CheckCircle size={16} color={C.success} />
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: C.success }}>{t('humanActions.approved')}</div>
                  {exec.confirmed_by && (
                    <div style={{ fontSize: 11, color: C.muted }}>by {exec.confirmed_by}</div>
                  )}
                </div>
              </div>
            ) : (
              <div style={{ padding: '12px 16px', backgroundColor: C.errorDim, borderRadius: 6,
                border: `1px solid ${C.errorBorder}`, display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                <XCircle size={16} color={C.error} style={{ marginTop: 1 }} />
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: C.error }}>{t('humanActions.rejected')}</div>
                  {exec.rejection_reason && (
                    <div style={{ fontSize: 12, color: C.text, marginTop: 2 }}>{exec.rejection_reason}</div>
                  )}
                  {exec.rejected_by && (
                    <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>by {exec.rejected_by}</div>
                  )}
                </div>
              </div>
            )}
          </section>
        )}
      </div>

      {/* Action bar (pending only) */}
      {mode === 'pending' && (
        <div style={{
          flexShrink: 0, borderTop: `1px solid ${C.border}`,
          backgroundColor: C.panel, padding: '14px 24px',
        }}>
          {!rejecting ? (
            <div style={{ display: 'flex', gap: 10 }}>
              <button
                disabled={acting}
                onClick={() => { setActing(true); onConfirm(exec.id); }}
                style={{
                  flex: 1, height: 38, fontSize: 13, fontWeight: 600, borderRadius: 5, cursor: acting ? 'default' : 'pointer',
                  backgroundColor: C.success, border: 'none', color: '#FFF',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7,
                  opacity: acting ? 0.6 : 1,
                }}
              >
                <CheckCircle size={15} /> {t('common.approve')}
              </button>
              <button
                disabled={acting}
                onClick={() => setRejecting(true)}
                style={{
                  flex: 1, height: 38, fontSize: 13, fontWeight: 600, borderRadius: 5, cursor: acting ? 'default' : 'pointer',
                  backgroundColor: C.errorDim, border: `1px solid ${C.errorBorder}`, color: C.error,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7,
                  opacity: acting ? 0.6 : 1,
                }}
              >
                <XCircle size={15} /> {t('common.reject')}
              </button>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: C.error }}>{t('humanActions.rejectReason')}</div>
              <textarea
                autoFocus
                value={rejectReason}
                onChange={e => setRejectReason(e.target.value)}
                placeholder={t('humanActions.rejectPlaceholder')}
                rows={3}
                style={{
                  width: '100%', padding: '8px 10px', fontSize: 12, borderRadius: 5,
                  border: `1px solid ${C.errorBorder}`, outline: 'none', color: C.text,
                  backgroundColor: C.errorDim, resize: 'none', boxSizing: 'border-box',
                }}
              />
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  disabled={!rejectReason.trim() || acting}
                  onClick={() => { setActing(true); onReject(exec.id, rejectReason); setRejecting(false); }}
                  style={{
                    flex: 1, height: 36, fontSize: 13, fontWeight: 600, borderRadius: 5,
                    cursor: rejectReason.trim() ? 'pointer' : 'default',
                    backgroundColor: C.error, border: 'none', color: '#FFF',
                    opacity: rejectReason.trim() ? 1 : 0.5,
                  }}
                >
                  {t('humanActions.confirmReject')}
                </button>
                <button
                  onClick={() => { setRejecting(false); setRejectReason(''); }}
                  style={{
                    height: 36, padding: '0 16px', fontSize: 13, borderRadius: 5, cursor: 'pointer',
                    backgroundColor: 'transparent', border: `1px solid ${C.border}`, color: C.muted,
                  }}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

// ── Action Definition Form ────────────────────────────────────────────────────

const DEFAULT_SCHEMA = `{
  "type": "object",
  "required": [],
  "properties": {}
}`;

const ActionForm: React.FC<{
  initial?: ActionDefinition;
  onSave: (def: ActionDefinition) => void;
  onCancel: () => void;
}> = ({ initial, onSave, onCancel }) => {
  const [name, setName]               = useState(initial?.name ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [schemaText, setSchemaText]   = useState(
    initial?.input_schema ? JSON.stringify(initial.input_schema, null, 2) : DEFAULT_SCHEMA
  );
  const [requiresConf, setRequiresConf] = useState(initial?.requires_confirmation ?? true);
  const [enabled, setEnabled]           = useState(initial?.enabled ?? true);
  const [notifyEmail, setNotifyEmail]   = useState(initial?.notify_email ?? '');
  const [schemaErr, setSchemaErr]       = useState('');
  const [saving, setSaving]             = useState(false);
  const [err, setErr]                   = useState('');
  const isEdit = !!initial;

  const handleSave = async () => {
    setSchemaErr(''); setErr('');
    let parsed: Record<string, unknown> = {};
    try { parsed = JSON.parse(schemaText); } catch {
      setSchemaErr('Invalid JSON'); return;
    }
    setSaving(true);
    try {
      const body = {
        name, description, input_schema: parsed,
        requires_confirmation: requiresConf, enabled,
        notify_email: notifyEmail.trim() || null,
        allowed_roles: [], writes_to_object_type: null,
      };
      const url = isEdit ? `${ONTOLOGY_API}/actions/${initial!.name}` : `${ONTOLOGY_API}/actions`;
      const res = await fetch(url, {
        method: isEdit ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json', 'x-tenant-id': getTenantId() },
        body: JSON.stringify(body),
      });
      if (!res.ok) { const t = await res.text(); setErr(t); return; }
      onSave(await res.json());
    } catch (e) {
      setErr(String(e));
    } finally {
      setSaving(false);
    }
  };

  const inp = (val: string, onChange: (v: string) => void, placeholder = '') => (
    <input value={val} onChange={e => onChange(e.target.value)} placeholder={placeholder}
      style={{ width: '100%', padding: '7px 10px', fontSize: 12.5, borderRadius: 5,
        border: `1px solid ${C.border}`, outline: 'none', color: C.text,
        backgroundColor: C.panel, boxSizing: 'border-box' }} />
  );

  const label = (text: string) => (
    <div style={{ fontSize: 11, fontWeight: 700, color: C.dim, marginBottom: 5,
      textTransform: 'uppercase', letterSpacing: '0.06em' }}>{text}</div>
  );

  return (
    <div style={{ backgroundColor: C.panel, border: `1px solid ${C.border}`, borderRadius: 8,
      padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ fontSize: 14, fontWeight: 700, color: C.text, display: 'flex', alignItems: 'center', gap: 8 }}>
        <Shield size={15} color={C.accent} />
        {isEdit ? `Edit: ${initial!.name}` : 'New Action Definition'}
      </div>

      <div>
        {label('Action name (unique slug)')}
        {inp(name, setName, 'e.g. urgent_alert')}
      </div>
      <div>
        {label('Description')}
        {inp(description, setDescription, 'What does this action do?')}
      </div>
      <div>
        {label('Input Schema (JSON Schema)')}
        <textarea value={schemaText} onChange={e => { setSchemaText(e.target.value); setSchemaErr(''); }}
          rows={10} style={{
            width: '100%', padding: '8px 10px', fontSize: 11.5, borderRadius: 5,
            border: `1px solid ${schemaErr ? C.error : C.border}`, outline: 'none',
            color: '#E2E8F0', backgroundColor: '#0D1117', fontFamily: 'monospace',
            resize: 'vertical', boxSizing: 'border-box', lineHeight: 1.6,
          } as React.CSSProperties} />
        {schemaErr && <div style={{ fontSize: 11, color: C.error, marginTop: 3 }}>{schemaErr}</div>}
      </div>
      <div style={{ display: 'flex', gap: 20 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13, color: C.text }}>
          <input type="checkbox" checked={requiresConf} onChange={e => setRequiresConf(e.target.checked)}
            style={{ accentColor: C.accent, width: 15, height: 15 }} />
          Requires human approval
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13, color: C.text }}>
          <input type="checkbox" checked={enabled} onChange={e => setEnabled(e.target.checked)}
            style={{ accentColor: C.accent, width: 15, height: 15 }} />
          Enabled
        </label>
      </div>
      <div>
        {label('Notify email on approval (optional)')}
        {inp(notifyEmail, setNotifyEmail, 'e.g. ops-team@company.com')}
        <div style={{ fontSize: 10, color: C.dim, marginTop: 3 }}>
          An email is sent to this address when a human approves this action.
        </div>
      </div>
      {err && <div style={{ fontSize: 12, color: C.error, padding: '8px 12px', backgroundColor: C.errorDim,
        borderRadius: 4, border: `1px solid ${C.errorBorder}` }}>{err}</div>}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button onClick={onCancel} style={{ height: 34, padding: '0 16px', fontSize: 12, cursor: 'pointer',
          backgroundColor: 'transparent', border: `1px solid ${C.border}`, color: C.muted, borderRadius: 5 }}>
          Cancel
        </button>
        <button onClick={handleSave} disabled={saving || !name.trim()} style={{
          height: 34, padding: '0 20px', fontSize: 12, fontWeight: 600, cursor: saving ? 'default' : 'pointer',
          backgroundColor: C.accent, border: 'none', color: '#FFF', borderRadius: 5,
          opacity: saving || !name.trim() ? 0.6 : 1,
        }}>
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  );
};

// ── Actions catalog tab ───────────────────────────────────────────────────────

const ActionsTab: React.FC = () => {
  const [defs, setDefs]         = useState<ActionDefinition[]>([]);
  const [editing, setEditing]   = useState<ActionDefinition | null | 'new'>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [loading, setLoading]   = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(`${ONTOLOGY_API}/actions`, { headers: { 'x-tenant-id': getTenantId() } });
      if (r.ok) setDefs(await r.json());
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleToggle = async (def: ActionDefinition) => {
    await fetch(`${ONTOLOGY_API}/actions/${def.name}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json', 'x-tenant-id': getTenantId() },
      body: JSON.stringify({ ...def, enabled: !def.enabled }),
    });
    load();
  };

  const handleDelete = async (name: string) => {
    if (!window.confirm(`Delete action "${name}"?`)) return;
    setDeleting(name);
    await fetch(`${ONTOLOGY_API}/actions/${name}`, { method: 'DELETE', headers: { 'x-tenant-id': getTenantId() } });
    setDeleting(null);
    load();
  };

  return (
    <div style={{ padding: 24, maxWidth: 860 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 700, color: C.text }}>Action Catalog</div>
          <div style={{ fontSize: 12, color: C.muted, marginTop: 2 }}>
            Define what operations agents are allowed to propose for human review.
          </div>
        </div>
        <button onClick={() => setEditing('new')} style={{
          height: 34, padding: '0 14px', fontSize: 12.5, fontWeight: 600, cursor: 'pointer',
          backgroundColor: C.accent, border: 'none', color: '#FFF', borderRadius: 5,
          display: 'flex', alignItems: 'center', gap: 6,
        }}>
          <Plus size={13} /> New Action
        </button>
      </div>

      {editing === 'new' && (
        <div style={{ marginBottom: 16 }}>
          <ActionForm onSave={() => { setEditing(null); load(); }} onCancel={() => setEditing(null)} />
        </div>
      )}

      {loading && <div style={{ color: C.dim, fontSize: 13 }}>Loading…</div>}

      {!loading && defs.length === 0 && editing !== 'new' && (
        <div style={{ textAlign: 'center', paddingTop: 40, color: C.dim }}>
          <Shield size={36} color={C.border} style={{ display: 'block', margin: '0 auto 12px' }} />
          <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>No actions defined</div>
          <div style={{ fontSize: 12, marginBottom: 16 }}>Create your first action to let agents propose write operations.</div>
          <button onClick={() => setEditing('new')} style={{
            height: 34, padding: '0 16px', fontSize: 12.5, fontWeight: 600, cursor: 'pointer',
            backgroundColor: C.accent, border: 'none', color: '#FFF', borderRadius: 5,
          }}>
            Create first action
          </button>
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {defs.map(def => (
          editing && (editing as ActionDefinition).name === def.name ? (
            <ActionForm key={def.name} initial={def}
              onSave={() => { setEditing(null); load(); }}
              onCancel={() => setEditing(null)} />
          ) : (
            <div key={def.name} style={{
              backgroundColor: C.panel, border: `1px solid ${C.border}`, borderRadius: 8,
              padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 12,
            }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
                  <span style={{ fontSize: 13, fontWeight: 700, color: C.text, fontFamily: 'monospace' }}>{def.name}</span>
                  <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 10, fontWeight: 600,
                    backgroundColor: def.enabled ? C.successDim : C.bg,
                    color: def.enabled ? C.success : C.dim,
                    border: `1px solid ${def.enabled ? C.successBorder : C.border}` }}>
                    {def.enabled ? 'enabled' : 'disabled'}
                  </span>
                  {def.requires_confirmation && (
                    <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 10, fontWeight: 600,
                      backgroundColor: C.warnDim, color: C.warn, border: `1px solid ${C.warnBorder}` }}>
                      requires approval
                    </span>
                  )}
                </div>
                {def.description && (
                  <div style={{ fontSize: 12, color: C.muted }}>{def.description}</div>
                )}
                {def.notify_email && (
                  <div style={{ fontSize: 11, color: C.dim, marginTop: 2 }}>
                    Notifies: {def.notify_email}
                  </div>
                )}
              </div>
              <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                <button onClick={() => handleToggle(def)} title={def.enabled ? 'Disable' : 'Enable'}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', lineHeight: 0, color: def.enabled ? C.success : C.dim }}>
                  {def.enabled ? <ToggleRight size={22} /> : <ToggleLeft size={22} />}
                </button>
                <button onClick={() => setEditing(def)} title="Edit"
                  style={{ background: 'none', border: `1px solid ${C.border}`, borderRadius: 4,
                    cursor: 'pointer', color: C.muted, padding: '4px 8px', lineHeight: 0 }}>
                  <Edit2 size={13} />
                </button>
                <button onClick={() => handleDelete(def.name)} disabled={deleting === def.name} title="Delete"
                  style={{ background: 'none', border: `1px solid ${C.errorBorder}`, borderRadius: 4,
                    cursor: 'pointer', color: C.error, padding: '4px 8px', lineHeight: 0 }}>
                  <Trash2 size={13} />
                </button>
              </div>
            </div>
          )
        ))}
      </div>
    </div>
  );
};

// ── Main HumanActions page ─────────────────────────────────────────────────────

export const HumanActions: React.FC = () => {
  const { pending, history, loading, pendingCount, fetchPending, fetchHistory, confirm, reject, bulkConfirm, bulkReject } =
    useHumanActionsStore();
  const { t } = useTranslation();
  const { setBreadcrumbs } = useNavigationStore();
  const [tab, setTab]         = useState<'pending' | 'history' | 'actions'>('pending');
  const [selected, setSelected] = useState<ActionExecution | null>(null);
  const [filterSeverity, setFilterSeverity] = useState<string>('all');
  const [filterText, setFilterText] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkLoading, setBulkLoading] = useState(false);
  const [dedupRunning, setDedupRunning] = useState(false);
  const [dedupResult, setDedupResult]   = useState<{ text: string; ok: boolean } | null>(null);

  useEffect(() => {
    fetchPending();
    setBreadcrumbs([{ label: 'Actions' }]);
  }, []);
  useEffect(() => { if (tab === 'history') fetchHistory(); }, [tab]);
  useEffect(() => {
    setSelected(null);
    setSelectedIds(new Set());
    const tabLabel = tab === 'pending' ? 'Queue' : tab === 'history' ? 'History' : 'Catalog';
    setBreadcrumbs([{ label: 'Actions', page: 'human-actions' }, { label: tabLabel }]);
  }, [tab]);

  const handleDeduplicate = async () => {
    setDedupRunning(true);
    setDedupResult(null);
    try {
      // Resolve agent ID by name for the current tenant
      const listRes = await fetch(`${AGENT_API}/agents`, { headers: { 'x-tenant-id': getTenantId() } });
      const agents: { id: string; name: string }[] = listRes.ok ? await listRes.json() : [];
      const agent = agents.find(a => a.name === DEDUP_AGENT_NAME);
      if (!agent) {
        setDedupResult({ text: `Agent "${DEDUP_AGENT_NAME}" not found for this tenant.`, ok: false });
        return;
      }
      const res = await fetch(`${AGENT_API}/agents/${agent.id}/test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-tenant-id': getTenantId() },
        body: JSON.stringify({ message: 'Deduplicate all pending human action executions now.', dry_run: false }),
      });
      if (res.ok) {
        const data = await res.json();
        const text = data.response || data.result || 'Deduplication complete.';
        setDedupResult({ text, ok: true });
        fetchPending();
      } else {
        setDedupResult({ text: `Error ${res.status}: ${await res.text()}`, ok: false });
      }
    } catch (e: unknown) {
      setDedupResult({ text: String(e), ok: false });
    } finally {
      setDedupRunning(false);
    }
  };

  const handleConfirm = (id: string) => confirm(id, 'admin');
  const handleReject  = (id: string, reason: string) => reject(id, 'admin', reason || 'No reason provided');

  const items = tab === 'pending' ? pending : history;

  const filteredItems = items.filter(e => {
    if (filterSeverity !== 'all') {
      const sev = getSeverity(e);
      if (sev !== filterSeverity) return false;
    }
    if (filterText.trim()) {
      const q = filterText.toLowerCase();
      const title = ((e.inputs as Record<string, unknown>)?.title as string || '').toLowerCase();
      if (!e.action_name.toLowerCase().includes(q) && !title.includes(q)) return false;
    }
    return true;
  });

  const handleBulkConfirm = async () => {
    setBulkLoading(true);
    const ids = Array.from(selectedIds);
    await bulkConfirm(ids, 'admin');
    setSelectedIds(new Set());
    setBulkLoading(false);
  };

  const handleBulkReject = async () => {
    setBulkLoading(true);
    const ids = Array.from(selectedIds);
    await bulkReject(ids, 'admin', 'Bulk rejected');
    setSelectedIds(new Set());
    setBulkLoading(false);
  };

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const selectAll = () => {
    if (selectedIds.size === filteredItems.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredItems.map(e => e.id)));
    }
  };

  const TABS = [
    { id: 'pending', label: t('humanActions.queue'),   icon: <Inbox size={13} />, count: pendingCount },
    { id: 'history', label: t('humanActions.history'), icon: <History size={13} /> },
    { id: 'actions', label: t('humanActions.catalog'), icon: <Settings size={13} /> },
  ] as const;

  const severities = ['all', 'critical', 'high', 'medium', 'low'];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', backgroundColor: C.bg }}>

      {/* Top bar */}
      <div style={{
        height: 50, backgroundColor: C.navy, borderBottom: `1px solid #0A2240`,
        display: 'flex', alignItems: 'center', padding: '0 20px', gap: 16, flexShrink: 0,
      }}>
        <h1 style={{ fontSize: 14, fontWeight: 700, color: '#FFFFFF', margin: 0, letterSpacing: '0.01em' }}>
          {t('humanActions.title')}
        </h1>
        {pendingCount > 0 && (
          <span style={{
            fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 10,
            backgroundColor: C.error, color: '#FFF', minWidth: 20, textAlign: 'center',
          }}>
            {pendingCount}
          </span>
        )}

        {/* Tabs */}
        <div style={{ display: 'flex', gap: 2, marginLeft: 8 }}>
          {TABS.map(tab_ => (
            <button key={tab_.id} onClick={() => setTab(tab_.id)} style={{
              height: 30, padding: '0 14px', borderRadius: 4,
              border: 'none',
              backgroundColor: tab === tab_.id ? 'rgba(255,255,255,0.15)' : 'transparent',
              color: tab === tab_.id ? '#FFFFFF' : 'rgba(255,255,255,0.55)',
              fontSize: 12.5, fontWeight: tab === tab_.id ? 700 : 400,
              cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6,
            }}>
              {tab_.icon}
              {tab_.label}
              {'count' in tab_ && tab_.count > 0 && (
                <span style={{
                  fontSize: 10, fontWeight: 700, backgroundColor: C.error,
                  color: '#FFF', borderRadius: 8, padding: '0 5px', minWidth: 16, textAlign: 'center',
                }}>
                  {tab_.count}
                </span>
              )}
            </button>
          ))}
        </div>

        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
          {tab === 'pending' && (
            <button
              onClick={handleDeduplicate}
              disabled={dedupRunning}
              style={{
                height: 28, padding: '0 12px', borderRadius: 4,
                border: `1px solid rgba(255,255,255,0.25)`,
                backgroundColor: dedupRunning ? 'rgba(255,255,255,0.05)' : 'rgba(255,255,255,0.1)',
                color: dedupRunning ? 'rgba(255,255,255,0.35)' : 'rgba(255,255,255,0.85)',
                fontSize: 12, cursor: dedupRunning ? 'default' : 'pointer',
                display: 'flex', alignItems: 'center', gap: 5, fontWeight: 500,
              }}
            >
              <Layers size={13} />
              {dedupRunning ? 'Running…' : 'Deduplicate'}
            </button>
          )}
          <button onClick={() => { fetchPending(); if (tab === 'history') fetchHistory(); }}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'rgba(255,255,255,0.55)',
              display: 'flex', alignItems: 'center', gap: 5, fontSize: 12 }}>
            <RefreshCw size={13} /> {t('common.refresh')}
          </button>
        </div>
      </div>

      {/* Dedup result toast */}
      {dedupResult && (
        <div style={{
          padding: '10px 20px', fontSize: 12.5, lineHeight: 1.5,
          backgroundColor: dedupResult.ok ? C.successDim : C.errorDim,
          borderBottom: `1px solid ${dedupResult.ok ? C.successBorder : C.errorBorder}`,
          color: dedupResult.ok ? C.success : C.error,
          display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12,
          flexShrink: 0,
        }}>
          <pre style={{ margin: 0, fontFamily: 'monospace', whiteSpace: 'pre-wrap', flex: 1 }}>
            {dedupResult.text}
          </pre>
          <button onClick={() => setDedupResult(null)} style={{
            background: 'none', border: 'none', cursor: 'pointer',
            color: dedupResult.ok ? C.success : C.error, padding: 0, flexShrink: 0,
          }}>
            <XCircle size={14} />
          </button>
        </div>
      )}

      {/* Body */}
      {tab === 'actions' ? (
        <div style={{ flex: 1, overflowY: 'auto' }}>
          <ActionsTab />
        </div>
      ) : (
        <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>

          {/* Left: queue list */}
          <div style={{ width: 340, flexShrink: 0, borderRight: `1px solid ${C.border}`,
            backgroundColor: C.panel, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

            {/* Filter bar */}
            <div style={{ padding: '8px 12px', borderBottom: `1px solid ${C.border}`,
              display: 'flex', flexDirection: 'column', gap: 6, flexShrink: 0 }}>
              {/* Text search */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <Filter size={12} color={C.dim} style={{ flexShrink: 0 }} />
                <input
                  value={filterText}
                  onChange={e => setFilterText(e.target.value)}
                  placeholder="Search actions..."
                  style={{
                    flex: 1, height: 26, padding: '0 8px',
                    border: `1px solid ${C.border}`, borderRadius: 4,
                    fontSize: 11, backgroundColor: C.bg, color: C.text,
                    outline: 'none',
                  }}
                />
                {filterText && (
                  <button onClick={() => setFilterText('')} style={{
                    background: 'none', border: 'none', cursor: 'pointer',
                    color: C.dim, fontSize: 11, padding: 0, flexShrink: 0,
                  }}>✕</button>
                )}
              </div>
              {/* Severity pills */}
              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                {severities.map(s => (
                  <button key={s} onClick={() => setFilterSeverity(s)} style={{
                    height: 22, padding: '0 8px', borderRadius: 3, fontSize: 10.5,
                    fontWeight: filterSeverity === s ? 700 : 400, cursor: 'pointer',
                    border: `1px solid ${filterSeverity === s ? C.accent : C.border}`,
                    backgroundColor: filterSeverity === s ? C.accentDim : 'transparent',
                    color: filterSeverity === s ? C.accent : C.muted,
                  }}>
                    {s === 'all' ? t('common.all') : t(`humanActions.severity.${s}`, s)}
                  </button>
                ))}
              </div>
            </div>

            {/* Select-all bar (pending tab only) */}
            {tab === 'pending' && filteredItems.length > 0 && (
              <div style={{ padding: '6px 12px', borderBottom: `1px solid ${C.borderLight}`,
                display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0, backgroundColor: C.bg }}>
                <input
                  type="checkbox"
                  checked={selectedIds.size === filteredItems.length && filteredItems.length > 0}
                  onChange={selectAll}
                  style={{ accentColor: C.accent, cursor: 'pointer', width: 13, height: 13 }}
                />
                <span style={{ fontSize: 11, color: C.muted }}>
                  {selectedIds.size > 0 ? `${selectedIds.size} selected` : `Select all (${filteredItems.length})`}
                </span>
              </div>
            )}

            {/* Queue items */}
            <div style={{ flex: 1, overflowY: 'auto' }}>
              {loading && (
                <div style={{ padding: 20, fontSize: 12, color: C.dim, textAlign: 'center' }}>{t('common.loading')}</div>
              )}
              {!loading && filteredItems.length === 0 && (
                <div style={{ padding: 40, display: 'flex', flexDirection: 'column', alignItems: 'center',
                  justifyContent: 'center', color: C.dim, gap: 8 }}>
                  {tab === 'pending'
                    ? <><Inbox size={32} color={C.border} /><div style={{ fontSize: 13, fontWeight: 600 }}>{t('humanActions.noQueue')}</div><div style={{ fontSize: 11 }}>{t('humanActions.noPending')}</div></>
                    : <><History size={32} color={C.border} /><div style={{ fontSize: 13, fontWeight: 600 }}>{t('humanActions.noHistory')}</div></>
                  }
                </div>
              )}
              {filteredItems.map(exec => (
                <QueueRow
                  key={exec.id}
                  exec={exec}
                  selected={selected?.id === exec.id}
                  checked={selectedIds.has(exec.id)}
                  onCheck={() => toggleSelect(exec.id)}
                  onClick={() => setSelected(exec)}
                />
              ))}
            </div>

            {/* Bulk actions bar */}
            {tab === 'pending' && selectedIds.size > 1 && (
              <div style={{
                padding: '8px 12px', borderTop: `1px solid ${C.border}`,
                display: 'flex', gap: 6, alignItems: 'center', flexShrink: 0,
                backgroundColor: C.bg,
              }}>
                <span style={{ fontSize: 11, color: C.muted, flex: 1 }}>
                  {selectedIds.size} selected
                </span>
                <CheckpointGate resource_type="action_execution" operation="bulk_approve" onProceed={handleBulkConfirm}>
                  {(triggerGate, checking) => (
                    <button
                      onClick={triggerGate}
                      disabled={bulkLoading || checking}
                      style={{
                        height: 28, padding: '0 12px', fontSize: 11.5, fontWeight: 600,
                        backgroundColor: C.success, color: '#FFF', border: 'none',
                        borderRadius: 4, cursor: bulkLoading || checking ? 'default' : 'pointer',
                        opacity: bulkLoading || checking ? 0.6 : 1,
                        display: 'flex', alignItems: 'center', gap: 4,
                      }}
                    >
                      <CheckCircle size={12} /> Approve all ({selectedIds.size})
                    </button>
                  )}
                </CheckpointGate>
                <CheckpointGate resource_type="action_execution" operation="bulk_reject" onProceed={handleBulkReject}>
                  {(triggerGate, checking) => (
                    <button
                      onClick={triggerGate}
                      disabled={bulkLoading || checking}
                      style={{
                        height: 28, padding: '0 12px', fontSize: 11.5, fontWeight: 600,
                        backgroundColor: 'transparent', color: C.error,
                        border: `1px solid ${C.errorBorder}`, borderRadius: 4,
                        cursor: bulkLoading || checking ? 'default' : 'pointer',
                        opacity: bulkLoading || checking ? 0.6 : 1,
                        display: 'flex', alignItems: 'center', gap: 4,
                      }}
                    >
                      <XCircle size={12} /> Reject all ({selectedIds.size})
                    </button>
                  )}
                </CheckpointGate>
              </div>
            )}
          </div>

          {/* Right: detail panel */}
          <div style={{ flex: 1, overflow: 'hidden', backgroundColor: C.bg }}>
            {selected ? (
              <DetailPanel
                exec={selected}
                mode={tab}
                onConfirm={handleConfirm}
                onReject={handleReject}
              />
            ) : (
              <div style={{ height: '100%', display: 'flex', flexDirection: 'column',
                alignItems: 'center', justifyContent: 'center', color: C.dim, gap: 8 }}>
                <Clock size={40} color={C.border} />
                <div style={{ fontSize: 14, fontWeight: 600, color: C.muted }}>
                  {tab === 'pending' ? 'Select an item to review' : 'Select an item to view details'}
                </div>
                <div style={{ fontSize: 12 }}>
                  {filteredItems.length} item{filteredItems.length !== 1 ? 's' : ''} in {tab === 'pending' ? 'queue' : 'history'}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default HumanActions;
