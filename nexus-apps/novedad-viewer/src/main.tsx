/**
 * Novedad Operations Dashboard.
 *
 * KPI tiles, priority + category donuts, 24h timeline, geographic
 * breakdown by departamento / municipio, top reporters, incident-type
 * distribution, police-action distribution, plus a searchable + filterable
 * incident table with click-through to a detail panel.
 *
 * Charts are hand-rolled SVG (donut, horizontal bar, vertical bar) so the
 * bundle stays small. No third-party chart library.
 *
 * Two data sources, toggled by per-install config:
 *   - External Nexus gateway (when config.api_base_url is set)
 *   - Host SDK (nexus.ontology.query) otherwise
 */
import React from "react";
import ReactDOM from "react-dom/client";
import {
  NexusProvider, useNexus, useNexusReady, useNexusContext,
  useAutoResize,
} from "@nexus/app-sdk/react";

interface AppConfig {
  api_base_url?: string;
  api_key?: string;
  object_slug?: string;
  page_size?: number;
  sample_size?: number;  // how many rows to pull for the dashboard charts
}

interface Novedad {
  id?: string;
  text?: string;
  message_text?: string;
  sent_at?: string;
  timestamp?: string;
  sender_name?: string;
  chat_name?: string;
  message_type?: string;
  media_url?: string | null;
  media_mime?: string | null;
  llm_hecho?: string;
  llm_lugar?: string | null;
  llm_categoria?: string;
  llm_prioridad?: string;
  llm_municipio?: string | null;
  llm_departamento?: string | null;
  llm_tipo_incidente?: string | null;
  llm_accion_policial?: string | null;
  llm_fecha_hora?: string | null;
  llm_responsables?: string | null;
  llm_victimas?: string | null;
  [k: string]: unknown;
}

// ── Theme tokens (Palantir-style) ───────────────────────────────────────────
function colorsFor(isDark: boolean) {
  return isDark
    ? { bg: "#0D1117", surface: "#0F172A", panel: "#111827", border: "#1F2937", fg: "#E2E8F0", sub: "#94A3B8", brand: "#7C3AED", brandSoft: "#312E81", muted: "#1E293B", track: "#1F2937", critical: "#F87171", warn: "#FBBF24", ok: "#34D399", info: "#60A5FA" }
    : { bg: "#F8FAFC", surface: "#FFFFFF", panel: "#FFFFFF", border: "#E2E8F0", fg: "#0D1117", sub: "#64748B", brand: "#7C3AED", brandSoft: "#EDE9FE", muted: "#F1F5F9", track: "#F1F5F9", critical: "#DC2626", warn: "#D97706", ok: "#15803D", info: "#2563EB" };
}
type Theme = ReturnType<typeof colorsFor>;

// Priority palette — semantic
const PRIORITY_COLOR = (p?: string, C?: Theme): string => {
  if (!C) return "#888";
  switch ((p || "").toUpperCase()) {
    case "CRITICO":
    case "CRÍTICO":
    case "ALTO":      return C.critical;
    case "MEDIO":
    case "USR":       return C.warn;
    case "INFORMATIVA":
    case "BAJO":      return C.info;
    case "OK":        return C.ok;
    default:          return C.sub;
  }
};

// Category palette — distinct categorical hues that work in both modes
const CAT_PALETTE = ["#7C3AED", "#2563EB", "#0891B2", "#059669", "#CA8A04", "#DC2626", "#9333EA", "#DB2777", "#475569"];
const colorForIndex = (i: number) => CAT_PALETTE[i % CAT_PALETTE.length];

// ── External fetch ──────────────────────────────────────────────────────────
async function fetchExternalPage(cfg: AppConfig, cursor?: string, limit?: number): Promise<{ records: Novedad[]; next_cursor?: string; total?: number }> {
  const base = (cfg.api_base_url || "").replace(/\/+$/, "");
  const slug = cfg.object_slug || "novedad";
  const params = new URLSearchParams({ limit: String(limit ?? 100) });
  if (cursor) params.set("cursor", cursor);
  const r = await fetch(`${base}/v1/${slug}?${params.toString()}`, {
    headers: { Authorization: `Bearer ${cfg.api_key || ""}` },
  });
  if (!r.ok) {
    let body = "";
    try { body = await r.text(); } catch { /* */ }
    throw new Error(`${r.status} ${r.statusText}${body ? ` — ${body.slice(0, 200)}` : ""}`);
  }
  const data = await r.json();
  if (Array.isArray(data)) return { records: data };
  return { records: data.data || data.records || data.items || [], next_cursor: data.next_cursor, total: data.total };
}

async function fetchExternalSample(cfg: AppConfig, target: number, onProgress: (loaded: number, total?: number) => void): Promise<{ records: Novedad[]; total?: number }> {
  const out: Novedad[] = [];
  let cursor: string | undefined = undefined;
  let total: number | undefined = undefined;
  const pageSize = Math.min(target, 1000); // gateway max
  while (out.length < target) {
    const need = Math.min(target - out.length, pageSize);
    const page = await fetchExternalPage(cfg, cursor, need);
    if (page.total != null) total = page.total;
    out.push(...page.records);
    onProgress(out.length, total);
    if (!page.next_cursor || page.records.length === 0) break;
    cursor = page.next_cursor;
  }
  return { records: out, total };
}

async function fetchLocalSample(nexus: ReturnType<typeof useNexus>, cfg: AppConfig, target: number): Promise<{ records: Novedad[]; total?: number }> {
  const slug = cfg.object_slug || "novedad";
  const r = await nexus.ontology.query<Novedad>({ object_type: slug, limit: target });
  return { records: (r.records || []) as Novedad[], total: r.total };
}

// ── Aggregations ────────────────────────────────────────────────────────────
function tally<T>(items: T[], key: (t: T) => string | undefined | null): { label: string; count: number }[] {
  const m = new Map<string, number>();
  for (const it of items) {
    const k = key(it);
    if (!k) continue;
    m.set(k, (m.get(k) || 0) + 1);
  }
  return Array.from(m, ([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count);
}

function parseDate(s?: string): Date | null {
  if (!s) return null;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

function hourBucket(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:00Z`;
}

// ── Charts ──────────────────────────────────────────────────────────────────

const Donut: React.FC<{ slices: { label: string; count: number; color: string }[]; size?: number; C: Theme }> = ({ slices, size = 180, C }) => {
  const total = slices.reduce((s, x) => s + x.count, 0);
  if (total === 0) return <div style={{ height: size, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, color: C.sub }}>sin datos</div>;
  const r = size / 2;
  const inner = r * 0.62;
  let a = -Math.PI / 2;
  const arcs = slices.map((s, i) => {
    const frac = s.count / total;
    const a0 = a;
    const a1 = a + frac * Math.PI * 2;
    a = a1;
    const large = a1 - a0 > Math.PI ? 1 : 0;
    const x0 = r + r * Math.cos(a0), y0 = r + r * Math.sin(a0);
    const x1 = r + r * Math.cos(a1), y1 = r + r * Math.sin(a1);
    const xi0 = r + inner * Math.cos(a0), yi0 = r + inner * Math.sin(a0);
    const xi1 = r + inner * Math.cos(a1), yi1 = r + inner * Math.sin(a1);
    return (
      <path key={i}
        d={`M ${x0} ${y0} A ${r} ${r} 0 ${large} 1 ${x1} ${y1} L ${xi1} ${yi1} A ${inner} ${inner} 0 ${large} 0 ${xi0} ${yi0} Z`}
        fill={s.color}
      >
        <title>{`${s.label}: ${s.count} (${((s.count / total) * 100).toFixed(1)}%)`}</title>
      </path>
    );
  });

  return (
    <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        {arcs}
        <text x={r} y={r - 4} textAnchor="middle" style={{ fontSize: 18, fontWeight: 700, fill: C.fg }}>{total}</text>
        <text x={r} y={r + 14} textAnchor="middle" style={{ fontSize: 9, fill: C.sub, letterSpacing: "0.08em", textTransform: "uppercase" as const }}>total</text>
      </svg>
      <ul style={{ listStyle: "none", margin: 0, padding: 0, fontSize: 11, flex: 1 }}>
        {slices.map((s, i) => (
          <li key={i} style={{ display: "flex", alignItems: "center", gap: 8, padding: "3px 0" }}>
            <span style={{ width: 10, height: 10, borderRadius: 2, background: s.color, flexShrink: 0 }} />
            <span style={{ flex: 1, color: C.fg }}>{s.label}</span>
            <span style={{ color: C.sub, fontFamily: "ui-monospace,monospace" }}>{s.count}</span>
            <span style={{ color: C.sub, fontFamily: "ui-monospace,monospace", width: 42, textAlign: "right" }}>{((s.count / total) * 100).toFixed(0)}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
};

const HBar: React.FC<{ data: { label: string; count: number }[]; max?: number; barColor?: (i: number) => string; C: Theme }> = ({ data, max, barColor, C }) => {
  const m = max ?? Math.max(1, ...data.map((d) => d.count));
  if (data.length === 0) return <div style={{ padding: 12, fontSize: 11, color: C.sub }}>sin datos</div>;
  return (
    <ul style={{ listStyle: "none", margin: 0, padding: 0, fontSize: 11 }}>
      {data.map((d, i) => (
        <li key={i} style={{ display: "grid", gridTemplateColumns: "140px 1fr 48px", gap: 8, alignItems: "center", padding: "4px 0" }}>
          <span title={d.label} style={{ color: C.fg, overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>{d.label}</span>
          <div style={{ height: 14, background: C.track, borderRadius: 2, overflow: "hidden" }}>
            <div style={{
              width: `${(d.count / m) * 100}%`, height: "100%",
              background: barColor ? barColor(i) : C.brand,
            }} title={`${d.count}`} />
          </div>
          <span style={{ color: C.sub, fontFamily: "ui-monospace,monospace", textAlign: "right" }}>{d.count}</span>
        </li>
      ))}
    </ul>
  );
};

const VBars: React.FC<{ buckets: { label: string; count: number; tooltip?: string }[]; height?: number; C: Theme }> = ({ buckets, height = 120, C }) => {
  if (buckets.length === 0) return <div style={{ height, display: "flex", alignItems: "center", justifyContent: "center", color: C.sub, fontSize: 11 }}>sin datos</div>;
  const max = Math.max(1, ...buckets.map((b) => b.count));
  const barW = 100 / buckets.length;
  return (
    <svg viewBox={`0 0 100 ${height}`} preserveAspectRatio="none" style={{ width: "100%", height }}>
      {buckets.map((b, i) => {
        const h = (b.count / max) * (height - 22);
        return (
          <g key={i} transform={`translate(${i * barW},0)`}>
            <rect x={0.15} y={height - 18 - h} width={barW - 0.3} height={h} fill={C.brand} opacity={b.count === 0 ? 0.15 : 0.85}>
              <title>{b.tooltip || `${b.label}: ${b.count}`}</title>
            </rect>
          </g>
        );
      })}
      {/* X-axis tick labels — every Nth */}
      {buckets.map((b, i) => (i % Math.max(1, Math.floor(buckets.length / 6)) === 0
        ? <text key={`t${i}`} x={i * barW + barW / 2} y={height - 4} textAnchor="middle" style={{ fontSize: 5, fill: C.sub }}>{b.label}</text>
        : null
      ))}
    </svg>
  );
};

// ── Layout primitives ────────────────────────────────────────────────────────
const Panel: React.FC<{ title?: string; subtitle?: string; right?: React.ReactNode; C: Theme; children: React.ReactNode; style?: React.CSSProperties }> = ({ title, subtitle, right, C, children, style }) => (
  <section style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: 6, ...style }}>
    {(title || right) && (
      <header style={{ padding: "10px 14px", borderBottom: `1px solid ${C.border}`, display: "flex", alignItems: "center", gap: 8 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          {title && <div style={{ fontSize: 10, color: C.sub, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase" }}>{title}</div>}
          {subtitle && <div style={{ fontSize: 12, color: C.fg, marginTop: 2 }}>{subtitle}</div>}
        </div>
        {right}
      </header>
    )}
    <div style={{ padding: 14 }}>{children}</div>
  </section>
);

const Kpi: React.FC<{ label: string; value: React.ReactNode; sub?: string; tone?: string; C: Theme }> = ({ label, value, sub, tone, C }) => (
  <div style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: 6, padding: 14, minWidth: 0 }}>
    <div style={{ fontSize: 10, color: C.sub, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase" }}>{label}</div>
    <div style={{ fontSize: 24, fontWeight: 700, color: tone || C.fg, marginTop: 4, lineHeight: 1.1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{value}</div>
    {sub && <div style={{ fontSize: 11, color: C.sub, marginTop: 4 }}>{sub}</div>}
  </div>
);

const Badge: React.FC<{ children: React.ReactNode; color: string; bg: string; size?: "sm" | "md" }> = ({ children, color, bg, size = "sm" }) => (
  <span style={{ fontSize: size === "sm" ? 10 : 11, padding: size === "sm" ? "2px 6px" : "3px 8px", borderRadius: 3, fontWeight: 600, color, background: bg, letterSpacing: "0.02em", display: "inline-block", whiteSpace: "nowrap" }}>{children}</span>
);

// ── Detail panel ────────────────────────────────────────────────────────────
const DetailPanel: React.FC<{ record: Novedad | null; C: Theme; onClose: () => void }> = ({ record, C, onClose }) => {
  if (!record) return null;
  let responsables: { nombre?: string; rol?: string }[] = [];
  let victimas: { nombre?: string; sexo?: string; edad?: number | null }[] = [];
  try { if (record.llm_responsables) responsables = JSON.parse(record.llm_responsables); } catch { /* */ }
  try { if (record.llm_victimas) victimas = JSON.parse(record.llm_victimas); } catch { /* */ }
  const when = parseDate(record.sent_at) || parseDate(record.timestamp);

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 100, display: "flex", justifyContent: "flex-end" }}>
      <div style={{ width: "min(640px, 92vw)", background: C.surface, color: C.fg, height: "100%", overflowY: "auto", boxShadow: "-12px 0 32px rgba(0,0,0,0.18)" }}>
        <div style={{ position: "sticky", top: 0, background: C.surface, borderBottom: `1px solid ${C.border}`, padding: "12px 16px", display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 12, fontWeight: 600 }}>{record.llm_tipo_incidente || record.llm_categoria || "Incidente"}</div>
            <div style={{ fontSize: 11, color: C.sub }}>{when ? when.toLocaleString() : ""}{record.id ? `  ·  ${record.id.slice(0, 12)}…` : ""}</div>
          </div>
          {record.llm_prioridad && (
            <Badge color="#fff" bg={PRIORITY_COLOR(record.llm_prioridad, C)} size="md">{record.llm_prioridad}</Badge>
          )}
          <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 20, color: C.sub, cursor: "pointer", lineHeight: 1 }}>×</button>
        </div>

        <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 14, fontSize: 12 }}>
          {record.llm_hecho && <Section C={C} label="Hecho"><div>{record.llm_hecho}</div></Section>}

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <Section C={C} label="Categoría">{record.llm_categoria || "—"}</Section>
            <Section C={C} label="Acción policial">{record.llm_accion_policial || "—"}</Section>
            <Section C={C} label="Departamento">{record.llm_departamento || "—"}</Section>
            <Section C={C} label="Municipio">{record.llm_municipio || "—"}</Section>
            <Section C={C} label="Lugar"><div style={{ wordBreak: "break-word" }}>{record.llm_lugar || "—"}</div></Section>
            <Section C={C} label="Fecha del hecho">{record.llm_fecha_hora ? new Date(record.llm_fecha_hora).toLocaleString() : "—"}</Section>
          </div>

          {responsables.length > 0 && (
            <Section C={C} label="Responsables">
              <ul style={{ margin: 0, padding: 0, listStyle: "none" }}>{responsables.map((r, i) => (
                <li key={i} style={{ padding: "3px 0" }}>{r.nombre} {r.rol && <span style={{ color: C.sub }}>· {r.rol}</span>}</li>
              ))}</ul>
            </Section>
          )}

          {victimas.length > 0 && (
            <Section C={C} label="Víctimas">
              <ul style={{ margin: 0, padding: 0, listStyle: "none" }}>{victimas.map((v, i) => (
                <li key={i} style={{ padding: "3px 0" }}>
                  {v.nombre} {v.edad != null && <span style={{ color: C.sub }}>· {v.edad}</span>} {v.sexo && <span style={{ color: C.sub }}>· {v.sexo}</span>}
                </li>
              ))}</ul>
            </Section>
          )}

          {(record.sender_name || record.chat_name) && (
            <Section C={C} label="Origen">
              <div>{record.sender_name}</div>
              {record.chat_name && <div style={{ color: C.sub }}>{record.chat_name}</div>}
            </Section>
          )}

          {(record.text || record.message_text) && (
            <Section C={C} label="Mensaje original">
              <pre style={{ background: C.muted, padding: 12, borderRadius: 4, whiteSpace: "pre-wrap", margin: 0, fontFamily: "inherit", fontSize: 11.5, lineHeight: 1.55, maxHeight: 300, overflow: "auto" }}>{record.text || record.message_text}</pre>
            </Section>
          )}
        </div>
      </div>
    </div>
  );
};

const Section: React.FC<{ label: string; children: React.ReactNode; C: Theme }> = ({ label, children, C }) => (
  <div>
    <div style={{ fontSize: 9, color: C.sub, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 4 }}>{label}</div>
    <div style={{ fontSize: 12 }}>{children}</div>
  </div>
);

// ── Root ────────────────────────────────────────────────────────────────────
const App: React.FC = () => {
  const { ready, error } = useNexusReady();
  if (error) return <pre style={{ padding: 16, color: "crimson" }}>{String(error)}</pre>;
  if (!ready) return <div style={{ padding: 16, fontSize: 13 }}>Cargando…</div>;
  return <Body />;
};

const Body: React.FC = () => {
  const nexus = useNexus();
  const ctx = useNexusContext();
  const ref = React.useRef<HTMLDivElement>(null);
  useAutoResize(ref);

  const C = colorsFor(ctx.theme === "dark");
  const config = (ctx.config || {}) as AppConfig;
  const isExternal = Boolean(config.api_base_url);
  const sample = config.sample_size ?? 500;

  const [records, setRecords] = React.useState<Novedad[]>([]);
  const [total, setTotal] = React.useState<number | undefined>(undefined);
  const [loaded, setLoaded] = React.useState(0);
  const [loading, setLoading] = React.useState(true);
  const [err, setErr] = React.useState<string | null>(null);
  const [selected, setSelected] = React.useState<Novedad | null>(null);
  const [search, setSearch] = React.useState("");
  const [priorityFilter, setPriorityFilter] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    setLoading(true); setErr(null); setLoaded(0);
    try {
      if (isExternal) {
        if (!config.api_key) throw new Error("api_key vacío — configúralo en este install desde Apps → Instaladas");
        const r = await fetchExternalSample(config, sample, (n, t) => { setLoaded(n); if (t != null) setTotal(t); });
        setRecords(r.records);
        if (r.total != null) setTotal(r.total);
      } else {
        const r = await fetchLocalSample(nexus, config, sample);
        setRecords(r.records);
        setTotal(r.total);
        setLoaded(r.records.length);
      }
    } catch (e) {
      setErr((e as Error).message || String(e));
    } finally {
      setLoading(false);
    }
  }, [isExternal, config.api_base_url, config.api_key, config.object_slug, sample, nexus]);

  React.useEffect(() => { load(); }, [load]);

  // ── Aggregations (memoised on records) ──
  const priorityCounts = React.useMemo(() => tally(records, (r) => (r.llm_prioridad || "—").toUpperCase()), [records]);
  const categoryCounts = React.useMemo(() => tally(records, (r) => r.llm_categoria || "—"), [records]);
  const deptCounts = React.useMemo(() => tally(records, (r) => r.llm_departamento || undefined).slice(0, 10), [records]);
  const muniCounts = React.useMemo(() => tally(records, (r) => r.llm_municipio || undefined).slice(0, 10), [records]);
  const incidentCounts = React.useMemo(() => tally(records, (r) => r.llm_tipo_incidente || undefined).slice(0, 8), [records]);
  const actionCounts = React.useMemo(() => tally(records, (r) => r.llm_accion_policial || undefined).slice(0, 8), [records]);
  const senderCounts = React.useMemo(() => tally(records, (r) => r.sender_name || undefined).slice(0, 8), [records]);
  const chatCounts = React.useMemo(() => tally(records, (r) => r.chat_name || undefined).slice(0, 6), [records]);

  const timeline = React.useMemo(() => {
    const buckets = new Map<string, number>();
    const now = Date.now();
    // Pre-fill the last 24 hourly buckets so even empty hours show on the chart
    const init: { bucket: string; t: number }[] = [];
    for (let i = 23; i >= 0; i--) {
      const t = now - i * 3600_000;
      const d = new Date(t);
      const b = hourBucket(d);
      buckets.set(b, 0);
      init.push({ bucket: b, t: d.getTime() });
    }
    for (const r of records) {
      const when = parseDate(r.sent_at) || parseDate(r.timestamp);
      if (!when) continue;
      const b = hourBucket(when);
      if (buckets.has(b)) buckets.set(b, (buckets.get(b) || 0) + 1);
    }
    return init.map((i) => ({
      label: new Date(i.t).getUTCHours().toString().padStart(2, "0"),
      count: buckets.get(i.bucket) || 0,
      tooltip: `${new Date(i.t).toLocaleString()}: ${buckets.get(i.bucket) || 0}`,
    }));
  }, [records]);

  const todayCount = React.useMemo(() => {
    const cutoff = Date.now() - 24 * 3600_000;
    return records.filter((r) => {
      const when = parseDate(r.sent_at) || parseDate(r.timestamp);
      return when && when.getTime() > cutoff;
    }).length;
  }, [records]);

  const criticalCount = React.useMemo(() => records.filter((r) => /CRIT|ALTO/i.test(r.llm_prioridad || "")).length, [records]);

  const topDept = deptCounts[0]?.label || "—";

  // ── Filtered table data ──
  const filtered = React.useMemo(() => {
    let out = records;
    if (priorityFilter) {
      const f = priorityFilter.toUpperCase();
      out = out.filter((r) => (r.llm_prioridad || "").toUpperCase() === f);
    }
    if (search.trim()) {
      const s = search.trim().toLowerCase();
      out = out.filter((r) =>
        (r.llm_hecho || "").toLowerCase().includes(s) ||
        (r.text || r.message_text || "").toLowerCase().includes(s) ||
        (r.llm_departamento || "").toLowerCase().includes(s) ||
        (r.llm_municipio || "").toLowerCase().includes(s) ||
        (r.sender_name || "").toLowerCase().includes(s)
      );
    }
    return out;
  }, [records, priorityFilter, search]);

  const prioritySlices = priorityCounts.slice(0, 6).map((p) => ({
    label: p.label, count: p.count, color: PRIORITY_COLOR(p.label, C),
  }));
  const categorySlices = categoryCounts.slice(0, 6).map((p, i) => ({
    label: p.label, count: p.count, color: colorForIndex(i),
  }));

  // ── Render ──
  return (
    <div ref={ref} style={{ background: C.bg, color: C.fg, minHeight: 480, fontSize: 13 }}>
      {/* Encabezado */}
      <div style={{ padding: "16px 24px", borderBottom: `1px solid ${C.border}`, background: C.panel, display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 240 }}>
          <h1 style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>Tablero de novedades</h1>
          <div style={{ fontSize: 11, color: C.sub, marginTop: 2 }}>
            {isExternal
              ? <>Gateway externo · <code style={{ fontFamily: "ui-monospace,monospace" }}>{config.api_base_url}/v1/{config.object_slug || "novedad"}</code></>
              : <>SDK local · <code style={{ fontFamily: "ui-monospace,monospace" }}>{config.object_slug || "novedad"}</code></>}
          </div>
        </div>
        <div style={{ fontSize: 11, color: C.sub }}>
          {loading ? `cargando ${loaded}…` : `muestra ${records.length} de ${total ?? "?"}`}
        </div>
        <button onClick={load} disabled={loading}
          style={{ padding: "6px 12px", fontSize: 11, background: C.surface, color: C.fg, border: `1px solid ${C.border}`, borderRadius: 3, cursor: loading ? "wait" : "pointer" }}>
          {loading ? "Cargando" : "Actualizar"}
        </button>
      </div>

      {/* Error */}
      {err && (
        <div style={{ margin: 16, padding: 12, background: "#FECACA", color: "#B91C1C", borderRadius: 4, fontFamily: "ui-monospace,monospace", fontSize: 12, whiteSpace: "pre-wrap" }}>
          {err}
        </div>
      )}

      {/* Pista de carga cuando no hay registros aún */}
      {loading && records.length === 0 && !err && (
        <div style={{ padding: 32, textAlign: "center", color: C.sub, fontSize: 12 }}>
          Solicitando muestra al gateway… ({loaded}/{sample})
        </div>
      )}

      {/* Dashboard */}
      {records.length > 0 && (
        <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 14 }}>
          {/* KPIs */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12 }}>
            <Kpi C={C} label="Total en tenant" value={(total ?? records.length).toLocaleString()} sub={`muestra de ${records.length}`} />
            <Kpi C={C} label="Críticas (muestra)" value={criticalCount} tone={C.critical} sub={`${((criticalCount / Math.max(1, records.length)) * 100).toFixed(1)}%`} />
            <Kpi C={C} label="Últimas 24h" value={todayCount} tone={C.brand} />
            <Kpi C={C} label="Departamento principal" value={topDept} sub={`${deptCounts[0]?.count || 0} en muestra`} />
          </div>

          {/* Fila de donas */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 12 }}>
            <Panel C={C} title="Prioridad" subtitle={`${priorityCounts.length} niveles observados`}>
              <Donut slices={prioritySlices} C={C} />
            </Panel>
            <Panel C={C} title="Categoría" subtitle={`${categoryCounts.length} categorías observadas`}>
              <Donut slices={categorySlices} C={C} />
            </Panel>
          </div>

          {/* Línea de tiempo */}
          <Panel C={C} title="Actividad (últimas 24h, por hora, UTC)" subtitle={`${todayCount} incidentes en esta muestra, últimas 24h`}>
            <VBars buckets={timeline} C={C} />
          </Panel>

          {/* Geografía */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 12 }}>
            <Panel C={C} title="Principales departamentos">
              <HBar C={C} data={deptCounts} barColor={(i) => colorForIndex(i)} />
            </Panel>
            <Panel C={C} title="Principales municipios">
              <HBar C={C} data={muniCounts} barColor={(i) => colorForIndex(i)} />
            </Panel>
          </div>

          {/* Tipos e incidentes / acciones */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 12 }}>
            <Panel C={C} title="Tipos de incidente">
              <HBar C={C} data={incidentCounts} barColor={(i) => colorForIndex(i + 1)} />
            </Panel>
            <Panel C={C} title="Acciones policiales">
              <HBar C={C} data={actionCounts} barColor={(i) => colorForIndex(i + 2)} />
            </Panel>
          </div>

          {/* Reportes y canales */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 12 }}>
            <Panel C={C} title="Agentes con más reportes">
              <HBar C={C} data={senderCounts} barColor={(i) => colorForIndex(i + 3)} />
            </Panel>
            <Panel C={C} title="Canales más activos">
              <HBar C={C} data={chatCounts} barColor={(i) => colorForIndex(i + 4)} />
            </Panel>
          </div>

          {/* Tabla */}
          <Panel C={C} title="Registros" subtitle={`${filtered.length} mostrados · ${records.length} cargados`} right={
            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <select value={priorityFilter || ""} onChange={(e) => setPriorityFilter(e.target.value || null)}
                style={{ height: 28, padding: "0 8px", fontSize: 11, background: C.surface, color: C.fg, border: `1px solid ${C.border}`, borderRadius: 3 }}>
                <option value="">Todas las prioridades</option>
                {priorityCounts.map((p) => <option key={p.label} value={p.label}>{p.label}</option>)}
              </select>
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar hecho, texto, ubicación, agente…"
                style={{ height: 28, padding: "0 10px", fontSize: 11, background: C.surface, color: C.fg, border: `1px solid ${C.border}`, borderRadius: 3, width: 220 }} />
            </div>
          }>
            <div style={{ overflow: "auto", maxHeight: 560, border: `1px solid ${C.border}`, borderRadius: 4 }}>
              <table style={{ width: "100%", fontSize: 11.5, borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ background: C.muted }}>
                    {["fecha", "prio", "categoría", "depto", "municipio", "hecho", "agente"].map((h) => (
                      <th key={h} style={{ padding: "8px 10px", textAlign: "left", fontWeight: 600, color: C.sub, letterSpacing: "0.04em", textTransform: "uppercase", fontSize: 9, position: "sticky", top: 0, background: C.muted, borderBottom: `1px solid ${C.border}` }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filtered.slice(0, 200).map((r, i) => {
                    const when = parseDate(r.sent_at) || parseDate(r.timestamp);
                    return (
                      <tr key={r.id || i}
                        onClick={() => setSelected(r)}
                        style={{ borderBottom: `1px solid ${C.border}`, cursor: "pointer" }}
                        onMouseEnter={(e) => (e.currentTarget.style.background = C.muted)}
                        onMouseLeave={(e) => (e.currentTarget.style.background = "")}>
                        <td style={{ padding: "6px 10px", whiteSpace: "nowrap", color: C.sub, fontFamily: "ui-monospace,monospace" }}>{when ? when.toLocaleString() : "—"}</td>
                        <td style={{ padding: "6px 10px" }}>{r.llm_prioridad ? <Badge color="#fff" bg={PRIORITY_COLOR(r.llm_prioridad, C)}>{r.llm_prioridad}</Badge> : "—"}</td>
                        <td style={{ padding: "6px 10px", color: C.sub }}>{r.llm_categoria || "—"}</td>
                        <td style={{ padding: "6px 10px" }}>{r.llm_departamento || "—"}</td>
                        <td style={{ padding: "6px 10px" }}>{r.llm_municipio || "—"}</td>
                        <td style={{ padding: "6px 10px", maxWidth: 360, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={r.llm_hecho || r.text || ""}>{r.llm_hecho || r.text || "—"}</td>
                        <td style={{ padding: "6px 10px", color: C.sub, whiteSpace: "nowrap" }}>{r.sender_name || "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {filtered.length > 200 && (
              <div style={{ marginTop: 8, fontSize: 11, color: C.sub, textAlign: "center" }}>mostrando primeros 200 de {filtered.length} coincidencias · refina la búsqueda o el filtro</div>
            )}
          </Panel>
        </div>
      )}

      <DetailPanel record={selected} C={C} onClose={() => setSelected(null)} />
    </div>
  );
};

// ── Mount + dev mock ─────────────────────────────────────────────────────────
ReactDOM.createRoot(document.getElementById("root")!).render(
  <NexusProvider mockData={{
    ontology: {
      novedad: { records: Array.from({ length: 80 }, (_, i) => ({
        id: `n${i}`,
        text: `Mock novedad ${i}`,
        llm_hecho: `Mock hecho number ${i}`,
        sender_name: ["Jefe Del. Norte", "Oficial De Servicio", "Distrito San Lorenzo"][i % 3],
        chat_name: ["Jefes Delegaciones", "OFICIALES DE SERVICIO", "Distritos de Policia"][i % 3],
        llm_categoria: ["OPERATIVIDAD", "NOVEDAD RELEVANTE", "OPERATIVIDAD"][i % 3],
        llm_prioridad: ["INFORMATIVA", "CRITICO", "INFORMATIVA", "USR"][i % 4],
        llm_departamento: ["USULUTÁN", "SAN VICENTE", "SAN SALVADOR", "LA LIBERTAD"][i % 4],
        llm_municipio: ["Jocotillo", "San Lorenzo", "Mejicanos", "Santa Tecla"][i % 4],
        llm_tipo_incidente: [null, "HOMICIDIO", null, "ROBO"][i % 4],
        llm_accion_policial: ["PATRULLAJE", "VERIFICACIÓN", "CHARLA PREVENTIVA"][i % 3],
        sent_at: new Date(Date.now() - i * 1800_000).toISOString(),
      })) },
    },
  }}>
    <App />
  </NexusProvider>,
);
