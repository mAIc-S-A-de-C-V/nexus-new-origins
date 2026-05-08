# audit-service (port 8006)

**Purpose:** Immutable audit trail (ISO 27001 A.8.15), justification gates ("checkpoints"), multi-step approval workflows.
**Stack:** Python FastAPI, SQLAlchemy async, asyncpg.
**Path:** `/Users/ishmontalvo/Desktop/nexus-new-origins/backend/audit_service/`

## Files

```
audit_service/
├── main.py                FastAPI; init_db; _audit_retention_loop (daily, AUDIT_RETENTION_DAYS=365)
├── database.py            ORM: AuditEventRow, CheckpointDefinitionRow, CheckpointResponseRow, ApprovalWorkflowRow, ApprovalRequestRow
├── routers/
│   ├── audit.py           Event ingestion + querying + summary
│   ├── checkpoints.py     Justification-gate evaluate + respond + responses
│   └── approvals.py       Multi-step workflow CRUD + approve/reject
├── requirements.txt
└── Dockerfile
```

## Tables

| Table | Purpose |
|-------|---------|
| `audit_events` | id, tenant_id, actor_id, actor_role, action, resource_type, resource_id, before_state JSONB, after_state JSONB, ip_address, user_agent, occurred_at, success, error_message |
| `checkpoint_definitions` | name, prompt_text, applies_to JSONB ([{resource_type, operations[]}]), applies_to_roles, enabled |
| `checkpoint_responses` | checkpoint_id, user_id, resource_type, resource_id, operation, justification, token UNIQUE (one-time auth), token_expires_at, responded_at |
| `approval_workflows` | name, resource_type (object_type/pipeline/agent), operations JSONB, required_approvers, eligible_roles, expiry_hours (72) |
| `approval_requests` | workflow_id, resource_type, resource_id, operation, payload JSONB (data being modified), requested_by, status (pending/approved/rejected/expired), approvals[], rejections[], expires_at, executed_at |

## Endpoints

### `/audit` (`routers/audit.py`)

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/audit/events` | Filter actor_id, resource_type, resource_id, action, time range. |
| POST | `/audit/events` | **Internal.** Header `x-internal: nexus-internal` + `x-service-name`. INSERT. |
| GET | `/audit/summary` | Stats by resource_type + actor + failure_count. |

### `/audit/checkpoints` (`routers/checkpoints.py`)

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/audit/checkpoints/evaluate` | Body `{resource_type, operation, user_role}` → `{required, checkpoint_id?, prompt_text?}`. |
| POST | `/audit/checkpoints/{id}/respond` | Body `{resource_type, resource_id, operation, justification, user_id, user_email}` → returns one-time token (10-min TTL). |
| GET | `/audit/checkpoints/{id}/responses` | Admin review. |

Frontend flow: prompt user → submit justification → receive token → use token header on actual destructive operation.

### `/audit/approvals` (`routers/approvals.py`)

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/audit/approvals/workflows` | Define workflow. |
| POST | `/audit/approvals/requests` | Submit request with full payload. |
| POST | `/audit/approvals/requests/{id}/approve` | Append approval; auto-execute when `len(approvals) >= required_approvers`. |
| POST | `/audit/approvals/requests/{id}/reject` | Status → rejected. |

## Cross-service callers

- auth-service POSTs login.success/login.failed/login.mfa_failed.
- All write services SHOULD POST audit events (currently fire-and-forget from ontology-service/event_emit.py).

## Env

`DATABASE_URL`, `AUDIT_RETENTION_DAYS` (365), `ALLOWED_ORIGINS`, `SKIP_AUTH`.

## When to edit

| Intent | File |
|--------|------|
| Add audit event encryption / HMAC signing | `routers/audit.py` POST handler. |
| Implement event tamper detection | hash chain column on `audit_events`. |
| Threshold-gated checkpoints | `routers/checkpoints.py:evaluate` (e.g. only if N records). |
| AI-validated justifications | `routers/checkpoints.py:respond` — call inference-service. |
| Auto-approval for low-risk ops | `routers/approvals.py:create_request`. |
| Approval escalation chains | `approval_workflows.escalation_chain` JSONB column. |
| Change retention | env `AUDIT_RETENTION_DAYS`. |
