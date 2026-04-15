import React, { useEffect, useState, useMemo, useRef, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ComposedChart, Bar, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, BarChart } from 'recharts';
import { useProcessStore } from '../../store/processStore';
import { KpiBanner } from './KpiBanner';
import { DonutChart } from './DonutChart';
import { InlineValueBar } from './InlineValueBar';
import { getTenantId } from '../../store/authStore';

const INFERENCE_API = import.meta.env.VITE_INFERENCE_SERVICE_URL || 'http://localhost:8003';

interface Props {
  objectTypeId: string;
}

type SortKey = 'resource' | 'case_count' | 'event_count' | 'total_cost';

// Widget types the AI can generate
type WidgetType = 'kpi' | 'bar' | 'donut' | 'table';

interface CustomWidget {
  id: string;
  type: WidgetType;
  title: string;
  data: Record<string, unknown>[];
  config: {
    labelField?: string;
    valueField?: string;
    kpiValue?: string;
    kpiLabel?: string;
    kpiColor?: string;
    columns?: string[];
  };
}

interface ChatMsg {
  role: 'user' | 'assistant';
  text: string;
  widgets?: CustomWidget[]; // Extracted widget proposals from AI response
}

// ── Markdown styles for chat messages ─────────────────────────────────────
const mdComponents: Record<string, React.FC<Record<string, unknown>>> = {
  p: ({ children, ...props }: any) => <p style={{ margin: '4px 0', lineHeight: 1.55 }} {...props}>{children}</p>,
  strong: ({ children, ...props }: any) => <strong style={{ fontWeight: 700, color: '#0D1117' }} {...props}>{children}</strong>,
  em: ({ children, ...props }: any) => <em style={{ fontStyle: 'italic' }} {...props}>{children}</em>,
  h1: ({ children, ...props }: any) => <div style={{ fontSize: 14, fontWeight: 700, color: '#0D1117', margin: '8px 0 4px' }} {...props}>{children}</div>,
  h2: ({ children, ...props }: any) => <div style={{ fontSize: 13, fontWeight: 700, color: '#0D1117', margin: '8px 0 4px' }} {...props}>{children}</div>,
  h3: ({ children, ...props }: any) => <div style={{ fontSize: 12, fontWeight: 700, color: '#0D1117', margin: '6px 0 3px' }} {...props}>{children}</div>,
  ul: ({ children, ...props }: any) => <ul style={{ margin: '4px 0', paddingLeft: 16 }} {...props}>{children}</ul>,
  ol: ({ children, ...props }: any) => <ol style={{ margin: '4px 0', paddingLeft: 16 }} {...props}>{children}</ol>,
  li: ({ children, ...props }: any) => <li style={{ margin: '2px 0', lineHeight: 1.5 }} {...props}>{children}</li>,
  hr: () => <div style={{ height: 1, backgroundColor: '#E2E8F0', margin: '8px 0' }} />,
  code: ({ children, className, ...props }: any) => {
    const isBlock = className?.includes('language-');
    if (isBlock) {
      return (
        <pre style={{ backgroundColor: '#F1F5F9', borderRadius: 4, padding: '8px 10px', margin: '4px 0', overflow: 'auto', fontSize: 10, fontFamily: 'var(--font-mono)', lineHeight: 1.5 }}>
          <code>{children}</code>
        </pre>
      );
    }
    return <code style={{ backgroundColor: '#F1F5F9', borderRadius: 3, padding: '1px 4px', fontSize: 11, fontFamily: 'var(--font-mono)' }} {...props}>{children}</code>;
  },
  table: ({ children, ...props }: any) => (
    <div style={{ overflow: 'auto', margin: '6px 0' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }} {...props}>{children}</table>
    </div>
  ),
  thead: ({ children, ...props }: any) => <thead {...props}>{children}</thead>,
  tbody: ({ children, ...props }: any) => <tbody {...props}>{children}</tbody>,
  tr: ({ children, ...props }: any) => <tr style={{ borderBottom: '1px solid #E2E8F0' }} {...props}>{children}</tr>,
  th: ({ children, ...props }: any) => <th style={{ padding: '4px 8px', fontSize: 10, fontWeight: 600, color: '#64748B', textAlign: 'left', textTransform: 'uppercase', letterSpacing: '0.03em' }} {...props}>{children}</th>,
  td: ({ children, ...props }: any) => <td style={{ padding: '4px 8px', color: '#0D1117' }} {...props}>{children}</td>,
};

// ── Extract JSON widget blocks from AI text ──────────────────────────────
function extractWidgetsAndClean(text: string): { cleanText: string; widgets: CustomWidget[] } {
  const widgets: CustomWidget[] = [];
  // Match ```json ... ``` blocks or bare JSON objects with "type" field
  const jsonBlockRe = /```(?:json)?\s*(\{[\s\S]*?\})\s*```/g;
  let cleanText = text;
  let match: RegExpExecArray | null;

  while ((match = jsonBlockRe.exec(text)) !== null) {
    try {
      const parsed = JSON.parse(match[1]);
      if (parsed.type && parsed.title) {
        const w: CustomWidget = {
          id: `w_${Date.now()}_${widgets.length}`,
          type: (['kpi', 'bar', 'donut', 'table'].includes(parsed.type) ? parsed.type : 'kpi') as WidgetType,
          title: parsed.title,
          data: Array.isArray(parsed.data) ? parsed.data : [],
          config: parsed.config || {},
        };
        // Normalize: if type is metric-card, treat as kpi
        if (parsed.type === 'metric-card' || parsed.type === 'metric') {
          w.type = 'kpi';
          if (parsed.field && !w.config.kpiValue) {
            w.config.kpiValue = parsed.field;
            w.config.kpiLabel = parsed.title;
          }
        }
        if (parsed.type === 'data-table') w.type = 'table';
        if (parsed.type === 'pie') w.type = 'donut';
        widgets.push(w);
        // Remove this block from the clean text
        cleanText = cleanText.replace(match[0], '');
      }
    } catch { /* not valid JSON, leave it */ }
  }

  // Also try bare JSON objects (not in code fences)
  const bareJsonRe = /(?:^|\n)\s*(\{"type"\s*:\s*"[^"]+?"[\s\S]*?\})\s*(?:\n|$)/g;
  while ((match = bareJsonRe.exec(cleanText)) !== null) {
    try {
      const parsed = JSON.parse(match[1]);
      if (parsed.type && parsed.title && !widgets.some(w => w.title === parsed.title)) {
        const w: CustomWidget = {
          id: `w_${Date.now()}_${widgets.length}`,
          type: (['kpi', 'bar', 'donut', 'table'].includes(parsed.type) ? parsed.type : 'kpi') as WidgetType,
          title: parsed.title,
          data: Array.isArray(parsed.data) ? parsed.data : [],
          config: parsed.config || {},
        };
        if (parsed.type === 'metric-card' || parsed.type === 'metric') w.type = 'kpi';
        if (parsed.type === 'data-table') w.type = 'table';
        if (parsed.type === 'pie') w.type = 'donut';
        widgets.push(w);
        cleanText = cleanText.replace(match[0], '\n');
      }
    } catch { /* ignore */ }
  }

  // Strip emojis
  cleanText = cleanText.replace(/[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}]/gu, '').trim();

  return { cleanText, widgets };
}

// ── Widget proposal card (clickable to add to dashboard) ─────────────────
const WidgetProposalCard: React.FC<{ widget: CustomWidget; onAdd: (w: CustomWidget) => void; added: boolean }> = ({ widget, onAdd, added }) => (
  <button
    onClick={() => !added && onAdd(widget)}
    disabled={added}
    style={{
      display: 'flex', alignItems: 'center', gap: 8,
      padding: '8px 12px', borderRadius: 6, border: '1px solid #E2E8F0',
      backgroundColor: added ? '#F0FDF4' : '#FFFFFF', cursor: added ? 'default' : 'pointer',
      width: '100%', textAlign: 'left', marginTop: 6,
      transition: 'all 80ms',
    }}
  >
    <div style={{
      width: 28, height: 28, borderRadius: 6, flexShrink: 0,
      backgroundColor: added ? '#DCFCE7' : '#EFF6FF',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: 12, color: added ? '#16A34A' : '#2563EB',
    }}>
      {added ? '✓' : widget.type === 'bar' ? '▊' : widget.type === 'donut' ? '◕' : widget.type === 'table' ? '▤' : '#'}
    </div>
    <div style={{ flex: 1, minWidth: 0 }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: '#0D1117', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {widget.title}
      </div>
      <div style={{ fontSize: 9, color: '#94A3B8', textTransform: 'uppercase' }}>
        {added ? 'Added to dashboard' : `Click to add ${widget.type} widget`}
      </div>
    </div>
  </button>
);

// ── Render a custom AI-generated widget on the dashboard ─────────────────
const CustomWidgetCard: React.FC<{ widget: CustomWidget; onRemove: () => void }> = ({ widget, onRemove }) => {
  const { type, title, data, config } = widget;

  return (
    <div style={{
      backgroundColor: '#F8FAFC', borderRadius: 8, border: '1px solid #E2E8F0',
      overflow: 'hidden',
    }}>
      <div style={{
        padding: '10px 16px', borderBottom: '1px solid #E2E8F0',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: '#0D1117' }}>{title}</span>
        <button onClick={onRemove} style={{
          width: 20, height: 20, border: 'none', background: 'none', cursor: 'pointer',
          fontSize: 14, color: '#94A3B8', display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>x</button>
      </div>

      {type === 'kpi' && (
        <div style={{ padding: '16px', textAlign: 'center' }}>
          <div style={{ fontSize: 32, fontWeight: 700, fontFamily: 'var(--font-mono)', color: config.kpiColor || '#0D1117' }}>
            {config.kpiValue}
          </div>
          {config.kpiLabel && (
            <div style={{ fontSize: 11, color: '#64748B', marginTop: 4 }}>{config.kpiLabel}</div>
          )}
        </div>
      )}

      {type === 'bar' && data.length > 0 && (
        <div style={{ padding: '12px', height: 200 }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ left: 10, right: 10, top: 5, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
              <XAxis dataKey={config.labelField || 'name'} tick={{ fontSize: 9, fill: '#94A3B8' }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 9, fill: '#94A3B8' }} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={{ fontSize: 11, borderRadius: 4, border: '1px solid #E2E8F0' }} />
              <Bar dataKey={config.valueField || 'value'} fill="#6366F1" radius={[4, 4, 0, 0]} barSize={24} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {type === 'donut' && data.length > 0 && (
        <div style={{ padding: '12px', display: 'flex', justifyContent: 'center' }}>
          <DonutChart
            data={data.map(d => ({
              label: String(d[config.labelField || 'name'] || ''),
              value: Number(d[config.valueField || 'value'] || 0),
            }))}
            size={160}
          />
        </div>
      )}

      {type === 'table' && data.length > 0 && (
        <div style={{ overflow: 'auto', maxHeight: 240 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
            <thead>
              <tr style={{ borderBottom: '2px solid #E2E8F0' }}>
                {(config.columns || Object.keys(data[0])).map(col => (
                  <th key={col} style={{
                    padding: '6px 10px', fontSize: 9, fontWeight: 600, color: '#94A3B8',
                    textTransform: 'uppercase', letterSpacing: '0.05em', textAlign: 'left',
                  }}>{col}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.slice(0, 20).map((row, i) => (
                <tr key={i} style={{ borderBottom: '1px solid #F1F5F9' }}>
                  {(config.columns || Object.keys(row)).map(col => (
                    <td key={col} style={{ padding: '6px 10px', color: '#0D1117' }}>
                      {String(row[col] ?? '')}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {data.length === 0 && type !== 'kpi' && (
        <div style={{ padding: 20, textAlign: 'center', color: '#94A3B8', fontSize: 11 }}>No data</div>
      )}
    </div>
  );
};

// ═════════════════════════════════════════════════════════════════════════
export const OverviewTab: React.FC<Props> = ({ objectTypeId }) => {
  const { stats, overviewData, fetchOverview, eventConfig, dateRange, attributeFilters, variants } = useProcessStore();
  const [groupBy, setGroupBy] = useState('resource');
  const [sortKey, setSortKey] = useState<SortKey>('case_count');
  const [sortAsc, setSortAsc] = useState(false);

  // Chat state
  const [chatOpen, setChatOpen] = useState(false);
  const [chatMsgs, setChatMsgs] = useState<ChatMsg[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [thinking, setThinking] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const [addedWidgetIds, setAddedWidgetIds] = useState<Set<string>>(new Set());

  // Custom widgets on the dashboard
  const [widgets, setWidgets] = useState<CustomWidget[]>([]);

  useEffect(() => {
    if (objectTypeId) fetchOverview(objectTypeId, groupBy);
  }, [objectTypeId, groupBy, eventConfig, dateRange, attributeFilters]);

  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [chatMsgs]);

  const buildContext = () => {
    const parts: string[] = [];
    if (stats) {
      parts.push(`Process Stats: ${stats.total_cases} total cases, ${stats.avg_duration_days}d avg duration, ${stats.variant_count} variants, ${stats.rework_rate}% rework rate, ${stats.stuck_cases} stuck cases.`);
    }
    if (overviewData) {
      parts.push(`Automation rate: ${overviewData.automation_rate}%. Total cost: $${overviewData.total_cost}.`);
      if (overviewData.monthly_series.length > 0) {
        const first = overviewData.monthly_series[0];
        const last = overviewData.monthly_series[overviewData.monthly_series.length - 1];
        parts.push(`Monthly data spans ${first.month.slice(0, 7)} to ${last.month.slice(0, 7)} (${overviewData.monthly_series.length} months).`);
        parts.push(`Monthly breakdown: ${overviewData.monthly_series.map(m => `${m.month.slice(0, 7)}: ${m.cases_completed} cases, ${m.avg_duration_days}d avg`).join('; ')}`);
      }
      if (overviewData.top_resources.length > 0) {
        parts.push(`Top resources: ${overviewData.top_resources.slice(0, 5).map(r => `${r.resource} (${r.case_count} cases, ${r.event_count} events)`).join(', ')}.`);
      }
    }
    if (variants.length > 0) {
      parts.push(`Top 3 variants: ${variants.slice(0, 3).map(v => `[${v.activities.join(' > ')}] (${v.case_count} cases, ${v.frequency_pct}%)`).join('; ')}.`);
    }
    return parts.join('\n');
  };

  const addWidgetToDashboard = useCallback((w: CustomWidget) => {
    setWidgets(prev => [...prev, { ...w, id: `w_${Date.now()}` }]);
    setAddedWidgetIds(prev => new Set(prev).add(w.id));
  }, []);

  const sendChat = async () => {
    const q = chatInput.trim();
    if (!q || thinking) return;
    setChatInput('');
    setChatMsgs(m => [...m, { role: 'user', text: q }]);
    setThinking(true);

    try {
      const context = buildContext();
      const systemPrompt = `You are a process mining analyst. Answer questions about process data concisely and precisely.

RULES:
- NEVER use emojis anywhere in your response.
- Use markdown for formatting: headers (##), bold (**text**), tables, lists.
- When the user asks to create a widget/chart/card, include a JSON block describing it. The user will click to add it.
- Widget JSON format (wrap in triple backtick json block):
  {"type":"bar"|"donut"|"kpi"|"table", "title":"...", "data":[{"name":"...","value":123}], "config":{"labelField":"name","valueField":"value","kpiValue":"...","kpiLabel":"...","kpiColor":"#hex","columns":["a","b"]}}
- For KPI widgets: set config.kpiValue to the metric value string, config.kpiLabel to the description.
- For bar/donut: populate the data array with actual data from the context.
- For tables: populate data array with row objects and config.columns with column names.
- You may include multiple widget JSON blocks in one response.
- Keep answers factual and data-driven.`;

      const res = await fetch(`${INFERENCE_API}/infer/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question: `${systemPrompt}\n\nProcess Data Context:\n${context}\n\nUser: ${q}`,
          object_type_name: 'Process Overview',
          fields: ['total_cases', 'avg_duration_days', 'variant_count', 'rework_rate', 'automation_rate'],
          records: stats ? [{ ...stats, automation_rate: overviewData?.automation_rate }] : [],
        }),
      });
      const data = await res.json();
      const rawAnswer = data.answer || data.detail || 'No response.';

      const { cleanText, widgets: extractedWidgets } = extractWidgetsAndClean(rawAnswer);

      setChatMsgs(m => [...m, {
        role: 'assistant',
        text: cleanText,
        widgets: extractedWidgets.length > 0 ? extractedWidgets : undefined,
      }]);
    } catch {
      setChatMsgs(m => [...m, { role: 'assistant', text: 'Could not reach AI service.' }]);
    } finally {
      setThinking(false);
    }
  };

  const removeWidget = (id: string) => setWidgets(prev => prev.filter(w => w.id !== id));

  const chartData = useMemo(() => {
    if (!overviewData?.monthly_series) return [];
    return overviewData.monthly_series.map(m => ({
      month: m.month.slice(0, 7),
      cases: m.cases_completed,
      avgDuration: parseFloat(m.avg_duration_days.toFixed(1)),
    }));
  }, [overviewData]);

  const donutData = useMemo(() => {
    if (!overviewData?.distribution) return [];
    return overviewData.distribution.map(d => ({ label: d.group_label || '(unknown)', value: d.case_count }));
  }, [overviewData]);

  const sortedResources = useMemo(() => {
    if (!overviewData?.top_resources) return [];
    const sorted = [...overviewData.top_resources].sort((a, b) => {
      const av = a[sortKey], bv = b[sortKey];
      if (typeof av === 'string') return sortAsc ? av.localeCompare(bv as string) : (bv as string).localeCompare(av);
      return sortAsc ? (av as number) - (bv as number) : (bv as number) - (av as number);
    });
    return sorted;
  }, [overviewData, sortKey, sortAsc]);

  const maxCases = Math.max(...(sortedResources.map(r => r.case_count) || [1]), 1);
  const maxCost = Math.max(...(sortedResources.map(r => r.total_cost) || [1]), 1);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) setSortAsc(!sortAsc);
    else { setSortKey(key); setSortAsc(false); }
  };

  const thStyle = (key: SortKey): React.CSSProperties => ({
    textAlign: key === 'resource' ? 'left' : 'right',
    padding: '8px 12px', cursor: 'pointer',
    fontSize: 10, fontWeight: 600, color: sortKey === key ? '#1E3A5F' : '#94A3B8',
    textTransform: 'uppercase', letterSpacing: '0.05em', whiteSpace: 'nowrap',
    userSelect: 'none',
  });

  if (!stats) {
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#94A3B8', fontSize: 13 }}>
        Loading overview...
      </div>
    );
  }

  return (
    <div style={{ flex: 1, display: 'flex', overflow: 'hidden', position: 'relative' }}>
      {/* Main content */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'auto' }}>
        <KpiBanner
          stats={stats}
          totalCost={overviewData?.total_cost}
          automationRate={overviewData?.automation_rate}
        />

        <div style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 20 }}>
          {/* Combo Chart */}
          <div style={{
            backgroundColor: '#F8FAFC', borderRadius: 8,
            border: '1px solid #E2E8F0', padding: '16px 12px 8px',
          }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: '#0D1117', marginBottom: 12, paddingLeft: 8 }}>
              Monthly Trend
            </div>
            {chartData.length > 0 ? (
              <div style={{ height: 260 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={chartData} margin={{ left: 10, right: 10, top: 5, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
                    <XAxis dataKey="month" tick={{ fontSize: 10, fill: '#94A3B8' }} axisLine={false} tickLine={false} />
                    <YAxis yAxisId="left" tick={{ fontSize: 10, fill: '#94A3B8' }} axisLine={false} tickLine={false} />
                    <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 10, fill: '#94A3B8' }} axisLine={false} tickLine={false} unit="d" />
                    <Tooltip
                      contentStyle={{ fontSize: 11, borderRadius: 4, border: '1px solid #E2E8F0' }}
                      formatter={(value, name) => [
                        name === 'cases' ? Number(value).toLocaleString() : `${value}d`,
                        name === 'cases' ? 'Cases Completed' : 'Avg Duration',
                      ]}
                    />
                    <Bar yAxisId="left" dataKey="cases" name="cases" fill="#2563EB" radius={[4, 4, 0, 0]} barSize={28} opacity={0.85} />
                    <Line yAxisId="right" dataKey="avgDuration" name="avgDuration" stroke="#7C3AED" strokeWidth={2} dot={{ r: 3, fill: '#7C3AED' }} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div style={{ height: 260, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#94A3B8', fontSize: 12 }}>
                No monthly data available
              </div>
            )}
          </div>

          {/* Donut + Resource Table */}
          <div style={{ display: 'grid', gridTemplateColumns: '380px 1fr', gap: 20 }}>
            <div style={{
              backgroundColor: '#F8FAFC', borderRadius: 8,
              border: '1px solid #E2E8F0', padding: 16,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: '#0D1117' }}>Distribution</span>
                <select
                  value={groupBy}
                  onChange={e => setGroupBy(e.target.value)}
                  style={{
                    height: 24, padding: '0 20px 0 8px', borderRadius: 4,
                    border: '1px solid #E2E8F0', backgroundColor: '#FFFFFF',
                    fontSize: 10, color: '#64748B', cursor: 'pointer', outline: 'none',
                    appearance: 'none',
                    backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='8' height='5' viewBox='0 0 8 5'%3E%3Cpath d='M1 1l3 3 3-3' stroke='%2394A3B8' stroke-width='1.2' fill='none'/%3E%3C/svg%3E")`,
                    backgroundRepeat: 'no-repeat', backgroundPosition: 'right 6px center',
                  }}
                >
                  <option value="resource">By Resource</option>
                  <option value="pipeline">By Pipeline</option>
                </select>
              </div>
              <DonutChart data={donutData} size={180} />
            </div>

            <div style={{
              backgroundColor: '#F8FAFC', borderRadius: 8,
              border: '1px solid #E2E8F0', overflow: 'hidden',
            }}>
              <div style={{ padding: '12px 16px', borderBottom: '1px solid #E2E8F0' }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: '#0D1117' }}>Top Resources</span>
              </div>
              <div style={{ overflow: 'auto', maxHeight: 340 }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                  <thead>
                    <tr style={{ borderBottom: '2px solid #E2E8F0' }}>
                      <th style={thStyle('resource')} onClick={() => handleSort('resource')}>Resource {sortKey === 'resource' && (sortAsc ? '↑' : '↓')}</th>
                      <th style={thStyle('case_count')} onClick={() => handleSort('case_count')}>Cases {sortKey === 'case_count' && (sortAsc ? '↑' : '↓')}</th>
                      <th style={thStyle('event_count')} onClick={() => handleSort('event_count')}>Events {sortKey === 'event_count' && (sortAsc ? '↑' : '↓')}</th>
                      <th style={thStyle('total_cost')} onClick={() => handleSort('total_cost')}>Cost {sortKey === 'total_cost' && (sortAsc ? '↑' : '↓')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedResources.map((r, i) => (
                      <tr key={i} style={{ borderBottom: '1px solid #F1F5F9' }}>
                        <td style={{ padding: '8px 12px', color: '#0D1117', fontWeight: 500 }}>{r.resource || '(system)'}</td>
                        <td style={{ padding: '8px 12px', textAlign: 'right' }}>
                          <InlineValueBar value={r.case_count} max={maxCases} color="#2563EB" width={80} />
                        </td>
                        <td style={{ padding: '8px 12px', textAlign: 'right', fontFamily: 'var(--font-mono)', color: '#64748B' }}>{r.event_count.toLocaleString()}</td>
                        <td style={{ padding: '8px 12px', textAlign: 'right' }}>
                          {r.total_cost > 0 ? (
                            <InlineValueBar value={r.total_cost} max={maxCost} color="#7C3AED" width={80} label={`$${r.total_cost.toLocaleString()}`} />
                          ) : (
                            <span style={{ fontFamily: 'var(--font-mono)', color: '#CBD5E1', fontSize: 11 }}>--</span>
                          )}
                        </td>
                      </tr>
                    ))}
                    {!sortedResources.length && (
                      <tr><td colSpan={4} style={{ padding: 20, textAlign: 'center', color: '#94A3B8', fontSize: 12 }}>No resource data available</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          {/* AI-generated widgets */}
          {widgets.length > 0 && (
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
              gap: 16,
            }}>
              {widgets.map(w => (
                <CustomWidgetCard key={w.id} widget={w} onRemove={() => removeWidget(w.id)} />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Chat toggle button */}
      {!chatOpen && (
        <button
          onClick={() => setChatOpen(true)}
          style={{
            position: 'absolute', bottom: 16, right: 20, width: 48, height: 48,
            borderRadius: '50%', border: 'none', backgroundColor: '#1E3A5F',
            color: '#FFFFFF', cursor: 'pointer', boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10,
          }}
          title="Ask AI about this data"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
        </button>
      )}

      {/* Chat panel */}
      {chatOpen && (
        <div style={{
          width: 380, borderLeft: '1px solid #E2E8F0', backgroundColor: '#FFFFFF',
          display: 'flex', flexDirection: 'column', flexShrink: 0, overflow: 'hidden',
        }}>
          {/* Header */}
          <div style={{
            padding: '12px 16px', borderBottom: '1px solid #E2E8F0',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0,
          }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#0D1117' }}>Process Assistant</div>
              <div style={{ fontSize: 10, color: '#94A3B8', marginTop: 1 }}>Ask questions or create widgets</div>
            </div>
            <button onClick={() => setChatOpen(false)} style={{
              width: 24, height: 24, border: 'none', background: '#F1F5F9', borderRadius: 4,
              cursor: 'pointer', fontSize: 14, color: '#64748B',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>x</button>
          </div>

          {/* Quick actions */}
          <div style={{
            padding: '8px 16px', borderBottom: '1px solid #F1F5F9', flexShrink: 0,
            display: 'flex', gap: 6, flexWrap: 'wrap',
          }}>
            {[
              'What are the key insights?',
              'Create a bar chart of monthly cases',
              'Create a KPI for rework rate',
              'Which months had the most cases?',
            ].map(q => (
              <button
                key={q}
                onClick={() => setChatInput(q)}
                style={{
                  padding: '4px 8px', borderRadius: 12, border: '1px solid #E2E8F0',
                  backgroundColor: '#F8FAFC', color: '#64748B', fontSize: 9,
                  cursor: 'pointer', whiteSpace: 'nowrap',
                }}
              >{q}</button>
            ))}
          </div>

          {/* Messages */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
            {chatMsgs.length === 0 && (
              <div style={{ color: '#94A3B8', fontSize: 11, textAlign: 'center', marginTop: 20, lineHeight: 1.6 }}>
                Ask questions about your process data or request dashboard widgets.
                <br /><br />
                Try: "Create a bar chart of cases by month" or "What's the trend?"
              </div>
            )}
            {chatMsgs.map((m, i) => (
              <div key={i} style={{
                alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start',
                maxWidth: '95%',
              }}>
                {m.role === 'user' ? (
                  <div style={{
                    padding: '8px 12px',
                    borderRadius: '12px 12px 2px 12px',
                    backgroundColor: '#1E3A5F',
                    color: '#FFFFFF',
                    fontSize: 12, lineHeight: 1.5,
                  }}>
                    {m.text}
                  </div>
                ) : (
                  <div style={{
                    padding: '10px 14px',
                    borderRadius: '12px 12px 12px 2px',
                    backgroundColor: '#F8FAFC',
                    border: '1px solid #E2E8F0',
                    color: '#0D1117',
                    fontSize: 12, lineHeight: 1.5,
                  }}>
                    <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents as any}>
                      {m.text}
                    </ReactMarkdown>
                    {/* Widget proposals */}
                    {m.widgets && m.widgets.length > 0 && (
                      <div style={{ marginTop: 8 }}>
                        {m.widgets.map(w => (
                          <WidgetProposalCard
                            key={w.id}
                            widget={w}
                            onAdd={addWidgetToDashboard}
                            added={addedWidgetIds.has(w.id)}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
            {thinking && (
              <div style={{
                padding: '10px 14px', borderRadius: '12px 12px 12px 2px',
                backgroundColor: '#F8FAFC', border: '1px solid #E2E8F0',
                color: '#94A3B8', fontSize: 12, alignSelf: 'flex-start',
              }}>
                Analyzing...
              </div>
            )}
            <div ref={chatEndRef} />
          </div>

          {/* Input */}
          <div style={{
            padding: '10px 16px', borderTop: '1px solid #E2E8F0',
            display: 'flex', gap: 6, flexShrink: 0,
          }}>
            <input
              value={chatInput}
              onChange={e => setChatInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') sendChat(); }}
              placeholder="Ask a question or create a widget..."
              style={{
                flex: 1, height: 34, padding: '0 12px', borderRadius: 8,
                border: '1px solid #E2E8F0', fontSize: 12, outline: 'none',
                backgroundColor: '#F8FAFC',
              }}
            />
            <button
              onClick={sendChat}
              disabled={!chatInput.trim() || thinking}
              style={{
                height: 34, padding: '0 14px', borderRadius: 8, border: 'none',
                backgroundColor: chatInput.trim() ? '#1E3A5F' : '#F1F5F9',
                color: chatInput.trim() ? '#FFFFFF' : '#94A3B8',
                fontSize: 12, fontWeight: 600, cursor: 'pointer',
              }}
            >Send</button>
          </div>
        </div>
      )}
    </div>
  );
};
