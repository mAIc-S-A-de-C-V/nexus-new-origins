from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text

from database import init_db, SessionLocal
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


async def _seed_defaults():
    """Seed maic.ai → tenant-001 domain mapping and default admin user."""
    from password_utils import hash_password
    async with SessionLocal() as db:
        await db.execute(text(
            "INSERT INTO auth_tenant_domains (domain, tenant_id) "
            "VALUES ('maic.ai', 'tenant-001') ON CONFLICT (domain) DO NOTHING"
        ))
        pw_hash = hash_password("admin")
        await db.execute(text(
            "INSERT INTO auth_users (tenant_id, email, name, role, password_hash) "
            "VALUES ('tenant-001', 'admin@maic.ai', 'Admin', 'admin', :pw) "
            "ON CONFLICT (tenant_id, email) DO NOTHING"
        ), {"pw": pw_hash})
        await db.commit()


@app.on_event("startup")
async def startup():
    await init_db()
    await _seed_defaults()


@app.get("/health")
async def health():
    return {"status": "ok", "service": "auth-service"}


@app.get("/.well-known/jwks.json")
async def jwks_well_known():
    from jwt_utils import JWKS
    return JWKS
