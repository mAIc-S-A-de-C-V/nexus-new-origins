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
  Database, Tag, MessageSquare, Sparkles, Loader, Braces, MapPin, Wrench,
  PieChart, AreaChart, TrendingUp, ListFilter, FileText, TableProperties, Variable,
  Layers, Play, FilePlus, CheckSquare, Edit3,
} from 'lucide-react';
import { NexusApp, AppComponent, ComponentType, AppFilter, FilterOperator, AppVariable, DashboardFilterBar, RangePreset, AppEvent, AppEventAction, ContextBinding, AppAction, ActionKind } from '../../types/app';
import { suggestedBucketForRange, detectEavPattern, type EavPattern } from './queryBuilder';
import { useAppStore } from '../../store/appStore';
import { getTenantId } from '../../store/authStore';
import AppCanvas from './AppCanvas';

const ONTOLOGY_API = import.meta.env.VITE_ONTOLOGY_SERVICE_URL || 'http://localhost:8004';

// ── Types ────────────────────────────────────────────────────────────────────

interface OTProp { name: string; semantic_type?: string; data_type?: string; display_name?: string }
interface OntologyType { id: string; name: string; displayName: string; properties: OTProp[]; sourcePipelineId?: string }

// ── Hooks ─────────────────────────────────────────────────────────────────────

// Small sample of records used ONLY for inferring field names when the
// object type has no declared properties. Capped at 50 rows.
function useRecordsForFilter(objectTypeId?: string) {
  const [records, setRecords] = useState<Record<string, unknown>[]>([]);
  useEffect(() => {
    if (!objectTypeId) { setRecords([]); return; }
    fetch(`${ONTOLOGY_API}/object-types/${objectTypeId}/records?limit=50`, {
      headers: { 'x-tenant-id': getTenantId() },
    })
      .then((r) => r.json())
      .then((d) => setRecords(d.records || []))
      .catch(() => setRecords([]));
  }, [objectTypeId]);
  return records;
}

// Distinct values for one field, computed server-side via /aggregate.
// Returns ALL distinct values across the table (capped at 200), not just
// what shows up in the first sample of records. Used by the filter row's
// "pick a value" dropdown.
function useDistinctValues(objectTypeId?: string, fieldName?: string): string[] {
  const [values, setValues] = useState<string[]>([]);
  useEffect(() => {
    if (!objectTypeId || !fieldName) { setValues([]); return; }
    let cancelled = false;
    fetch(`${ONTOLOGY_API}/object-types/${objectTypeId}/aggregate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-tenant-id': getTenantId() },
      body: JSON.stringify({
        group_by: fieldName,
        aggregations: [{ method: 'count' }],
        sort_by: 'agg_0',
        sort_dir: 'desc',
        limit: 200,
      }),
    })
      .then((r) => r.ok ? r.json() : { rows: [] })
      .then((d: { rows: Array<{ group: string | null }> }) => {
        if (cancelled) return;
        const out = (d.rows || [])
          .map((r) => String(r.group ?? ''))
          .filter(Boolean);
        setValues(out);
      })
      .catch(() => { if (!cancelled) setValues([]); });
    return () => { cancelled = true; };
  }, [objectTypeId, fieldName]);
  return values;
}

function useObjectTypes() {
  const [ots, setOts] = useState<OntologyType[]>([]);
  useEffect(() => {
    fetch(`${ONTOLOGY_API}/object-types`, { headers: { 'x-tenant-id': getTenantId() } })
      .then((r) => r.json())
      .then((d) => setOts((d.object_types || d || []).map((o: Record<string, unknown>) => ({
        id: o.id,
        name: (o.name || o.display_name) as string,
        displayName: (o.display_name || o.name) as string,
        properties: ((o.properties || []) as OTProp[]),
        // Backend returns this snake_cased; the SyncPanel needs it to
        // look up which pipeline backs each OT.
        sourcePipelineId: (o.source_pipeline_id as string | undefined) || undefined,
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
  { type: 'pie-chart',    label: 'Pie Chart',    icon: <PieChart size={13} />,           defaultColSpan: 4,  description: 'Pie / donut proportional chart' },
  { type: 'area-chart',   label: 'Area Chart',   icon: <AreaChart size={13} />,          defaultColSpan: 6,  description: 'Stacked area for trends over time' },
  { type: 'pivot-table',  label: 'Pivot Table',  icon: <TableProperties size={13} />,    defaultColSpan: 12, description: 'Cross-tab: rows × time buckets, aggregated cells' },
  { type: 'stat-card',    label: 'Stat Number',  icon: <TrendingUp size={13} />,         defaultColSpan: 3,  description: 'Large number with trend arrow' },
  { type: 'filter-bar',   label: 'Filter Bar',   icon: <SlidersHorizontal size={13} />,  defaultColSpan: 12, description: 'Interactive filter chips' },
  { type: 'date-picker',  label: 'Date Picker',  icon: <SlidersHorizontal size={13} />,  defaultColSpan: 6,  description: 'Date range filter for all widgets' },
  { type: 'text-block',   label: 'Text Block',   icon: <AlignLeft size={13} />,          defaultColSpan: 12, description: 'Rich text / notes' },
  { type: 'chat-widget',  label: 'Chat',         icon: <MessageSquare size={13} />,      defaultColSpan: 12, description: 'Ask questions about data with AI' },
  { type: 'custom-code',  label: 'Custom Code',  icon: <Braces size={13} />,             defaultColSpan: 12, description: 'AI-generated custom visualization' },
  { type: 'map',           label: 'Map',           icon: <MapPin size={13} />,             defaultColSpan: 6,  description: 'Pin locations on a map using lat/lng fields' },
  { type: 'utility-output', label: 'Utility Output', icon: <Wrench size={13} />,          defaultColSpan: 6,  description: 'Run a utility and display its result' },
  { type: 'dropdown-filter', label: 'Dropdown Filter', icon: <ListFilter size={13} />,   defaultColSpan: 3,  description: 'Dropdown that sets a variable' },
  { type: 'form',            label: 'Form',            icon: <FileText size={13} />,      defaultColSpan: 6,  description: 'Input form with submit action' },
  { type: 'object-table',    label: 'Object Table',    icon: <TableProperties size={13} />, defaultColSpan: 12, description: 'Sortable table with variable bindings' },
  { type: 'composite',       label: 'Card (Composite)', icon: <Layers size={13} />,        defaultColSpan: 12, description: 'Container card holding nested widgets' },
  { type: 'action-button',   label: 'Action Button',   icon: <Play size={13} />,           defaultColSpan: 4,  description: 'Button that fires a typed action' },
  { type: 'object-editor',   label: 'Object Editor',   icon: <Edit3 size={13} />,          defaultColSpan: 6,  description: 'Read+write form for a single record' },
  { type: 'record-creator',  label: 'Record Creator',  icon: <FilePlus size={13} />,       defaultColSpan: 6,  description: 'Multi-step wizard to create records' },
  { type: 'approval-queue',  label: 'Approval Queue',  icon: <CheckSquare size={13} />,    defaultColSpan: 12, description: 'Table with per-row approve/reject buttons' },
  { type: 'file-upload',     label: 'File Upload',     icon: <FilePlus size={13} />,       defaultColSpan: 6,  description: 'Upload a doc, OCR/vision-extract, autofill the form' },
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
  onAddWidgetFromNL: (prompt: string, otId: string, mode?: 'widget' | 'code' | 'card') => Promise<void>;
  onClickField: (field: string) => void;
  variables: AppVariable[];
  onVariablesChange: (vars: AppVariable[]) => void;
}> = ({ objectTypes, onAddWidget, onAddWidgetFromNL, onClickField, variables, onVariablesChange }) => {
  const [expandedOt, setExpandedOt] = useState<string | null>(null);
  const [nlPrompt, setNlPrompt] = useState('');
  const [nlOtId, setNlOtId] = useState('');
  const [nlLoading, setNlLoading] = useState(false);
  const [nlError, setNlError] = useState('');
  const [genMode, setGenMode] = useState<'widget' | 'code' | 'card'>('widget');
  const nlRef = useRef<HTMLTextAreaElement>(null);

  const handleNlGenerate = async () => {
    if (!nlPrompt.trim() || !nlOtId) return;
    setNlLoading(true);
    setNlError('');
    try {
      await onAddWidgetFromNL(nlPrompt.trim(), nlOtId, genMode);
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
        {/* Mode selector — Widget / Code / Card */}
        <div style={{
          display: 'flex', marginTop: 6, gap: 0,
          border: '1px solid #DDD6FE', borderRadius: 5, overflow: 'hidden',
        }}>
          {(['widget', 'code', 'card'] as const).map((m) => {
            const active = genMode === m;
            const label = m === 'widget' ? 'Widget' : m === 'code' ? 'Code' : 'Card';
            return (
              <button
                key={m}
                onClick={() => setGenMode(m)}
                style={{
                  flex: 1, padding: '4px 0', border: 'none', borderRight: m !== 'card' ? '1px solid #DDD6FE' : 'none',
                  fontSize: 10, fontWeight: 600,
                  color: active ? '#fff' : '#7C3AED',
                  backgroundColor: active ? '#7C3AED' : '#FAF5FF',
                  cursor: 'pointer',
                }}
              >
                {label}
              </button>
            );
          })}
        </div>
        {genMode === 'code' && (
          <div style={{ fontSize: 10, color: '#7C3AED', marginTop: 3, lineHeight: 1.4 }}>
            AI writes code for anything you want — custom charts, rankings, calculations.
          </div>
        )}
        {genMode === 'card' && (
          <div style={{ fontSize: 10, color: '#7C3AED', marginTop: 3, lineHeight: 1.4 }}>
            AI builds a composite card — a banner + chart + sidebar layout in one container.
          </div>
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
          {nlLoading
            ? <><Loader size={10} style={{ animation: 'spin 1s linear infinite' }} /> Generating…</>
            : genMode === 'code'
              ? <><Sparkles size={10} /> Generate Code</>
              : genMode === 'card'
                ? <><Sparkles size={10} /> Generate Card</>
                : <><Sparkles size={10} /> Generate Widget</>}
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

      {/* Variables section */}
      <div style={{ padding: '8px 10px 6px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <Variable size={11} color="#7C3AED" />
            <span style={{ fontSize: 10, fontWeight: 600, color: '#7C3AED', letterSpacing: '0.06em' }}>
              VARIABLES
            </span>
          </div>
          <button
            onClick={() => {
              const newVar: AppVariable = {
                id: `var-${Date.now()}`,
                name: `variable${variables.length + 1}`,
                type: 'string',
                defaultValue: '',
              };
              onVariablesChange([...variables, newVar]);
            }}
            style={{
              display: 'flex', alignItems: 'center', gap: 2,
              padding: '2px 6px', border: '1px solid #DDD6FE', borderRadius: 3,
              fontSize: 10, cursor: 'pointer', backgroundColor: '#FAF5FF', color: '#7C3AED',
            }}
          >
            <Plus size={9} /> Add
          </button>
        </div>
        {variables.length === 0 && (
          <div style={{ fontSize: 10, color: '#CBD5E1', padding: '2px 0 4px' }}>
            No variables defined
          </div>
        )}
        {variables.map((v, idx) => (
          <div key={v.id} style={{
            marginBottom: 4, padding: '5px 6px', backgroundColor: '#FAF5FF',
            border: '1px solid #EDE9FE', borderRadius: 4, fontSize: 10,
          }}>
            <div style={{ display: 'flex', gap: 4, marginBottom: 3 }}>
              <input
                value={v.name}
                onChange={(e) => {
                  const updated = [...variables];
                  updated[idx] = { ...v, name: e.target.value };
                  onVariablesChange(updated);
                }}
                placeholder="name"
                style={{
                  flex: 1, height: 20, padding: '0 4px', border: '1px solid #DDD6FE',
                  borderRadius: 3, fontSize: 10, color: '#1E1B4B', backgroundColor: '#fff',
                  outline: 'none', fontFamily: 'var(--font-mono)',
                }}
              />
              <select
                value={v.type}
                onChange={(e) => {
                  const updated = [...variables];
                  updated[idx] = { ...v, type: e.target.value as AppVariable['type'] };
                  onVariablesChange(updated);
                }}
                style={{
                  width: 70, height: 20, padding: '0 2px', border: '1px solid #DDD6FE',
                  borderRadius: 3, fontSize: 9, color: '#1E1B4B', backgroundColor: '#fff',
                  outline: 'none',
                }}
              >
                <option value="string">string</option>
                <option value="number">number</option>
                <option value="boolean">boolean</option>
                <option value="dateRange">dateRange</option>
                <option value="stringArray">stringArray</option>
                <option value="objectRef">objectRef</option>
                <option value="objectSet">objectSet</option>
              </select>
              <button
                onClick={() => onVariablesChange(variables.filter((_, i) => i !== idx))}
                style={{
                  width: 18, height: 20, border: '1px solid #FCA5A5', borderRadius: 3,
                  backgroundColor: '#FEF2F2', color: '#DC2626', cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0,
                  fontSize: 10,
                }}
              >
                <Trash2 size={8} />
              </button>
            </div>
            <input
              value={v.defaultValue ?? ''}
              onChange={(e) => {
                const updated = [...variables];
                updated[idx] = { ...v, defaultValue: e.target.value };
                onVariablesChange(updated);
              }}
              placeholder="default value"
              style={{
                width: '100%', height: 18, padding: '0 4px', border: '1px solid #EDE9FE',
                borderRadius: 3, fontSize: 9, color: '#64748B', backgroundColor: '#fff',
                outline: 'none', boxSizing: 'border-box',
              }}
            />
            <div style={{ fontSize: 8, color: '#A78BFA', marginTop: 2, fontFamily: 'var(--font-mono)' }}>
              ID: {v.id}
            </div>
          </div>
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
      headers: { 'x-tenant-id': getTenantId() },
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
  'bar-chart': 5, 'line-chart': 4, 'pie-chart': 5, 'area-chart': 5, 'stat-card': 3, 'date-picker': 2,
  'data-table': 6, 'chat-widget': 7, 'dropdown-filter': 2, 'form': 5, 'object-table': 6,
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

const OPERATORS: { value: FilterOperator; label: string; noValue?: boolean; multi?: boolean }[] = [
  { value: 'eq',          label: '=' },
  { value: 'neq',         label: '≠' },
  { value: 'in',          label: 'in (any of)',  multi: true },
  { value: 'not_in',      label: 'not in',       multi: true },
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
  objectTypeId?: string;
  onUpdate: (patch: Partial<AppFilter>) => void;
  onRemove: () => void;
}> = ({ f, fields, objectTypeId, onUpdate, onRemove }) => {
  const opDef = (op: FilterOperator) => OPERATORS.find((o) => o.value === op);
  const noVal = opDef(f.operator)?.noValue;
  const isMulti = opDef(f.operator)?.multi;
  const isDate = isDateField(f.field) && !isMulti;
  const listId = `dl-${f.id}`;

  // Server-side distinct values via /aggregate. Returns ALL values across the
  // table (capped at 200), not just what's in the first 50 records like before.
  const distinctValsRaw = useDistinctValues(objectTypeId, f.field);
  const distinctVals = React.useMemo(() => [...distinctValsRaw].sort(), [distinctValsRaw]);

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
        isMulti ? (
          /* Comma-separated list for IN / NOT IN, e.g. "rpm, running, temp" */
          <input
            value={f.value}
            onChange={(e) => onUpdate({ value: e.target.value })}
            placeholder="comma-separated, e.g. rpm, running, temp"
            list={distinctVals.length > 0 ? listId : undefined}
            style={{
              width: '100%', height: 24, padding: '0 6px',
              border: '1px solid #E2E8F0', borderRadius: 4,
              fontSize: 11, color: '#0D1117', backgroundColor: '#fff',
              boxSizing: 'border-box',
            }}
          />
        ) : isDate ? (
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

  // If the object type has no declared properties (common for dynamic/sensor
  // data), fall back to inferring fields from the loaded records so the user
  // can still pick a column to filter on.
  const inferredFields = React.useMemo(() => {
    if (fields.length > 0) return fields;
    if (!allRecords.length) return [];
    const seen = new Set<string>();
    for (const r of allRecords.slice(0, 50)) {
      Object.keys(r || {}).forEach((k) => { if (!k.endsWith('[]')) seen.add(k); });
    }
    return Array.from(seen);
  }, [fields, allRecords]);

  const effectiveFields = fields.length > 0 ? fields : inferredFields;

  const add = () => onChange([
    ...filters,
    { id: `f-${Date.now()}`, field: effectiveFields[0] || '', operator: 'eq', value: '' },
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
          fields={effectiveFields}
          objectTypeId={objectTypeId}
          onUpdate={(patch) => update(f.id, patch)}
          onRemove={() => remove(f.id)}
        />
      ))}
    </div>
  );
};

// ── Right config panel ────────────────────────────────────────────────────────

const AGG_OPTIONS = ['count', 'sum', 'avg', 'max', 'min', 'runtime'];
const COLSPAN_OPTIONS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

// CRITICAL: these are at module scope on purpose. If you move them inside
// ConfigPanel, every render creates a fresh component identity and React
// remounts the entire subtree — meaning every keystroke in any input loses
// focus. Don't do that again.

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

// FieldPicker takes the field list as a prop (not via closure) so it
// stays a stable component reference across parent renders — keeps focus
// in inputs that are siblings of it, and avoids unmount churn here too.
const FieldPickerCmp: React.FC<{ fields: string[]; value: string | undefined; onPick: (f: string) => void; placeholder?: string }> = ({ fields, value, onPick, placeholder }) => (
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

// FieldsEditor — visual editor for AppComponent.fields[]. Used by form,
// record-creator, and object-editor widgets. Each field is { name, label,
// type, ...optional config }.
//
// Two field types take extra config rows in the UI:
//   · select        → comma-separated `options` string
//   · record-select → object type picker + display field
type FormField = NonNullable<AppComponent['fields']>[number];
const FieldsEditor: React.FC<{
  fields: FormField[];
  onChange: (next: FormField[]) => void;
  objectTypes?: OntologyType[];
}> = ({ fields, onChange, objectTypes = [] }) => {
  const update = (i: number, patch: Partial<FormField>) => {
    const next = [...fields];
    next[i] = { ...next[i], ...patch };
    onChange(next);
  };
  const remove = (i: number) => onChange(fields.filter((_, idx) => idx !== i));
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {fields.length === 0 && (
        <div style={{ fontSize: 10, color: '#CBD5E1' }}>No fields. Add at least one.</div>
      )}
      {fields.map((f, i) => (
        <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 3, padding: 4, border: '1px solid #F1F5F9', borderRadius: 3 }}>
          <div style={{ display: 'flex', gap: 4 }}>
            <input
              value={f.name}
              onChange={(e) => update(i, { name: e.target.value })}
              placeholder="name"
              style={{ flex: 1, height: 22, padding: '0 6px', fontSize: 10, border: '1px solid #E2E8F0', borderRadius: 3 }}
            />
            <input
              value={f.label}
              onChange={(e) => update(i, { label: e.target.value })}
              placeholder="label"
              style={{ flex: 1, height: 22, padding: '0 6px', fontSize: 10, border: '1px solid #E2E8F0', borderRadius: 3 }}
            />
            <select
              value={f.type}
              onChange={(e) => update(i, { type: e.target.value as FormField['type'] })}
              style={{ width: 78, height: 22, padding: '0 4px', fontSize: 10, border: '1px solid #E2E8F0', borderRadius: 3 }}
            >
              <option value="text">text</option>
              <option value="number">number</option>
              <option value="boolean">boolean</option>
              <option value="textarea">textarea</option>
              <option value="select">select</option>
              <option value="date">date</option>
              <option value="record-select">record picker</option>
            </select>
            <button
              onClick={() => remove(i)}
              style={{ width: 22, height: 22, fontSize: 10, border: '1px solid #FCA5A5', borderRadius: 3, backgroundColor: '#FEF2F2', color: '#DC2626', cursor: 'pointer' }}
            >×</button>
          </div>
          {f.type === 'select' && (
            <input
              value={(f.options || []).join(', ')}
              onChange={(e) => update(i, {
                options: e.target.value.split(',').map((s) => s.trim()).filter(Boolean),
              })}
              placeholder="options (comma-separated, e.g. in, out, transfer)"
              style={{ height: 20, padding: '0 6px', fontSize: 9, border: '1px solid #E2E8F0', borderRadius: 3, color: '#64748B' }}
            />
          )}
          {f.type === 'record-select' && (() => {
            const pickedType = objectTypes.find((ot) => ot.id === f.recordTypeId);
            const propNames = (pickedType?.properties || []).map((p) => p.name).filter(Boolean);
            // When the user picks an object type for the first time, default
            // the display field to 'name' if it exists, otherwise the first
            // property — saves a click in the common case.
            const handleTypePick = (typeId: string) => {
              const t = objectTypes.find((ot) => ot.id === typeId);
              const names = (t?.properties || []).map((p) => p.name).filter(Boolean);
              const autoDisplay = !f.recordDisplayField
                ? (names.includes('name') ? 'name' : (names[0] || ''))
                : f.recordDisplayField;
              update(i, { recordTypeId: typeId, recordDisplayField: autoDisplay });
            };
            return (
              <>
                <select
                  value={f.recordTypeId || ''}
                  onChange={(e) => handleTypePick(e.target.value)}
                  style={{ height: 20, padding: '0 4px', fontSize: 9, border: '1px solid #E2E8F0', borderRadius: 3, color: '#64748B' }}
                >
                  <option value="">— pick object type —</option>
                  {objectTypes.map((ot) => (
                    <option key={ot.id} value={ot.id}>{ot.displayName || ot.name}</option>
                  ))}
                </select>
                {pickedType ? (
                  <select
                    value={f.recordDisplayField || ''}
                    onChange={(e) => update(i, { recordDisplayField: e.target.value })}
                    style={{ height: 20, padding: '0 4px', fontSize: 9, border: '1px solid #E2E8F0', borderRadius: 3, color: '#64748B' }}
                  >
                    <option value="">— pick display field —</option>
                    {propNames.map((p) => <option key={p} value={p}>{p}</option>)}
                  </select>
                ) : (
                  <div style={{ fontSize: 9, color: '#CBD5E1', fontStyle: 'italic', padding: '2px 0' }}>
                    Pick an object type above to see its properties.
                  </div>
                )}
              </>
            );
          })()}
        </div>
      ))}
      <button
        onClick={() => onChange([...fields, { name: '', label: '', type: 'text' }])}
        style={{
          padding: '3px 0', fontSize: 10, color: '#7C3AED',
          border: '1px dashed #DDD6FE', borderRadius: 3,
          backgroundColor: 'transparent', cursor: 'pointer',
        }}
      >+ Field</button>
    </div>
  );
};

// StepsEditor — visual editor for AppComponent.steps[] (record-creator
// multi-step wizard). Each step has a title and a list of field names that
// must already exist in `fields`.
type WizardStep = NonNullable<AppComponent['steps']>[number];
const StepsEditor: React.FC<{
  steps: WizardStep[];
  fieldNames: string[];
  onChange: (next: WizardStep[]) => void;
}> = ({ steps, fieldNames, onChange }) => {
  const update = (i: number, patch: Partial<WizardStep>) => {
    const next = [...steps];
    next[i] = { ...next[i], ...patch };
    onChange(next);
  };
  const remove = (i: number) => onChange(steps.filter((_, idx) => idx !== i));
  const toggleField = (stepIdx: number, name: string) => {
    const step = steps[stepIdx];
    const has = step.fields.includes(name);
    update(stepIdx, {
      fields: has ? step.fields.filter((f) => f !== name) : [...step.fields, name],
    });
  };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {steps.length === 0 && (
        <div style={{ fontSize: 10, color: '#CBD5E1' }}>
          No wizard steps — all fields appear on a single page.
        </div>
      )}
      {steps.map((s, i) => (
        <div key={i} style={{ border: '1px solid #F1F5F9', borderRadius: 3, padding: 6 }}>
          <div style={{ display: 'flex', gap: 4, marginBottom: 4 }}>
            <input
              value={s.title}
              onChange={(e) => update(i, { title: e.target.value })}
              placeholder={`Step ${i + 1} title`}
              style={{ flex: 1, height: 22, padding: '0 6px', fontSize: 10, border: '1px solid #E2E8F0', borderRadius: 3 }}
            />
            <button
              onClick={() => remove(i)}
              style={{ width: 22, height: 22, fontSize: 10, border: '1px solid #FCA5A5', borderRadius: 3, backgroundColor: '#FEF2F2', color: '#DC2626', cursor: 'pointer' }}
            >×</button>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
            {fieldNames.length === 0 && (
              <span style={{ fontSize: 9, color: '#CBD5E1' }}>Add fields above first.</span>
            )}
            {fieldNames.map((name) => {
              const on = s.fields.includes(name);
              return (
                <button
                  key={name}
                  onClick={() => toggleField(i, name)}
                  style={{
                    padding: '2px 6px', fontSize: 9,
                    border: `1px solid ${on ? '#7C3AED' : '#E2E8F0'}`,
                    backgroundColor: on ? '#FAF5FF' : '#fff',
                    color: on ? '#7C3AED' : '#64748B',
                    borderRadius: 3, cursor: 'pointer',
                  }}
                >{name}</button>
              );
            })}
          </div>
        </div>
      ))}
      <button
        onClick={() => onChange([...steps, { title: `Step ${steps.length + 1}`, fields: [] }])}
        style={{
          padding: '3px 0', fontSize: 10, color: '#7C3AED',
          border: '1px dashed #DDD6FE', borderRadius: 3,
          backgroundColor: 'transparent', cursor: 'pointer',
        }}
      >+ Step</button>
    </div>
  );
};

// FileUploadSchemaEditor — Phase 8. Lets the user declare which fields the
// vision model should extract from the uploaded document, and which app
// variable each extracted field should be written to (so sibling form
// widgets autofill via their existing inputBindings).
type ExtractionField = { name: string; description?: string; type?: 'string' | 'number' | 'date' | 'boolean' };
const FileUploadSchemaEditor: React.FC<{
  schema: ExtractionField[];
  fieldVariableMap: Record<string, string>;
  variables: AppVariable[];
  onChange: (schema: ExtractionField[], map: Record<string, string>) => void;
}> = ({ schema, fieldVariableMap, variables, onChange }) => {
  const updateRow = (i: number, patch: Partial<ExtractionField>) => {
    const next = [...schema];
    next[i] = { ...next[i], ...patch };
    onChange(next, fieldVariableMap);
  };
  const removeRow = (i: number) => {
    const removed = schema[i].name;
    const nextMap = { ...fieldVariableMap };
    delete nextMap[removed];
    onChange(schema.filter((_, idx) => idx !== i), nextMap);
  };
  const updateMap = (fieldName: string, varId: string) => {
    const nextMap = { ...fieldVariableMap };
    if (varId) nextMap[fieldName] = varId; else delete nextMap[fieldName];
    onChange(schema, nextMap);
  };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {schema.length === 0 && (
        <div style={{ fontSize: 10, color: '#CBD5E1' }}>
          No fields. Add at least one — they're sent to the vision model as the extraction target.
        </div>
      )}
      {schema.map((f, i) => (
        <div key={i} style={{
          padding: 4, border: '1px solid #F1F5F9', borderRadius: 3,
          display: 'flex', flexDirection: 'column', gap: 3,
        }}>
          <div style={{ display: 'flex', gap: 4 }}>
            <input
              value={f.name}
              onChange={(e) => updateRow(i, { name: e.target.value })}
              placeholder="field name (e.g. amount)"
              style={{ flex: 2, height: 22, padding: '0 6px', fontSize: 10, border: '1px solid #E2E8F0', borderRadius: 3 }}
            />
            <select
              value={f.type || 'string'}
              onChange={(e) => updateRow(i, { type: e.target.value as ExtractionField['type'] })}
              style={{ width: 70, height: 22, padding: '0 4px', fontSize: 10, border: '1px solid #E2E8F0', borderRadius: 3 }}
            >
              <option value="string">string</option>
              <option value="number">number</option>
              <option value="date">date</option>
              <option value="boolean">boolean</option>
            </select>
            <button
              onClick={() => removeRow(i)}
              style={{ width: 22, height: 22, fontSize: 10, border: '1px solid #FCA5A5', borderRadius: 3, backgroundColor: '#FEF2F2', color: '#DC2626', cursor: 'pointer' }}
            >×</button>
          </div>
          <input
            value={f.description || ''}
            onChange={(e) => updateRow(i, { description: e.target.value })}
            placeholder="hint for the vision model (optional)"
            style={{ height: 20, padding: '0 6px', fontSize: 9, border: '1px solid #E2E8F0', borderRadius: 3, color: '#64748B' }}
          />
          <select
            value={fieldVariableMap[f.name] || ''}
            onChange={(e) => updateMap(f.name, e.target.value)}
            style={{ height: 20, padding: '0 4px', fontSize: 9, border: '1px solid #E2E8F0', borderRadius: 3, color: '#64748B' }}
          >
            <option value="">— autofill into variable (optional) —</option>
            {variables.map((v) => <option key={v.id} value={v.id}>→ {v.name}</option>)}
          </select>
        </div>
      ))}
      <button
        onClick={() => onChange([...schema, { name: '', type: 'string' }], fieldVariableMap)}
        style={{
          padding: '3px 0', fontSize: 10, color: '#7C3AED',
          border: '1px dashed #DDD6FE', borderRadius: 3,
          backgroundColor: 'transparent', cursor: 'pointer',
        }}
      >+ Field to extract</button>
    </div>
  );
};

// Widget types where the VALUE FORMAT control is meaningful — anything
// that ends up rendering aggregated numbers. Filters / forms / chat etc.
// don't show the section.
const VALUE_FORMATTABLE = new Set<ComponentType>([
  'metric-card', 'kpi-banner', 'stat-card',
  'bar-chart', 'line-chart', 'pie-chart', 'area-chart',
  'pivot-table',
]);

type ValueFormatPreset =
  | 'none' | 'sec_to_hr' | 'sec_to_min' | 'ms_to_sec'
  | 'div_k' | 'div_m' | 'x100_pct' | 'custom';

// Reverse-derive which preset the widget's current numeric config matches.
// Anything that doesn't match a named preset (but has any field set) is
// treated as 'custom' so the user keeps editing those fields manually.
//
// The explicit `valueFormatPreset === 'custom'` flag short-circuits the
// auto-match — needed because the user may have picked Custom but kept
// values that still happen to equal a named preset (e.g. starting from
// "Seconds → Hours" then opening Custom to tweak the multiplier).
function valueFormatPresetOf(comp: AppComponent): ValueFormatPreset {
  if (comp.valueFormatPreset === 'custom') return 'custom';
  const m = comp.valueMultiplier;
  const u = comp.valueUnit;
  if (m == null && u == null) return 'none';
  if (m === 1 / 3600 && u === ' h') return 'sec_to_hr';
  if (m === 1 / 60 && u === ' min') return 'sec_to_min';
  if (m === 1 / 1000 && u === ' s') return 'ms_to_sec';
  if (m === 1 / 1000 && u === 'k') return 'div_k';
  if (m === 1 / 1_000_000 && u === 'M') return 'div_m';
  if (m === 100 && u === '%') return 'x100_pct';
  return 'custom';
}

// Build the patch that applying a preset should produce. Returns the
// fields to merge into the widget — leaves decimals alone unless the user
// hasn't set one yet. Also clears or sets the `valueFormatPreset` flag
// so the dropdown sticks even when prior values match a named preset.
function applyValueFormatPreset(comp: AppComponent, preset: ValueFormatPreset): Partial<AppComponent> {
  const keepDec = comp.valueDecimals;
  switch (preset) {
    case 'none':       return { valueMultiplier: undefined, valueUnit: undefined, valueDecimals: undefined, valueFormatPreset: undefined };
    case 'sec_to_hr':  return { valueMultiplier: 1 / 3600, valueUnit: ' h',   valueDecimals: keepDec ?? 1, valueFormatPreset: undefined };
    case 'sec_to_min': return { valueMultiplier: 1 / 60,   valueUnit: ' min', valueDecimals: keepDec ?? 1, valueFormatPreset: undefined };
    case 'ms_to_sec':  return { valueMultiplier: 1 / 1000, valueUnit: ' s',   valueDecimals: keepDec ?? 2, valueFormatPreset: undefined };
    case 'div_k':      return { valueMultiplier: 1 / 1000, valueUnit: 'k',    valueDecimals: keepDec ?? 1, valueFormatPreset: undefined };
    case 'div_m':      return { valueMultiplier: 1 / 1_000_000, valueUnit: 'M', valueDecimals: keepDec ?? 1, valueFormatPreset: undefined };
    case 'x100_pct':   return { valueMultiplier: 100,     valueUnit: '%',    valueDecimals: keepDec ?? 1, valueFormatPreset: undefined };
    case 'custom':     return { valueMultiplier: comp.valueMultiplier ?? 1, valueUnit: comp.valueUnit ?? '', valueFormatPreset: 'custom' };
  }
}

const ConfigPanel: React.FC<{
  comp: AppComponent;
  objectTypes: OntologyType[];
  allComponents: AppComponent[];
  onChange: (c: AppComponent) => void;
  onDelete: () => void;
  events?: AppEvent[];
  onEventsChange?: (evs: AppEvent[]) => void;
  actions?: AppAction[];
  variables?: AppVariable[];
  appId?: string;
}> = ({ comp, objectTypes, allComponents, onChange, onDelete, events, onEventsChange, actions, variables, appId }) => {
  const set = (patch: Partial<AppComponent>) => onChange({ ...comp, ...patch });
  const selectedOt = objectTypes.find((o) => o.id === comp.objectTypeId);
  const declaredFields = (selectedOt?.properties || [])
    .filter((p) => !p.name.endsWith('[]'))
    .map((p) => p.name);

  // Sensor / dynamic-schema OTs frequently have an empty properties list; in
  // that case, infer fields from a sample of records so the X/Y axis pickers,
  // groupBy / labelField selectors, etc. can offer something to choose.
  //
  // We MERGE declared + record-inferred fields rather than picking one path —
  // platform-internal stamps like `_pipeline_run_at` and `_pipeline_id` are
  // added by the ingest pipeline but aren't declared in the ontology, so the
  // pure-schema view would hide them. Schema-declared fields go first so the
  // user's data model is visually prioritised; system/runtime extras follow.
  const sampleRecords = useRecordsForFilter(comp.objectTypeId);
  const fields = React.useMemo(() => {
    if (declaredFields.length === 0 && !sampleRecords.length) return [] as string[];
    const declaredSet = new Set(declaredFields);
    const extras: string[] = [];
    const seenExtras = new Set<string>();
    for (const r of sampleRecords.slice(0, 50)) {
      for (const k of Object.keys(r || {})) {
        if (k.endsWith('[]')) continue;
        if (declaredSet.has(k) || seenExtras.has(k)) continue;
        seenExtras.add(k);
        extras.push(k);
      }
    }
    // Sort extras: user-ish fields first, underscored system fields last.
    extras.sort((a, b) => {
      const aSys = a.startsWith('_'); const bSys = b.startsWith('_');
      if (aSys !== bSys) return aSys ? 1 : -1;
      return a.localeCompare(b);
    });
    return [...declaredFields, ...extras];
  }, [declaredFields, sampleRecords]);

  // EAV / long-format detection on the loaded sample. When present, the
  // editor surfaces a friendly "Metric" picker that auto-creates the
  // `<attribute_col> = <metric>` filter, so the user doesn't need to know
  // about the EAV shape of their data.
  const eav: EavPattern | null = React.useMemo(
    () => detectEavPattern(sampleRecords),
    [sampleRecords],
  );

  // The metrics list from `detectEavPattern` is derived from a 50-row sample,
  // so it can miss metrics that exist in the table but aren't in that sample
  // (common with time-sorted sensor data — wifi events dominate the most
  // recent rows). Pull the authoritative list from the server.
  const eavAttrCol = eav?.attributeCol;
  const distinctMetrics = useDistinctValues(comp.objectTypeId, eavAttrCol);
  const metricList = React.useMemo(() => {
    if (distinctMetrics.length > 0) return distinctMetrics;
    return eav?.metrics || [];
  }, [distinctMetrics, eav]);

  // Track the currently-selected metric for this widget by inspecting its
  // existing filters. If the user has an `<attribute_col> = X` filter, that's
  // the active metric.
  const activeMetric: string = React.useMemo(() => {
    if (!eav) return '';
    const f = (comp.filters || []).find(
      (x) => x.field === eav.attributeCol && x.operator === 'eq',
    );
    return f ? String(f.value || '') : '';
  }, [eav, comp.filters]);

  // When the user picks a metric, replace any existing attribute filter with
  // a fresh one. Keeps every other filter the user has set.
  const setMetric = (metric: string) => {
    if (!eav) return;
    const others = (comp.filters || []).filter(
      (f) => f.field !== eav.attributeCol,
    );
    const next = metric
      ? [...others, { id: `f-${Date.now()}`, field: eav.attributeCol, operator: 'eq' as FilterOperator, value: metric }]
      : others;
    set({ filters: next });
    // For chart widgets that aggregate the value column, also fill in the
    // value field defaults if not already set — the user almost always wants
    // to chart the value column when on EAV data.
    const isChart = comp.type === 'line-chart' || comp.type === 'area-chart' || comp.type === 'bar-chart' || comp.type === 'pie-chart';
    if (isChart && !comp.valueField) {
      set({ valueField: eav.valueCol });
    }
  };

  // Helper to call the module-scoped FieldPickerCmp without repeating
  // `fields={fields}` everywhere. This is a plain function, not a
  // component — it returns JSX whose element type is the stable
  // FieldPickerCmp, so React never sees a fresh identity here.
  const FieldPicker = (props: { value: string | undefined; onPick: (f: string) => void; placeholder?: string }): React.ReactElement =>
    <FieldPickerCmp fields={fields} {...props} />;

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

        {/* Dashboard filter inheritance — only relevant for data-bound
            widgets. Default is to inherit; user can opt out per widget. */}
        {comp.objectTypeId && (
          <Row label="DASHBOARD FILTER BAR">
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#334155', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={comp.inheritDashboardFilter !== false}
                onChange={(e) => set({ inheritDashboardFilter: e.target.checked })}
              />
              Inherit time range &amp; group filter from dashboard bar
            </label>
            <div style={{ marginTop: 4, fontSize: 10, color: '#94A3B8' }}>
              Off = use this widget&apos;s own TIME RANGE / filters even when the bar is on.
            </div>
          </Row>
        )}

        {/* Numeric value transform — for any widget that displays
            aggregated numbers. Lets the user convert seconds → hours,
            bytes → MB, fractions → %, etc. without touching the data. */}
        {comp.objectTypeId && VALUE_FORMATTABLE.has(comp.type) && (
          <Row label="VALUE FORMAT">
            <select
              value={valueFormatPresetOf(comp)}
              onChange={(e) => {
                const preset = e.target.value as ValueFormatPreset;
                set(applyValueFormatPreset(comp, preset));
              }}
              style={{ width: '100%', padding: '6px 8px', border: '1px solid #E2E8F0', borderRadius: 4, fontSize: 12, marginBottom: 6 }}
            >
              <option value="none">No transform (raw)</option>
              <option value="sec_to_hr">Seconds → Hours (÷ 3600)</option>
              <option value="sec_to_min">Seconds → Minutes (÷ 60)</option>
              <option value="ms_to_sec">Milliseconds → Seconds (÷ 1000)</option>
              <option value="div_k">÷ 1,000 (k)</option>
              <option value="div_m">÷ 1,000,000 (M)</option>
              <option value="x100_pct">× 100 with % suffix</option>
              <option value="custom">Custom…</option>
            </select>
            {valueFormatPresetOf(comp) === 'custom' && (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginTop: 4 }}>
                <div>
                  <Lbl>MULTIPLIER</Lbl>
                  <input
                    type="number" step="any"
                    value={comp.valueMultiplier ?? 1}
                    onChange={(e) => set({ valueMultiplier: parseFloat(e.target.value) || 1 })}
                    style={{ width: '100%', height: 26, padding: '0 6px', border: '1px solid #E2E8F0', borderRadius: 4, fontSize: 12 }}
                  />
                </div>
                <div>
                  <Lbl>SUFFIX</Lbl>
                  <input
                    value={comp.valueUnit ?? ''}
                    onChange={(e) => set({ valueUnit: e.target.value || undefined })}
                    placeholder="' h', ' kg', etc."
                    style={{ width: '100%', height: 26, padding: '0 6px', border: '1px solid #E2E8F0', borderRadius: 4, fontSize: 12 }}
                  />
                </div>
              </div>
            )}
            <div style={{ marginTop: 6 }}>
              <Lbl>DECIMALS</Lbl>
              <input
                type="number" min={0} max={8}
                value={comp.valueDecimals ?? ''}
                onChange={(e) => {
                  const v = e.target.value;
                  set({ valueDecimals: v === '' ? undefined : Math.max(0, Math.min(8, parseInt(v, 10) || 0)) });
                }}
                placeholder="auto"
                style={{ width: 80, height: 26, padding: '0 6px', border: '1px solid #E2E8F0', borderRadius: 4, fontSize: 12 }}
              />
            </div>
          </Row>
        )}

        {/* ── Chat widget: multi-select data sources + widget context ── */}
        {comp.type === 'chat-widget' && (
          <Row label="DATA SOURCES">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <Lbl>Object Types</Lbl>
              <div style={{
                maxHeight: 140, overflowY: 'auto', border: '1px solid #E2E8F0',
                borderRadius: 6, backgroundColor: '#FAFBFC',
              }}>
                {objectTypes.map((o) => {
                  const ids = comp.objectTypeIds || (comp.objectTypeId ? [comp.objectTypeId] : []);
                  const checked = ids.includes(o.id);
                  return (
                    <label key={o.id} style={{
                      display: 'flex', alignItems: 'center', gap: 6,
                      padding: '5px 8px', cursor: 'pointer', fontSize: 12,
                      borderBottom: '1px solid #F1F5F9', color: '#0D1117',
                    }}>
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => {
                          const next = checked ? ids.filter((x) => x !== o.id) : [...ids, o.id];
                          set({
                            objectTypeIds: next,
                            objectTypeId: next[0] || '',
                          });
                        }}
                        style={{ accentColor: '#2563EB' }}
                      />
                      {o.displayName || o.name}
                    </label>
                  );
                })}
              </div>

              {/* Sibling widgets as context sources */}
              {allComponents.filter(c => c.id !== comp.id && c.type !== 'chat-widget').length > 0 && (
                <>
                  <Lbl>Dashboard Widgets</Lbl>
                  <div style={{
                    maxHeight: 140, overflowY: 'auto', border: '1px solid #E2E8F0',
                    borderRadius: 6, backgroundColor: '#FAFBFC',
                  }}>
                    {allComponents
                      .filter(c => c.id !== comp.id && c.type !== 'chat-widget')
                      .map((w) => {
                        const wIds = comp.widgetSourceIds || [];
                        const checked = wIds.includes(w.id);
                        return (
                          <label key={w.id} style={{
                            display: 'flex', alignItems: 'center', gap: 6,
                            padding: '5px 8px', cursor: 'pointer', fontSize: 12,
                            borderBottom: '1px solid #F1F5F9', color: '#0D1117',
                          }}>
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => {
                                const next = checked ? wIds.filter((x) => x !== w.id) : [...wIds, w.id];
                                set({ widgetSourceIds: next });
                              }}
                              style={{ accentColor: '#7C3AED' }}
                            />
                            <span style={{
                              display: 'inline-block', fontSize: 9, fontWeight: 600, padding: '1px 5px',
                              borderRadius: 3, backgroundColor: '#F1F5F9', color: '#64748B', marginRight: 2,
                            }}>{w.type.replace(/-/g, ' ')}</span>
                            {w.title}
                          </label>
                        );
                      })}
                  </div>
                </>
              )}

              {(comp.objectTypeIds?.length || 0) > 0 && (
                <div style={{ fontSize: 10, color: '#94A3B8' }}>
                  {comp.objectTypeIds!.length} data source{comp.objectTypeIds!.length > 1 ? 's' : ''}
                  {(comp.widgetSourceIds?.length || 0) > 0 && ` · ${comp.widgetSourceIds!.length} widget${comp.widgetSourceIds!.length > 1 ? 's' : ''}`}
                </div>
              )}
            </div>
          </Row>
        )}

        {/* ── Single data source for non-chat widgets ── */}
        {comp.type !== 'text-block' && comp.type !== 'utility-output' && comp.type !== 'chat-widget' && (
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
                {selectedOt.properties.length > 0
                  ? `${selectedOt.properties.length} properties · ${selectedOt.properties.filter(p => p.name.endsWith('[]')).length} arrays`
                  : `${fields.length} fields inferred from records (schema not declared)`}
              </div>
            )}
          </Row>
        )}

        {/* EAV metric picker — only when the selected OT looks like
            long-format / sensor data (one row per measurement event). */}
        {eav && (comp.type === 'line-chart' || comp.type === 'area-chart' || comp.type === 'bar-chart' || comp.type === 'pie-chart' || comp.type === 'metric-card' || comp.type === 'stat-card') && (
          <Row label={`METRIC (${eav.attributeCol})`}>
            <select
              value={activeMetric}
              onChange={(e) => setMetric(e.target.value)}
              style={{ width: '100%', padding: '6px 8px', border: '1px solid #C7D2FE', borderRadius: 4, fontSize: 12, color: '#0D1117', backgroundColor: '#EEF2FF', outline: 'none', fontFamily: 'var(--font-mono)' }}
            >
              <option value="">— all metrics (skip filter) —</option>
              {metricList.map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
            <div style={{ marginTop: 4, fontSize: 10, color: '#6366F1' }}>
              Detected long-format / EAV data. Picking a metric here adds a
              filter on <code style={{ fontFamily: 'var(--font-mono)' }}>{eav.attributeCol}</code> and
              auto-fills <code style={{ fontFamily: 'var(--font-mono)' }}>{eav.valueCol}</code> as the value field.
            </div>
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
            <Row label="AGGREGATION">
              <select
                value={comp.aggregation || (comp.valueField ? 'sum' : 'count')}
                onChange={(e) => set({ aggregation: e.target.value as AppComponent['aggregation'] })}
                style={{ width: '100%', padding: '6px 8px', border: '1px solid #E2E8F0', borderRadius: 4, fontSize: 12, outline: 'none' }}
              >
                <option value="count">Count</option>
                <option value="sum">Sum</option>
                <option value="avg">Average</option>
                <option value="min">Min</option>
                <option value="max">Max</option>
                <option value="runtime">Runtime</option>
              </select>
            </Row>
            {comp.aggregation === 'runtime' && (
              <Row label="TIMESTAMP FIELD">
                <FieldPicker value={comp.tsField} onPick={(f) => set({ tsField: f })} />
              </Row>
            )}
          </>
        )}

        {/* line-chart */}
        {comp.type === 'line-chart' && (
          <>
            <Row label="X-AXIS (DATE / TIME)">
              <FieldPicker value={comp.xField} onPick={(f) => set({ xField: f })} />
            </Row>
            <Row label="Y-AXIS (NUMBER)">
              <FieldPicker value={comp.valueField} onPick={(f) => set({ valueField: f })} placeholder="Blank = count records per bucket" />
            </Row>
            <Row label="GROUP BY (one line per value — multi-series)">
              <FieldPicker value={comp.labelField} onPick={(f) => set({ labelField: f })} placeholder="Optional, e.g. sensor_name" />
            </Row>
            <Row label="TIME RANGE (auto-applies to x-axis filter)">
              <select
                value={comp.xAxisRange || 'all_time'}
                onChange={(e) => {
                  const range = e.target.value as AppComponent['xAxisRange'];
                  // When the user changes range, auto-suggest a sensible bucket
                  // size — only if they haven't explicitly set one yet.
                  const suggested = suggestedBucketForRange(range);
                  set({
                    xAxisRange: range,
                    ...(comp.timeBucket ? {} : { timeBucket: suggested }),
                  });
                }}
                style={{ width: '100%', padding: '6px 8px', border: '1px solid #E2E8F0', borderRadius: 4, fontSize: 12, outline: 'none' }}
              >
                <optgroup label="Recent">
                  <option value="last_15m">Last 15 minutes</option>
                  <option value="last_1h">Last 1 hour</option>
                  <option value="last_4h">Last 4 hours</option>
                  <option value="last_24h">Last 24 hours</option>
                  <option value="last_7d">Last 7 days</option>
                  <option value="last_30d">Last 30 days</option>
                  <option value="last_90d">Last 90 days</option>
                  <option value="last_year">Last year</option>
                </optgroup>
                <optgroup label="Calendar">
                  <option value="today">Today</option>
                  <option value="yesterday">Yesterday</option>
                  <option value="this_week">This week</option>
                  <option value="this_month">This month</option>
                </optgroup>
                <optgroup label="No filter">
                  <option value="all_time">All time</option>
                </optgroup>
              </select>
            </Row>
            <Row label="TIME BUCKET">
              <select
                value={comp.timeBucket || 'month'}
                onChange={(e) => set({ timeBucket: e.target.value as AppComponent['timeBucket'] })}
                style={{ width: '100%', padding: '6px 8px', border: '1px solid #E2E8F0', borderRadius: 4, fontSize: 12, outline: 'none' }}
              >
                <optgroup label="Sub-second precision">
                  <option value="second">Second</option>
                  <option value="5_seconds">5 seconds</option>
                  <option value="15_seconds">15 seconds</option>
                  <option value="30_seconds">30 seconds</option>
                </optgroup>
                <optgroup label="Minutes">
                  <option value="minute">Minute</option>
                  <option value="5_minutes">5 minutes</option>
                  <option value="15_minutes">15 minutes</option>
                  <option value="30_minutes">30 minutes</option>
                </optgroup>
                <optgroup label="Calendar">
                  <option value="hour">Hour</option>
                  <option value="day">Day</option>
                  <option value="week">Week</option>
                  <option value="month">Month</option>
                  <option value="quarter">Quarter</option>
                  <option value="year">Year</option>
                </optgroup>
              </select>
            </Row>
            <Row label="AGGREGATION">
              <select
                value={comp.aggregation || 'sum'}
                onChange={(e) => set({ aggregation: e.target.value as AppComponent['aggregation'] })}
                style={{ width: '100%', padding: '6px 8px', border: '1px solid #E2E8F0', borderRadius: 4, fontSize: 12, outline: 'none' }}
              >
                <option value="sum">Sum</option>
                <option value="avg">Average</option>
                <option value="min">Min</option>
                <option value="max">Max</option>
                <option value="count">Count</option>
              </select>
            </Row>
          </>
        )}

        {/* pie-chart */}
        {comp.type === 'pie-chart' && (
          <>
            <Row label="CATEGORY (SLICES)">
              <FieldPicker value={comp.labelField} onPick={(f) => set({ labelField: f })} />
            </Row>
            <Row label="VALUE (BLANK = COUNT)">
              <FieldPicker value={comp.valueField} onPick={(f) => set({ valueField: f })} placeholder="Count (auto)" />
            </Row>
          </>
        )}

        {/* area-chart */}
        {comp.type === 'area-chart' && (
          <>
            <Row label="X-AXIS (DATE / TIME)">
              <FieldPicker value={comp.xField} onPick={(f) => set({ xField: f })} />
            </Row>
            <Row label="Y-AXIS (NUMBER)">
              <FieldPicker value={comp.valueField} onPick={(f) => set({ valueField: f })} placeholder="Blank = count" />
            </Row>
            <Row label="GROUP BY (SERIES)">
              <FieldPicker value={comp.labelField} onPick={(f) => set({ labelField: f })} placeholder="Optional, e.g. sensor_name" />
            </Row>
            <Row label="TIME RANGE (auto-applies to x-axis filter)">
              <select
                value={comp.xAxisRange || 'all_time'}
                onChange={(e) => {
                  const range = e.target.value as AppComponent['xAxisRange'];
                  const suggested = suggestedBucketForRange(range);
                  set({
                    xAxisRange: range,
                    ...(comp.timeBucket ? {} : { timeBucket: suggested }),
                  });
                }}
                style={{ width: '100%', padding: '6px 8px', border: '1px solid #E2E8F0', borderRadius: 4, fontSize: 12, outline: 'none' }}
              >
                <optgroup label="Recent">
                  <option value="last_15m">Last 15 minutes</option>
                  <option value="last_1h">Last 1 hour</option>
                  <option value="last_4h">Last 4 hours</option>
                  <option value="last_24h">Last 24 hours</option>
                  <option value="last_7d">Last 7 days</option>
                  <option value="last_30d">Last 30 days</option>
                  <option value="last_90d">Last 90 days</option>
                  <option value="last_year">Last year</option>
                </optgroup>
                <optgroup label="Calendar">
                  <option value="today">Today</option>
                  <option value="yesterday">Yesterday</option>
                  <option value="this_week">This week</option>
                  <option value="this_month">This month</option>
                </optgroup>
                <optgroup label="No filter">
                  <option value="all_time">All time</option>
                </optgroup>
              </select>
            </Row>
            <Row label="TIME BUCKET">
              <select
                value={comp.timeBucket || 'month'}
                onChange={(e) => set({ timeBucket: e.target.value as AppComponent['timeBucket'] })}
                style={{ width: '100%', padding: '6px 8px', border: '1px solid #E2E8F0', borderRadius: 4, fontSize: 12, outline: 'none' }}
              >
                <optgroup label="Sub-second precision">
                  <option value="second">Second</option>
                  <option value="5_seconds">5 seconds</option>
                  <option value="15_seconds">15 seconds</option>
                  <option value="30_seconds">30 seconds</option>
                </optgroup>
                <optgroup label="Minutes">
                  <option value="minute">Minute</option>
                  <option value="5_minutes">5 minutes</option>
                  <option value="15_minutes">15 minutes</option>
                  <option value="30_minutes">30 minutes</option>
                </optgroup>
                <optgroup label="Calendar">
                  <option value="hour">Hour</option>
                  <option value="day">Day</option>
                  <option value="week">Week</option>
                  <option value="month">Month</option>
                  <option value="quarter">Quarter</option>
                  <option value="year">Year</option>
                </optgroup>
              </select>
            </Row>
          </>
        )}

        {/* pivot-table */}
        {comp.type === 'pivot-table' && (
          <>
            <Row label="ROWS (categorical, e.g. sensor_name)">
              <FieldPicker value={comp.labelField} onPick={(f) => set({ labelField: f })} />
            </Row>
            <Row label="COLUMNS — DATE/TIME field for time buckets">
              <FieldPicker value={comp.xField} onPick={(f) => set({ xField: f })} />
            </Row>
            <Row label="VALUE (number to aggregate; blank = count rows)">
              <FieldPicker value={comp.valueField} onPick={(f) => set({ valueField: f })} placeholder="Blank = count" />
            </Row>
            <Row label="TIME RANGE (auto-applies to filter)">
              <select
                value={comp.xAxisRange || 'all_time'}
                onChange={(e) => {
                  const range = e.target.value as AppComponent['xAxisRange'];
                  const suggested = suggestedBucketForRange(range);
                  set({ xAxisRange: range, ...(comp.timeBucket ? {} : { timeBucket: suggested }) });
                }}
                style={{ width: '100%', padding: '6px 8px', border: '1px solid #E2E8F0', borderRadius: 4, fontSize: 12, outline: 'none' }}
              >
                <optgroup label="Recent">
                  <option value="last_15m">Last 15 minutes</option>
                  <option value="last_1h">Last 1 hour</option>
                  <option value="last_4h">Last 4 hours</option>
                  <option value="last_24h">Last 24 hours</option>
                  <option value="last_7d">Last 7 days</option>
                  <option value="last_30d">Last 30 days</option>
                  <option value="last_90d">Last 90 days</option>
                  <option value="last_year">Last year</option>
                </optgroup>
                <optgroup label="Calendar">
                  <option value="today">Today</option>
                  <option value="yesterday">Yesterday</option>
                  <option value="this_week">This week</option>
                  <option value="this_month">This month</option>
                </optgroup>
                <optgroup label="No filter">
                  <option value="all_time">All time</option>
                </optgroup>
              </select>
            </Row>
            <Row label="TIME BUCKET (column granularity)">
              <select
                value={comp.timeBucket || 'day'}
                onChange={(e) => set({ timeBucket: e.target.value as AppComponent['timeBucket'] })}
                style={{ width: '100%', padding: '6px 8px', border: '1px solid #E2E8F0', borderRadius: 4, fontSize: 12, outline: 'none' }}
              >
                <optgroup label="Sub-second">
                  <option value="second">Second</option>
                  <option value="5_seconds">5 seconds</option>
                  <option value="15_seconds">15 seconds</option>
                  <option value="30_seconds">30 seconds</option>
                </optgroup>
                <optgroup label="Minutes">
                  <option value="minute">Minute</option>
                  <option value="5_minutes">5 minutes</option>
                  <option value="15_minutes">15 minutes</option>
                  <option value="30_minutes">30 minutes</option>
                </optgroup>
                <optgroup label="Calendar">
                  <option value="hour">Hour</option>
                  <option value="day">Day</option>
                  <option value="week">Week</option>
                  <option value="month">Month</option>
                  <option value="quarter">Quarter</option>
                  <option value="year">Year</option>
                </optgroup>
              </select>
            </Row>
            <Row label="AGGREGATION">
              <select
                value={comp.aggregation || 'count'}
                onChange={(e) => set({ aggregation: e.target.value as AppComponent['aggregation'] })}
                style={{ width: '100%', padding: '6px 8px', border: '1px solid #E2E8F0', borderRadius: 4, fontSize: 12, outline: 'none' }}
              >
                <option value="count">Count</option>
                <option value="sum">Sum</option>
                <option value="avg">Average</option>
                <option value="min">Min</option>
                <option value="max">Max</option>
                <option value="runtime">Runtime</option>
              </select>
            </Row>
            {comp.aggregation === 'runtime' && (
              <Row label="TIMESTAMP FIELD">
                <FieldPicker value={comp.tsField} onPick={(f) => set({ tsField: f })} />
              </Row>
            )}
          </>
        )}

        {/* stat-card */}
        {comp.type === 'stat-card' && (
          <>
            <Row label="METRIC FIELD">
              <FieldPicker value={comp.field} onPick={(f) => set({ field: f })} />
            </Row>
            <Row label="AGGREGATION">
              <select
                value={comp.aggregation || 'count'}
                onChange={(e) => set({ aggregation: e.target.value as AppComponent['aggregation'] })}
                style={{ width: '100%', padding: '6px 8px', border: '1px solid #E2E8F0', borderRadius: 4, fontSize: 12, outline: 'none' }}
              >
                <option value="count">Count</option>
                <option value="sum">Sum</option>
                <option value="avg">Average</option>
                <option value="max">Max</option>
                <option value="min">Min</option>
              </select>
            </Row>
            <Row label="DATE FIELD (FOR TREND)">
              <FieldPicker value={comp.comparisonField} onPick={(f) => set({ comparisonField: f })} placeholder="Optional" />
            </Row>
          </>
        )}

        {/* filter-bar */}
        {comp.type === 'filter-bar' && (
          <Row label="FILTER FIELD">
            <FieldPicker value={comp.filterField} onPick={(f) => set({ filterField: f })} />
          </Row>
        )}

        {/* date-picker */}
        {comp.type === 'date-picker' && (
          <Row label="DATE FIELD TO FILTER">
            <FieldPicker value={comp.xField} onPick={(f) => set({ xField: f })} />
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

        {/* map */}
        {comp.type === 'map' && (
          <>
            <Row label="LAT FIELD">
              {inp(comp.latField, (v) => set({ latField: v }), 'e.g. lat')}
            </Row>
            <Row label="LNG FIELD">
              {inp(comp.lngField, (v) => set({ lngField: v }), 'e.g. lng')}
            </Row>
            <Row label="LABEL FIELD">
              {inp(comp.labelField, (v) => set({ labelField: v }), 'e.g. name')}
            </Row>
          </>
        )}

        {/* utility-output */}
        {comp.type === 'utility-output' && (
          <>
            <Row label="UTILITY ID">
              {inp(comp.utility_id, (v) => set({ utility_id: v }), 'Utility UUID or slug')}
            </Row>
            <Row label="INPUTS (JSON)">
              <textarea
                value={comp.utility_inputs ?? ''}
                onChange={(e) => set({ utility_inputs: e.target.value })}
                rows={4}
                placeholder={'{\n  "key": "value"\n}'}
                style={{
                  width: '100%', padding: '6px 8px', border: '1px solid #E2E8F0',
                  borderRadius: 4, fontSize: 11, color: '#0D1117',
                  resize: 'vertical', boxSizing: 'border-box', lineHeight: 1.5,
                  fontFamily: 'var(--font-mono)', outline: 'none',
                }}
              />
            </Row>
            <Row label="DISPLAY FIELD (OPTIONAL)">
              {inp(comp.display_field, (v) => set({ display_field: v }), 'e.g. result (leave blank for full output)')}
            </Row>
          </>
        )}

        {/* dropdown-filter */}
        {comp.type === 'dropdown-filter' && (
          <>
            <Row label="VARIABLE ID">
              {inp(comp.variableId, (v) => set({ variableId: v }), 'e.g. selectedStatus')}
            </Row>
            <Row label="FILTER FIELD (FOR DYNAMIC OPTIONS)">
              <FieldPicker value={comp.filterField} onPick={(f) => set({ filterField: f })} placeholder="Field for distinct values" />
            </Row>
            <Row label="STATIC OPTIONS (ONE PER LINE)">
              <textarea
                value={(comp.options || []).join('\n')}
                onChange={(e) => set({ options: e.target.value.split('\n').filter(Boolean) })}
                rows={4}
                placeholder={"Option 1\nOption 2\nOption 3"}
                style={{
                  width: '100%', padding: '6px 8px', border: '1px solid #E2E8F0',
                  borderRadius: 4, fontSize: 11, color: '#0D1117',
                  resize: 'vertical', boxSizing: 'border-box', lineHeight: 1.5,
                  fontFamily: 'inherit', outline: 'none',
                }}
              />
              <div style={{ fontSize: 10, color: '#94A3B8', marginTop: 2 }}>
                Leave blank to use distinct values from Filter Field
              </div>
            </Row>
          </>
        )}

        {/* form */}
        {comp.type === 'form' && (
          <>
            <Row label="ACTION NAME">
              {inp(comp.actionName, (v) => set({ actionName: v }), 'e.g. create-ticket')}
            </Row>
            <Row label="FIELDS">
              <FieldsEditor
                fields={comp.fields || []}
                objectTypes={objectTypes}
                onChange={(next) => set({ fields: next })}
              />
            </Row>
          </>
        )}

        {/* record-creator */}
        {comp.type === 'record-creator' && (
          <>
            <Row label="FIELDS">
              <FieldsEditor
                fields={comp.fields || []}
                objectTypes={objectTypes}
                onChange={(next) => {
                  // When a field is renamed/removed, prune dangling refs from steps.
                  const validNames = new Set(next.map((f) => f.name));
                  const prunedSteps = (comp.steps || []).map((s) => ({
                    ...s,
                    fields: s.fields.filter((n) => validNames.has(n)),
                  }));
                  set({ fields: next, steps: prunedSteps });
                }}
              />
            </Row>
            <Row label="WIZARD STEPS">
              <StepsEditor
                steps={comp.steps || []}
                fieldNames={(comp.fields || []).map((f) => f.name).filter(Boolean)}
                onChange={(next) => set({ steps: next })}
              />
            </Row>
          </>
        )}

        {/* object-editor — same shape as record-creator (single-page form)
            but writes against an existing record id. */}
        {comp.type === 'object-editor' && (
          <Row label="FIELDS">
            <FieldsEditor
              fields={comp.fields || []}
              objectTypes={objectTypes}
              onChange={(next) => set({ fields: next })}
            />
          </Row>
        )}

        {/* file-upload — Phase 8 widget */}
        {comp.type === 'file-upload' && (
          <>
            <Row label="DOCUMENT KIND">
              {inp(comp.documentKind, (v) => set({ documentKind: v }), 'e.g. Receipt, Invoice, Bill')}
            </Row>
            <Row label="EXTRACTION SCHEMA">
              <FileUploadSchemaEditor
                schema={comp.extractionSchema || []}
                fieldVariableMap={comp.fieldVariableMap || {}}
                variables={variables || []}
                onChange={(schema, map) => set({ extractionSchema: schema, fieldVariableMap: map })}
              />
            </Row>
            <Row label="LINK TO RECORD TYPE">
              {inp(comp.linkedRecordType, (v) => set({ linkedRecordType: v }), 'e.g. Bill (optional)')}
            </Row>
            <Row label="LINK ID FROM VARIABLE">
              {sel(
                comp.linkedRecordVariableId || '',
                (variables || []).map((v) => v.id),
                (variables || []).map((v) => v.name),
                (v) => set({ linkedRecordVariableId: v }),
                '— optional —',
              )}
            </Row>
          </>
        )}

        {/* object-table */}
        {comp.type === 'object-table' && (
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
                      {f.length > 14 ? f.slice(0, 14) + '...' : f}
                    </button>
                  );
                })}
              </div>
            </Row>
            <Row label="MAX ROWS">
              {inp(comp.maxRows, (v) => set({ maxRows: Number(v) || 50 }), '50')}
            </Row>
            <Row label="INPUT BINDINGS (JSON)">
              <textarea
                value={JSON.stringify(comp.inputBindings || {}, null, 2)}
                onChange={(e) => {
                  try {
                    const parsed = JSON.parse(e.target.value);
                    if (typeof parsed === 'object' && !Array.isArray(parsed)) set({ inputBindings: parsed });
                  } catch { /* ignore */ }
                }}
                rows={3}
                placeholder={'{ "status": "varStatusId" }'}
                style={{
                  width: '100%', padding: '6px 8px', border: '1px solid #E2E8F0',
                  borderRadius: 4, fontSize: 10, color: '#0D1117',
                  resize: 'vertical', boxSizing: 'border-box', lineHeight: 1.5,
                  fontFamily: 'var(--font-mono)', outline: 'none',
                }}
              />
            </Row>
            <Row label="OUTPUT BINDINGS (JSON)">
              <textarea
                value={JSON.stringify(comp.outputBindings || {}, null, 2)}
                onChange={(e) => {
                  try {
                    const parsed = JSON.parse(e.target.value);
                    if (typeof parsed === 'object' && !Array.isArray(parsed)) set({ outputBindings: parsed });
                  } catch { /* ignore */ }
                }}
                rows={3}
                placeholder={'{ "onRowSelect": "varSelectedRecordId" }'}
                style={{
                  width: '100%', padding: '6px 8px', border: '1px solid #E2E8F0',
                  borderRadius: 4, fontSize: 10, color: '#0D1117',
                  resize: 'vertical', boxSizing: 'border-box', lineHeight: 1.5,
                  fontFamily: 'var(--font-mono)', outline: 'none',
                }}
              />
            </Row>
          </>
        )}

        {/* ── Filters ── */}
        {comp.type !== 'text-block' && comp.type !== 'utility-output' && (
          <FilterBuilder
            filters={comp.filters || []}
            fields={fields}
            objectTypeId={comp.objectTypeId}
            onChange={(filters) => set({ filters })}
          />
        )}

        {/* ── Drill-down (Phase F) ── */}
        {events && onEventsChange && (
          <DrillDownSection
            comp={comp}
            events={events}
            onEventsChange={onEventsChange}
            allDashboardSiblings={allComponents}
            currentAppId={appId || ''}
            objectTypes={objectTypes}
            variables={variables || []}
            onCompChange={set}
          />
        )}

        {/* ── Action binding (Phase H) — for action widgets ── */}
        {(comp.type === 'action-button' || comp.type === 'object-editor' || comp.type === 'record-creator') && actions && (
          <ActionBindingSection
            comp={comp}
            actions={actions}
            onCompChange={set}
            variables={variables || []}
          />
        )}
        {comp.type === 'approval-queue' && actions && (
          <ApprovalActionSection
            comp={comp}
            actions={actions}
            onCompChange={set}
          />
        )}

        {/* ── Composite child editor (Phase B) ── */}
        {comp.type === 'composite' && (
          <CompositeChildEditor
            comp={comp}
            onCompChange={set}
            objectTypes={objectTypes}
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

// ── Drill-down section (Phase F) ─────────────────────────────────────────
// Lets the user attach drill-down events to a widget. Triggers default to
// the widget type's natural click semantic (kpi → onKpiClick, bar → onBarClick,
// etc). Actions: open saved dashboard, generate dashboard, set variable.

const TRIGGERS_BY_TYPE: Partial<Record<ComponentType, AppEvent['trigger'][]>> = {
  'metric-card': ['onKpiClick'],
  'kpi-banner': ['onKpiClick'],
  'stat-card': ['onKpiClick'],
  'bar-chart': ['onBarClick'],
  'pie-chart': ['onBarClick'],
  'data-table': ['onRowClick', 'onCellClick'],
  'object-table': ['onRowClick'],
};

// ContextBindingsEditor — editor for the AppEventAction.contextBindings[]
// array. Default mode is the original simple form (one clickedValue→filter
// row). Toggle "Advanced" to expose the full array, with sourceFrom (6
// options), apply (setVariable | addFilter), and target pickers per row.
//
// The simple form maps to a single row of the canonical shape:
//   { sourceFrom: 'clickedValue', apply: 'addFilter', filterField, filterOp: 'eq' }
// Switching out of advanced after editing more rows preserves them; the
// simple input edits row 0 only.
const ContextBindingsEditor: React.FC<{
  bindings: ContextBinding[];
  onChange: (next: ContextBinding[]) => void;
  variables: AppVariable[];
}> = ({ bindings, onChange, variables }) => {
  const [advanced, setAdvanced] = useState<boolean>(() => {
    // Auto-open advanced if any binding can't be represented by the simple form.
    if (bindings.length > 1) return true;
    const b = bindings[0];
    if (!b) return false;
    return !(b.sourceFrom === 'clickedValue' && b.apply === 'addFilter' && b.filterOp === 'eq');
  });

  const updateRow = (i: number, patch: Partial<ContextBinding>) => {
    const next = [...bindings];
    next[i] = { ...next[i], ...patch };
    onChange(next);
  };
  const removeRow = (i: number) => onChange(bindings.filter((_, idx) => idx !== i));

  const headerRow = (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 4 }}>
      <div style={{ fontSize: 9, color: '#7C3AED', fontWeight: 600 }}>
        Pass click context to target
      </div>
      <button
        onClick={() => setAdvanced((v) => !v)}
        style={{
          padding: '1px 6px', fontSize: 9, color: advanced ? '#7C3AED' : '#94A3B8',
          border: `1px solid ${advanced ? '#DDD6FE' : '#E2E8F0'}`,
          backgroundColor: advanced ? '#FAF5FF' : 'transparent',
          borderRadius: 3, cursor: 'pointer',
        }}
      >{advanced ? 'Simple' : 'Advanced'}</button>
    </div>
  );

  if (!advanced) {
    return (
      <>
        {headerRow}
        <input
          value={bindings[0]?.filterField || ''}
          onChange={(e) => {
            const filterField = e.target.value;
            const next: ContextBinding[] = filterField
              ? [{ sourceFrom: 'clickedValue', apply: 'addFilter', filterField, filterOp: 'eq' }]
              : [];
            onChange(next);
          }}
          placeholder="filter on field (e.g. account_id)"
          style={{ height: 22, fontSize: 10, padding: '0 6px', border: '1px solid #DDD6FE', borderRadius: 3, marginTop: 4 }}
        />
      </>
    );
  }

  return (
    <>
      {headerRow}
      {bindings.length === 0 && (
        <div style={{ fontSize: 9, color: '#CBD5E1', padding: '4px 0' }}>
          No bindings — target opens with no extra context.
        </div>
      )}
      {bindings.map((b, i) => (
        <div key={i} style={{
          marginTop: 4, padding: 4, backgroundColor: '#fff',
          border: '1px solid #EDE9FE', borderRadius: 3,
          display: 'flex', flexDirection: 'column', gap: 3,
        }}>
          <div style={{ display: 'flex', gap: 4 }}>
            <select
              value={b.sourceFrom}
              onChange={(e) => updateRow(i, { sourceFrom: e.target.value as ContextBinding['sourceFrom'] })}
              style={{ flex: 1, height: 20, fontSize: 9, padding: '0 4px', border: '1px solid #DDD6FE', borderRadius: 3 }}
              title="Where to pull the value from"
            >
              <option value="clickedValue">clicked value</option>
              <option value="clickedField">clicked field</option>
              <option value="clickedRow">clicked row</option>
              <option value="rowField">row field</option>
              <option value="literal">literal</option>
            </select>
            <button
              onClick={() => removeRow(i)}
              style={{ width: 20, height: 20, fontSize: 9, border: '1px solid #FCA5A5', borderRadius: 3, backgroundColor: '#FEF2F2', color: '#DC2626', cursor: 'pointer' }}
            >×</button>
          </div>
          {b.sourceFrom === 'rowField' && (
            <input
              value={b.rowField || ''}
              onChange={(e) => updateRow(i, { rowField: e.target.value })}
              placeholder="row field name"
              style={{ height: 20, fontSize: 9, padding: '0 6px', border: '1px solid #DDD6FE', borderRadius: 3 }}
            />
          )}
          {b.sourceFrom === 'literal' && (
            <input
              value={b.literal || ''}
              onChange={(e) => updateRow(i, { literal: e.target.value })}
              placeholder="literal value"
              style={{ height: 20, fontSize: 9, padding: '0 6px', border: '1px solid #DDD6FE', borderRadius: 3 }}
            />
          )}
          <select
            value={b.apply}
            onChange={(e) => updateRow(i, { apply: e.target.value as ContextBinding['apply'] })}
            style={{ height: 20, fontSize: 9, padding: '0 4px', border: '1px solid #DDD6FE', borderRadius: 3 }}
          >
            <option value="addFilter">add filter on target</option>
            <option value="setVariable">set variable on target</option>
          </select>
          {b.apply === 'addFilter' && (
            <div style={{ display: 'flex', gap: 4 }}>
              <input
                value={b.filterField || ''}
                onChange={(e) => updateRow(i, { filterField: e.target.value })}
                placeholder="filter field"
                style={{ flex: 2, height: 20, fontSize: 9, padding: '0 6px', border: '1px solid #DDD6FE', borderRadius: 3 }}
              />
              <select
                value={b.filterOp || 'eq'}
                onChange={(e) => updateRow(i, { filterOp: e.target.value as ContextBinding['filterOp'] })}
                style={{ flex: 1, height: 20, fontSize: 9, padding: '0 4px', border: '1px solid #DDD6FE', borderRadius: 3 }}
              >
                <option value="eq">eq</option>
                <option value="neq">neq</option>
                <option value="in">in</option>
              </select>
            </div>
          )}
          {b.apply === 'setVariable' && (
            <select
              value={b.targetVariableId || ''}
              onChange={(e) => updateRow(i, { targetVariableId: e.target.value })}
              style={{ height: 20, fontSize: 9, padding: '0 4px', border: '1px solid #DDD6FE', borderRadius: 3 }}
            >
              <option value="">— pick variable —</option>
              {variables.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
            </select>
          )}
        </div>
      ))}
      <button
        onClick={() => onChange([
          ...bindings,
          { sourceFrom: 'clickedValue', apply: 'addFilter', filterField: '', filterOp: 'eq' },
        ])}
        style={{
          marginTop: 4, padding: '2px 0', fontSize: 9, color: '#7C3AED',
          border: '1px dashed #DDD6FE', borderRadius: 3,
          backgroundColor: 'transparent', cursor: 'pointer',
        }}
      >+ Binding</button>
    </>
  );
};

const DrillDownSection: React.FC<{
  comp: AppComponent;
  events: AppEvent[];
  onEventsChange: (evs: AppEvent[]) => void;
  allDashboardSiblings: AppComponent[];
  currentAppId: string;
  objectTypes: OntologyType[];
  variables: AppVariable[];
  onCompChange: (patch: Partial<AppComponent>) => void;
}> = ({ comp, events, onEventsChange, currentAppId, objectTypes, variables, onCompChange }) => {
  const widgetEvents = events.filter((e) => e.sourceWidgetId === comp.id);
  const possibleTriggers = TRIGGERS_BY_TYPE[comp.type] || ['onClick'];
  const [savedDashboards, setSavedDashboards] = useState<NexusApp[]>([]);

  useEffect(() => {
    let cancelled = false;
    fetch(`${ONTOLOGY_API2}/apps`, { headers: { 'x-tenant-id': getTenantId() } })
      .then((r) => r.ok ? r.json() : [])
      .then((d: Record<string, unknown>[]) => {
        if (cancelled) return;
        const apps = d
          .filter((row) => row.id !== currentAppId)
          .map((row) => ({
            id: row.id as string,
            name: row.name as string,
            description: '',
            icon: '',
            components: [],
            objectTypeIds: [],
            createdAt: '',
            updatedAt: '',
          } as NexusApp));
        setSavedDashboards(apps);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [currentAppId]);

  const updateEvent = (idx: number, patch: Partial<AppEvent>) => {
    const next = events.map((e) => e === widgetEvents[idx] ? { ...e, ...patch } : e);
    onEventsChange(next);
  };
  const updateAction = (evIdx: number, actIdx: number, patch: Partial<AppEventAction>) => {
    const ev = widgetEvents[evIdx];
    const newActions = ev.actions.map((a, i) => i === actIdx ? { ...a, ...patch } : a);
    updateEvent(evIdx, { actions: newActions });
  };
  const addEvent = () => {
    const ev: AppEvent = {
      id: `ev-${Date.now()}`,
      sourceWidgetId: comp.id,
      trigger: possibleTriggers[0],
      actions: [{ type: 'openDashboard', displayMode: 'replace' }],
    };
    onEventsChange([...events, ev]);
    onCompChange({ drillEnabled: true });
  };
  const removeEvent = (idx: number) => {
    const ev = widgetEvents[idx];
    onEventsChange(events.filter((e) => e !== ev));
  };

  return (
    <div style={{ marginTop: 8, borderTop: '1px solid #F1F5F9', paddingTop: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
        <Lbl>DRILL-DOWN</Lbl>
        <button
          onClick={addEvent}
          style={{
            padding: '2px 8px', fontSize: 10, fontWeight: 600,
            border: '1px solid #DDD6FE', borderRadius: 3,
            backgroundColor: '#FAF5FF', color: '#7C3AED', cursor: 'pointer',
          }}
        >+ Add</button>
      </div>
      <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 10, color: '#64748B', marginBottom: 8 }}>
        <input
          type="checkbox"
          checked={!!comp.drillEnabled}
          onChange={(e) => onCompChange({ drillEnabled: e.target.checked })}
        />
        Enable click-to-drill on this widget
      </label>
      {widgetEvents.length === 0 && (
        <div style={{ fontSize: 10, color: '#CBD5E1', padding: '6px 0' }}>
          No drill-downs configured.
        </div>
      )}
      {widgetEvents.map((ev, i) => (
        <div key={ev.id} style={{
          marginBottom: 8, padding: '8px', backgroundColor: '#FAF5FF',
          border: '1px solid #EDE9FE', borderRadius: 4,
        }}>
          <div style={{ display: 'flex', gap: 4, marginBottom: 6 }}>
            <select
              value={ev.trigger}
              onChange={(e) => updateEvent(i, { trigger: e.target.value as AppEvent['trigger'] })}
              style={{ flex: 1, height: 22, fontSize: 10, padding: '0 4px', border: '1px solid #DDD6FE', borderRadius: 3 }}
            >
              {possibleTriggers.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            <button
              onClick={() => removeEvent(i)}
              style={{ width: 22, height: 22, fontSize: 10, border: '1px solid #FCA5A5', borderRadius: 3, backgroundColor: '#FEF2F2', color: '#DC2626', cursor: 'pointer' }}
            >×</button>
          </div>
          {ev.actions.map((a, aIdx) => (
            <div key={aIdx} style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 4 }}>
              <select
                value={a.type}
                onChange={(e) => updateAction(i, aIdx, { type: e.target.value as AppEventAction['type'] })}
                style={{ height: 22, fontSize: 10, padding: '0 4px', border: '1px solid #DDD6FE', borderRadius: 3 }}
              >
                <option value="openDashboard">Open saved dashboard</option>
                <option value="openDashboardModal">Open in modal</option>
                <option value="generateDashboard">Generate dashboard with AI</option>
                <option value="setVariable">Set variable</option>
              </select>
              {(a.type === 'openDashboard' || a.type === 'openDashboardModal') && (
                <select
                  value={a.targetDashboardId || ''}
                  onChange={(e) => updateAction(i, aIdx, { targetDashboardId: e.target.value })}
                  style={{ height: 22, fontSize: 10, padding: '0 4px', border: '1px solid #DDD6FE', borderRadius: 3 }}
                >
                  <option value="">— pick dashboard —</option>
                  {savedDashboards.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
              )}
              {a.type === 'generateDashboard' && (
                <>
                  <textarea
                    value={a.generatePromptTemplate || 'Show details for {{value}} in {{field}}'}
                    onChange={(e) => updateAction(i, aIdx, { generatePromptTemplate: e.target.value })}
                    rows={2}
                    style={{ fontSize: 10, padding: '4px 6px', border: '1px solid #DDD6FE', borderRadius: 3, resize: 'vertical' }}
                  />
                  <select
                    multiple
                    value={a.generateObjectTypeIds || []}
                    onChange={(e) => updateAction(i, aIdx, {
                      generateObjectTypeIds: Array.from(e.target.selectedOptions).map((o) => o.value),
                    })}
                    style={{ fontSize: 10, padding: '4px 6px', border: '1px solid #DDD6FE', borderRadius: 3, minHeight: 50 }}
                  >
                    {objectTypes.map((ot) => <option key={ot.id} value={ot.id}>{ot.displayName || ot.name}</option>)}
                  </select>
                </>
              )}
              <select
                value={a.displayMode || 'replace'}
                onChange={(e) => updateAction(i, aIdx, { displayMode: e.target.value as AppEventAction['displayMode'] })}
                style={{ height: 22, fontSize: 10, padding: '0 4px', border: '1px solid #DDD6FE', borderRadius: 3 }}
              >
                <option value="replace">Replace canvas</option>
                <option value="modal">Modal</option>
                <option value="sidepanel">Side panel</option>
              </select>
              <ContextBindingsEditor
                bindings={a.contextBindings || []}
                onChange={(next) => updateAction(i, aIdx, { contextBindings: next })}
                variables={variables}
              />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
};

// ── Action binding section (Phase H) ─────────────────────────────────────

const ActionBindingSection: React.FC<{
  comp: AppComponent;
  actions: AppAction[];
  variables: AppVariable[];
  onCompChange: (patch: Partial<AppComponent>) => void;
}> = ({ comp, actions, variables, onCompChange }) => {
  return (
    <div style={{ marginTop: 8, borderTop: '1px solid #F1F5F9', paddingTop: 10 }}>
      <Lbl>ACTION</Lbl>
      <Row label="Bound action">
        {sel(
          comp.actionId || '',
          actions.map((a) => a.id),
          actions.map((a) => `${a.name} (${a.kind})`),
          (v) => onCompChange({ actionId: v }),
          '— pick action —',
        )}
      </Row>
      {comp.type === 'object-editor' && (
        <>
          <Row label="Record id from">
            {sel(
              comp.recordIdSource || '',
              ['variable', 'literal', 'crossFilter'],
              ['Variable', 'Literal', 'Cross-filter'],
              (v) => onCompChange({ recordIdSource: v as AppComponent['recordIdSource'] }),
              '— pick source —',
            )}
          </Row>
          {comp.recordIdSource === 'variable' && (
            <Row label="Variable">
              {sel(
                comp.recordIdValue || '',
                variables.map((v) => v.id),
                variables.map((v) => v.name),
                (v) => onCompChange({ recordIdValue: v }),
                '— pick variable —',
              )}
            </Row>
          )}
          {comp.recordIdSource === 'literal' && (
            <Row label="Record id">
              {inp(comp.recordIdValue, (v) => onCompChange({ recordIdValue: v }), 'record id')}
            </Row>
          )}
        </>
      )}
    </div>
  );
};

const ApprovalActionSection: React.FC<{
  comp: AppComponent;
  actions: AppAction[];
  onCompChange: (patch: Partial<AppComponent>) => void;
}> = ({ comp, actions, onCompChange }) => (
  <div style={{ marginTop: 8, borderTop: '1px solid #F1F5F9', paddingTop: 10 }}>
    <Lbl>APPROVAL ACTIONS</Lbl>
    <Row label="Approve action">
      {sel(comp.approveActionId || '', actions.map((a) => a.id), actions.map((a) => a.name),
        (v) => onCompChange({ approveActionId: v }), '— pick action —')}
    </Row>
    <Row label="Reject action">
      {sel(comp.rejectActionId || '', actions.map((a) => a.id), actions.map((a) => a.name),
        (v) => onCompChange({ rejectActionId: v }), '— pick action —')}
    </Row>
  </div>
);

// ── Composite child editor (Phase B) ─────────────────────────────────────

const CompositeChildEditor: React.FC<{
  comp: AppComponent;
  onCompChange: (patch: Partial<AppComponent>) => void;
  objectTypes: OntologyType[];
}> = ({ comp, onCompChange }) => {
  const children = comp.children || [];
  const addChild = (type: ComponentType) => {
    const def = WIDGET_DEFS.find((w) => w.type === type)!;
    const child: AppComponent = {
      id: `child-${Date.now()}`,
      type,
      title: def.label,
      colSpan: def.defaultColSpan,
    };
    onCompChange({ children: [...children, child] });
  };
  const removeChild = (id: string) => {
    onCompChange({ children: children.filter((c) => c.id !== id) });
  };
  const updateChild = (id: string, patch: Partial<AppComponent>) => {
    onCompChange({ children: children.map((c) => c.id === id ? { ...c, ...patch } : c) });
  };
  const childOptions: ComponentType[] = [
    'kpi-banner', 'metric-card', 'stat-card',
    'bar-chart', 'line-chart', 'pie-chart', 'area-chart',
    'data-table', 'pivot-table', 'text-block', 'composite',
  ];
  return (
    <div style={{ marginTop: 8, borderTop: '1px solid #F1F5F9', paddingTop: 10 }}>
      <Lbl>CARD LAYOUT</Lbl>
      <Row label="Layout template">
        {sel(
          comp.cardLayout || 'grid',
          ['grid', 'banner-main', 'hero-sidebar', 'split'],
          ['Free-form grid', 'Banner + content', 'Hero + sidebar', 'Split (50/50)'],
          (v) => onCompChange({ cardLayout: v as AppComponent['cardLayout'] }),
        )}
      </Row>
      <Row label="Inner grid columns">
        {sel(
          String(comp.innerGridCols || 12),
          ['4', '6', '8', '12'],
          undefined,
          (v) => onCompChange({ innerGridCols: parseInt(v, 10) }),
        )}
      </Row>
      <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 10, color: '#64748B', marginBottom: 6 }}>
        <input type="checkbox" checked={comp.shareDataSource ?? true}
          onChange={(e) => onCompChange({ shareDataSource: e.target.checked })} />
        Share data source with children
      </label>
      <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 10, color: '#64748B', marginBottom: 12 }}>
        <input type="checkbox" checked={comp.shareFilters ?? true}
          onChange={(e) => onCompChange({ shareFilters: e.target.checked })} />
        Share filters with children
      </label>
      <Lbl>CHILD WIDGETS</Lbl>
      <div style={{ marginBottom: 6 }}>
        <select
          onChange={(e) => { if (e.target.value) { addChild(e.target.value as ComponentType); e.target.value = ''; } }}
          style={{ width: '100%', height: 26, fontSize: 11, padding: '0 6px', border: '1px solid #DDD6FE', borderRadius: 4 }}
          value=""
        >
          <option value="">+ Add child widget…</option>
          {childOptions.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
      </div>
      {children.length === 0 && (
        <div style={{ fontSize: 10, color: '#CBD5E1', padding: '4px 0' }}>
          No children yet — add one above.
        </div>
      )}
      {children.map((child) => (
        <div key={child.id} style={{
          marginBottom: 6, padding: 6,
          border: '1px solid #E2E8F0', borderRadius: 4,
          fontSize: 11,
        }}>
          <div style={{ display: 'flex', gap: 4, marginBottom: 4 }}>
            <input
              value={child.title}
              onChange={(e) => updateChild(child.id, { title: e.target.value })}
              style={{ flex: 1, height: 22, padding: '0 6px', fontSize: 11, border: '1px solid #E2E8F0', borderRadius: 3 }}
            />
            <button
              onClick={() => removeChild(child.id)}
              style={{ width: 22, height: 22, fontSize: 10, border: '1px solid #FCA5A5', borderRadius: 3, backgroundColor: '#FEF2F2', color: '#DC2626', cursor: 'pointer' }}
            >×</button>
          </div>
          <div style={{ display: 'flex', gap: 4 }}>
            <span style={{ fontSize: 9, color: '#94A3B8' }}>{child.type}</span>
            <span style={{ marginLeft: 'auto', fontSize: 9, color: '#94A3B8' }}>span:</span>
            <select
              value={child.colSpan || 6}
              onChange={(e) => updateChild(child.id, { colSpan: parseInt(e.target.value, 10) })}
              style={{ height: 18, fontSize: 9, border: '1px solid #E2E8F0', borderRadius: 3 }}
            >
              {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </div>
        </div>
      ))}
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

// Each preset maps to a stock cron expression (UTC). 'manual' means no
// schedule — the existing schedule (if any) is deleted when picked.
const SCHEDULE_PRESETS: Array<{ value: string; label: string; cron: string | null }> = [
  { value: 'manual', label: 'Manual only',     cron: null },
  { value: '15m',    label: 'Every 15 min',    cron: '*/15 * * * *' },
  { value: '1h',     label: 'Every hour',      cron: '0 * * * *' },
  { value: '6h',     label: 'Every 6 hours',   cron: '0 */6 * * *' },
  { value: '12h',    label: 'Every 12 hours',  cron: '0 */12 * * *' },
  { value: '24h',    label: 'Every day',       cron: '0 0 * * *' },
  { value: '7d',     label: 'Every week',      cron: '0 0 * * 0' },
];

// Loose validator: 5 space-separated tokens, each containing only the
// characters cron expressions allow. Server-side croniter is the real
// authority — this just catches obvious typos before the network call.
function isValidCronExpr(expr: string): boolean {
  const trimmed = expr.trim();
  const parts = trimmed.split(/\s+/);
  if (parts.length !== 5) return false;
  return parts.every((p) => /^[\d*/,\-]+$/.test(p));
}

// Reverse-derive which preset a cron expression matches; returns 'custom'
// for anything we don't recognize (so the Custom input takes over).
function presetForCron(cron: string): string {
  const match = SCHEDULE_PRESETS.find((p) => p.cron === cron);
  return match ? match.value : 'custom';
}

const PIPELINE_API = import.meta.env.VITE_PIPELINE_SERVICE_URL || 'http://localhost:8002';

type PipelineScheduleLite = {
  id: string;
  pipeline_id: string;
  name: string;
  cron_expression: string;
  enabled: boolean;
  last_run_at: string | null;
};

const SyncPanel: React.FC<{ app: NexusApp; components: AppComponent[]; objectTypes: OntologyType[] }> = ({
  app, components, objectTypes,
}) => {
  // Per-OT state for "Run now" feedback and inline custom-cron editing.
  const [running, setRunning] = useState<Record<string, boolean>>({});
  const [customCron, setCustomCron] = useState<Record<string, string>>({});
  const [error, setError] = useState<Record<string, string>>({});
  const [schedules, setSchedules] = useState<Record<string, PipelineScheduleLite | null>>({});
  const [loaded, setLoaded] = useState(false);

  // Per-OT used in this app, deduped. Filter out entries without an
  // object type (chat widgets etc. that don't bind to one).
  const usedOtIds = Array.from(new Set(components.map((c) => c.objectTypeId).filter(Boolean))) as string[];
  const otById = (otId: string) => objectTypes.find((o) => o.id === otId);

  // Fetch the active schedule for each pipeline-backed OT once on mount.
  // We pick the first enabled schedule per pipeline as "the" schedule —
  // this UI manages a single auto-schedule per pipeline; users with more
  // complex setups still go to the Pipeline Builder.
  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      const next: Record<string, PipelineScheduleLite | null> = {};
      for (const otId of usedOtIds) {
        const ot = otById(otId);
        if (!ot?.sourcePipelineId) { next[otId] = null; continue; }
        try {
          const r = await fetch(`${PIPELINE_API}/pipelines/${ot.sourcePipelineId}/schedules`, {
            headers: { 'x-tenant-id': getTenantId() },
          });
          if (!r.ok) { next[otId] = null; continue; }
          const list = await r.json();
          const active = (Array.isArray(list) ? list : []).find((s: PipelineScheduleLite) => s.enabled) || (Array.isArray(list) ? list[0] : null) || null;
          next[otId] = active;
        } catch {
          next[otId] = null;
        }
      }
      if (!cancelled) { setSchedules(next); setLoaded(true); }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [usedOtIds.join(',')]);

  // Apply a cron string to a pipeline. If schedule exists, update; else
  // create. If cron is null (manual), delete any existing schedule.
  const applyCron = async (otId: string, cron: string | null) => {
    const ot = otById(otId);
    if (!ot?.sourcePipelineId) {
      setError((p) => ({ ...p, [otId]: 'No pipeline backs this object type' }));
      return;
    }
    const pipelineId = ot.sourcePipelineId;
    const existing = schedules[otId];
    const headers = { 'Content-Type': 'application/json', 'x-tenant-id': getTenantId() };
    setError((p) => ({ ...p, [otId]: '' }));
    try {
      if (cron === null) {
        if (existing) {
          await fetch(`${PIPELINE_API}/pipelines/${pipelineId}/schedules/${existing.id}`, { method: 'DELETE', headers });
        }
        setSchedules((p) => ({ ...p, [otId]: null }));
        return;
      }
      if (!isValidCronExpr(cron)) {
        setError((p) => ({ ...p, [otId]: 'Invalid cron expression — needs 5 space-separated fields' }));
        return;
      }
      if (existing) {
        const r = await fetch(`${PIPELINE_API}/pipelines/${pipelineId}/schedules/${existing.id}`, {
          method: 'PUT', headers,
          body: JSON.stringify({ cron_expression: cron, enabled: true }),
        });
        if (!r.ok) throw new Error(await r.text());
        const updated = await r.json();
        setSchedules((p) => ({ ...p, [otId]: updated }));
      } else {
        const r = await fetch(`${PIPELINE_API}/pipelines/${pipelineId}/schedules`, {
          method: 'POST', headers,
          body: JSON.stringify({ name: 'App schedule', cron_expression: cron, enabled: true }),
        });
        if (!r.ok) throw new Error(await r.text());
        const created = await r.json();
        setSchedules((p) => ({ ...p, [otId]: created }));
      }
    } catch (e) {
      setError((p) => ({ ...p, [otId]: e instanceof Error ? e.message.slice(0, 200) : 'Failed to save schedule' }));
    }
  };

  const runNow = async (otId: string) => {
    const ot = otById(otId);
    if (!ot?.sourcePipelineId) return;
    const pipelineId = ot.sourcePipelineId;
    const sched = schedules[otId];
    setRunning((p) => ({ ...p, [otId]: true }));
    try {
      if (sched) {
        await fetch(`${PIPELINE_API}/pipelines/${pipelineId}/schedules/${sched.id}/run-now`, {
          method: 'POST', headers: { 'x-tenant-id': getTenantId() },
        });
      } else {
        await fetch(`${PIPELINE_API}/pipelines/${pipelineId}/run`, {
          method: 'POST', headers: { 'x-tenant-id': getTenantId() },
        });
      }
    } finally {
      setRunning((p) => ({ ...p, [otId]: false }));
    }
  };

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: 32, backgroundColor: '#F8FAFC' }}>
      <div style={{ maxWidth: 720, margin: '0 auto' }}>
        <div style={{ marginBottom: 28 }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: '#0D1117', marginBottom: 4 }}>Data Sync</div>
          <div style={{ fontSize: 13, color: '#64748B' }}>
            Each object type below is backed by a pipeline. Schedules here create, update, or delete a schedule on that pipeline directly — the platform&apos;s cron worker fires them every minute.
          </div>
        </div>

        <div style={{ backgroundColor: '#fff', border: '1px solid #E2E8F0', borderRadius: 10, padding: 20 }}>
          {usedOtIds.length === 0 && (
            <div style={{ fontSize: 13, color: '#94A3B8', textAlign: 'center', padding: '24px 0' }}>
              No data sources connected. Add widgets with object types first.
            </div>
          )}
          {!loaded && usedOtIds.length > 0 && (
            <div style={{ fontSize: 12, color: '#94A3B8', padding: '8px 0' }}>Loading schedules…</div>
          )}
          {loaded && usedOtIds.map((otId, idx) => {
            const ot = otById(otId);
            const sched = schedules[otId] || null;
            const cron = sched?.enabled ? sched.cron_expression : null;
            const activePreset = cron ? presetForCron(cron) : 'manual';
            const inputCustom = customCron[otId] ?? (activePreset === 'custom' ? (cron || '') : '');
            const usedByWidgets = components.filter((c) => c.objectTypeId === otId).map((c) => c.title || c.type);
            const last = sched?.last_run_at;
            const err = error[otId];

            return (
              <div key={otId} style={{
                paddingTop: idx === 0 ? 0 : 18,
                paddingBottom: 18,
                borderTop: idx === 0 ? 'none' : '1px solid #F1F5F9',
              }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 10 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 700, color: '#0D1117' }}>{ot?.displayName || ot?.name || 'Unknown'}</div>
                    <div style={{ fontSize: 11, color: '#94A3B8', marginTop: 2 }}>
                      Used by: {usedByWidgets.slice(0, 3).join(', ')}{usedByWidgets.length > 3 ? ` +${usedByWidgets.length - 3} more` : ''}
                    </div>
                    {!ot?.sourcePipelineId && (
                      <div style={{ fontSize: 11, color: '#B45309', backgroundColor: '#FEF3C7', borderRadius: 4, padding: '4px 8px', marginTop: 4, display: 'inline-block' }}>
                        Not pipeline-backed — schedule via the source connector instead.
                      </div>
                    )}
                    {ot?.sourcePipelineId && cron && (
                      <div style={{ fontSize: 11, color: '#059669', marginTop: 4 }}>
                        Active cron: <code style={{ fontFamily: 'var(--font-mono)' }}>{cron}</code>
                        {last && <> · last ran {new Date(last).toLocaleString()}</>}
                      </div>
                    )}
                    {ot?.sourcePipelineId && !cron && (
                      <div style={{ fontSize: 11, color: '#94A3B8', marginTop: 4 }}>No automatic schedule — manual runs only.</div>
                    )}
                  </div>
                  <button
                    onClick={() => runNow(otId)}
                    disabled={running[otId] || !ot?.sourcePipelineId}
                    style={{
                      padding: '6px 14px', borderRadius: 6, border: '1px solid #E2E8F0',
                      backgroundColor: running[otId] ? '#F1F5F9' : '#fff',
                      color: running[otId] ? '#94A3B8' : '#374151',
                      fontSize: 12, fontWeight: 500,
                      cursor: running[otId] || !ot?.sourcePipelineId ? 'not-allowed' : 'pointer',
                      flexShrink: 0,
                    }}
                  >
                    {running[otId] ? 'Running…' : 'Run now'}
                  </button>
                </div>

                {ot?.sourcePipelineId && (
                  <>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6 }}>
                      {SCHEDULE_PRESETS.map((opt) => (
                        <button
                          key={opt.value}
                          onClick={() => applyCron(otId, opt.cron)}
                          style={{
                            padding: '8px 10px', borderRadius: 6, cursor: 'pointer', textAlign: 'left',
                            border: activePreset === opt.value ? '2px solid #2563EB' : '1px solid #E2E8F0',
                            backgroundColor: activePreset === opt.value ? '#EFF6FF' : '#FAFAFA',
                            color: activePreset === opt.value ? '#2563EB' : '#374151',
                            fontSize: 12, fontWeight: activePreset === opt.value ? 600 : 400,
                          }}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                    <div style={{ marginTop: 8, display: 'flex', gap: 6, alignItems: 'center' }}>
                      <span style={{ fontSize: 11, color: '#64748B', flexShrink: 0 }}>Custom cron:</span>
                      <input
                        value={inputCustom}
                        onChange={(e) => setCustomCron((p) => ({ ...p, [otId]: e.target.value }))}
                        placeholder="*/5 * * * *"
                        style={{
                          flex: 1, height: 28, padding: '0 8px',
                          fontFamily: 'var(--font-mono)', fontSize: 12,
                          border: `1px solid ${activePreset === 'custom' ? '#2563EB' : '#E2E8F0'}`,
                          borderRadius: 4, outline: 'none',
                        }}
                      />
                      <button
                        onClick={() => applyCron(otId, inputCustom.trim())}
                        disabled={!inputCustom.trim()}
                        style={{
                          padding: '6px 12px', borderRadius: 4, border: '1px solid #2563EB',
                          backgroundColor: inputCustom.trim() ? '#2563EB' : '#F1F5F9',
                          color: inputCustom.trim() ? '#fff' : '#94A3B8',
                          fontSize: 12, fontWeight: 500,
                          cursor: inputCustom.trim() ? 'pointer' : 'not-allowed',
                        }}
                      >
                        Apply
                      </button>
                      <a href="https://crontab.guru" target="_blank" rel="noreferrer" style={{ fontSize: 10, color: '#64748B', textDecoration: 'underline' }}>help</a>
                    </div>
                    {err && (
                      <div style={{ marginTop: 6, fontSize: 11, color: '#DC2626', backgroundColor: '#FEF2F2', borderRadius: 4, padding: '4px 8px' }}>
                        {err}
                      </div>
                    )}
                    <div style={{ marginTop: 6, fontSize: 10, color: '#94A3B8' }}>
                      Cron is evaluated in UTC. For El Salvador time, add 6 hours (e.g. midnight CST = <code style={{ fontFamily: 'var(--font-mono)' }}>0 6 * * *</code>).
                    </div>
                  </>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

// ── App settings panel (renders in the right sidebar when no widget is
//    selected). Houses the dashboard-level filter bar config. ─────────────

const APP_RANGE_OPTS: Array<{ value: RangePreset; label: string }> = [
  { value: 'all_time',  label: 'All time' },
  { value: 'last_24h',  label: 'Last 24 hours' },
  { value: 'today',     label: 'Today' },
  { value: 'last_7d',   label: 'Last 7 days' },
  { value: 'last_30d',  label: 'Last 30 days' },
  { value: 'last_90d',  label: 'Last 90 days' },
  { value: 'last_year', label: 'Last year' },
  { value: 'custom',    label: 'Custom range' },
];

// ── Actions list (Phase H) ──────────────────────────────────────────────
// Right-panel section listing all declared AppAction[] for the app.
// Each action has a kind, a target object type / utility / workflow / webhook,
// field mappings, and (for object updates) a record id resolution strategy.

// PostFlightEditor — a compact editor for AppEventAction used inline in the
// action panel (onSuccess / onError handlers). Covers the common subset of
// AppEventAction fields. Set type='' to clear.
const PostFlightEditor: React.FC<{
  label: string;
  value: AppEventAction | undefined;
  onChange: (v: AppEventAction | undefined) => void;
}> = ({ label, value, onChange }) => {
  const set = (patch: Partial<AppEventAction>) => {
    onChange({ ...(value || { type: 'setVariable' as const }), ...patch });
  };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 3, marginTop: 6 }}>
      <div style={{ fontSize: 10, fontWeight: 600, color: '#7C3AED' }}>{label}</div>
      <select
        value={value?.type || ''}
        onChange={(e) => {
          const v = e.target.value;
          if (!v) onChange(undefined);
          else set({ type: v as AppEventAction['type'] });
        }}
        style={{ height: 22, padding: '0 4px', fontSize: 10, border: '1px solid #E2E8F0', borderRadius: 3 }}
      >
        <option value="">— none —</option>
        <option value="setVariable">Set variable</option>
        <option value="refreshWidget">Refresh widget</option>
        <option value="openDashboard">Open dashboard</option>
        <option value="openDashboardModal">Open dashboard (modal)</option>
        <option value="generateDashboard">Generate dashboard</option>
        <option value="runAction">Run another action</option>
      </select>
      {value?.type === 'setVariable' && (
        <>
          <input
            value={value.variableId || ''}
            onChange={(e) => set({ variableId: e.target.value })}
            placeholder="variable id"
            style={{ height: 20, padding: '0 6px', fontSize: 10, border: '1px solid #E2E8F0', borderRadius: 3 }}
          />
          <input
            value={value.valueFrom || ''}
            onChange={(e) => set({ valueFrom: e.target.value })}
            placeholder="value from (e.g. response.id)"
            style={{ height: 20, padding: '0 6px', fontSize: 10, border: '1px solid #E2E8F0', borderRadius: 3 }}
          />
        </>
      )}
      {value?.type === 'refreshWidget' && (
        <input
          value={value.targetWidgetId || ''}
          onChange={(e) => set({ targetWidgetId: e.target.value })}
          placeholder="widget id to refresh"
          style={{ height: 20, padding: '0 6px', fontSize: 10, border: '1px solid #E2E8F0', borderRadius: 3 }}
        />
      )}
      {(value?.type === 'openDashboard' || value?.type === 'openDashboardModal') && (
        <>
          <input
            value={value.targetDashboardId || ''}
            onChange={(e) => set({ targetDashboardId: e.target.value })}
            placeholder="target dashboard id"
            style={{ height: 20, padding: '0 6px', fontSize: 10, border: '1px solid #E2E8F0', borderRadius: 3 }}
          />
          <select
            value={value.displayMode || 'replace'}
            onChange={(e) => set({ displayMode: e.target.value as AppEventAction['displayMode'] })}
            style={{ height: 20, padding: '0 4px', fontSize: 10, border: '1px solid #E2E8F0', borderRadius: 3 }}
          >
            <option value="replace">replace</option>
            <option value="modal">modal</option>
            <option value="sidepanel">sidepanel</option>
          </select>
        </>
      )}
      {value?.type === 'generateDashboard' && (
        <textarea
          value={value.generatePromptTemplate || ''}
          onChange={(e) => set({ generatePromptTemplate: e.target.value })}
          placeholder="prompt template"
          rows={2}
          style={{ padding: '4px 6px', fontSize: 10, border: '1px solid #E2E8F0', borderRadius: 3, resize: 'vertical', fontFamily: 'inherit' }}
        />
      )}
      {value?.type === 'runAction' && (
        <input
          value={value.actionId || ''}
          onChange={(e) => set({ actionId: e.target.value })}
          placeholder="action id"
          style={{ height: 20, padding: '0 6px', fontSize: 10, border: '1px solid #E2E8F0', borderRadius: 3 }}
        />
      )}
    </div>
  );
};

const ActionsList: React.FC<{
  actions: AppAction[];
  onChange: (a: AppAction[]) => void;
  objectTypes: OntologyType[];
}> = ({ actions, onChange, objectTypes }) => {
  const [expanded, setExpanded] = useState<string | null>(null);

  const add = () => {
    const a: AppAction = {
      id: `act-${Date.now()}`,
      name: `Action ${actions.length + 1}`,
      kind: 'createObject',
      fieldMappings: [],
    };
    onChange([...actions, a]);
    setExpanded(a.id);
  };
  const update = (id: string, patch: Partial<AppAction>) => {
    onChange(actions.map((a) => a.id === id ? { ...a, ...patch } : a));
  };
  const remove = (id: string) => {
    onChange(actions.filter((a) => a.id !== id));
  };

  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: '#334155' }}>
          Actions
        </div>
        <button
          onClick={add}
          style={{
            padding: '3px 10px', fontSize: 11, fontWeight: 500,
            border: '1px solid #DDD6FE', borderRadius: 4,
            backgroundColor: '#FAF5FF', color: '#7C3AED', cursor: 'pointer',
          }}
        >+ Action</button>
      </div>
      {actions.length === 0 && (
        <div style={{ fontSize: 11, color: '#CBD5E1', padding: '4px 0' }}>
          No actions declared. Forms and action-buttons need an action to wire to.
        </div>
      )}
      {actions.map((a) => {
        const open = expanded === a.id;
        return (
          <div key={a.id} style={{
            marginBottom: 6, border: '1px solid #E2E8F0', borderRadius: 5,
            backgroundColor: '#fff',
          }}>
            <div
              onClick={() => setExpanded(open ? null : a.id)}
              style={{
                padding: '6px 10px', cursor: 'pointer',
                display: 'flex', alignItems: 'center', gap: 6, fontSize: 11,
              }}
            >
              <span style={{ fontWeight: 600, color: '#0D1117' }}>{a.name}</span>
              <span style={{ fontSize: 9, color: '#64748B', backgroundColor: '#F1F5F9', padding: '1px 6px', borderRadius: 3 }}>
                {a.kind}
              </span>
              <button
                onClick={(e) => { e.stopPropagation(); remove(a.id); }}
                style={{ marginLeft: 'auto', width: 20, height: 20, border: 'none', backgroundColor: 'transparent', cursor: 'pointer', color: '#DC2626', fontSize: 11 }}
              >×</button>
            </div>
            {open && (
              <div style={{ padding: '8px 10px', borderTop: '1px solid #F1F5F9', display: 'flex', flexDirection: 'column', gap: 6 }}>
                <input
                  value={a.name}
                  onChange={(e) => update(a.id, { name: e.target.value })}
                  placeholder="Name"
                  style={{ height: 24, padding: '0 6px', fontSize: 11, border: '1px solid #E2E8F0', borderRadius: 3 }}
                />
                <select
                  value={a.kind}
                  onChange={(e) => update(a.id, { kind: e.target.value as ActionKind })}
                  style={{ height: 24, padding: '0 4px', fontSize: 11, border: '1px solid #E2E8F0', borderRadius: 3 }}
                >
                  <option value="createObject">Create object</option>
                  <option value="updateObject">Update object</option>
                  <option value="deleteObject">Delete object</option>
                  <option value="callUtility">Call utility</option>
                  <option value="runWorkflow">Run workflow</option>
                  <option value="webhook">Webhook</option>
                </select>
                {(a.kind === 'createObject' || a.kind === 'updateObject' || a.kind === 'deleteObject') && (
                  <select
                    value={a.objectTypeId || ''}
                    onChange={(e) => update(a.id, { objectTypeId: e.target.value })}
                    style={{ height: 24, padding: '0 4px', fontSize: 11, border: '1px solid #E2E8F0', borderRadius: 3 }}
                  >
                    <option value="">— pick object type —</option>
                    {objectTypes.map((ot) => <option key={ot.id} value={ot.id}>{ot.displayName || ot.name}</option>)}
                  </select>
                )}
                {/* Record ID source — only meaningful for update/delete. */}
                {(a.kind === 'updateObject' || a.kind === 'deleteObject') && (
                  <>
                    <div style={{ fontSize: 10, fontWeight: 600, color: '#7C3AED', marginTop: 4 }}>
                      RECORD ID SOURCE
                    </div>
                    <select
                      value={a.recordIdSource || ''}
                      onChange={(e) => update(a.id, { recordIdSource: e.target.value as AppAction['recordIdSource'] })}
                      style={{ height: 22, padding: '0 4px', fontSize: 10, border: '1px solid #E2E8F0', borderRadius: 3 }}
                    >
                      <option value="">— pick source —</option>
                      <option value="formField">From a form field</option>
                      <option value="variable">From a dashboard variable</option>
                      <option value="selectedRow">From the selected table row</option>
                    </select>
                    <input
                      value={a.recordIdField || ''}
                      onChange={(e) => update(a.id, { recordIdField: e.target.value })}
                      placeholder={
                        a.recordIdSource === 'formField' ? 'form field name (e.g. "id")'
                        : a.recordIdSource === 'variable' ? 'variable id'
                        : a.recordIdSource === 'selectedRow' ? 'row field name (e.g. "id")'
                        : 'name'
                      }
                      style={{ height: 22, padding: '0 6px', fontSize: 10, border: '1px solid #E2E8F0', borderRadius: 3 }}
                    />
                  </>
                )}
                {a.kind === 'webhook' && (
                  <input
                    value={a.webhookUrl || ''}
                    onChange={(e) => update(a.id, { webhookUrl: e.target.value })}
                    placeholder="https://…"
                    style={{ height: 24, padding: '0 6px', fontSize: 11, border: '1px solid #E2E8F0', borderRadius: 3 }}
                  />
                )}
                {a.kind === 'callUtility' && (
                  <input
                    value={a.utilityId || ''}
                    onChange={(e) => update(a.id, { utilityId: e.target.value })}
                    placeholder="utility id"
                    style={{ height: 24, padding: '0 6px', fontSize: 11, border: '1px solid #E2E8F0', borderRadius: 3 }}
                  />
                )}
                {a.kind === 'runWorkflow' && (
                  <input
                    value={a.workflowId || ''}
                    onChange={(e) => update(a.id, { workflowId: e.target.value })}
                    placeholder="workflow id"
                    style={{ height: 24, padding: '0 6px', fontSize: 11, border: '1px solid #E2E8F0', borderRadius: 3 }}
                  />
                )}
                {/* Field mappings — formField → targetProperty (+ optional transform) */}
                <div style={{ fontSize: 10, fontWeight: 600, color: '#7C3AED', marginTop: 4 }}>
                  FIELD MAPPINGS
                </div>
                {(a.fieldMappings || []).map((m, i) => {
                  const updateMapping = (patch: Partial<typeof m>) => {
                    const next = [...(a.fieldMappings || [])];
                    next[i] = { ...m, ...patch };
                    update(a.id, { fieldMappings: next });
                  };
                  return (
                    <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 3, padding: 4, border: '1px solid #F1F5F9', borderRadius: 3 }}>
                      <div style={{ display: 'flex', gap: 4 }}>
                        <input
                          value={m.formField}
                          onChange={(e) => updateMapping({ formField: e.target.value })}
                          placeholder="form field"
                          style={{ flex: 1, height: 22, padding: '0 6px', fontSize: 10, border: '1px solid #E2E8F0', borderRadius: 3 }}
                        />
                        <span style={{ alignSelf: 'center', fontSize: 10, color: '#94A3B8' }}>→</span>
                        <input
                          value={m.targetProperty}
                          onChange={(e) => updateMapping({ targetProperty: e.target.value })}
                          placeholder="target property"
                          style={{ flex: 1, height: 22, padding: '0 6px', fontSize: 10, border: '1px solid #E2E8F0', borderRadius: 3 }}
                        />
                        <button
                          onClick={() => {
                            const next = (a.fieldMappings || []).filter((_, idx) => idx !== i);
                            update(a.id, { fieldMappings: next });
                          }}
                          style={{ width: 22, height: 22, fontSize: 10, border: '1px solid #FCA5A5', borderRadius: 3, backgroundColor: '#FEF2F2', color: '#DC2626', cursor: 'pointer' }}
                        >×</button>
                      </div>
                      <div style={{ display: 'flex', gap: 4 }}>
                        <select
                          value={m.transform || ''}
                          onChange={(e) => updateMapping({ transform: (e.target.value || undefined) as typeof m.transform })}
                          style={{ flex: 1, height: 20, padding: '0 4px', fontSize: 9, border: '1px solid #E2E8F0', borderRadius: 3, color: '#64748B' }}
                          title="Cast incoming form value before submitting"
                        >
                          <option value="">no transform (string)</option>
                          <option value="asNumber">as number</option>
                          <option value="asDate">as date</option>
                          <option value="asUuid">as uuid</option>
                          <option value="literal">literal value</option>
                        </select>
                        {m.transform === 'literal' && (
                          <input
                            value={m.literalValue || ''}
                            onChange={(e) => updateMapping({ literalValue: e.target.value })}
                            placeholder="literal value"
                            style={{ flex: 1, height: 20, padding: '0 6px', fontSize: 9, border: '1px solid #E2E8F0', borderRadius: 3 }}
                          />
                        )}
                      </div>
                    </div>
                  );
                })}
                <button
                  onClick={() => update(a.id, {
                    fieldMappings: [...(a.fieldMappings || []), { formField: '', targetProperty: '' }],
                  })}
                  style={{
                    padding: '3px 0', fontSize: 10, color: '#7C3AED',
                    border: '1px dashed #DDD6FE', borderRadius: 3,
                    backgroundColor: 'transparent', cursor: 'pointer',
                  }}
                >+ Mapping</button>

                {/* Confirmation dialog */}
                <div style={{ fontSize: 10, fontWeight: 600, color: '#7C3AED', marginTop: 8 }}>
                  CONFIRMATION DIALOG (optional)
                </div>
                <input
                  value={a.confirmation?.title || ''}
                  onChange={(e) => update(a.id, {
                    confirmation: { title: e.target.value, body: a.confirmation?.body || '' },
                  })}
                  placeholder="dialog title (e.g. Post this transaction?)"
                  style={{ height: 22, padding: '0 6px', fontSize: 10, border: '1px solid #E2E8F0', borderRadius: 3 }}
                />
                <textarea
                  value={a.confirmation?.body || ''}
                  onChange={(e) => update(a.id, {
                    confirmation: { title: a.confirmation?.title || '', body: e.target.value },
                  })}
                  placeholder="dialog body (shown beneath the title)"
                  rows={2}
                  style={{ padding: '4px 6px', fontSize: 10, border: '1px solid #E2E8F0', borderRadius: 3, resize: 'vertical', fontFamily: 'inherit' }}
                />
                {a.confirmation?.title && (
                  <button
                    onClick={() => update(a.id, { confirmation: undefined })}
                    style={{ alignSelf: 'flex-start', padding: '2px 6px', fontSize: 9, color: '#94A3B8', border: '1px solid #E2E8F0', borderRadius: 3, backgroundColor: 'transparent', cursor: 'pointer' }}
                  >clear confirmation</button>
                )}

                {/* Validations */}
                <div style={{ fontSize: 10, fontWeight: 600, color: '#7C3AED', marginTop: 8 }}>
                  VALIDATIONS (optional)
                </div>
                {(a.validations || []).map((v, i) => {
                  const updateVal = (patch: Partial<typeof v>) => {
                    const next = [...(a.validations || [])];
                    next[i] = { ...v, ...patch };
                    update(a.id, { validations: next });
                  };
                  return (
                    <div key={i} style={{ display: 'flex', gap: 4 }}>
                      <input
                        value={v.field}
                        onChange={(e) => updateVal({ field: e.target.value })}
                        placeholder="form field"
                        style={{ flex: 1, height: 22, padding: '0 6px', fontSize: 10, border: '1px solid #E2E8F0', borderRadius: 3 }}
                      />
                      <select
                        value={v.rule}
                        onChange={(e) => updateVal({ rule: e.target.value as typeof v.rule })}
                        style={{ width: 70, height: 22, padding: '0 4px', fontSize: 10, border: '1px solid #E2E8F0', borderRadius: 3 }}
                      >
                        <option value="required">required</option>
                        <option value="regex">regex</option>
                        <option value="min">min</option>
                        <option value="max">max</option>
                      </select>
                      {(v.rule === 'regex' || v.rule === 'min' || v.rule === 'max') && (
                        <input
                          value={v.value || ''}
                          onChange={(e) => updateVal({ value: e.target.value })}
                          placeholder={v.rule === 'regex' ? '^[a-z]+$' : 'value'}
                          style={{ width: 70, height: 22, padding: '0 6px', fontSize: 10, border: '1px solid #E2E8F0', borderRadius: 3 }}
                        />
                      )}
                      <button
                        onClick={() => update(a.id, {
                          validations: (a.validations || []).filter((_, idx) => idx !== i),
                        })}
                        style={{ width: 22, height: 22, fontSize: 10, border: '1px solid #FCA5A5', borderRadius: 3, backgroundColor: '#FEF2F2', color: '#DC2626', cursor: 'pointer' }}
                      >×</button>
                    </div>
                  );
                })}
                {(a.validations || []).map((v, i) => v.message !== undefined && (
                  <input
                    key={`msg-${i}`}
                    value={v.message || ''}
                    onChange={(e) => {
                      const next = [...(a.validations || [])];
                      next[i] = { ...v, message: e.target.value };
                      update(a.id, { validations: next });
                    }}
                    placeholder={`error message for "${v.field || 'field'}"`}
                    style={{ height: 20, padding: '0 6px', fontSize: 9, border: '1px solid #E2E8F0', borderRadius: 3, color: '#64748B' }}
                  />
                ))}
                <button
                  onClick={() => update(a.id, {
                    validations: [...(a.validations || []), { field: '', rule: 'required', message: '' }],
                  })}
                  style={{
                    padding: '3px 0', fontSize: 10, color: '#7C3AED',
                    border: '1px dashed #DDD6FE', borderRadius: 3,
                    backgroundColor: 'transparent', cursor: 'pointer',
                  }}
                >+ Validation</button>

                {/* Post-flight handlers */}
                <PostFlightEditor
                  label="ON SUCCESS"
                  value={a.onSuccess}
                  onChange={(v) => update(a.id, { onSuccess: v })}
                />
                <PostFlightEditor
                  label="ON ERROR"
                  value={a.onError}
                  onChange={(v) => update(a.id, { onError: v })}
                />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};

const AppSettingsPanel: React.FC<{
  filterBar: DashboardFilterBar | undefined;
  onChange: (fb: DashboardFilterBar | undefined) => void;
  components: AppComponent[];
  objectTypes: OntologyType[];
  kind?: 'dashboard' | 'app';
  onKindChange?: (k: 'dashboard' | 'app') => void;
  actions?: AppAction[];
  onActionsChange?: (a: AppAction[]) => void;
  events?: AppEvent[];
  onEventsChange?: (e: AppEvent[]) => void;
}> = ({ filterBar, onChange, components, objectTypes, kind = 'dashboard', onKindChange, actions, onActionsChange }) => {
  // Use the first widget with an objectTypeId as the source of fields for
  // the time/group field pickers. The user can still type any field name
  // manually if their dashboard mixes object types.
  const firstOtId = components.find((c) => c.objectTypeId)?.objectTypeId;
  const ot = objectTypes.find((o) => o.id === firstOtId);
  const fields = ot ? ot.properties.filter((p) => !p.name.endsWith('[]')).map((p) => p.name) : [];

  const fb: DashboardFilterBar = filterBar || { enabled: false };
  const upd = (patch: Partial<DashboardFilterBar>) => onChange({ ...fb, ...patch });

  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '6px 8px', border: '1px solid #E2E8F0',
    borderRadius: 4, fontSize: 12, color: '#0D1117', outline: 'none',
    backgroundColor: '#fff',
  };
  const lblStyle: React.CSSProperties = {
    fontSize: 10, fontWeight: 600, color: '#64748B',
    marginBottom: 4, letterSpacing: '0.04em',
  };

  return (
    <div style={{
      width: 320, borderLeft: '1px solid #E2E8F0', backgroundColor: '#FAFBFC',
      display: 'flex', flexDirection: 'column', overflow: 'hidden',
    }}>
      <div style={{
        padding: '10px 14px', borderBottom: '1px solid #E2E8F0',
        backgroundColor: '#fff',
      }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: '#0D1117' }}>App Settings</div>
        <div style={{ fontSize: 11, color: '#64748B', marginTop: 2 }}>
          Click a widget to edit it, or configure dashboard-level options here.
        </div>
      </div>
      <div style={{ flex: 1, padding: '14px', overflowY: 'auto' }}>
        {/* ── Phase G — kind toggle ── */}
        {onKindChange && (
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: '#334155', marginBottom: 8 }}>
              Lives in
            </div>
            <div style={{ display: 'flex', gap: 0, border: '1px solid #E2E8F0', borderRadius: 6, overflow: 'hidden' }}>
              {(['dashboard', 'app'] as const).map((k) => {
                const active = kind === k;
                return (
                  <button
                    key={k}
                    onClick={() => onKindChange(k)}
                    style={{
                      flex: 1, padding: '6px 0', border: 'none', borderRight: k === 'dashboard' ? '1px solid #E2E8F0' : 'none',
                      fontSize: 12, fontWeight: 600,
                      color: active ? '#fff' : '#475569',
                      backgroundColor: active ? '#7C3AED' : '#fff',
                      cursor: 'pointer',
                    }}
                  >
                    {k === 'dashboard' ? 'Dashboards' : 'Apps'}
                  </button>
                );
              })}
            </div>
            <div style={{ fontSize: 10, color: '#94A3B8', marginTop: 4 }}>
              Dashboards are read-only viz. Apps include forms, action buttons, and writes.
            </div>
          </div>
        )}

        {/* ── Phase H — Actions ── */}
        {actions && onActionsChange && (
          <ActionsList actions={actions} onChange={onActionsChange} objectTypes={objectTypes} />
        )}

        <div style={{ fontSize: 12, fontWeight: 600, color: '#334155', marginBottom: 10 }}>
          Dashboard Filter Bar
        </div>

        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#334155', cursor: 'pointer', marginBottom: 12 }}>
          <input
            type="checkbox"
            checked={!!fb.enabled}
            onChange={(e) => upd({ enabled: e.target.checked })}
          />
          Show filter bar at top of dashboard
        </label>

        {fb.enabled && (
          <>
            <div style={{ marginBottom: 12 }}>
              <div style={lblStyle}>TIME FIELD</div>
              {fields.length > 0 ? (
                <select
                  value={fb.timeField || ''}
                  onChange={(e) => upd({ timeField: e.target.value || undefined })}
                  style={inputStyle}
                >
                  <option value="">— pick a date/time field —</option>
                  {fields.map((f) => <option key={f} value={f}>{f}</option>)}
                </select>
              ) : (
                <input
                  value={fb.timeField || ''}
                  onChange={(e) => upd({ timeField: e.target.value || undefined })}
                  placeholder="e.g. time, created_at"
                  style={inputStyle}
                />
              )}
            </div>

            <div style={{ marginBottom: 12 }}>
              <div style={lblStyle}>DEFAULT RANGE</div>
              <select
                value={fb.defaultRange || 'last_7d'}
                onChange={(e) => upd({ defaultRange: e.target.value as RangePreset })}
                style={inputStyle}
              >
                {APP_RANGE_OPTS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>

            {fb.defaultRange === 'custom' && (
              <>
                <div style={{ marginBottom: 12 }}>
                  <div style={lblStyle}>DEFAULT FROM (ISO)</div>
                  <input
                    value={fb.customStart || ''}
                    onChange={(e) => upd({ customStart: e.target.value })}
                    placeholder="2026-01-01T00:00:00Z"
                    style={inputStyle}
                  />
                </div>
                <div style={{ marginBottom: 12 }}>
                  <div style={lblStyle}>DEFAULT TO (ISO)</div>
                  <input
                    value={fb.customEnd || ''}
                    onChange={(e) => upd({ customEnd: e.target.value })}
                    placeholder="2026-04-01T00:00:00Z"
                    style={inputStyle}
                  />
                </div>
              </>
            )}

            <div style={{ marginBottom: 12 }}>
              <div style={lblStyle}>GROUP FILTER FIELD (optional)</div>
              {fields.length > 0 ? (
                <select
                  value={fb.groupField || ''}
                  onChange={(e) => upd({ groupField: e.target.value || undefined })}
                  style={inputStyle}
                >
                  <option value="">— none —</option>
                  {fields.map((f) => <option key={f} value={f}>{f}</option>)}
                </select>
              ) : (
                <input
                  value={fb.groupField || ''}
                  onChange={(e) => upd({ groupField: e.target.value || undefined })}
                  placeholder="e.g. sensor_name"
                  style={inputStyle}
                />
              )}
              <div style={{ marginTop: 4, fontSize: 10, color: '#94A3B8' }}>
                When set, the bar shows pills of distinct values for this field. Picking some scopes every inheriting widget to those rows.
              </div>
            </div>

            <div style={{
              marginTop: 16, padding: 10, backgroundColor: '#EFF6FF',
              border: '1px solid #BFDBFE', borderRadius: 6, fontSize: 11, color: '#1E3A8A',
            }}>
              <strong>Tip:</strong> per widget, toggle &ldquo;Inherit time range &amp; group filter from dashboard bar&rdquo; off to keep its own settings.
            </div>
          </>
        )}
      </div>
    </div>
  );
};

// ── App Editor (main export) ──────────────────────────────────────────────────

type Mode = 'view' | 'edit' | 'code' | 'sync';

const AppEditor: React.FC<{ app: NexusApp }> = ({ app }) => {
  const { updateApp } = useAppStore();
  const [mode, setMode] = useState<Mode>(app.components.length > 0 ? 'view' : 'edit');
  const [components, setComponents] = useState<AppComponent[]>(app.components);
  const [variables, setVariables] = useState<AppVariable[]>(app.variables || []);
  const [filterBar, setFilterBar] = useState<DashboardFilterBar | undefined>(app.filterBar);
  const [events, setEvents] = useState<AppEvent[]>(app.events || []);
  const [actions, setActions] = useState<AppAction[]>(app.actions || []);
  const [appKind, setAppKind] = useState<'dashboard' | 'app'>(app.kind || 'dashboard');
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
  const markVars = (vars: AppVariable[]) => { setVariables(vars); setDirty(true); };
  const markFilterBar = (fb: DashboardFilterBar | undefined) => { setFilterBar(fb); setDirty(true); };
  const markEvents = (evs: AppEvent[]) => { setEvents(evs); setDirty(true); };
  const markActions = (acts: AppAction[]) => { setActions(acts); setDirty(true); };
  const markKind = (k: 'dashboard' | 'app') => { setAppKind(k); setDirty(true); };

  const handleSave = async () => {
    setSaving(true);
    try {
      await updateApp(app.id, {
        components, variables, filterBar, events, actions, kind: appKind,
        updatedAt: new Date().toISOString(),
      });
      setDirty(false);
      setMode('view');
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

  const addWidgetFromNL = async (prompt: string, otId: string, genMode: 'widget' | 'code' | 'card' = 'widget') => {
    const ot = objectTypes.find((o) => o.id === otId);
    if (!ot) throw new Error('Object type not found');
    const fields = ot.properties.filter((p) => !p.name.endsWith('[]')).map((p) => p.name);

    let sampleRows: Record<string, unknown>[] = [];
    try {
      const r = await fetch(`${ONTOLOGY_API2}/object-types/${otId}/records`, {
        headers: { 'x-tenant-id': getTenantId() },
      });
      const d = await r.json();
      sampleRows = (d.records || []).slice(0, 10);
    } catch { /* ignore */ }

    const endpoint =
      genMode === 'code' ? 'generate-code' :
      genMode === 'card' ? 'generate-composite' :
      'generate-widget';
    const res = await fetch(`${INFERENCE_API}/infer/${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        description: prompt,
        object_type_id: otId,
        object_type_name: ot.displayName || ot.name,
        properties: fields,
        sample_rows: sampleRows,
        force_code: genMode === 'code',
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
            <AppCanvas app={{ ...app, components, filterBar }} />
          </div>
        )}

        {mode === 'edit' && (
          <>
            <LeftSidebar
              objectTypes={objectTypes}
              onAddWidget={addWidget}
              onAddWidgetFromNL={addWidgetFromNL}
              onClickField={handleFieldClick}
              variables={variables}
              onVariablesChange={markVars}
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
                allComponents={components}
                onChange={(c) => mark(components.map((x) => x.id === c.id ? c : x))}
                onDelete={() => del(selectedComp.id)}
                events={events}
                onEventsChange={markEvents}
                actions={actions}
                variables={variables}
                appId={app.id}
              />
            )}
            {!selectedComp && (
              <AppSettingsPanel
                filterBar={filterBar}
                onChange={markFilterBar}
                components={components}
                objectTypes={objectTypes}
                kind={appKind}
                onKindChange={markKind}
                actions={actions}
                onActionsChange={markActions}
                events={events}
                onEventsChange={markEvents}
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
