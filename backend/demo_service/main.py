"""
Nexus Demo Service — Serves realistic process mining datasets via REST API.

Each dataset acts as an external data source that Nexus connectors can pull from.
Point a REST_API connector at http://localhost:8024/datasets/{id}/records to ingest.

Datasets span Finance, Procurement, Healthcare, Government, Manufacturing, and Travel.
"""

import os
import logging
import json
import sys

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from routers import datasets

_handler = logging.StreamHandler(sys.stdout)
_handler.setFormatter(type("J", (logging.Formatter,), {
    "format": lambda self, r: json.dumps({
        "ts": __import__("datetime").datetime.utcnow().isoformat() + "Z",
        "level": r.levelname.lower(), "service": "demo-service", "msg": r.getMessage()
    }, default=str)
})())
logging.basicConfig(handlers=[_handler], level=logging.INFO, force=True)

# CORS
_raw_origins = os.environ.get("ALLOWED_ORIGINS", "http://localhost:3000,http://localhost:5173")
ALLOWED_ORIGINS = [o.strip() for o in _raw_origins.split(",") if o.strip()]

app = FastAPI(
    title="Nexus Demo Service",
    description="Serves realistic BPI Challenge / process mining datasets as REST APIs "
                "for demo and video recording purposes.",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Demo service — open CORS
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# No auth required — this is a demo data source
app.include_router(datasets.router, prefix="/datasets", tags=["datasets"])


@app.get("/")
async def root():
    """Service overview with links to all available datasets."""
    return {
        "service": "Nexus Demo Service",
        "description": "Realistic process mining datasets for demos and video recordings.",
        "docs": "/docs",
        "endpoints": {
            "list_all": "GET /datasets/",
            "dataset_info": "GET /datasets/{id}",
            "dataset_schema": "GET /datasets/{id}/schema",
            "dataset_records": "GET /datasets/{id}/records?limit=100&offset=0",
            "dataset_cases": "GET /datasets/{id}/cases?limit=50",
            "dataset_stats": "GET /datasets/{id}/stats",
        },
        "industries": [
            "Finance / Banking",
            "Procurement / ERP",
            "Healthcare",
            "IT Service Management",
            "Government / Compliance",
            "Manufacturing / IoT",
            "Travel & Expenses",
        ],
    }


@app.get("/health")
async def health():
    return {"status": "ok", "service": "demo-service"}
