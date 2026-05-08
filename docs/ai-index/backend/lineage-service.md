# lineage-service (port 8017)

**Purpose:** Read-only aggregator that builds a 6-layer data-lineage graph by querying every other service. No DB. Annotates nodes with health (stale/fresh).
**Stack:** Python FastAPI, httpx.
**Path:** `/Users/ishmontalvo/Desktop/nexus-new-origins/backend/lineage_service/`

## Files

```
lineage_service/
├── main.py             FastAPI; mounts /lineage router
├── routers/
│   └── lineage.py      Graph + upstream/downstream/impact endpoints
├── aggregator.py       LineageAggregator.build() — fan-out queries to all services, build nodes + edges
├── health_checker.py   check_health() per node type
├── requirements.txt
└── Dockerfile
```

## Endpoints (all GET)

| Path | Purpose |
|------|---------|
| `/lineage/graph` | Full graph `{nodes, edges}`. |
| `/lineage/graph/health` | Same with `health` metadata per node. |
| `/lineage/node/{id}/upstream` | BFS upstream — nodes feeding into this. |
| `/lineage/node/{id}/downstream` | BFS downstream — nodes this feeds into. |
| `/lineage/impact/{id}` | Downstream blast radius `{affected_count, affected_nodes, by_type}`. |

## 6 layers

1. **Connectors** — `connector:{id}` (status, type, last_sync).
2. **Pipelines** — `pipeline:{id}` (status, last_run_at, last_run_row_count).
3. **Object Types** — `objecttype:{id}` (record_count, property_count).
4. **Logic Functions** — `logic_func:{id}`.
5. **Agents** — `agent:{id}`.
6. **Actions** — `action:{id}`.

Edges:
- Connector → Pipeline (from SOURCE node `connector_id`).
- Pipeline → ObjectType (from SINK_OBJECT).
- ObjectType → Logic Function (from function inputs).
- Logic Function → Logic Flow (DAG edges).
- Logic Flow → Agent (knowledge scope).
- Agent → Action (proposed).

## Health (`health_checker.py`)

| Node type | Stale criterion |
|-----------|-----------------|
| connector | `last_sync` > 25h ago |
| pipeline | `last_run_at` > 25h ago |
| agent | `enabled` flag |
| object_type | `record_count > 0` |

Returns `{status, stale, last_activity, age_hours}`.

## Cross-service (all GET, parallel)

| → | URL |
|---|-----|
| connector-service | `/connectors` |
| pipeline-service | `/pipelines` |
| ontology-service | `/object-types`, `/actions` |
| logic-service | `/logic/functions`, `/logic/flows` |
| agent-service | `/agents` |

All with `x-tenant-id`.

## Env

`CONNECTOR_SERVICE_URL`, `PIPELINE_SERVICE_URL`, `ONTOLOGY_SERVICE_URL`, `LOGIC_SERVICE_URL`, `AGENT_SERVICE_URL`, `SKIP_AUTH`.

## When to edit

| Intent | File |
|--------|------|
| Add a new layer (e.g., `quality_rule`) | `aggregator.py:build()` query + node/edge construction. |
| New edge type | `aggregator.py:build()`. |
| Tune freshness thresholds | `health_checker.py`. |
| Add path tracing endpoint | `routers/lineage.py:GET /lineage/path/{from}/{to}`. |
| Cache graph | wrap `LineageAggregator.build()` in `shared/query_cache.get_or_compute()`. |
