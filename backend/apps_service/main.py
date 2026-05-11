"""
Nexus Apps Service — pluggable third-party app platform.

Surface:
  /app-registry/*       — marketplace catalog (read open, publish admin-only)
  /app-installs/*       — per-tenant install lifecycle + token issuance
  /apps/rpc             — capability-scoped RPC gateway (the only egress for apps)
  /apps/scopes/catalog  — scope catalog for admin install UI
  /apps/bundles/*       — static-serves extracted app bundles
  /apps/functions/*     — server-side function management
  /apps/events/ingest   — internal webhook receiver (fans out to subscribers)

Architecture decisions:
  - JWT delivery via postMessage INIT, never URL params (no Referer/log leak)
  - Bundles are immutable, content-hashed, served from app-owned domain in prod
  - Every RPC call writes an audit row; admins see full activity per install
  - App-owned KV storage scoped to (install, optional user)
  - Server-side functions sandboxed via RestrictedPython
  - Webhook subscriptions for event-driven apps (record.changed, action.executed)
  - Per-install rate limit (default 100 RPS sustained, 200 burst)
  - Payload caps: 1MB request / 5MB response / 64KB KV value / 10MB KV total
"""
import asyncio
import logging
import os
import traceback

from fastapi import FastAPI, Depends, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response

from shared.nexus_logging import configure_logging

from database import init_db
from routers import registry, installs, rpc as rpc_router, functions as functions_router, studio as studio_router, sdk_dist as sdk_dist_router
from scheduler_runtime import get_scheduler, load_all_schedules

configure_logging()
log = logging.getLogger("apps_service")


_raw_origins = os.environ.get("ALLOWED_ORIGINS", "http://localhost:3000,http://localhost:5173")
ALLOWED_ORIGINS = [o.strip() for o in _raw_origins.split(",") if o.strip()]
# Apps live on their own domains. Reflect the dev wildcard so iframes can
# load assets cross-origin without CORS hassle. Production should pin the
# real apps domain (nexus-apps.io) and serve bundles from a CDN.
_extra_apps_origins = os.environ.get("APPS_ORIGIN_PATTERNS", "")
if _extra_apps_origins:
    ALLOWED_ORIGINS.extend([o.strip() for o in _extra_apps_origins.split(",") if o.strip()])


app = FastAPI(
    title="Nexus Apps Service",
    description="Pluggable third-party app platform with iframe sandbox + capability-scoped RPC.",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Registry: read endpoints require auth; publish enforces admin in router
app.include_router(registry.router, prefix="/app-registry", tags=["registry"])
# Bundle assets need no auth; served at /apps/bundles/...
app.include_router(registry.router, prefix="/apps", tags=["bundles"], include_in_schema=False)
app.include_router(installs.router, prefix="", tags=["installs"])
app.include_router(rpc_router.router, prefix="/apps", tags=["rpc"])
app.include_router(functions_router.router, prefix="/apps", tags=["functions"])
app.include_router(studio_router.router, prefix="/app-studio", tags=["studio"])
app.include_router(sdk_dist_router.router, prefix="", tags=["sdk-dist"])


MAX_BODY_SIZE = int(os.environ.get("MAX_BODY_SIZE_MB", "25")) * 1024 * 1024


@app.middleware("http")
async def limit_body_size(request: Request, call_next):
    if request.method in ("POST", "PUT", "PATCH"):
        cl = request.headers.get("content-length")
        if cl and int(cl) > MAX_BODY_SIZE:
            return JSONResponse(
                status_code=413,
                content={"detail": f"Request body too large (max {MAX_BODY_SIZE // 1024 // 1024}MB)"},
            )
    return await call_next(request)


@app.middleware("http")
async def security_headers(request: Request, call_next):
    response: Response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    # Do NOT set X-Frame-Options: DENY here — we DO want bundle assets framed
    # by the host. The host frontend sets a tight CSP frame-src instead.
    return response


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    tb = traceback.format_exc()
    log.error("unhandled exception on %s %s: %s\n%s", request.method, request.url.path, exc, tb)
    payload = {"detail": str(exc), "type": type(exc).__name__, "path": request.url.path, "method": request.method}
    if os.environ.get("SKIP_AUTH", "true").lower() == "true":
        payload["traceback"] = tb.splitlines()[-12:]
    return JSONResponse(status_code=500, content=payload)


@app.on_event("startup")
async def startup():
    await init_db()
    sched = get_scheduler()
    sched.start()
    asyncio.create_task(load_all_schedules())


@app.on_event("shutdown")
async def shutdown():
    sched = get_scheduler()
    if sched.running:
        sched.shutdown(wait=False)


@app.get("/health")
async def health():
    return {"status": "ok", "service": "apps-service"}


@app.get("/")
async def root():
    return {"service": "apps-service", "version": "1.0.0", "docs": "/docs"}
