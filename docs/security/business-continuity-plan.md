# Nexus Business Continuity Plan

**Document ID:** NSP-007
**ISO 27001 Reference:** Annex A.8.14 — Redundancy of Information Processing Facilities
**Version:** 1.0
**Effective Date:** 2026-04-06
**Last Reviewed:** 2026-04-06
**Next Review Due:** 2027-04-06
**Document Owner:** Chief Information Security Officer (CISO)
**Approved By:** Chief Executive Officer

---

## 1. Purpose

This plan defines Nexus's approach to maintaining critical business operations and restoring platform services following a disruptive event. Nexus is a B2B SaaS platform; its customers depend on continuous access to the data operations pipeline, connector integrations, and AI inference capabilities. This plan ensures that in the event of infrastructure failure, data loss, or other disruptive event, the platform can be restored within defined recovery objectives and that customer impact is minimized and communicated transparently.

---

## 2. Scope

This plan covers:

- Restoration of all Nexus platform services following a failure of the production environment
- Preservation and recovery of customer data stored in PostgreSQL (`nexus` database) and TimescaleDB (`nexus_events` database)
- Recovery of Redis state (treated as ephemeral — re-populated on service restart)
- Communication to internal staff and customers during and after a disruptive event

---

## 3. Recovery Objectives

### 3.1 Recovery Point Objective (RPO): 24 Hours

The maximum acceptable data loss in the event of a catastrophic failure is **24 hours**. This reflects the daily automated backup schedule. In practice, the average data loss will be less than 24 hours depending on the time of day the failure occurs relative to the most recent backup.

Implication: Customers must understand (via the MSA and SLA) that in a disaster recovery scenario, up to 24 hours of data may not be recoverable. Events written to TimescaleDB and ontology records created in the 24 hours before the last backup may be lost.

Future improvement target: Implement PostgreSQL WAL archiving or streaming replication to a hot standby to reduce RPO to under 1 hour.

### 3.2 Recovery Time Objective (RTO): 4 Hours

The maximum acceptable time from the decision to invoke disaster recovery to the platform being operational with customer data restored is **4 hours**. This assumes:

- A new host can be provisioned within 30-60 minutes (EC2 launch or pre-configured bare metal)
- Docker and Docker Compose are installed within 15 minutes
- The repository is cloned and secrets configured within 15 minutes
- Infrastructure services (PostgreSQL, TimescaleDB, Redis) start and pass health checks within 5 minutes
- Database restore from backup completes within 30-60 minutes depending on database size
- All application services start within 5 minutes
- Verification and smoke testing require 15-30 minutes
- DNS propagation may add up to 60 minutes

The 4-hour RTO is aggressive and requires that the team has practiced the recovery procedure (see Section 9, Quarterly Drill). If the on-call engineer has never performed a restore, the actual recovery time may be longer.

---

## 4. Backup Schedule and Configuration

Backups are executed by `scripts/backup.sh`, which is scheduled as a cron job on the production host.

**Backup schedule:** Daily at **02:00 UTC**

Cron entry (on production host):
```
0 2 * * * /opt/nexus/scripts/backup.sh >> /var/log/nexus-backup.log 2>&1
```

**What is backed up:**
- PostgreSQL `nexus` database (all tables: users, connectors, ontology nodes/relationships, pipeline definitions, audit events, etc.) — backed up as a custom-format pg_dump file: `nexus_YYYYMMDD_HHMMSS.pgdump`
- TimescaleDB `nexus_events` database (time-series event records) — backed up as: `nexus_events_YYYYMMDD_HHMMSS.pgdump`

**What is not backed up separately:**
- Redis data (session cache, rate limiter state): Redis data is ephemeral and re-built at service startup. No backup is needed.
- The Nexus codebase: the git repository is the authoritative source. The code is not backed up separately from the repository.
- Environment secrets (`.env`): Secrets are managed separately. They must be stored securely outside the backup system and be available at recovery time.

**Backup retention:** **30 days.** Backup files older than 30 days are automatically deleted by `scripts/backup.sh` via the `find ... -mtime +30 -delete` command.

---

## 5. Backup Storage

### 5.1 Current Configuration

Backups are written to `/var/backups/nexus/` on the production host.

**Limitation:** Storing backups only on the same host as the database means a host failure could destroy both the database and the backups simultaneously. This is a known single point of failure.

### 5.2 Required Production Configuration

For production use, backup files must be copied to off-site storage immediately after creation. The recommended configuration is:

- **Primary off-site backup:** AWS S3 bucket configured with:
  - Server-side encryption (SSE-KMS with a customer-managed key)
  - Object Lock in Compliance mode (WORM protection, 30-day retention) to prevent accidental or malicious deletion
  - Versioning enabled
  - Bucket policy restricting access to the backup IAM role only (no public access, no cross-account access)
- **S3 sync after backup:** Add to `scripts/backup.sh` (or a wrapper script):
  ```bash
  aws s3 cp "${BACKUP_DIR}/nexus_${TIMESTAMP}.pgdump" \
    s3://${BACKUP_BUCKET}/nexus_${TIMESTAMP}.pgdump
  aws s3 cp "${BACKUP_DIR}/nexus_events_${TIMESTAMP}.pgdump" \
    s3://${BACKUP_BUCKET}/nexus_events_${TIMESTAMP}.pgdump
  ```
- The backup S3 bucket is in a different AWS region from the primary deployment (for regional failure resilience).

Until off-site backup is implemented, the CISO must document this as a known risk in the ISMS risk register.

---

## 6. Backup Integrity Verification

Backups are only useful if they are restorable. Backup integrity is verified as part of the quarterly disaster recovery drill (Section 9). Each drill must:

- Attempt a full restore of the most recent `nexus.pgdump` and `nexus_events.pgdump` to a test environment
- Confirm that all critical tables are present and readable
- Confirm that the platform starts successfully against the restored data
- Document the outcome, including any restore errors or data gaps

If a backup file fails to restore during a drill, the root cause is investigated and fixed immediately. The CISO is notified of any backup integrity failure.

---

## 7. Critical Dependencies

The following services and resources are required for the Nexus platform to function. Their availability is critical to achieving the RTO.

| Dependency | Type | Recovery approach |
|------------|------|------------------|
| PostgreSQL 16 | Database (primary) | Restore from pg_dump backup |
| TimescaleDB 2.x (PG 16) | Database (time-series) | Restore from pg_dump backup |
| Redis 7 | Cache / session store | Re-initialized at startup; no restore needed |
| Anthropic API key | External API credential | Must be available at recovery time; stored in secrets manager |
| Docker + Docker Compose | Runtime | Installed on new host during provisioning |
| Git repository access | Source code | Must be accessible for `git clone` |
| Production `.env` secrets | Configuration | Must be stored securely outside the repository and available at recovery time |
| Domain / DNS | Routing | Update DNS A record to new host IP |

---

## 8. Known Single Points of Failure

The following components represent single points of failure in the current architecture. These are documented so they can be prioritized for redundancy investment.

### 8.1 Auth Service

All authentication for the Nexus platform passes through the auth-service (port 8011). If the auth-service fails, no user can log in and no JWT-authenticated API call succeeds. Customers are fully locked out.

**Current mitigation:** Docker restart policy (`restart: unless-stopped`). In disaster recovery, auth-service is among the first services started.

**Future improvement:** Run multiple auth-service replicas behind a load balancer.

### 8.2 PostgreSQL

The main PostgreSQL instance hosts all Nexus operational data. A failure without a recent backup results in data loss up to the RPO.

**Current mitigation:** Daily backups with 30-day retention; off-site S3 storage (required). Docker volume persistence on the host.

**Future improvement:** PostgreSQL streaming replication to a standby instance; reduce RPO to minutes.

### 8.3 Single Host Deployment

The current production deployment runs all services on a single host via Docker Compose. A hardware failure of that host brings down all services simultaneously.

**Current mitigation:** Recovery procedure and RTO of 4 hours. Automated backup allows data recovery.

**Future improvement:** Migrate to a managed container orchestration platform (ECS, Kubernetes) or at minimum maintain a warm standby host with volume replication.

---

## 9. Quarterly Disaster Recovery Drill

A disaster recovery drill must be performed every quarter. The drill tests the full recovery procedure from backup restore to service verification.

**Drill procedure:**

1. CISO schedules the drill and notifies the Development Lead and on-call engineer at least 1 week in advance
2. A test host is provisioned (can be a local Docker environment or a non-production EC2 instance)
3. The on-call engineer (not the Development Lead — this tests the runbook, not institutional knowledge) follows the Disaster Recovery Runbook (NSP-009) from start to finish
4. The drill is timed. Start time and end time are recorded.
5. Any steps in the runbook that are unclear, missing, or fail are noted
6. After the drill, the runbook is updated to reflect any corrections
7. The CISO documents the drill outcome in the ISMS incident log: date, duration, outcome (pass/fail), data restored, any anomalies

**Pass criteria for a drill:**
- All services return healthy responses from their `/health` endpoints
- A test user can log in
- At least one connector configuration is visible
- The drill completes within the 4-hour RTO

---

## 10. Communication During a Continuity Event

### 10.1 Internal Communication

When a disruption event begins:
- The on-call engineer immediately notifies the CISO
- The CISO activates the incident response process (NSP-003) in parallel with continuity recovery
- The engineering team is notified via the internal communications channel
- Status updates are provided to internal stakeholders every 30 minutes during an active recovery

### 10.2 Customer Communication

Nexus's status page (if maintained) must be updated within **30 minutes** of declaring a continuity event. If no status page exists, affected customers are notified directly via email.

Customer notifications include:
- Nature of the disruption (infrastructure failure, data issue, etc.) — without disclosing security-sensitive details
- Estimated time to resolution (based on RTO)
- Whether customer data is affected
- A contact for questions (support@nexus.internal)

Upon recovery, a follow-up communication is sent confirming restoration, the duration of the outage, and any data loss that occurred (per the RPO). If customer data was permanently lost, this is disclosed explicitly and directly.

---

## 11. Plan Maintenance

This plan is reviewed annually by the CISO and updated to reflect:

- Changes to the Nexus architecture (new services, new databases, new infrastructure)
- Changes to backup tooling or schedules
- Lessons learned from quarterly drills
- Changes to the supplier landscape (new cloud providers, etc.)

---

*This document is classified: Internal. Do not distribute outside Nexus without CISO approval.*
