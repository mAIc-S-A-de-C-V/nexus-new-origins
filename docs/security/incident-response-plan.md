# Nexus Incident Response Plan

**Document ID:** NSP-003
**ISO 27001 Reference:** Annex A.5.28 (Collection of Evidence), A.6.8 (Information Security Event Reporting)
**Version:** 1.0
**Effective Date:** 2026-04-06
**Last Reviewed:** 2026-04-06
**Next Review Due:** 2027-04-06
**Document Owner:** Chief Information Security Officer (CISO)
**Approved By:** Chief Executive Officer

---

## 1. Purpose

This plan defines the process for detecting, classifying, containing, investigating, recovering from, and reviewing information security incidents affecting the Nexus platform. Its goal is to minimize damage to customers and to the business, preserve evidence, meet regulatory notification obligations, and prevent recurrence.

---

## 2. Scope

This plan applies to all security incidents affecting:

- The Nexus platform microservices (connector-service, auth-service, ontology-service, inference-service, pipeline-service, audit-service, correlation-engine, alert-engine, event-log-service, and all others)
- Production infrastructure (Docker hosts, PostgreSQL, TimescaleDB, Redis)
- Customer data in any form (at rest, in transit, or in processing)
- Nexus employee or contractor workstations and accounts when they affect platform security
- Third-party integrations (Anthropic Claude API, HubSpot connector, SMTP provider, AWS)

---

## 3. Incident Classification

All incidents are classified at initial triage. Classification determines the response urgency, team activation, and notification obligations.

### 3.1 Critical

**Definition:** Active, ongoing threat to the confidentiality, integrity, or availability of customer data or core platform function, or confirmed exploitation of a vulnerability.

**Examples:**
- Confirmed data breach: unauthorized party has accessed, exfiltrated, or modified customer data (connector credentials, ontology records, CRM data)
- Full system compromise: attacker has shell access to a production host or database
- Ransomware or destructive malware affecting production infrastructure
- Unauthorized modification of audit log records
- Compromise of JWT signing keys or OIDC secrets
- Complete production outage with no available recovery path

**Response SLA:** Incident Commander (CISO) engaged within **30 minutes**. Initial containment steps underway within **1 hour**.

### 3.2 High

**Definition:** Significant security event that has not yet resulted in confirmed data exfiltration but presents a high probability of escalating to Critical, or a confirmed breach of a non-customer-facing system.

**Examples:**
- Authentication bypass discovered in auth-service (e.g., JWT validation flaw)
- Unencrypted customer data found in logs or in an exposed endpoint
- Admin account compromise (even if no unauthorized data access is confirmed)
- Unauthorized access to the Nexus production database (even if only read access)
- Connector OAuth token exposed in error responses or logs
- Successful exploitation of a known vulnerability in a Nexus dependency, confirmed in production

**Response SLA:** On-call engineer and CISO engaged within **1 hour**. Containment plan defined within **2 hours**.

### 3.3 Medium

**Definition:** Security event that indicates a threat actor is probing for vulnerabilities or has exploited a low-impact vector without accessing sensitive data.

**Examples:**
- Sustained failed brute-force attempts against login endpoints (>50 attempts/minute from a single IP, blocked by rate limiter but requiring investigation)
- Detection of a known malicious IP attempting to enumerate API endpoints
- Non-critical dependency with a known CVE confirmed in production (High CVSS score but not directly exploitable in current configuration)
- Accidental internal data exposure (Nexus employee forwarded a file containing customer data to personal email)
- Alert engine incorrectly silenced due to misconfiguration, creating a detection gap

**Response SLA:** Assigned to on-call engineer within **4 hours**. Resolved or escalated within **24 hours**.

### 3.4 Low

**Definition:** Policy violations, minor anomalies, or events with no immediate security impact but requiring documentation and remediation.

**Examples:**
- An employee found to have disabled MFA on their admin account without authorization
- A developer committed a non-sensitive configuration file to a public branch
- A user attempting to access a resource outside their role (blocked by access controls, no data accessed)
- Stale admin account found during quarterly access review
- Audit log record gap of less than 5 minutes due to service restart

**Response SLA:** Documented and assigned within **5 business days**. Resolved within **30 days**.

---

## 4. Detection Sources

Incidents may be detected through any of the following channels. All confirmed detections are routed to the incident response process.

### 4.1 Automated Alert Engine

The Nexus alert-engine-service (port 8010) monitors TimescaleDB event records for anomalous patterns configured as alert rules. Alert notifications are sent to the on-call engineer via configured notification channels (email or webhook). Example alert rules that should be configured:

- >10 failed login attempts per user per minute
- Auth-service returning 401 errors at >5x baseline rate
- Connector-service attempting to access more than N records in a single operation
- New admin account created (always notify CISO)
- Audit log write failures (potential tampering or outage)

### 4.2 Audit Logs

All Nexus microservices write structured audit events to the audit-service (port 8006), which persists them to the PostgreSQL database. Event log records are stored in TimescaleDB via event-log-service (port 8005). These logs are the primary forensic record for incident investigation.

Key logged events include: user login/logout, role changes, connector credential access, pipeline execution, data export, API key generation, and administrative actions.

Audit logs should be monitored for:
- Access outside normal business hours
- Unusually high data export volumes
- Role escalation events
- Repeated access to credential endpoints

### 4.3 CI/CD Security Scans

The deployment pipeline runs pip-audit (Python dependency vulnerability scanner) and Trivy (container image scanner) on every build. Findings at CRITICAL or HIGH severity block the deployment and generate an alert to the engineering team. This constitutes detection of a vulnerability incident.

### 4.4 User and Employee Reports

Any Nexus employee, contractor, or customer may report a suspected security incident by:

- Emailing: security@nexus.internal
- Messaging the CISO directly
- Using the designated incident reporting channel in the internal communications platform

Reports from customers received through support channels are escalated immediately to the CISO. No report is dismissed without investigation documentation.

### 4.5 Third-Party Notification

Suppliers (Anthropic, AWS, HubSpot, SMTP provider) may notify Nexus of a security event affecting shared infrastructure or data. These notifications are routed immediately to the CISO. The supplier's incident is treated as a Nexus incident at the same or one severity level higher, depending on the data exposure risk.

---

## 5. Response Team

| Role | Primary Responsibility | Activation Trigger |
|------|----------------------|-------------------|
| **On-Call Engineer** | First responder; initial triage, containment, and evidence preservation | All Medium and above incidents |
| **CISO** | Incident Commander for High and Critical; customer and Legal notification decision | All High and Critical incidents |
| **Legal Counsel** | GDPR/regulatory notification requirements; litigation hold if warranted | All Critical incidents; High incidents involving customer PII |
| **Development Lead** | Code-level investigation, patch development, hotfix deployment | All incidents requiring code changes |
| **CEO** | Executive notification; customer communication approval for Critical incidents | Critical incidents involving data breach |

An on-call rotation must be maintained so that the on-call engineer is reachable 24/7. Contact details are maintained in the escalation matrix (Section 11).

---

## 6. Response Procedures by Severity

### 6.1 Critical Incident Response

1. **Alert:** On-call engineer receives alert or report. Immediately pages the CISO. Do not attempt solo containment for Critical incidents.
2. **Declare:** CISO declares Critical incident. Creates incident record (shared document or ticketing system entry) with timestamp, initial description, and suspected scope.
3. **Contain:** Depending on nature:
   - **Active attacker on host:** Isolate the affected Docker container or host from the network immediately (`docker network disconnect nexus-net <container>` or cloud security group change). Do not shut down — preserve state for forensics.
   - **Data breach via application vulnerability:** Disable the affected endpoint or service. If the auth-service is compromised, bring it offline and force all active sessions to expire (rotate JWT signing key).
   - **Compromised credentials:** Rotate the affected credential immediately (connector OAuth token, database password, JWT secret). Audit all actions taken with that credential in the past 30 days.
   - **Database compromise:** Revoke all active database connections. If direct DB access was gained, change all database passwords. Engage Legal.
4. **Notify Legal:** CISO notifies Legal Counsel within 1 hour of declaring a Critical incident.
5. **Preserve evidence:** See Section 8.
6. **Investigate:** See Section 8.
7. **Notify customers:** If customer data is confirmed or suspected to have been accessed or exfiltrated, CISO and Legal determine notification obligation. Customer notification is issued within **72 hours** of confirming the breach (GDPR Article 33/34 alignment). See Section 9.
8. **Recover:** See Section 10.
9. **Post-incident review:** See Section 11.

### 6.2 High Incident Response

1. On-call engineer triages. If classification is confirmed as High, pages the CISO.
2. CISO and on-call engineer define containment plan within 2 hours.
3. Containment is executed. The affected service may be taken offline briefly if necessary; the Development Lead coordinates a hotfix.
4. Investigation proceeds per Section 8.
5. If investigation reveals the incident is actually Critical (data confirmed exposed), escalate immediately.
6. Recovery and post-incident review per Sections 10 and 11.

### 6.3 Medium Incident Response

1. On-call engineer owns the response.
2. Containment: Block the offending IP via firewall or nginx deny rule; patch the misconfiguration; or remediate the CVE per the vulnerability management policy (NSP-008).
3. Document findings in incident log.
4. Notify CISO of resolution within 24 hours.
5. No mandatory customer notification unless investigation reveals data exposure (which triggers re-classification to High or Critical).

### 6.4 Low Incident Response

1. Assigned to the relevant team member (not necessarily on-call).
2. Remediated within 30 days.
3. Documented in incident log.
4. No customer notification required.

---

## 7. Evidence Preservation

Evidence preservation begins immediately upon incident declaration and must not be deferred until containment is complete. Forensic evidence is irreplaceable.

**Actions:**
- Take snapshots or copies of affected Docker container filesystems before making changes (`docker commit <container> nexus-forensics-<timestamp>`)
- Export relevant audit log records to an isolated, read-only location immediately. Use the audit-service query API to export logs for the affected time window and affected user/service.
- Export application logs from affected services: `docker logs <container> > /incident/<timestamp>-<service>.log`
- Export PostgreSQL table snapshots for relevant tables (users, connectors, audit_events) using pg_dump to a forensic copy
- Do not modify, delete, or overwrite any logs during an active investigation
- Document every action taken during the incident response with a timestamp and the name of the person who took it

Evidence must be stored in a location accessible only to the CISO and Legal Counsel during an active investigation.

---

## 8. Investigation

After containment and evidence preservation, the CISO leads a structured investigation:

1. **Timeline reconstruction:** Using audit logs, application logs, and infrastructure access logs, reconstruct the sequence of events. Identify: when did the attacker first gain access? What did they access? What did they exfiltrate or modify?
2. **Scope determination:** Identify all affected tenants, users, and data assets. Is the incident isolated to one microservice or cross-cutting?
3. **Root cause analysis:** Identify the specific vulnerability, misconfiguration, or human error that enabled the incident. Is it a code defect? A dependency vulnerability? A social engineering attack? A policy violation?
4. **Attack vector documentation:** Document the full attack path for use in remediation and future detection rule development.
5. **Impact assessment:** Quantify, as precisely as possible, what data was accessed or exfiltrated. This is required for GDPR notification decisions.

---

## 9. Customer and Regulatory Notification

### 9.1 GDPR Notification Obligations

If the investigation confirms that customer personal data (as defined under GDPR) was accessed, disclosed, altered, or destroyed without authorization, the following notification obligations apply:

- **Supervisory Authority:** Nexus must notify the relevant data protection authority within **72 hours** of becoming aware of the breach (GDPR Article 33). If 72 hours is not achievable, an initial notification with a commitment to provide further information is acceptable.
- **Data Subjects (Customers):** If the breach is likely to result in a high risk to the rights and freedoms of natural persons, affected customers are notified without undue delay (GDPR Article 34).

### 9.2 Notification Content

Customer notifications must include:
- Nature of the breach (what happened, what data was involved)
- Categories and approximate number of data subjects and records affected
- Likely consequences of the breach
- Measures taken or proposed to address the breach and mitigate its effects
- Contact information for the Nexus Data Protection contact (CISO or Legal)

### 9.3 Notification Process

1. CISO and Legal Counsel jointly draft the notification
2. CEO approves the notification before it is sent
3. Notifications are sent from an official Nexus email address, not a personal account
4. All notifications are archived with timestamp and recipient list

---

## 10. Recovery

Recovery procedures must restore the platform to a known-good state and confirm that the attack vector has been closed before returning to full operation.

1. **Patch or mitigate the root cause:** The Development Lead deploys a fix via the standard change management process (NSP-005), with CISO review given the security context. Emergency change procedures apply (NSP-005 Section 7).
2. **Restore from backup if necessary:** If data integrity is compromised, restore from the most recent clean backup per the Disaster Recovery Runbook (NSP-009). Document the data loss window.
3. **Credential rotation:** Rotate all credentials that may have been exposed during the incident, even if their compromise is not confirmed.
4. **Re-audit:** After recovery, run a full audit log review for the 7 days preceding the incident to identify any other anomalous activity that may have been missed.
5. **Validate security controls:** Confirm that all security scans pass cleanly on the restored/patched platform before re-enabling full access.
6. **Staged re-enablement:** Restore service in stages (internal users first, then customer tenants) while monitoring audit logs for anomalous activity.

---

## 11. Post-Incident Review

A structured post-incident review is mandatory for all Medium and above incidents. The review is conducted within **5 business days** of incident resolution.

**Review participants:** CISO, on-call engineer(s) who responded, Development Lead, any other relevant staff

**Review outputs:**
- Written post-incident report documenting: timeline, root cause, impact, response effectiveness, and lessons learned
- Action items with owners and due dates (e.g., new alert rules, code fixes, policy updates, training needs)
- Assessment of whether this policy performed as expected, and any required revisions

Post-incident reports are retained in the ISMS records and reviewed as part of the annual security policy review. Repeated incident patterns indicate systemic control failures and require CISO escalation to the executive team.

---

## 12. Escalation Matrix

| Name / Role | Contact Method | Available |
|-------------|----------------|-----------|
| On-Call Engineer (rotating) | Pager / mobile (rotation schedule in ops wiki) | 24/7 |
| CISO | Email: ciso@nexus.internal / Mobile (in ops wiki) | 24/7 for Critical/High |
| Development Lead | Email / mobile (in ops wiki) | Business hours + on-call rotation |
| Legal Counsel | Email: legal@nexus.internal / Mobile (in ops wiki) | Business hours + emergency line |
| CEO | Mobile (in ops wiki) | Critical incidents only |

The full contact list with current phone numbers is maintained in the internal operations wiki and updated whenever personnel change. The on-call rotation schedule is updated monthly.

---

*This document is classified: Internal. Do not distribute outside Nexus without CISO approval.*
