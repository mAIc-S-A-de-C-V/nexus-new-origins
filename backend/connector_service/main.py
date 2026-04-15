import os
import logging, json, sys
from fastapi import FastAPI, Depends
from fastapi import Request as _Request
from fastapi.responses import Response as _Response
from fastapi.middleware.cors import CORSMiddleware
from routers import connectors, webhooks
from database import init_db
from auth_middleware import require_auth

_handler = logging.StreamHandler(sys.stdout)
_handler.setFormatter(type("J", (logging.Formatter,), {
    "format": lambda self, r: json.dumps({
        "ts": __import__("datetime").datetime.utcnow().isoformat()+"Z",
        "level": r.levelname.lower(), "service": "connector-service", "msg": r.getMessage()
    }, default=str)
})())
logging.basicConfig(handlers=[_handler], level=logging.INFO, force=True)

# CORS
_raw_origins = os.environ.get("ALLOWED_ORIGINS", "http://localhost:3000,http://localhost:5173")
ALLOWED_ORIGINS = [o.strip() for o in _raw_origins.split(",") if o.strip()]

app = FastAPI(
    title="Nexus Connector Service",
    description="Manages connector configurations and schema discovery",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(connectors.router, prefix="/connectors", tags=["connectors"], dependencies=[Depends(require_auth)])
app.include_router(webhooks.router, prefix="/webhooks", tags=["webhooks"])

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


@app.on_event("startup")
async def startup():
    await init_db()


@app.get("/health")
async def health():
    return {"status": "ok", "service": "connector-service"}
