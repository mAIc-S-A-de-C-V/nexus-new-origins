# PO research agent — Scrapling-backed search + memo

End-to-end: a new email arrives → pipeline ingests the Excel → for each new
PR the agent searches the public web for matching parts → it scrapes the
top hits → and proposes a `po_research_memo` action that lands in the
Human Actions queue with citations and a recommendation.

Built on existing infra: `AGENT_RUN` pipeline node, `agent_service` tools
framework, `action_propose` tool (already creates Human Actions). The only
new piece is a `scraping-service` microservice wrapping
[Scrapling](https://github.com/D4Vinci/Scrapling).

## What was added

| Piece | Where | What |
|---|---|---|
| `scraping-service` | `backend/scraping_service/` | FastAPI on `:8027` exposing `POST /search`, `POST /scrape`. Uses Scrapling's `AsyncFetcher` (default) or `StealthyFetcher`/Camoufox (opt-in via `use_stealth: true`). |
| `web_search` tool | `backend/agent_service/tools.py` | Proxies to `scraping-service /search` (DuckDuckGo HTML). Returns `[{url, title, snippet}]`. |
| `scrape_url` tool | `backend/agent_service/tools.py` | Proxies to `scraping-service /scrape`. Returns `{title, text, selected, links}`. |
| `po_research_memo` action | seeded via `scripts/seed_po_research_action.sh` | The memo the agent proposes. `requires_confirmation: true` → goes to Human Actions. |

## Deploy

```bash
ssh ec2 && cd nexus-new-origins
git pull
docker compose up -d --build scraping-service agent-service
```

Sanity check the new service:

```bash
# Direct health
curl -s http://localhost:8027/health
# Expect: {"ok":true,"service":"scraping"}

# A real search (no API key needed)
curl -s -X POST http://localhost:8027/search \
  -H 'Content-Type: application/json' \
  -d '{"query":"BACB30NN4K12 boeing fastener","max_results":5}' | python3 -m json.tool

# Scrape a single URL (use one from the search above)
curl -s -X POST http://localhost:8027/scrape \
  -H 'Content-Type: application/json' \
  -d '{"url":"https://example.com","extract_text":true}' | python3 -m json.tool
```

## Seed the action template

```bash
TENANT=tenant-e31788fd ./scripts/seed_po_research_action.sh
```

Verify:

```bash
curl -s -H "x-tenant-id: tenant-e31788fd" http://localhost:8004/actions/po_research_memo \
  | python3 -m json.tool
```

## Create the agent in Agent Studio

UI → **Agent Studio** → **New agent**:

- **Name:** `po_researcher`
- **Description:** `Researches PR/PO line items: searches public web for the Mfg Part Number, scrapes top hits, and proposes a po_research_memo for human review.`
- **Model:** `claude-haiku-4-5-20251001` (cheap; bump to sonnet if recall is poor)
- **Enabled tools:** `web_search`, `scrape_url`, `action_propose`, `query_records`, `get_object_schema`
- **System prompt** (paste verbatim):

```
You are a procurement researcher. For every purchase request you receive, you have the following job:

1. Read the PR's `mfg_part_number` and `part_desc`.
2. Use `web_search` with a precise query — the manufacturer part number first, e.g. "BACB30NN4K12 supplier price". Get up to 8 results.
3. Pick the 2–3 most promising URLs (real supplier / catalog pages, not forum threads or news). Use `scrape_url` on each. If a normal fetch fails or the body looks like a Cloudflare challenge, retry with `use_stealth: true`.
4. From the scraped text, extract: supplier name, list price (with currency), lead time (in days), MOQ. If a number isn't on the page, leave it null — do not guess.
5. Call `action_propose` with action_name="po_research_memo" and inputs:
   {
     "pr_number": "<from the PR record>",
     "mfg_part_number": "<from the PR record>",
     "part_desc": "<from the PR record>",
     "requested_qty": "<from the PR record>",
     "requested_priority": "<from the PR record>",
     "sources": [
       {"url": "<exact url scraped>", "supplier": "<from page>", "price": "<number or null>",
        "currency": "<USD/EUR/...>", "lead_time_days": <int or null>, "moq": <int or null>,
        "notes": "<short note from the scraped text>"}
     ],
     "recommendation": "<one-sentence next-step recommendation>",
     "confidence": "high" | "medium" | "low",
     "reasoning": "<2–3 sentences citing the URLs you used>"
   }

Hard rules:
- Every entry in `sources[]` MUST have a real `url` you actually fetched. Never invent suppliers.
- If `web_search` returns nothing useful or every page is gated, set confidence="low" and recommendation="No public sources found for this OEM-only part — escalate to procurement to contact OEM directly."
- Quote prices and lead times only if they appear verbatim on the page. Don't paraphrase numbers.
- Do not call any tool more than 6 times total. Stop at the first credible memo.
```

Save the agent.

## Wire into the pipeline

Open the **Gmail PO Excel Ingestion** pipeline → **Edit**. Add an `AGENT_RUN`
node after `SINK_OBJECT`:

| Field | Value |
|---|---|
| Agent | `po_researcher` |
| Instructions | (leave default — the agent's own system prompt drives behavior) |
| Max Records per Run | `5` (small batch keeps cost predictable while you tune the agent) |
| Run even when no new records | unchecked |

Save.

## Test end-to-end

1. Send a fresh email to `ejemplomroh@gmail.com` with subject containing
   `Ordenes de Compra` and the .xlsx attached.
2. Click **Run** on the pipeline.
3. After a few seconds the SOURCE→…→SINK_OBJECT chain runs, then `AGENT_RUN`
   ticks. Watch:
   ```bash
   docker logs -f nexus-new-origins-agent-service-1 2>&1 | grep -i 'po_researcher\|web_search\|scrape_url\|action_propose'
   ```
4. **Operations → Human Actions** in the UI: a `po_research_memo` card per
   new PR appears with sources, prices, recommendation. Approve / reject.

## Manual smoke test (skip the pipeline)

Run the agent against a single hand-crafted record:

```bash
# Find the agent id
docker exec -i nexus-new-origins-postgres-1 psql -U nexus -d nexus -c \
  "SELECT id, name FROM agent_configs WHERE name='po_researcher';"

AGENT_ID=<paste id>

curl -s -X POST "http://localhost:8013/agents/$AGENT_ID/test" \
  -H "x-tenant-id: tenant-e31788fd" -H "Content-Type: application/json" \
  -d '{
    "message": "Research this PR: pr_number=1289684, mfg_part_number=F56758C8A2ET, part_desc=RETAINER - BARI, requested_qty=5, requested_priority=USR"
  }' | python3 -m json.tool
```

Watch the response — the agent should call `web_search`, `scrape_url`, then
`action_propose`. The proposed action should appear in
`http://localhost:8006/actions/executions` (or the Human Actions UI).

## Troubleshooting

- **`scraping-service` health 200 but `/search` returns empty results.** DDG
  rate-limited or returned a captcha. Wait ~30 s and retry; the
  `stealthy_headers=True` path Scrapling uses should keep this rare.

- **Agent loops forever calling search/scrape.** The system prompt caps tool
  calls at 6. If it still loops, lower the agent's `max_steps` (in Agent
  Studio config) or reduce the model temperature.

- **Agent invents URLs / suppliers.** Tighten the system prompt: add
  "FAILURE MODE: do not fabricate URLs; only quote pages you actually
  fetched via scrape_url." Bump model to `claude-sonnet-4-6` for that agent.

- **JS-heavy / Cloudflare-protected sites return empty `text`.** Re-run with
  `use_stealth: true`. If you hit that often, swap the scraping-service
  base image to one with Firefox preinstalled and `pip install camoufox`.

- **Cost runaway.** Each PR triggers up to 6 LLM round-trips × 1–3 scrape
  calls. At ~$0.001/PR with Haiku, ~$0.01/PR with Sonnet. Cap pipeline runs
  per day or batch the AGENT_RUN node to 5 records max.

## Architecture notes

- Scrapling lives in its own container so its native deps (lxml, optional
  Camoufox) don't inflate every other service's image. The agent_service
  pulls results via plain HTTP; if Scrapling breaks on a future site, you
  can swap the implementation in `scrapers.py` without touching agents.
- `requires_confirmation: true` on the action means nothing goes out to
  the world automatically. Every memo is reviewed by a human before any
  follow-up (RFQ email, supplier reach-out, PO release) happens.
- Caching is **not** built in yet. If two emails reference the same
  `mfg_part_number` in a week, the agent re-searches. Adding a
  `part_research_cache` OT and having the agent `query_records` on it
  before searching is a half-day add — see Phase 2 in the conversation.
