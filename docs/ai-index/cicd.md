# CI/CD

GitHub Actions builds + deploys. Single workflow file.

Path: `/Users/ishmontalvo/Desktop/nexus-new-origins/.github/workflows/build-and-deploy.yml`

## Triggers

- `push` to `main`.
- Manual `workflow_dispatch`.

## Jobs (sequential where dependencies dictate, parallel otherwise)

### 1. `security-scan` (ubuntu-latest)

- `pip-audit` — Python dependency CVE check.
- Trivy filesystem scan (HIGH / CRITICAL only).
- Ignores: `PYSEC-2022-43012`, `CVE-2026-30922` (see `.trivyignore`).

### 2. `python-syntax-check` (needs: security-scan)

- `python -m py_compile` on `backend/**/*.py` + `nexus-apps/**/*.py`.
- Catches syntax errors before the (slow) Docker build.

### 3. `build-backend` (needs: 1+2; max-parallel: 8)

- Matrix of **27 services**.
- Each: `docker/build-push-action` → `ghcr.io/<org>/nexus-<service>`.
- Tags: `sha-<commit>` + `latest` (on main).
- GHA build cache.

### 4. `build-frontend` (needs: 1+2)

- Vite build with `VITE_*_URL` env vars from repo secrets.
- **Critical secret:** `APP_DOMAIN` (e.g. `app.maic.ai`).
- Pushes to `ghcr.io`.

### 5. `deploy` (needs: 3+4)

- SSH into EC2 host.
- Free disk space (`docker image prune`).
- `docker pull` all images.
- `docker-compose up -d`.

## Required secrets

| Secret | Purpose |
|--------|---------|
| `APP_DOMAIN` | Public hostname for Caddy + frontend |
| `ANTHROPIC_API_KEY` | Default Claude key |
| `ADMIN_SEED_PASSWORD` | Initial superadmin password |
| `JWT_PRIVATE_KEY_PEM` | RSA key for prod JWT signing |
| `BACKUP_ENCRYPTION_KEY` | AES-256 key for backup.sh |
| `EC2_HOST`, `EC2_SSH_KEY`, etc. | Deploy target |

## Image registry

`ghcr.io` (GitHub Container Registry). Each service builds independently — adding a new service requires a matrix entry.

## When to edit

| Intent | Where |
|--------|-------|
| Add a new service to deploy | `build-backend` matrix block (`service`, `context`, `dockerfile`). |
| Change image tag scheme | `tags:` lines in matrix. |
| Add pre-deploy health check | new step in `deploy` job after `docker-compose up -d`. |
| Add staging environment | duplicate `deploy` job, gate by branch / environment. |
| Tighten security scan | `.trivyignore` + tighten severity in security-scan step. |
| Add frontend env var | `args:` in `build-frontend` and `VITE_*_URL` in `docker-compose.yml`. |

## Local equivalents

- Build all locally: `docker-compose build`.
- Build one: `docker-compose build <service>`.
- Smoke check: `docker-compose up -d && docker-compose ps`.
- Re-deploy single service after code change: `docker-compose up -d --build <service>`.
