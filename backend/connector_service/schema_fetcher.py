"""
Real schema fetchers for each connector type.
Returns (raw_schema_dict, sample_rows_list, error_message_or_None).
"""
import httpx
import uuid as _uuid_mod
import random as _random_mod
from typing import Optional


def _fmt_date(dt, fmt: str) -> str:
    """Format a datetime using simple DD/MM/YYYY-style tokens."""
    return (fmt
        .replace('YYYY', dt.strftime('%Y'))
        .replace('MM', dt.strftime('%m'))
        .replace('DD', dt.strftime('%d'))
        .replace('HH', dt.strftime('%H'))
        .replace('mm', dt.strftime('%M'))
        .replace('ss', dt.strftime('%S')))


def _resolve_header_value(value: str) -> str:
    """Resolve Postman dynamic variables in header values."""
    value = value.replace('{{$guid}}', str(_uuid_mod.uuid4()))
    value = value.replace('{{$randomInt}}', str(_random_mod.randint(1, 1000)))
    value = value.replace('{{$randomIP}}',
        f"{_random_mod.randint(1,254)}.{_random_mod.randint(0,255)}.{_random_mod.randint(0,255)}.{_random_mod.randint(1,254)}")
    return value


async def _resolve_query_params(query_params: dict, last_sync=None, db=None) -> dict:
    """Resolve dynamic query param values to concrete strings."""
    import re as _re
    from datetime import datetime, timezone, timedelta
    result = {}
    now = datetime.now(timezone.utc)
    for k, v in query_params.items():
        s = str(v)
        m = _re.match(r'^\{\{\$today:(.+)\}\}$', s)
        if m:
            result[k] = _fmt_date(now, m.group(1))
            continue
        m = _re.match(r'^\{\{\$daysAgo:(\d+):(.+)\}\}$', s)
        if m:
            dt = now - timedelta(days=int(m.group(1)))
            result[k] = _fmt_date(dt, m.group(2))
            continue
        m = _re.match(r'^\{\{\$lastRun:(.+)\}\}$', s)
        if m:
            dt = last_sync if last_sync else (now - timedelta(days=7))
            result[k] = _fmt_date(dt, m.group(1))
            continue
        # From connector
        m = _re.match(r'^\{\{connector:([^:]+):(.+)\}\}$', s)
        if m and db is not None:
            connector_id, field_path = m.group(1), m.group(2)
            try:
                from database import ConnectorRow
                from sqlalchemy import select as sa_select
                row = (await db.execute(sa_select(ConnectorRow).where(ConnectorRow.id == connector_id))).scalar_one_or_none()
                if row:
                    _, sample_rows, err = await _rest_api(row.base_url, row.credentials or {}, row.config or {}, db=db)
                    if not err and sample_rows:
                        field_val = sample_rows[0]
                        for part in field_path.split('.'):
                            field_val = field_val[part]
                        result[k] = str(field_val)
                        continue
            except Exception:
                pass
        result[k] = s  # fallback: use as-is
    return result


async def _resolve_headers(headers: dict, db=None) -> dict:
    import re as _re
    result = {}
    for k, v in headers.items():
        val = _resolve_header_value(str(v))
        # Resolve {{connector:id:field.path}} — call the connector and extract the field
        m = _re.match(r'^\{\{connector:([^:]+):(.+)\}\}$', val)
        if m and db is not None:
            connector_id, field_path = m.group(1), m.group(2)
            try:
                from database import ConnectorRow
                from sqlalchemy import select as sa_select
                row = (await db.execute(sa_select(ConnectorRow).where(ConnectorRow.id == connector_id))).scalar_one_or_none()
                if row:
                    _, sample_rows, err = await _rest_api(row.base_url, row.credentials or {}, row.config or {}, db=db)
                    if not err and sample_rows:
                        field_val = sample_rows[0]
                        for part in field_path.split('.'):
                            field_val = field_val[part]
                        val = str(field_val)
            except Exception:
                pass  # keep original value on failure
        result[k] = val
    return result


async def fetch_schema(connector_type: str, base_url: Optional[str], credentials: Optional[dict], config: Optional[dict] = None, db=None, last_sync=None) -> tuple[dict, list, Optional[str]]:
    creds = credentials or {}
    cfg = config or {}
    try:
        if connector_type == "HUBSPOT":
            return await _hubspot(creds, cfg)
        if connector_type == "SALESFORCE":
            return await _salesforce(base_url, creds)
        if connector_type == "FIREFLIES":
            return await _fireflies(creds)
        if connector_type == "GITHUB":
            return await _github(creds, cfg)
        if connector_type == "REST_API":
            return await _rest_api(base_url, creds, cfg, db=db, last_sync=last_sync)
        if connector_type == "WHATSAPP":
            return await _whatsapp_schema(cfg)
        if connector_type in ("RELATIONAL_DB", "MONGODB", "DATA_WAREHOUSE"):
            return {}, [], "Schema preview not supported for database connectors — connect directly via your DB client."
        return {}, [], f"Schema fetch not yet supported for {connector_type}."
    except Exception as e:
        return {}, [], str(e)


# ── REST API ───────────────────────────────────────────────────────────────

async def _resolve_bearer_token(creds: dict, db=None) -> Optional[str]:
    """Return the bearer token — static, fetched from a login endpoint, or via a referenced connector."""
    import json as _json

    # Mode: use another connector as the auth source
    auth_connector_id = creds.get("authConnectorId")
    if auth_connector_id and db is not None:
        try:
            from models import ConnectorRow
            from sqlalchemy import select as sa_select
            result = await db.execute(sa_select(ConnectorRow).where(ConnectorRow.id == auth_connector_id))
            auth_row = result.scalar_one_or_none()
            if not auth_row:
                raise Exception(f"Auth connector {auth_connector_id} not found")
            # Build the URL from the referenced connector
            auth_base = (auth_row.base_url or "").rstrip("/")
            auth_path = (auth_row.config or {}).get("path", "")
            auth_method = (auth_row.config or {}).get("method", "POST").lower()
            auth_url = auth_base + auth_path
            # Use the referenced connector's credentials as request body
            auth_creds = auth_row.credentials or {}
            body: dict = {}
            if auth_creds.get("username"):
                body["username"] = auth_creds["username"]
            if auth_creds.get("password"):
                body["password"] = auth_creds["password"]
            async with httpx.AsyncClient(timeout=10) as client:
                fn = getattr(client, auth_method)
                r = await fn(auth_url, json=body)
                if not r.is_success:
                    raise Exception(f"Auth connector returned {r.status_code}: {r.text[:200]}")
                data = r.json()
            token_path = creds.get("tokenPath", "token")
            val = data
            for part in token_path.split("."):
                val = val[part]
            return str(val)
        except Exception as e:
            raise Exception(f"Failed to get token from connector: {e}")

    # Mode: dynamic login endpoint (manual config)
    endpoint_url = creds.get("tokenEndpointUrl")
    if endpoint_url:
        method = creds.get("tokenEndpointMethod", "POST").lower()
        body_raw = creds.get("tokenEndpointBody", "{}")
        token_path = creds.get("tokenPath", "token")
        try:
            body = _json.loads(body_raw)
        except Exception:
            body = {}
        async with httpx.AsyncClient(timeout=10) as client:
            fn = getattr(client, method)
            r = await fn(endpoint_url, json=body)
            if not r.is_success:
                raise Exception(f"Login endpoint returned {r.status_code}: {r.text[:200]}")
            data = r.json()
            val = data
            for part in token_path.split("."):
                val = val[part]
            return str(val)

    # Mode: static token
    return creds.get("token") or creds.get("api_key") or None


def _infer_type(v) -> str:
    if isinstance(v, bool): return "boolean"
    if isinstance(v, int): return "integer"
    if isinstance(v, float): return "float"
    if isinstance(v, str): return "string"
    if isinstance(v, list): return "array"
    if isinstance(v, dict): return "object"
    return "unknown"


def _walk_obj(obj, fields: dict, prefix: str, depth: int = 0):
    if depth > 4 or not isinstance(obj, dict):
        return
    for k, v in obj.items():
        key = f"{prefix}.{k}" if prefix else k
        if isinstance(v, dict):
            fields[key] = {"type": "object", "label": k}
            _walk_obj(v, fields, key, depth + 1)
        elif isinstance(v, list):
            fields[key] = {"type": "array", "label": k}
            if v and isinstance(v[0], dict):
                _walk_obj(v[0], fields, key, depth + 1)
        else:
            fields[key] = {"type": _infer_type(v), "label": k, "example": str(v)[:80] if v is not None else ""}


def _infer_schema_from_response(data) -> tuple[dict, list]:
    """Given a parsed JSON response, return (schema_dict, sample_rows)."""
    if isinstance(data, list):
        sample = data[0] if data else {}
        rows = data[:20]
    elif isinstance(data, dict):
        # Try common envelope keys: data, results, items, records, response
        for key in ("data", "results", "items", "records", "response", "list"):
            if isinstance(data.get(key), list) and data[key]:
                rows = data[key][:20]
                sample = rows[0]
                break
        else:
            sample = data
            rows = [data]
    else:
        return {"fields": {}, "source": "inferred"}, []

    fields: dict = {}
    _walk_obj(sample, fields, "")
    return {
        "fields": fields,
        "total_fields": len(fields),
        "source": "inferred_from_response",
        "sample_count": len(rows),
    }, rows


async def _rest_api(base_url: Optional[str], creds: dict, cfg: dict, db=None, last_sync=None) -> tuple[dict, list, Optional[str]]:
    if not base_url:
        return {}, [], "No Base URL configured"

    # ── Range partition scan ──────────────────────────────────────────────────
    # If any query param is {{$range:min:max}}, iterate that param over min→max,
    # call the endpoint once per value, and aggregate all rows into one result.
    import re as _re
    raw_qp = cfg.get("queryParams") or {}
    range_key = None
    range_min = range_max = 0
    for k, v in raw_qp.items():
        m = _re.match(r'^\{\{\$range:(\d+):(\d+)\}\}$', str(v))
        if m:
            range_key = k
            range_min = int(m.group(1))
            range_max = int(m.group(2))
            break

    if range_key:
        all_rows: list = []
        merged_schema: dict = {}
        for val in range(range_min, range_max + 1):
            iter_qp = {k: (str(val) if k == range_key else v) for k, v in raw_qp.items()}
            iter_cfg = {**cfg, "queryParams": iter_qp}
            schema, rows, err = await _rest_api(base_url, creds, iter_cfg, db=db)
            if not err and rows:
                all_rows.extend(rows)
                if not merged_schema:
                    merged_schema = schema
        if all_rows:
            merged_schema["sample_count"] = len(all_rows)
            merged_schema["range_param"] = range_key
            merged_schema["range"] = f"{range_min}–{range_max}"
            return merged_schema, all_rows, None
        return {}, [], f"No data returned from any {range_key} value in range {range_min}–{range_max}"
    # ─────────────────────────────────────────────────────────────────────────

    path = cfg.get("path", "")
    method = cfg.get("method", "GET").lower()
    url = base_url.rstrip("/") + (path if path.startswith("/") else f"/{path}")
    if raw_qp:
        import urllib.parse as _urlparse
        resolved_qp = await _resolve_query_params(raw_qp, last_sync=last_sync, db=db)
        qs = _urlparse.urlencode(resolved_qp)
        url = url + ("&" if "?" in url else "?") + qs

    token = await _resolve_bearer_token(creds, db=db)
    headers = {}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    elif creds.get("username") and creds.get("password"):
        import base64 as _b64
        _basic = _b64.b64encode(f"{creds['username']}:{creds['password']}".encode()).decode()
        headers["Authorization"] = f"Basic {_basic}"
    key_name = creds.get("keyName")
    key_value = creds.get("keyValue")
    if key_name and key_value:
        headers[key_name] = key_value
    extra_headers = cfg.get("headers") or {}
    if isinstance(extra_headers, dict):
        headers.update(await _resolve_headers(extra_headers, db=db))

    body_raw = cfg.get("body")
    req_kwargs: dict = {"headers": headers}
    if body_raw and method in ("post", "put", "patch"):
        import json as _json
        try:
            req_kwargs["json"] = _json.loads(body_raw)
        except Exception:
            req_kwargs["content"] = body_raw.encode()
            req_kwargs.setdefault("headers", {})["Content-Type"] = "application/json"

    async with httpx.AsyncClient(timeout=15, follow_redirects=True) as client:
        fn = getattr(client, method)
        r = await fn(url, **req_kwargs)
        if r.status_code in (401, 403):
            return {}, [], f"Auth failed ({r.status_code}) — check your token or credentials"
        if not r.is_success:
            return {}, [], f"Endpoint returned {r.status_code}: {r.text[:300]}"
        try:
            data = r.json()
        except Exception:
            return {}, [], f"Response is not JSON (content-type: {r.headers.get('content-type', '?')})"

    schema, rows = _infer_schema_from_response(data)
    return schema, rows, None


async def test_credentials(connector_type: str, base_url: Optional[str], credentials: Optional[dict], config: Optional[dict] = None, db=None) -> tuple[bool, str, int]:
    """Returns (success, message, latency_ms)."""
    import time
    creds = credentials or {}
    cfg = config or {}
    start = time.time()
    try:
        if connector_type == "HUBSPOT":
            ok, msg = await _hubspot_test(creds, cfg)
        elif connector_type == "SALESFORCE":
            ok, msg = await _salesforce_test(base_url, creds)
        elif connector_type == "FIREFLIES":
            ok, msg = await _fireflies_test(creds)
        elif connector_type == "GITHUB":
            ok, msg = await _github_test(creds)
        elif connector_type in ("POSTGRESQL", "MYSQL"):
            from db_connector import test_db_connection, _build_db_config
            db_cfg = _build_db_config(creds, cfg)
            return await test_db_connection(connector_type, db_cfg)
        elif connector_type == "FILE_UPLOAD":
            return True, "File upload connector — no connection test needed", int((time.time() - start) * 1000)
        elif connector_type in ("RELATIONAL_DB", "MONGODB", "DATA_WAREHOUSE"):
            return True, "Credential format accepted — live connection test not available in preview", int((time.time() - start) * 1000)
        elif connector_type == "WHATSAPP":
            ok, msg = await _whatsapp_test(cfg)
        elif connector_type == "REST_API":
            ok, msg = await _rest_api_test(base_url, creds, cfg, db=db)
        else:
            ok, msg = await _generic_bearer_test(base_url, creds)
        latency = int((time.time() - start) * 1000)
        return ok, msg, latency
    except Exception as e:
        return False, str(e), int((time.time() - start) * 1000)


# ── HubSpot ────────────────────────────────────────────────────────────────

async def _hubspot_test(creds: dict, cfg: dict = {}) -> tuple[bool, str]:
    token = creds.get("token") or creds.get("access_token") or creds.get("api_key")
    if not token:
        return False, "No Bearer token found in credentials"
    obj = cfg.get("hubspotObject", "contacts")
    async with httpx.AsyncClient(timeout=10) as client:
        r = await client.get(
            f"https://api.hubapi.com/crm/v3/properties/{obj}",
            headers={"Authorization": f"Bearer {token}"},
            params={"limit": 1},
        )
        if r.status_code == 401:
            return False, "Invalid API token — HubSpot returned 401 Unauthorized"
        if r.status_code == 403:
            return False, f"Token lacks required scopes for {obj}"
        if not r.is_success:
            return False, f"HubSpot returned {r.status_code}: {r.text[:200]}"
        return True, f"HubSpot credentials verified — {obj} API accessible"


# Key properties to fetch per object type
_HUBSPOT_KEY_PROPS: dict[str, list[str]] = {
    "contacts": [
        "firstname", "lastname", "email", "phone", "company",
        "jobtitle", "lifecyclestage", "createdate", "lastmodifieddate",
        "hs_lead_status", "city", "country", "annualrevenue",
    ],
    "companies": [
        "name", "domain", "industry", "city", "country", "phone",
        "numberofemployees", "annualrevenue", "lifecyclestage",
        "createdate", "hs_lastmodifieddate", "hs_lead_status",
    ],
    "deals": [
        "dealname", "amount", "dealstage", "pipeline", "closedate",
        "createdate", "hs_lastmodifieddate", "hubspot_owner_id",
    ],
    "tickets": [
        "subject", "content", "hs_pipeline", "hs_pipeline_stage",
        "hs_ticket_priority", "createdate", "hs_lastmodifieddate",
    ],
    "line_items": [
        "name", "quantity", "price", "amount", "hs_product_id",
        "createdate", "hs_lastmodifieddate",
    ],
    "products": [
        "name", "description", "price", "hs_sku",
        "createdate", "hs_lastmodifieddate",
    ],
}


async def _hubspot(creds: dict, cfg: dict = {}) -> tuple[dict, list, Optional[str]]:
    token = creds.get("token") or creds.get("access_token") or creds.get("api_key")
    if not token:
        return {}, [], "No Bearer token configured"

    obj = cfg.get("hubspotObject", "contacts")

    async with httpx.AsyncClient(timeout=15) as client:
        # Fetch properties for the chosen object type
        props_r = await client.get(
            f"https://api.hubapi.com/crm/v3/properties/{obj}",
            headers={"Authorization": f"Bearer {token}"},
        )
        if not props_r.is_success:
            return {}, [], f"HubSpot /properties/{obj} returned {props_r.status_code}: {props_r.text[:300]}"

        props_data = props_r.json()
        results = props_data.get("results", [])

        fields = {}
        for p in results:
            name = p.get("name", "")
            fields[name] = {
                "label": p.get("label", name),
                "type": p.get("type", "string"),
                "field_type": p.get("fieldType", "text"),
                "group_name": p.get("groupName", ""),
                "description": p.get("description", ""),
                "options": [o.get("label") for o in p.get("options", [])] if p.get("options") else [],
                "read_only": p.get("readOnlyValue", False),
                "hidden": p.get("hidden", False),
            }

        raw_schema = {
            "object_type": obj,
            "source": "hubspot",
            "fields": fields,
            "total_properties": len(fields),
        }

        # Fetch all records for the chosen object (paginated, up to 500)
        sample_rows = []
        try:
            key_props = _HUBSPOT_KEY_PROPS.get(obj, list(fields.keys())[:15])
            after = None
            while len(sample_rows) < 500:
                body: dict = {
                    "limit": 100,
                    "properties": key_props,
                    "filterGroups": [],
                }
                if after:
                    body["after"] = after
                page_r = await client.post(
                    f"https://api.hubapi.com/crm/v3/objects/{obj}/search",
                    headers={
                        "Authorization": f"Bearer {token}",
                        "Content-Type": "application/json",
                    },
                    json=body,
                )
                if not page_r.is_success:
                    break
                page_data = page_r.json()
                for record in page_data.get("results", []):
                    row = {"hs_object_id": record.get("id")}
                    row.update(record.get("properties", {}))
                    sample_rows.append(row)
                next_page = page_data.get("paging", {}).get("next", {})
                after = next_page.get("after") if next_page else None
                if not after:
                    break
        except Exception:
            pass  # sample rows are optional

        raw_schema["total_records"] = len(sample_rows)
        return raw_schema, sample_rows, None


# ── Salesforce ─────────────────────────────────────────────────────────────

async def _salesforce_test(base_url: Optional[str], creds: dict) -> tuple[bool, str]:
    if not base_url:
        return False, "No Base URL configured"
    token = creds.get("token") or creds.get("access_token")
    if not token:
        return False, "No access token configured"
    async with httpx.AsyncClient(timeout=10) as client:
        r = await client.get(
            f"{base_url.rstrip('/')}/services/data/",
            headers={"Authorization": f"Bearer {token}"},
        )
        if r.status_code in (401, 403):
            return False, f"Salesforce returned {r.status_code} — token expired or invalid"
        if not r.is_success:
            return False, f"Salesforce returned {r.status_code}"
        return True, "Salesforce credentials verified"


async def _salesforce(base_url: Optional[str], creds: dict) -> tuple[dict, list, Optional[str]]:
    if not base_url:
        return {}, [], "No Base URL configured"
    token = creds.get("token") or creds.get("access_token")
    if not token:
        return {}, [], "No access token configured"
    async with httpx.AsyncClient(timeout=15) as client:
        r = await client.get(
            f"{base_url.rstrip('/')}/services/data/v60.0/sobjects/Contact/describe",
            headers={"Authorization": f"Bearer {token}"},
        )
        if not r.is_success:
            return {}, [], f"Salesforce returned {r.status_code}"
        data = r.json()
        fields = {f["name"]: {"label": f["label"], "type": f["type"], "length": f.get("length")} for f in data.get("fields", [])}
        return {"object": "Contact", "fields": fields}, [], None


# ── Fireflies ──────────────────────────────────────────────────────────────

FIREFLIES_URL = "https://api.fireflies.ai/graphql"


async def _fireflies_test(creds: dict) -> tuple[bool, str]:
    token = creds.get("token") or creds.get("access_token") or creds.get("api_key")
    if not token:
        return False, "No API key configured"
    async with httpx.AsyncClient(timeout=10) as client:
        r = await client.post(
            FIREFLIES_URL,
            headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
            json={"query": "{ user { user_id name email } }"},
        )
        if r.status_code == 401:
            return False, "Invalid API key — Fireflies returned 401 Unauthorized"
        if not r.is_success:
            return False, f"Fireflies returned {r.status_code}: {r.text[:200]}"
        data = r.json()
        if "errors" in data:
            return False, f"Fireflies API error: {data['errors'][0].get('message', 'unknown error')}"
        user = data.get("data", {}).get("user", {})
        name = user.get("name", "")
        return True, f"Fireflies credentials verified — connected as {name}"


async def _fireflies(creds: dict) -> tuple[dict, list, Optional[str]]:
    token = creds.get("token") or creds.get("access_token") or creds.get("api_key")
    if not token:
        return {}, [], "No API key configured"

    async with httpx.AsyncClient(timeout=20) as client:
        # Fetch recent transcripts
        r = await client.post(
            FIREFLIES_URL,
            headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
            json={
                "query": """
                {
                  transcripts(limit: 5) {
                    id
                    title
                    date
                    duration
                    organizer_email
                    participants
                    summary {
                      keywords
                      action_items
                      overview
                      outline
                    }
                    sentences {
                      index
                      speaker_name
                      text
                      start_time
                      end_time
                    }
                  }
                }
                """
            },
        )
        if not r.is_success:
            return {}, [], f"Fireflies returned {r.status_code}: {r.text[:300]}"

        data = r.json()
        if "errors" in data:
            return {}, [], f"Fireflies API error: {data['errors'][0].get('message', 'unknown error')}"

        transcripts = data.get("data", {}).get("transcripts", []) or []

        raw_schema = {
            "source": "fireflies",
            "object_type": "transcript",
            "fields": {
                "id": {"type": "string", "label": "Transcript ID"},
                "title": {"type": "string", "label": "Meeting Title"},
                "date": {"type": "datetime", "label": "Meeting Date"},
                "duration": {"type": "integer", "label": "Duration (seconds)"},
                "organizer_email": {"type": "email", "label": "Organizer Email"},
                "participants": {"type": "array", "label": "Participant Emails"},
                "summary.keywords": {"type": "array", "label": "Keywords"},
                "summary.action_items": {"type": "array", "label": "Action Items"},
                "summary.overview": {"type": "text", "label": "Meeting Overview"},
                "summary.outline": {"type": "text", "label": "Meeting Outline"},
                "sentences.speaker_name": {"type": "string", "label": "Speaker Name"},
                "sentences.text": {"type": "text", "label": "Transcript Sentence"},
                "sentences.start_time": {"type": "float", "label": "Start Time (s)"},
                "sentences.end_time": {"type": "float", "label": "End Time (s)"},
            },
            "total_properties": 14,
            "total_transcripts_fetched": len(transcripts),
        }

        sample_rows = [
            {
                "id": t.get("id"),
                "title": t.get("title"),
                "date": t.get("date"),
                "duration": t.get("duration"),
                "organizer_email": t.get("organizer_email"),
                "participants": t.get("participants", []),
                "overview": (t.get("summary") or {}).get("overview", ""),
                "action_items": (t.get("summary") or {}).get("action_items", []),
                "keywords": (t.get("summary") or {}).get("keywords", []),
                "sentence_count": len(t.get("sentences") or []),
            }
            for t in transcripts
        ]

        return raw_schema, sample_rows, None


# ── REST API test ──────────────────────────────────────────────────────────

async def _rest_api_test(base_url: Optional[str], creds: dict, cfg: dict, db=None) -> tuple[bool, str]:
    import json as _json
    if not base_url:
        return False, _json.dumps({"steps": [{"step": "config", "ok": False, "detail": "No Base URL configured"}]})

    steps = []
    token = None

    # ── Step 1: resolve auth token ──────────────────────────────────────────
    auth_mode = "none"
    if creds.get("authConnectorId"):
        auth_mode = "connector"
    elif creds.get("tokenEndpointUrl"):
        auth_mode = "login_endpoint"
    elif creds.get("token"):
        auth_mode = "static"

    if auth_mode == "static":
        token = creds["token"]
        steps.append({"step": "auth", "ok": True, "detail": "Using static bearer token"})

    elif auth_mode == "login_endpoint":
        login_url = creds["tokenEndpointUrl"]
        method = creds.get("tokenEndpointMethod", "POST")
        try:
            import json as _json2
            body = _json2.loads(creds.get("tokenEndpointBody", "{}"))
        except Exception:
            body = {}
        token_path = creds.get("tokenPath", "token")
        try:
            async with httpx.AsyncClient(timeout=10) as client:
                fn = getattr(client, method.lower())
                r = await fn(login_url, json=body)
            if not r.is_success:
                steps.append({"step": "auth", "ok": False,
                    "detail": f"POST {login_url} → {r.status_code} {r.reason_phrase}",
                    "body_preview": r.text[:300]})
                return False, _json.dumps({"steps": steps})
            data = r.json()
            val = data
            for part in token_path.split("."):
                val = val[part]
            token = str(val)
            steps.append({"step": "auth", "ok": True,
                "detail": f"POST {login_url} → {r.status_code} OK  ·  token field '{token_path}' extracted"})
        except Exception as e:
            # Include the actual response body so user can see the real key names
            body_preview = ""
            try:
                body_preview = r.text[:400]
            except Exception:
                pass
            steps.append({"step": "auth", "ok": False,
                "detail": f"Login request failed: {e}  ·  Token path '{token_path}' not found in response",
                "body_preview": body_preview})
            return False, _json.dumps({"steps": steps})

    elif auth_mode == "connector":
        try:
            token = await _resolve_bearer_token(creds, db=db)
            steps.append({"step": "auth", "ok": True, "detail": "Token fetched from linked connector"})
        except Exception as e:
            steps.append({"step": "auth", "ok": False, "detail": f"Linked connector auth failed: {e}"})
            return False, _json.dumps({"steps": steps})

    elif creds.get("username") and creds.get("password"):
        steps.append({"step": "auth", "ok": True, "detail": "Using Basic Auth (username/password)"})

    else:
        steps.append({"step": "auth", "ok": True, "detail": "No authentication configured"})

    # ── Step 2: call the actual endpoint ────────────────────────────────────
    path = cfg.get("path", "")
    endpoint_method = cfg.get("method", "GET").lower()
    url = base_url.rstrip("/") + (path if path.startswith("/") else f"/{path}")
    raw_qp = cfg.get("queryParams") or {}
    if raw_qp:
        import urllib.parse as _urlparse
        import re as _re2
        # Resolve range params to their min value for the test call
        resolved_for_test = {
            k: (_re2.sub(r'^\{\{\$range:(\d+):\d+\}\}$', r'\1', str(v)))
            for k, v in raw_qp.items()
        }
        resolved_qp = await _resolve_query_params(resolved_for_test, db=db)
        qs = _urlparse.urlencode(resolved_qp)
        url = url + ("&" if "?" in url else "?") + qs
    headers = {}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    elif creds.get("username") and creds.get("password"):
        import base64 as _b64
        _basic = _b64.b64encode(f"{creds['username']}:{creds['password']}".encode()).decode()
        headers["Authorization"] = f"Basic {_basic}"
    key_name = creds.get("keyName")
    key_value = creds.get("keyValue")
    if key_name and key_value:
        headers[key_name] = key_value
    # Merge any extra custom headers stored in config
    extra_headers = cfg.get("headers") or {}
    if isinstance(extra_headers, dict):
        headers.update(await _resolve_headers(extra_headers, db=db))
    body_raw = cfg.get("body")
    req_kwargs: dict = {"headers": headers}
    if body_raw and endpoint_method in ("post", "put", "patch"):
        import json as _json2
        try:
            req_kwargs["json"] = _json2.loads(body_raw)
        except Exception:
            req_kwargs["content"] = body_raw.encode()
    try:
        async with httpx.AsyncClient(timeout=10, follow_redirects=True) as client:
            fn = getattr(client, endpoint_method)
            r = await fn(url, **req_kwargs)
        ok = r.is_success
        detail = f"{endpoint_method.upper()} {url} → {r.status_code} {r.reason_phrase}"
        if r.status_code == 401:
            detail += "  ·  Token was accepted by login but rejected by endpoint — may be expired or wrong scope"
        elif r.status_code == 403:
            detail += "  ·  Authenticated but forbidden — check API permissions"
        elif r.status_code == 404:
            detail += "  ·  Endpoint path not found — check the path in config"
        step_entry: dict = {"step": "request", "ok": ok, "detail": detail}
        if not ok:
            step_entry["body_preview"] = r.text[:400]
        steps.append(step_entry)
        return ok, _json.dumps({"steps": steps})
    except Exception as e:
        steps.append({"step": "request", "ok": False, "detail": f"Request failed: {e}"})
        return False, _json.dumps({"steps": steps})


# ── Generic Bearer ─────────────────────────────────────────────────────────

async def _generic_bearer_test(base_url: Optional[str], creds: dict) -> tuple[bool, str]:
    if not base_url:
        return False, "No Base URL configured"
    token = creds.get("token") or creds.get("api_key")
    headers = {"Authorization": f"Bearer {token}"} if token else {}
    async with httpx.AsyncClient(timeout=10) as client:
        r = await client.get(base_url, headers=headers)
        if r.status_code in (401, 403):
            return False, f"Returned {r.status_code} — invalid credentials"
        return r.is_success, f"Returned {r.status_code}"


# ── WhatsApp ──────────────────────────────────────────────────────────────

import os as _os
_WHATSAPP_API = _os.environ.get("WHATSAPP_SERVICE_URL", "http://whatsapp-service:8025")


async def _whatsapp_test(cfg: dict) -> tuple[bool, str]:
    connector_id = cfg.get("connectorId") or cfg.get("connector_id", "")
    if not connector_id:
        return False, "WhatsApp connector ID not available for status check"
    async with httpx.AsyncClient(timeout=10) as client:
        r = await client.get(f"{_WHATSAPP_API}/api/v1/sessions/{connector_id}/status")
        if not r.is_success:
            return False, f"WhatsApp service returned {r.status_code}"
        data = r.json()
        status = data.get("status", "disconnected")
        if status == "connected":
            phone = data.get("phoneNumber", "unknown")
            return True, f"WhatsApp connected — linked to {phone}, {data.get('monitoredCount', 0)} chats monitored"
        return False, f"WhatsApp session is {status} — please scan QR code to connect"


async def _whatsapp_schema(cfg: dict) -> tuple[dict, list, Optional[str]]:
    connector_id = cfg.get("connectorId") or cfg.get("connector_id", "")
    if not connector_id:
        return {}, [], "WhatsApp connector ID not available"
    async with httpx.AsyncClient(timeout=15) as client:
        r = await client.get(f"{_WHATSAPP_API}/api/v1/sessions/{connector_id}/schema")
        if not r.is_success:
            return {}, [], f"WhatsApp service returned {r.status_code}"
        data = r.json()
        return data.get("schema", {}), data.get("sample_rows", []), None


# ── GitHub ────────────────────────────────────────────────────────────────

GITHUB_API = "https://api.github.com"
GITHUB_DEFAULT_HEADERS = {
    "Accept": "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
}

# Supported entity presets — user can pick a path via the pipeline Source node,
# or override with a custom path.
GITHUB_PRESETS = {
    "commits": "/repos/{owner}/{repo}/commits",
    "pulls": "/repos/{owner}/{repo}/pulls?state=all",
    "pull_reviews": "/repos/{owner}/{repo}/pulls/{pull_number}/reviews",
    "issues": "/repos/{owner}/{repo}/issues?state=all",
    "repo_contributors": "/repos/{owner}/{repo}/contributors",
    "org_repos": "/orgs/{org}/repos",
    "org_members": "/orgs/{org}/members",
    "user_repos": "/users/{username}/repos",
    "org_events": "/orgs/{org}/events",
}


def _github_headers(token: str) -> dict:
    return {**GITHUB_DEFAULT_HEADERS, "Authorization": f"Bearer {token}"}


def _resolve_github_path(path: str, cfg: dict) -> str:
    """Substitute {owner}, {repo}, {org}, {username} placeholders from config."""
    for key in ("owner", "repo", "org", "username", "pull_number"):
        v = cfg.get(key) or cfg.get(key.upper())
        if v:
            path = path.replace("{" + key + "}", str(v))
    return path


async def _github_test(creds: dict) -> tuple[bool, str]:
    token = creds.get("token") or creds.get("api_key")
    if not token:
        return False, "No Personal Access Token configured"
    async with httpx.AsyncClient(timeout=10) as client:
        r = await client.get(f"{GITHUB_API}/user", headers=_github_headers(token))
        if r.status_code == 401:
            return False, "Invalid PAT — GitHub returned 401 Unauthorized"
        if r.status_code == 403:
            return False, f"PAT rejected ({r.status_code}) — check token scopes. {r.text[:200]}"
        if not r.is_success:
            return False, f"GitHub returned {r.status_code}: {r.text[:200]}"
        data = r.json()
        login = data.get("login", "unknown")
        rate_remaining = r.headers.get("x-ratelimit-remaining", "?")
        return True, f"GitHub PAT verified — connected as @{login} ({rate_remaining} req remaining this hour)"


async def _github(creds: dict, cfg: dict) -> tuple[dict, list, Optional[str]]:
    token = creds.get("token") or creds.get("api_key")
    if not token:
        return {}, [], "No Personal Access Token configured"

    # Pick path: explicit cfg.path > preset name > default to /user for verification
    path = cfg.get("path") or ""
    preset = cfg.get("preset") or cfg.get("entity")
    if not path and preset and preset in GITHUB_PRESETS:
        path = GITHUB_PRESETS[preset]
    if not path:
        path = "/user"

    path = _resolve_github_path(path, cfg)
    if "{" in path:
        return {}, [], f"Unresolved placeholder in path: {path} — set owner/repo/org in connector config"

    url = GITHUB_API.rstrip("/") + (path if path.startswith("/") else f"/{path}")
    # Preview: ask for 5 rows max to keep schema fetch light
    if "?" in url:
        url += "&per_page=5"
    else:
        url += "?per_page=5"

    async with httpx.AsyncClient(timeout=15, follow_redirects=True) as client:
        r = await client.get(url, headers=_github_headers(token))
        if r.status_code in (401, 403):
            return {}, [], f"Auth failed ({r.status_code}) — {r.text[:200]}"
        if r.status_code == 404:
            return {}, [], f"Not found: {path} — check owner/repo/org values"
        if not r.is_success:
            return {}, [], f"GitHub returned {r.status_code}: {r.text[:300]}"
        try:
            data = r.json()
        except Exception:
            return {}, [], "Response is not JSON"

    schema, rows = _infer_schema_from_response(data)
    schema["_github_rate_remaining"] = r.headers.get("x-ratelimit-remaining", "?")
    return schema, rows, None
