"""
Seed the Finance ontology under tenant-001 (admin@maic.ai's home tenant).

Creates 8 object types and the links between them so a Finance app can be
assembled in the Apps module on top of:

    Account · Transaction · Counterparty · Invoice · Bill ·
    Loan · PaymentSchedule · FinanceCategory

Run from the host:
    python3 scripts/seed_finance_ontology.py

Idempotent — types are matched by name and reused if they already exist;
links are matched by (source, target, relationship_type) and skipped if they
already exist.
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


def get_or_create_ot(name: str, display: str, description: str, properties: list[dict]) -> str:
    existing = req("GET", f"{ONTOLOGY_API}/object-types") or []
    for ot in existing:
        if ot.get("name") == name:
            return ot["id"]
    body = {
        "id": str(uuid4()),
        "name": name,
        "display_name": display,
        "description": description,
        "properties": properties,
        "source_connector_ids": [],
        "version": 1,
        "schema_health": "healthy",
        "tenant_id": TENANT,
    }
    created = req("POST", f"{ONTOLOGY_API}/object-types", body=body)
    return created["id"]


def get_or_create_link(source_id: str, target_id: str, rel: str,
                       source_field: str, target_field: str,
                       label: str) -> None:
    existing = req("GET", f"{ONTOLOGY_API}/object-types/links/all") or []
    for ln in existing:
        if (ln.get("source_object_type_id") == source_id
                and ln.get("target_object_type_id") == target_id
                and ln.get("relationship_type") == rel):
            return
    body = {
        "id": str(uuid4()),
        "source_object_type_id": source_id,
        "target_object_type_id": target_id,
        "relationship_type": rel,
        "join_keys": [{"source_field": source_field, "target_field": target_field}],
        "label": label,
        "is_inferred": False,
    }
    req("POST", f"{ONTOLOGY_API}/object-types/links", body=body)


# ── Schema definitions ──────────────────────────────────────────────────────

def main():
    print(f"Seeding Finance ontology under tenant: {TENANT}\n")

    # Account ────────────────────────────────────────────────────────────────
    print("→ Object type Account …", end=" ", flush=True)
    account_id = get_or_create_ot(
        "Account", "Account",
        "Bank, credit card, or loan account holding a balance.",
        [
            prop("id",            "IDENTIFIER", "string", required=True),
            prop("name",          "TEXT",       "string", required=True),
            prop("account_type",  "CATEGORY",   "string", display="Account Type"),  # checking | savings | credit_card | loan | cash
            prop("institution",   "TEXT",       "string"),
            prop("account_number","IDENTIFIER", "string", pii="MEDIUM"),
            prop("currency",      "CATEGORY",   "string"),
            prop("balance",       "CURRENCY",   "float"),
            prop("status",        "STATUS",     "string"),  # active | closed | frozen
            prop("opened_at",     "DATE",       "date"),
            prop("created_at",    "DATETIME",   "datetime"),
        ],
    )
    print(account_id)

    # Counterparty ───────────────────────────────────────────────────────────
    print("→ Object type Counterparty …", end=" ", flush=True)
    counterparty_id = get_or_create_ot(
        "Counterparty", "Counterparty",
        "A vendor, customer, employee, or other party in a transaction.",
        [
            prop("id",         "IDENTIFIER", "string", required=True),
            prop("name",       "TEXT",       "string", required=True),
            prop("party_type", "CATEGORY",   "string"),  # vendor | customer | employee | bank | other
            prop("tax_id",     "IDENTIFIER", "string", pii="HIGH"),
            prop("email",      "EMAIL",      "string", pii="MEDIUM"),
            prop("phone",      "PHONE",      "string", pii="MEDIUM"),
            prop("address",    "ADDRESS",    "string", pii="MEDIUM"),
            prop("status",     "STATUS",     "string"),
            prop("created_at", "DATETIME",   "datetime"),
        ],
    )
    print(counterparty_id)

    # FinanceCategory ────────────────────────────────────────────────────────
    print("→ Object type FinanceCategory …", end=" ", flush=True)
    category_id = get_or_create_ot(
        "FinanceCategory", "Finance Category",
        "Income / expense / transfer category, with optional parent for hierarchy.",
        [
            prop("id",            "IDENTIFIER", "string", required=True),
            prop("name",          "TEXT",       "string", required=True),
            prop("category_type", "CATEGORY",   "string"),  # income | expense | transfer
            prop("parent_id",     "IDENTIFIER", "string", display="Parent Category"),
            prop("color",         "TEXT",       "string"),
        ],
    )
    print(category_id)

    # Transaction ────────────────────────────────────────────────────────────
    print("→ Object type Transaction …", end=" ", flush=True)
    transaction_id = get_or_create_ot(
        "Transaction", "Transaction",
        "Money movement — incoming or outgoing — against an account.",
        [
            prop("id",              "IDENTIFIER", "string", required=True),
            prop("account_id",      "IDENTIFIER", "string", required=True),
            prop("counterparty_id", "IDENTIFIER", "string"),
            prop("category_id",     "IDENTIFIER", "string"),
            prop("invoice_id",      "IDENTIFIER", "string"),
            prop("bill_id",         "IDENTIFIER", "string"),
            prop("payment_schedule_id", "IDENTIFIER", "string"),
            prop("date",            "DATE",       "date", required=True),
            prop("posted_at",       "DATETIME",   "datetime"),
            prop("amount",          "CURRENCY",   "float", required=True),  # signed: + in / - out
            prop("currency",        "CATEGORY",   "string"),
            prop("direction",       "CATEGORY",   "string"),  # in | out | transfer
            prop("description",     "TEXT",       "string"),
            prop("reference",       "IDENTIFIER", "string"),
            prop("status",          "STATUS",     "string"),  # pending | cleared | reconciled | void
        ],
    )
    print(transaction_id)

    # Invoice (AR — money we are owed) ───────────────────────────────────────
    print("→ Object type Invoice …", end=" ", flush=True)
    invoice_id = get_or_create_ot(
        "Invoice", "Invoice",
        "Accounts receivable — invoices issued to customers.",
        [
            prop("id",              "IDENTIFIER", "string", required=True),
            prop("invoice_number",  "IDENTIFIER", "string", required=True),
            prop("counterparty_id", "IDENTIFIER", "string", required=True),  # the customer
            prop("issue_date",      "DATE",       "date", required=True),
            prop("due_date",        "DATE",       "date", required=True),
            prop("amount",          "CURRENCY",   "float", required=True),
            prop("amount_paid",     "CURRENCY",   "float"),
            prop("balance_due",     "CURRENCY",   "float"),
            prop("currency",        "CATEGORY",   "string"),
            prop("status",          "STATUS",     "string"),  # draft | open | paid | overdue | void
            prop("description",     "TEXT",       "string"),
        ],
    )
    print(invoice_id)

    # Bill (AP — money we owe) ───────────────────────────────────────────────
    print("→ Object type Bill …", end=" ", flush=True)
    bill_id = get_or_create_ot(
        "Bill", "Bill",
        "Accounts payable — bills received from vendors.",
        [
            prop("id",              "IDENTIFIER", "string", required=True),
            prop("bill_number",     "IDENTIFIER", "string", required=True),
            prop("counterparty_id", "IDENTIFIER", "string", required=True),  # the vendor
            prop("issue_date",      "DATE",       "date", required=True),
            prop("due_date",        "DATE",       "date", required=True),
            prop("amount",          "CURRENCY",   "float", required=True),
            prop("amount_paid",     "CURRENCY",   "float"),
            prop("balance_due",     "CURRENCY",   "float"),
            prop("currency",        "CATEGORY",   "string"),
            prop("status",          "STATUS",     "string"),  # open | scheduled | paid | overdue | disputed
            prop("description",     "TEXT",       "string"),
        ],
    )
    print(bill_id)

    # Loan ───────────────────────────────────────────────────────────────────
    print("→ Object type Loan …", end=" ", flush=True)
    loan_id = get_or_create_ot(
        "Loan", "Loan",
        "A loan — principal, rate, term, balance, and lender.",
        [
            prop("id",                "IDENTIFIER",  "string", required=True),
            prop("name",              "TEXT",        "string", required=True),
            prop("account_id",        "IDENTIFIER",  "string"),
            prop("lender_id",         "IDENTIFIER",  "string"),  # → Counterparty
            prop("principal",         "CURRENCY",    "float", required=True),
            prop("interest_rate_pct", "PERCENTAGE",  "float"),
            prop("term_months",       "QUANTITY",    "integer"),
            prop("start_date",        "DATE",        "date"),
            prop("maturity_date",     "DATE",        "date"),
            prop("balance",           "CURRENCY",    "float"),
            prop("monthly_payment",   "CURRENCY",    "float"),
            prop("status",            "STATUS",      "string"),  # active | paid_off | default
        ],
    )
    print(loan_id)

    # PaymentSchedule ────────────────────────────────────────────────────────
    print("→ Object type PaymentSchedule …", end=" ", flush=True)
    schedule_id = get_or_create_ot(
        "PaymentSchedule", "Payment Schedule",
        "An amortization installment for a loan.",
        [
            prop("id",         "IDENTIFIER", "string", required=True),
            prop("loan_id",    "IDENTIFIER", "string", required=True),
            prop("due_date",   "DATE",       "date", required=True),
            prop("principal",  "CURRENCY",   "float"),
            prop("interest",   "CURRENCY",   "float"),
            prop("total",      "CURRENCY",   "float"),
            prop("paid_at",    "DATETIME",   "datetime"),
            prop("transaction_id", "IDENTIFIER", "string"),
            prop("status",     "STATUS",     "string"),  # pending | paid | late | missed
        ],
    )
    print(schedule_id)

    # Links ──────────────────────────────────────────────────────────────────
    print("\n→ Links …")
    LINKS = [
        # Transaction edges
        (transaction_id, account_id,      "belongs_to", "account_id",      "id", "posts to"),
        (transaction_id, counterparty_id, "belongs_to", "counterparty_id", "id", "with party"),
        (transaction_id, category_id,     "belongs_to", "category_id",     "id", "categorized as"),
        (transaction_id, invoice_id,      "belongs_to", "invoice_id",      "id", "pays invoice"),
        (transaction_id, bill_id,         "belongs_to", "bill_id",         "id", "pays bill"),
        (transaction_id, schedule_id,     "belongs_to", "payment_schedule_id", "id", "pays installment"),

        # Reverse — has_many for graph traversal
        (account_id,      transaction_id, "has_many", "id", "account_id",      "transactions"),
        (counterparty_id, transaction_id, "has_many", "id", "counterparty_id", "transactions"),
        (category_id,     transaction_id, "has_many", "id", "category_id",     "transactions"),

        # Invoice / Bill ↔ Counterparty
        (invoice_id,      counterparty_id, "belongs_to", "counterparty_id", "id", "billed to"),
        (counterparty_id, invoice_id,      "has_many",   "id", "counterparty_id", "invoices"),
        (bill_id,         counterparty_id, "belongs_to", "counterparty_id", "id", "owed to"),
        (counterparty_id, bill_id,         "has_many",   "id", "counterparty_id", "bills"),

        # Invoice / Bill ↔ Transaction (payments)
        (invoice_id, transaction_id, "has_many", "id", "invoice_id", "payments"),
        (bill_id,    transaction_id, "has_many", "id", "bill_id",    "payments"),

        # Category self-reference (parent → children)
        (category_id, category_id, "has_many", "id", "parent_id", "subcategories"),

        # Loan
        (loan_id,         account_id,      "belongs_to", "account_id", "id", "funded into"),
        (loan_id,         counterparty_id, "belongs_to", "lender_id",  "id", "lender"),
        (loan_id,         schedule_id,     "has_many",   "id", "loan_id", "schedule"),
        (schedule_id,     loan_id,         "belongs_to", "loan_id", "id", "for loan"),
        (schedule_id,     transaction_id,  "belongs_to", "transaction_id", "id", "paid by"),
    ]
    for src, tgt, rel, sf, tf, label in LINKS:
        get_or_create_link(src, tgt, rel, sf, tf, label)
        print(f"  · {label:<22} ({rel})")

    print(f"\n✓ Done. 8 object types + {len(LINKS)} links seeded under {TENANT}.")
    print("  Browse them in the Ontology and Object Graph modules.")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print(f"\n✗ Failed: {e}", file=sys.stderr)
        sys.exit(1)
