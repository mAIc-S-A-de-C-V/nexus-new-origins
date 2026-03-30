You are building a Nexus Origins-native application. Follow these rules:

## PLATFORM CONTEXT
Nexus Origins is an enterprise data integration platform with 8 microservices:
- Connector Service (:8001) — API credential management and schema discovery
- Pipeline Service (:8002) — DAG executor (SOURCE → transforms → SINK) with built-in scheduler
- Inference Service (:8003) — Claude AI for semantic type detection
- Ontology Service (:8004) — Versioned object types, records, links, and app registry
- Event Log Service (:8005) — Process mining event store (case/activity/timestamp)
- Audit Service (:8006) — Immutable audit trail
- Schema Registry (:8007) — Raw schema versioning
- Correlation Engine (:8008) — Cross-source entity resolution

## RULE 1: EVENT-FIRST DESIGN
Before writing any route, define:
1. case_id — the primary entity being tracked over time (project_id, incident_id, order_id)
2. activities — named state transitions (PROJECT_CREATED, STAGE_MOVED, COMMENT_ADDED)
3. timestamps — when each transition happened
4. attributes — who did it, from what state, to what state

Every meaningful state change MUST emit an event asynchronously to the Event Log Service.
Event log failures must never block the response (always fire-and-forget with try/except).

## RULE 2: CONNECTOR-READY APIs
Every entity needs:
- A flat list endpoint: GET /entities (returns array, supports ?updated_after=ISO for incremental sync)
- A detail lookup: GET /entities?id={id} (for ENRICH node per-row calls)
- Pagination: ?page=N&limit=100
- Always include: id, created_at, updated_at on every record

## RULE 3: ONTOLOGICAL THINKING
For every entity, define:
- Primary key field (semantic type: IDENTIFIER)
- Status field if it has states (semantic type: STATUS)
- All timestamp fields (semantic type: DATETIME or DATE)
- PII fields (PERSON_NAME, EMAIL → pii_level: HIGH)
- Foreign keys to related objects (semantic type: IDENTIFIER)

## RULE 4: TENANT ISOLATION
Every route reads x-tenant-id from header:
```python
def _tid(x_tenant_id: Optional[str]) -> str:
    return x_tenant_id or "tenant-001"
```
All DB queries must be scoped: WHERE tenant_id = tid

## RULE 5: ASYNC SQLALCHEMY PATTERN
Always use async SQLAlchemy with AsyncSession.
Use flag_modified(row, "data") when mutating JSONB fields.
Use uuid4() for all IDs. Store ISO timestamps (datetime.now(timezone.utc).isoformat()).

## RULE 6: PIPELINE DESIGN
When designing pipelines for your app:
- SOURCE → SINK_OBJECT for simple entities
- SOURCE → ENRICH → SINK_OBJECT when list + detail endpoints exist
- Add SINK_EVENT after SINK_OBJECT for entities that participate in process mining
- Set pollFrequency on SOURCE: 5m for real-time, 1h for hourly, 1d for daily

## EVENT EMISSION TEMPLATE
```python
async def emit_event(case_id, activity, object_type_id, object_id, tenant_id, attributes=None):
    try:
        async with httpx.AsyncClient(timeout=3.0) as client:
            await client.post("http://event-log-service:8005/events", json={
                "id": str(uuid4()),
                "case_id": case_id,
                "activity": activity,
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "object_type_id": object_type_id,
                "object_id": object_id,
                "pipeline_id": "",
                "connector_id": "",
                "tenant_id": tenant_id,
                "attributes": attributes or {},
            })
    except Exception:
        pass  # never block on event log

# In every state-changing route:
asyncio.create_task(emit_event(...))
```

## RULE 7: MICROSERVICE STRUCTURE
Every Nexus app is its own microservice. When creating one:

**Folder layout:**
```
backend/my_app_service/
  __init__.py
  main.py          # FastAPI app + startup hook calling init_db()
  database.py      # SQLAlchemy Row classes + get_session + init_db
  Dockerfile       # built from backend/ context (not my_app_service/)
  requirements.txt # fastapi, uvicorn, sqlalchemy[asyncio], asyncpg, pydantic, httpx
  routers/
    __init__.py
    entities.py    # one file per entity group
```

**Database pattern (JSONB Row):**
- Every entity has a Row class: `id`, `tenant_id`, indexed FK columns, `data` JSON column
- `data` column holds the full object as JSON — no schema migrations needed for new fields
- CRITICAL: call `attributes.flag_modified(row, "data")` before commit when mutating JSON in place
- Tables auto-create on startup via `Base.metadata.create_all`
- Prefix table names with app name: `my_app_projects`, `my_app_stages` (avoids collisions)

**Dockerfile — always build from backend/ context:**
```dockerfile
FROM python:3.12-slim
WORKDIR /app
COPY my_app_service/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY shared/ ./shared/
COPY my_app_service/ .
EXPOSE 9000
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "9000"]
```

**docker-compose.yml entry:**
```yaml
my-app-service:
  build:
    context: ./backend
    dockerfile: my_app_service/Dockerfile
  ports: ["9000:9000"]
  environment:
    - DATABASE_URL=postgresql+asyncpg://nexus:nexus_pass@postgres:5432/nexus
    - EVENT_LOG_SERVICE_URL=http://event-log-service:8005
  depends_on:
    postgres: { condition: service_healthy }
  networks: [nexus-net]
  command: uvicorn main:app --host 0.0.0.0 --port 9000 --reload
```

**Inter-service calls — always use httpx with timeout, always forward x-tenant-id:**
```python
async with httpx.AsyncClient(timeout=10.0) as client:
    resp = await client.get(f"{OTHER_SERVICE_URL}/endpoint", headers={"x-tenant-id": tid})
```
Never use localhost for inter-service calls inside Docker — use the service name (e.g. http://ontology-service:8004).

## WHAT TO BUILD
When given an application to build, produce in order:
1. Entity list with semantic types and PII classification
2. Event emission plan (case_id, all activities, key attributes)
3. Full API surface (list + detail + CRUD)
4. FastAPI router code with event emission
5. Connector configuration table (what to create in Nexus)
6. Pipeline topology (node types and config)
7. Ontological object type definitions (properties + links)
