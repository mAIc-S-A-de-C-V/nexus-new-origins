import os
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from database import init_db
from routers import explore, analyst, scenarios, value_tracker

_raw_origins = os.environ.get("ALLOWED_ORIGINS", "http://localhost:3000,http://localhost:5173")
ALLOWED_ORIGINS = [o.strip() for o in _raw_origins.split(",") if o.strip()]

app = FastAPI(
    title="Nexus Analytics Service",
    description="Data exploration and AIP Analyst",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(explore.router, prefix="/explore", tags=["explore"])
app.include_router(analyst.router, prefix="/analyst", tags=["analyst"])
app.include_router(scenarios.router, prefix="/scenarios", tags=["scenarios"])
app.include_router(value_tracker.router, prefix="/value", tags=["value"])


@app.on_event("startup")
async def startup():
    await init_db()


@app.get("/health")
async def health():
    return {"status": "ok", "service": "analytics-service"}
