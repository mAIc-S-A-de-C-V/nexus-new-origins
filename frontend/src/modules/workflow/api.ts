// Thin API client for the workflow + notifications endpoints in ontology_service.
import { getTenantId } from '../../store/authStore';
import type { DirectoryUser, NotificationItem } from './types';

const ONTOLOGY_API = import.meta.env.VITE_ONTOLOGY_SERVICE_URL || 'http://localhost:8004';

function headers(): HeadersInit {
  const h: Record<string, string> = {
    'x-tenant-id': getTenantId(),
    'Content-Type': 'application/json',
  };
  // Pull current user id/email if the auth store has them so the
  // backend can validate "assigned_to_me" + author decisions correctly.
  try {
    const raw = localStorage.getItem('auth-storage');
    if (raw) {
      const data = JSON.parse(raw);
      const u = data?.state?.user || data?.user;
      if (u?.id) h['x-user-id'] = u.id;
      if (u?.email) h['x-user-email'] = u.email;
    }
  } catch { /* ignore */ }
  return h;
}

export async function listUsers(force = false): Promise<DirectoryUser[]> {
  const r = await fetch(`${ONTOLOGY_API}/workflow/users${force ? '?refresh=true' : ''}`, {
    headers: headers(),
  });
  if (!r.ok) return [];
  const body = await r.json();
  return body.users || [];
}

export interface DecisionPayload {
  decision: 'approve' | 'reject' | 'review_options' | 'select_options';
  decided_in_stage?: string;
  note?: string;
  approved_option_ids?: string[];
  selected_option_ids?: string[];
  payload_diff?: Record<string, unknown>;
}

export async function submitDecision(executionId: string, body: DecisionPayload) {
  const r = await fetch(`${ONTOLOGY_API}/workflow/decisions/${executionId}`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    let msg = `decision failed: ${r.status}`;
    try { msg = (await r.json()).detail || msg; } catch { /* */ }
    throw new Error(msg);
  }
  return await r.json();
}

export async function listNotifications(onlyUnread = false): Promise<{ notifications: NotificationItem[]; unread_count: number }> {
  const r = await fetch(`${ONTOLOGY_API}/workflow/notifications?only_unread=${onlyUnread}`, {
    headers: headers(),
  });
  if (!r.ok) return { notifications: [], unread_count: 0 };
  return await r.json();
}

export async function markNotificationRead(id: string): Promise<void> {
  await fetch(`${ONTOLOGY_API}/workflow/notifications/${id}/read`, {
    method: 'POST',
    headers: headers(),
  });
}

export async function markAllNotificationsRead(): Promise<number> {
  const r = await fetch(`${ONTOLOGY_API}/workflow/notifications/read-all`, {
    method: 'POST',
    headers: headers(),
  });
  if (!r.ok) return 0;
  const body = await r.json();
  return body.marked_read || 0;
}

export interface QueueExecution {
  id: string;
  action_name: string;
  status: string;
  current_stage?: string | null;
  assigned_to_user_id?: string | null;
  assigned_to_email?: string | null;
  requester_user_id?: string | null;
  requester_email?: string | null;
  options_count: number;
  selected_option_ids: string[];
  created_at?: string | null;
}

export async function listQueue(opts: {
  assignedTo?: 'me' | 'unassigned' | 'anyone';
  stage?: string;
} = {}): Promise<QueueExecution[]> {
  const params = new URLSearchParams();
  params.set('assigned_to', opts.assignedTo || 'anyone');
  if (opts.stage) params.set('stage', opts.stage);
  const r = await fetch(`${ONTOLOGY_API}/workflow/queue?${params.toString()}`, {
    headers: headers(),
  });
  if (!r.ok) return [];
  const body = await r.json();
  return body.executions || [];
}
