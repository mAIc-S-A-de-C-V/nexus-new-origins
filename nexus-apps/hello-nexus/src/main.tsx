import React from "react";
import ReactDOM from "react-dom/client";
import {
  NexusProvider, useNexus, useNexusReady, useNexusContext, useAutoResize, useNexusQuery,
} from "@nexus/app-sdk/react";

const PURPLE = "#7C3AED";

const App: React.FC = () => {
  const { ready, error } = useNexusReady();
  if (error) return <pre style={{ padding: 16, color: "crimson" }}>{String(error)}</pre>;
  if (!ready) return <div style={{ padding: 16 }}>Connecting to Nexus…</div>;
  return <Body />;
};

const Body: React.FC = () => {
  const nexus = useNexus();
  const ctx = useNexusContext();
  const ref = React.useRef<HTMLDivElement>(null);
  useAutoResize(ref);

  const isDark = ctx.theme === "dark";
  const colors = {
    bg: isDark ? "#0D1117" : "#FFFFFF",
    fg: isDark ? "#E2E8F0" : "#0D1117",
    sub: isDark ? "#94A3B8" : "#64748B",
    border: isDark ? "#1F2937" : "#E2E8F0",
    card: isDark ? "#111827" : "#F8FAFC",
  };

  return (
    <div ref={ref} style={{ padding: 24, background: colors.bg, color: colors.fg, fontSize: 14, minHeight: 360 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 18 }}>Hello Nexus</div>
          <div style={{ fontSize: 11, color: colors.sub }}>
            Tenant <code>{ctx.tenant_id}</code> · user <code>{ctx.user.email}</code> · {ctx.theme}/{ctx.locale}
          </div>
        </div>
        <button
          onClick={() => nexus.toast("info", "hello toast from the iframe")}
          style={{ marginLeft: "auto", padding: "6px 12px", fontSize: 11, background: PURPLE, color: "#fff", border: "none", cursor: "pointer", borderRadius: 4 }}
        >
          Toast host
        </button>
      </div>
      <Granted />
      <OntologyDemo colors={colors} />
      <KVDemo colors={colors} />
      <ActionDemo colors={colors} />
    </div>
  );
};

const Granted: React.FC = () => {
  const ctx = useNexusContext();
  return (
    <div style={{ fontSize: 11, color: "#64748B", marginBottom: 12 }}>
      <strong>Granted scopes:</strong>{" "}
      {ctx.scopes_granted.length === 0 ? "(none)" : ctx.scopes_granted.map((s) => (
        <code key={s} style={{ marginRight: 6 }}>{s}</code>
      ))}
    </div>
  );
};

const OntologyDemo: React.FC<{ colors: Record<string, string> }> = ({ colors }) => {
  const nexus = useNexus();
  const { data: types, loading, error } = useNexusQuery(
    () => nexus.ontology.listTypes(),
    [],
  );

  const [chosen, setChosen] = React.useState<string | null>(null);
  const { data: rows, loading: rowsLoading } = useNexusQuery(
    async () => chosen ? nexus.ontology.query({ object_type: chosen, limit: 5 }) : null,
    [chosen],
  );

  return (
    <Section title="Ontology" colors={colors}>
      {loading && <span>Loading…</span>}
      {error && <span style={{ color: "#B91C1C" }}>{String(error)}</span>}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {(types || []).slice(0, 12).map((t: any) => (
          <button
            key={t.id}
            onClick={() => setChosen(t.name)}
            style={{ padding: "4px 8px", fontSize: 11, background: chosen === t.name ? PURPLE : colors.card, color: chosen === t.name ? "#fff" : colors.fg, border: `1px solid ${colors.border}`, cursor: "pointer", borderRadius: 4 }}>
            {t.display_name || t.name}
          </button>
        ))}
      </div>
      {chosen && (
        <div style={{ marginTop: 12, fontSize: 11 }}>
          {rowsLoading ? "loading…" : (
            <pre style={{ background: colors.card, padding: 8, borderRadius: 4, maxHeight: 200, overflow: "auto" }}>
              {JSON.stringify(((rows as any) || {}).records || [], null, 2)}
            </pre>
          )}
        </div>
      )}
    </Section>
  );
};

const KVDemo: React.FC<{ colors: Record<string, string> }> = ({ colors }) => {
  const nexus = useNexus();
  const [key, setKey] = React.useState("last_seen");
  const [val, setVal] = React.useState("");
  const [stored, setStored] = React.useState<unknown>(null);

  React.useEffect(() => { nexus.storage.kv.get(key).then(setStored); }, [key]); // eslint-disable-line

  return (
    <Section title="Storage (KV)" colors={colors}>
      <div style={{ display: "flex", gap: 6 }}>
        <input value={key} onChange={(e) => setKey(e.target.value)} style={{ width: 120, padding: "4px 6px", fontSize: 12, background: colors.card, color: colors.fg, border: `1px solid ${colors.border}` }} />
        <input value={val} onChange={(e) => setVal(e.target.value)} placeholder="value" style={{ flex: 1, padding: "4px 6px", fontSize: 12, background: colors.card, color: colors.fg, border: `1px solid ${colors.border}` }} />
        <button onClick={async () => { await nexus.storage.kv.set(key, val || new Date().toISOString()); const s = await nexus.storage.kv.get(key); setStored(s); }} style={{ padding: "4px 8px", fontSize: 11, background: PURPLE, color: "#fff", border: "none", cursor: "pointer", borderRadius: 4 }}>Set</button>
        <button onClick={async () => { await nexus.storage.kv.delete(key); setStored(null); }} style={{ padding: "4px 8px", fontSize: 11, background: colors.card, color: colors.fg, border: `1px solid ${colors.border}`, cursor: "pointer", borderRadius: 4 }}>Delete</button>
      </div>
      <div style={{ marginTop: 8, fontSize: 11 }}>
        Stored: <code>{stored === null ? "(none)" : JSON.stringify(stored)}</code>
      </div>
    </Section>
  );
};

const ActionDemo: React.FC<{ colors: Record<string, string> }> = ({ colors }) => {
  const nexus = useNexus();
  const [actions, setActions] = React.useState<any[]>([]);
  const [result, setResult] = React.useState<unknown>(null);
  React.useEffect(() => { nexus.actions.list().then(setActions).catch(() => setActions([])); }, []);

  return (
    <Section title="Actions" colors={colors}>
      {actions.length === 0 && <div style={{ fontSize: 11, color: colors.sub }}>No actions visible (or scope missing).</div>}
      {actions.slice(0, 6).map((a) => (
        <button
          key={a.name}
          onClick={async () => {
            try {
              const r = await nexus.actions.propose({ action_name: a.name, inputs: {}, reasoning: "hello-nexus demo" });
              setResult(r);
            } catch (e) { setResult({ error: String(e) }); }
          }}
          style={{ margin: "4px 6px 4px 0", padding: "4px 8px", fontSize: 11, background: colors.card, color: colors.fg, border: `1px solid ${colors.border}`, cursor: "pointer", borderRadius: 4 }}>
          {a.name}
        </button>
      ))}
      {result != null && <pre style={{ marginTop: 8, background: colors.card, padding: 8, borderRadius: 4, fontSize: 11, maxHeight: 160, overflow: "auto" }}>{JSON.stringify(result, null, 2)}</pre>}
    </Section>
  );
};

const Section: React.FC<{ title: string; colors: Record<string, string>; children: React.ReactNode }> = ({ title, colors, children }) => (
  <section style={{ margin: "20px 0", border: `1px solid ${colors.border}`, borderRadius: 6, padding: 16, background: colors.bg }}>
    <h2 style={{ fontSize: 12, fontWeight: 600, color: colors.sub, textTransform: "uppercase", letterSpacing: "0.06em", margin: "0 0 12px" }}>{title}</h2>
    {children}
  </section>
);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <NexusProvider mockData={{
    ontology: {
      ordenes_de_compra: { records: [{ id: "1", display: "PO-001" }, { id: "2", display: "PO-002" }] },
    },
    actions: [{ name: "demo_action", description: "Mock action" }],
  }}>
    <App />
  </NexusProvider>,
);
