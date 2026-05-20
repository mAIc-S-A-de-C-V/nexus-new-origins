import logging
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI, Depends
from fastapi.middleware.cors import CORSMiddleware

from database import init_db
from presets import seed_presets
from scheduler import start_scheduler, stop_scheduler
from routers import rules, notifications, channels
from auth_middleware import require_auth

logging.basicConfig(level=logging.INFO)

# CORS
_raw_origins = os.environ.get("ALLOWED_ORIGINS", "http://localhost:3000,http://localhost:5173")
ALLOWED_ORIGINS = [o.strip() for o in _raw_origins.split(",") if o.strip()]


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    try:
        await seed_presets()
    except Exception as exc:
        logging.getLogger(__name__).warning("preset seeding failed: %s", exc)
    start_scheduler()
    yield
    stop_scheduler()


app = FastAPI(title="Nexus Alert Engine", version="1.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(rules.router, prefix="/alerts/rules", tags=["rules"], dependencies=[Depends(require_auth)])
app.include_router(notifications.router, prefix="/alerts/notifications", tags=["notifications"], dependencies=[Depends(require_auth)])
app.include_router(channels.router, prefix="/alerts", tags=["channels"], dependencies=[Depends(require_auth)])

# Phase 14: routing / on-call / per-user preferences
try:
    from routers import routing as _routing
    app.include_router(_routing.router, prefix="/alerts", tags=["routing"], dependencies=[Depends(require_auth)])
except Exception as _exc:
    logging.warning("routing router not loaded: %s", _exc)


@app.get("/health")
async def health():
    return {"status": "ok", "service": "alert-engine"}


from fastapi import Request as _Req


@app.middleware("http")
async def _security_headers(request: _Req, call_next):
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["X-XSS-Protection"] = "1; mode=block"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    return response
