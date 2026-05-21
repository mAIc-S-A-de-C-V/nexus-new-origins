import logging
import os
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from database import AsyncSessionLocal, PdfJobRow, init_db
from routers import jobs
from sqlalchemy import select

logging.basicConfig(level=logging.INFO)

_raw_origins = os.environ.get(
    "ALLOWED_ORIGINS",
    "http://localhost:3000,http://localhost:5173",
)
ALLOWED_ORIGINS = [o.strip() for o in _raw_origins.split(",") if o.strip()]

app = FastAPI(
    title="Nexus PDF Extractor Service",
    description="Standalone PDF → structured rows extractor with optional ontology push",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(jobs.router, prefix="/pdf-jobs", tags=["pdf-jobs"])


@app.on_event("startup")
async def _startup():
    await init_db()
    # Any job left as `pending` or `running` from a prior process couldn't
    # have made progress without an active worker. Mark them failed so the
    # UI shows the truth and the user can re-run.
    async with AsyncSessionLocal() as db:
        result = await db.execute(
            select(PdfJobRow).where(PdfJobRow.status.in_(["pending", "running"]))
        )
        orphans = result.scalars().all()
        for row in orphans:
            row.status = "failed"
            row.error = (row.error or "") + " · Service restarted; job did not finish."
        if orphans:
            await db.commit()


@app.get("/health")
async def health():
    return {"status": "ok", "service": "pdf-extractor-service"}
