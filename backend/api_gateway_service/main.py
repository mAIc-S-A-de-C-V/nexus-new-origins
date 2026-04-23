import os
import time
import logging

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware

from routers import keys, endpoints, usage
from database import get_pool, close_pool
from rate_limit import close_client

logger = logging.getLogger("api_gateway")

_raw_origins = os.environ.get("ALLOWED_ORIGINS", "http://localhost:3000,http://localhost:5173")
ALLOWED_ORIGINS = [o.strip() for o in _raw_origins.split(",") if o.strip()]

app = FastAPI(
    title="Nexus API Gateway",
    description="Expose ontology data and event logs as external REST APIs",
    version="1.1.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def usage_logger(request: Request, call_next):
    start = time.perf_counter()
    response = None
    error_msg: str | None = None
    status_code = 500
    try:
        response = await call_next(request)
        status_code = response.status_code
        return response
    except Exception as exc:
        error_msg = str(exc)[:500]
        raise
    finally:
        duration_ms = int((time.perf_counter() - start) * 1000)
        path = request.url.path
        # Only log public /v1/* traffic
        if "/gateway/v1/" in path or path.startswith("/v1/"):
            try:
                bytes_out = 0
                if response is not None:
                    cl = response.headers.get("content-length")
                    if cl and cl.isdigit():
                        bytes_out = int(cl)

                api_key = getattr(request.state, "api_key", None)
                tenant_id = (api_key or {}).get("tenant_id") or request.headers.get("x-tenant-id") or "tenant-001"
                key_id = (api_key or {}).get("id")
                key_prefix = (api_key or {}).get("prefix")

                # Extract slug from path (…/v1/{slug} or …/v1/events/{slug})
                endpoint_slug = None
                resource_type = None
                parts = path.split("/v1/", 1)
                if len(parts) == 2:
                    tail = parts[1].strip("/").split("/")
                    if tail:
                        if tail[0] == "events" and len(tail) > 1:
                            endpoint_slug = tail[1]
                            resource_type = "events"
                        elif tail[0] and tail[0] != "openapi.json":
                            endpoint_slug = tail[0]
                            resource_type = "records"

                fwd = request.headers.get("x-forwarded-for", "")
                client_ip = fwd.split(",")[0].strip() if fwd else (request.client.host if request.client else "")

                pool = await get_pool()
                await pool.execute(
                    """
                    INSERT INTO api_key_usage_log
                        (tenant_id, key_id, key_prefix, endpoint_slug, resource_type,
                         method, path, status_code, bytes_out, duration_ms, client_ip, error)
                    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
                    """,
                    tenant_id, key_id, key_prefix, endpoint_slug, resource_type,
                    request.method, path, status_code, bytes_out, duration_ms, client_ip, error_msg,
                )
            except Exception:
                logger.exception("Failed to log API usage")


app.include_router(keys.router, prefix="/gateway/keys", tags=["api-keys"])
app.include_router(usage.router, prefix="/gateway/usage", tags=["usage"])
app.include_router(endpoints.router, prefix="/gateway", tags=["gateway"])


@app.on_event("startup")
async def startup():
    await get_pool()


@app.on_event("shutdown")
async def shutdown():
    await close_pool()
    await close_client()


@app.get("/health")
async def health():
    return {"status": "ok", "service": "api-gateway-service"}
