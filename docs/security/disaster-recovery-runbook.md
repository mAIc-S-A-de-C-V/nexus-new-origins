# Nexus Disaster Recovery Runbook

**Document ID:** NSP-009
**ISO 27001 Reference:** Annex A.8.14 — Redundancy of Information Processing Facilities
**Version:** 1.0
**Effective Date:** 2026-04-06
**Last Reviewed:** 2026-04-06
**Document Owner:** Development Lead / CISO
**Classification:** Internal

> This is an operational runbook, not a policy document. It contains the specific commands and steps required to restore the Nexus platform from backup. It should be used in conjunction with the Business Continuity Plan (NSP-007). Keep this runbook updated — a stale runbook is worse than no runbook.

---

## Prerequisites

Before starting recovery, confirm you have:

- [ ] SSH access to the new host (EC2 instance or bare metal)
- [ ] Backup file accessible: from `/var/backups/nexus/` on the failed host (if accessible), from S3 (`aws s3 ls s3://<BACKUP_BUCKET>/`), or from another off-site location
- [ ] Both backup files available:
  - `nexus_YYYYMMDD_HHMMSS.pgdump` (main database)
  - `nexus_events_YYYYMMDD_HHMMSS.pgdump` (TimescaleDB)
- [ ] Repository access (git clone over HTTPS or SSH)
- [ ] All production secrets available from your secrets manager:
  - `ANTHROPIC_API_KEY`
  - `POSTGRES_PASSWORD` (currently `nexus_pass` in dev; use production value)
  - `JWT_SECRET_KEY`
  - OIDC client secrets (if configured)
  - SMTP credentials
  - Any other values from production `.env`

> **Security note:** Never store production secrets in this runbook, in the repository, or in any document. Retrieve them from the designated secrets store at recovery time.

---

## Step 1: Provision the Host

Provision a new Ubuntu 22.04 LTS host. Recommended minimum spec for production:

- 4 vCPU, 8 GB RAM, 100 GB SSD (adjust based on actual database size)
- AWS: `t3.xlarge` or larger in the same region as the S3 backup bucket

### 1.1 Connect and update the OS

```bash
ssh -i /path/to/your-key.pem ubuntu@<NEW_HOST_IP>

sudo apt-get update && sudo apt-get upgrade -y
sudo apt-get install -y git curl wget unzip awscli postgresql-client-16
```

### 1.2 Install Docker and Docker Compose

```bash
# Docker
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh
sudo usermod -aG docker ubuntu

# Docker Compose plugin
sudo apt-get install -y docker-compose-plugin

# Verify
docker --version
docker compose version
```

> Log out and back in after adding ubuntu to the docker group, or use `newgrp docker` to apply the group change in the current session.

### 1.3 (Optional) Retrieve backup from S3

If backups are stored in S3:

```bash
# List available backups
aws s3 ls s3://<BACKUP_BUCKET>/ --recursive | sort | tail -10

# Download the most recent backups
mkdir -p /var/backups/nexus
aws s3 cp s3://<BACKUP_BUCKET>/nexus_YYYYMMDD_HHMMSS.pgdump /var/backups/nexus/
aws s3 cp s3://<BACKUP_BUCKET>/nexus_events_YYYYMMDD_HHMMSS.pgdump /var/backups/nexus/
```

---

## Step 2: Clone the Repository and Configure Secrets

### 2.1 Clone the repository

```bash
git clone https://github.com/<your-org>/nexus-new-origins.git /opt/nexus
cd /opt/nexus
```

### 2.2 Configure environment variables

```bash
cp .env.example .env
nano .env   # or vim .env
```

Populate all required values in `.env`. At minimum:

```
POSTGRES_USER=nexus
POSTGRES_PASSWORD=<PRODUCTION_POSTGRES_PASSWORD>
POSTGRES_DB=nexus

ANTHROPIC_API_KEY=<PRODUCTION_ANTHROPIC_API_KEY>
JWT_SECRET_KEY=<PRODUCTION_JWT_SECRET_KEY>

# SMTP
SMTP_HOST=<smtp_host>
SMTP_PORT=587
SMTP_USER=<smtp_user>
SMTP_PASSWORD=<smtp_password>

# Service URLs (use localhost or 127.0.0.1 if running on a single host)
VITE_AUTH_SERVICE_URL=http://<NEW_HOST_IP>:8011
# ... (other VITE_ env vars for frontend)
```

Secure the `.env` file immediately:

```bash
chmod 600 /opt/nexus/.env
```

---

## Step 3: Start Infrastructure Services First

Start only the data infrastructure containers before restoring data. Do not start application services yet.

```bash
cd /opt/nexus

docker compose up -d postgres timescaledb redis
```

Wait for all three to pass health checks:

```bash
docker compose ps
```

Expected output shows `postgres`, `timescaledb`, and `redis` with status `healthy`. This typically takes 10-30 seconds. If they are still starting, wait and run `docker compose ps` again.

If a service fails to become healthy:

```bash
# Check logs for the failing service
docker compose logs postgres
docker compose logs timescaledb
docker compose logs redis
```

Common issues:
- Port conflict: another process is using 5432, 5434, or 6379 — kill it or change the host port in `docker-compose.yml`
- Permission issue on volume mount: `sudo chown -R 999:999 /var/lib/docker/volumes/`

---

## Step 4: Restore Databases

### 4.1 Restore the main PostgreSQL database

```bash
cd /opt/nexus

./scripts/restore.sh /var/backups/nexus/nexus_YYYYMMDD_HHMMSS.pgdump nexus 5432
```

Expected output:
```
[2026-04-06T04:12:00Z] Restoring nexus from /var/backups/nexus/nexus_20260405_020001.pgdump...
[2026-04-06T04:13:45Z] Restore complete.
```

If the restore produces errors like `relation "X" already exists`, this is usually benign — the `--clean --if-exists` flags handle existing objects. Review for any `ERROR:` lines that are not preceded by `pg_restore:` (which are warnings, not fatal errors).

### 4.2 Restore the TimescaleDB event database

```bash
./scripts/restore.sh /var/backups/nexus/nexus_events_YYYYMMDD_HHMMSS.pgdump nexus_events 5434
```

Expected output:
```
[2026-04-06T04:13:50Z] Restoring nexus_events from /var/backups/nexus/nexus_events_20260405_020003.pgdump...
[2026-04-06T04:15:10Z] Restore complete.
```

### 4.3 Verify database contents

```bash
# Connect to main postgres and check row counts
docker compose exec postgres psql -U nexus -d nexus -c "\dt"
docker compose exec postgres psql -U nexus -d nexus -c "SELECT COUNT(*) FROM users;"
docker compose exec postgres psql -U nexus -d nexus -c "SELECT COUNT(*) FROM connectors;"

# Connect to timescale and verify
docker compose exec timescaledb psql -U nexus -d nexus_events -c "\dt"
docker compose exec timescaledb psql -U nexus -d nexus_events -c "SELECT COUNT(*) FROM events;"
```

If critical tables are missing or row counts are zero when they should not be, **stop here and investigate** before starting application services. A corrupt restore is worse than no restore.

---

## Step 5: Start All Application Services

Once databases are verified, start the full stack:

```bash
cd /opt/nexus
docker compose up -d
```

This starts all services defined in `docker-compose.yml`: the frontend, all backend microservices, and nexus-apps services.

Monitor startup:

```bash
# Watch all services come up
docker compose ps

# Follow logs across all services during startup
docker compose logs -f --tail=50
```

Allow 60-90 seconds for all services to start. Services that depend on the database (`depends_on: postgres: condition: service_healthy`) will start only after the database is healthy, so some services may start slightly after others.

If a service fails to start:

```bash
docker compose logs <service-name>
```

Common startup failures:
- `DATABASE_URL` misconfigured: check the `.env` file
- Service cannot reach the database: verify the Docker network (`docker network ls`, `docker network inspect nexus_nexus-net`)
- Missing environment variable: check the service's `environment:` block in `docker-compose.yml` against what is in `.env`

---

## Step 6: Verify Service Health

Check that all core services are responding:

```bash
# Auth service (most critical — everything depends on it)
curl -s http://localhost:8011/health
# Expected: {"status": "ok"} or similar

# Connector service
curl -s http://localhost:8001/health

# Pipeline service
curl -s http://localhost:8002/health

# Inference service
curl -s http://localhost:8003/health

# Ontology service
curl -s http://localhost:8004/health

# Event log service
curl -s http://localhost:8005/health

# Audit service
curl -s http://localhost:8006/health

# Alert engine
curl -s http://localhost:8010/health

# Frontend (check for HTTP 200)
curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/
# Expected: 200
```

If a service returns an error:

```bash
docker compose logs <service-name> --tail=100
```

### Full service status check

```bash
docker compose ps
```

All services should show `Up` or `running`. Any service showing `Exit` or `Restarting` needs investigation.

---

## Step 7: Smoke Test

Perform a manual smoke test to confirm the platform is functionally operational:

1. **Login:** Open `http://<NEW_HOST_IP>:3000` in a browser. Log in with a known user account.
2. **Connectors:** Navigate to the Connectors section. Verify that existing connector configurations are visible (data restored from backup).
3. **Ontology:** Navigate to the Ontology section. Verify that ontology nodes and relationships are present.
4. **Pipeline:** Navigate to Pipelines. Verify that pipeline definitions are present. Optionally run a simple pipeline to confirm end-to-end function.
5. **Audit log:** Navigate to the Audit section. Verify that historical audit records are present.
6. **Alert engine:** Verify that configured alert rules are visible.

If login fails:
- Check auth-service logs: `docker compose logs auth-service`
- Verify that the `users` table was restored: `docker compose exec postgres psql -U nexus -d nexus -c "SELECT email, role FROM users LIMIT 5;"`
- Verify that the JWT_SECRET_KEY in `.env` is the same as what was used when the backup was taken (if the key changed, existing refresh tokens will be invalid, but new logins should still work)

---

## Post-Recovery Actions

### Update DNS

If the IP address of the production host has changed (new EC2 instance), update the DNS A record to point to the new IP. DNS propagation typically takes 5-60 minutes depending on TTL settings.

```bash
# Verify new IP is resolving
nslookup nexus.yourdomain.com
dig nexus.yourdomain.com
```

Update DNS via your DNS provider's console or API. Do not proceed with customer communication until DNS is resolving correctly.

### Notify Stakeholders

Send status communications:
1. **Internal team:** Notify the engineering team and CISO that recovery is complete, the time of recovery, and any data loss window.
2. **Customers:** Send a customer communication per NSP-007 Section 10.2. Include: the duration of the outage, whether customer data was affected, and the data loss window (if any).

### Write the Incident Report

Within **24 hours** of service restoration, the on-call engineer writes an incident report documenting:

- Date and time of incident detection and declaration
- Date and time of service restoration
- Total downtime duration
- Root cause (hardware failure, software fault, human error, etc.)
- Recovery steps taken (summary, not full detail)
- Data loss window (difference between time of last backup and time of failure)
- Any deviations from this runbook and why
- Open action items (e.g., implement streaming replication to reduce RPO)

File the incident report in the ISMS incident log and share with the CISO.

### Schedule Post-Mortem

Schedule a post-mortem meeting within **5 business days** of the incident with: CISO, Development Lead, on-call engineer(s), and any other staff involved in the response. The post-mortem must produce actionable improvements to prevent recurrence and update this runbook with any corrections identified during recovery.

---

## Runbook Verification Checklist

This checklist is completed after each quarterly disaster recovery drill (per NSP-007 Section 9):

| Step | Pass | Fail | Notes |
|------|------|------|-------|
| Host provisioned with Docker and Docker Compose | | | |
| Repository cloned successfully | | | |
| `.env` configured with production-equivalent secrets | | | |
| `docker compose up -d postgres timescaledb redis` — all healthy | | | |
| `scripts/restore.sh` — nexus database restored without fatal errors | | | |
| `scripts/restore.sh` — nexus_events database restored without fatal errors | | | |
| Database row counts match expected values | | | |
| `docker compose up -d` — all services started | | | |
| Auth service `/health` returns OK | | | |
| All other service health checks pass | | | |
| Login via browser works | | | |
| Connector data visible in UI | | | |
| Ontology data visible in UI | | | |
| Total elapsed time | | | Target: < 4 hours |

---

*This document is classified: Internal. Do not distribute outside Nexus without CISO approval.*
