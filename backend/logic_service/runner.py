"""
Logic Function Block Runner
===========================
Evaluates a Logic Function's blocks sequentially, resolving {variable} references
between blocks and calling external services for ontology_query and llm_call blocks.

Variable resolution examples:
  {inputs.customer_id}       → context["inputs"]["customer_id"]
  {b1.result}                → context["b1"]["result"]
  {b2.result.resolution}     → context["b2"]["result"]["resolution"]
"""
import os
import re
import json
import time
import smtplib
from datetime import datetime, timezone, timedelta
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from typing import Any
import httpx
import anthropic

ONTOLOGY_URL = os.environ.get("ONTOLOGY_SERVICE_URL", "http://ontology-service:8004")
UTILITY_URL = os.environ.get("UTILITY_SERVICE_URL", "http://utility-service:8014")
ANTHROPIC_API_KEY = os.environ.get("ANTHROPIC_API_KEY", "")

SMTP_HOST = os.environ.get("SMTP_HOST", "")
SMTP_PORT = int(os.environ.get("SMTP_PORT", "587"))
SMTP_USER = os.environ.get("SMTP_USER", "")
SMTP_PASSWORD = os.environ.get("SMTP_PASSWORD", "")
SMTP_FROM = os.environ.get("SMTP_FROM", SMTP_USER)


def _resolve(template: Any, context: dict) -> Any:
    """Recursively resolve {path.to.value} references in strings, dicts, and lists.

    Supports array indexing: records[0].field resolves the 0th element of a list.
    """
    if isinstance(template, str):
        # Replace all {x.y.z} patterns
        def replacer(m: re.Match) -> str:
            # Split by "." but keep array indices attached to their key: "records[0]"
            raw_path = m.group(1)
            # Tokenise: split on "." first, then each token may have "[N]" suffix
            parts: list[tuple[str, int | None]] = []
            for segment in raw_path.split("."):
                idx_match = re.match(r'^(\w+)\[(\d+)\]$', segment)
                if idx_match:
                    parts.append((idx_match.group(1), int(idx_match.group(2))))
                else:
                    parts.append((segment, None))

            val: Any = context
            for key, idx in parts:
                if isinstance(val, dict):
                    val = val.get(key)
                else:
                    return m.group(0)  # can't resolve, leave as-is
                if val is None:
                    return ""
                if idx is not None:
                    if isinstance(val, list) and idx < len(val):
                        val = val[idx]
                    else:
                        return ""
            return str(val) if not isinstance(val, (dict, list)) else json.dumps(val)
        return re.sub(r'\{([^}]+)\}', replacer, template)
    elif isinstance(template, dict):
        return {k: _resolve(v, context) for k, v in template.items()}
    elif isinstance(template, list):
        return [_resolve(item, context) for item in template]
    return template


def _get_record_field(record: dict, field: str):
    """Look up a field in a record, trying normalized variants if exact match fails."""
    if field in record:
        return record[field]
    # Try without underscores (e.g. hs_last_modified_date → hs_lastmodifieddate)
    normalized = field.replace("_", "").lower()
    for k, v in record.items():
        if k.replace("_", "").lower() == normalized:
            return v
    return None


def _apply_filter(record: dict, field: str, op: str, value: str) -> bool:
    """Test a single filter condition against a record."""
    rec_val = _get_record_field(record, field)
    if rec_val is None:
        return False
    rec_str = str(rec_val).lower()
    val_str = value.lower()
    if op == "==" or op == "eq":
        return rec_str == val_str
    elif op == "!=" or op == "neq":
        return rec_str != val_str
    elif op == "contains":
        return val_str in rec_str
    elif op == "not_contains":
        return val_str not in rec_str
    elif op == "starts_with":
        return rec_str.startswith(val_str)
    elif op == ">" or op == "gt":
        try: return float(rec_val) > float(value)
        except:
            try: return str(rec_val) > str(value)
            except: return False
    elif op == ">=" or op == "gte":
        try: return float(rec_val) >= float(value)
        except:
            try: return str(rec_val) >= str(value)
            except: return False
    elif op == "<" or op == "lt":
        try: return float(rec_val) < float(value)
        except:
            try: return str(rec_val) < str(value)
            except: return False
    elif op == "<=" or op == "lte":
        try: return float(rec_val) <= float(value)
        except:
            try: return str(rec_val) <= str(value)
            except: return False
    elif op == "is_empty":
        return not rec_str or rec_str in ("none", "null", "")
    elif op == "is_not_empty":
        return bool(rec_str) and rec_str not in ("none", "null", "")
    return True


async def _run_ontology_query(config: dict, context: dict, tenant_id: str) -> Any:
    """Query object records from the Ontology Service."""
    object_type = _resolve(config.get("object_type", ""), context)
    limit = config.get("limit", 10)

    # Support both old single-string filter and new filters array
    filters_raw: list[dict] = config.get("filters", [])
    legacy_filter: str = config.get("filter", "")

    # Fetch more records than the limit so filters have enough to work with
    params: dict[str, Any] = {"limit": max(limit * 10, 200)}

    async with httpx.AsyncClient(timeout=30) as client:
        try:
            r = await client.get(
                f"{ONTOLOGY_URL}/object-types",
                headers={"x-tenant-id": tenant_id},
            )
            ot_list = r.json() if r.is_success else []
            ot = next(
                (o for o in ot_list if o.get("name") == object_type or o.get("displayName") == object_type or o.get("display_name") == object_type),
                None,
            )
            if not ot:
                return {"error": f"Object type '{object_type}' not found", "records": []}

            r2 = await client.get(
                f"{ONTOLOGY_URL}/object-types/{ot['id']}/records",
                params=params,
                headers={"x-tenant-id": tenant_id},
            )
            data = r2.json() if r2.is_success else {}
            records = data.get("records", [])
            total_before_filter = data.get("total", data.get("count", len(records)))

            # Apply structured filters array (AND logic)
            if filters_raw:
                for f in filters_raw:
                    field = _resolve(f.get("field", ""), context)
                    op = f.get("op", "==")
                    value = _resolve(str(f.get("value", "")), context)
                    if field:
                        records = [rec for rec in records if _apply_filter(rec, field, op, value)]

            # Fallback: legacy single-string filter "field == value"
            elif legacy_filter:
                resolved = _resolve(legacy_filter, context)
                m = re.match(r'(\w+)\s*==\s*(.+)', resolved.strip())
                if m:
                    field, value = m.group(1), m.group(2).strip().strip('"\'')
                    records = [rec for rec in records if str(rec.get(field, "")).lower() == value.lower()]

            return {"records": records[:limit], "count": len(records), "total_before_filter": total_before_filter}
        except Exception as e:
            return {"error": str(e), "records": []}


async def _run_llm_call(block: dict, context: dict) -> Any:
    """Call Claude with resolved prompt template and parse structured output."""
    prompt_template = block.get("prompt_template", "")
    system_prompt = block.get("system_prompt", "You are a helpful AI assistant.")
    model = block.get("model", "claude-haiku-4-5-20251001")
    output_schema = block.get("output_schema", {})
    max_tokens = block.get("max_tokens", 1024)

    resolved_prompt = _resolve(prompt_template, context)

    # Build schema instruction if output_schema defined
    schema_instruction = ""
    if output_schema:
        schema_instruction = f"\n\nRespond with ONLY valid JSON matching this schema: {json.dumps(output_schema)}"

    try:
        client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)
        message = client.messages.create(
            model=model,
            max_tokens=max_tokens,
            system=system_prompt + schema_instruction,
            messages=[{"role": "user", "content": resolved_prompt}],
        )
        raw = message.content[0].text.strip()

        # Try to parse as JSON if output_schema defined
        if output_schema:
            # Strip markdown code fences
            if raw.startswith("```"):
                parts = raw.split("```")
                raw = parts[1] if len(parts) > 1 else raw
                if raw.startswith("json"):
                    raw = raw[4:]
            try:
                return json.loads(raw.strip())
            except json.JSONDecodeError:
                return {"raw_output": raw, "parse_error": "Could not parse JSON output"}

        return {"text": raw}
    except Exception as e:
        return {"error": str(e)}


async def _run_action(block: dict, context: dict, tenant_id: str) -> Any:
    """Propose or execute an ontology action."""
    action_name = _resolve(block.get("action_name", ""), context)
    raw_params = block.get("params", {})
    params = _resolve(raw_params, context)
    reasoning = _resolve(block.get("reasoning", ""), context)
    source_id = context.get("__function_id__", "")

    async with httpx.AsyncClient(timeout=15) as client:
        try:
            r = await client.post(
                f"{ONTOLOGY_URL}/actions/{action_name}/execute",
                json={
                    "inputs": params,
                    "executed_by": f"logic_function:{source_id}",
                    "source": "logic_function",
                    "source_id": source_id,
                    "reasoning": reasoning,
                },
                headers={"x-tenant-id": tenant_id, "Content-Type": "application/json"},
            )
            return r.json() if r.is_success else {"error": f"Action failed: {r.text}"}
        except Exception as e:
            return {"error": str(e)}


def _send_one_email(to: str, subject: str, body: str, from_name: str, bcc: str = "") -> dict:
    """Send a single email via SMTP. Returns {sent, error?}."""
    if not SMTP_HOST or not SMTP_USER:
        return {"sent": False, "error": "SMTP not configured — set SMTP_HOST, SMTP_USER, SMTP_PASSWORD env vars"}
    try:
        msg = MIMEMultipart("alternative")
        msg["Subject"] = subject
        msg["From"] = f"{from_name} <{SMTP_FROM}>" if from_name else SMTP_FROM
        msg["To"] = to
        if bcc:
            msg["Bcc"] = bcc
        msg.attach(MIMEText(body, "plain"))
        recipients = [to] + ([bcc] if bcc else [])
        with smtplib.SMTP(SMTP_HOST, SMTP_PORT) as server:
            server.ehlo()
            server.starttls()
            server.login(SMTP_USER, SMTP_PASSWORD)
            server.sendmail(SMTP_FROM, recipients, msg.as_string())
        return {"sent": True, "to": to, "subject": subject}
    except Exception as e:
        return {"sent": False, "to": to, "error": str(e)}


async def _run_send_email(block: dict, context: dict) -> Any:
    """
    Send emails from a Logic Function block.

    Supports two modes:
    1. Single email — `to` is an email string, `subject` and `body` are templates.
    2. Batch from list — `to` references a list like {b2.result.emails} where each item
       has {to, subject, body} fields. Iterates and sends one per item.
    """
    to_raw = _resolve(block.get("to", ""), context)
    subject_tpl = block.get("subject", "")
    body_tpl = block.get("body", "")
    from_name = _resolve(block.get("from_name", ""), context)
    bcc = _resolve(block.get("bcc", ""), context) if block.get("bcc") else ""

    results = []

    # If `to` resolved to a list (batch from LLM output), send one per item
    if isinstance(to_raw, list):
        for item in to_raw:
            if isinstance(item, dict):
                to_addr = item.get("to", item.get("owner_email", ""))
                subject = _resolve(subject_tpl, {**context, "item": item}) or item.get("subject", "")
                body = _resolve(body_tpl, {**context, "item": item}) or item.get("body", "")
            else:
                to_addr = str(item)
                subject = _resolve(subject_tpl, context)
                body = _resolve(body_tpl, context)
            if to_addr:
                results.append(_send_one_email(to_addr, subject, body, from_name, bcc=str(bcc) if bcc else ""))
        return {"emails_sent": len([r for r in results if r.get("sent")]), "results": results}

    # If `to` is a string referencing a JSON list, parse it
    if isinstance(to_raw, str) and to_raw.strip().startswith("["):
        try:
            items = json.loads(to_raw)
            return await _run_send_email({**block, "to": items}, context)
        except Exception:
            pass

    # Single email
    to_addr = str(to_raw).strip() if to_raw else ""
    subject = _resolve(subject_tpl, context)
    body = _resolve(body_tpl, context)
    if not to_addr:
        return {"sent": False, "error": "No 'to' address resolved"}
    result = _send_one_email(to_addr, subject, body, from_name, bcc=str(bcc) if bcc else "")
    return result


async def _run_utility_call(block: dict, context: dict, tenant_id: str) -> Any:
    """Call a utility from the Utility Service."""
    utility_id = _resolve(block.get("utility_id", ""), context)
    raw_params = block.get("utility_params", {})
    params = _resolve(raw_params, context)

    if not utility_id:
        return {"error": "utility_id is required"}

    async with httpx.AsyncClient(timeout=60) as client:
        try:
            r = await client.post(
                f"{UTILITY_URL}/utilities/{utility_id}/run",
                json={"inputs": params},
                headers={"x-tenant-id": tenant_id},
            )
            data = r.json() if r.is_success else {"error": f"Utility service error: {r.text}"}
            # Unwrap the result field if present
            return data.get("result", data) if isinstance(data, dict) else data
        except Exception as e:
            return {"error": str(e)}


def _run_transform(block: dict, context: dict) -> Any:
    """Simple in-memory data transformation."""
    operation = block.get("operation", "pass")
    source = block.get("source", "")
    source_data = _resolve(f"{{{source}}}", context) if source else context

    if operation == "pass":
        return source_data
    elif operation == "extract_field":
        field = block.get("field", "")
        if isinstance(source_data, dict):
            return source_data.get(field)
        return None
    elif operation == "format_string":
        template = block.get("template", "")
        return _resolve(template, context)
    elif operation == "filter_list":
        field = block.get("field", "")
        value = _resolve(block.get("value", ""), context)
        if isinstance(source_data, list):
            return [item for item in source_data if str(item.get(field, "")) == str(value)]
        return source_data
    else:
        return source_data


async def _run_http_call(config: dict, context: dict) -> Any:
    """
    Make an external HTTP request with variable interpolation on url, headers, and body.

    Config:
      url             — target URL (supports {inputs.x}, {b1.result.field} interpolation)
      method          — GET | POST | PUT | PATCH | DELETE (default GET)
      headers         — dict of header key→value (interpolated)
      body            — string or dict request body (interpolated; sent as JSON if dict)
      auth_type       — none | bearer | basic | api_key (default none)
      auth_config     — dict with auth details (e.g. {token}, {username, password}, {header, value})
      timeout_seconds — request timeout (default 30)

    Returns: { status_code, headers, body, elapsed_ms } or { error, elapsed_ms }
    """
    url = _resolve(config.get("url", ""), context)
    method = (config.get("method", "GET") or "GET").upper()
    headers = _resolve(config.get("headers", {}), context) or {}
    body_raw = config.get("body")
    auth_type = (config.get("auth_type", "none") or "none").lower()
    auth_config = _resolve(config.get("auth_config", {}), context) or {}
    timeout_seconds = config.get("timeout_seconds", 30) or 30

    if not url:
        return {"error": "url is required", "elapsed_ms": 0}

    # Resolve body
    if body_raw is not None:
        body_raw = _resolve(body_raw, context)

    # Apply auth
    if auth_type == "bearer":
        token = auth_config.get("token", "")
        headers["Authorization"] = f"Bearer {token}"
    elif auth_type == "basic":
        import base64
        username = auth_config.get("username", "")
        password = auth_config.get("password", "")
        encoded = base64.b64encode(f"{username}:{password}".encode()).decode()
        headers["Authorization"] = f"Basic {encoded}"
    elif auth_type == "api_key":
        header_name = auth_config.get("header", "X-API-Key")
        header_value = auth_config.get("value", "")
        headers[header_name] = header_value

    # Build request kwargs
    kwargs: dict[str, Any] = {"method": method, "url": url, "headers": headers}
    if body_raw is not None and method in ("POST", "PUT", "PATCH"):
        if isinstance(body_raw, dict):
            kwargs["json"] = body_raw
        else:
            # Try to parse as JSON string, otherwise send as text
            try:
                kwargs["json"] = json.loads(body_raw)
            except (json.JSONDecodeError, TypeError):
                kwargs["content"] = str(body_raw)

    t0 = time.monotonic()
    try:
        async with httpx.AsyncClient(timeout=timeout_seconds) as client:
            resp = await client.request(**kwargs)
        elapsed_ms = int((time.monotonic() - t0) * 1000)

        # Parse response body
        try:
            resp_body = resp.json()
        except Exception:
            resp_body = resp.text

        return {
            "status_code": resp.status_code,
            "headers": dict(resp.headers),
            "body": resp_body,
            "elapsed_ms": elapsed_ms,
        }
    except httpx.TimeoutException:
        elapsed_ms = int((time.monotonic() - t0) * 1000)
        return {"error": "Request timed out", "status_code": None, "elapsed_ms": elapsed_ms}
    except Exception as e:
        elapsed_ms = int((time.monotonic() - t0) * 1000)
        return {"error": str(e), "status_code": None, "elapsed_ms": elapsed_ms}


async def _run_ontology_update(block: dict, context: dict, tenant_id: str) -> Any:
    """
    Write one or more field values back to an ontology object type record.

    Config fields (all support template references):
      object_type_id  — the object type to update
      match_field     — field used to identify which record to update (e.g. "borrower_id")
      match_value     — value of match_field to find the target record
      fields          — dict of field_name → new_value to set on the record

    Example block config:
      {
        "object_type_id": "abc-123",
        "match_field": "borrower_id",
        "match_value": "{bidi1q6d.result.records[0].borrower_id}",
        "fields": {
          "risk_score": "{btayt8l5.result.risk_score}",
          "risk_category": "{btayt8l5.result.risk_category}"
        }
      }
    """
    cfg = _resolve(block.get("config", {}), context)
    ot_id = cfg.get("object_type_id") or cfg.get("objectTypeId")
    match_field = cfg.get("match_field") or cfg.get("matchField")
    match_value = cfg.get("match_value") or cfg.get("matchValue")
    fields = cfg.get("fields", {})

    if not ot_id:
        return {"error": "object_type_id is required"}
    if not fields:
        return {"error": "fields dict is required"}

    # Build a single record that merges match key + new fields
    record = dict(fields)
    if match_field and match_value is not None:
        record[match_field] = match_value

    async with httpx.AsyncClient(timeout=30) as client:
        try:
            r = await client.post(
                f"{ONTOLOGY_URL}/object-types/{ot_id}/records/ingest",
                json={
                    "records": [record],
                    "merge_key": match_field,
                    "write_mode": "upsert",
                    "on_conflict": "overwrite",
                },
                headers={"x-tenant-id": tenant_id, "Content-Type": "application/json"},
            )
            if r.is_success:
                return {"updated": 1, "record": record}
            return {"error": r.text}
        except Exception as e:
            return {"error": str(e)}


async def execute_function(
    function_id: str,
    blocks: list[dict],
    output_block: str,
    inputs: dict,
    tenant_id: str,
) -> dict:
    """
    Execute all blocks sequentially and return the trace + final output.
    Returns: { output, trace: {block_id: {result, duration_ms, error?}}, error? }
    """
    _now = datetime.now(timezone.utc)
    context: dict[str, Any] = {
        "inputs": inputs,
        "__function_id__": function_id,
        # Built-in time variables — use these in any block field
        "now":           _now.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "now_minus_1d":  (_now - timedelta(days=1)).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "now_minus_3d":  (_now - timedelta(days=3)).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "now_minus_7d":  (_now - timedelta(days=7)).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "now_minus_14d": (_now - timedelta(days=14)).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "now_minus_30d": (_now - timedelta(days=30)).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "now_minus_90d": (_now - timedelta(days=90)).strftime("%Y-%m-%dT%H:%M:%SZ"),
    }
    trace: dict[str, Any] = {}

    for block in blocks:
        block_id = block["id"]
        block_type = block["type"]
        t0 = time.monotonic()

        try:
            if block_type == "ontology_query":
                result = await _run_ontology_query(block.get("config", {}), context, tenant_id)
            elif block_type == "llm_call":
                result = await _run_llm_call(block, context)
            elif block_type == "action":
                result = await _run_action(block, context, tenant_id)
            elif block_type == "send_email":
                result = await _run_send_email(block, context)
            elif block_type == "transform":
                result = _run_transform(block, context)
            elif block_type == "utility_call":
                result = await _run_utility_call(block, context, tenant_id)
            elif block_type == "ontology_update":
                result = await _run_ontology_update(block, context, tenant_id)
            elif block_type == "http_call":
                result = await _run_http_call(block.get("config", {}), context)
            else:
                result = {"error": f"Unknown block type: {block_type}"}

            duration_ms = int((time.monotonic() - t0) * 1000)
            context[block_id] = {"result": result}
            trace[block_id] = {"result": result, "duration_ms": duration_ms, "status": "completed"}

        except Exception as e:
            duration_ms = int((time.monotonic() - t0) * 1000)
            error_msg = str(e)
            context[block_id] = {"result": None, "error": error_msg}
            trace[block_id] = {"result": None, "duration_ms": duration_ms, "status": "failed", "error": error_msg}
            # Stop execution on block failure
            return {
                "output": None,
                "trace": trace,
                "error": f"Block '{block_id}' failed: {error_msg}",
            }

    # Extract final output
    output_data = context.get(output_block, {}).get("result") if output_block else None
    return {"output": output_data, "trace": trace}
