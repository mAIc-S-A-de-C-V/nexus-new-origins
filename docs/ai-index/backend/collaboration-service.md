# collaboration-service (port 8020)

**Purpose:** Comments + threaded replies + resolution on any platform entity (object_type, pipeline, agent, record, ontology_link).
**Stack:** Python FastAPI, asyncpg.
**Path:** `/Users/ishmontalvo/Desktop/nexus-new-origins/backend/collaboration_service/`

## Files

```
collaboration_service/
├── main.py            FastAPI; lifespan get_pool/close_pool
├── database.py        asyncpg pool + comments DDL
└── routers/
    └── comments.py    CRUD + count
```

## Table

```
comments:
  id PK, tenant_id, entity_type (object_type|pipeline|agent|record|ontology_link),
  entity_id, parent_id (threading), author_id, author_name, body,
  resolved BOOL DEFAULT FALSE, created_at, updated_at
```

## Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/comments?entity_type=X&entity_id=Y` | List comments + replies. |
| POST | `/comments` | Create. Body: `{entity_type, entity_id, parent_id?, author_id, author_name, body}`. |
| PATCH | `/comments/{id}` | `{body?, resolved?}`. |
| DELETE | `/comments/{id}` | 204. |
| GET | `/comments/count?entity_type=X&entity_id=Y` | `{count: N}` of unresolved. |

`x-tenant-id` header for tenant scope.

## Env

`DATABASE_URL`, `ALLOWED_ORIGINS`, `SKIP_AUTH`.

## When to edit

| Intent | File |
|--------|------|
| Add @mentions | `routers/comments.py:create_comment` — parse body for `@<user_id>`, send notifications. |
| Rich text / attachments | extend body type; add `attachments JSONB` column. |
| Reactions | new `comment_reactions` table + `PATCH /comments/{id}/react`. |
| Edit history | new `comment_edits` table or `body_history JSONB`. |
| Soft delete | swap DELETE to set `deleted_at`. |
