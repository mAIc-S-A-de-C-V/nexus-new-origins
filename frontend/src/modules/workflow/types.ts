// Shared types for the multi-stage workflow feature.
// Mirrors the Python shapes in ontology_service/workflow.py.

export type StageType = 'approval' | 'option_review' | 'option_select' | 'parallel_group';

export type AssigneeKind = 'user_id' | 'user_email' | 'role' | 'from_payload';
export interface AssigneeSpec {
  kind: AssigneeKind;
  value?: string;
  field?: string; // for from_payload
}

export type RouteTarget = 'completed' | 'rejected' | string; // string = next stage name

export interface WorkflowStage {
  name: string;
  type: StageType;
  when?: unknown;                     // JSONLogic; null = always enter
  assignee?: AssigneeSpec | null;     // null OK for parallel_group
  options_field?: string;
  min_approve?: number;               // option_review
  min_select?: number;                // option_select
  max_select?: number;                // option_select
  on_approve?: RouteTarget;
  on_reject?: RouteTarget;
  on_timeout?: { action: 'approve' | 'reject' | 'reassign'; to?: AssigneeSpec };
  sla_seconds?: number | null;
  notify_on_enter?: AssigneeSpec[];
  notify_on_exit?: AssigneeSpec[];
  branches?: string[];                // parallel_group: list of sub-stage names
}

export interface DirectoryUser {
  id: string;
  email: string;
  name: string;
  role: string;
  is_active: boolean;
}

export interface NotificationItem {
  id: string;
  kind: string;
  action_execution_id?: string | null;
  action_name?: string | null;
  title: string;
  body?: string | null;
  deep_link?: string | null;
  payload?: Record<string, unknown> | null;
  read_at?: string | null;
  created_at?: string | null;
}

export interface ExecutionWorkflowState {
  current_stage?: string | null;
  stage_state?: Record<string, unknown> | null;
  stage_history?: Array<{
    stage: string;
    actor_user_id?: string | null;
    actor_email?: string | null;
    at: string;
    decision: string;
    note?: string;
    approved_option_ids?: string[];
    selected_option_ids?: string[];
  }> | null;
  requester_user_id?: string | null;
  requester_email?: string | null;
  assigned_to_user_id?: string | null;
  assigned_to_email?: string | null;
  options?: Array<Record<string, unknown>> | null;
  selected_option_ids?: string[];
}
