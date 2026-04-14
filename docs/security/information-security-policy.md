# Nexus Information Security Policy

**Document ID:** NSP-001
**ISO 27001 Reference:** Annex A.5.1 — Policies for Information Security
**Version:** 1.0
**Effective Date:** 2026-04-06
**Last Reviewed:** 2026-04-06
**Next Review Due:** 2027-04-06
**Document Owner:** Chief Information Security Officer (CISO)
**Approved By:** Chief Executive Officer

---

## 1. Purpose

This policy establishes the governing framework for information security across the Nexus platform and the organization that operates it. Nexus is a B2B SaaS data operations platform that enables customers to connect external data sources, build ontology graphs, run AI-assisted pipelines, and correlate events across systems. The sensitivity of data processed — including CRM records, operational business data, credentials, and AI-generated insights — requires a disciplined, organization-wide commitment to protecting information assets.

This policy exists to:

- Define management's commitment to protecting information assets
- Establish security objectives grounded in confidentiality, integrity, and availability
- Assign accountability for information security to named roles
- Set minimum standards from which all other Nexus security policies derive authority

---

## 2. Scope

This policy applies to:

- **All Nexus employees**, regardless of location or employment type, including full-time, part-time, and temporary staff
- **Contractors and third-party vendors** who access Nexus systems, codebases, or customer data under any arrangement
- **All Nexus platform components**, including backend microservices (connector-service, auth-service, ontology-service, inference-service, pipeline-service, audit-service, correlation-engine, alert-engine, and all others), the React frontend, Docker infrastructure, PostgreSQL databases, TimescaleDB, Redis, and any cloud resources provisioned in support of platform operations
- **All data processed, stored, or transmitted** by the Nexus platform, including customer-supplied connector credentials, ontology records, pipeline configurations, event logs, and AI inference outputs
- **All environments**: development, staging, and production

---

## 3. Management Commitment

Nexus leadership recognizes that effective information security is essential to maintaining customer trust, meeting regulatory obligations, and sustaining business operations. Management commits to:

- Allocating sufficient resources — personnel, tooling, and budget — to implement and maintain the information security management system (ISMS)
- Appointing a CISO with direct authority to enforce security controls and escalate risks to the executive team
- Ensuring that security requirements are integrated into the software development lifecycle, not applied as an afterthought
- Reviewing and formally approving this policy annually, or upon material changes to the platform or threat landscape
- Treating security incidents as organizational priorities, not engineering inconveniences
- Supporting a culture in which employees report suspected vulnerabilities or incidents without fear of retaliation

---

## 4. Security Objectives

Nexus security objectives are framed around the CIA triad as it applies to the platform's specific architecture and risk profile.

### 4.1 Confidentiality

Customer data processed through Nexus — including CRM contacts fetched via the HubSpot connector, ontology records, connector OAuth tokens, and AI prompts — must not be accessible to unauthorized parties. Specific objectives:

- All connector credentials and OAuth tokens are encrypted at rest using AES-256
- Inter-service communication occurs over isolated Docker networks (nexus-net) with no direct exposure to the public internet except through defined API ports
- The Anthropic Claude API is used for inference; data transmitted to this API is governed by the applicable Data Processing Agreement and is not used for model training per Anthropic's enterprise terms
- Role-based access controls ensure that platform users can only access data appropriate to their assigned role (admin, analyst, or viewer)
- Audit logs capture all data access events and are retained for forensic use

### 4.2 Integrity

Data flowing through the Nexus pipeline — from connector ingestion through ontology processing to correlation and alerting — must remain accurate and untampered. Specific objectives:

- All code changes to platform services require peer-reviewed pull requests before merging to the main branch
- Database migrations require a documented rollback plan
- The CI/CD pipeline enforces automated security scans (pip-audit, Trivy) and must pass before any deployment proceeds
- Event log records written to TimescaleDB are append-only by design; modification of historical records is not permitted
- Cryptographic signing of JWTs ensures authentication tokens cannot be forged or tampered with

### 4.3 Availability

Nexus customers depend on the platform for operational data workflows. Downtime has direct business impact. Specific objectives:

- Production infrastructure is designed for a Recovery Time Objective (RTO) of 4 hours and a Recovery Point Objective (RPO) of 24 hours
- Automated database backups run daily at 02:00 UTC via `scripts/backup.sh`, backing up both the primary PostgreSQL database (`nexus`) and the TimescaleDB event store (`nexus_events`)
- Backup files are retained for 30 days
- Disaster recovery procedures are documented in the Nexus Disaster Recovery Runbook (NSP-009) and tested quarterly
- Redis is used for caching and session management; its failure mode is graceful degradation, not hard failure, wherever possible

---

## 5. Roles and Responsibilities

### 5.1 Chief Information Security Officer (CISO)

The CISO has organization-wide accountability for information security. Responsibilities include:

- Owning and maintaining the ISMS, including all policies in the `docs/security/` directory
- Approving or delegating approval of security-impacting code changes (authentication flows, encryption logic, data access controls)
- Leading incident response for Critical and High severity incidents
- Conducting or commissioning the annual review of all security policies
- Managing relationships with third-party security vendors (e.g., penetration testing firms)
- Reporting security posture to executive leadership quarterly
- Authorizing exceptions to any security policy in writing, with a defined expiry date

### 5.2 Development Lead

The Development Lead is responsible for security within the software development lifecycle. Responsibilities include:

- Enforcing branch protection rules on the main branch (no direct commits, PR required)
- Ensuring the CI/CD pipeline includes and enforces security scans (pip-audit, Trivy)
- Coordinating with the CISO when changes affect authentication (auth-service, JWT handling, OIDC configuration), encryption, or customer data access paths
- Reviewing and merging dependency update PRs (Dependabot or manual) on a weekly cadence
- Ensuring all developers complete security awareness training annually

### 5.3 Data Custodians

Data Custodians are individuals or service owners assigned responsibility for specific data assets within the platform. For Nexus, data custodianship is assigned as follows:

- **Connector credentials and OAuth tokens**: Connector Service owner
- **Customer ontology records**: Ontology Service owner
- **Audit logs and event records**: Audit Service owner and Event Log Service owner
- **User accounts and authentication data**: Auth Service owner

Data Custodians are responsible for ensuring their data assets are classified per the Data Classification Policy (NSP-004), protected according to the handling requirements for that classification level, and disposed of securely when no longer needed.

### 5.4 All Employees and Contractors

Every person with access to Nexus systems or customer data is responsible for:

- Completing information security awareness training within 30 days of onboarding and annually thereafter
- Reporting suspected security incidents or policy violations to the CISO or via the incident reporting channel
- Not sharing access credentials, bypassing authentication controls, or storing sensitive data outside approved systems
- Locking workstations when unattended and protecting physical access to devices containing Nexus data

---

## 6. Supporting Policies

This Information Security Policy is the top-level governing document. The following policies derive authority from it and must be read in conjunction:

| Document ID | Title | ISO Reference |
|-------------|-------|---------------|
| NSP-002 | Access Control Policy | A.8.2, A.8.3 |
| NSP-003 | Incident Response Plan | A.5.28, A.6.8 |
| NSP-004 | Data Classification Policy | A.5.12 |
| NSP-005 | Change Management Policy | A.8.32 |
| NSP-006 | Supplier Security Policy | A.5.19, A.5.20 |
| NSP-007 | Business Continuity Plan | A.8.14 |
| NSP-008 | Vulnerability Management Policy | A.8.8 |
| NSP-009 | Disaster Recovery Runbook | A.8.14 |

---

## 7. Review Cycle

This policy is reviewed annually by the CISO and formally re-approved by the CEO. Reviews are also triggered by:

- A material change to the Nexus platform architecture (e.g., introduction of a new data store, a new external API integration, or a change in cloud provider)
- A Critical or High severity security incident that reveals a gap in this policy
- A change in applicable regulation (e.g., GDPR amendments, new national data protection laws affecting customer base)
- A failed external audit finding that references this policy

All review activities are documented in the ISMS change log maintained by the CISO.

---

## 8. Policy Violations

Violations of this policy or any subordinate policy are treated seriously and may result in disciplinary action up to and including termination of employment or contract, depending on severity and intent.

### 8.1 Reporting Violations

Suspected violations must be reported to the CISO immediately. Reports may be made directly, via email to security@nexus.internal, or through the incident reporting channel. Good-faith reports are never penalized, even if the reported behavior turns out not to be a violation.

### 8.2 Investigation

The CISO, in coordination with HR and Legal as appropriate, will investigate suspected violations. The investigation will be documented. The accused will have an opportunity to respond before any disciplinary action is taken.

### 8.3 Consequences

- **Unintentional violations** resulting from lack of awareness: mandatory retraining, documented warning
- **Negligent violations** (disregarding known policy): formal written warning, potential role restriction, retraining
- **Deliberate violations** (intentional circumvention of controls, unauthorized data access, credential sharing): immediate suspension of access, escalation to HR and Legal, potential termination and/or legal action

Violations involving customer data are treated with additional urgency. If a violation results in or contributes to a data breach, the incident response process (NSP-003) is activated in parallel with the disciplinary investigation.

---

## 9. Exceptions

Exceptions to this policy must be:

1. Requested in writing to the CISO, with a documented business justification
2. Formally approved in writing by the CISO
3. Time-limited (maximum 90 days per approval, renewable)
4. Logged in the ISMS exceptions register

No exception may be granted that would materially compromise the confidentiality of customer data or the integrity of authentication controls.

---

*This document is classified: Internal. Do not distribute outside Nexus without CISO approval.*
