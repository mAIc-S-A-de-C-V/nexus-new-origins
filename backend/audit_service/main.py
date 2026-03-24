from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from routers import audit
from database import init_db

app = FastAPI(
    title="Nexus Audit Service",
    description="Immutable audit trail for all platform operations",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(audit.router, prefix="/audit", tags=["audit"])


@app.on_event("startup")
async def startup():
    await init_db()


@app.get("/health")
async def health():
    return {"status": "ok", "service": "audit-service"}
