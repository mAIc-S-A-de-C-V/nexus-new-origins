# Nexus Change Management Policy

**Document ID:** NSP-005
**ISO 27001 Reference:** Annex A.8.32 — Change Management
**Version:** 1.0
**Effective Date:** 2026-04-06
**Last Reviewed:** 2026-04-06
**Next Review Due:** 2027-04-06
**Document Owner:** Chief Information Security Officer (CISO)
**Approved By:** Chief Executive Officer

---

## 1. Purpose

This policy governs how changes to the Nexus platform — including application code, infrastructure configuration, database schema, and third-party integrations — are proposed, reviewed, tested, approved, deployed, and documented. The purpose is to prevent unauthorized or untested changes from introducing security vulnerabilities, service degradation, or data integrity issues into the Nexus production environment.

---

## 2. Scope

This policy applies to:

- All changes to source code in the Nexus repository, including all backend microservices (auth-service, connector-service, ontology-service, inference-service, pipeline-service, audit-service, correlation-engine, alert-engine, event-log-service, logic-service, agent-service, utility-service, schema-registry, process-engine), the React frontend, and all nexus-apps (project-management-service, finance-service)
- All infrastructure changes: Docker Compose configuration, Dockerfile modifications, nginx configuration, cloud resource changes (EC2, S3, VPC, security groups)
- All database schema changes: Alembic migrations or raw SQL changes to PostgreSQL (`nexus`) or TimescaleDB (`nexus_events`)
- Changes to CI/CD pipeline configuration (GitHub Actions workflows or equivalent)
- Changes to environment variables and secrets in any environment
- Changes to third-party integration configuration (OAuth app settings, OIDC provider configuration, SMTP settings)

---

## 3. Standard Change Process

### 3.1 Pull Request Requirement

All code changes must be introduced via a pull request (PR) against the main branch. The following rules are enforced via branch protection settings on the repository:

- **No direct commits to main:** The main branch is protected. No engineer — including the Development Lead — may push commits directly to main. Every change, including single-line fixes, must go through a PR.
- **Peer review required:** A minimum of one peer review approval is required before a PR may be merged. The reviewer must be a different person from the PR author.
- **CI must pass:** All automated CI checks (linting, tests, security scans — see Section 6) must pass before a PR may be merged. Overriding a failed CI check to force a merge is a policy violation.
- **PR description:** Every PR must include a description of the change, why it is being made, and what was tested. For security-impacting changes, the PR description must include a brief security impact assessment.

### 3.2 Security-Impacting Changes

Certain changes carry elevated security risk and require CISO review and approval in addition to peer review. A change is security-impacting if it modifies:

- **Authentication logic:** Any change to `backend/auth_service/`, including `main.py`, `jwt_utils.py`, `oidc.py`, `password_utils.py`, `mfa_utils.py`, and any router in `backend/auth_service/routers/`
- **Authorization and access control:** Role-checking logic, middleware that validates permissions, tenant isolation logic
- **Encryption:** Key generation, encryption/decryption routines, changes to how connector credentials or secrets are stored
- **Data access patterns:** New endpoints that expose customer data, changes to what data is returned by existing endpoints, new database queries that touch Confidential data
- **Audit logging:** Changes to the audit-service or any code that writes to or reads from audit log records
- **Infrastructure security:** Changes to Docker network configuration (nexus-net), HTTPS/TLS settings in nginx, security group rules, firewall rules
- **Secrets management:** Changes to how environment variables are loaded, new secrets introduced to the `.env` schema, changes to Docker secrets configuration
- **Third-party integrations:** New external API integrations, changes to how OAuth tokens are stored or refreshed

For security-impacting PRs:

1. The PR author labels the PR as `security-review-required`
2. The CISO is added as a required reviewer
3. The PR may not be merged until the CISO has approved it in addition to the standard peer reviewer
4. The CISO's review must be documented in a PR comment, not just an approval click, briefly describing what was reviewed and any concerns addressed

If the CISO is unavailable for more than 48 hours and the change is urgent, the Development Lead may approve the change with a documented exception, provided the CISO reviews it within 24 hours of merge. This exception must be logged in the ISMS.

---

## 4. Staging Environment

### 4.1 Staging Tests Required

Before any change is deployed to production, it must be tested in the staging environment. Staging is a full replica of the production Docker Compose stack, running against non-production data.

**Minimum testing requirements before production deployment:**

- All automated tests pass (unit tests, integration tests where present)
- The CI/CD security scans pass (see Section 6)
- The developer who made the change has manually verified the affected functionality in staging
- For changes affecting UI: the frontend behavior has been verified in a staging browser session
- For database migrations: the migration has been applied successfully to the staging database, and the previous state is restorable via the rollback procedure (see Section 5)

Deploying directly to production without a staging test is a policy violation, except in emergency change scenarios (Section 7) where the risk of delay outweighs the staging requirement.

### 4.2 Staging Environment Data

The staging environment must not contain real customer data. Staging databases are populated with synthetic or anonymized data. If production data must be used for debugging, it must be anonymized first, and CISO approval is required. Production database dumps must not be restored to staging without first running a PII-scrubbing script.

---

## 5. Database Migration Requirements

Database schema changes are among the highest-risk changes in the Nexus platform. PostgreSQL and TimescaleDB schema changes can cause data loss, downtime, or irreversible corruption if not carefully managed.

**Requirements for all database migrations:**

- **Rollback plan documented:** Every PR that includes a database migration must include a documented rollback procedure in the PR description. The rollback plan must specify the exact steps to reverse the migration if it causes issues in production.
- **Backwards-compatible migrations preferred:** Where possible, migrations should be backwards-compatible (e.g., adding a column with a default, rather than removing or renaming a column), allowing rollback without data loss.
- **Tested on staging first:** The migration must be successfully applied and rolled back at least once in staging before being applied to production.
- **Applied before code deployment:** If a migration is required for new code to function, the migration is applied to production before the new code is deployed, not simultaneously.
- **One migration per PR:** Avoid bundling multiple schema changes in a single PR where possible. Atomic migrations are easier to roll back.
- **Backup before applying:** The automated daily backup (`scripts/backup.sh`) must have run within 24 hours before a major migration is applied to production. For large or risky migrations, a manual backup is taken immediately before applying the migration.

---

## 6. CI/CD Security Scans

The CI/CD pipeline enforces the following security scans on every build. These scans are not optional and their results are not advisory — findings at CRITICAL or HIGH severity block the deployment.

### 6.1 pip-audit

**Tool:** `pip-audit`
**Purpose:** Scans Python dependencies in all backend services against the Python Packaging Advisory Database (PyPA) for known CVEs.
**Scope:** All `requirements.txt` files in backend microservices and the shared library.
**Failure condition:** Any dependency with a CRITICAL or HIGH severity CVE causes the build to fail.
**Action on failure:** The Development Lead is notified. The vulnerability must be remediated per the Vulnerability Management Policy (NSP-008) before the build can proceed.

### 6.2 Trivy

**Tool:** `aquasecurity/trivy`
**Purpose:** Scans Docker container images for OS-level vulnerabilities, misconfigurations, and secrets accidentally embedded in images.
**Scope:** All Docker images built during the CI/CD pipeline (all microservice Dockerfiles, the frontend image).
**Failure condition:** Any image with a CRITICAL or HIGH severity OS vulnerability, or any detected secret (API key, password) in the image layers, causes the build to fail.
**Action on failure:** The Development Lead and CISO are notified. Secrets found in images must be revoked immediately and rotated, even if they were test credentials.

### 6.3 Additional Recommended Scans

The following scans are recommended for inclusion in the CI/CD pipeline as the team's capacity allows:

- **Bandit** (Python static analysis): detects common security anti-patterns in Python code (SQL injection via string formatting, use of `eval`, hardcoded passwords)
- **ESLint security plugin**: static analysis for the React frontend
- **Semgrep**: pattern-based static analysis with security rulesets for FastAPI and Python

---

## 7. Emergency Change Procedure

Emergency changes are changes that must be deployed to production immediately due to an active incident, critical outage, or an actively exploited vulnerability, and for which the standard review and staging process cannot be completed in time.

**Criteria for emergency change:**
- An active Critical or High security incident (per NSP-003) requires an immediate fix to stop ongoing harm
- A production outage is causing significant customer impact and cannot wait for standard process
- A zero-day vulnerability is confirmed to be actively exploited in the Nexus production environment

**Emergency change process:**

1. The Development Lead and CISO agree that the situation qualifies as an emergency change
2. The change is developed and reviewed verbally between at least two engineers
3. The change is deployed to production with the Development Lead's approval
4. A PR is created documenting the change retroactively within **24 hours**
5. The CISO reviews and approves the emergency change PR within **24 hours** of deployment
6. The emergency change is logged in the ISMS with: the incident it addressed, the time of deployment, who approved it, and a note that it was an emergency change
7. The retrospective review (NSP-003 post-incident review) includes assessment of whether the change introduced any secondary risks

Emergency changes must not be used to bypass review for non-emergency purposes. Abuse of the emergency change procedure is treated as a policy violation.

---

## 8. Infrastructure Changes

Changes to Nexus infrastructure — cloud resources, network configuration, server provisioning, DNS, or TLS certificate management — follow the same PR-based process when the change is captured in code (e.g., Docker Compose changes, Terraform/IaC changes if adopted).

For manual infrastructure changes that cannot be captured in code:

- **Written approval required:** The change must be approved in writing (email or ticketing system) by the CISO and Development Lead before execution
- **Documentation required:** The change must be documented in the ISMS infrastructure change log: what changed, why, when, by whom, and what the rollback procedure is
- **Notification:** The engineering team is notified before the change is applied to production

Infrastructure changes that affect security boundaries — firewall rules, VPC peering, security groups, IAM roles, database access controls — additionally require CISO sign-off, consistent with the security-impacting change requirements in Section 3.2.

---

## 9. Change Records

A record of all significant changes is maintained in the git commit history and PR history. For security-impacting changes, the CISO maintains an additional change log in the ISMS with the following fields:

- Date and time of deployment
- Description of the change
- PR or ticket reference
- Reviewer(s) who approved the change
- Security review: who conducted it and what was found
- Whether it was a standard or emergency change
- Post-deployment issues (if any)

This change log is reviewed during the annual ISMS review.

---

## 10. Violations

- Direct commit to main branch without PR: immediate policy violation. The commit must be reverted, and the change re-submitted via PR. The committer receives a formal warning.
- Deployment to production without staging test (outside emergency procedure): policy violation. The deployment is reviewed; if it introduces issues, rollback is required.
- Merging a PR with failing CI/security scans: policy violation. The offending merge is investigated. If a vulnerability was introduced, it is treated as a security incident per NSP-003.
- CISO review bypassed for security-impacting change: policy violation. The change is treated as unauthorized and the CISO reviews it immediately with authority to require reversion.

---

*This document is classified: Internal. Do not distribute outside Nexus without CISO approval.*
