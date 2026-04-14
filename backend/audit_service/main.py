import asyncio
import os
import os as _os
from fastapi import FastAPI, Depends
from fastapi import Request as _Request
from fastapi.responses import Response as _Response
from fastapi.middleware.cors import CORSMiddleware
from routers import audit, checkpoints, approvals
from database import init_db, AsyncSessionLocal
from sqlalchemy import text as _text
from shared.nexus_logging import configure_logging
from shared.auth_middleware import require_auth

configure_logging()

AUDIT_RETENTION_DAYS = int(_os.environ.get("AUDIT_RETENTION_DAYS", "365"))


async def _audit_retention_loop():
    """Delete audit records older than AUDIT_RETENTION_DAYS. Runs daily."""
    import logging
    _log = logging.getLogger("audit.retention")
    while True:
        try:
            await asyncio.sleep(86400)  # run daily
            async with AsyncSessionLocal() as db:
                result = await db.execute(
                    _text(
                        "DELETE FROM audit_events "
                        "WHERE created_at < NOW() - INTERVAL ':days days' "
                        "RETURNING id"
                    ).bindparams(days=AUDIT_RETENTION_DAYS)
                )
                deleted = len(result.fetchall())
                await db.commit()
                _log.info(
                    "audit_retention_purge",
                    extra={"deleted_count": deleted, "retention_days": AUDIT_RETENTION_DAYS}
                )
        except Exception as e:
            _log.error(f"Audit retention error: {e}")


# CORS
_raw_origins = os.environ.get("ALLOWED_ORIGINS", "http://localhost:3000,http://localhost:5173")
ALLOWED_ORIGINS = [o.strip() for o in _raw_origins.split(",") if o.strip()]

app = FastAPI(
    title="Nexus Audit Service",
    description="Immutable audit trail for all platform operations",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(audit.router, prefix="/audit", tags=["audit"], dependencies=[Depends(require_auth)])
app.include_router(checkpoints.router, prefix="/audit", tags=["checkpoints"], dependencies=[Depends(require_auth)])
app.include_router(approvals.router, prefix="/audit", tags=["approvals"], dependencies=[Depends(require_auth)])


@app.middleware("http")
async def security_headers(request: _Request, call_next):
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["X-XSS-Protection"] = "1; mode=block"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    return response


@app.on_event("startup")
async def startup():
    await init_db()
    asyncio.create_task(_audit_retention_loop())


@app.get("/health")
async def health():
    return {"status": "ok", "service": "audit-service"}
