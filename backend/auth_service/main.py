from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from database import init_db
from routers import auth, users, oidc_routes

app = FastAPI(title="Nexus Auth Service", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router, prefix="/auth", tags=["auth"])
app.include_router(users.router, prefix="/auth/users", tags=["users"])
app.include_router(oidc_routes.router, prefix="/auth/oidc", tags=["oidc"])


@app.on_event("startup")
async def startup():
    await init_db()


@app.get("/health")
async def health():
    return {"status": "ok", "service": "auth-service"}


@app.get("/.well-known/jwks.json")
async def jwks_well_known():
    from jwt_utils import JWKS
    return JWKS
