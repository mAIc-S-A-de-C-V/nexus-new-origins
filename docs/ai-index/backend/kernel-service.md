# kernel-service (port 8026)

**Purpose:** Per-tenant Jupyter-style kernel sessions. Powers the **Workbench** module (notebook execution) with `nexus_sdk` pre-imported.
**Stack:** Python FastAPI, jupyter_client, ipykernel, pandas, numpy, matplotlib, plotly.
**Path:** `/Users/ishmontalvo/Desktop/nexus-new-origins/backend/kernel_service/`

## Files

```
kernel_service/
├── main.py                      Minimal FastAPI; mounts /kernel router
├── kernel_manager.py            KernelRegistry — spawn IPython subprocesses; STARTUP_CODE; idle GC
├── nexus_sdk/
│   └── __init__.py              SDK callable from inside kernel cells (e.g. nexus.query_records)
├── routers/
│   └── sessions.ts              POST /sessions, /execute, /interrupt, DELETE /sessions/{id}
├── requirements.txt             fastapi, jupyter_client, ipykernel, ipython, pandas, numpy, matplotlib, plotly
└── (Dockerfile lives at backend/Dockerfile.kernel)
```

## Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/kernel/sessions` | Create session (per-tenant + per-auth-token). Spawns IPython subprocess inheriting `TENANT_ID`, `AUTH_TOKEN` env. |
| POST | `/kernel/sessions/{id}/execute` | Execute cell code (timeout 1–300s). |
| POST | `/kernel/sessions/{id}/interrupt` | Interrupt running cell. |
| DELETE | `/kernel/sessions/{id}` | Kill kernel + cleanup. |

## Startup code (`STARTUP_CODE` in kernel_manager.py)

Pre-imports: `nexus_sdk` (as `nexus`), `pandas as pd`, `numpy as np`, `plotly`, `matplotlib`. So any user cell can immediately call `nexus.query_records(...)`.

Idle reaper: kernel killed after `KERNEL_IDLE_TTL_SEC` (default 1800 = 30 min). Background loop runs every 60s.

## Output format (per cell)

```json
{
  "status": "ok" | "error",
  "outputs": [
    {"output_type": "stream", "name": "stdout"|"stderr", "text": "..."},
    {"output_type": "display_data", "data": {"text/plain":"...","text/html":"...","image/png":"<base64>"}},
    {"output_type": "error", "ename":"...", "evalue":"...", "traceback":[...]}
  ],
  "error": null | "SessionNotFound" | "Timeout"
}
```

## Cross-service (via `nexus_sdk`)

| Function | Calls |
|----------|-------|
| `nexus.query_records(...)` | ontology-service `/object-types/{id}/records` |
| `nexus.run_logic_function(...)` | logic-service `/logic/functions/{id}/run` |
| (extend as needed) | analytics, agent, pipeline, … |

## Env

`KERNEL_IDLE_TTL_SEC` (1800), `ANALYTICS_URL`, `ONTOLOGY_URL`, `ALLOWED_ORIGINS`, `SKIP_AUTH`.

## When to edit

| Intent | File |
|--------|------|
| Add a startup library | `kernel_manager.py:STARTUP_CODE`. |
| Extend nexus SDK | `nexus_sdk/__init__.py` — new function calling target service. |
| Change idle TTL | env `KERNEL_IDLE_TTL_SEC`. |
| Customize output collection | `kernel_manager.py:_execute_and_drain()` IOPub parsing. |
| Add per-tenant kernel limits | `kernel_manager.py:KernelRegistry` enforce max sessions per tenant. |
