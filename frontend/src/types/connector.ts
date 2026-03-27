export type ConnectorCategory = 'REST' | 'GraphQL' | 'Stream' | 'ERP' | 'CRM' | 'DB' | 'File' | 'Doc' | 'HTTP' | 'DW' | 'Productivity';

export type ConnectorStatus = 'live' | 'active' | 'idle' | 'error' | 'warning';

export type AuthType = 'Bearer' | 'ApiKey' | 'OAuth2' | 'Basic' | 'None';

export type PaginationStrategy = 'cursor' | 'offset' | 'page' | 'none';

export interface ConnectorConfig {
  id: string;
  name: string;
  type: string;
  category: ConnectorCategory;
  status: ConnectorStatus;
  description: string;
  baseUrl?: string;
  authType: AuthType;
  credentials?: Record<string, string>;
  headers?: Record<string, string>;
  paginationStrategy?: PaginationStrategy;
  activePipelineCount: number;
  lastSync?: string;
  lastSyncRowCount?: number;
  schemaHash?: string;
  createdAt: string;
  updatedAt: string;
  tenantId: string;
  tags?: string[];
  config?: Record<string, unknown>;
}

export interface ConnectorHealth {
  connectorId: string;
  timestamp: string;
  successRate: number;
  avgLatencyMs: number;
  errorCount: number;
  rowsProcessed: number;
  status: ConnectorStatus;
}

export interface RawSchema {
  connectorId: string;
  fetchedAt: string;
  schema: Record<string, unknown>;
  sampleRows?: Record<string, unknown>[];
}
