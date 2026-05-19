/**
 * @nexus/app-sdk — browser-side client.
 *
 * Entry point inside an app iframe. Drop this near the top of your bundle:
 *
 *     import { initNexus } from "@nexus/app-sdk";
 *     const nexus = await initNexus();
 *     const rows = await nexus.ontology.query({ object_type: "ordenes_de_compra", limit: 20 });
 *
 * The client never holds a "trust me" lookup table. It just shuttles `method` +
 * `args` to the host. The host enforces scopes, rate limits, audit. If a
 * method isn't in the install's granted scope set, you get a
 * `ScopeDeniedError` you can catch.
 *
 * For local development without a host, pass `{mock: true}` and you get a
 * minimal in-memory store + console logging so you can iterate without
 * roundtripping through the platform.
 */
import {
  AppToHostMessage,
  HostToAppMessage,
  InitMessage,
  PROTOCOL_VERSION,
  RpcRequestMessage,
  RpcResponseMessage,
} from "./protocol";

export class ScopeDeniedError extends Error {
  readonly requiredScope?: string;
  constructor(method: string, requiredScope?: string) {
    super(`Scope denied for ${method}` + (requiredScope ? `: ${requiredScope}` : ""));
    this.requiredScope = requiredScope;
    this.name = "ScopeDeniedError";
  }
}

export class RpcError extends Error {
  readonly code: string;
  readonly detail?: string;
  constructor(method: string, code: string, detail?: string) {
    super(`RPC ${method} failed: ${code}${detail ? " — " + detail : ""}`);
    this.code = code;
    this.detail = detail;
    this.name = "RpcError";
  }
}


export interface NexusContext {
  install_id: string;
  app_id: string;
  version: string;
  tenant_id: string;
  user: { id: string; email: string; role: string };
  config: Record<string, unknown>;
  scopes_granted: string[];
  theme: "light" | "dark";
  locale: string;
  density: "comfortable" | "compact";
  host_origin: string;
}

export interface OntologyQueryArgs {
  object_type: string;
  filter?: unknown;
  search?: string;
  order_by?: string;
  limit?: number;
  offset?: number;
}

export interface ActionProposeArgs {
  action_name: string;
  inputs: Record<string, unknown>;
  reasoning?: string;
}

export interface NexusClient {
  /** Live context. Mutable across theme/locale changes. */
  readonly ctx: NexusContext;

  /** Subscribe to context changes (theme, locale, density). */
  onContextChange(cb: (next: NexusContext) => void): () => void;

  /** Has the install been granted this scope? Useful for hiding UI you can't drive. */
  hasScope(scope: string): boolean;

  /** Tell the host the document height. Call this when content size changes. */
  resize(height: number): void;

  /** Programmatic navigation in the host shell (e.g. linking to /apps/other). */
  navigate(to: string, opts?: { newTab?: boolean }): void;

  /** Toast / focus / close primitives. */
  toast(level: "info" | "success" | "warning" | "error", message: string): void;
  closeMe(): void;
  registerShortcuts(hints: { keys: string; label: string }[]): void;

  /** Manual signal that something fatal happened — host renders a crash fallback. */
  crash(error: string): void;

  /** Low-level escape hatch — most users should prefer the typed methods below. */
  rpc<T = unknown>(method: string, args?: Record<string, unknown>): Promise<T>;

  /** Force a token refresh (rarely needed — SDK does it automatically near expiry). */
  refreshToken(): Promise<void>;

  // ── Typed surface ───────────────────────────────────────────────────────
  host: {
    ping(): Promise<{ pong: true; now: number }>;
    getConfig(): Promise<{ config: Record<string, unknown> }>;
  };
  ontology: {
    listTypes(): Promise<{ id: string; name: string; display_name?: string }[]>;
    query<T = Record<string, unknown>>(args: OntologyQueryArgs): Promise<{ records: T[]; count?: number; total?: number }>;
    get<T = Record<string, unknown>>(object_type: string, record_id: string): Promise<T | null>;
    aggregate(args: { object_type: string; group_by?: string; time_bucket?: { field: string; interval: string }; aggregations: { method: string; field?: string; alias?: string }[]; filters?: string; limit?: number }): Promise<{ rows: Record<string, unknown>[]; total_groups?: number }>;
    /** Create (upsert) a record. If `data.id` is set, it becomes the record_id. */
    create(args: { object_type: string; data: Record<string, unknown>; pk_field?: string }): Promise<{ ok: true; record_id: string; ingested: number }>;
    /** Merge `fields` into an existing record. */
    update(args: { object_type: string; record_id: string; fields: Record<string, unknown> }): Promise<{ ok: true; record_id: string }>;
    /** Delete a record by id. */
    delete(args: { object_type: string; record_id: string }): Promise<{ ok: true; record_id: string }>;
  };
  actions: {
    list(): Promise<{ name: string; description?: string; input_schema?: Record<string, unknown>; requires_confirmation?: boolean }[]>;
    propose(args: ActionProposeArgs): Promise<{ execution_id?: string; status?: string; result?: unknown }>;
  };
  agents: {
    list(): Promise<{ name: string; description?: string }[]>;
    run(agent_name: string, inputs: Record<string, unknown>): Promise<unknown>;
  };
  workflow: {
    listMine(): Promise<unknown[]>;
  };
  storage: {
    kv: {
      get<T = unknown>(key: string, opts?: { scope?: "install" | "user" }): Promise<T | null>;
      set(key: string, value: unknown, opts?: { scope?: "install" | "user" }): Promise<{ ok: true; size_bytes: number }>;
      delete(key: string, opts?: { scope?: "install" | "user" }): Promise<{ ok: true }>;
      list(prefix?: string, opts?: { scope?: "install" | "user" }): Promise<{ items: { key: string; value: unknown; updated_at: string }[] }>;
    };
  };
}


interface InternalState {
  ctx: NexusContext | null;
  token: string | null;
  hostOrigin: string;
  hostRpcUrl: string;          // POST endpoint the host turned around to call
  pendingCalls: Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void }>;
  contextListeners: Set<(c: NexusContext) => void>;
}


function newRequestId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return (crypto as Crypto).randomUUID();
  return "req-" + Math.random().toString(36).slice(2) + Date.now().toString(36);
}


function makeClient(state: InternalState, opts: { mock: boolean; mockData?: MockData }): NexusClient {
  const post = (msg: AppToHostMessage) => {
    window.parent.postMessage(msg, state.hostOrigin);
  };

  const rpc = async <T,>(method: string, args: Record<string, unknown> = {}): Promise<T> => {
    if (opts.mock) {
      return runMock(method, args, opts.mockData!) as Promise<T>;
    }
    if (!state.ctx) throw new Error("Nexus SDK: not initialised — wait for initNexus()");
    const requestId = newRequestId();
    return new Promise<T>((resolve, reject) => {
      state.pendingCalls.set(requestId, {
        resolve: (v) => resolve(v as T),
        reject,
      });
      const msg: RpcRequestMessage = { v: 1, type: "rpc_request", requestId, method, args };
      post(msg);
      // Safety timeout. Generous enough to cover ontology aggregates.
      setTimeout(() => {
        const pending = state.pendingCalls.get(requestId);
        if (pending) {
          state.pendingCalls.delete(requestId);
          pending.reject(new RpcError(method, "host_timeout"));
        }
      }, 60_000);
    });
  };

  const refreshToken = async () => {
    if (opts.mock) return;
    const requestId = newRequestId();
    const reply = await new Promise<{ token?: string; error?: string }>((resolve) => {
      state.pendingCalls.set("token:" + requestId, {
        resolve: (v) => resolve(v as { token?: string }),
        reject: () => resolve({}),
      });
      post({ v: 1, type: "token_refresh_request", requestId });
      setTimeout(() => resolve({}), 15000);
    });
    if (reply.token) state.token = reply.token;
  };

  return {
    get ctx() {
      if (!state.ctx) throw new Error("Nexus SDK: not initialised");
      return state.ctx;
    },
    onContextChange(cb) {
      state.contextListeners.add(cb);
      return () => state.contextListeners.delete(cb);
    },
    hasScope(scope) {
      if (!state.ctx) return false;
      // A "*" suffix in granted satisfies any concrete child target.
      return state.ctx.scopes_granted.some((g) => scopeSatisfies(g, scope));
    },
    resize(height) {
      post({ v: 1, type: "resize", height });
    },
    navigate(to, o) {
      post({ v: 1, type: "navigate", to, newTab: o?.newTab });
    },
    toast(level, message) {
      post({ v: 1, type: "ui_signal", signal: { kind: "toast", level, message } });
    },
    closeMe() {
      post({ v: 1, type: "ui_signal", signal: { kind: "close" } });
    },
    registerShortcuts(hints) {
      post({ v: 1, type: "ui_signal", signal: { kind: "shortcut_hint", hints } });
    },
    crash(error) {
      post({ v: 1, type: "crashed", error });
    },
    rpc,
    refreshToken,
    host: {
      ping: () => rpc<{ pong: true; now: number }>("host.ping"),
      getConfig: () => rpc<{ config: Record<string, unknown> }>("host.getConfig"),
    },
    ontology: {
      listTypes: () => rpc("ontology.listTypes"),
      query: (args) => rpc("ontology.query", args as unknown as Record<string, unknown>),
      get: (object_type, record_id) => rpc("ontology.get", { object_type, record_id }),
      aggregate: (args) => rpc("ontology.aggregate", args as unknown as Record<string, unknown>),
      create: (args) => rpc("ontology.create", args as unknown as Record<string, unknown>),
      update: (args) => rpc("ontology.update", args as unknown as Record<string, unknown>),
      delete: (args) => rpc("ontology.delete", args as unknown as Record<string, unknown>),
    },
    actions: {
      list: () => rpc("actions.list"),
      propose: (args) => rpc("actions.propose", args as unknown as Record<string, unknown>),
    },
    agents: {
      list: () => rpc("agents.list"),
      run: (agent_name, inputs) => rpc("agents.run", { agent_name, inputs }),
    },
    workflow: {
      listMine: () => rpc("workflow.listMine"),
    },
    storage: {
      kv: {
        get: (key, opts) => rpc("storage.kv.get", { key, scope: opts?.scope ?? "install" }).then((r: any) => r?.value ?? null),
        set: (key, value, opts) => rpc("storage.kv.set", { key, value, scope: opts?.scope ?? "install" }),
        delete: (key, opts) => rpc("storage.kv.delete", { key, scope: opts?.scope ?? "install" }),
        list: (prefix, opts) => rpc("storage.kv.list", { prefix: prefix ?? "", scope: opts?.scope ?? "install" }),
      },
    },
  };
}


function scopeSatisfies(granted: string, required: string): boolean {
  const g = granted.split(":");
  const r = required.split(":");
  if (g.length !== r.length) return false;
  for (let i = 0; i < g.length; i++) {
    if (g[i] !== "*" && g[i] !== r[i]) return false;
  }
  return true;
}


// ── Mock mode for local dev ──────────────────────────────────────────────────

interface MockData {
  ontology?: Record<string, { records: Record<string, unknown>[] }>;
  actions?: { name: string; description?: string }[];
  kv?: Record<string, unknown>;
}

async function runMock(method: string, args: Record<string, unknown>, data: MockData): Promise<unknown> {
  if (method === "host.ping") return { pong: true, now: Date.now() };
  if (method === "host.getConfig") return { config: {} };
  if (method === "ontology.listTypes") {
    return Object.entries(data.ontology ?? {}).map(([name], i) => ({ id: `mock-${i}`, name, display_name: name }));
  }
  if (method === "ontology.query") {
    const t = data.ontology?.[args.object_type as string];
    return t ? { records: t.records.slice(0, (args.limit as number) ?? 50), total: t.records.length } : { records: [], total: 0 };
  }
  if (method === "ontology.get") {
    const t = data.ontology?.[args.object_type as string];
    return t?.records.find((r: any) => r.id === args.record_id) ?? null;
  }
  if (method === "ontology.create") {
    const ot = args.object_type as string;
    const incoming = (args.data || {}) as Record<string, unknown>;
    const pk = (args.pk_field as string) || "id";
    const id = (incoming[pk] as string) || `mock-${Date.now().toString(36)}`;
    const t = (data.ontology = data.ontology || {})[ot] = data.ontology![ot] || { records: [] };
    const row = { ...incoming, [pk]: id };
    const existing = t.records.findIndex((r: any) => r[pk] === id);
    if (existing >= 0) t.records[existing] = row; else t.records.push(row);
    return { ok: true, record_id: id, ingested: 1 };
  }
  if (method === "ontology.update") {
    const ot = args.object_type as string;
    const rid = args.record_id as string;
    const fields = (args.fields || {}) as Record<string, unknown>;
    const t = data.ontology?.[ot];
    const idx = t?.records.findIndex((r: any) => r.id === rid) ?? -1;
    if (!t || idx < 0) return { error: "record not found" };
    t.records[idx] = { ...t.records[idx], ...fields };
    return { ok: true, record_id: rid };
  }
  if (method === "ontology.delete") {
    const ot = args.object_type as string;
    const rid = args.record_id as string;
    const t = data.ontology?.[ot];
    if (!t) return { ok: true, record_id: rid };
    t.records = t.records.filter((r: any) => r.id !== rid);
    return { ok: true, record_id: rid };
  }
  if (method === "actions.list") return data.actions ?? [];
  if (method === "actions.propose") return { execution_id: "mock-" + Date.now(), status: "pending" };
  if (method === "storage.kv.get") return { value: (data.kv ?? {})[args.key as string] ?? null };
  if (method === "storage.kv.set") {
    (data.kv ?? (data.kv = {}))[args.key as string] = args.value;
    return { ok: true, size_bytes: JSON.stringify(args.value).length };
  }
  if (method === "storage.kv.delete") {
    if (data.kv) delete data.kv[args.key as string];
    return { ok: true };
  }
  if (method === "storage.kv.list") {
    const kv = data.kv ?? {};
    const prefix = (args.prefix as string) ?? "";
    return { items: Object.keys(kv).filter((k) => k.startsWith(prefix)).map((k) => ({ key: k, value: kv[k], updated_at: new Date().toISOString() })) };
  }
  throw new RpcError(method, "unknown_method_in_mock");
}


// ── public init ─────────────────────────────────────────────────────────────

export interface InitOptions {
  /** Force mock mode (default: true if no parent window — i.e. running `npm run dev` standalone). */
  mock?: boolean;
  mockData?: MockData;
  /** Called when host changes theme/locale/density mid-session. */
  onContextChange?: (ctx: NexusContext) => void;
}


export async function initNexus(opts: InitOptions = {}): Promise<NexusClient> {
  const state: InternalState = {
    ctx: null,
    token: null,
    hostOrigin: "",
    hostRpcUrl: "",
    pendingCalls: new Map(),
    contextListeners: new Set(),
  };
  if (opts.onContextChange) state.contextListeners.add(opts.onContextChange);

  const isFramed = window.parent !== window;
  const mock = opts.mock ?? !isFramed;
  if (mock) {
    state.ctx = {
      install_id: "mock-install",
      app_id: "mock-app",
      version: "0.0.0-mock",
      tenant_id: "tenant-mock",
      user: { id: "mock-user", email: "you@example.dev", role: "admin" },
      config: {},
      scopes_granted: ["ontology:read:*", "actions:propose:*", "storage:kv:read", "storage:kv:write"],
      theme: "light",
      locale: "en",
      density: "comfortable",
      host_origin: window.location.origin,
    };
    return makeClient(state, { mock: true, mockData: opts.mockData ?? {} });
  }

  // Wait for INIT
  await new Promise<void>((resolve) => {
    const handler = (ev: MessageEvent) => {
      const msg = ev.data as HostToAppMessage | undefined;
      if (!msg || (msg as { v?: number }).v !== PROTOCOL_VERSION) return;
      if (msg.type === "init") {
        state.ctx = {
          install_id: msg.install_id,
          app_id: msg.app_id,
          version: msg.version,
          tenant_id: msg.tenant_id,
          user: msg.user,
          config: msg.config,
          scopes_granted: msg.scopes_granted,
          theme: msg.theme,
          locale: msg.locale,
          density: msg.density,
          host_origin: msg.host_origin,
        };
        state.token = msg.token;
        state.hostOrigin = msg.host_origin;
        window.removeEventListener("message", handler);
        resolve();
      }
    };
    window.addEventListener("message", handler);
    // Tell the host we are ready to receive INIT.
    window.parent.postMessage(
      { v: PROTOCOL_VERSION, type: "ready", origin: window.location.origin } as AppToHostMessage,
      "*",   // The host will re-check our origin against the install manifest.
    );
  });

  // Permanent message handler — RPC replies + context changes
  window.addEventListener("message", (ev: MessageEvent) => {
    if (state.hostOrigin && ev.origin !== state.hostOrigin) return;
    const msg = ev.data as HostToAppMessage | undefined;
    if (!msg || (msg as { v?: number }).v !== PROTOCOL_VERSION) return;

    if (msg.type === "rpc_response") {
      const pending = state.pendingCalls.get(msg.requestId);
      if (!pending) return;
      state.pendingCalls.delete(msg.requestId);
      if (msg.ok) pending.resolve(msg.result);
      else if (msg.error === "scope_denied")
        pending.reject(new ScopeDeniedError("(see method)", msg.required_scope));
      else pending.reject(new RpcError("(see method)", msg.error || "rpc_error", msg.detail));
    } else if (msg.type === "token_refresh_reply") {
      const key = "token:" + msg.requestId;
      const pending = state.pendingCalls.get(key);
      if (pending) {
        state.pendingCalls.delete(key);
        pending.resolve(msg);
      }
      if (msg.token) state.token = msg.token;
    } else if (msg.type === "context_change" && state.ctx) {
      const next: NexusContext = {
        ...state.ctx,
        theme: msg.theme ?? state.ctx.theme,
        locale: msg.locale ?? state.ctx.locale,
        density: msg.density ?? state.ctx.density,
      };
      state.ctx = next;
      state.contextListeners.forEach((cb) => cb(next));
    }
  });

  return makeClient(state, { mock: false });
}
