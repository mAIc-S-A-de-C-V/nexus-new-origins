import asyncio
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from routers import pipelines
from database import init_db
from scheduler import scheduler_loop

app = FastAPI(
    title="Nexus Pipeline Service",
    description="Manages pipeline DAGs and execution",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(pipelines.router, prefix="/pipelines", tags=["pipelines"])


@app.on_event("startup")
async def startup():
    await init_db()
    asyncio.create_task(scheduler_loop())


@app.get("/health")
async def health():
    return {"status": "ok", "service": "pipeline-service"}
