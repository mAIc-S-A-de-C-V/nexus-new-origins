# Nexus Supplier Security Policy

**Document ID:** NSP-006
**ISO 27001 Reference:** Annex A.5.19 (Information Security in Supplier Relationships), A.5.20 (Addressing Information Security Within Supplier Agreements)
**Version:** 1.0
**Effective Date:** 2026-04-06
**Last Reviewed:** 2026-04-06
**Next Review Due:** 2027-04-06
**Document Owner:** Chief Information Security Officer (CISO)
**Approved By:** Chief Executive Officer

---

## 1. Purpose

Nexus relies on a set of third-party suppliers to deliver its platform. These suppliers process, transmit, or store Nexus customer data or provide infrastructure that is essential to platform operation. This policy establishes the requirements for assessing, contracting with, monitoring, and offboarding suppliers in a way that protects Nexus customers and meets Nexus's obligations under applicable data protection law.

---

## 2. Scope

This policy applies to all third parties who:

- Process personal data on behalf of Nexus (acting as data processors under GDPR)
- Provide cloud infrastructure that hosts Nexus services or customer data
- Provide APIs that Nexus calls as part of the data operations pipeline
- Provide security-relevant tooling (vulnerability scanning, monitoring, identity management)

---

## 3. Approved Suppliers and Security Profile

The following table lists Nexus's currently approved third-party suppliers with material security relevance. Each supplier's profile describes what data is shared, what security properties are relied upon, and any specific obligations or risk notes.

---

### 3.1 Anthropic (Claude API)

**Service:** AI inference via the Claude API, used by the Nexus inference-service (port 8003) to process user prompts, ontology data, and pipeline logic instructions.

**Data sent to Anthropic:**
- User-authored prompts submitted through the Nexus pipeline interface
- Ontology records (nodes, relationships, and their properties) included as context in inference requests
- Pipeline step configurations when used to generate or validate logic

**Data sensitivity:** Confidential. Customer business data may be present in prompt context. PII may be present in ontology records depending on customer configuration.

**Security properties relied upon:**
- Anthropic does not use API prompt data for model training under the enterprise/commercial API terms of service. This must be confirmed in the executed DPA.
- API communication occurs exclusively over HTTPS/TLS.
- Anthropic maintains SOC 2 Type II certification (verify current status annually).

**Contractual requirements:**
- A Data Processing Agreement (DPA) must be signed with Anthropic before any customer data is included in inference requests.
- The DPA must specify that: (a) data is not used for model training, (b) data is not shared with other Anthropic customers, (c) Anthropic will notify Nexus of a security incident involving Nexus data within 72 hours.

**Credential:** `ANTHROPIC_API_KEY` — classified Restricted. Stored as an environment variable, never committed to version control. Rotated annually or immediately upon suspected compromise.

**Risk note:** If the Anthropic API is unavailable, the inference-service is unavailable. Nexus has no fallback inference provider at this time. This represents a single point of failure for AI-assisted pipeline features.

---

### 3.2 HubSpot (CRM Connector)

**Service:** HubSpot is an external data source connected by Nexus customers via the connector-service. Nexus fetches CRM data (contacts, deals, companies, activities) from the HubSpot API on behalf of the customer.

**Data fetched from HubSpot:**
- Contact records (names, email addresses, phone numbers, company affiliations — PII)
- Deal pipeline records (deal names, values, stages)
- Company records
- Activity logs

**Data sensitivity:** Confidential (PII present in contacts). Data is fetched into the Nexus processing pipeline and may be persisted in ontology records.

**Security properties relied upon:**
- HubSpot OAuth 2.0 authorization flow is used. Nexus stores the customer's OAuth access and refresh tokens in the connector-service database.
- OAuth tokens are encrypted at rest using AES-256 at the application layer before storage in PostgreSQL.
- HubSpot API communication occurs over HTTPS/TLS.

**Contractual requirements:**
- Nexus operates as a data processor with respect to the customer's HubSpot data. The Nexus-customer DPA governs this. No separate DPA with HubSpot is required, as Nexus is using the customer's own HubSpot account via the customer's OAuth authorization.
- OAuth tokens must be scoped to the minimum permissions required (read-only scopes where feasible).

**Credential:** Customer OAuth tokens (access token + refresh token). Classified Confidential/Restricted (stored encrypted). Rotate by triggering re-authentication; never rotate manually without customer consent.

**Risk note:** HubSpot API rate limits may affect connector performance. Rate limit errors should be handled gracefully and logged to the audit service.

---

### 3.3 SMTP Provider (Email Delivery)

**Current provider:** GoDaddy SMTP or SendGrid (confirm current configuration in infrastructure records).

**Service:** Transactional email delivery for the Nexus platform — used for user account notifications (onboarding, password reset, MFA codes), alert notifications, and system notifications.

**Data sent to SMTP provider:**
- Recipient email addresses (PII — Confidential)
- Email subject and body, which may contain: username, account status notifications, alert summaries, and potentially brief references to customer data in alert notifications

**Data sensitivity:** Confidential. Email content may contain PII and references to customer data.

**Security properties relied upon:**
- All SMTP connections must use TLS (STARTTLS or SMTPS — port 587 with STARTTLS or port 465 with implicit TLS). Plaintext SMTP on port 25 is prohibited for sending Nexus transactional email.
- SMTP credentials (username and password or API key) are classified Restricted and stored as environment variables, never in source code.
- The SMTP provider should support SPF, DKIM, and DMARC to ensure Nexus email is delivered and authenticated.

**Contractual requirements:**
- A DPA is required if the SMTP provider stores or processes email content (most providers do for bounce tracking and spam filtering).
- The provider must support TLS in transit.
- Breach notification clause required.

**Credential:** SMTP username and password or API key. Classified Restricted. Rotated annually.

**Risk note:** Alert notifications are a secondary use; failure of SMTP delivery does not constitute a security incident. However, SMTP credentials are Restricted data and their compromise could enable spam or phishing from Nexus's sending domain, causing reputational harm.

---

### 3.4 Amazon Web Services (AWS — Cloud Infrastructure)

**Service:** AWS provides cloud infrastructure hosting for the Nexus production environment. This includes EC2 instances running the Docker Compose stack, S3 buckets for backup storage, VPC networking, security groups, and IAM for cloud access management.

**Data hosted on AWS:**
- All production Nexus data: PostgreSQL and TimescaleDB volumes containing customer data (Confidential), audit logs, user records, connector credentials (Restricted)
- Backup files created by `scripts/backup.sh`, stored in S3 (Confidential content, must be encrypted)

**Data sensitivity:** Confidential and Restricted data are resident on AWS infrastructure.

**Security properties relied upon:**
- AWS holds SOC 2 Type II, ISO 27001, and ISO 27017 certifications. Current certification status is verified annually.
- VPC isolation: the Nexus Docker stack runs within a dedicated VPC. Direct database ports (5432, 5434, 6379) are not exposed to the public internet via security group rules.
- S3 bucket for backups is configured with: server-side encryption (SSE-S3 or SSE-KMS), Object Lock (WORM) for tamper protection, and restricted bucket policies (no public access).
- IAM roles are used for EC2-to-S3 access; no static IAM access keys are used for the production deployment workload.
- AWS Shared Responsibility Model applies: AWS is responsible for the security of the cloud; Nexus is responsible for security in the cloud (OS hardening, application security, access management).

**Contractual requirements:**
- AWS Data Processing Addendum (DPA) accepted as part of AWS service terms. Confirm this covers EU/EEA personal data under GDPR.
- AWS Business Associate Agreement (BAA) is not required unless Nexus processes health data (not currently in scope).

**Credential:** AWS IAM credentials for deployment and backup operations. Classified Restricted. Use IAM roles for workload identity; avoid long-lived access keys. Rotate any static access keys annually.

**Risk note:** AWS infrastructure failure (e.g., EC2 instance failure, AZ outage) is addressed by the Business Continuity Plan (NSP-007) and Disaster Recovery Runbook (NSP-009).

---

## 4. Supplier Assessment Process

All new suppliers with access to Nexus customer data or critical infrastructure must complete the following assessment before being approved for use in production.

### 4.1 Initial Assessment (Prior to Onboarding)

1. **Security questionnaire:** The prospective supplier completes a Nexus vendor security questionnaire covering: data handling practices, encryption standards, access controls, incident response capabilities, and subprocessor list.
2. **Certification review:** The supplier provides evidence of relevant certifications (SOC 2 Type II, ISO 27001, or equivalent). The CISO reviews the scope and date of the certification.
3. **Data flow mapping:** Document what Nexus data the supplier will access, in what form, and for what purpose. This informs the DPA scope.
4. **Risk assessment:** The CISO rates the supplier as Low, Medium, or High risk based on: sensitivity of data shared, criticality of the service to platform operation, and maturity of the supplier's security program. High-risk suppliers require CISO sign-off before onboarding.

### 4.2 Contractual Requirements

Before any Nexus customer data is shared with a supplier, the following contracts must be in place:

- **Data Processing Agreement (DPA):** Required for any supplier acting as a data processor under GDPR. The DPA must specify: subject matter, duration, nature and purpose of processing, type of personal data, categories of data subjects, obligations and rights of the controller (Nexus).
- **Security questionnaire response on file:** Retained in ISMS supplier records.
- **Breach notification SLA:** The DPA or main agreement must require the supplier to notify Nexus of a security incident affecting Nexus data within **72 hours** of the supplier becoming aware of the incident.
- **Subprocessor notification:** Supplier must notify Nexus of any new subprocessors who will have access to Nexus data, with a minimum 30-day notice period.

---

## 5. Annual Supplier Review

All approved suppliers are reviewed annually by the CISO. The review covers:

- Verification that current certifications (SOC 2, ISO 27001) are still valid and in-scope for the services Nexus uses
- Review of any security incidents the supplier has reported in the past year
- Confirmation that the DPA remains adequate given any changes to data flows or applicable law
- Updated security questionnaire if the supplier's scope or the data shared has changed materially
- Review of whether the supplier is still necessary or if alternatives with a better security profile exist

Annual review outcomes are documented in the ISMS supplier register.

---

## 6. Supplier Offboarding

When a supplier relationship is terminated:

1. **Credential rotation within 48 hours:** All credentials used to authenticate to the supplier's service, and all credentials the supplier holds to authenticate to Nexus systems (if any), are rotated within **48 hours** of the relationship termination being confirmed. This includes:
   - API keys used to call the supplier's API
   - OAuth tokens issued by the supplier
   - SSH keys or access tokens granted to the supplier for any Nexus system
2. **Data deletion request:** Nexus sends a formal written request to the supplier to delete all Nexus data within their systems, within 30 days of termination.
3. **Confirmation of deletion:** The supplier provides written confirmation that Nexus data has been deleted. This confirmation is retained in ISMS records.
4. **DPA termination:** The DPA is formally terminated as per its terms.
5. **Audit log review:** The audit service and infrastructure logs are reviewed for any unusual activity associated with the supplier's credentials in the 30 days before termination.

---

## 7. Subprocessor Transparency

Nexus maintains a list of subprocessors (suppliers who process customer personal data) and makes this list available to customers upon request. Customers are notified of material changes to the subprocessor list per the terms of the customer DPA, with a minimum 30-day notice period for new subprocessors.

Current subprocessor list (maintained separately in ISMS supplier register):
- Anthropic (AI inference)
- AWS (cloud infrastructure)
- SMTP provider (email delivery)

---

*This document is classified: Internal. Do not distribute outside Nexus without CISO approval.*
