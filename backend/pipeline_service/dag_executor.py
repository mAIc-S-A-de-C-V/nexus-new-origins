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

            # Each node produces a list of real records
            node_records: dict[str, list[dict]] = {}
            # Per-node audit snapshots written into the run record
            node_audits: dict[str, dict] = {}
            source_row_count = 0
            synced_rows = 0

            for node_id in order:
                node = node_map.get(node_id)
                if not node:
                    continue

                incoming_edges = [e for e in pipeline.edges if e.target == node_id]
                if not incoming_edges:
                    records_in: list[dict] = []
                else:
                    records_in = []
                    for e in incoming_edges:
                        records_in.extend(node_records.get(e.source, []))

                t_start = datetime.now(timezone.utc)
                records_out = await _execute_node(node, records_in, pipeline)
                duration_ms = int((datetime.now(timezone.utc) - t_start).total_seconds() * 1000)

                node_records[node_id] = records_out

                if not incoming_edges and records_out:
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
                    stats = {"connector_id": cfg.get("connectorId", ""), "endpoint": cfg.get("endpoint", "")}

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

async def _execute_node(node, records_in: list[dict], pipeline: Pipeline) -> list[dict]:
    if node.type == NodeType.SOURCE:
        return await _source(node, pipeline)
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


async def _source(node, pipeline: Pipeline) -> list[dict]:
    """Fetch real records from the configured connector."""
    cfg = node.config or {}
    connector_id = (
        cfg.get("connectorId")
        or cfg.get("connector_id")
        or node.connector_id
        or (pipeline.connector_ids[0] if pipeline.connector_ids else None)
    )
    if not connector_id:
        return []
    try:
        async with httpx.AsyncClient(timeout=60) as client:
            r = await client.get(
                f"{CONNECTOR_API}/connectors/{connector_id}/schema",
                headers={"x-tenant-id": "tenant-001"},
            )
            if r.is_success:
                return r.json().get("sample_rows", [])
    except Exception:
        pass
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


def _map(node, records_in: list[dict]) -> list[dict]:
    """Apply field renaming and transforms to each record."""
    cfg = node.config or {}

    # Collect all transforms — support both list format and legacy single-transform keys
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
    ot_id = cfg.get("objectTypeId") or node.object_type_id or pipeline.target_object_type_id

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

    # ── Build per-record events with field-level diffs ──
    connector_id = pipeline.connector_ids[0] if pipeline.connector_ids else ""
    record_events: list[dict] = []
    now = datetime.now(timezone.utc).isoformat()

    for rec in records_in:
        pk_val = str(rec.get(pk_field, ""))
        if not pk_val:
            continue

        existing = existing_by_pk.get(pk_val)
        if existing is None:
            # Brand-new record
            record_events.append({
                "id": str(uuid4()),
                "case_id": pk_val,
                "activity": "RECORD_CREATED",
                "timestamp": now,
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

            if changed_fields:
                record_events.append({
                    "id": str(uuid4()),
                    "case_id": pk_val,
                    "activity": "RECORD_UPDATED",
                    "timestamp": now,
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
            if resp.is_success:
                return records_in
    except Exception:
        pass

    return records_in


async def _sink_event(node, records_in: list[dict], pipeline: Pipeline) -> list[dict]:
    """Convert records flowing through the pipeline into process mining events."""
    cfg = node.config or {}
    object_type_id = (
        cfg.get("objectTypeId")
        or node.object_type_id
        or pipeline.target_object_type_id
        or ""
    )
    case_id_field = cfg.get("caseIdField", "id")
    activity_field = cfg.get("activityField", "")
    timestamp_field = cfg.get("timestampField", "")
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
