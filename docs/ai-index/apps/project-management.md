# project-management-service (port 9000)

**Purpose:** MAIC's task boards. Companies, team members, projects, kanban-style stages, tasks. Emits events for process mining.
**Stack:** Python FastAPI, SQLAlchemy async, asyncpg, JSONB-heavy schemas.
**Path:** `/Users/ishmontalvo/Desktop/nexus-new-origins/nexus-apps/project-management-service/`

## Files

```
project-management-service/
├── main.py             FastAPI; mounts /projects router
├── database.py         ORM: CompanyRow, TeamMemberRow, ProjectRow, ProjectStageRow, UserRow (JSONB-flex)
├── routers/
│   └── projects.py     All endpoints. Default 5-stage kanban. Event emission to event-log-service.
├── Dockerfile
└── requirements.txt
```

## Tables (JSONB-flex)

```
companies:        id PK, tenant_id, data JSONB ({name, color, description, createdAt})
team_members:     id PK, tenant_id, data JSONB ({name, role (pm|dev|qa|ux|explorer|analyst|other), email, color, createdAt})
projects:         id PK, tenant_id, data JSONB ({name, description, companyId, pmId, status (active|completed|archived), createdAt})
project_stages:   id PK, project_id, tenant_id, data JSONB ({name, stageType, order, color, progress, comments[]})
users:            id PK, tenant_id, email, timestamps
```

## Endpoints

### Companies

`GET/POST /projects/companies`, `PUT/DELETE /projects/companies/{cid}`.

### Team members

`GET/POST /projects/team-members`, `PUT/DELETE /projects/team-members/{mid}`.

### Projects

`GET/POST /projects` (filter `?company=...`), `PUT/DELETE /projects/{pid}`.

### Stages (kanban) + Tasks

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/projects/{pid}/stages` | List. |
| POST | `/projects/{pid}/stages` | Create. |
| PUT | `/projects/{pid}/stages/{sid}` | Update (progress, comments). |
| DELETE | `/projects/{pid}/stages/{sid}` | 204. |
| POST | `/projects/{pid}/stages/{sid}/tasks` | Create task card. |
| PUT | `/projects/{pid}/stages/{sid}/tasks/{tid}` | Move task between stages. |

## Defaults

```python
DEFAULT_STAGES = [
  {"name": "Discovery",    "order": 0, "color": "#7C3AED"},
  {"name": "HUs",          "order": 1, "color": "#2563EB"},
  {"name": "UX & Screens", "order": 2, "color": "#DB2777"},
  {"name": "Development",  "order": 3, "color": "#059669"},
  {"name": "Entrega",      "order": 4, "color": "#D97706"},
]
```

## Event emission

```python
EVENT_LOG_URL = os.environ.get("EVENT_LOG_SERVICE_URL", "http://event-log-service:8005")

async def _emit(case_id, activity, tenant_id, attributes=None):
    await client.post(f"{EVENT_LOG_URL}/events", json={...})
```

Activities emitted: `project_created`, `stage_transitioned`, `task_commented`.

## Env

`DATABASE_URL`, `EVENT_LOG_SERVICE_URL`, `ALLOWED_ORIGINS`.

## When to edit

| Intent | File |
|--------|------|
| Customize default stages | `routers/projects.py:DEFAULT_STAGES`. |
| Add team-member role | extend `role` enum in `routers/projects.py:TeamMemberIn`. |
| Move JSONB field to column (for indexing) | `database.py` add column + migration + update routers. |
| Index on JSONB field | `database.py` raw `CREATE INDEX ... ((data->>'status'))`. |
| Add new emitted activity | `routers/projects.py:_emit()` calls. |
| Audit who-changed-what | new `project_audits` table or push to audit-service. |
