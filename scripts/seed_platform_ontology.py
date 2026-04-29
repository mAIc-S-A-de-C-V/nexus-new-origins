"""
Seed the platform's own usage data into the ontology so superadmins can
explore tenants, token spend, and the Bedrock catalog through Nexus itself.

What it creates (under tenant-001 — the superadmin's home tenant):
  - Object type:  NexusTenant         · one record per tenant in the platform
  - Object type:  TokenUsageEvent     · one record per token_usage row
  - Object type:  BedrockModel        · one record per model in the catalog
  - REST_API connector pointing at admin-service so the user can re-run the
    ingest as a pipeline later (this script does the initial bulk-load
    directly via the ingest endpoint to keep the demo fast).

Run from the host (no auth needed — these endpoints accept x-tenant-id):
    python3 scripts/seed_platform_ontology.py

Idempotent — re-running upserts (same record IDs) and skips type creation
if the names already exist for the tenant.
"""
from __future__ import annotations

import json
import os
import sys
from typing import Any
from uuid import uuid4

import urllib.request
import urllib.error
import psycopg2
import psycopg2.extras

# ── Endpoints (override via env if running from outside docker-compose) ─────

CONNECTOR_API = os.environ.get("CONNECTOR_API", "http://localhost:8001")
ONTOLOGY_API  = os.environ.get("ONTOLOGY_API",  "http://localhost:8004")
ADMIN_API     = os.environ.get("ADMIN_API",     "http://localhost:8022")
PG_DSN        = os.environ.get("PG_DSN",
    "host=localhost port=5432 dbname=nexus user=nexus password=nexus_pass")

# All artifacts are created under the superadmin's home tenant.
SUPERADMIN_TENANT = os.environ.get("SUPERADMIN_TENANT", "tenant-001")

# Pricing copy (mirrors backend/admin_service/routers/admin.py MODEL_PRICES_PER_M).
MODEL_PRICES = {
    "claude-opus-4-7":     (5.00, 25.00),
    "claude-opus-4.7":     (5.00, 25.00),
    "claude-sonnet-4-6":   (3.00, 15.00),
    "claude-sonnet-4.6":   (3.00, 15.00),
    "claude-haiku-4-5":    (1.00, 5.00),
    "claude-haiku-4-5-20251001": (1.00, 5.00),
    "amazon-nova-premier": (2.50, 12.50),
    "amazon-nova-pro":     (0.80, 3.20),
    "amazon-nova-lite":    (0.06, 0.24),
    "amazon-nova-micro":   (0.035, 0.14),
    "deepseek-v3-2":       (0.62, 1.85),
    "mistral-large-3":     (2.00, 6.00),
    "mistral-small-3":     (0.20, 0.60),
    "llama-4-scout-fp8":   (0.20, 0.60),
    "llama-4-maverick":    (0.27, 0.85),
}

CATALOG = [
    # (model_id, label, provider, tier, in_price, out_price, ctx, use_case)
    ("claude-opus-4-7",     "Claude Opus 4.7",     "anthropic", "frontier",   5.00,   25.00,  1_000_000, "Complex agents, coding, deep reasoning"),
    ("claude-sonnet-4-6",   "Claude Sonnet 4.6",   "anthropic", "frontier",   3.00,   15.00,  1_000_000, "Workhorse — RAG, generation, tool use"),
    ("claude-haiku-4-5",    "Claude Haiku 4.5",    "anthropic", "frontier",   1.00,    5.00,    200_000, "Routing, classification, sub-tasks"),
    ("amazon-nova-premier", "Amazon Nova Premier", "amazon",    "productive", 2.50,   12.50,    300_000, "AWS-native backup, multi-modal"),
    ("amazon-nova-pro",     "Amazon Nova Pro",     "amazon",    "productive", 0.80,    3.20,    300_000, "Production volume"),
    ("deepseek-v3-2",       "DeepSeek V3.2",       "deepseek",  "productive", 0.62,    1.85,    128_000, "Economic reasoning"),
    ("mistral-large-3",     "Mistral Large 3",     "mistral",   "productive", 2.00,    6.00,    128_000, "Multilingual Europe / LATAM"),
    ("llama-4-scout-fp8",   "Llama 4 Scout (FP8)", "meta",      "productive", 0.20,    0.60, 10_000_000, "Open-weight, huge context"),
    ("llama-4-maverick",    "Llama 4 Maverick",    "meta",      "productive", 0.27,    0.85,  1_000_000, "Open-weight flagship"),
    ("amazon-nova-lite",    "Amazon Nova Lite",    "amazon",    "economic",   0.06,    0.24,    300_000, "Extraction, OCR-text"),
    ("amazon-nova-micro",   "Amazon Nova Micro",   "amazon",    "economic",   0.035,   0.14,    128_000, "Routing, intent detection"),
    ("mistral-small-3",     "Mistral Small 3",     "mistral",   "economic",   0.20,    0.60,     32_000, "Backup low-cost"),
]

BUCKET_LIMITS = {
    "S":   {"label": "Pilot",      "monthly_usd": 2_667,   "tokens_per_month_m": 60,    "concurrent_users": 25,    "agents": 3,   "records": 100_000},
    "M":   {"label": "Growth",     "monthly_usd": 5_333,   "tokens_per_month_m": 300,   "concurrent_users": 100,   "agents": 10,  "records": 500_000},
    "L":   {"label": "Scale",      "monthly_usd": 10_583,  "tokens_per_month_m": 750,   "concurrent_users": 250,   "agents": 30,  "records": 2_000_000},
    "XL":  {"label": "Production", "monthly_usd": 26_500,  "tokens_per_month_m": 2_400, "concurrent_users": 600,   "agents": 80,  "records": 10_000_000},
    "XXL": {"label": "Enterprise", "monthly_usd": 291_083, "tokens_per_month_m": 24_000,"concurrent_users": 5_000, "agents": 500, "records": 100_000_000},
}


# ── HTTP helper ──────────────────────────────────────────────────────────────

def req(method: str, url: str, *, body: Any = None, headers: dict | None = None) -> Any:
    h = {"Content-Type": "application/json", "x-tenant-id": SUPERADMIN_TENANT}
    if headers:
        h.update(headers)
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(url, data=data, method=method, headers=h)
    try:
        with urllib.request.urlopen(r, timeout=60) as resp:
            raw = resp.read()
            if not raw:
                return None
            return json.loads(raw) if "json" in resp.headers.get("Content-Type", "") else raw
    except urllib.error.HTTPError as e:
        body_txt = e.read().decode("utf-8", "replace")[:500]
        raise RuntimeError(f"{method} {url} → {e.code}: {body_txt}") from e


# ── Connector + object types ─────────────────────────────────────────────────

def get_or_create_connector() -> str:
    name = "Platform Self-Telemetry"
    existing = req("GET", f"{CONNECTOR_API}/connectors") or []
    for c in existing:
        if c.get("name") == name:
            return c["id"]
    body = {
        "name": name,
        "type": "REST_API",
        "category": "Internal",
        "description": "admin-service usage feeds (tenants, token spend, Bedrock catalog)",
        "base_url": "http://admin-service:8022/admin",
        "auth_type": "Bearer",
        "tags": ["platform", "self-telemetry", "internal"],
        "config": {"page_size": 1000},
    }
    created = req("POST", f"{CONNECTOR_API}/connectors", body=body)
    return created["id"]


def get_or_create_ot(name: str, display: str, properties: list[dict], connector_id: str) -> str:
    existing = req("GET", f"{ONTOLOGY_API}/object-types") or []
    for ot in existing:
        if ot.get("name") == name:
            return ot["id"]
    body = {
        "id": str(uuid4()),
        "name": name,
        "display_name": display,
        "description": f"Auto-seeded by seed_platform_ontology.py — {display.lower()}",
        "properties": properties,
        "source_connector_ids": [connector_id],
        "version": 1,
        "schema_health": "healthy",
        "tenant_id": SUPERADMIN_TENANT,
    }
    created = req("POST", f"{ONTOLOGY_API}/object-types", body=body)
    return created["id"]


def prop(name: str, semantic: str, dtype: str, *, display: str | None = None,
         pii: str = "NONE", required: bool = False) -> dict:
    return {
        "id": str(uuid4()),
        "name": name,
        "display_name": display or name.replace("_", " ").title(),
        "semantic_type": semantic,
        "data_type": dtype,
        "pii_level": pii,
        "required": required,
        "sample_values": [],
    }


# ── Pull live data from postgres ─────────────────────────────────────────────

def fetch_tenant_records(conn) -> list[dict]:
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    cur.execute("""
      SELECT
        t.id, t.name, t.slug, t.plan, t.status, t.bucket_tier,
        t.created_at, t.updated_at,
        (SELECT COUNT(*) FROM object_records WHERE tenant_id = t.id) AS object_records_count,
        (SELECT COUNT(*) FROM agent_configs  WHERE tenant_id = t.id AND enabled = TRUE) AS agents_active,
        (SELECT COUNT(*) FROM pipelines       WHERE tenant_id = t.id) AS pipelines_total,
        (SELECT COUNT(*) FROM pipeline_runs   WHERE tenant_id = t.id) AS pipeline_runs_total,
        (SELECT COUNT(*) FROM connectors      WHERE tenant_id = t.id) AS connectors_total,
        (SELECT COALESCE(SUM(input_tokens) FILTER (WHERE created_at >= date_trunc('month', NOW())), 0) FROM token_usage WHERE tenant_id = t.id) AS month_input_tokens,
        (SELECT COALESCE(SUM(output_tokens) FILTER (WHERE created_at >= date_trunc('month', NOW())), 0) FROM token_usage WHERE tenant_id = t.id) AS month_output_tokens,
        (SELECT COALESCE(SUM(input_tokens), 0)  FROM token_usage WHERE tenant_id = t.id) AS lifetime_input_tokens,
        (SELECT COALESCE(SUM(output_tokens), 0) FROM token_usage WHERE tenant_id = t.id) AS lifetime_output_tokens
      FROM tenants t
      ORDER BY t.created_at
    """)
    rows = cur.fetchall()
    out = []
    for r in rows:
        bucket = BUCKET_LIMITS.get(r["bucket_tier"] or "S", BUCKET_LIMITS["S"])
        # Per-tenant cost calculation (lifetime + month)
        cur.execute("""
          SELECT model,
                 COALESCE(SUM(input_tokens), 0) AS input_total,
                 COALESCE(SUM(output_tokens), 0) AS output_total,
                 COALESCE(SUM(input_tokens) FILTER (WHERE created_at >= date_trunc('month', NOW())), 0) AS input_month,
                 COALESCE(SUM(output_tokens) FILTER (WHERE created_at >= date_trunc('month', NOW())), 0) AS output_month
          FROM token_usage WHERE tenant_id = %s GROUP BY model
        """, (r["id"],))
        cost_lifetime = 0.0
        cost_month = 0.0
        for m in cur.fetchall():
            in_p, out_p = MODEL_PRICES.get(m["model"], (3.00, 15.00))
            cost_lifetime += (m["input_total"]  / 1_000_000) * in_p + (m["output_total"]  / 1_000_000) * out_p
            cost_month    += (m["input_month"]  / 1_000_000) * in_p + (m["output_month"]  / 1_000_000) * out_p
        records_combined = r["object_records_count"]  # event count would require timescale; skipping for simplicity
        out.append({
            "id": r["id"],
            "tenant_id_value": r["id"],
            "name": r["name"],
            "slug": r["slug"],
            "plan": r["plan"],
            "status": r["status"],
            "bucket_tier": r["bucket_tier"] or "S",
            "bucket_label": bucket["label"],
            "bucket_monthly_usd": bucket["monthly_usd"],
            "tokens_per_month_limit_m": bucket["tokens_per_month_m"],
            "agents_active": r["agents_active"],
            "agents_limit": bucket["agents"],
            "pipelines_total": r["pipelines_total"],
            "pipeline_runs_total": r["pipeline_runs_total"],
            "connectors_total": r["connectors_total"],
            "object_records_count": r["object_records_count"],
            "records_combined": records_combined,
            "records_limit": bucket["records"],
            "month_input_tokens": int(r["month_input_tokens"]),
            "month_output_tokens": int(r["month_output_tokens"]),
            "lifetime_input_tokens": int(r["lifetime_input_tokens"]),
            "lifetime_output_tokens": int(r["lifetime_output_tokens"]),
            "cost_month_usd": round(cost_month, 4),
            "cost_lifetime_usd": round(cost_lifetime, 4),
            "created_at": r["created_at"].isoformat() if r["created_at"] else None,
            "updated_at": r["updated_at"].isoformat() if r["updated_at"] else None,
        })
    return out


def fetch_token_events(conn, limit: int = 5000) -> list[dict]:
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    cur.execute("""
      SELECT id, tenant_id, service, model, input_tokens, output_tokens, user_id, created_at
      FROM token_usage
      ORDER BY created_at DESC
      LIMIT %s
    """, (limit,))
    out = []
    for r in cur.fetchall():
        in_p, out_p = MODEL_PRICES.get(r["model"], (3.00, 15.00))
        cost = (r["input_tokens"] / 1_000_000) * in_p + (r["output_tokens"] / 1_000_000) * out_p
        out.append({
            "id": r["id"],
            "tenant_id_value": r["tenant_id"],
            "service": r["service"],
            "model": r["model"],
            "input_tokens": int(r["input_tokens"]),
            "output_tokens": int(r["output_tokens"]),
            "input_price_per_m": in_p,
            "output_price_per_m": out_p,
            "cost_usd": round(cost, 6),
            "user_id": r["user_id"] or "",
            "created_at": r["created_at"].isoformat() if r["created_at"] else None,
        })
    return out


def catalog_records() -> list[dict]:
    return [
        {
            "id": m_id,
            "model_id": m_id,
            "label": label,
            "provider": provider,
            "tier": tier,
            "input_price_per_m": in_p,
            "output_price_per_m": out_p,
            "context_window": ctx,
            "use_case": use_case,
        }
        for (m_id, label, provider, tier, in_p, out_p, ctx, use_case) in CATALOG
    ]


# ── Ingest into object type ──────────────────────────────────────────────────

def ingest(ot_id: str, records: list[dict], pk: str = "id") -> int:
    if not records:
        return 0
    body = {"records": records, "pk_field": pk, "pipeline_id": "platform-self-telemetry"}
    res = req("POST", f"{ONTOLOGY_API}/object-types/{ot_id}/records/ingest", body=body)
    return int((res or {}).get("ingested", 0))


# ── Main ─────────────────────────────────────────────────────────────────────

def main():
    print(f"Seeding platform ontology under tenant: {SUPERADMIN_TENANT}\n")

    conn = psycopg2.connect(PG_DSN)

    # 1. Connector
    print("→ Connector …", end=" ", flush=True)
    connector_id = get_or_create_connector()
    print(connector_id)

    # 2. Object types
    nexus_tenant_props = [
        prop("id",                     "IDENTIFIER", "string", display="Tenant ID", required=True),
        prop("tenant_id_value",        "IDENTIFIER", "string"),
        prop("name",                   "TEXT",       "string"),
        prop("slug",                   "TEXT",       "string"),
        prop("plan",                   "CATEGORY",   "string"),
        prop("status",                 "STATUS",     "string"),
        prop("bucket_tier",            "CATEGORY",   "string"),
        prop("bucket_label",           "TEXT",       "string"),
        prop("bucket_monthly_usd",     "CURRENCY",   "float"),
        prop("tokens_per_month_limit_m", "QUANTITY", "float"),
        prop("agents_active",          "QUANTITY",   "integer"),
        prop("agents_limit",           "QUANTITY",   "integer"),
        prop("pipelines_total",        "QUANTITY",   "integer"),
        prop("pipeline_runs_total",    "QUANTITY",   "integer"),
        prop("connectors_total",       "QUANTITY",   "integer"),
        prop("object_records_count",   "QUANTITY",   "integer"),
        prop("records_combined",       "QUANTITY",   "integer"),
        prop("records_limit",          "QUANTITY",   "integer"),
        prop("month_input_tokens",     "QUANTITY",   "integer"),
        prop("month_output_tokens",    "QUANTITY",   "integer"),
        prop("lifetime_input_tokens",  "QUANTITY",   "integer"),
        prop("lifetime_output_tokens", "QUANTITY",   "integer"),
        prop("cost_month_usd",         "CURRENCY",   "float"),
        prop("cost_lifetime_usd",      "CURRENCY",   "float"),
        prop("created_at",             "DATETIME",   "datetime"),
        prop("updated_at",             "DATETIME",   "datetime"),
    ]
    print("→ Object type NexusTenant …", end=" ", flush=True)
    nexus_tenant_id = get_or_create_ot("NexusTenant", "Nexus Tenant", nexus_tenant_props, connector_id)
    print(nexus_tenant_id)

    token_event_props = [
        prop("id",                     "IDENTIFIER", "string", required=True),
        prop("tenant_id_value",        "IDENTIFIER", "string"),
        prop("service",                "CATEGORY",   "string"),
        prop("model",                  "CATEGORY",   "string"),
        prop("input_tokens",           "QUANTITY",   "integer"),
        prop("output_tokens",          "QUANTITY",   "integer"),
        prop("input_price_per_m",      "CURRENCY",   "float"),
        prop("output_price_per_m",     "CURRENCY",   "float"),
        prop("cost_usd",               "CURRENCY",   "float"),
        prop("user_id",                "IDENTIFIER", "string"),
        prop("created_at",             "DATETIME",   "datetime"),
    ]
    print("→ Object type TokenUsageEvent …", end=" ", flush=True)
    token_event_id = get_or_create_ot("TokenUsageEvent", "Token Usage Event", token_event_props, connector_id)
    print(token_event_id)

    bedrock_props = [
        prop("id",                  "IDENTIFIER", "string", required=True),
        prop("model_id",            "IDENTIFIER", "string"),
        prop("label",               "TEXT",       "string"),
        prop("provider",            "CATEGORY",   "string"),
        prop("tier",                "CATEGORY",   "string"),
        prop("input_price_per_m",   "CURRENCY",   "float"),
        prop("output_price_per_m",  "CURRENCY",   "float"),
        prop("context_window",      "QUANTITY",   "integer"),
        prop("use_case",            "TEXT",       "string"),
    ]
    print("→ Object type BedrockModel …", end=" ", flush=True)
    bedrock_id = get_or_create_ot("BedrockModel", "Bedrock Model", bedrock_props, connector_id)
    print(bedrock_id)

    # 3. Ingest data
    print()
    tenants = fetch_tenant_records(conn)
    print(f"→ Ingesting {len(tenants)} NexusTenant records …", end=" ", flush=True)
    print(f"{ingest(nexus_tenant_id, tenants)} ingested")

    events = fetch_token_events(conn, limit=5000)
    print(f"→ Ingesting {len(events)} TokenUsageEvent records …", end=" ", flush=True)
    print(f"{ingest(token_event_id, events)} ingested")

    catalog = catalog_records()
    print(f"→ Ingesting {len(catalog)} BedrockModel records …", end=" ", flush=True)
    print(f"{ingest(bedrock_id, catalog)} ingested")

    print(f"\n✓ Done. Browse them in the Data Explorer logged in as a {SUPERADMIN_TENANT} user.")
    print("  Object types: NexusTenant · TokenUsageEvent · BedrockModel")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print(f"\n✗ Failed: {e}", file=sys.stderr)
        sys.exit(1)
