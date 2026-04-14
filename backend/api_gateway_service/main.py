import os
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from routers import keys, endpoints
from database import get_pool, close_pool

_raw_origins = os.environ.get("ALLOWED_ORIGINS", "http://localhost:3000,http://localhost:5173")
ALLOWED_ORIGINS = [o.strip() for o in _raw_origins.split(",") if o.strip()]

app = FastAPI(
    title="Nexus API Gateway",
    description="Expose ontology data as external REST APIs",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(keys.router, prefix="/gateway/keys", tags=["api-keys"])
app.include_router(endpoints.router, prefix="/gateway", tags=["gateway"])


@app.on_event("startup")
async def startup():
    await get_pool()


@app.on_event("shutdown")
async def shutdown():
    await close_pool()


@app.get("/health")
async def health():
    return {"status": "ok", "service": "api-gateway-service"}
