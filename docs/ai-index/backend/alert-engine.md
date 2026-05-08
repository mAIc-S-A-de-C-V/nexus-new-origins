# alert-engine (port 8010)

**Purpose:** Rule-based alerting on process mining anomalies. Periodic evaluation, multi-channel delivery (Slack / email / webhooks).
**Stack:** Python FastAPI, SQLAlchemy async, APScheduler.
**Path:** `/Users/ishmontalvo/Desktop/nexus-new-origins/backend/alert_engine/`

## Files

```
alert_engine/
├── main.py             FastAPI lifespan: init_db + start_scheduler / stop_scheduler
├── database.py         alert_rules, alert_notifications, alert_webhooks, alert_rule_last_fired, alert_channels
├── scheduler.py        APScheduler periodic rule evaluator
├── evaluator.py        _eval_stuck_case, _eval_slow_transition, _eval_rework_spike, _eval_case_volume_anomaly
├── webhooks.py         deliver_to_webhooks() with HMAC-SHA256 signature
├── auth_middleware.py  Local copy of shared
├── routers/
│   ├── rules.py        Rule CRUD
│   ├── channels.py     Email/Slack channel config + /test
│   └── notifications.py History, mark-read, snooze
├── requirements.txt
└── Dockerfile
```

## Tables

| Table | Purpose |
|-------|---------|
| `alert_rules` | tenant_id, name, rule_type, object_type_id, process_id, config JSONB, enabled, cooldown_minutes (60) |
| `alert_notifications` | rule_id, severity (critical/warning/info), message, details JSONB, run_link JSONB, read, snoozed_until, fired_at |
| `alert_webhooks` | url, secret, enabled (per-tenant) |
| `alert_rule_last_fired` | rule_id PK, fired_at |
| `alert_channels` | tenant_id UNIQUE, email_enabled, email_recipients, slack_enabled, slack_webhook_url |

## Rule types

| Type | Config | Detection |
|------|--------|-----------|
| `stuck_case` | `{threshold_hours, object_type_id}` | Cases whose latest event is older than N hours |
| `slow_transition` | `{from_activity, to_activity, threshold_hours}` | Transitions exceeding N hours |
| `rework_spike` | `{spike_multiplier: 2.0}` | Rework rate ≥ baseline × multiplier |
| `case_volume_anomaly` | `{stddev_threshold: 2.0}` | Volume ≥ mean + N×stddev |

## Endpoints

### `/alerts/rules`

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/alerts/rules` | List with last_fired. |
| POST | `/alerts/rules` | Create rule. Validates `rule_type` ∈ `VALID_RULE_TYPES`. |
| PATCH | `/alerts/rules/{id}` | Update. |
| DELETE | `/alerts/rules/{id}` | 204. |

### `/alerts/channels`

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/alerts/channels` | Tenant's channel config. |
| PUT | `/alerts/channels` | Upsert. |
| POST | `/alerts/channels/test` | Send test message. Slack: POST to webhook. Email: not yet implemented. |

### `/alerts/notifications`

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/alerts/notifications` | Paginated, filter by rule_id/severity/read. |
| PATCH | `/alerts/notifications/{id}` | Mark read / snooze. |

## Scheduler

Periodic evaluator (~30s default per rule). For each enabled rule: skip if `now - last_fired < cooldown_minutes`. Else call `_eval_<type>(rule, ts)`. On positive: insert `alert_notifications` row, update `alert_rule_last_fired`, `deliver_to_webhooks()`.

## Cross-service

- Reads TimescaleDB `events` table (via `TIMESCALE_URL`) for rule SQL.
- POST to tenant Slack webhooks + arbitrary `alert_webhooks`.

## Env

`DATABASE_URL`, `TIMESCALE_URL`, `AUTH_SERVICE_URL`, `SKIP_AUTH`, `ALLOWED_ORIGINS`.

## When to edit

| Intent | File |
|--------|------|
| Add new rule type | `routers/rules.py:VALID_RULE_TYPES` + `evaluator.py:_eval_<new>` + frontend store. |
| Implement email delivery | `routers/channels.py` test (`# not_implemented`) + `webhooks.py` SMTP path. |
| Add PagerDuty/Teams channel | `alert_channels` columns + `routers/channels.py` + delivery in `webhooks.py`. |
| Webhook retry with backoff | `webhooks.py:deliver_to_webhooks()` (currently fire-and-forget). |
| Rule cloning | new `POST /alerts/rules/{id}/clone`. |
| Distributed scheduling (Redis) | `scheduler.py` — replace in-memory APScheduler. |
