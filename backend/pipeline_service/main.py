import asyncio
import os
from fastapi import FastAPI, Depends
from fastapi import Request as _Request
from fastapi.responses import Response as _Response
from fastapi.middleware.cors import CORSMiddleware
from routers import pipelines, schedules
from database import init_db
from scheduler import scheduler_loop
from cron_scheduler import cron_scheduler_loop
from shared.auth_middleware import require_auth
from shared.nexus_logging import configure_logging

configure_logging()

# CORS
_raw_origins = os.environ.get("ALLOWED_ORIGINS", "http://localhost:3000,http://localhost:5173")
ALLOWED_ORIGINS = [o.strip() for o in _raw_origins.split(",") if o.strip()]

app = FastAPI(
    title="Nexus Pipeline Service",
    description="Manages pipeline DAGs and execution",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(pipelines.router, prefix="/pipelines", tags=["pipelines"], dependencies=[Depends(require_auth)])
app.include_router(schedules.router, prefix="/pipelines", tags=["schedules"], dependencies=[Depends(require_auth)])


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
    asyncio.create_task(scheduler_loop())
    asyncio.create_task(cron_scheduler_loop())


@app.get("/health")
async def health():
    return {"status": "ok", "service": "pipeline-service"}
