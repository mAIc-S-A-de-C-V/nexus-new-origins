import os
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from routers import sessions

_raw_origins = os.environ.get("ALLOWED_ORIGINS", "http://localhost:3000,http://localhost:5173")
ALLOWED_ORIGINS = [o.strip() for o in _raw_origins.split(",") if o.strip()]

app = FastAPI(
    title="Nexus Kernel Service",
    description="IPython kernel sandbox for the Workbench notebook experience",
    version="0.1.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(sessions.router, prefix="/kernel", tags=["kernel"])


@app.get("/health")
async def health():
    return {"status": "ok", "service": "kernel-service"}
