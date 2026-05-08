# `qa/` — Playwright E2E tests

Browser-based end-to-end test suite using Playwright + TypeScript. Runs against a fully-up local stack.

Path: `/Users/ishmontalvo/Desktop/nexus-new-origins/qa/`

## Files

```
qa/
├── playwright.config.ts             Browser config, timeouts, reporting
├── tests/
│   ├── helpers.ts                   Shared utilities (login, waits, assertions)
│   ├── qa_e2e_creation.spec.ts      Connector → ingestion → ontology
│   ├── qa_e2e_full.spec.ts          Full platform walkthrough across modules
│   └── qa_sepsis.spec.ts            Sepsis-specific (ICU workflows)
├── results/                          (gitignored) raw test outputs
└── test-results/                     (gitignored) Playwright traces, screenshots
```

## Run

```bash
cd qa
npm install
npx playwright test                  # all
npx playwright test qa_e2e_creation  # single spec
npx playwright test --headed         # see the browser
```

Stack must be up first: `docker-compose up -d` from repo root.

## When to add a test

- New endpoint → add to the matching spec.
- Breaking change → regression test in existing spec.
- Performance assertion → add timing checks via `test.expect(elapsed).toBeLessThan(...)`.

## Notes

- No unit tests exist for frontend or backend — Playwright E2E + manual is the current strategy.
- For backend unit tests, look at `backend/ontology_service/tests/` (pytest) — limited coverage of query_cache, index_advisor, rollup_promoter, aggregate.
