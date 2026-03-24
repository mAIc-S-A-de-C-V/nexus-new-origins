from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from routers import connectors
from database import init_db

app = FastAPI(
    title="Nexus Connector Service",
    description="Manages connector configurations and schema discovery",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(connectors.router, prefix="/connectors", tags=["connectors"])


@app.on_event("startup")
async def startup():
    await init_db()


@app.get("/health")
async def health():
    return {"status": "ok", "service": "connector-service"}
