/**
 * Wire protocol between the Nexus host iframe parent and the app iframe child.
 *
 * Versioned via `v`. Bump for breaking changes; keep older `v` handlers as long
 * as installed apps still use them. v1 is the first stable revision.
 */

export const PROTOCOL_VERSION = 1;

/** Sent by the iframe (child) the moment SDK initialises. */
export interface ReadyMessage {
  v: 1;
  type: "ready";
  /** The app's URL origin (verified again on the host side, never trusted). */
  origin: string;
  /** Optional capabilities the app declares it supports (for forward-compat). */
  features?: string[];
}

/** Sent by the host (parent) right after receiving `ready`. */
export interface InitMessage {
  v: 1;
  type: "init";
  token: string;
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
  /** The host's URL origin — app uses this as targetOrigin when posting back. */
  host_origin: string;
}

/** Theme / locale change mid-session. */
export interface ContextChangeMessage {
  v: 1;
  type: "context_change";
  theme?: "light" | "dark";
  locale?: string;
  density?: "comfortable" | "compact";
}

/** App → host RPC call. */
export interface RpcRequestMessage {
  v: 1;
  type: "rpc_request";
  requestId: string;
  method: string;
  args?: Record<string, unknown>;
}

/** Host → app RPC reply. */
export interface RpcResponseMessage {
  v: 1;
  type: "rpc_response";
  requestId: string;
  ok: boolean;
  result?: unknown;
  error?: string;
  detail?: string;
  required_scope?: string;
  latency_ms?: number;
}

/** App → host: my body is this tall, please resize the iframe. */
export interface ResizeMessage {
  v: 1;
  type: "resize";
  height: number;
}

/** App → host: please refresh my token (calls host.refreshToken). */
export interface TokenRefreshMessage {
  v: 1;
  type: "token_refresh_request";
  requestId: string;
}

export interface TokenRefreshReply {
  v: 1;
  type: "token_refresh_reply";
  requestId: string;
  token?: string;
  expires_at?: string;
  error?: string;
}

/** App → host: trigger host-level navigation (open a different page). */
export interface NavigateMessage {
  v: 1;
  type: "navigate";
  to: string;
  /** Optional: open in a fresh tab/popup rather than replacing the iframe. */
  newTab?: boolean;
}

/** App → host: trigger host UI primitives (toast, modal close, etc). */
export interface UiSignalMessage {
  v: 1;
  type: "ui_signal";
  signal:
    | { kind: "toast"; level: "info" | "success" | "warning" | "error"; message: string }
    | { kind: "close" }
    | { kind: "focus_request" }
    | { kind: "shortcut_hint"; hints: { keys: string; label: string }[] };
}

/** App → host: "I crashed and want you to display a fallback". */
export interface CrashedMessage {
  v: 1;
  type: "crashed";
  error: string;
}

export type AppToHostMessage =
  | ReadyMessage
  | RpcRequestMessage
  | ResizeMessage
  | TokenRefreshMessage
  | NavigateMessage
  | UiSignalMessage
  | CrashedMessage;

export type HostToAppMessage =
  | InitMessage
  | ContextChangeMessage
  | RpcResponseMessage
  | TokenRefreshReply;
