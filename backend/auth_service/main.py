import logging, json, os, sys
from fastapi import FastAPI, Depends, Request
from fastapi import Request as _Request
from fastapi.responses import Response as _Response
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded

from database import init_db, SessionLocal
from routers import auth, users, oidc_routes

_handler = logging.StreamHandler(sys.stdout)
_handler.setFormatter(type("J", (logging.Formatter,), {
    "format": lambda self, r: json.dumps({
        "ts": __import__("datetime").datetime.utcnow().isoformat()+"Z",
        "level": r.levelname.lower(), "service": "auth-service", "msg": r.getMessage()
    }, default=str)
})())
logging.basicConfig(handlers=[_handler], level=logging.INFO, force=True)

app = FastAPI(title="Nexus Auth Service", version="1.0.0")

limiter = Limiter(key_func=get_remote_address)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://localhost:5173",
        "http://127.0.0.1:3000",
        "http://127.0.0.1:5173",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router, prefix="/auth", tags=["auth"])
app.include_router(users.router, prefix="/auth/users", tags=["users"])
app.include_router(oidc_routes.router, prefix="/auth/oidc", tags=["oidc"])

from fastapi import Request as _RequestSize
from fastapi.responses import JSONResponse as _JSONResponse

MAX_BODY_SIZE = int(os.environ.get("MAX_BODY_SIZE_MB", "1")) * 1024 * 1024

@app.middleware("http")
async def limit_body_size(request: _RequestSize, call_next):
    if request.method in ("POST", "PUT", "PATCH"):
        content_length = request.headers.get("content-length")
        if content_length and int(content_length) > MAX_BODY_SIZE:
            return _JSONResponse(
                status_code=413,
                content={"detail": f"Request body too large (max {MAX_BODY_SIZE // 1024 // 1024}MB)"},
            )
    return await call_next(request)


@app.middleware("http")
async def security_headers(request: _Request, call_next):
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["X-XSS-Protection"] = "1; mode=block"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    return response


async def _seed_defaults():
    """Seed domain mappings and default admin users for all known tenants."""
    import secrets as _secrets
    from password_utils import hash_password
    async with SessionLocal() as db:
        # ── Tenant domain mappings ────────────────────────────────────────────
        await db.execute(text(
            "INSERT INTO auth_tenant_domains (domain, tenant_id) "
            "VALUES ('maic.ai', 'tenant-001') ON CONFLICT (domain) DO NOTHING"
        ))
        await db.execute(text(
            "INSERT INTO auth_tenant_domains (domain, tenant_id) "
            "VALUES ('mjsp.sv', 'tenant-mjsp') ON CONFLICT (domain) DO NOTHING"
        ))

        # ── admin@maic.ai ─────────────────────────────────────────────────────
        _default_pw = os.environ.get("ADMIN_SEED_PASSWORD") or _secrets.token_urlsafe(32)
        pw_hash = hash_password(_default_pw)
        if not os.environ.get("ADMIN_SEED_PASSWORD"):
            import logging as _logging
            _logging.getLogger("auth.seed").warning(
                "ADMIN_SEED_PASSWORD not set — admin@maic.ai seeded with a random password. "
                "Set ADMIN_SEED_PASSWORD env var or create an admin user manually."
            )
        await db.execute(text(
            "INSERT INTO auth_users (tenant_id, email, name, role, password_hash) "
            "VALUES ('tenant-001', 'admin@maic.ai', 'Admin', 'admin', :pw) "
            "ON CONFLICT (tenant_id, email) DO NOTHING"
        ), {"pw": pw_hash})

        # ── admin@mjsp.sv ─────────────────────────────────────────────────────
        _mjsp_pw = os.environ.get("MJSP_ADMIN_PASSWORD") or _secrets.token_urlsafe(32)
        mjsp_hash = hash_password(_mjsp_pw)
        if not os.environ.get("MJSP_ADMIN_PASSWORD"):
            import logging as _logging
            _logging.getLogger("auth.seed").warning(
                "MJSP_ADMIN_PASSWORD not set — admin@mjsp.sv seeded with a random password. "
                "Set MJSP_ADMIN_PASSWORD env var."
            )
        await db.execute(text(
            "INSERT INTO auth_users (tenant_id, email, name, role, password_hash) "
            "VALUES ('tenant-mjsp', 'admin@mjsp.sv', 'Admin MJSP', 'admin', :pw) "
            "ON CONFLICT (tenant_id, email) DO NOTHING"
        ), {"pw": mjsp_hash})

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
