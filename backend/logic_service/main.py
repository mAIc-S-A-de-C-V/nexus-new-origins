from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from routers import functions, runs, schedules
from database import init_db
from scheduler import get_scheduler, load_schedules_from_db

app = FastAPI(
    title="Nexus Logic Service",
    description="LLM Function Engine — build, run, and publish Logic Functions",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(functions.router, prefix="/logic/functions", tags=["functions"])
app.include_router(runs.router, prefix="/logic/runs", tags=["runs"])
app.include_router(schedules.router, prefix="/logic/functions", tags=["schedules"])


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
