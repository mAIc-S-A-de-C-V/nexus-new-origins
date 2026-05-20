"""
Nexus Insight Engine — nightly statistical discovery service.

Boots APScheduler, exposes /insights, /insights/runs, /insights/config.
"""
import logging
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI, Depends, Request
from fastapi.middleware.cors import CORSMiddleware

from database import init_db
from scheduler import start_scheduler, stop_scheduler
from routers import insights as insights_router
from routers import runs as runs_router
from routers import config as config_router

# Lazy-import family modules so they self-register. Wrapped in try/except so
# missing dependencies during a partial install don't crash startup.
def _import_families():
    try:
        from families import univariate_stats  # noqa: F401
    except Exception as exc:
        logging.warning("univariate_stats not loaded: %s", exc)
    try:
        from families import mutual_info  # noqa: F401
    except Exception as exc:
        logging.warning("mutual_info not loaded: %s", exc)
    try:
        from families import tree_importance  # noqa: F401
    except Exception as exc:
        logging.warning("tree_importance not loaded: %s", exc)
    try:
        from families import record_linkage  # noqa: F401
    except Exception as exc:
        logging.warning("record_linkage not loaded: %s", exc)
    try:
        from families import clustering  # noqa: F401
    except Exception as exc:
        logging.warning("clustering not loaded: %s", exc)
    try:
        from families import anomaly_records  # noqa: F401
    except Exception as exc:
        logging.warning("anomaly_records not loaded: %s", exc)
    try:
        from families import association_rules  # noqa: F401
    except Exception as exc:
        logging.warning("association_rules not loaded: %s", exc)
    try:
        from families import sequence_mining  # noqa: F401
    except Exception as exc:
        logging.warning("sequence_mining not loaded: %s", exc)
    try:
        from families import survival  # noqa: F401
    except Exception as exc:
        logging.warning("survival not loaded: %s", exc)
    try:
        from families import ts_anomaly  # noqa: F401
    except Exception as exc:
        logging.warning("ts_anomaly not loaded: %s", exc)
    try:
        from families import propensity  # noqa: F401
    except Exception as exc:
        logging.warning("propensity not loaded: %s", exc)
    try:
        from families import causal  # noqa: F401
    except Exception as exc:
        logging.warning("causal not loaded: %s", exc)
    try:
        from families import joined_correlations  # noqa: F401
    except Exception as exc:
        logging.warning("joined_correlations not loaded: %s", exc)
    try:
        from families import text_clusters  # noqa: F401
    except Exception as exc:
        logging.warning("text_clusters not loaded: %s", exc)


logging.basicConfig(level=logging.INFO)

_raw_origins = os.environ.get("ALLOWED_ORIGINS", "http://localhost:3000,http://localhost:5173")
ALLOWED_ORIGINS = [o.strip() for o in _raw_origins.split(",") if o.strip()]


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    _import_families()
    start_scheduler()
    yield
    stop_scheduler()


app = FastAPI(title="Nexus Insight Engine", version="1.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Auth dependency reused from shared layer. SKIP_AUTH defaults to true in dev.
try:
    from shared.auth_middleware import require_auth as _require_auth
    deps = [Depends(_require_auth)]
except Exception:
    deps = []

app.include_router(insights_router.router, prefix="/insights", tags=["insights"], dependencies=deps)
app.include_router(runs_router.router, prefix="/insights/runs", tags=["runs"], dependencies=deps)
app.include_router(config_router.router, prefix="/insights/config", tags=["config"], dependencies=deps)


@app.get("/health")
async def health():
    return {"status": "ok", "service": "insight-engine"}


@app.middleware("http")
async def _security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["X-XSS-Protection"] = "1; mode=block"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    return response
