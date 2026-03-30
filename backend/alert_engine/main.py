import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from database import init_db
from scheduler import start_scheduler, stop_scheduler
from routers import rules, notifications

logging.basicConfig(level=logging.INFO)


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    start_scheduler()
    yield
    stop_scheduler()


app = FastAPI(title="Nexus Alert Engine", version="1.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(rules.router, prefix="/alerts/rules", tags=["rules"])
app.include_router(notifications.router, prefix="/alerts/notifications", tags=["notifications"])


@app.get("/health")
async def health():
    return {"status": "ok", "service": "alert-engine"}
