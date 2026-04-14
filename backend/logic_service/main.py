import os
from fastapi import FastAPI, Depends
from fastapi import Request as _Request
from fastapi.responses import Response as _Response
from fastapi.middleware.cors import CORSMiddleware
from routers import functions, runs, schedules
from database import init_db
from scheduler import get_scheduler, load_schedules_from_db
from auth_middleware import require_auth
from nexus_logging import configure_logging

configure_logging()

# CORS
_raw_origins = os.environ.get("ALLOWED_ORIGINS", "http://localhost:3000,http://localhost:5173")
ALLOWED_ORIGINS = [o.strip() for o in _raw_origins.split(",") if o.strip()]

app = FastAPI(
    title="Nexus Logic Service",
    description="LLM Function Engine — build, run, and publish Logic Functions",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(functions.router, prefix="/logic/functions", tags=["functions"], dependencies=[Depends(require_auth)])
app.include_router(runs.router, prefix="/logic/runs", tags=["runs"], dependencies=[Depends(require_auth)])
app.include_router(schedules.router, prefix="/logic/functions", tags=["schedules"], dependencies=[Depends(require_auth)])

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
    scheduler = get_scheduler()
    scheduler.start()
    await load_schedules_from_db()


@app.on_event("shutdown")
async def shutdown():
    get_scheduler().shutdown(wait=False)


@app.get("/health")
async def health():
    return {"status": "ok", "service": "logic-service"}
