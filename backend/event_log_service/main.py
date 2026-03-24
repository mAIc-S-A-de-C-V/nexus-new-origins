from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from routers import events
from database import init_db

app = FastAPI(
    title="Nexus Event Log Service",
    description="Manages the process mining event log",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(events.router, prefix="/events", tags=["events"])


@app.on_event("startup")
async def startup():
    await init_db()


@app.get("/health")
async def health():
    return {"status": "ok", "service": "event-log-service"}
