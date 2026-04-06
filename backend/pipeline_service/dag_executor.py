"""
DAG Executor — walks the pipeline DAG topology and executes each node on real records.

Connectors are the raw sources. Pipelines transform the data. Object types are the output.

SOURCE     → fetches real rows from the connector service
ENRICH     → per-row lookup against a second connector (fan-out detail calls)
MAP        → field renaming and transforms on actual records
FILTER     → drops rows that don't match a condition
DEDUPE     → deduplicates by primary key field
CAST       → type coercion on field values
FLATTEN    → explodes an array field into one row per item
VALIDATE   → drops rows missing required fields
SINK_OBJECT → pushes transformed records directly to the ontology ingest endpoint
SINK_EVENT  → converts records into process mining events and writes to event-log
"""
import asyncio
import os
import re
import httpx
from datetime import datetime, timezone
from uuid import uuid4
from typing import Any
from shared.models import Pipeline
from shared.enums import PipelineStatus, NodeType

ONTOLOGY_API = os.environ.get("ONTOLOGY_SERVICE_URL", "http://ontology-service:8004")
EVENT_LOG_API = os.environ.get("EVENT_LOG_SERVICE_URL", "http://event-log-service:8005")
CONNECTOR_API = os.environ.get("CONNECTOR_SERVICE_URL", "http://connector-service:8001")


def _resolve_date_templates(params: dict, last_sync=None) -> dict:
    """Inline resolution of date templates in query params for pipeline executor."""
    from datetime import timedelta
    now = datetime.now(timezone.utc)

    def fmt(dt, f):
        return (f.replace('YYYY', dt.strftime('%Y')).replace('MM', dt.strftime('%m'))
                 .replace('DD', dt.strftime('%d')).replace('HH', dt.strftime('%H'))
                 .replace('mm', dt.strftime('%M')).replace('ss', dt.strftime('%S')))

    result = {}
    for k, v in params.items():
        s = str(v)
        m = re.match(r'^\{\{\$today:(.+)\}\}$', s)
        if m:
            result[k] = fmt(now, m.group(1)); continue
        m = re.match(r'^\{\{\$daysAgo:(\d+):(.+)\}\}$', s)
        if m:
            result[k] = fmt(now - timedelta(days=int(m.group(1))), m.group(2)); continue
        m = re.match(r'^\{\{\$lastRun:(.+)\}\}$', s)
        if m:
            dt = last_sync if last_sync else (now - timedelta(days=7))
            result[k] = fmt(dt, m.group(1)); continue
        result[k] = s
    return result


async def _touch_connector_last_sync(connector_id: str, tenant_id: str):
    """Fire-and-forget: mark the connector's last_sync = now after a successful pipeline run."""
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            await client.patch(
                f"{CONNECTOR_API}/connectors/{connector_id}/last-sync",
                headers={"x-tenant-id": tenant_id},
            )
    except Exception:
        pass


# Max concurrent ENRICH calls per batch to avoid hammering the detail endpoint
_ENRICH_CONCURRENCY = 10


class NodeExecutionResult:
    def __init__(self, node_id: str, rows_in: int, rows_out: int, error: str | None = None):
        self.node_id = node_id
        self.rows_in = rows_in
        self.rows_out = rows_out
        self.error = error


class DagExecutor:
    """Topological DAG walker that executes pipeline nodes on real record data."""

    def _topological_sort(self, pipeline: Pipeline) -> list[str]:
        """Kahn's algorithm for topological sort."""
        adj: dict[str, list[str]] = {n.id: [] for n in pipeline.nodes}
        in_degree: dict[str, int] = {n.id: 0 for n in pipeline.nodes}

        for edge in pipeline.edges:
            adj[edge.source].append(edge.target)
            in_degree[edge.target] = in_degree.get(edge.target, 0) + 1

        queue = [nid for nid, deg in in_degree.items() if deg == 0]
        order = []

        while queue:
            node_id = queue.pop(0)
            order.append(node_id)
            for neighbor in adj.get(node_id, []):
                in_degree[neighbor] -= 1
                if in_degree[neighbor] == 0:
                    queue.append(neighbor)

        return order

    async def execute(
        self,
        pipeline: Pipeline,
        run: dict[str, Any],
        run_list: list[dict],
    ) -> None:
        """
        Execute the full pipeline DAG. Records flow through each node as real data.
        SINK_OBJECT pushes the final records directly to the ontology service.
        """
        try:
            order = self._topological_sort(pipeline)
            node_map = {n.id: n for n in pipeline.nodes}

            # When the pipeline has no explicit edges (step-list builder), synthesise
            # sequential edges so records flow from one step to the next in order.
            linear_mode = not pipeline.edges

            # Each node produces a list of real records
            node_records: dict[str, list[dict]] = {}
            # Per-node audit snapshots written into the run record
            node_audits: dict[str, dict] = {}
            source_row_count = 0
            synced_rows = 0

            for idx, node_id in enumerate(order):
                node = node_map.get(node_id)
                if not node:
                    continue

                if linear_mode:
                    # First node is always the source; every subsequent node gets
                    # the output of the previous node.
                    if idx == 0:
                        records_in: list[dict] = []
                        incoming_edges = []
                    else:
                        prev_id = order[idx - 1]
                        records_in = list(node_records.get(prev_id, []))
                        incoming_edges = [prev_id]  # truthy — not an empty list
                else:
                    incoming_edges = [e for e in pipeline.edges if e.target == node_id]
                    if not incoming_edges:
                        records_in = []
                    else:
                        records_in = []
                        for e in incoming_edges:
                            records_in.extend(node_records.get(e.source, []))

                t_start = datetime.now(timezone.utc)
                audit_extras: dict = {}
                records_out = await _execute_node(node, records_in, pipeline, audit_extras=audit_extras)
                duration_ms = int((datetime.now(timezone.utc) - t_start).total_seconds() * 1000)

                node_records[node_id] = records_out

                is_source_node = (linear_mode and idx == 0) or (not linear_mode and not incoming_edges)
                if is_source_node and records_out:
                    source_row_count = len(records_out)

                if node.type in (NodeType.SINK_OBJECT, NodeType.SINK_EVENT):
                    synced_rows = len(records_out)

                # ── Build per-node audit snapshot ──
                dropped = max(0, len(records_in) - len(records_out))

                # Node-specific stats
                stats: dict = {}
                cfg = node.config or {}
                if node.type == NodeType.FILTER:
                    stats = {"expression": cfg.get("expression", ""), "dropped": dropped}
                elif node.type == NodeType.MAP:
                    mappings = cfg.get("mappings")
                    if isinstance(mappings, str):
                        import json as _json
                        try: mappings = _json.loads(mappings)
                        except: mappings = {}
                    stats = {"mappings": mappings or {}}
                elif node.type == NodeType.ENRICH:
                    matched = len(records_out)
                    total = len(records_in)
                    stats = {
                        "match_rate": round(matched / total, 3) if total else 0,
                        "matched": matched,
                        "unmatched": total - matched,
                        "join_key": cfg.get("joinKey") or cfg.get("join_key", ""),
                    }
                elif node.type == NodeType.DEDUPE:
                    stats = {"duplicates_removed": dropped, "keys": cfg.get("keys", "")}
                elif node.type == NodeType.VALIDATE:
                    stats = {"invalid_dropped": dropped, "required_fields": cfg.get("requiredFields", [])}
                elif node.type == NodeType.CAST:
                    stats = {"casts": cfg.get("casts", {})}
                elif node.type == NodeType.FLATTEN:
                    stats = {"path": cfg.get("path", ""), "expanded_to": len(records_out)}
                elif node.type == NodeType.SINK_OBJECT:
                    stats = {"object_type_id": cfg.get("objectTypeId") or node.object_type_id or pipeline.target_object_type_id, "write_mode": cfg.get("write_mode", "upsert")}
                elif node.type == NodeType.SINK_EVENT:
                    stats = {"activity_field": cfg.get("activityField", ""), "case_id_field": cfg.get("caseIdField", "id"), "events_emitted": len(records_out)}
                elif node.type == NodeType.SOURCE:
                    stats = {
                        "connector_id": cfg.get("connectorId", ""),
                        "configured_endpoint": cfg.get("endpoint", ""),
                        "url": audit_extras.get("url", ""),
                        "http_status": audit_extras.get("http_status"),
                        "resolved_params": audit_extras.get("resolved_params", {}),
                        "raw_row_count": audit_extras.get("raw_row_count"),
                        "response_error": audit_extras.get("response_error"),
                        "error": audit_extras.get("error"),
                    }

                # Flatten sample rows: strip large nested arrays to keep payload small
                def _flatten_sample(rows: list[dict], n: int = 5) -> list[dict]:
                    out = []
                    for r in rows[:n]:
                        flat = {}
                        for k, v in r.items():
                            if isinstance(v, list):
                                flat[k] = f"[{len(v)} items]"
                            elif isinstance(v, dict):
                                flat[k] = "{...}"
                            else:
                                flat[k] = v
                        out.append(flat)
                    return out

                node_audits[node_id] = {
                    "node_id": node_id,
                    "node_type": node.type.value,
                    "node_label": node.label,
                    "rows_in": len(records_in),
                    "rows_out": len(records_out),
                    "dropped": dropped,
                    "duration_ms": duration_ms,
                    "started_at": t_start.isoformat(),
                    "sample_in": _flatten_sample(records_in),
                    "sample_out": _flatten_sample(records_out),
                    "stats": stats,
                }

            total_out = synced_rows or max((len(r) for r in node_records.values()), default=0)
            finished_at = datetime.now(timezone.utc).isoformat()

            run.update({
                "status": "COMPLETED",
                "finished_at": finished_at,
                "rows_in": source_row_count,
                "rows_out": total_out,
                "node_audits": node_audits,
            })

            pipeline.status = PipelineStatus.IDLE
            pipeline.last_run_at = datetime.now(timezone.utc)
            pipeline.last_run_row_count = total_out

            # Emit PIPELINE_COMPLETED event so it appears in the Event Log
            asyncio.create_task(_emit_pipeline_event(
                pipeline_id=pipeline.id,
                pipeline_name=pipeline.name,
                activity="PIPELINE_COMPLETED",
                timestamp=finished_at,
                rows_in=source_row_count,
                rows_out=total_out,
                status="COMPLETED",
            ))

        except Exception as e:
            finished_at = datetime.now(timezone.utc).isoformat()
            run.update({
                "status": "FAILED",
                "finished_at": finished_at,
                "error": str(e),
            })
            pipeline.status = PipelineStatus.FAILED

            asyncio.create_task(_emit_pipeline_event(
                pipeline_id=pipeline.id,
                pipeline_name=pipeline.name,
                activity="PIPELINE_FAILED",
                timestamp=finished_at,
                rows_in=0,
                rows_out=0,
                status="FAILED",
                error=str(e),
            ))


# ── Node Handlers ─────────────────────────────────────────────────────────────

async def _execute_node(node, records_in: list[dict], pipeline: Pipeline, audit_extras: dict | None = None) -> list[dict]:
    if node.type == NodeType.SOURCE:
        return await _source(node, pipeline, audit_extras=audit_extras)
    if node.type == NodeType.ENRICH:
        return await _enrich(node, records_in)
    if node.type == NodeType.MAP:
        return _map(node, records_in)
    if node.type == NodeType.FILTER:
        return _filter(node, records_in)
    if node.type == NodeType.DEDUPE:
        return _dedupe(node, records_in)
    if node.type == NodeType.CAST:
        return _cast(node, records_in)
    if node.type == NodeType.FLATTEN:
        return _flatten(node, records_in)
    if node.type == NodeType.VALIDATE:
        return _validate(node, records_in)
    if node.type == NodeType.SINK_OBJECT:
        return await _sink_object(node, records_in, pipeline)
    if node.type == NodeType.SINK_EVENT:
        return await _sink_event(node, records_in, pipeline)
    return records_in


async def _source(node, pipeline: Pipeline, audit_extras: dict | None = None) -> list[dict]:
    """
    Fetch real records from the configured connector.

    If the SOURCE node has an 'endpoint' config (e.g. '/users'), the pipeline
    makes a direct HTTP GET to {base_url}{endpoint} using the connector's
    credentials and returns all rows from the response.

    Falls back to the connector's /schema sample_rows when no endpoint is set.
    """
    cfg = node.config or {}
    connector_id = (
        cfg.get("connectorId")
        or cfg.get("connector_id")
        or node.connector_id
        or (pipeline.connector_ids[0] if pipeline.connector_ids else None)
    )
    if not connector_id:
        if audit_extras is not None:
            audit_extras["error"] = "No connector_id configured on SOURCE node"
        return []

    endpoint = (cfg.get("endpoint") or "").strip()
    batch_size = int(cfg.get("batchSize") or 500)

    # Always record the configured values so the audit panel shows something even on failure
    if audit_extras is not None:
        audit_extras["connector_id"] = connector_id
        audit_extras["configured_endpoint"] = endpoint

    try:
        async with httpx.AsyncClient(timeout=60) as client:
            # Fetch connector details (base_url + credentials)
            conn_r = await client.get(
                f"{CONNECTOR_API}/connectors/{connector_id}",
                headers={"x-tenant-id": pipeline.tenant_id},
            )
            if not conn_r.is_success:
                if audit_extras is not None:
                    audit_extras["error"] = f"Connector lookup failed: HTTP {conn_r.status_code}"
                return []

            conn = conn_r.json()
            base_url = (conn.get("base_url") or "").rstrip("/")
            credentials = conn.get("credentials") or {}
            conn_config = conn.get("config") or {}

            # Parse last_sync from connector details for template resolution
            raw_last_sync = conn.get("last_sync")
            last_sync_dt = None
            if raw_last_sync:
                try:
                    from datetime import datetime as _dt
                    last_sync_dt = _dt.fromisoformat(raw_last_sync.replace("Z", "+00:00"))
                except Exception:
                    pass

            if endpoint and base_url:
                # Build the URL and auth headers from the connector's credentials
                url = f"{base_url}{endpoint}"
                headers: dict[str, str] = {"Accept": "application/json"}

                # Resolve connector's configured queryParams (supports {{$lastRun}}, {{$today}}, etc.)
                raw_qp = {}
                if isinstance(conn_config.get("queryParams"), dict):
                    raw_qp = conn_config["queryParams"]
                params = _resolve_date_templates(raw_qp, last_sync=last_sync_dt)

                auth_type = credentials.get("auth_type") or credentials.get("type", "none")
                if auth_type == "api_key":
                    key_name = credentials.get("header_name", "X-API-Key")
                    headers[key_name] = credentials.get("api_key", "")
                elif auth_type == "bearer_token":
                    headers["Authorization"] = f"Bearer {credentials.get('token', '')}"
                elif auth_type == "basic":
                    import base64 as _b64
                    encoded = _b64.b64encode(
                        f"{credentials.get('username','')}:{credentials.get('password','')}".encode()
                    ).decode()
                    headers["Authorization"] = f"Basic {encoded}"

                # Support username/password basic auth stored directly in credentials
                if not credentials.get("auth_type") and credentials.get("username") and credentials.get("password"):
                    import base64 as _b64
                    encoded = _b64.b64encode(
                        f"{credentials['username']}:{credentials['password']}".encode()
                    ).decode()
                    headers["Authorization"] = f"Basic {encoded}"

                # Add any custom headers from connector config
                for extra_h in conn_config.get("headers", []):
                    if extra_h.get("key"):
                        headers[extra_h["key"]] = str(extra_h.get("value", ""))

                r = await client.get(url, headers=headers, params=params, timeout=60)
                if audit_extras is not None:
                    audit_extras["url"] = str(r.url)
                    audit_extras["http_status"] = r.status_code
                    audit_extras["resolved_params"] = dict(params)
                if r.is_success:
                    data = r.json()
                    rows = None
                    raw_count = None
                    if isinstance(data, list):
                        raw_count = len(data)
                        rows = data[:batch_size]
                    elif isinstance(data, dict):
                        for key in ("data", "results", "items", "records", "value", "rows"):
                            if isinstance(data.get(key), list):
                                raw_count = len(data[key])
                                rows = data[key][:batch_size]
                                break
                    if audit_extras is not None and raw_count is not None:
                        audit_extras["raw_row_count"] = raw_count
                    if rows is not None:
                        asyncio.create_task(_touch_connector_last_sync(connector_id, pipeline.tenant_id))
                        return rows
                elif audit_extras is not None:
                    audit_extras["response_error"] = r.text[:500]
                return []

            # No endpoint configured — use /schema which resolves templates via connector service
            schema_url = f"{CONNECTOR_API}/connectors/{connector_id}/schema"
            if audit_extras is not None:
                audit_extras["url"] = schema_url
                audit_extras["http_status"] = None
            r = await client.get(schema_url, headers={"x-tenant-id": pipeline.tenant_id})
            if audit_extras is not None:
                audit_extras["http_status"] = r.status_code
            if r.is_success:
                rows = r.json().get("sample_rows", [])
                if audit_extras is not None:
                    audit_extras["raw_row_count"] = len(rows)
                if rows:
                    asyncio.create_task(_touch_connector_last_sync(connector_id, pipeline.tenant_id))
                return rows
    except Exception as _exc:
        if audit_extras is not None:
            audit_extras["error"] = str(_exc)
    return []


async def _enrich(node, records_in: list[dict]) -> list[dict]:
    """
    Per-row detail lookup against a second connector.

    For each incoming row:
      1. Extract the join key value (e.g. row["id"] = "INC-123")
      2. POST /connectors/{lookupConnectorId}/fetch-row with {"params": {lookupField: "INC-123"}}
      3. Merge the detail response onto the row

    Config fields:
      lookupConnectorId  — the connector that holds the detail endpoint
      joinKey            — field on the incoming row whose value is passed as the lookup param
      lookupField        — query param name on the detail endpoint (defaults to joinKey)
    """
    cfg = node.config or {}
    lookup_connector_id = cfg.get("lookupConnectorId") or cfg.get("lookup_connector_id")
    join_key = cfg.get("joinKey") or cfg.get("join_key", "id")
    # The query param name on the detail endpoint — often same as join_key (e.g. "id")
    lookup_field = cfg.get("lookupField") or cfg.get("lookup_field") or join_key

    if not lookup_connector_id or not records_in:
        return records_in

    enriched: list[dict] = []

    async def _lookup_one(row: dict) -> dict:
        join_val = row.get(join_key)
        if join_val is None:
            return row
        try:
            async with httpx.AsyncClient(timeout=30) as client:
                r = await client.post(
                    f"{CONNECTOR_API}/connectors/{lookup_connector_id}/fetch-row",
                    json={"params": {lookup_field: str(join_val)}},
                    headers={"x-tenant-id": "tenant-001"},
                )
                if r.is_success:
                    detail = r.json().get("row", {})
                    return {**row, **detail}
        except Exception:
            pass
        return row

    # Run lookups in concurrent batches to avoid overwhelming the detail endpoint
    for i in range(0, len(records_in), _ENRICH_CONCURRENCY):
        batch = records_in[i:i + _ENRICH_CONCURRENCY]
        results = await asyncio.gather(*[_lookup_one(row) for row in batch])
        enriched.extend(results)

    return enriched


def _get_nested(record: dict, path: str) -> Any:
    """Resolve a dot-notation path against a nested dict (e.g. 'address.city')."""
    parts = path.split(".")
    val: Any = record
    for part in parts:
        if not isinstance(val, dict):
            return None
        val = val.get(part)
    return val


def _map(node, records_in: list[dict]) -> list[dict]:
    """Apply field renaming and transforms to each record.

    Supports two config shapes:
      1. mappings: {"source_field": "target_field", ...}   ← new Pipeline Builder format
         Dotted source paths (e.g. "address.city") are resolved against nested dicts.
         Only the mapped fields are kept in the output record.
      2. transforms: [{source_field, target_field, transform_type}]  ← legacy format
         All existing fields are kept; transforms add/rename specific fields.
    """
    import json as _json

    cfg = node.config or {}

    # ── New format: mappings dict ─────────────────────────────────────────────
    mappings_raw = cfg.get("mappings")
    if isinstance(mappings_raw, str):
        try:
            mappings_raw = _json.loads(mappings_raw)
        except Exception:
            mappings_raw = None
    if isinstance(mappings_raw, dict) and mappings_raw:
        result = []
        for rec in records_in:
            new_rec: dict = {}
            for src_path, tgt_field in mappings_raw.items():
                val = _get_nested(rec, src_path)
                if val is not None:
                    new_rec[str(tgt_field)] = val
            result.append(new_rec)
        return result

    # ── Legacy format: transforms array ───────────────────────────────────────
    transforms: list[dict] = list(cfg.get("transforms") or [])

    if not transforms:
        sf = cfg.get("sourceField") or cfg.get("source_field", "")
        tf = cfg.get("targetField") or cfg.get("target_field", "")
        tt = cfg.get("transformType") or cfg.get("transform_type", "")
        if sf and tf:
            transforms = [{"source_field": sf, "target_field": tf, "transform_type": tt}]

    if not transforms:
        jke = cfg.get("join_key_extraction")
        if jke:
            transforms = [{
                "source_field": jke.get("source_field", ""),
                "target_field": jke.get("output_field", "__join_key__"),
                "transform_type": jke.get("transform", ""),
            }]

    if not transforms:
        return records_in

    result = []
    for rec in records_in:
        for t in transforms:
            rec = _apply_transform(
                rec,
                t.get("source_field", ""),
                t.get("target_field", ""),
                t.get("transform_type", ""),
            )
        result.append(rec)
    return result


def _filter(node, records_in: list[dict]) -> list[dict]:
    """Drop rows that don't satisfy the configured condition."""
    cfg = node.config or {}
    field = cfg.get("field", "")
    operator = cfg.get("operator", "exists")
    value = cfg.get("value")

    if not field:
        return records_in

    result = []
    for rec in records_in:
        fval = rec.get(field)
        if operator == "exists":
            if fval is not None and fval != "" and fval != []:
                result.append(rec)
        elif operator == "not_null":
            if fval is not None:
                result.append(rec)
        elif operator == "eq":
            if str(fval) == str(value):
                result.append(rec)
        elif operator == "neq":
            if str(fval) != str(value):
                result.append(rec)
        elif operator == "contains":
            if value is not None and str(value) in str(fval or ""):
                result.append(rec)
        else:
            result.append(rec)
    return result


def _dedupe(node, records_in: list[dict]) -> list[dict]:
    """Deduplicate records by primary key field."""
    if not records_in:
        return records_in
    cfg = node.config or {}
    pk_field = cfg.get("pkField") or cfg.get("pk_field") or _guess_pk(records_in[0])
    seen: set[str] = set()
    result = []
    for rec in records_in:
        key = str(rec.get(pk_field, id(rec)))
        if key not in seen:
            seen.add(key)
            result.append(rec)
    return result


def _cast(node, records_in: list[dict]) -> list[dict]:
    """Coerce field values to specified types."""
    cfg = node.config or {}
    casts: list[dict] = cfg.get("casts") or []
    if not casts:
        return records_in
    result = []
    for rec in records_in:
        rec = dict(rec)
        for c in casts:
            field = c.get("field", "")
            to_type = c.get("to", "string")
            if field in rec and rec[field] is not None:
                try:
                    if to_type == "string":
                        rec[field] = str(rec[field])
                    elif to_type == "integer":
                        rec[field] = int(rec[field])
                    elif to_type == "float":
                        rec[field] = float(rec[field])
                    elif to_type == "boolean":
                        rec[field] = bool(rec[field])
                except (ValueError, TypeError):
                    pass
        result.append(rec)
    return result


def _flatten(node, records_in: list[dict]) -> list[dict]:
    """Explode an array field — one row per array item."""
    cfg = node.config or {}
    array_field = cfg.get("arrayField") or cfg.get("array_field", "")
    if not array_field:
        return records_in
    result = []
    for rec in records_in:
        arr = rec.get(array_field, [])
        if isinstance(arr, list) and arr:
            for item in arr:
                base = {k: v for k, v in rec.items() if k != array_field}
                if isinstance(item, dict):
                    base.update(item)
                else:
                    base[array_field] = item
                result.append(base)
        else:
            result.append(rec)
    return result


def _validate(node, records_in: list[dict]) -> list[dict]:
    """Drop rows that are missing any required field."""
    cfg = node.config or {}
    required_fields: list[str] = cfg.get("requiredFields") or cfg.get("required_fields") or []
    if not required_fields:
        return records_in
    return [rec for rec in records_in if all(rec.get(f) is not None for f in required_fields)]


async def _sink_object(node, records_in: list[dict], pipeline: Pipeline) -> list[dict]:
    """
    Push the pipeline's transformed records directly into the ontology as object records.
    Uses /records/ingest instead of /records/sync — the pipeline owns the data, not the connector.
    """
    cfg = node.config or {}
    ot_id = (cfg.get("objectTypeId") or cfg.get("object_type_id")
             or node.object_type_id or pipeline.target_object_type_id)

    if not ot_id or not records_in:
        return records_in

    # Array append write mode: attach records_in as a nested array on matching target records
    if cfg.get("write_mode") == "array_append":
        array_field = cfg.get("array_field", "meetings")
        merge_key = cfg.get("merge_key", "name")
        join_key = cfg.get("join_key", "__join_key__")

        # If records are flowing through the pipeline, use them (the correct path)
        if records_in:
            try:
                async with httpx.AsyncClient(timeout=60) as client:
                    resp = await client.post(
                        f"{ONTOLOGY_API}/object-types/{ot_id}/records/array-append",
                        json={
                            "array_field": array_field,
                            "merge_key": merge_key,
                            "join_key": join_key,
                            "records": records_in,
                        },
                        headers={"x-tenant-id": "tenant-001"},
                    )
            except Exception:
                pass
        else:
            # Fallback: re-fetch from connector schema (legacy path)
            await _execute_array_append(
                pipeline=pipeline,
                ot_id=ot_id,
                array_field=array_field,
                merge_key=merge_key,
            )
        return records_in

    # ── Apply pre-write filter conditions ────────────────────────────────────
    raw_conditions = cfg.get("filterConditions")
    if isinstance(raw_conditions, str) and raw_conditions.strip():
        import json as _json
        try:
            raw_conditions = _json.loads(raw_conditions)
        except Exception:
            raw_conditions = []
    if isinstance(raw_conditions, list) and raw_conditions:
        records_in = [r for r in records_in if _apply_conditions(r, raw_conditions)]
    if not records_in:
        return []

    pk_field = _guess_pk(records_in[0]) if records_in else "id"

    # ── Fetch existing records to diff (Celonis-style record-level events) ──
    existing_by_pk: dict[str, dict] = {}
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            r = await client.get(
                f"{ONTOLOGY_API}/object-types/{ot_id}/records",
                headers={"x-tenant-id": "tenant-001"},
            )
            if r.is_success:
                for rec in r.json().get("records", []):
                    key = str(rec.get(pk_field, ""))
                    if key:
                        existing_by_pk[key] = rec
    except Exception:
        pass

    # ── Skip diff-based events if a SINK_EVENT node already handles process events ──
    has_sink_event_node = pipeline.nodes and any(
        (getattr(_n, "type", None) or (_n.get("type") if isinstance(_n, dict) else None)) == "SINK_EVENT"
        for _n in pipeline.nodes
    )
    if has_sink_event_node:
        # SINK_EVENT node will emit proper stage-transition events — don't double-emit from SINK_OBJECT
        try:
            async with httpx.AsyncClient(timeout=120) as client:
                resp = await client.post(
                    f"{ONTOLOGY_API}/object-types/{ot_id}/records/ingest",
                    json={"records": records_in, "pk_field": pk_field, "pipeline_id": pipeline.id},
                    headers={"x-tenant-id": "tenant-001"},
                )
        except Exception:
            pass
        return records_in

    # ── Build per-record events with field-level diffs ──
    connector_id = pipeline.connector_ids[0] if pipeline.connector_ids else ""
    record_events: list[dict] = []
    fallback_now = datetime.now(timezone.utc).isoformat()

    # Fields that carry the record's own business timestamps (tried in order)
    _RECORD_TS_FIELDS = [
        "hs_lastmodifieddate", "lastmodifieddate", "updatedAt", "updated_at",
        "createdate", "createdAt", "created_at", "timestamp", "date",
    ]
    _RECORD_CREATED_TS_FIELDS = [
        "createdate", "createdAt", "created_at", "hs_createdate",
        "hs_lastmodifieddate", "lastmodifieddate",
    ]

    # Which field's value should become the activity name (e.g. "dealstage")
    # Check: (1) sink node config, (2) any SINK_EVENT node on the same pipeline,
    #         (3) auto-detect common stage/status field names from the first record
    _AUTO_ACTIVITY_FIELDS = [
        "stage", "status", "dealstage", "deal_stage", "pipeline_stage",
        "hs_dealstage", "phase", "state", "step", "substatus",
    ]
    activity_field = cfg.get("activityField") or cfg.get("activity_field", "")
    if not activity_field and pipeline.nodes:
        for _n in pipeline.nodes:
            _ncfg = (_n.config or {}) if not isinstance(_n, dict) else (_n.get("config") or {})
            _af = _ncfg.get("activityField") or _ncfg.get("activity_field", "")
            if _af:
                activity_field = _af
                break
    if not activity_field and records_in:
        _sample = records_in[0]
        for _af in _AUTO_ACTIVITY_FIELDS:
            if _af in _sample and str(_sample.get(_af, "")).strip():
                activity_field = _af
                break

    def _record_timestamp(rec: dict, prefer_create: bool = False) -> str:
        fields = _RECORD_CREATED_TS_FIELDS if prefer_create else _RECORD_TS_FIELDS
        for f in fields:
            v = rec.get(f)
            if v and str(v).strip() not in ("", "None", "null"):
                return str(v)
        return fallback_now

    for rec in records_in:
        pk_val = str(rec.get(pk_field, ""))
        if not pk_val:
            continue

        existing = existing_by_pk.get(pk_val)
        if existing is None:
            # Brand-new record — use createdate when available
            ts = _record_timestamp(rec, prefer_create=True)
            # If activityField is set and the field has a value, use it as the activity
            if activity_field and rec.get(activity_field):
                activity_name = str(rec[activity_field]).upper().replace(" ", "_")
            else:
                activity_name = "RECORD_CREATED"
            record_events.append({
                "id": str(uuid4()),
                "case_id": pk_val,
                "activity": activity_name,
                "timestamp": ts,
                "object_type_id": ot_id,
                "object_id": pk_val,
                "pipeline_id": pipeline.id,
                "connector_id": connector_id,
                "tenant_id": "tenant-001",
                "attributes": {
                    "pk_field": pk_field,
                    "record_snapshot": {k: v for k, v in rec.items() if not isinstance(v, (list, dict))},
                },
            })
        else:
            # Existing record — compute field-level diffs
            changed_fields = []
            for field, new_val in rec.items():
                if isinstance(new_val, (list, dict)):
                    continue
                old_val = existing.get(field)
                if str(old_val) != str(new_val):
                    changed_fields.append({"field": field, "from": old_val, "to": new_val})

            if not changed_fields:
                continue

            ts = _record_timestamp(rec, prefer_create=False)

            # Check if the activityField changed — if so, emit one event per stage transition
            if activity_field:
                activity_change = next(
                    (cf for cf in changed_fields if cf["field"] == activity_field), None
                )
                if activity_change:
                    # Emit the stage transition as the primary event
                    new_stage = str(activity_change["to"]).upper().replace(" ", "_")
                    record_events.append({
                        "id": str(uuid4()),
                        "case_id": pk_val,
                        "activity": new_stage,
                        "timestamp": ts,
                        "object_type_id": ot_id,
                        "object_id": pk_val,
                        "pipeline_id": pipeline.id,
                        "connector_id": connector_id,
                        "tenant_id": "tenant-001",
                        "attributes": {
                            "pk_field": pk_field,
                            "from_stage": activity_change["from"],
                            "to_stage": activity_change["to"],
                            "changed_fields": changed_fields,
                        },
                    })
                    # Emit per-field events for everything else that changed (excluding the activityField)
                    for cf in changed_fields:
                        if cf["field"] == activity_field:
                            continue
                        record_events.append({
                            "id": str(uuid4()),
                            "case_id": pk_val,
                            "activity": f"{cf['field'].upper()}_CHANGED",
                            "timestamp": ts,
                            "object_type_id": ot_id,
                            "object_id": pk_val,
                            "pipeline_id": pipeline.id,
                            "connector_id": connector_id,
                            "tenant_id": "tenant-001",
                            "attributes": {
                                "pk_field": pk_field,
                                "field": cf["field"],
                                "from": cf["from"],
                                "to": cf["to"],
                            },
                        })
                else:
                    # activityField didn't change — emit per-field events
                    for cf in changed_fields:
                        record_events.append({
                            "id": str(uuid4()),
                            "case_id": pk_val,
                            "activity": f"{cf['field'].upper()}_CHANGED",
                            "timestamp": ts,
                            "object_type_id": ot_id,
                            "object_id": pk_val,
                            "pipeline_id": pipeline.id,
                            "connector_id": connector_id,
                            "tenant_id": "tenant-001",
                            "attributes": {
                                "pk_field": pk_field,
                                "field": cf["field"],
                                "from": cf["from"],
                                "to": cf["to"],
                            },
                        })
            else:
                # No activityField configured — emit one RECORD_UPDATED per record (original behavior)
                record_events.append({
                    "id": str(uuid4()),
                    "case_id": pk_val,
                    "activity": "RECORD_UPDATED",
                    "timestamp": ts,
                    "object_type_id": ot_id,
                    "object_id": pk_val,
                    "pipeline_id": pipeline.id,
                    "connector_id": connector_id,
                    "tenant_id": "tenant-001",
                    "attributes": {
                        "pk_field": pk_field,
                        "changed_fields": changed_fields,
                        "fields_changed": len(changed_fields),
                    },
                })

    # ── Emit record-level events ──
    if record_events:
        try:
            async with httpx.AsyncClient(timeout=30) as client:
                for i in range(0, len(record_events), 200):
                    await client.post(
                        f"{EVENT_LOG_API}/events/batch",
                        json={"events": record_events[i:i + 200]},
                        headers={"x-tenant-id": "tenant-001"},
                    )
        except Exception:
            pass

    # ── Apply onConflict: skip records that already exist ────────────────────
    on_conflict = cfg.get("onConflict", "overwrite")
    if on_conflict == "skip" and existing_by_pk:
        records_in = [r for r in records_in if str(r.get(pk_field, "")) not in existing_by_pk]
    elif on_conflict == "preserve" and existing_by_pk:
        # Keep existing field values — only write fields not already present
        preserved = []
        for rec in records_in:
            pk_val = str(rec.get(pk_field, ""))
            existing = existing_by_pk.get(pk_val)
            if existing:
                merged = {**rec}
                for k, v in existing.items():
                    if v is not None and v != "":
                        merged[k] = v  # existing value wins
                preserved.append(merged)
            else:
                preserved.append(rec)
        records_in = preserved

    # ── Ingest records into ontology ──
    try:
        async with httpx.AsyncClient(timeout=120) as client:
            resp = await client.post(
                f"{ONTOLOGY_API}/object-types/{ot_id}/records/ingest",
                json={
                    "records": records_in,
                    "pk_field": pk_field,
                    "pipeline_id": pipeline.id,
                },
                headers={"x-tenant-id": "tenant-001"},
            )
    except Exception:
        pass

    # ── Update object type schema + link source ───────────────────────────────
    # Infer properties from the first record and add them to the object type,
    # then register this pipeline and connector as the authoritative source.
    if records_in:
        try:
            await _update_object_type_schema(
                ot_id=ot_id,
                sample=records_in[0],
                pipeline=pipeline,
                connector_id=connector_id or "",
            )
        except Exception:
            pass

    return records_in


async def _update_object_type_schema(
    ot_id: str,
    sample: dict,
    pipeline: "Pipeline",
    connector_id: str,
) -> None:
    """
    After a SINK_OBJECT ingest, update the object type's properties (schema)
    from the first mapped record and register the pipeline + connector as sources.
    This makes the object type card show the correct field count and source links.
    """
    import json as _json
    from uuid import uuid4 as _uuid4

    def _infer_semantic(name: str, val: Any) -> str:
        n = name.lower()
        if n.endswith("_id") or n == "id":
            return "IDENTIFIER"
        if "email" in n:
            return "EMAIL"
        if "phone" in n or "tel" in n:
            return "PHONE"
        if "url" in n or "website" in n or "link" in n:
            return "URL"
        if "date" in n or n.endswith("_at") or n.startswith("dt"):
            return "DATETIME"
        if "status" in n or "stage" in n or "state" in n:
            return "STATUS"
        if "name" in n:
            return "PERSON_NAME"
        if "address" in n or "street" in n or "city" in n or "zip" in n:
            return "ADDRESS"
        if isinstance(val, bool):
            return "BOOLEAN"
        if isinstance(val, (int, float)):
            return "QUANTITY"
        return "TEXT"

    def _infer_dtype(val: Any) -> str:
        if isinstance(val, bool):
            return "BOOLEAN"
        if isinstance(val, int):
            return "INTEGER"
        if isinstance(val, float):
            return "FLOAT"
        if isinstance(val, (dict, list)):
            return "JSON"
        return "TEXT"

    async with httpx.AsyncClient(timeout=30) as client:
        # 1. Fetch current object type
        r = await client.get(
            f"{ONTOLOGY_API}/object-types/{ot_id}",
            headers={"x-tenant-id": "tenant-001"},
        )
        if not r.is_success:
            return

        ot_data: dict = r.json()
        existing_prop_names: set[str] = {p["name"] for p in ot_data.get("properties", [])}

        # 2. Infer new properties from sample record (skip nested dicts/lists)
        new_props: list[dict] = []
        for field_name, field_val in sample.items():
            if field_name in existing_prop_names:
                continue
            if isinstance(field_val, (dict, list)):
                continue  # skip complex nested structures
            new_props.append({
                "id": str(_uuid4()),
                "name": field_name,
                "display_name": field_name.replace("_", " ").title(),
                "semantic_type": _infer_semantic(field_name, field_val),
                "data_type": _infer_dtype(field_val),
                "pii_level": "NONE",
                "required": False,
                "source_connector_id": connector_id or None,
                "sample_values": [str(field_val)[:64]] if field_val is not None else [],
            })

        # 3. Merge new properties and update source links
        updated_props = ot_data.get("properties", []) + new_props

        # Add connector to source_connector_ids if not already there
        src_ids: list[str] = list(ot_data.get("source_connector_ids", []))
        if connector_id and connector_id not in src_ids:
            src_ids.append(connector_id)

        ot_data["properties"] = updated_props
        ot_data["source_connector_ids"] = src_ids
        ot_data["source_pipeline_id"] = pipeline.id
        ot_data["version"] = ot_data.get("version", 1) + 1

        # 4. PUT the updated object type back
        await client.put(
            f"{ONTOLOGY_API}/object-types/{ot_id}",
            json=ot_data,
            headers={"x-tenant-id": "tenant-001"},
        )


async def _sink_event(node, records_in: list[dict], pipeline: Pipeline) -> list[dict]:
    """Convert records flowing through the pipeline into process mining events."""
    cfg = node.config or {}
    object_type_id = (
        cfg.get("objectTypeId")
        or node.object_type_id
        or pipeline.target_object_type_id
        or ""
    )
    case_id_field = cfg.get("caseIdField") or cfg.get("case_id_field", "id")
    activity_field = cfg.get("activityField") or cfg.get("activity_field", "")
    timestamp_field = cfg.get("timestampField") or cfg.get("timestamp_field", "")
    connector_id = pipeline.connector_ids[0] if pipeline.connector_ids else ""

    # If records are flowing through the pipeline, use them directly
    records = records_in if records_in else []

    # Fall back to fetching from ontology if no records came through (e.g. detached SINK_EVENT)
    if not records and object_type_id:
        written = await _emit_events_from_records(
            object_type_id=object_type_id,
            pipeline_id=pipeline.id,
            connector_ids=pipeline.connector_ids,
            case_id_field=case_id_field,
            activity_field=activity_field,
            timestamp_field=timestamp_field,
        )
        return [{}] * written

    if not records:
        return []

    def _pick_ts(record: dict, preferred: str) -> str:
        if preferred and record.get(preferred):
            return str(record[preferred])
        for key in ("createdate", "hs_lastmodifieddate", "closedate", "created_at",
                    "updated_at", "timestamp", "date", "occurred_at"):
            if record.get(key):
                return str(record[key])
        for key, val in record.items():
            if val and any(t in key.lower() for t in ("date", "time", "_at", "stamp")):
                return str(val)
        return datetime.now(timezone.utc).isoformat()

    def _pick_val(record: dict, field: str, fallback: str) -> str:
        if field and record.get(field) is not None:
            return str(record[field])
        return fallback

    events = []
    for record in records:
        case_id = _pick_val(record, case_id_field, str(record.get("id", str(uuid4()))))
        activity = _pick_val(record, activity_field, "RECORD_SYNCED")
        ts = _pick_ts(record, timestamp_field)

        if ts and ts.isdigit():
            try:
                ts = datetime.fromtimestamp(int(ts) / 1000, tz=timezone.utc).isoformat()
            except Exception:
                pass

        events.append({
            "id": str(uuid4()),
            "case_id": case_id,
            "activity": activity,
            "timestamp": ts or datetime.now(timezone.utc).isoformat(),
            "object_type_id": object_type_id,
            "object_id": case_id,
            "pipeline_id": pipeline.id,
            "connector_id": connector_id,
            "tenant_id": "tenant-001",
            "attributes": {
                k: v for k, v in record.items()
                if k not in (case_id_field, activity_field, timestamp_field)
                and not isinstance(v, (list, dict))
            },
        })

    written = 0
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            for i in range(0, len(events), 200):
                chunk = events[i:i + 200]
                resp = await client.post(
                    f"{EVENT_LOG_API}/events/batch",
                    json={"events": chunk},
                    headers={"x-tenant-id": "tenant-001"},
                )
                if resp.is_success:
                    written += len(chunk)
    except Exception:
        pass

    return records


# ── Shared Helpers ────────────────────────────────────────────────────────────

def _guess_pk(record: dict) -> str:
    for candidate in ("hs_object_id", "id", "record_id", "uuid", "incident_id"):
        if record.get(candidate):
            return candidate
    return next(iter(record), "id")


def _apply_conditions(record: dict, conditions: list[dict]) -> bool:
    """
    Return True if all conditions are satisfied by the record.
    Each condition: {field, operator, value}
    Operators: eq, neq, contains, not_contains, gt, lt, gte, lte, is_null, not_null, exists
    """
    for cond in conditions:
        field = cond.get("field", "")
        operator = cond.get("operator", "exists")
        expected = cond.get("value", "")
        actual = record.get(field)

        if operator == "exists":
            if actual is None or actual == "" or actual == []:
                return False
        elif operator == "not_null" or operator == "is_not_null":
            if actual is None:
                return False
        elif operator == "is_null":
            if actual is not None:
                return False
        elif operator == "eq":
            if str(actual) != str(expected):
                return False
        elif operator == "neq":
            if str(actual) == str(expected):
                return False
        elif operator == "contains":
            if expected not in str(actual or ""):
                return False
        elif operator == "not_contains":
            if expected in str(actual or ""):
                return False
        elif operator in ("gt", "lt", "gte", "lte"):
            try:
                a_val = float(str(actual or 0))
                e_val = float(str(expected or 0))
                if operator == "gt" and not (a_val > e_val):
                    return False
                if operator == "lt" and not (a_val < e_val):
                    return False
                if operator == "gte" and not (a_val >= e_val):
                    return False
                if operator == "lte" and not (a_val <= e_val):
                    return False
            except (ValueError, TypeError):
                return False
    return True


def _apply_extract_company(title: str) -> str:
    title = str(title or "").strip()
    title = re.sub(
        r"^(demo|call|intro|sync|meeting|review|catch[- ]?up|discussion|"
        r"follow[- ]?up|check[- ]?in|onboarding|kickoff|discovery)\s+(with|for|from|@)?\s*",
        "", title, flags=re.IGNORECASE,
    ).strip()
    title = re.sub(r"\s*[-–|]\s*\d{4}[-/]\d{2}[-/]\d{2}.*$", "", title).strip()
    title = re.sub(
        r"\s*[-–|]\s*(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\s*\d+.*$",
        "", title, flags=re.IGNORECASE,
    ).strip()
    for sep in (" - ", " | ", " — "):
        if sep in title:
            parts = [p.strip() for p in title.split(sep)]
            title = parts[0] if parts[0] else parts[-1]
            break
    return title.strip()


_TITLE_ALIASES = ("meeting_title", "title", "name", "subject", "summary", "description")


def _resolve_field(record: dict, field: str) -> str:
    val = record.get(field)
    if val:
        return str(val)
    for alias in _TITLE_ALIASES:
        if alias != field and record.get(alias):
            return str(record[alias])
    return ""


def _apply_transform(record: dict, source_field: str, target_field: str, transform_type: str) -> dict:
    record = dict(record)
    source_val = _resolve_field(record, source_field)
    if transform_type == "extract_company":
        record[target_field] = _apply_extract_company(source_val)
    elif transform_type == "lowercase":
        record[target_field] = source_val.lower()
    elif transform_type == "uppercase":
        record[target_field] = source_val.upper()
    elif transform_type == "strip":
        record[target_field] = source_val.strip()
    else:
        record[target_field] = source_val
    return record


# ── Legacy: array_append (keep for existing pipelines) ───────────────────────

async def _execute_array_append(
    pipeline: "Pipeline",
    ot_id: str,
    array_field: str,
    merge_key: str,
) -> int:
    source_connector_id: str | None = None
    map_transforms: list[dict] = []

    for node in pipeline.nodes:
        if node.type == NodeType.SOURCE:
            source_connector_id = (
                node.config.get("connectorId")
                or node.config.get("connector_id")
                or node.connector_id
                or (pipeline.connector_ids[0] if pipeline.connector_ids else None)
            )
        elif node.type == NodeType.MAP:
            cfg = node.config
            jke = cfg.get("join_key_extraction")
            if jke:
                sf = jke.get("source_field", "")
                tf = jke.get("output_field", "__join_key__")
                tt = jke.get("transform", "")
            else:
                sf = cfg.get("sourceField") or cfg.get("source_field", "")
                tf = cfg.get("targetField") or cfg.get("target_field") or cfg.get("output_field", "__join_key__")
                tt = cfg.get("transformType") or cfg.get("transform_type") or cfg.get("transform", "")
            if sf:
                map_transforms.append({"source_field": sf, "target_field": tf, "transform_type": tt})

    if not source_connector_id:
        return 0

    try:
        async with httpx.AsyncClient(timeout=60) as client:
            r = await client.get(
                f"{CONNECTOR_API}/connectors/{source_connector_id}/schema",
                headers={"x-tenant-id": "tenant-001"},
            )
            if not r.is_success:
                return 0
            raw_records: list[dict] = r.json().get("sample_rows", [])
    except Exception:
        return 0

    if not raw_records:
        return 0

    transformed_records: list[dict] = []
    for rec in raw_records:
        for t in map_transforms:
            rec = _apply_transform(rec, t["source_field"], t["target_field"], t["transform_type"])
        transformed_records.append(rec)

    if not map_transforms:
        for rec in transformed_records:
            rec["__join_key__"] = _resolve_field(rec, "meeting_title")

    try:
        async with httpx.AsyncClient(timeout=60) as client:
            resp = await client.post(
                f"{ONTOLOGY_API}/object-types/{ot_id}/records/array-append",
                json={
                    "array_field": array_field,
                    "merge_key": merge_key,
                    "join_key": "__join_key__",
                    "records": transformed_records,
                },
                headers={"x-tenant-id": "tenant-001"},
            )
            if resp.is_success:
                return resp.json().get("appended", 0)
    except Exception:
        pass

    return 0


# ── Legacy: emit events by reading from ontology (fallback) ──────────────────

async def _emit_events_from_records(
    object_type_id: str,
    pipeline_id: str,
    connector_ids: list[str],
    case_id_field: str,
    activity_field: str,
    timestamp_field: str,
) -> int:
    connector_id = connector_ids[0] if connector_ids else ""

    try:
        async with httpx.AsyncClient(timeout=60) as client:
            resp = await client.get(
                f"{ONTOLOGY_API}/object-types/{object_type_id}/records",
                headers={"x-tenant-id": "tenant-001"},
            )
            if not resp.is_success:
                return 0
            data = resp.json()
    except Exception:
        return 0

    records: list[dict] = data.get("records", [])
    if not records:
        return 0

    def _pick_timestamp(record: dict, preferred: str) -> str | None:
        if preferred and record.get(preferred):
            return str(record[preferred])
        for key in ("createdate", "hs_lastmodifieddate", "closedate", "created_at",
                    "updated_at", "timestamp", "date", "occurred_at"):
            if record.get(key):
                return str(record[key])
        for key, val in record.items():
            if val and any(t in key.lower() for t in ("date", "time", "_at", "stamp")):
                return str(val)
        return datetime.now(timezone.utc).isoformat()

    def _pick_value(record: dict, field: str, fallback: str) -> str:
        if field and record.get(field) is not None:
            return str(record[field])
        return fallback

    events = []
    for record in records:
        case_id = _pick_value(record, case_id_field, str(record.get("id", str(uuid4()))))
        activity = _pick_value(record, activity_field, "RECORD_SYNCED")
        ts = _pick_timestamp(record, timestamp_field)

        if ts and ts.isdigit():
            try:
                ms = int(ts)
                ts = datetime.fromtimestamp(ms / 1000, tz=timezone.utc).isoformat()
            except Exception:
                pass

        events.append({
            "id": str(uuid4()),
            "case_id": case_id,
            "activity": activity,
            "timestamp": ts or datetime.now(timezone.utc).isoformat(),
            "object_type_id": object_type_id,
            "object_id": case_id,
            "pipeline_id": pipeline_id,
            "connector_id": connector_id,
            "tenant_id": "tenant-001",
            "attributes": {
                k: v for k, v in record.items()
                if k not in (case_id_field, activity_field, timestamp_field)
                and not isinstance(v, (list, dict))
            },
        })

    if not events:
        return 0

    written = 0
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            for i in range(0, len(events), 200):
                chunk = events[i:i + 200]
                resp = await client.post(
                    f"{EVENT_LOG_API}/events/batch",
                    json={"events": chunk},
                    headers={"x-tenant-id": "tenant-001"},
                )
                if resp.is_success:
                    written += len(chunk)
    except Exception:
        pass

    return written


# ── Pipeline execution event emission ────────────────────────────────────────

async def _emit_pipeline_event(
    pipeline_id: str,
    pipeline_name: str,
    activity: str,
    timestamp: str,
    rows_in: int,
    rows_out: int,
    status: str,
    error: str = "",
) -> None:
    """Emit a pipeline-level event to the event log so run history is visible."""
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            await client.post(
                f"{EVENT_LOG_API}/events",
                json={
                    "id": str(uuid4()),
                    "case_id": pipeline_id,
                    "activity": activity,
                    "timestamp": timestamp,
                    "object_type_id": "",
                    "object_id": pipeline_id,
                    "pipeline_id": pipeline_id,
                    "connector_id": "",
                    "tenant_id": "tenant-001",
                    "attributes": {
                        "pipeline_name": pipeline_name,
                        "rows_in": rows_in,
                        "rows_out": rows_out,
                        "status": status,
                        "error": error,
                    },
                },
            )
    except Exception:
        pass
