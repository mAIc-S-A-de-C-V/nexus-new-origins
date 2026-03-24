from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from routers import ontology, records, apps
from database import init_db

app = FastAPI(
    title="Nexus Ontology Service",
    description="Manages the enterprise data ontology — object types, properties, and schema evolution",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(ontology.router, prefix="/object-types", tags=["ontology"])
app.include_router(records.router, prefix="/object-types", tags=["records"])
app.include_router(apps.router, prefix="/apps", tags=["apps"])


@app.on_event("startup")
async def startup():
    await init_db()


@app.get("/health")
async def health():
    return {"status": "ok", "service": "ontology-service"}
