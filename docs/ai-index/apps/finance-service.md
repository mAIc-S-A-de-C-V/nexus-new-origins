# finance-service (port 9001)

**Purpose:** MAIC's own finance app: expense ledger, revenue, accounts receivable. Read/write CRUD + Excel upload + summary endpoints.
**Stack:** Python FastAPI, SQLAlchemy async, asyncpg.
**Path:** `/Users/ishmontalvo/Desktop/nexus-new-origins/nexus-apps/finance-service/`

## Files

```
finance-service/
├── main.py             FastAPI; mounts 3 routers; init_db on startup
├── database.py         ORM: TransactionRow, RevenueRow, ReceivableRow + session factory
├── routers/
│   ├── transactions.py Expense ledger CRUD + upload + summary
│   ├── revenue.py      Income records CRUD + monthly KPI
│   └── receivables.py  A/R aging
├── Dockerfile
└── requirements.txt    fastapi, sqlalchemy, asyncpg
```

## Tables

```
fin_transactions:
  id PK, tenant_id (idx), category (idx; salaries|software|admin|finanzas|oficina|marketing),
  date (ISO YYYY-MM-DD), description, vendor, payment_method,
  amount_usd Numeric(18,2), notes, created_at, updated_at

fin_revenue:
  id, tenant_id, date, description, client, invoice_number,
  amount_usd, currency (default USD), status (received|pending), notes, timestamps

fin_receivables:
  id, tenant_id, client, invoice_number, invoice_date, due_date,
  amount_usd, currency, status (pending|partial|paid|overdue),
  paid_amount, description, notes, timestamps
```

## Endpoints

### `/finance/transactions`

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/finance/transactions?category&year&month` | List filtered. |
| POST | `/finance/transactions` | Create. |
| PUT | `/finance/transactions/{id}` | Update. |
| DELETE | `/finance/transactions/{id}` | 204. |
| POST | `/finance/transactions/upload` | Parse Excel → import. |
| GET | `/finance/transactions/summary` | Totals by category + month. |

`CATEGORIES` set in `routers/transactions.py:26`: `{salaries, software, admin, finanzas, oficina, marketing}`.

### `/finance/revenue`

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/finance/revenue` | List. |
| POST | `/finance/revenue` | Record income. |
| GET | `/finance/revenue/monthly` | Monthly aggregation. |

### `/finance/receivables`

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/finance/receivables?status&client` | List filtered. |
| POST | `/finance/receivables` | Create invoice/bill. |
| PUT | `/finance/receivables/{id}` | Record partial payment / status. |
| GET | `/finance/receivables/aging` | 0-30d / 31-60d / 60d+ buckets. |

## Tenant header

`x-tenant-id` (defaults `tenant-001`).

## Cross-service

None currently. Could integrate with:
- event-log-service (audit trail for transactions).
- ontology-service (Account/Counterparty objects for reconciliation).
- logic-service (e.g. "email invoice if unpaid > 30d").

## Env

`DATABASE_URL`, `ALLOWED_ORIGINS`.

## Seeding

`scripts/seed_finance_ontology.py` creates Account / Counterparty / Transaction / Invoice / Bill / Loan ObjectTypes in ontology-service.
`scripts/seed_finance_apps.py` creates 11 dashboards/apps under `tenant-001` (5 dashboards + 6 input forms).

## When to edit

| Intent | File |
|--------|------|
| Add expense category | `routers/transactions.py:CATEGORIES` set. |
| Add column to a table | `database.py` ORM + migration. |
| Different upload format (CSV/JSON) | `routers/transactions.py:upload`. |
| Aging buckets | `routers/receivables.py:aging` thresholds. |
| Integrate with event log | add `_emit()` helper similar to nexus-apps/project-management-service. |
| Forecasting | new `routers/revenue.py:forecast`. |
