import os
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from routers import inference
from routers import scanner
from routers import documents

# Environment variables used by this service:
#   ANTHROPIC_API_KEY      — required for all AI inference endpoints
#   ALLOWED_ORIGINS        — comma-separated CORS origins (default: localhost:3000,5173)
#   PIPELINE_SERVICE_URL   — internal URL of pipeline service (default: http://pipeline-service:8002)
#   LOGIC_SERVICE_URL      — internal URL of logic service (default: http://logic-service:8012)

# CORS
_raw_origins = os.environ.get("ALLOWED_ORIGINS", "http://localhost:3000,http://localhost:5173")
ALLOWED_ORIGINS = [o.strip() for o in _raw_origins.split(",") if o.strip()]

app = FastAPI(
    title="Nexus Inference Service",
    description="AI-powered schema inference and similarity scoring via Claude",
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
app.include_router(inference.router, prefix="/infer", tags=["inference"], dependencies=[_Dep(_require_auth)])
app.include_router(scanner.router, prefix="/infer", tags=["scanner"], dependencies=[_Dep(_require_auth)])
app.include_router(documents.router, prefix="/infer", tags=["documents"], dependencies=[_Dep(_require_auth)])


@app.get("/health")
async def health():
    return {"status": "ok", "service": "inference-service"}


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
