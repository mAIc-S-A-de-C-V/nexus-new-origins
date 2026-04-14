import os
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from database import init_db
from database_pg import init_pg_db
from routers import process
from routers import conformance

# CORS
_raw_origins = os.environ.get("ALLOWED_ORIGINS", "http://localhost:3000,http://localhost:5173")
ALLOWED_ORIGINS = [o.strip() for o in _raw_origins.split(",") if o.strip()]

app = FastAPI(title="Nexus Process Engine", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(process.router, prefix="/process", tags=["process"])
app.include_router(conformance.router, prefix="/process/conformance", tags=["conformance"])


@app.on_event("startup")
async def startup():
    await init_db()
    await init_pg_db()


@app.get("/health")
async def health():
    return {"status": "ok", "service": "process-engine"}


from fastapi import Request as _Req


@app.middleware("http")
async def _security_headers(request: _Req, call_next):
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["X-XSS-Protection"] = "1; mode=block"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    return response
