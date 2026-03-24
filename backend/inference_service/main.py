from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from routers import inference

app = FastAPI(
    title="Nexus Inference Service",
    description="AI-powered schema inference and similarity scoring via Claude",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(inference.router, prefix="/infer", tags=["inference"])


@app.get("/health")
async def health():
    return {"status": "ok", "service": "inference-service"}
