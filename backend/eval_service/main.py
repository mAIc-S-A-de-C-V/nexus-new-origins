import os
from fastapi import FastAPI, Depends
from fastapi import Request as _Request
from fastapi.responses import JSONResponse as _JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from database import init_db
from routers import suites, cases, runs, experiments

_raw_origins = os.environ.get("ALLOWED_ORIGINS", "http://localhost:3000,http://localhost:5173")
ALLOWED_ORIGINS = [o.strip() for o in _raw_origins.split(",") if o.strip()]

app = FastAPI(
    title="Nexus Eval Service",
    description="Evaluation framework — test and measure every AI output",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

MAX_BODY_SIZE = int(os.environ.get("MAX_BODY_SIZE_MB", "10")) * 1024 * 1024


@app.middleware("http")
async def limit_body_size(request: _Request, call_next):
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
    return response


# Health must be registered before wildcard route handlers
@app.get("/health")
async def health():
    return {"status": "ok", "service": "eval-service"}


app.include_router(suites.router, prefix="/suites", tags=["suites"])
# Cases have two route shapes: /suites/{id}/cases and /cases/{id}
# Mount at root so both prefixes work
app.include_router(cases.router, tags=["cases"])
# Runs have two shapes: /suites/{id}/run and /runs/{id}
app.include_router(runs.router, tags=["runs"])
app.include_router(experiments.router, prefix="/experiments", tags=["experiments"])


@app.on_event("startup")
async def startup():
    await init_db()
