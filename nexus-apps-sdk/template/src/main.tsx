import React from "react";
import ReactDOM from "react-dom/client";
import { NexusProvider, useNexus, useNexusReady, useAutoResize } from "@nexus/app-sdk/react";

const App: React.FC = () => {
  const { ready, error } = useNexusReady();
  if (error) return <pre style={{ padding: 16, color: "crimson" }}>{String(error)}</pre>;
  if (!ready) return <div style={{ padding: 16 }}>Loading…</div>;
  return <Body />;
};

const Body: React.FC = () => {
  const nexus = useNexus();
  const ref = React.useRef<HTMLDivElement>(null);
  useAutoResize(ref);
  const [types, setTypes] = React.useState<unknown[]>([]);

  React.useEffect(() => {
    nexus.ontology.listTypes().then(setTypes).catch(() => setTypes([]));
  }, []);

  return (
    <div ref={ref} style={{ padding: 24, fontSize: 14 }}>
      <h1 style={{ fontSize: 18 }}>{{name}}</h1>
      <p>Hello {nexus.ctx.user.email}. Tenant: {nexus.ctx.tenant_id}.</p>
      <ul>{types.map((t: any) => <li key={t.id}>{t.display_name || t.name}</li>)}</ul>
    </div>
  );
};

ReactDOM.createRoot(document.getElementById("root")!).render(
  <NexusProvider>
    <App />
  </NexusProvider>,
);
