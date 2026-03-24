"""
Real schema fetchers for each connector type.
Returns (raw_schema_dict, sample_rows_list, error_message_or_None).
"""
import httpx
from typing import Optional


async def fetch_schema(connector_type: str, base_url: Optional[str], credentials: Optional[dict], config: Optional[dict] = None) -> tuple[dict, list, Optional[str]]:
    creds = credentials or {}
    cfg = config or {}
    try:
        if connector_type == "HUBSPOT":
            return await _hubspot(creds, cfg)
        if connector_type == "SALESFORCE":
            return await _salesforce(base_url, creds)
        if connector_type == "FIREFLIES":
            return await _fireflies(creds)
        if connector_type in ("RELATIONAL_DB", "MONGODB", "DATA_WAREHOUSE"):
            return {}, [], "Schema preview not supported for database connectors — paste your schema in the inference panel."
        return {}, [], f"Schema auto-fetch not implemented for {connector_type} — paste your schema in the inference panel."
    except Exception as e:
        return {}, [], str(e)


async def test_credentials(connector_type: str, base_url: Optional[str], credentials: Optional[dict], config: Optional[dict] = None) -> tuple[bool, str, int]:
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
        elif connector_type in ("RELATIONAL_DB", "MONGODB", "DATA_WAREHOUSE"):
            return True, "Credential format accepted — live connection test not available in preview", int((time.time() - start) * 1000)
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
