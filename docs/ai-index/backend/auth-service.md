# auth-service (port 8011)

**Purpose:** Identity. JWT issuance (RS256), OIDC SSO (Google/Okta/Azure AD), MFA (TOTP), tenant management, account lockout, refresh-token rotation, impersonation.
**Stack:** Python FastAPI, SQLAlchemy async, asyncpg, jose, cryptography, passlib (bcrypt), pyotp, slowapi.
**Path:** `/Users/ishmontalvo/Desktop/nexus-new-origins/backend/auth_service/`

## Files

```
auth_service/
├── main.py             FastAPI app, _seed_defaults() (demo tenants + admins), CORS, slowapi rate limiting, body-size limit, security headers
├── jwt_utils.py        RS256 key loading; access (15m) + refresh (7d) tokens; pre-built JWKS object
├── oidc.py             PROVIDERS dict (google/okta/azure) + get_authorization_url + exchange_code (PKCE S256)
├── password_utils.py   bcrypt hash/verify (passlib)
├── mfa_utils.py        TOTP secret + URI + verify (pyotp, ±1 window)
├── database.py         DDL + auto-tenant from email domain (auth_users, auth_refresh_tokens, auth_tenant_domains)
├── routers/
│   ├── auth.py         POST /login, POST /refresh, GET /jwks
│   ├── users.py        Admin user CRUD with password policy + tenant placement
│   └── oidc_routes.py  GET /oidc/{provider}, GET /oidc/{provider}/callback
├── requirements.txt
└── Dockerfile
```

## Tables

```
auth_users:           id PK, tenant_id, email (UNIQUE per tenant), name, role (superadmin|admin|analyst|viewer),
                      password_hash, oidc_provider, oidc_subject, is_active, mfa_secret, mfa_enabled,
                      failed_attempts, locked_until, password_changed_at, allowed_modules JSON, created_at, updated_at

auth_refresh_tokens:  id PK, user_id FK CASCADE, token_hash UNIQUE (sha256), expires_at, created_at

auth_tenant_domains:  domain PK, tenant_id, created_at  -- e.g. maic.ai → tenant-001
```

## JWT

- Key sources: `JWT_PRIVATE_KEY_PEM` env (PEM string) → `JWT_PRIVATE_KEY_FILE` env (path) → ephemeral 2048-bit (dev only; tokens invalidated on restart).
- Access TTL 15 min (`ACCESS_TOKEN_EXPIRE_MINUTES`).
- Refresh TTL 7 days; raw token stored in httponly cookie `nexus_refresh`, hash in DB.
- Claims: `sub`, `email`, `name`, `role`, `tenant_id`, `modules`, `impersonated_by` (when admin impersonates), `iss`, `iat`, `exp`.
- JWKS pre-built at module load — `n` and `e` Base64url RSA public numbers + `kid`/`alg`/`use`.

## SSO providers (`oidc.py`)

| Provider | Client ID env | Client Secret env | Auth endpoint |
|----------|---------------|-------------------|---------------|
| Google | `GOOGLE_CLIENT_ID` | `GOOGLE_CLIENT_SECRET` | accounts.google.com |
| Okta | `OKTA_CLIENT_ID` | `OKTA_CLIENT_SECRET` (+ `OKTA_BASE_URL`) | tenant-specific |
| Azure AD | `AZURE_CLIENT_ID` | `AZURE_CLIENT_SECRET` (+ `AZURE_TENANT_ID`, default `common`) | login.microsoftonline.com |

OAuth2 authorization-code flow with PKCE (S256 method). State + code_verifier stored in Redis under `oidc:state:{state}` (10-min TTL).

## Endpoints

### `/auth` (`routers/auth.py`)

| Method | Path | Rate limit | Purpose |
|--------|------|------------|---------|
| POST | `/auth/login` | 10/min | Email + password (+ `totp_code` if MFA enabled). Auto-derives tenant from email domain. Lockout after 5 failures for 15 min. Audit fire-and-forget. |
| POST | `/auth/refresh` | 20/min | Refresh access token via cookie or body. Optional rotation. |
| GET | `/auth/jwks` | — | Pre-built JWKS for all services. |

### `/auth/users` (`routers/users.py`, admin+)

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/auth/users` | List (optional `x-tenant-id`). |
| POST | `/auth/users` | Create. Password policy: ≥12 chars, upper/lower/digit/special. Tenant placement via header → email domain → body. |
| GET | `/auth/users/{user_id}` | Get. |
| PATCH | `/auth/users/{user_id}` | Update fields, MFA enable/disable (returns TOTP URI for QR). |

### `/auth/oidc` (`routers/oidc_routes.py`, no auth — pre-login)

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/auth/oidc/{provider}` | Builds auth URL, stores state+verifier in Redis, redirects to provider. |
| GET | `/auth/oidc/{provider}/callback` | Consumes state, exchanges code → user info, upserts user (default role `viewer`), issues tokens, sets cookie, redirects to frontend `/auth/callback?token=...&provider=...` (token in fragment for security). |

## Seeded data (`main.py:_seed_defaults`)

Default tenants: `tenant-001` (maic.ai), `tenant-mjsp` (mjsp.sv) + 8 demo tenants (finance, healthcare, itsm, government, manufacturing, travel, demo, …). Admin user per tenant with `ADMIN_SEED_PASSWORD` (default `NexusSuperAdmin2026!`).

## Cross-service

- `audit-service` POST `/audit/events` (fire-and-forget) — login.success / login.failed / login.mfa_failed.
- All other services GET `{this}/.well-known/jwks.json` to validate tokens.

## Env

`DATABASE_URL`, `JWT_PRIVATE_KEY_PEM` (or file), `JWT_ISSUER`, `APP_BASE_URL`, `ACCESS_TOKEN_EXPIRE_MINUTES`, `COOKIE_SECURE`, `ADMIN_SEED_PASSWORD`, `MJSP_ADMIN_PASSWORD`, `GOOGLE_*`, `OKTA_*`, `AZURE_*`, `AUDIT_SERVICE_URL`, `AUTH_SERVICE_URL`.

## When to edit

| Intent | File |
|--------|------|
| Add/rename a role | `auth_users.role` enum + `routers/users.py:_validate_role` + `shared/auth_middleware.py` (`require_role` consumers). |
| Change JWT TTL or claims | `jwt_utils.py:create_access_token`. |
| Add SSO provider | `oidc.py:PROVIDERS` + `get_authorization_url` + `exchange_code`. |
| Change password policy | `routers/users.py:_validate_password`. |
| Adjust lockout | `routers/auth.py:login` (5 failures, 15 min). |
| Implement impersonation endpoint | `routers/auth.py` — new `/auth/impersonate/{user_id}`, set `impersonated_by` claim. |
| Add password reset flow | new table `password_resets`, new endpoints in `routers/auth.py`, SMTP via env. |
| Add device tracking | extend `auth_refresh_tokens` with `device_fingerprint`. |
| Tweak rate limits | `main.py` slowapi `limiter` decorators. |
