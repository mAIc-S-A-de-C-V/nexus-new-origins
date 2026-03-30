from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from routers import projects
from database import init_db

app = FastAPI(
    title="MAIC Project Management Service",
    description="Manages companies, team members, projects, and stages for MAIC.",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(projects.router, prefix="/projects", tags=["projects"])


@app.on_event("startup")
async def startup():
    await init_db()


@app.get("/health")
async def health():
    return {"status": "ok", "service": "project-management-service"}
