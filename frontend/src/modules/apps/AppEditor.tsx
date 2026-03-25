/**
 * AppEditor — full low-code / no-code / code app builder.
 *
 *  VIEW  : read-only live canvas
 *  EDIT  : three-panel builder
 *           Left  — widget palette + ontology browser (object types + fields)
 *           Centre — live-rendered 12-col grid with selection overlay & controls
 *           Right  — config panel for the selected widget (all fields by name)
 *  CODE  : raw JSON editor for the components array with live parse
 */
import React, { useState, useEffect, useRef } from 'react';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
import GridLayoutLib from 'react-grid-layout';
const GridLayout = GridLayoutLib as any; // no types package available
type LayoutItem = { i: string; x: number; y: number; w: number; h: number; minH?: number; minW?: number; [key: string]: unknown };
import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';
import {
  Eye, Pencil, Code2, Save, Plus, Trash2,
  ChevronRight, RefreshCw,
  BarChart2, LineChart, Table, Hash, AlignLeft, Gauge, SlidersHorizontal,
  Database, Tag, MessageSquare, Sparkles, Loader,
} from 'lucide-react';
import { NexusApp, AppComponent, ComponentType, AppFilter, FilterOperator } from '../../types/app';
import { useAppStore } from '../../store/appStore';
import AppCanvas from './AppCanvas';

const ONTOLOGY_API = import.meta.env.VITE_ONTOLOGY_SERVICE_URL || 'http://localhost:8004';

// ── Types ────────────────────────────────────────────────────────────────────

interface OTProp { name: string; semantic_type?: string; data_type?: string; display_name?: string }
interface OntologyType { id: string; name: string; displayName: string; properties: OTProp[] }

// ── Hooks ─────────────────────────────────────────────────────────────────────

function useRecordsForFilter(objectTypeId?: string) {
  const [records, setRecords] = useState<Record<string, unknown>[]>([]);
  useEffect(() => {
    if (!objectTypeId) { setRecords([]); return; }
    fetch(`${ONTOLOGY_API}/object-types/${objectTypeId}/records`, {
      headers: { 'x-tenant-id': 'tenant-001' },
    })
      .then((r) => r.json())
      .then((d) => setRecords(d.records || []))
      .catch(() => setRecords([]));
  }, [objectTypeId]);
  return records;
}

function useObjectTypes() {
  const [ots, setOts] = useState<OntologyType[]>([]);
  useEffect(() => {
    fetch(`${ONTOLOGY_API}/object-types`, { headers: { 'x-tenant-id': 'tenant-001' } })
      .then((r) => r.json())
      .then((d) => setOts((d.object_types || d || []).map((o: Record<string, unknown>) => ({
        id: o.id,
        name: (o.name || o.display_name) as string,
        displayName: (o.display_name || o.name) as string,
        properties: ((o.properties || []) as OTProp[]),
      }))))
      .catch(() => {});
  }, []);
  return ots;
}

// ── Widget catalogue ──────────────────────────────────────────────────────────

const WIDGET_DEFS: { type: ComponentType; label: string; icon: React.ReactNode; defaultColSpan: number; description: string }[] = [
  { type: 'metric-card',  label: 'Metric Card',  icon: <Hash size={13} />,               defaultColSpan: 3,  description: 'Single aggregated value' },
  { type: 'kpi-banner',   label: 'KPI Banner',   icon: <Gauge size={13} />,              defaultColSpan: 12, description: 'Row of headline metrics' },
  { type: 'data-table',   label: 'Data Table',   icon: <Table size={13} />,              defaultColSpan: 12, description: 'Rows from your object type' },
  { type: 'bar-chart',    label: 'Bar Chart',    icon: <BarChart2 size={13} />,          defaultColSpan: 6,  description: 'Grouped bar chart' },
  { type: 'line-chart',   label: 'Line Chart',   icon: <LineChart size={13} />,          defaultColSpan: 6,  description: 'Time-series line chart' },
  { type: 'filter-bar',   label: 'Filter Bar',   icon: <SlidersHorizontal size={13} />,  defaultColSpan: 12, description: 'Interactive filter chips' },
  { type: 'text-block',   label: 'Text Block',   icon: <AlignLeft size={13} />,          defaultColSpan: 12, description: 'Rich text / notes' },
  { type: 'chat-widget',  label: 'Chat',         icon: <MessageSquare size={13} />,      defaultColSpan: 12, description: 'Ask questions about data with AI' },
];

const INFERENCE_API = import.meta.env.VITE_INFERENCE_SERVICE_URL || 'http://localhost:8003';

const SEMANTIC_ICON: Record<string, string> = {
  IDENTIFIER: 'ID', EMAIL: '@', PHONE: 'Tel', DATE: 'D', DATETIME: 'DT',
  CURRENCY: '$', QUANTITY: '#', STATUS: 'S', CATEGORY: 'Cat', TEXT: 'T',
  BOOLEAN: 'B', URL: 'URL', PERSON_NAME: 'P', ADDRESS: 'Loc', PERCENTAGE: '%',
};

// ── Left sidebar ──────────────────────────────────────────────────────────────

const LeftSidebar: React.FC<{
  objectTypes: OntologyType[];
  onAddWidget: (type: ComponentType, otId?: string) => void;
  onAddWidgetFromNL: (prompt: string, otId: string) => Promise<void>;
  onClickField: (field: string) => void;
}> = ({ objectTypes, onAddWidget, onAddWidgetFromNL, onClickField }) => {
  const [expandedOt, setExpandedOt] = useState<string | null>(null);
  const [nlPrompt, setNlPrompt] = useState('');
  const [nlOtId, setNlOtId] = useState('');
  const [nlLoading, setNlLoading] = useState(false);
  const [nlError, setNlError] = useState('');
  const nlRef = useRef<HTMLTextAreaElement>(null);

  const handleNlGenerate = async () => {
    if (!nlPrompt.trim() || !nlOtId) return;
    setNlLoading(true);
    setNlError('');
    try {
      await onAddWidgetFromNL(nlPrompt.trim(), nlOtId);
      setNlPrompt('');
    } catch (e: unknown) {
      setNlError(e instanceof Error ? e.message : 'Failed to generate widget');
    } finally {
      setNlLoading(false);
    }
  };

  return (
    <div style={{
      width: 220, flexShrink: 0, borderRight: '1px solid #E2E8F0',
      backgroundColor: '#F8FAFC', display: 'flex', flexDirection: 'column',
      overflowY: 'auto',
    }}>
      {/* ── AI widget generation ── */}
      <div style={{ padding: '10px 10px 8px', borderBottom: '1px solid #E2E8F0' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 6 }}>
          <Sparkles size={11} color="#7C3AED" />
          <span style={{ fontSize: 10, fontWeight: 600, color: '#7C3AED', letterSpacing: '0.06em' }}>
            AI WIDGET
          </span>
        </div>
        <textarea
          ref={nlRef}
          value={nlPrompt}
          onChange={(e) => setNlPrompt(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleNlGenerate();
          }}
          placeholder={"e.g. Deals modified this week\nor How many deals per stage"}
          rows={3}
          style={{
            width: '100%', padding: '6px 8px', boxSizing: 'border-box',
            border: '1px solid #DDD6FE', borderRadius: 5, resize: 'none',
            fontSize: 11, lineHeight: 1.5, color: '#1E1B4B', backgroundColor: '#FAF5FF',
            outline: 'none', fontFamily: 'inherit',
          }}
        />
        <select
          value={nlOtId}
          onChange={(e) => setNlOtId(e.target.value)}
          style={{
            width: '100%', height: 26, padding: '0 6px', marginTop: 4,
            border: '1px solid #DDD6FE', borderRadius: 4, fontSize: 11,
            color: nlOtId ? '#1E1B4B' : '#94A3B8', backgroundColor: '#FAF5FF',
            outline: 'none',
          }}
        >
          <option value="">— pick object type —</option>
          {objectTypes.map((o) => (
            <option key={o.id} value={o.id}>{o.displayName || o.name}</option>
          ))}
        </select>
        {nlError && (
          <div style={{ fontSize: 10, color: '#DC2626', marginTop: 4 }}>{nlError}</div>
        )}
        <button
          onClick={handleNlGenerate}
          disabled={!nlPrompt.trim() || !nlOtId || nlLoading}
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
            marginTop: 5, width: '100%', padding: '5px 0',
            backgroundColor: !nlPrompt.trim() || !nlOtId || nlLoading ? '#EDE9FE' : '#7C3AED',
            color: !nlPrompt.trim() || !nlOtId || nlLoading ? '#A78BFA' : '#fff',
            border: 'none', borderRadius: 5, cursor: !nlPrompt.trim() || !nlOtId || nlLoading ? 'default' : 'pointer',
            fontSize: 11, fontWeight: 600,
          }}
        >
          {nlLoading ? <><Loader size={10} style={{ animation: 'spin 1s linear infinite' }} /> Generating…</> : <><Sparkles size={10} /> Generate Widget</>}
        </button>
      </div>

      {/* Widgets section */}
      <div style={{ padding: '8px 10px 6px' }}>
        <div style={{ fontSize: 10, fontWeight: 600, color: '#94A3B8', letterSpacing: '0.07em', marginBottom: 6 }}>
          WIDGETS
        </div>
        {WIDGET_DEFS.map((w) => (
          <button
            key={w.type}
            onClick={() => onAddWidget(w.type)}
            title={w.description}
            style={{
              display: 'flex', alignItems: 'center', gap: 7, width: '100%',
              padding: '6px 8px', marginBottom: 2,
              border: '1px solid #E2E8F0', borderRadius: 5,
              backgroundColor: '#fff', cursor: 'pointer', color: '#374151',
              fontSize: 12, textAlign: 'left',
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLElement).style.borderColor = '#2563EB';
              (e.currentTarget as HTMLElement).style.backgroundColor = '#EFF6FF';
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLElement).style.borderColor = '#E2E8F0';
              (e.currentTarget as HTMLElement).style.backgroundColor = '#fff';
            }}
          >
            <span style={{ color: '#2563EB', lineHeight: 0 }}>{w.icon}</span>
            {w.label}
          </button>
        ))}
      </div>

      <div style={{ height: 1, backgroundColor: '#E2E8F0', margin: '4px 0' }} />

      {/* Ontology browser */}
      <div style={{ padding: '8px 10px', flex: 1 }}>
        <div style={{ fontSize: 10, fontWeight: 600, color: '#94A3B8', letterSpacing: '0.07em', marginBottom: 6 }}>
          OBJECT TYPES
        </div>
        {objectTypes.length === 0 && (
          <div style={{ fontSize: 11, color: '#CBD5E1', padding: '4px 0' }}>No objects found</div>
        )}
        {objectTypes.map((ot) => {
          const isOpen = expandedOt === ot.id;
          const flatProps = ot.properties.filter((p) => !p.name.endsWith('[]'));
          return (
            <div key={ot.id} style={{ marginBottom: 2 }}>
              <button
                onClick={() => setExpandedOt(isOpen ? null : ot.id)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 5, width: '100%',
                  padding: '5px 6px', border: 'none', borderRadius: 4,
                  backgroundColor: isOpen ? '#EFF6FF' : 'transparent',
                  cursor: 'pointer', textAlign: 'left',
                }}
              >
                <Database size={11} color={isOpen ? '#2563EB' : '#94A3B8'} />
                <span style={{ fontSize: 12, fontWeight: 500, color: isOpen ? '#2563EB' : '#374151', flex: 1 }}>
                  {ot.displayName || ot.name}
                </span>
                <ChevronRight
                  size={11}
                  color="#94A3B8"
                  style={{ transform: isOpen ? 'rotate(90deg)' : 'none', transition: 'transform 120ms' }}
                />
              </button>

              {isOpen && (
                <div style={{ paddingLeft: 8, marginTop: 2, marginBottom: 4 }}>
                  {/* Quick-add widget buttons */}
                  <div style={{ display: 'flex', gap: 4, marginBottom: 6, flexWrap: 'wrap' }}>
                    {(['data-table', 'bar-chart', 'metric-card'] as ComponentType[]).map((t) => {
                      const def = WIDGET_DEFS.find((w) => w.type === t)!;
                      return (
                        <button
                          key={t}
                          onClick={() => onAddWidget(t, ot.id)}
                          title={`Add ${def.label} for ${ot.name}`}
                          style={{
                            display: 'flex', alignItems: 'center', gap: 3,
                            padding: '2px 6px', border: '1px solid #BFDBFE',
                            borderRadius: 3, backgroundColor: '#EFF6FF',
                            cursor: 'pointer', fontSize: 10, color: '#2563EB',
                          }}
                        >
                          {def.icon} {def.label}
                        </button>
                      );
                    })}
                  </div>

                  {/* Field list */}
                  {flatProps.slice(0, 20).map((p) => {
                    const icon = SEMANTIC_ICON[p.semantic_type || ''] || '·';
                    return (
                      <button
                        key={p.name}
                        onClick={() => onClickField(p.name)}
                        title={`Click to copy field name: ${p.name}`}
                        style={{
                          display: 'flex', alignItems: 'center', gap: 5,
                          width: '100%', padding: '3px 4px', border: 'none',
                          borderRadius: 3, backgroundColor: 'transparent',
                          cursor: 'pointer', textAlign: 'left',
                        }}
                        onMouseEnter={(e) => (e.currentTarget as HTMLElement).style.backgroundColor = '#F1F5F9'}
                        onMouseLeave={(e) => (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent'}
                      >
                        <span style={{ fontSize: 9, width: 14, textAlign: 'center', color: '#94A3B8' }}>{icon}</span>
                        <span style={{ fontSize: 11, color: '#475569', fontFamily: 'var(--font-mono)' }}>
                          {p.name.length > 18 ? p.name.slice(0, 18) + '…' : p.name}
                        </span>
                        {p.semantic_type && (
                          <Tag size={8} color="#CBD5E1" style={{ marginLeft: 'auto', flexShrink: 0 }} />
                        )}
                      </button>
                    );
                  })}
                  {ot.properties.filter((p) => p.name.endsWith('[]')).map((p) => (
                    <div key={p.name} style={{
                      display: 'flex', alignItems: 'center', gap: 5,
                      padding: '2px 4px', fontSize: 11, color: '#A78BFA',
                      fontFamily: 'var(--font-mono)',
                    }}>
                      <span style={{ fontSize: 9, color: '#A78BFA' }}>⊞</span>
                      {p.name}
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

// ── Live edit canvas ──────────────────────────────────────────────────────────

// Lazy-import ComponentRenderer from AppCanvas to avoid circular deps
const ONTOLOGY_API2 = import.meta.env.VITE_ONTOLOGY_SERVICE_URL || 'http://localhost:8004';

function useRecords(objectTypeId?: string) {
  const [records, setRecords] = useState<Record<string, unknown>[]>([]);
  useEffect(() => {
    if (!objectTypeId) return;
    fetch(`${ONTOLOGY_API2}/object-types/${objectTypeId}/records`, {
      headers: { 'x-tenant-id': 'tenant-001' },
    }).then((r) => r.json()).then((d) => setRecords(d.records || [])).catch(() => {});
  }, [objectTypeId]);
  return records;
}

// Tiny wrappers to render each widget inline (duplicated from AppCanvas intentionally
// so AppCanvas stays read-only and self-contained)
const MiniRenderer: React.FC<{ comp: AppComponent }> = ({ comp }) => {
  if (comp.type === 'chat-widget') {
    return (
      <div style={{
        height: '100%', backgroundColor: '#fff', border: '1px solid #E2E8F0',
        borderRadius: 8, display: 'flex', flexDirection: 'column', overflow: 'hidden',
      }}>
        <div style={{
          padding: '10px 16px', borderBottom: '1px solid #E2E8F0',
          display: 'flex', alignItems: 'center', gap: 8,
        }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: '#0D1117' }}>{comp.title}</span>
        </div>
        <div style={{
          flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: '#94A3B8', fontSize: 12, gap: 6,
        }}>
          <MessageSquare size={14} color="#94A3B8" />
          Chat widget — interactive in View mode
        </div>
      </div>
    );
  }
  return <AppCanvas app={{ id: '', name: '', description: '', icon: '', components: [{ ...comp, colSpan: 12 }], objectTypeIds: [], createdAt: '', updatedAt: '' }} />;
};

// Default grid row heights per widget type (1 row = 60px via rowHeight prop)
const DEFAULT_GRID_H: Record<string, number> = {
  'metric-card': 3, 'kpi-banner': 2, 'filter-bar': 2, 'text-block': 2,
  'bar-chart': 5, 'line-chart': 4, 'data-table': 6, 'chat-widget': 7,
};
const ROW_HEIGHT = 60;
const GRID_COLS = 12;

function toLayout(components: AppComponent[]): LayoutItem[] {
  let curY = 0;
  return components.map((comp) => {
    const w = comp.colSpan || 6;
    const h = comp.gridH || DEFAULT_GRID_H[comp.type] || 4;
    const x = comp.gridX ?? 0;
    const y = comp.gridY ?? curY;
    curY = y + h;
    return { i: comp.id, x, y, w, h, minH: 2, minW: 2 };
  });
}

const EditCanvas: React.FC<{
  components: AppComponent[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onLayoutChange: (updated: AppComponent[]) => void;
  onDelete: (id: string) => void;
  objectTypes: OntologyType[];
  containerWidth: number;
}> = ({ components, selectedId, onSelect, onLayoutChange, onDelete, objectTypes, containerWidth }) => {
  const [hoverId, setHoverId] = useState<string | null>(null);

  if (components.length === 0) {
    return (
      <div style={{
        flex: 1, display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center', color: '#94A3B8', gap: 10,
      }}>
        <div style={{
          width: 48, height: 48, borderRadius: 10,
          backgroundColor: '#F1F5F9', display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <Plus size={22} color="#94A3B8" />
        </div>
        <div style={{ fontSize: 13, fontWeight: 500 }}>Add a widget from the left panel</div>
        <div style={{ fontSize: 12 }}>or use the AI Widget to generate one</div>
      </div>
    );
  }

  const layout = toLayout(components);

  const handleLayoutChange = (newLayout: LayoutItem[]) => {
    const updated = components.map((comp) => {
      const l = newLayout.find((item) => item.i === comp.id);
      if (!l) return comp;
      return { ...comp, colSpan: l.w, gridX: l.x, gridY: l.y, gridH: l.h };
    });
    onLayoutChange(updated);
  };

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px', backgroundColor: '#F8FAFC' }}>
      {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
      <GridLayout
        layout={layout}
        cols={GRID_COLS}
        rowHeight={ROW_HEIGHT}
        width={containerWidth || 900}
        margin={[12, 12]}
        containerPadding={[0, 0]}
        onLayoutChange={handleLayoutChange as any}
        draggableHandle=".drag-handle"
        resizeHandles={['se', 'sw', 'ne', 'nw', 'e', 'w', 's']}
        useCSSTransforms
      >
        {components.map((comp) => {
          const isSelected = selectedId === comp.id;
          const isHovered  = hoverId === comp.id;
          const otName = objectTypes.find((o) => o.id === comp.objectTypeId)?.displayName;
          const active = isSelected || isHovered;

          return (
            <div
              key={comp.id}
              onClick={() => onSelect(comp.id)}
              onMouseEnter={() => setHoverId(comp.id)}
              onMouseLeave={() => setHoverId(null)}
              style={{
                borderRadius: 8,
                outline: isSelected
                  ? '2px solid #2563EB'
                  : isHovered
                  ? '2px solid #93C5FD'
                  : '2px solid transparent',
                outlineOffset: 2,
                transition: 'outline-color 80ms',
                overflow: 'hidden',
                position: 'relative',
                backgroundColor: '#fff',
              }}
            >
              {/* Live widget — pointer-events off so clicks select, not interact */}
              <div style={{ pointerEvents: 'none', height: '100%' }}>
                <MiniRenderer comp={comp} />
              </div>

              {/* Drag handle — title bar overlay */}
              {active && (
                <div
                  className="drag-handle"
                  style={{
                    position: 'absolute', top: 0, left: 0, right: 40,
                    height: 36, cursor: 'grab', zIndex: 10,
                    display: 'flex', alignItems: 'center', paddingLeft: 10, gap: 6,
                  }}
                >
                  {/* grip icon */}
                  <div style={{ display: 'flex', gap: 2, opacity: 0.35 }}>
                    {[0,1].map((c) => (
                      <div key={c} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                        {[0,1,2].map((r) => (
                          <div key={r} style={{ width: 3, height: 3, borderRadius: '50%', backgroundColor: '#374151' }} />
                        ))}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Badges */}
              {active && (
                <div style={{
                  position: 'absolute', bottom: 6, left: 8,
                  display: 'flex', gap: 4, pointerEvents: 'none', zIndex: 10,
                }}>
                  {otName && (
                    <span style={{
                      fontSize: 10, padding: '2px 6px',
                      backgroundColor: 'rgba(37,99,235,0.88)', color: '#fff',
                      borderRadius: 3, fontWeight: 500,
                    }}>{otName}</span>
                  )}
                  <span style={{
                    fontSize: 10, padding: '2px 6px',
                    backgroundColor: 'rgba(0,0,0,0.5)', color: '#fff', borderRadius: 3,
                  }}>
                    {comp.colSpan || 6}×{comp.gridH || DEFAULT_GRID_H[comp.type] || 4}
                  </span>
                </div>
              )}

              {/* Delete */}
              {active && (
                <div
                  style={{ position: 'absolute', top: 6, right: 6, zIndex: 20, pointerEvents: 'all' }}
                  onClick={(e) => { e.stopPropagation(); onDelete(comp.id); }}
                >
                  <Ctrl icon={<Trash2 size={10} />} danger onClick={() => onDelete(comp.id)} title="Delete" />
                </div>
              )}
            </div>
          );
        })}
      </GridLayout>
    </div>
  );
};

const Ctrl: React.FC<{
  icon: React.ReactNode; onClick: () => void; title?: string;
  disabled?: boolean; danger?: boolean;
}> = ({ icon, onClick, title, disabled, danger }) => (
  <button
    onClick={onClick}
    disabled={disabled}
    title={title}
    style={{
      width: 22, height: 22, border: `1px solid ${danger ? '#FCA5A5' : '#E2E8F0'}`,
      borderRadius: 4, display: 'flex', alignItems: 'center', justifyContent: 'center',
      cursor: disabled ? 'default' : 'pointer', padding: 0,
      backgroundColor: danger ? '#FEF2F2' : '#fff',
      color: disabled ? '#E2E8F0' : danger ? '#DC2626' : '#475569',
    }}
  >
    {icon}
  </button>
);

// ── Filter builder ────────────────────────────────────────────────────────────

const OPERATORS: { value: FilterOperator; label: string; noValue?: boolean }[] = [
  { value: 'eq',          label: '=' },
  { value: 'neq',         label: '≠' },
  { value: 'contains',    label: 'contains' },
  { value: 'not_contains',label: "doesn't contain" },
  { value: 'gt',          label: '>' },
  { value: 'gte',         label: '≥' },
  { value: 'lt',          label: '<' },
  { value: 'lte',         label: '≤' },
  { value: 'after',       label: 'after' },
  { value: 'before',      label: 'before' },
  { value: 'is_empty',    label: 'is empty',     noValue: true },
  { value: 'is_not_empty',label: 'is not empty', noValue: true },
];

function isDateField(field: string): boolean {
  return /date|time|_at|modified|created/i.test(field);
}

// Separate component so hooks are called at the top level, not inside .map()
const FilterRow: React.FC<{
  f: AppFilter;
  fields: string[];
  allRecords: Record<string, unknown>[];
  onUpdate: (patch: Partial<AppFilter>) => void;
  onRemove: () => void;
}> = ({ f, fields, allRecords, onUpdate, onRemove }) => {
  const opDef = (op: FilterOperator) => OPERATORS.find((o) => o.value === op);
  const noVal = opDef(f.operator)?.noValue;
  const isDate = isDateField(f.field);
  const listId = `dl-${f.id}`;

  const distinctVals = React.useMemo(() => {
    if (!allRecords.length || !f.field) return [];
    const seen = new Set<string>();
    for (const rec of allRecords) {
      const v = String(rec[f.field] ?? '');
      if (v) seen.add(v);
      if (seen.size >= 200) break;
    }
    return Array.from(seen).sort();
  }, [allRecords, f.field]);

  return (
    <div style={{
      marginBottom: 8, padding: '8px 9px',
      backgroundColor: '#F8FAFC', border: '1px solid #E2E8F0',
      borderRadius: 6, display: 'flex', flexDirection: 'column', gap: 5,
    }}>
      {/* Row 1: field + operator + delete */}
      <div style={{ display: 'flex', gap: 4 }}>
        <select
          value={f.field}
          onChange={(e) => onUpdate({ field: e.target.value, value: '' })}
          style={{
            flex: 1, height: 24, padding: '0 4px',
            border: '1px solid #E2E8F0', borderRadius: 4,
            fontSize: 11, fontFamily: 'var(--font-mono)',
            color: '#0D1117', backgroundColor: '#fff',
          }}
        >
          {fields.length === 0 && <option value="">Select object type first</option>}
          {fields.map((fld) => <option key={fld} value={fld}>{fld}</option>)}
        </select>

        <select
          value={f.operator}
          onChange={(e) => onUpdate({ operator: e.target.value as FilterOperator })}
          style={{
            width: 82, height: 24, padding: '0 4px',
            border: '1px solid #E2E8F0', borderRadius: 4,
            fontSize: 11, color: '#0D1117', backgroundColor: '#fff',
          }}
        >
          {OPERATORS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>

        <button onClick={onRemove} style={{
          width: 24, height: 24, border: '1px solid #FCA5A5',
          borderRadius: 4, backgroundColor: '#FEF2F2',
          cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: '#DC2626', padding: 0, flexShrink: 0,
        }}>
          <Trash2 size={10} />
        </button>
      </div>

      {/* Row 2: value input — auto-detects date fields and distinct value sets */}
      {!noVal && (
        isDate ? (
          <input
            type="datetime-local"
            value={f.value ? f.value.slice(0, 16) : ''}
            onChange={(e) => onUpdate({ value: e.target.value ? new Date(e.target.value).toISOString() : '' })}
            style={{
              width: '100%', height: 24, padding: '0 6px',
              border: '1px solid #E2E8F0', borderRadius: 4,
              fontSize: 11, color: '#0D1117', backgroundColor: '#fff',
              boxSizing: 'border-box',
            }}
          />
        ) : distinctVals.length > 0 && distinctVals.length <= 40 ? (
          /* ≤40 distinct values → dropdown */
          <select
            value={f.value}
            onChange={(e) => onUpdate({ value: e.target.value })}
            style={{
              width: '100%', height: 24, padding: '0 6px',
              border: '1px solid #E2E8F0', borderRadius: 4,
              fontSize: 11, color: f.value ? '#0D1117' : '#94A3B8', backgroundColor: '#fff',
              boxSizing: 'border-box',
            }}
          >
            <option value="">— pick a value —</option>
            {distinctVals.map((v) => (
              <option key={v} value={v}>{v.length > 50 ? v.slice(0, 50) + '…' : v}</option>
            ))}
          </select>
        ) : (
          /* Many values → text input with datalist autocomplete */
          <>
            <input
              list={distinctVals.length > 0 ? listId : undefined}
              value={f.value}
              onChange={(e) => onUpdate({ value: e.target.value })}
              placeholder="value…"
              style={{
                width: '100%', height: 24, padding: '0 6px',
                border: '1px solid #E2E8F0', borderRadius: 4,
                fontSize: 11, color: '#0D1117', backgroundColor: '#fff',
                boxSizing: 'border-box',
              }}
            />
            {distinctVals.length > 0 && (
              <datalist id={listId}>
                {distinctVals.slice(0, 100).map((v) => <option key={v} value={v} />)}
              </datalist>
            )}
          </>
        )
      )}

      {/* Active filter badge */}
      {(f.field && f.operator && (noVal || f.value)) && (
        <div style={{
          fontSize: 10, color: '#2563EB', backgroundColor: '#EFF6FF',
          border: '1px solid #BFDBFE', borderRadius: 3, padding: '2px 6px',
          fontFamily: 'var(--font-mono)',
        }}>
          {f.field} {opDef(f.operator)?.label} {noVal ? '' : `"${f.value.slice(0, 20)}"`}
        </div>
      )}
    </div>
  );
};

const FilterBuilder: React.FC<{
  filters: AppFilter[];
  fields: string[];
  objectTypeId?: string;
  onChange: (filters: AppFilter[]) => void;
}> = ({ filters, fields, objectTypeId, onChange }) => {
  const allRecords = useRecordsForFilter(objectTypeId);

  const add = () => onChange([
    ...filters,
    { id: `f-${Date.now()}`, field: fields[0] || '', operator: 'eq', value: '' },
  ]);

  const update = (id: string, patch: Partial<AppFilter>) =>
    onChange(filters.map((f) => f.id === id ? { ...f, ...patch } : f));

  const remove = (id: string) => onChange(filters.filter((f) => f.id !== id));

  return (
    <div style={{ marginTop: 4, borderTop: '1px solid #F1F5F9', paddingTop: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <div style={{ fontSize: 10, fontWeight: 600, color: '#64748B', letterSpacing: '0.04em' }}>
          FILTERS {filters.length > 0 && (
            <span style={{
              marginLeft: 4, fontSize: 9, backgroundColor: '#2563EB', color: '#fff',
              borderRadius: 8, padding: '1px 5px',
            }}>{filters.length}</span>
          )}
        </div>
        <button onClick={add} style={{
          display: 'flex', alignItems: 'center', gap: 3,
          padding: '2px 7px', border: '1px solid #E2E8F0', borderRadius: 4,
          fontSize: 10, cursor: 'pointer', backgroundColor: '#F8FAFC', color: '#374151',
        }}>
          <Plus size={9} /> Add
        </button>
      </div>

      {filters.length === 0 && (
        <div style={{ fontSize: 11, color: '#CBD5E1', padding: '2px 0 6px' }}>
          No filters — showing all records
        </div>
      )}

      {filters.map((f) => (
        <FilterRow
          key={f.id}
          f={f}
          fields={fields}
          allRecords={allRecords}
          onUpdate={(patch) => update(f.id, patch)}
          onRemove={() => remove(f.id)}
        />
      ))}
    </div>
  );
};

// ── Right config panel ────────────────────────────────────────────────────────

const AGG_OPTIONS = ['count', 'sum', 'avg', 'max', 'min'];
const COLSPAN_OPTIONS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

const ConfigPanel: React.FC<{
  comp: AppComponent;
  objectTypes: OntologyType[];
  onChange: (c: AppComponent) => void;
  onDelete: () => void;
}> = ({ comp, objectTypes, onChange, onDelete }) => {
  const set = (patch: Partial<AppComponent>) => onChange({ ...comp, ...patch });
  const selectedOt = objectTypes.find((o) => o.id === comp.objectTypeId);
  const fields = (selectedOt?.properties || [])
    .filter((p) => !p.name.endsWith('[]'))
    .map((p) => p.name);

  const Lbl: React.FC<{ children: React.ReactNode }> = ({ children }) => (
    <div style={{ fontSize: 10, fontWeight: 600, color: '#64748B', marginBottom: 4, letterSpacing: '0.04em' }}>
      {children}
    </div>
  );

  const Row: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
    <div style={{ marginBottom: 12 }}>
      <Lbl>{label}</Lbl>
      {children}
    </div>
  );

  const inp = (val: string | number | undefined, onCh: (v: string) => void, ph?: string) => (
    <input value={val ?? ''} onChange={(e) => onCh(e.target.value)} placeholder={ph}
      style={{
        width: '100%', height: 28, padding: '0 8px', boxSizing: 'border-box',
        border: '1px solid #E2E8F0', borderRadius: 4, fontSize: 12, color: '#0D1117',
        outline: 'none',
      }}
    />
  );

  const sel = (val: string | undefined, opts: string[], labels: string[] | undefined, onCh: (v: string) => void, empty?: string) => (
    <select value={val ?? ''} onChange={(e) => onCh(e.target.value)}
      style={{
        width: '100%', height: 28, padding: '0 6px', border: '1px solid #E2E8F0',
        borderRadius: 4, fontSize: 12, color: val ? '#0D1117' : '#94A3B8',
        backgroundColor: '#fff', outline: 'none',
      }}
    >
      {empty && <option value="">{empty}</option>}
      {opts.map((o, i) => <option key={o} value={o}>{(labels || opts)[i]}</option>)}
    </select>
  );

  // Field picker with pill display
  const FieldPicker: React.FC<{ value: string | undefined; onPick: (f: string) => void; placeholder?: string }> = ({ value, onPick, placeholder }) => (
    <div>
      {sel(value, fields, undefined, onPick, placeholder || 'Select field…')}
      {value && (
        <div style={{ marginTop: 4, display: 'flex', flexWrap: 'wrap', gap: 3 }}>
          {fields.slice(0, 6).map((f) => (
            <button key={f} onClick={() => onPick(f)}
              style={{
                padding: '1px 6px', border: `1px solid ${f === value ? '#2563EB' : '#E2E8F0'}`,
                borderRadius: 3, fontSize: 10, cursor: 'pointer',
                backgroundColor: f === value ? '#EFF6FF' : '#F8FAFC',
                color: f === value ? '#2563EB' : '#64748B',
              }}>
              {f.length > 14 ? f.slice(0, 14) + '…' : f}
            </button>
          ))}
        </div>
      )}
    </div>
  );

  const widgetDef = WIDGET_DEFS.find((w) => w.type === comp.type);

  return (
    <div style={{
      width: 252, flexShrink: 0, borderLeft: '1px solid #E2E8F0',
      backgroundColor: '#fff', display: 'flex', flexDirection: 'column',
      overflowY: 'auto',
    }}>
      {/* Header */}
      <div style={{
        padding: '10px 14px 8px',
        borderBottom: '1px solid #E2E8F0',
        display: 'flex', alignItems: 'center', gap: 8,
      }}>
        <span style={{ color: '#2563EB', lineHeight: 0 }}>{widgetDef?.icon}</span>
        <span style={{ fontSize: 12, fontWeight: 600, color: '#0D1117', flex: 1 }}>
          {widgetDef?.label ?? comp.type}
        </span>
        <button onClick={onDelete} title="Remove widget"
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#DC2626', padding: 2, display: 'flex' }}>
          <Trash2 size={13} />
        </button>
      </div>

      <div style={{ flex: 1, padding: '12px 14px', overflowY: 'auto' }}>
        <Row label="TITLE">{inp(comp.title, (v) => set({ title: v }), 'Widget title')}</Row>

        <Row label="WIDTH">
          <div style={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
            {([
              [3, '¼'],
              [4, '⅓'],
              [6, '½'],
              [8, '⅔'],
              [12, 'Full'],
            ] as [number, string][]).map(([n, label]) => (
              <button key={n} onClick={() => set({ colSpan: n })}
                style={{
                  flex: 1, padding: '4px 2px', border: `1px solid ${comp.colSpan === n ? '#2563EB' : '#E2E8F0'}`,
                  borderRadius: 4, fontSize: 10, cursor: 'pointer', textAlign: 'center',
                  backgroundColor: comp.colSpan === n ? '#EFF6FF' : '#F8FAFC',
                  color: comp.colSpan === n ? '#2563EB' : '#64748B', lineHeight: 1.3,
                }}>
                <div>{label}</div>
                <div style={{ fontSize: 9, opacity: 0.7 }}>{n}/12</div>
              </button>
            ))}
          </div>
        </Row>

        <Row label="HEIGHT (ROWS)">
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <input
              type="range"
              min={2} max={14} step={1}
              value={comp.gridH ?? DEFAULT_GRID_H[comp.type] ?? 4}
              onChange={(e) => set({ gridH: Number(e.target.value) })}
              style={{ flex: 1 }}
            />
            <span style={{ fontSize: 11, color: '#64748B', width: 52, textAlign: 'right', flexShrink: 0 }}>
              {(comp.gridH ?? DEFAULT_GRID_H[comp.type] ?? 4)} rows
            </span>
          </div>
          <div style={{ fontSize: 10, color: '#CBD5E1', marginTop: 2 }}>
            Drag the resize handle on canvas for precise control
          </div>
        </Row>

        {comp.type !== 'text-block' && (
          <Row label="DATA SOURCE">
            <select
              value={comp.objectTypeId ?? ''}
              onChange={(e) => set({ objectTypeId: e.target.value })}
              style={{
                width: '100%', height: 28, padding: '0 6px', border: '1px solid #E2E8F0',
                borderRadius: 4, fontSize: 12,
                color: comp.objectTypeId ? '#0D1117' : '#94A3B8',
                backgroundColor: '#fff', outline: 'none',
              }}
            >
              <option value="">Select object type…</option>
              {objectTypes.map((o) => (
                <option key={o.id} value={o.id}>{o.displayName || o.name}</option>
              ))}
            </select>
            {selectedOt && (
              <div style={{ marginTop: 4, fontSize: 10, color: '#94A3B8' }}>
                {selectedOt.properties.length} properties · {selectedOt.properties.filter(p => p.name.endsWith('[]')).length} arrays
              </div>
            )}
          </Row>
        )}

        {/* metric-card */}
        {comp.type === 'metric-card' && (
          <>
            <Row label="AGGREGATION">
              {sel(comp.aggregation || 'count', AGG_OPTIONS, undefined, (v) => set({ aggregation: v as AppComponent['aggregation'] }))}
            </Row>
            {comp.aggregation !== 'count' && (
              <Row label="FIELD">
                <FieldPicker value={comp.field} onPick={(f) => set({ field: f })} />
              </Row>
            )}
          </>
        )}

        {/* kpi-banner */}
        {comp.type === 'kpi-banner' && fields.length > 0 && (
          <Row label="HIGHLIGHT FIELD">
            <FieldPicker value={comp.field} onPick={(f) => set({ field: f })} placeholder="None (auto)" />
          </Row>
        )}

        {/* data-table */}
        {comp.type === 'data-table' && (
          <>
            <Row label="COLUMNS">
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3, marginBottom: 6 }}>
                {fields.map((f) => {
                  const isActive = (comp.columns || []).includes(f);
                  return (
                    <button key={f} onClick={() => {
                      const cols = comp.columns || [];
                      set({ columns: isActive ? cols.filter((c) => c !== f) : [...cols, f] });
                    }}
                      style={{
                        padding: '2px 6px',
                        border: `1px solid ${isActive ? '#2563EB' : '#E2E8F0'}`,
                        borderRadius: 3, fontSize: 10, cursor: 'pointer',
                        backgroundColor: isActive ? '#EFF6FF' : '#F8FAFC',
                        color: isActive ? '#2563EB' : '#64748B',
                      }}>
                      {f.length > 14 ? f.slice(0, 14) + '…' : f}
                    </button>
                  );
                })}
              </div>
              {(comp.columns || []).length === 0 && (
                <div style={{ fontSize: 10, color: '#94A3B8' }}>All columns shown. Click to restrict.</div>
              )}
            </Row>
            <Row label="MAX ROWS">
              {inp(comp.maxRows, (v) => set({ maxRows: Number(v) || 20 }), '20')}
            </Row>
          </>
        )}

        {/* bar-chart */}
        {comp.type === 'bar-chart' && (
          <>
            <Row label="GROUP BY (LABEL)">
              <FieldPicker value={comp.labelField} onPick={(f) => set({ labelField: f })} />
            </Row>
            <Row label="VALUE (BLANK = COUNT)">
              <FieldPicker value={comp.valueField} onPick={(f) => set({ valueField: f })} placeholder="Count (auto)" />
            </Row>
          </>
        )}

        {/* line-chart */}
        {comp.type === 'line-chart' && (
          <>
            <Row label="X-AXIS (DATE / TIME)">
              <FieldPicker value={comp.xField} onPick={(f) => set({ xField: f })} />
            </Row>
            <Row label="Y-AXIS (NUMBER)">
              <FieldPicker value={comp.valueField} onPick={(f) => set({ valueField: f })} />
            </Row>
          </>
        )}

        {/* filter-bar */}
        {comp.type === 'filter-bar' && (
          <Row label="FILTER FIELD">
            <FieldPicker value={comp.filterField} onPick={(f) => set({ filterField: f })} />
          </Row>
        )}

        {/* text-block */}
        {comp.type === 'text-block' && (
          <Row label="CONTENT">
            <textarea
              value={comp.content ?? ''}
              onChange={(e) => set({ content: e.target.value })}
              rows={8}
              placeholder="Write notes, documentation, or context here…"
              style={{
                width: '100%', padding: '8px', border: '1px solid #E2E8F0',
                borderRadius: 4, fontSize: 12, color: '#0D1117',
                resize: 'vertical', boxSizing: 'border-box', lineHeight: 1.6,
                fontFamily: 'inherit', outline: 'none',
              }}
            />
          </Row>
        )}

        {/* ── Filters ── */}
        {comp.type !== 'text-block' && (
          <FilterBuilder
            filters={comp.filters || []}
            fields={fields}
            objectTypeId={comp.objectTypeId}
            onChange={(filters) => set({ filters })}
          />
        )}

        {/* JSON preview for this widget */}
        <div style={{ marginTop: 8, borderTop: '1px solid #F1F5F9', paddingTop: 10 }}>
          <Lbl>JSON</Lbl>
          <pre style={{
            fontSize: 10, color: '#64748B', backgroundColor: '#F8FAFC',
            border: '1px solid #E2E8F0', borderRadius: 4, padding: '6px 8px',
            overflowX: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-all',
            lineHeight: 1.5, margin: 0,
          }}>
            {JSON.stringify(comp, null, 2)}
          </pre>
        </div>
      </div>
    </div>
  );
};

// ── Code editor ───────────────────────────────────────────────────────────────

const CodeEditor: React.FC<{
  components: AppComponent[];
  objectTypes: OntologyType[];
  onChange: (c: AppComponent[]) => void;
}> = ({ components, objectTypes, onChange }) => {
  const [text, setText] = useState(() => JSON.stringify(components, null, 2));
  const [err, setErr] = useState('');
  const taRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setText(JSON.stringify(components, null, 2));
    setErr('');
  }, [components]);

  const handleChange = (val: string) => {
    setText(val);
    try {
      const parsed = JSON.parse(val);
      if (Array.isArray(parsed)) { setErr(''); onChange(parsed as AppComponent[]); }
      else setErr('Root must be a JSON array [ … ]');
    } catch (e: unknown) { setErr(String(e)); }
  };

  // Compute line numbers
  const lines = text.split('\n').length;

  return (
    <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
      {/* Editor area */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: '16px 20px', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: 12, color: '#64748B' }}>
            Editing <strong>components</strong> array · {components.length} widget{components.length !== 1 ? 's' : ''}
          </span>
          {err && (
            <span style={{
              fontSize: 11, color: '#DC2626', backgroundColor: '#FEF2F2',
              border: '1px solid #FECACA', borderRadius: 4, padding: '2px 8px',
            }}>
              {err}
            </span>
          )}
          {!err && text.trim() && (
            <span style={{
              fontSize: 11, color: '#16A34A', backgroundColor: '#F0FDF4',
              border: '1px solid #BBF7D0', borderRadius: 4, padding: '2px 8px',
            }}>
              Valid JSON
            </span>
          )}
        </div>

        {/* Line numbers + textarea */}
        <div style={{
          flex: 1, display: 'flex', border: `1px solid ${err ? '#FECACA' : '#E2E8F0'}`,
          borderRadius: 6, overflow: 'hidden', backgroundColor: '#F8FAFC',
        }}>
          {/* Gutter */}
          <div style={{
            padding: '14px 10px 14px 14px', userSelect: 'none',
            fontFamily: 'var(--font-mono)', fontSize: 12, lineHeight: 1.6,
            color: '#CBD5E1', backgroundColor: '#F1F5F9', minWidth: 44,
            textAlign: 'right', borderRight: '1px solid #E2E8F0',
            overflowY: 'hidden',
          }}>
            {Array.from({ length: lines }, (_, i) => i + 1).join('\n')}
          </div>
          <textarea
            ref={taRef}
            value={text}
            onChange={(e) => handleChange(e.target.value)}
            spellCheck={false}
            style={{
              flex: 1, padding: '14px', border: 'none', outline: 'none',
              fontSize: 12, fontFamily: 'var(--font-mono)',
              color: '#0D1117', backgroundColor: '#F8FAFC',
              resize: 'none', lineHeight: 1.6, overflowY: 'auto',
            }}
          />
        </div>
      </div>

      {/* Schema reference sidebar */}
      <div style={{
        width: 220, flexShrink: 0, borderLeft: '1px solid #E2E8F0',
        backgroundColor: '#fff', overflowY: 'auto', padding: '16px 14px',
      }}>
        <div style={{ fontSize: 10, fontWeight: 600, color: '#94A3B8', letterSpacing: '0.07em', marginBottom: 10 }}>
          SCHEMA REFERENCE
        </div>
        <div style={{ fontSize: 11, color: '#64748B', marginBottom: 12, lineHeight: 1.5 }}>
          Each widget in the array:
        </div>
        {[
          ['id', 'string', 'Unique widget ID'],
          ['type', 'enum', WIDGET_DEFS.map(w => w.type).join(' | ')],
          ['title', 'string', 'Display title'],
          ['objectTypeId', 'string', 'Object type UUID'],
          ['colSpan', '1–12', 'Grid width'],
          ['field', 'string', 'For metric-card'],
          ['aggregation', 'enum', 'count|sum|avg|max|min'],
          ['columns', 'string[]', 'For data-table'],
          ['labelField', 'string', 'For bar-chart'],
          ['valueField', 'string', 'For bar/line chart'],
          ['xField', 'string', 'For line-chart'],
          ['filterField', 'string', 'For filter-bar'],
          ['content', 'string', 'For text-block'],
        ].map(([key, type, desc]) => (
          <div key={key} style={{ marginBottom: 8 }}>
            <div style={{ display: 'flex', gap: 6, alignItems: 'baseline' }}>
              <code style={{ fontSize: 11, color: '#2563EB', fontFamily: 'var(--font-mono)' }}>{key}</code>
              <span style={{ fontSize: 10, color: '#94A3B8' }}>{type}</span>
            </div>
            <div style={{ fontSize: 10, color: '#CBD5E1', lineHeight: 1.4 }}>{desc}</div>
          </div>
        ))}

        <div style={{ marginTop: 14, borderTop: '1px solid #F1F5F9', paddingTop: 12 }}>
          <div style={{ fontSize: 10, fontWeight: 600, color: '#94A3B8', letterSpacing: '0.07em', marginBottom: 8 }}>
            OBJECT TYPE IDs
          </div>
          {objectTypes.map((o) => (
            <div key={o.id} style={{ marginBottom: 6 }}>
              <div style={{ fontSize: 11, fontWeight: 500, color: '#374151' }}>
                {o.displayName || o.name}
              </div>
              <code
                style={{
                  fontSize: 9, color: '#64748B', fontFamily: 'var(--font-mono)',
                  cursor: 'pointer', display: 'block',
                }}
                title="Click to copy"
                onClick={() => navigator.clipboard.writeText(o.id)}
              >
                {o.id}
              </code>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

// ── Sync Panel ────────────────────────────────────────────────────────────────

const SYNC_INTERVALS = [
  { value: 'manual', label: 'Manual only' },
  { value: '1h',  label: 'Every hour' },
  { value: '6h',  label: 'Every 6 hours' },
  { value: '12h', label: 'Every 12 hours' },
  { value: '24h', label: 'Every day' },
  { value: '7d',  label: 'Every week' },
];

const SyncPanel: React.FC<{ app: NexusApp; components: AppComponent[]; objectTypes: OntologyType[] }> = ({
  app, components, objectTypes,
}) => {
  const { updateApp } = useAppStore();
  const [syncing, setSyncing] = useState<Record<string, boolean>>({});
  const [lastSync, setLastSync] = useState<Record<string, string>>({});
  const [syncIntervalVal, setSyncIntervalVal] = useState<string>(app.syncInterval || 'manual');

  // Get unique object type IDs used in this app
  const usedOtIds = Array.from(new Set(components.map(c => c.objectTypeId).filter(Boolean)));

  const saveInterval = async (val: string) => {
    setSyncIntervalVal(val);
    await updateApp(app.id, { syncInterval: val } as Partial<NexusApp>);
  };

  const runSync = async (otId: string) => {
    setSyncing(p => ({ ...p, [otId]: true }));
    try {
      // Trigger a sync by calling the ontology service to refresh records
      await fetch(`${ONTOLOGY_API}/object-types/${otId}/records/refresh`, {
        method: 'POST',
        headers: { 'x-tenant-id': 'tenant-001' },
      }).catch(() => {});
      setLastSync(p => ({ ...p, [otId]: new Date().toISOString() }));
    } finally {
      setSyncing(p => ({ ...p, [otId]: false }));
    }
  };

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: 32, backgroundColor: '#F8FAFC' }}>
      <div style={{ maxWidth: 640, margin: '0 auto' }}>
        <div style={{ marginBottom: 28 }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: '#0D1117', marginBottom: 4 }}>Data Sync</div>
          <div style={{ fontSize: 13, color: '#64748B' }}>Configure sync frequency and trigger manual syncs for each data source.</div>
        </div>

        {/* Schedule */}
        <div style={{ backgroundColor: '#fff', border: '1px solid #E2E8F0', borderRadius: 10, padding: 20, marginBottom: 20 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#0D1117', marginBottom: 12 }}>Sync Schedule</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
            {SYNC_INTERVALS.map(opt => (
              <button
                key={opt.value}
                onClick={() => saveInterval(opt.value)}
                style={{
                  padding: '8px 10px', borderRadius: 6, cursor: 'pointer', textAlign: 'left',
                  border: syncIntervalVal === opt.value ? '2px solid #2563EB' : '1px solid #E2E8F0',
                  backgroundColor: syncIntervalVal === opt.value ? '#EFF6FF' : '#FAFAFA',
                  color: syncIntervalVal === opt.value ? '#2563EB' : '#374151',
                  fontSize: 12, fontWeight: syncIntervalVal === opt.value ? 600 : 400,
                }}
              >
                {opt.label}
              </button>
            ))}
          </div>
          {syncIntervalVal !== 'manual' && (
            <div style={{ marginTop: 10, fontSize: 12, color: '#64748B', backgroundColor: '#F1F5F9', borderRadius: 6, padding: '8px 12px' }}>
              This app syncs automatically <strong>{SYNC_INTERVALS.find(o => o.value === syncIntervalVal)?.label?.toLowerCase()}</strong>.
            </div>
          )}
        </div>

        {/* Data sources */}
        <div style={{ backgroundColor: '#fff', border: '1px solid #E2E8F0', borderRadius: 10, padding: 20 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#0D1117', marginBottom: 12 }}>Data Sources</div>
          {usedOtIds.length === 0 && (
            <div style={{ fontSize: 13, color: '#94A3B8', textAlign: 'center', padding: '24px 0' }}>
              No data sources connected. Add widgets with object types first.
            </div>
          )}
          {usedOtIds.map(otId => {
            const ot = objectTypes.find(o => o.id === otId);
            const isSyncing = syncing[otId!];
            const ls = lastSync[otId!];
            const usedByWidgets = components.filter(c => c.objectTypeId === otId).map(c => c.title || c.type);
            return (
              <div key={otId} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 0', borderBottom: '1px solid #F1F5F9' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: '#0D1117' }}>{ot?.displayName || ot?.name || 'Unknown'}</div>
                  <div style={{ fontSize: 11, color: '#94A3B8', marginTop: 2 }}>
                    Used by: {usedByWidgets.slice(0, 3).join(', ')}{usedByWidgets.length > 3 ? ` +${usedByWidgets.length - 3} more` : ''}
                  </div>
                  {ls && <div style={{ fontSize: 11, color: '#059669', marginTop: 2 }}>Synced {new Date(ls).toLocaleTimeString()}</div>}
                </div>
                <button
                  onClick={() => runSync(otId!)}
                  disabled={isSyncing}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 6,
                    padding: '6px 14px', borderRadius: 6, border: '1px solid #E2E8F0',
                    backgroundColor: isSyncing ? '#F1F5F9' : '#fff', color: isSyncing ? '#94A3B8' : '#374151',
                    fontSize: 12, fontWeight: 500, cursor: isSyncing ? 'not-allowed' : 'pointer',
                  }}
                >
                  {isSyncing ? 'Syncing…' : 'Sync now'}
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

// ── App Editor (main export) ──────────────────────────────────────────────────

type Mode = 'view' | 'edit' | 'code' | 'sync';

const AppEditor: React.FC<{ app: NexusApp }> = ({ app }) => {
  const { updateApp } = useAppStore();
  const [mode, setMode] = useState<Mode>('edit');
  const [components, setComponents] = useState<AppComponent[]>(app.components);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [fieldCopied, setFieldCopied] = useState('');
  const [canvasWidth, setCanvasWidth] = useState(900);
  const canvasRef = useRef<HTMLDivElement>(null);

  const objectTypes = useObjectTypes();

  // Measure canvas container for react-grid-layout width
  useEffect(() => {
    if (!canvasRef.current) return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w) setCanvasWidth(Math.floor(w - 48)); // subtract padding
    });
    ro.observe(canvasRef.current);
    return () => ro.disconnect();
  }, []);

  const mark = (comps: AppComponent[]) => { setComponents(comps); setDirty(true); };

  const handleSave = async () => {
    setSaving(true);
    try {
      await updateApp(app.id, { components, updatedAt: new Date().toISOString() });
      setDirty(false);
    } finally { setSaving(false); }
  };

  const addWidget = (type: ComponentType, otId?: string) => {
    const def = WIDGET_DEFS.find((w) => w.type === type)!;
    const comp: AppComponent = {
      id: `c-${Date.now()}`,
      type, title: def.label,
      colSpan: def.defaultColSpan,
      objectTypeId: otId || app.objectTypeIds?.[0],
    };
    mark([...components, comp]);
    setSelectedId(comp.id);
    if (mode !== 'edit') setMode('edit');
  };

  const addWidgetFromNL = async (prompt: string, otId: string) => {
    const ot = objectTypes.find((o) => o.id === otId);
    if (!ot) throw new Error('Object type not found');
    const fields = ot.properties.filter((p) => !p.name.endsWith('[]')).map((p) => p.name);

    // Fetch sample records for context
    let sampleRows: Record<string, unknown>[] = [];
    try {
      const r = await fetch(`${ONTOLOGY_API2}/object-types/${otId}/records`, {
        headers: { 'x-tenant-id': 'tenant-001' },
      });
      const d = await r.json();
      sampleRows = (d.records || []).slice(0, 10);
    } catch { /* ignore */ }

    const res = await fetch(`${INFERENCE_API}/infer/generate-widget`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        description: prompt,
        object_type_id: otId,
        object_type_name: ot.displayName || ot.name,
        properties: fields,
        sample_rows: sampleRows,
      }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: 'Unknown error' }));
      throw new Error(err.detail || `Status ${res.status}`);
    }
    const widgetConfig = await res.json();
    const comp: AppComponent = {
      ...widgetConfig,
      id: `c-${Date.now()}`,
      objectTypeId: widgetConfig.objectTypeId || otId,
    };
    mark([...components, comp]);
    setSelectedId(comp.id);
    if (mode !== 'edit') setMode('edit');
  };

  const handleFieldClick = (field: string) => {
    const sel = components.find((c) => c.id === selectedId);
    if (!sel) {
      setFieldCopied(field);
      setTimeout(() => setFieldCopied(''), 1500);
      return;
    }
    // Apply field to the appropriate slot of the selected widget
    let patch: Partial<AppComponent> = {};
    if (sel.type === 'metric-card') patch = { field };
    else if (sel.type === 'bar-chart') patch = sel.labelField ? { valueField: field } : { labelField: field };
    else if (sel.type === 'line-chart') patch = sel.xField ? { valueField: field } : { xField: field };
    else if (sel.type === 'filter-bar') patch = { filterField: field };
    else if (sel.type === 'data-table') patch = { columns: [...(sel.columns || []).filter((c) => c !== field), field] };
    if (Object.keys(patch).length) mark(components.map((c) => c.id === selectedId ? { ...c, ...patch } : c));
  };

  const del = (id: string) => { mark(components.filter((c) => c.id !== id)); if (selectedId === id) setSelectedId(null); };

  const selectedComp = components.find((c) => c.id === selectedId) ?? null;

  const tab = (m: Mode, icon: React.ReactNode, label: string) => (
    <button
      onClick={() => setMode(m)}
      style={{
        display: 'flex', alignItems: 'center', gap: 5,
        padding: '5px 11px', borderRadius: 4, border: 'none',
        fontSize: 12, fontWeight: 500, cursor: 'pointer',
        backgroundColor: mode === m ? '#EFF6FF' : 'transparent',
        color: mode === m ? '#2563EB' : '#64748B',
      }}
    >
      {icon}{label}
    </button>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Mode bar */}
      <div style={{
        height: 44, backgroundColor: '#fff', borderBottom: '1px solid #E2E8F0',
        display: 'flex', alignItems: 'center', padding: '0 14px', gap: 2, flexShrink: 0,
      }}>
        {tab('view',  <Eye size={13} />,    'View')}
        {tab('edit',  <Pencil size={13} />, 'Edit')}
        {tab('code',  <Code2 size={13} />,  'Code')}
        {tab('sync', <RefreshCw size={13} />, 'Sync')}

        {dirty && (
          <span style={{ marginLeft: 8, fontSize: 11, color: '#D97706' }}>Unsaved</span>
        )}

        {fieldCopied && (
          <span style={{ marginLeft: 8, fontSize: 11, color: '#16A34A' }}>
            Field "{fieldCopied}" copied
          </span>
        )}

        {/* widget count */}
        <span style={{
          marginLeft: 12, fontSize: 11, color: '#94A3B8',
          backgroundColor: '#F1F5F9', padding: '2px 7px', borderRadius: 10,
        }}>
          {components.length} widget{components.length !== 1 ? 's' : ''}
        </span>

        <button
          onClick={handleSave}
          disabled={!dirty || saving}
          style={{
            marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 5,
            padding: '5px 14px', border: 'none', borderRadius: 5,
            fontSize: 12, fontWeight: 500,
            cursor: dirty && !saving ? 'pointer' : 'default',
            backgroundColor: dirty && !saving ? '#2563EB' : '#E2E8F0',
            color: dirty && !saving ? '#fff' : '#94A3B8',
          }}
        >
          <Save size={13} />{saving ? 'Saving…' : 'Save'}
        </button>
      </div>

      {/* Body */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        {mode === 'view' && (
          <div style={{ flex: 1, overflowY: 'auto', backgroundColor: '#F8FAFC' }}>
            <AppCanvas app={{ ...app, components }} />
          </div>
        )}

        {mode === 'edit' && (
          <>
            <LeftSidebar
              objectTypes={objectTypes}
              onAddWidget={addWidget}
              onAddWidgetFromNL={addWidgetFromNL}
              onClickField={handleFieldClick}
            />
            <div ref={canvasRef} style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
              <EditCanvas
                components={components}
                selectedId={selectedId}
                onSelect={setSelectedId}
                onLayoutChange={mark}
                onDelete={del}
                objectTypes={objectTypes}
                containerWidth={canvasWidth}
              />
            </div>
            {selectedComp && (
              <ConfigPanel
                comp={selectedComp}
                objectTypes={objectTypes}
                onChange={(c) => mark(components.map((x) => x.id === c.id ? c : x))}
                onDelete={() => del(selectedComp.id)}
              />
            )}
          </>
        )}

        {mode === 'code' && (
          <CodeEditor
            components={components}
            objectTypes={objectTypes}
            onChange={(c) => mark(c)}
          />
        )}

        {mode === 'sync' && (
          <SyncPanel app={app} components={components} objectTypes={objectTypes} />
        )}
      </div>
    </div>
  );
};

export default AppEditor;
