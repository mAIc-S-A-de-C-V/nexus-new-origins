import os
import asyncio as _asyncio
import os as _os
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from routers import events, timeseries
from database import init_db

# CORS
_raw_origins = os.environ.get("ALLOWED_ORIGINS", "http://localhost:3000,http://localhost:5173")
ALLOWED_ORIGINS = [o.strip() for o in _raw_origins.split(",") if o.strip()]

app = FastAPI(
    title="Nexus Event Log Service",
    description="Manages the process mining event log",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

from fastapi import Depends as _Dep
from shared.auth_middleware import require_auth as _require_auth
app.include_router(events.router, prefix="/events", tags=["events"], dependencies=[_Dep(_require_auth)])
app.include_router(timeseries.router, prefix="/events", tags=["timeseries"], dependencies=[_Dep(_require_auth)])


EVENT_RETENTION_DAYS = int(_os.environ.get("EVENT_RETENTION_DAYS", "90"))


async def _event_retention_loop():
    import logging
    _log = logging.getLogger("events.retention")
    while True:
        try:
            await _asyncio.sleep(86400)
            from database import engine
            from sqlalchemy import text as _text
            async with engine.begin() as conn:
                result = await conn.execute(
                    _text(
                        "DELETE FROM events "
                        "WHERE timestamp < NOW() - (:days * INTERVAL '1 day') "
                        "RETURNING id"
                    ),
                    {"days": EVENT_RETENTION_DAYS}
                )
                deleted = result.rowcount
                _log.info(f"event_retention_purge: deleted {deleted} events older than {EVENT_RETENTION_DAYS} days")
        except Exception as e:
            import logging
            logging.getLogger("events.retention").error(f"Event retention error: {e}")


@app.on_event("startup")
async def startup():
    await init_db()
    _asyncio.create_task(_event_retention_loop())


@app.get("/health")
async def health():
    return {"status": "ok", "service": "event-log-service"}


from fastapi import Request as _Req, Depends as _Dep
from shared.auth_middleware import require_auth as _require_auth


@app.middleware("http")
async def _security_headers(request: _Req, call_next):
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["X-XSS-Protection"] = "1; mode=block"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    return response
