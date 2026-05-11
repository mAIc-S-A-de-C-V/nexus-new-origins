// Mirrors apps_service types — keep in sync.

export interface AppCatalogEntry {
  app_id: string;
  publisher_id: string;
  display_name: string;
  description?: string;
  icon_url?: string;
  homepage_url?: string;
  latest_version?: string;
  visibility: 'public' | 'private' | 'unlisted';
  created_at: string;
  updated_at: string;
}

export interface AppVersionEntry {
  id: string;
  app_id: string;
  version: string;
  manifest: Record<string, unknown>;
  bundle_sha256: string;
  bundle_size_bytes: number;
  entry_url: string;
  scopes_required: string[];
  surfaces: AppSurface[];
  config_schema?: Record<string, unknown>;
  functions: Array<Record<string, unknown>>;
  event_subscriptions: Array<Record<string, unknown>>;
  published_at: string;
  yanked: boolean;
}

export interface AppInstallEntry {
  id: string;
  tenant_id: string;
  app_id: string;
  version_pinned: string;
  scopes_granted: string[];
  scopes_denied: string[];
  config: Record<string, unknown>;
  enabled: boolean;
  installed_by: string;
  installed_by_email?: string;
  installed_at: string;
  updated_at: string;
}

export type AppSurface =
  | { type: 'page'; path?: string; title?: string; icon?: string; size?: SurfaceSize; min_role?: Role }
  | { type: 'widget'; id?: string; title?: string; size?: SurfaceSize }
  | { type: 'object_action'; object_type: string; label?: string; min_role?: Role }
  | { type: 'slash_command'; name: string; title?: string; min_role?: Role };

export type SurfaceSize = 'sm' | 'md' | 'lg' | 'xl' | 'full';
export type Role = 'viewer' | 'analyst' | 'admin' | 'superadmin';

export interface TenantSurface {
  install_id: string;
  app_id: string;
  version: string;
  display_name: string;
  icon?: string;
  surface: AppSurface;
}

export interface ScopeCatalogEntry {
  name: string;
  description: string;
  sensitive: boolean;
}

export interface AuditEntry {
  id: string;
  occurred_at: string;
  event_type: string;
  method?: string;
  scope_used?: string;
  status: 'ok' | 'denied' | 'error';
  latency_ms?: number;
  error_message?: string;
  user_id?: string;
  extras?: Record<string, unknown>;
}
