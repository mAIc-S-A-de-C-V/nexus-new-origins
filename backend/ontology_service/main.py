import os
import asyncio as _asyncio
import os as _os
from fastapi import FastAPI, Depends
from fastapi import Request as _Request
from fastapi.responses import Response as _Response
from fastapi.middleware.cors import CORSMiddleware
from routers import ontology, records, apps, actions, graph
from database import init_db
from shared.auth_middleware import require_auth
from shared.nexus_logging import configure_logging
from sqlalchemy import text as _text

configure_logging()

# CORS
_raw_origins = os.environ.get("ALLOWED_ORIGINS", "http://localhost:3000,http://localhost:5173")
ALLOWED_ORIGINS = [o.strip() for o in _raw_origins.split(",") if o.strip()]

app = FastAPI(
    title="Nexus Ontology Service",
    description="Manages the enterprise data ontology — object types, properties, and schema evolution",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(ontology.router, prefix="/object-types", tags=["ontology"], dependencies=[Depends(require_auth)])
app.include_router(records.router, prefix="/object-types", tags=["records"], dependencies=[Depends(require_auth)])
app.include_router(apps.router, prefix="/apps", tags=["apps"], dependencies=[Depends(require_auth)])
app.include_router(actions.router, prefix="/actions", tags=["actions"], dependencies=[Depends(require_auth)])
app.include_router(graph.router, prefix="/graph", tags=["graph"], dependencies=[Depends(require_auth)])

from fastapi import Request as _RequestSize
from fastapi.responses import JSONResponse as _JSONResponse

MAX_BODY_SIZE = int(os.environ.get("MAX_BODY_SIZE_MB", "10")) * 1024 * 1024

@app.middleware("http")
async def limit_body_size(request: _RequestSize, call_next):
    if request.method in ("POST", "PUT", "PATCH"):
        content_length = request.headers.get("content-length")
        if content_length and int(content_length) > MAX_BODY_SIZE:
            return _JSONResponse(
                status_code=413,
                content={"detail": f"Request body too large (max {MAX_BODY_SIZE // 1024 // 1024}MB)"},
            )
    return await call_next(request)


@app.middleware("http")
async def security_headers(request: _Request, call_next):
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["X-XSS-Protection"] = "1; mode=block"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    return response


RECORD_RETENTION_DAYS = int(_os.environ.get("RECORD_RETENTION_DAYS", "730"))  # 2 years default


async def _record_retention_loop():
    import logging
    _log = logging.getLogger("ontology.retention")
    while True:
        try:
            await _asyncio.sleep(86400)  # daily
            from database import AsyncSessionLocal
            async with AsyncSessionLocal() as db:
                result = await db.execute(
                    _text(
                        "DELETE FROM object_records "
                        "WHERE created_at < NOW() - (:days * INTERVAL '1 day') "
                        "RETURNING id"
                    ),
                    {"days": RECORD_RETENTION_DAYS}
                )
                deleted = len(result.fetchall())
                await db.commit()
                _log.info("record_retention_purge", extra={"deleted": deleted, "retention_days": RECORD_RETENTION_DAYS})
        except Exception as e:
            import logging
            logging.getLogger("ontology.retention").error(f"Retention error: {e}")


@app.on_event("startup")
async def startup():
    await init_db()
    _asyncio.create_task(_record_retention_loop())


@app.get("/health")
async def health():
    return {"status": "ok", "service": "ontology-service"}
