export interface Event {
  id: string;
  caseId: string;
  activity: string;
  timestamp: string;
  objectTypeId: string;
  objectId: string;
  pipelineId: string;
  connectorId: string;
  attributes: Record<string, unknown>;
  resource?: string;
  cost?: number;
  tenantId: string;
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
  caseCount: number;
  eventCount: number;
}
