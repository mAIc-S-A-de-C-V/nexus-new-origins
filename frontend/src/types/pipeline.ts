export type NodeType =
  | 'SOURCE'
  | 'FILTER'
  | 'MAP'
  | 'CAST'
  | 'ENRICH'
  | 'FLATTEN'
  | 'DEDUPE'
  | 'VALIDATE'
  | 'SINK_OBJECT'
  | 'SINK_EVENT'
  | 'AGENT_RUN'
  | 'LLM_CLASSIFY';

export type PipelineStatus = 'RUNNING' | 'IDLE' | 'FAILED' | 'PAUSED' | 'DRAFT' | 'COMPLETED';

export interface NodeConfig {
  [key: string]: unknown;
}

export interface PipelineNode {
  id: string;
  type: NodeType;
  label: string;
  config: NodeConfig;
  position: { x: number; y: number };
  connectorId?: string;
  objectTypeId?: string;
}

export interface PipelineEdge {
  id: string;
  source: string;
  target: string;
  label?: string;
  animated?: boolean;
}

export interface Pipeline {
  id: string;
  name: string;
  description?: string;
  status: PipelineStatus;
  nodes: PipelineNode[];
  edges: PipelineEdge[];
  connectorIds: string[];
  targetObjectTypeId?: string;
  createdAt: string;
  updatedAt: string;
  lastRunAt?: string;
  lastRunRowCount?: number;
  tenantId: string;
  version: number;
}

export interface PipelineRun {
  id: string;
  pipelineId: string;
  startedAt: string;
  finishedAt?: string;
  status: 'SUCCESS' | 'FAILED' | 'RUNNING';
  rowsIn: number;
  rowsOut: number;
  errorMessage?: string;
  triggeredBy: string;
}

export interface EventLogQualityScore {
  pipelineId: string;
  completeness: number;
  timeliness: number;
  consistency: number;
  accuracy: number;
  composite: number;
  evaluatedAt: string;
  issues: string[];
}
