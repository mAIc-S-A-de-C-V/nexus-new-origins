import os
from fastapi import FastAPI
from fastapi import Request as _Request
from fastapi.middleware.cors import CORSMiddleware
from routers.lineage import router as lineage_router

_raw_origins = os.environ.get("ALLOWED_ORIGINS", "http://localhost:3000,http://localhost:5173")
ALLOWED_ORIGINS = [o.strip() for o in _raw_origins.split(",") if o.strip()]

app = FastAPI(
    title="Nexus Lineage Service",
    description="Read-only data lineage aggregator — traces data flow across all Nexus services",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def security_headers(request: _Request, call_next):
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["X-XSS-Protection"] = "1; mode=block"
    return response


@app.get("/health")
async def health():
    return {"status": "ok", "service": "lineage-service"}


app.include_router(lineage_router, prefix="/lineage", tags=["lineage"])
