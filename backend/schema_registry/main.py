from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from routers import schemas

app = FastAPI(
    title="Nexus Schema Registry",
    description="Stores and versions raw connector schemas",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(schemas.router, prefix="/schemas", tags=["schemas"])


@app.get("/health")
async def health():
    return {"status": "ok", "service": "schema-registry"}
