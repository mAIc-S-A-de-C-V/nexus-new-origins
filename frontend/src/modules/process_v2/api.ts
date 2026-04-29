import { getTenantId } from '../../store/authStore';

const PROCESS_API = import.meta.env.VITE_PROCESS_ENGINE_URL || 'http://localhost:8009';

const headers = (): Record<string, string> => ({
  'Content-Type': 'application/json',
  'x-tenant-id': getTenantId() || 'tenant-001',
});

export interface Process {
  id: string;
  tenant_id: string;
  name: string;
  description: string | null;
  case_key_attribute: string | null;
  included_object_type_ids: string[];
  included_activities: string[] | null;
  excluded_activities: string[] | null;
  default_model_id: string | null;
  is_implicit: boolean;
  status: string;
  created_at: string | null;
  updated_at: string | null;
}

export interface DiscoverySuggestion {
  suggested_name: string;
  case_key_attribute: string;
  included_object_type_ids: string[];
  candidate_case_count: number;
  sample_case_keys: string[];
  confidence: number;
  rationale: string;
}

export interface CaseStep {
  activity: string;
  object_type_id: string | null;
}

export interface ProcessCase {
  case_id: string;
  current_activity: string | null;
  last_resource: string | null;
  total_duration_days: number;
  days_since_last_activity: number;
  event_count: number;
  started_at: string | null;
  last_activity_at: string | null;
  variant_id: string;
  is_rework: boolean;
  state: string;
  activity_sequence: string[];
  object_type_count: number;
  object_types: string[];
  steps: CaseStep[];
}

export interface ProcessVariant {
  rank: number;
  variant_id: string;
  activities: string[];
  steps: CaseStep[];
  case_count: number;
  frequency_pct: number;
  avg_duration_days: number;
  min_duration_days: number;
  max_duration_days: number;
  is_rework: boolean;
}

export interface ProcessTransition {
  from_activity: string | null;
  from_object_type_id: string | null;
  to_activity: string;
  to_object_type_id: string | null;
  count: number;
  avg_hours: number;
  p50_hours: number;
  p95_hours: number;
  speed: 'fast' | 'normal' | 'slow';
}

export interface ProcessBottleneck {
  from_activity: string | null;
  from_object_type_id: string | null;
  to_activity: string;
  to_object_type_id: string | null;
  case_count: number;
  avg_hours: number;
  max_hours: number;
  p95_hours: number;
}

export interface ProcessStats {
  total_cases: number;
  avg_duration_days: number;
  stuck_cases: number;
  variant_count: number;
  rework_rate: number;
  avg_object_types_per_case: number;
  spans_objects: boolean;
}

export interface CaseTimelineEvent {
  id: string;
  activity: string;
  object_type_id: string | null;
  timestamp: string;
  resource: string | null;
  attributes: Record<string, unknown>;
  pipeline_id: string | null;
  duration_since_prev_hours: number | null;
}

const json = async (res: Response) => {
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
};

export const listProcesses = (includeImplicit = true): Promise<Process[]> =>
  fetch(`${PROCESS_API}/process/processes?include_implicit=${includeImplicit}`, { headers: headers() }).then(json);

export const createProcess = (body: Partial<Process>): Promise<Process> =>
  fetch(`${PROCESS_API}/process/processes`, {
    method: 'POST', headers: headers(), body: JSON.stringify(body),
  }).then(json);

export const updateProcess = (id: string, body: Partial<Process>): Promise<Process> =>
  fetch(`${PROCESS_API}/process/processes/${id}`, {
    method: 'PATCH', headers: headers(), body: JSON.stringify(body),
  }).then(json);

export const deleteProcess = (id: string): Promise<void> =>
  fetch(`${PROCESS_API}/process/processes/${id}`, { method: 'DELETE', headers: headers() })
    .then((r) => { if (!r.ok && r.status !== 204) throw new Error(`${r.status}`); });

export const autoDiscover = (): Promise<{ created_implicit: number; suggestions: DiscoverySuggestion[] }> =>
  fetch(`${PROCESS_API}/process/processes/auto-discover`, { method: 'POST', headers: headers() }).then(json);

export const backfillProcess = (id: string): Promise<{ events_updated: number; cases_after: number }> =>
  fetch(`${PROCESS_API}/process/processes/${id}/backfill`, { method: 'POST', headers: headers() }).then(json);

export const getStats = (id: string): Promise<ProcessStats> =>
  fetch(`${PROCESS_API}/process/by-process/stats/${id}`, { headers: headers() }).then(json);

export const getCases = (id: string, limit = 100): Promise<{ cases: ProcessCase[]; total: number; spans_objects: boolean }> =>
  fetch(`${PROCESS_API}/process/by-process/cases/${id}?limit=${limit}`, { headers: headers() }).then(json);

export const getCaseTimeline = (id: string, caseId: string): Promise<{ events: CaseTimelineEvent[]; total_duration_days: number; object_types: string[] }> =>
  fetch(`${PROCESS_API}/process/by-process/cases/${id}/${encodeURIComponent(caseId)}/timeline`, { headers: headers() }).then(json);

export const getVariants = (id: string, limit = 50): Promise<{ variants: ProcessVariant[]; total_cases: number; spans_objects: boolean }> =>
  fetch(`${PROCESS_API}/process/by-process/variants/${id}?limit=${limit}`, { headers: headers() }).then(json);

export const getTransitions = (id: string): Promise<{ transitions: ProcessTransition[]; activities: string[]; median_hours: number; spans_objects: boolean }> =>
  fetch(`${PROCESS_API}/process/by-process/transitions/${id}`, { headers: headers() }).then(json);

export const getBottlenecks = (id: string, topN = 10): Promise<{ bottlenecks: ProcessBottleneck[]; spans_objects: boolean }> =>
  fetch(`${PROCESS_API}/process/by-process/bottlenecks/${id}?top_n=${topN}`, { headers: headers() }).then(json);
