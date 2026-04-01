from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from routers import agents, threads, schedules
from database import init_db
from scheduler import start_scheduler, stop_scheduler

app = FastAPI(
    title="Nexus Agent Service",
    description="Configurable AI agents with tool use — agentic loop over ontology + logic functions",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(agents.router, prefix="/agents", tags=["agents"])
app.include_router(threads.router, prefix="/threads", tags=["threads"])
app.include_router(schedules.router, prefix="/agents", tags=["schedules"])


@app.on_event("startup")
async def startup():
    await init_db()
    start_scheduler()


@app.on_event("shutdown")
async def shutdown():
    stop_scheduler()


@app.get("/health")
async def health():
    return {"status": "ok", "service": "agent-service"}
