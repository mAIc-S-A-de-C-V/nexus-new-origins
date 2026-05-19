---
title: "Nexus — Advanced Widget Authoring"
subtitle: "Joins, Computed Fields, Window Functions, Expression Language"
date: "2026-05-19"
author: "MAIC"
---

# Overview

Every dashboard widget in Nexus fetches data through the
`POST /object-types/{ot_id}/aggregate` endpoint. Three primitives let
a widget reach beyond a single object type's stored columns without
materializing new object types or running Logic Functions:

1. **Joins** — pull columns from a related object type at query time.
2. **Computed fields** — virtual columns derived from an expression.
3. **Window functions** — running totals, moving averages, ranks, lag/lead.

Combined with the expression language, the three cover the vast
majority of "I need to compute X from these other tables" requests
that previously required materializing a fact table.

If you're an analyst, the path is: open a widget's right-side
config panel → click **Advanced (joins, computed fields, window)** →
configure. No JSON authoring required.

If you're an AI agent or external integration: the wire shape is
documented in `/aggregate`'s request schema. See
`backend/ontology_service/routers/records.py` for canonical types.

---

# The expression language

A small JSON AST with a Pydantic-validated grammar. The visual editor
parses a text form (`monthly_salary / 30 * allocation_pct / 100`) into
that AST; the SQL emitter translates the AST to safe parameterized
SQL. There is no point in the pipeline where a user string lands
directly in SQL.

## Operators

| Category | Operators | Notes |
|---|---|---|
| Arithmetic | `+` `-` `*` `/` `%` | Operands cast through a safe-numeric guard |
| Comparison | `==` `!=` `<` `<=` `>` `>=` | |
| Logical | `and` `or` `not` | `not` binds looser than comparisons (Python-style) |
| Unary | `-x` (numeric negation) | |

Numeric literals (`30`, `2.5`) are inlined into the SQL string;
string literals (`"open"`) bind as parameters; `NaN` / `Infinity` are
rejected at validation.

## Functions

| Name | Signature | Purpose |
|---|---|---|
| `concat(...)` | variadic | `||`-joined, each arg `COALESCE`d to `''` |
| `lower(x)`, `upper(x)` | 1-arg | Case conversion |
| `coalesce(...)` | variadic | First non-NULL |
| `date_diff(unit, a, b)` | 3-arg | Numeric difference. `unit` must be a literal: `second`, `minute`, `hour`, `day`, `week`, `month`, `quarter`, `year` |
| `date_trunc(unit, ts)` | 2-arg | Truncate timestamp to bucket boundary |
| `now()` | 0-arg | Current timestamptz |
| `to_number(x)` | 1-arg | Regex-guarded numeric cast |
| `to_date(x)` | 1-arg | Cast text to timestamptz |
| `to_text(x)` | 1-arg | Cast to text |
| `if(cond, then, else)` | 3-arg | Conditional |
| `round(x[, digits])` | 1- or 2-arg | Rounding |
| `abs(x)`, `floor(x)`, `ceil(x)` | 1-arg | Standard numeric |
| `pow(b, e)` | 2-arg | Exponentiation |
| `length(s)` | 1-arg | Character count |

## Field references

- Bare `monthly_salary` → the field on the widget's base object type
- Dotted `emp.full_name` → the field on the joined object type aliased
  `emp` (only valid when a join with that alias is declared)

Identifiers must match `^[A-Za-z_][A-Za-z0-9_]{0,62}$`. Anything else
is rejected at parse time.

---

# Joins

Declared in the widget config's **Advanced → Joins** panel. Each join
adds a `LEFT JOIN` (or `INNER JOIN`) on the base table at query time.

## Required fields

- **Alias** — a short identifier; reference joined columns as `alias.field`
- **Joined object type** — dropdown of all OTs in the tenant
- **Source field** — the field on this OT that holds the foreign key
- **Target field** — the field on the joined OT to match against;
  picking `id (record id)` resolves to the row's PK column

## How `id` resolves

Most ontology records don't store an inline `id` inside their JSONB
data blob — the canonical identifier lives in the row's `source_id`
column. The query builder treats `id` and `source_id` on either side
of a join as references to that column. Joining `Project Assignment.
employee_id` to Employee's `id` therefore matches against
`employee.source_id`, not `employee.data->>'id'` (which would be NULL
for most records and silently produce empty joins).

## Cardinality safety

Joins are assumed many-to-one (the base record links to a single
target). One-to-many or many-to-many joins will multiply row counts —
the v1 builder does not check this. Author your ontology links and
join keys accordingly.

## PII inheritance

When a non-admin/analyst user runs an aggregation and the dimension
(group_by / labelField) references a joined field that is HIGH PII on
the joined OT, the response masks the dimension values as
`***REDACTED***`. Cache is keyed per-tenant; masking happens
post-cache per request, so admin and viewer roles get different views
of the same cached payload.

## Linked-link resolution

Joins can be declared by `link_id` instead of explicit `on` keys.
When set, the route handler looks up the `OntologyLinkRow` and pulls
the first entry from `join_keys` to populate the join condition.
Useful when an ontology link has already been declared in the schema —
the widget can say "join via this relationship" without restating
the source/target field pair.

---

# Computed fields

Per-widget virtual columns referenced by alias anywhere a field name
is expected (valueField, labelField, agg.field, filter.field, or
inside another computed field).

## Per-widget

Authored in **Advanced → Computed fields**. Two inputs per row: the
alias name and the expression. The expression editor parses on every
keystroke and shows inline errors.

Cyclic references (`a` references `b` references `a`) are rejected
with a 400 at request time.

## Per-object-type

A property on an Object Type can carry a `computed: {expression}`
field. The `/aggregate` endpoint auto-merges OT-level computed
properties into every widget's `computed_fields` list — so the alias
works in every widget on that OT without restating the expression.

Widget-level computed fields shadow OT-level ones of the same name
(useful for one-off tweaks without editing the schema).

Edit OT-level computed properties from the ontology panel: each
property row has a `+ Make computed` button that reveals an
expression editor. A `ƒx` badge on the property name marks computed
properties in the schema view.

## When to use which

| Pattern | Place it |
|---|---|
| One-off per chart | Widget-level computed field |
| Used by 3+ widgets on the same OT | OT-level computed property |
| Used by widgets on *different* OTs | Widget-level on each, or a Logic Function that materializes a derived OT |

---

# Window functions

Attach a `window` config to an aggregation to make it a SQL window
function over the inner grouped result rather than a regular group
aggregation.

## Methods

| Method | Notes |
|---|---|
| `sum`, `avg`, `min`, `max`, `count` | Re-runnable composable methods |
| `lag`, `lead` | Take an `offset` (default 1) |
| `rank`, `dense_rank`, `row_number` | Don't take a value source |
| `first_value`, `last_value` | Take a value source |

## Frame modes

- **cumulative** — `ROWS UNBOUNDED PRECEDING ... CURRENT ROW`.
  Running totals, cumulative sums.
- **rolling** — `ROWS BETWEEN N PRECEDING AND CURRENT ROW`.
  Moving averages and sums; requires `frame_rows ≥ 1`.
- **all** — no frame clause. Required for ranking, lag/lead.

## Source references

When a window method needs a value (everything except `rank`,
`dense_rank`, `row_number`), the aggregation's `field` is interpreted
as a reference to an **inner column**: `grp` (the time/group bucket),
`series` (the secondary group dimension in multi-series time charts),
or `agg_N` (the alias of a non-windowed aggregation earlier in the
list).

Raw column names like `monthly_salary` are *rejected* in a windowed
source slot. Use a non-windowed `sum`/`avg` first to land the value
as `agg_0`, then reference `agg_0` in the windowed agg.

---

# Worked examples

## Cumulative cost per project — running total line chart

Setup: a Project Assignment OT with `employee_id`, `project_id`,
`allocation_pct`, `start_date`. Want a line chart that shows each
project's daily salary run-rate climbing as new assignments start.

**Join 1** — `emp` → Employee, source = `employee_id`, target =
`id (record id)`

**Join 2** — `proj` → Project (or HR Project), source = `project_id`,
target = `id (record id)`

**Computed field** `daily_cost`:
```
emp.monthly_salary / 30 * allocation_pct / 100
```

**Widget config:**

- labelField = `proj.name`
- valueField = `daily_cost`, aggregation = `sum`
- xField = `start_date`, timeBucket = `day`

**Window:** turn on, frame = `cumulative`, partition by `series`,
order by `grp` asc.

What this shows: as each assignment starts, its daily_cost is added
to that project's running line. The line tracks "as of this date,
this project is consuming $X/day in salary."

> ⚠️ This is *daily run rate*, not *dollars spent*. For total dollars
> spent see the next example.

## Total cost spent per project to date — bar chart

Setup as above, but a single bar per project showing total dollars
incurred so far.

**Computed field** `accumulated_cost`:
```
emp.monthly_salary / 30 * allocation_pct / 100 * date_diff("day", to_date(start_date), now())
```

**Widget config (bar chart):**

- GROUP BY = `proj.name`
- VALUE = `accumulated_cost`, aggregation = `sum`
- No timeBucket, no window

Output: SI-HAM = $X, Funes Hartmann = $Y, etc.

The math: each assignment contributes `daily_cost × days_active`
dollars to its project's total. Sum across all active assignments
gives the project's cost to date.

## Joined-name labels — bar by employee name not ID

When Project Assignment has only `employee_id` but you want the
chart's x-axis labeled with full names:

**Join** `emp` → Employee on `employee_id` = `id (record id)`.

**Widget:** labelField = `emp.full_name`, valueField = `allocation_pct`
(or any numeric you want to chart), aggregation = `avg`.

No computed field, no window. Pure name lookup.

## 7-day moving average of daily volume

For a line chart of "average daily volume over the last 7 days":

Add **two aggregations** to the same widget:

1. `{field: "amount", method: "sum"}` — daily total (lands as `agg_0`)
2. `{method: "avg", field: "agg_0", window: {frame_mode: "rolling",
   frame_rows: 7, order_by: [{field: "grp", dir: "asc"}]}}`

The second aggregation is windowed: it takes the daily total (`agg_0`)
and averages it over the last 7 days for each row.

## Rank projects by current cost

Add to a bar chart already grouped by `proj.name`:

1. `{field: "daily_cost", method: "sum"}` → `agg_0`
2. `{method: "rank", window: {order_by: [{field: "agg_0", dir: "desc"}],
   frame_mode: "all"}}` → `agg_1`

Each project gets its rank in `agg_1`. The widget can label bars
with the rank or filter to top-5.

---

# When NOT to use these primitives

These features replace materialization for *visualization*. They are
not a replacement for Logic Functions when:

- The computation is reused by many widgets across multiple OTs
  (build an OT-level computed property OR materialize a derived OT
  via Logic Function once)
- You need point-in-time historical snapshots ("how much had we spent
  on day D 18 months ago"). Window functions over the *current* data
  give you "as of right now" rolled up across time — they cannot
  reconstruct a snapshot from data that no longer exists in its
  former state.
- Performance: a join on a 100M-row base table to a 10M-row dimension
  is expensive to run on every dashboard render. If the join result
  is stable, materialize.
- Pipeline-side logic (event enrichment, validation, side effects).
  /aggregate is read-only.

---

# Wire format reference (for AI agents and integrations)

The `/aggregate` request body accepts the standard fields plus three
optional advanced ones:

```json
{
  "group_by": "<field or alias.field>",
  "time_bucket": {"field": "<date field>", "interval": "day"},
  "aggregations": [
    {"field": "<field>", "method": "sum",
     "window": {"partition_by": ["series"],
                "order_by": [{"field": "grp", "dir": "asc"}],
                "frame_mode": "cumulative"}}
  ],
  "computed_fields": [
    {"name": "daily_cost",
     "expression": {
       "type": "op", "op": "mul",
       "left": {"type": "op", "op": "div",
                "left": {"type": "field", "name": "emp.monthly_salary"},
                "right": {"type": "lit", "value": 30}},
       "right": {"type": "op", "op": "div",
                 "left": {"type": "field", "name": "allocation_pct"},
                 "right": {"type": "lit", "value": 100}}
     }}
  ],
  "joins": [
    {"alias": "emp",
     "target_object_type_id": "<Employee-id>",
     "on": {"source_field": "employee_id", "target_field": "id"},
     "type": "left"}
  ]
}
```

`expression` follows the AST grammar in
`backend/ontology_service/expressions.py`. The Pydantic models there
are the canonical schema; mirror them in the frontend (`types/app.ts`)
when bumping the spec.

Cache key includes `computed_fields` and `joins` — editing either
busts cached aggregations as expected.

---

# Reference: code locations

- Backend SQL builder: `backend/ontology_service/routers/records.py`
  (`build_aggregate_sql` and helpers)
- Expression AST and SQL emitter:
  `backend/ontology_service/expressions.py`
- Frontend types: `frontend/src/types/app.ts` (`Expr`,
  `ComputedField`, `WindowSpec`, `JoinSpec`)
- Visual builder: `frontend/src/modules/apps/widgets/`
  (`ExpressionInput.tsx`, `JoinPicker.tsx`, `WindowConfig.tsx`,
  `ComputedFieldsEditor.tsx`, `AdvancedSection.tsx`)
- OT-level computed property editor:
  `frontend/src/modules/ontology/PropertyComputedEditor.tsx`
- Assistant prompt guidance for these features:
  `backend/inference_service/claude_client.py` (search
  `generate_widget`)
