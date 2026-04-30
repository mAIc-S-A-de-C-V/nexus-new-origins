"""
Seed the full Finance app suite under tenant-001:

  Dashboards (kind='dashboard'):
    1. Finance Overview   — KPIs + cashflow trend + recent transactions
    2. Accounts           — list, balances, breakdown
    3. Accounts Receivable — open invoices, AR by status
    4. Accounts Payable    — open bills, AP by status
    5. Loans               — active loans + upcoming payment schedule

  Input apps (kind='app'):
    6. Add Account
    7. Add Counterparty
    8. Add Transaction        (multi-step wizard, full validations)
    9. Add Invoice
   10. Add Bill
   11. Add Loan

This script is the canonical reference for the app/dashboard surface — every
feature exposed in AppEditor.tsx (transforms, validations, confirmations,
onSuccess/onError, record-creator fields+steps, drill-down contextBindings,
filterBar, variables) is exercised somewhere in here.

Idempotent: matches existing apps by name+tenant and updates them. Re-runs
overwrite the canonical config without spawning duplicates.

Pre-req: scripts/seed_finance_ontology.py has been run (the 8 object types
must exist).

Run:
    python3 scripts/seed_finance_apps.py
"""
from __future__ import annotations

import json
import os
import sys
from typing import Any
from uuid import uuid4

import urllib.request
import urllib.error

ONTOLOGY_API = os.environ.get("ONTOLOGY_API", "http://localhost:8004")
TENANT       = os.environ.get("TENANT", "tenant-001")


# ── HTTP helper ──────────────────────────────────────────────────────────────

def req(method: str, url: str, *, body: Any = None) -> Any:
    h = {"Content-Type": "application/json", "x-tenant-id": TENANT}
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(url, data=data, method=method, headers=h)
    try:
        with urllib.request.urlopen(r, timeout=60) as resp:
            raw = resp.read()
            if not raw:
                return None
            return json.loads(raw)
    except urllib.error.HTTPError as e:
        body_txt = e.read().decode("utf-8", "replace")[:500]
        raise RuntimeError(f"{method} {url} → {e.code}: {body_txt}") from e


def find_object_types() -> dict[str, str]:
    """Return name → id for all object types under TENANT."""
    ots = req("GET", f"{ONTOLOGY_API}/object-types") or []
    out = {ot["name"]: ot["id"] for ot in ots}
    required = ["Account", "Counterparty", "FinanceCategory", "Transaction",
                "Invoice", "Bill", "Loan", "PaymentSchedule"]
    missing = [n for n in required if n not in out]
    if missing:
        raise RuntimeError(
            f"Missing object types: {missing}. "
            f"Run scripts/seed_finance_ontology.py first."
        )
    return out


def upsert_app(name: str, app_body: dict) -> str:
    """Create or update an app by (tenant, name). Returns the app id."""
    existing = req("GET", f"{ONTOLOGY_API}/apps") or []
    for a in existing:
        if a.get("name") == name:
            app_id = a["id"]
            update_body = {
                "name":             app_body.get("name"),
                "description":      app_body.get("description"),
                "icon":             app_body.get("icon"),
                "object_type_ids":  app_body.get("object_type_ids", []),
                "components":       app_body.get("components", []),
                "settings":         app_body.get("settings", {}),
                "kind":             app_body.get("kind"),
            }
            req("PUT", f"{ONTOLOGY_API}/apps/{app_id}", body=update_body)
            return app_id
    created = req("POST", f"{ONTOLOGY_API}/apps", body=app_body)
    return created["id"]


# ── Widget builders ──────────────────────────────────────────────────────────

def metric_card(wid: str, title: str, ot_id: str, field: str, agg: str,
                gx: int, gy: int, span: int, h: int = 2,
                filters: list[dict] | None = None) -> dict:
    return {
        "id": wid,
        "type": "metric-card",
        "title": title,
        "objectTypeId": ot_id,
        "field": field,
        "aggregation": agg,
        "filters": filters or [],
        "colSpan": span, "gridX": gx, "gridY": gy, "gridH": h,
    }


def data_table(wid: str, title: str, ot_id: str, columns: list[str],
               gx: int, gy: int, span: int, h: int = 6,
               filters: list[dict] | None = None,
               max_rows: int | None = None) -> dict:
    return {
        "id": wid,
        "type": "data-table",
        "title": title,
        "objectTypeId": ot_id,
        "columns": columns,
        "filters": filters or [],
        "maxRows": max_rows or 25,
        "colSpan": span, "gridX": gx, "gridY": gy, "gridH": h,
    }


def bar_chart(wid: str, title: str, ot_id: str, label_field: str,
              value_field: str, agg: str, gx: int, gy: int, span: int,
              h: int = 5, filters: list[dict] | None = None) -> dict:
    return {
        "id": wid,
        "type": "bar-chart",
        "title": title,
        "objectTypeId": ot_id,
        "labelField": label_field,
        "valueField": value_field,
        "aggregation": agg,
        "filters": filters or [],
        "colSpan": span, "gridX": gx, "gridY": gy, "gridH": h,
    }


def line_chart(wid: str, title: str, ot_id: str, x_field: str,
               value_field: str, agg: str, time_bucket: str,
               gx: int, gy: int, span: int, h: int = 5) -> dict:
    return {
        "id": wid,
        "type": "line-chart",
        "title": title,
        "objectTypeId": ot_id,
        "xField": x_field,
        "valueField": value_field,
        "aggregation": agg,
        "timeBucket": time_bucket,
        "inheritDashboardFilter": True,
        "colSpan": span, "gridX": gx, "gridY": gy, "gridH": h,
    }


def text_block(wid: str, content: str, gx: int, gy: int, span: int, h: int = 2) -> dict:
    return {
        "id": wid,
        "type": "text-block",
        "title": "",
        "content": content,
        "colSpan": span, "gridX": gx, "gridY": gy, "gridH": h,
    }


def record_creator(wid: str, title: str, action_id: str,
                   fields: list[dict], steps: list[dict] | None,
                   gx: int, gy: int, span: int, h: int = 12) -> dict:
    out = {
        "id": wid,
        "type": "record-creator",
        "title": title,
        "actionId": action_id,
        "fields": fields,
        "colSpan": span, "gridX": gx, "gridY": gy, "gridH": h,
    }
    if steps:
        out["steps"] = steps
    return out


# ── Action builders ──────────────────────────────────────────────────────────

def create_action(action_id: str, name: str, ot_id: str,
                  field_mappings: list[dict],
                  validations: list[dict] | None = None,
                  confirmation: dict | None = None,
                  on_success: dict | None = None,
                  on_error: dict | None = None) -> dict:
    a = {
        "id": action_id,
        "name": name,
        "kind": "createObject",
        "objectTypeId": ot_id,
        "fieldMappings": field_mappings,
    }
    if validations:
        a["validations"] = validations
    if confirmation:
        a["confirmation"] = confirmation
    if on_success:
        a["onSuccess"] = on_success
    if on_error:
        a["onError"] = on_error
    return a


# ── Dashboard 1: Finance Overview ────────────────────────────────────────────

def build_overview(ots: dict[str, str], detail_ids: dict[str, str]) -> dict:
    """Home dashboard with 5 KPI tiles → drill into detail dashboards."""
    tx = ots["Transaction"]
    inv = ots["Invoice"]
    bill = ots["Bill"]
    loan = ots["Loan"]

    components = [
        text_block("ov-header",
                   "## Finance Overview\n\nClick any KPI tile to drill into the matching detail dashboard.",
                   gx=0, gy=0, span=12, h=2),

        # 5 KPI tiles
        metric_card("ov-kpi-cash-in",  "Cash in (filter range)",  tx, "amount", "sum",
                    gx=0, gy=2, span=2, filters=[
                        {"id": "f1", "field": "direction", "operator": "eq", "value": "in"}]),
        metric_card("ov-kpi-cash-out", "Cash out (filter range)", tx, "amount", "sum",
                    gx=2, gy=2, span=2, filters=[
                        {"id": "f1", "field": "direction", "operator": "eq", "value": "out"}]),
        metric_card("ov-kpi-ar",       "Open AR",  inv, "balance_due", "sum",
                    gx=4, gy=2, span=3, filters=[
                        {"id": "f1", "field": "status", "operator": "eq", "value": "open"}]),
        metric_card("ov-kpi-ap",       "Open AP",  bill, "balance_due", "sum",
                    gx=7, gy=2, span=3, filters=[
                        {"id": "f1", "field": "status", "operator": "eq", "value": "open"}]),
        metric_card("ov-kpi-loans",    "Loan balance", loan, "balance", "sum",
                    gx=10, gy=2, span=2),

        # Cashflow trend
        line_chart("ov-trend", "Cashflow trend (sum of amount)",
                   tx, "date", "amount", "sum", "day",
                   gx=0, gy=4, span=12, h=5),

        # Recent transactions
        data_table("ov-recent", "Recent transactions",
                   tx, ["date", "description", "amount", "direction", "status", "account_id"],
                   gx=0, gy=9, span=12, h=6, max_rows=15),
    ]

    # Drill-down events on each KPI tile
    events = [
        {
            "id": "ev-ar",
            "sourceWidgetId": "ov-kpi-ar",
            "trigger": "onKpiClick",
            "actions": [{
                "type": "openDashboard",
                "targetDashboardId": detail_ids["Accounts Receivable"],
                "displayMode": "replace",
                "contextBindings": [],
            }],
        },
        {
            "id": "ev-ap",
            "sourceWidgetId": "ov-kpi-ap",
            "trigger": "onKpiClick",
            "actions": [{
                "type": "openDashboard",
                "targetDashboardId": detail_ids["Accounts Payable"],
                "displayMode": "replace",
                "contextBindings": [],
            }],
        },
        {
            "id": "ev-loans",
            "sourceWidgetId": "ov-kpi-loans",
            "trigger": "onKpiClick",
            "actions": [{
                "type": "openDashboard",
                "targetDashboardId": detail_ids["Loans"],
                "displayMode": "replace",
                "contextBindings": [],
            }],
        },
        # Recent transactions row click → Accounts (sidepanel) with the
        # account_id from the clicked row pre-applied as a filter.
        # Demonstrates the Advanced contextBindings editor.
        {
            "id": "ev-tx-row",
            "sourceWidgetId": "ov-recent",
            "trigger": "onRowClick",
            "actions": [{
                "type": "openDashboard",
                "targetDashboardId": detail_ids["Accounts"],
                "displayMode": "sidepanel",
                "contextBindings": [{
                    "sourceFrom": "rowField",
                    "rowField":   "account_id",
                    "apply":      "addFilter",
                    "filterField": "id",
                    "filterOp":   "eq",
                }],
            }],
        },
    ]

    settings = {
        "events": events,
        "variables": [
            {"id": "var-tenant", "name": "tenantId", "type": "string", "defaultValue": TENANT},
        ],
        "filter_bar": {
            "enabled": True,
            "timeField": "date",
            "defaultRange": "this_month",
        },
    }

    return {
        "name": "Finance Overview",
        "description": "Cashflow + AR + AP + Loans home page. Drill-down enabled.",
        "icon": "DollarSign",
        "kind": "dashboard",
        "object_type_ids": [tx, inv, bill, loan],
        "components": components,
        "settings": settings,
    }


# ── Dashboard 2: Accounts ────────────────────────────────────────────────────

def build_accounts(ots: dict[str, str]) -> dict:
    acc = ots["Account"]
    tx = ots["Transaction"]
    return {
        "name": "Accounts",
        "description": "All accounts and balances.",
        "icon": "Landmark",
        "kind": "dashboard",
        "object_type_ids": [acc, tx],
        "components": [
            metric_card("ac-count",   "Total accounts", acc, "id", "count", gx=0, gy=0, span=3),
            metric_card("ac-balance", "Total balance",  acc, "balance", "sum", gx=3, gy=0, span=3),
            bar_chart("ac-by-type", "Balance by account type",
                      acc, "account_type", "balance", "sum",
                      gx=6, gy=0, span=6, h=4),
            data_table("ac-list", "Accounts",
                       acc, ["name", "account_type", "institution", "currency", "balance", "status"],
                       gx=0, gy=4, span=12, h=6),
        ],
        "settings": {
            "events": [],
            "filter_bar": {"enabled": False},
        },
    }


# ── Dashboard 3: Accounts Receivable ─────────────────────────────────────────

def build_ar(ots: dict[str, str]) -> dict:
    inv = ots["Invoice"]
    return {
        "name": "Accounts Receivable",
        "description": "Open invoices owed to us.",
        "icon": "TrendingUp",
        "kind": "dashboard",
        "object_type_ids": [inv],
        "components": [
            metric_card("ar-due",   "Open AR balance", inv, "balance_due", "sum",
                        gx=0, gy=0, span=4, filters=[
                            {"id":"f","field":"status","operator":"eq","value":"open"}]),
            metric_card("ar-count", "Open invoices",   inv, "id", "count",
                        gx=4, gy=0, span=4, filters=[
                            {"id":"f","field":"status","operator":"eq","value":"open"}]),
            metric_card("ar-overdue", "Overdue",       inv, "balance_due", "sum",
                        gx=8, gy=0, span=4, filters=[
                            {"id":"f","field":"status","operator":"eq","value":"overdue"}]),
            bar_chart("ar-by-status", "Balance by status",
                      inv, "status", "balance_due", "sum",
                      gx=0, gy=2, span=12, h=4),
            data_table("ar-list", "Open invoices",
                       inv, ["invoice_number","counterparty_id","issue_date","due_date","amount","balance_due","status"],
                       gx=0, gy=6, span=12, h=6,
                       filters=[{"id":"f","field":"status","operator":"eq","value":"open"}]),
        ],
        "settings": {"events": [], "filter_bar": {"enabled": False}},
    }


# ── Dashboard 4: Accounts Payable ────────────────────────────────────────────

def build_ap(ots: dict[str, str]) -> dict:
    bill = ots["Bill"]
    return {
        "name": "Accounts Payable",
        "description": "Bills owed to vendors.",
        "icon": "TrendingDown",
        "kind": "dashboard",
        "object_type_ids": [bill],
        "components": [
            metric_card("ap-due",   "Open AP balance", bill, "balance_due", "sum",
                        gx=0, gy=0, span=4, filters=[
                            {"id":"f","field":"status","operator":"eq","value":"open"}]),
            metric_card("ap-count", "Open bills",      bill, "id", "count",
                        gx=4, gy=0, span=4, filters=[
                            {"id":"f","field":"status","operator":"eq","value":"open"}]),
            metric_card("ap-overdue", "Overdue",       bill, "balance_due", "sum",
                        gx=8, gy=0, span=4, filters=[
                            {"id":"f","field":"status","operator":"eq","value":"overdue"}]),
            bar_chart("ap-by-status", "Balance by status",
                      bill, "status", "balance_due", "sum",
                      gx=0, gy=2, span=12, h=4),
            data_table("ap-list", "Open bills",
                       bill, ["bill_number","counterparty_id","issue_date","due_date","amount","balance_due","status"],
                       gx=0, gy=6, span=12, h=6,
                       filters=[{"id":"f","field":"status","operator":"eq","value":"open"}]),
        ],
        "settings": {"events": [], "filter_bar": {"enabled": False}},
    }


# ── Dashboard 5: Loans ───────────────────────────────────────────────────────

def build_loans(ots: dict[str, str]) -> dict:
    loan = ots["Loan"]
    sched = ots["PaymentSchedule"]
    return {
        "name": "Loans",
        "description": "Active loans and upcoming payment schedule.",
        "icon": "CreditCard",
        "kind": "dashboard",
        "object_type_ids": [loan, sched],
        "components": [
            metric_card("ln-balance", "Outstanding debt", loan, "balance", "sum",
                        gx=0, gy=0, span=4),
            metric_card("ln-monthly", "Monthly payment",  loan, "monthly_payment", "sum",
                        gx=4, gy=0, span=4),
            metric_card("ln-count",   "Active loans",     loan, "id", "count",
                        gx=8, gy=0, span=4,
                        filters=[{"id":"f","field":"status","operator":"eq","value":"active"}]),
            data_table("ln-list", "Loans",
                       loan, ["name","principal","balance","interest_rate_pct","monthly_payment","maturity_date","status"],
                       gx=0, gy=2, span=12, h=5),
            data_table("ln-upcoming", "Upcoming payments",
                       sched, ["due_date","principal","interest","total","status","loan_id"],
                       gx=0, gy=7, span=12, h=5,
                       filters=[{"id":"f","field":"status","operator":"eq","value":"pending"}]),
        ],
        "settings": {"events": [], "filter_bar": {"enabled": False}},
    }


# ── Input apps ───────────────────────────────────────────────────────────────

def build_add_account(ots: dict[str, str]) -> dict:
    action_id = "act-create-account"
    return {
        "name": "Add Account",
        "description": "Create a new bank, credit card, or loan account.",
        "icon": "Plus",
        "kind": "app",
        "object_type_ids": [ots["Account"]],
        "components": [
            record_creator(
                "rc-account", "New account", action_id,
                fields=[
                    {"name": "name",          "label": "Name",          "type": "text"},
                    {"name": "account_type",  "label": "Type (checking/savings/credit_card/loan/cash)", "type": "text"},
                    {"name": "institution",   "label": "Institution",   "type": "text"},
                    {"name": "currency",      "label": "Currency (USD/SVC/EUR)", "type": "text"},
                    {"name": "balance",       "label": "Opening balance", "type": "number"},
                    {"name": "status",        "label": "Status (active)", "type": "text"},
                ],
                steps=None,
                gx=0, gy=0, span=8, h=12,
            ),
        ],
        "settings": {
            "actions": [
                create_action(
                    action_id, "Create account", ots["Account"],
                    field_mappings=[
                        {"formField": "name",         "targetProperty": "name"},
                        {"formField": "account_type", "targetProperty": "account_type"},
                        {"formField": "institution",  "targetProperty": "institution"},
                        {"formField": "currency",     "targetProperty": "currency"},
                        {"formField": "balance",      "targetProperty": "balance",   "transform": "asNumber"},
                        {"formField": "status",       "targetProperty": "status"},
                        # Auto-stamp status if user leaves blank — demonstrates `literal`.
                        {"formField": "_id",          "targetProperty": "id",        "transform": "asUuid"},
                    ],
                    validations=[
                        {"field": "name",         "rule": "required",
                         "message": "Account name is required."},
                        {"field": "account_type", "rule": "required"},
                        {"field": "balance",      "rule": "required"},
                    ],
                    confirmation={
                        "title": "Create this account?",
                        "body": "It will appear in the Accounts dashboard and become a valid target for future transactions.",
                    },
                    on_success={"type": "refreshWidget", "targetWidgetId": "rc-account"},
                ),
            ],
            "events": [],
        },
    }


def build_add_counterparty(ots: dict[str, str]) -> dict:
    action_id = "act-create-cp"
    return {
        "name": "Add Counterparty",
        "description": "Add a vendor, customer, employee, or other party.",
        "icon": "Users",
        "kind": "app",
        "object_type_ids": [ots["Counterparty"]],
        "components": [
            record_creator(
                "rc-cp", "New counterparty", action_id,
                fields=[
                    {"name": "name",       "label": "Name",        "type": "text"},
                    {"name": "party_type", "label": "Type (vendor/customer/employee/bank/other)", "type": "text"},
                    {"name": "tax_id",     "label": "Tax ID",      "type": "text"},
                    {"name": "email",      "label": "Email",       "type": "text"},
                    {"name": "phone",      "label": "Phone",       "type": "text"},
                    {"name": "address",    "label": "Address",     "type": "textarea"},
                ],
                steps=None,
                gx=0, gy=0, span=8, h=12,
            ),
        ],
        "settings": {
            "actions": [
                create_action(
                    action_id, "Create counterparty", ots["Counterparty"],
                    field_mappings=[
                        {"formField": "name",       "targetProperty": "name"},
                        {"formField": "party_type", "targetProperty": "party_type"},
                        {"formField": "tax_id",     "targetProperty": "tax_id"},
                        {"formField": "email",      "targetProperty": "email"},
                        {"formField": "phone",      "targetProperty": "phone"},
                        {"formField": "address",    "targetProperty": "address"},
                    ],
                    validations=[
                        {"field": "name", "rule": "required"},
                        {"field": "email", "rule": "regex",
                         "value": r"^[^@\s]+@[^@\s]+\.[^@\s]+$",
                         "message": "Enter a valid email or leave blank."},
                    ],
                ),
            ],
            "events": [],
        },
    }


def build_add_transaction(ots: dict[str, str]) -> dict:
    """Multi-step wizard — exercises every action feature."""
    action_id = "act-create-tx"
    fields = [
        {"name": "date",            "label": "Date (YYYY-MM-DD)",      "type": "text"},
        {"name": "amount",          "label": "Amount",                 "type": "number"},
        {"name": "direction",       "label": "Direction (in/out)",     "type": "text"},
        {"name": "account_id",      "label": "Account ID",             "type": "text"},
        {"name": "counterparty_id", "label": "Counterparty ID (optional)", "type": "text"},
        {"name": "category_id",     "label": "Category ID (optional)", "type": "text"},
        {"name": "description",     "label": "Description",            "type": "textarea"},
        {"name": "status",          "label": "Status (pending/cleared/reconciled)", "type": "text"},
    ]
    steps = [
        {"title": "Money",   "fields": ["date", "amount", "direction"]},
        {"title": "Parties", "fields": ["account_id", "counterparty_id", "category_id"]},
        {"title": "Notes",   "fields": ["description", "status"]},
    ]
    return {
        "name": "Add Transaction",
        "description": "Record money in or out, against an account.",
        "icon": "ArrowLeftRight",
        "kind": "app",
        "object_type_ids": [ots["Transaction"]],
        "components": [
            record_creator(
                "rc-tx", "New transaction", action_id,
                fields=fields, steps=steps,
                gx=0, gy=0, span=8, h=14,
            ),
        ],
        "settings": {
            "actions": [
                create_action(
                    action_id, "Create transaction", ots["Transaction"],
                    field_mappings=[
                        {"formField": "date",            "targetProperty": "date",            "transform": "asDate"},
                        {"formField": "amount",          "targetProperty": "amount",          "transform": "asNumber"},
                        {"formField": "direction",       "targetProperty": "direction"},
                        {"formField": "account_id",      "targetProperty": "account_id",      "transform": "asUuid"},
                        {"formField": "counterparty_id", "targetProperty": "counterparty_id", "transform": "asUuid"},
                        {"formField": "category_id",     "targetProperty": "category_id",     "transform": "asUuid"},
                        {"formField": "description",     "targetProperty": "description"},
                        {"formField": "status",          "targetProperty": "status"},
                        # Stamp tenant via literal — demonstrates `literal` transform.
                        {"formField": "_currency",       "targetProperty": "currency",
                         "transform": "literal", "literalValue": "USD"},
                    ],
                    validations=[
                        {"field": "date",       "rule": "required",
                         "message": "Date is required."},
                        {"field": "amount",     "rule": "required"},
                        {"field": "amount",     "rule": "min",  "value": "0.01",
                         "message": "Amount must be greater than zero."},
                        {"field": "direction",  "rule": "regex", "value": "^(in|out|transfer)$",
                         "message": "Direction must be in, out, or transfer."},
                        {"field": "account_id", "rule": "required",
                         "message": "Pick an Account ID — see the Accounts dashboard."},
                    ],
                    confirmation={
                        "title": "Post this transaction?",
                        "body": "It will appear in the cashflow trend and the Accounts drill-down.",
                    },
                    on_success={"type": "setVariable", "variableId": "lastTxId", "valueFrom": "response.id"},
                    on_error={"type": "refreshWidget", "targetWidgetId": "rc-tx"},
                ),
            ],
            "variables": [
                {"id": "lastTxId", "name": "lastTxId", "type": "string", "defaultValue": ""},
            ],
            "events": [],
        },
    }


def build_add_invoice(ots: dict[str, str]) -> dict:
    action_id = "act-create-inv"
    return {
        "name": "Add Invoice",
        "description": "Create an invoice owed to us (AR).",
        "icon": "FileText",
        "kind": "app",
        "object_type_ids": [ots["Invoice"]],
        "components": [
            record_creator(
                "rc-inv", "New invoice", action_id,
                fields=[
                    {"name": "invoice_number",  "label": "Invoice number", "type": "text"},
                    {"name": "counterparty_id", "label": "Customer ID",    "type": "text"},
                    {"name": "issue_date",      "label": "Issue date",     "type": "text"},
                    {"name": "due_date",        "label": "Due date",       "type": "text"},
                    {"name": "amount",          "label": "Amount",         "type": "number"},
                    {"name": "description",     "label": "Description",    "type": "textarea"},
                ],
                steps=None,
                gx=0, gy=0, span=8, h=12,
            ),
        ],
        "settings": {
            "actions": [
                create_action(
                    action_id, "Create invoice", ots["Invoice"],
                    field_mappings=[
                        {"formField": "invoice_number",  "targetProperty": "invoice_number"},
                        {"formField": "counterparty_id", "targetProperty": "counterparty_id", "transform": "asUuid"},
                        {"formField": "issue_date",      "targetProperty": "issue_date",      "transform": "asDate"},
                        {"formField": "due_date",        "targetProperty": "due_date",        "transform": "asDate"},
                        {"formField": "amount",          "targetProperty": "amount",          "transform": "asNumber"},
                        {"formField": "description",     "targetProperty": "description"},
                        {"formField": "_status",         "targetProperty": "status",
                         "transform": "literal", "literalValue": "open"},
                    ],
                    validations=[
                        {"field": "invoice_number",  "rule": "required"},
                        {"field": "counterparty_id", "rule": "required"},
                        {"field": "amount",          "rule": "required"},
                        {"field": "due_date",        "rule": "required"},
                    ],
                    confirmation={"title": "Create this invoice?",
                                  "body": "It opens in 'open' status until a Transaction pays it down."},
                ),
            ],
        },
    }


def build_add_bill(ots: dict[str, str]) -> dict:
    action_id = "act-create-bill"
    return {
        "name": "Add Bill",
        "description": "Create a bill we owe to a vendor (AP).",
        "icon": "FileMinus",
        "kind": "app",
        "object_type_ids": [ots["Bill"]],
        "components": [
            record_creator(
                "rc-bill", "New bill", action_id,
                fields=[
                    {"name": "bill_number",     "label": "Bill number",   "type": "text"},
                    {"name": "counterparty_id", "label": "Vendor ID",     "type": "text"},
                    {"name": "issue_date",      "label": "Issue date",    "type": "text"},
                    {"name": "due_date",        "label": "Due date",      "type": "text"},
                    {"name": "amount",          "label": "Amount",        "type": "number"},
                    {"name": "description",     "label": "Description",   "type": "textarea"},
                ],
                steps=None,
                gx=0, gy=0, span=8, h=12,
            ),
        ],
        "settings": {
            "actions": [
                create_action(
                    action_id, "Create bill", ots["Bill"],
                    field_mappings=[
                        {"formField": "bill_number",     "targetProperty": "bill_number"},
                        {"formField": "counterparty_id", "targetProperty": "counterparty_id", "transform": "asUuid"},
                        {"formField": "issue_date",      "targetProperty": "issue_date",      "transform": "asDate"},
                        {"formField": "due_date",        "targetProperty": "due_date",        "transform": "asDate"},
                        {"formField": "amount",          "targetProperty": "amount",          "transform": "asNumber"},
                        {"formField": "description",     "targetProperty": "description"},
                        {"formField": "_status",         "targetProperty": "status",
                         "transform": "literal", "literalValue": "open"},
                    ],
                    validations=[
                        {"field": "bill_number",     "rule": "required"},
                        {"field": "counterparty_id", "rule": "required"},
                        {"field": "amount",          "rule": "required"},
                        {"field": "due_date",        "rule": "required"},
                    ],
                    confirmation={"title": "Create this bill?", "body": "Adds to AP."},
                ),
            ],
        },
    }


def build_add_loan(ots: dict[str, str]) -> dict:
    action_id = "act-create-loan"
    return {
        "name": "Add Loan",
        "description": "Open a new loan record.",
        "icon": "Banknote",
        "kind": "app",
        "object_type_ids": [ots["Loan"]],
        "components": [
            record_creator(
                "rc-loan", "New loan", action_id,
                fields=[
                    {"name": "name",              "label": "Name",                "type": "text"},
                    {"name": "lender_id",         "label": "Lender (Counterparty ID)", "type": "text"},
                    {"name": "principal",         "label": "Principal",           "type": "number"},
                    {"name": "interest_rate_pct", "label": "Interest rate (%)",   "type": "number"},
                    {"name": "term_months",       "label": "Term (months)",       "type": "number"},
                    {"name": "start_date",        "label": "Start date",          "type": "text"},
                ],
                steps=None,
                gx=0, gy=0, span=8, h=12,
            ),
        ],
        "settings": {
            "actions": [
                create_action(
                    action_id, "Create loan", ots["Loan"],
                    field_mappings=[
                        {"formField": "name",              "targetProperty": "name"},
                        {"formField": "lender_id",         "targetProperty": "lender_id",        "transform": "asUuid"},
                        {"formField": "principal",         "targetProperty": "principal",        "transform": "asNumber"},
                        {"formField": "interest_rate_pct", "targetProperty": "interest_rate_pct","transform": "asNumber"},
                        {"formField": "term_months",       "targetProperty": "term_months",      "transform": "asNumber"},
                        {"formField": "start_date",        "targetProperty": "start_date",       "transform": "asDate"},
                        {"formField": "_status",           "targetProperty": "status",
                         "transform": "literal", "literalValue": "active"},
                    ],
                    validations=[
                        {"field": "name",        "rule": "required"},
                        {"field": "principal",   "rule": "required"},
                        {"field": "term_months", "rule": "required"},
                    ],
                    confirmation={
                        "title": "Open this loan?",
                        "body": "After creation, you'll need to generate the PaymentSchedule (manually or via a Logic workflow).",
                    },
                ),
            ],
        },
    }


# ── Main ─────────────────────────────────────────────────────────────────────

def main():
    print(f"Seeding Finance apps + dashboards under tenant: {TENANT}\n")

    ots = find_object_types()

    # 1. Detail dashboards first — Overview drill-down needs their IDs.
    detail_ids: dict[str, str] = {}
    for fn, label in [
        (build_accounts, "Accounts"),
        (build_ar,       "Accounts Receivable"),
        (build_ap,       "Accounts Payable"),
        (build_loans,    "Loans"),
    ]:
        body = fn(ots)
        print(f"→ Dashboard: {label} …", end=" ", flush=True)
        app_id = upsert_app(label, body)
        detail_ids[label] = app_id
        print(app_id)

    # 2. Overview dashboard — wires drill-down to detail IDs above.
    print(f"→ Dashboard: Finance Overview …", end=" ", flush=True)
    overview_id = upsert_app("Finance Overview", build_overview(ots, detail_ids))
    print(overview_id)

    # 3. Input apps.
    for fn, label in [
        (build_add_account,      "Add Account"),
        (build_add_counterparty, "Add Counterparty"),
        (build_add_transaction,  "Add Transaction"),
        (build_add_invoice,      "Add Invoice"),
        (build_add_bill,         "Add Bill"),
        (build_add_loan,         "Add Loan"),
    ]:
        body = fn(ots)
        print(f"→ App: {label} …", end=" ", flush=True)
        app_id = upsert_app(label, body)
        print(app_id)

    print("\n✓ Done.")
    print("  5 dashboards: Finance Overview · Accounts · Accounts Receivable · Accounts Payable · Loans")
    print("  6 input apps: Add Account · Add Counterparty · Add Transaction · Add Invoice · Add Bill · Add Loan")
    print("\n  Open the Dashboards / Apps modules to view them.")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print(f"\n✗ Failed: {e}", file=sys.stderr)
        sys.exit(1)
