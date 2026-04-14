# Nexus Data Classification Policy

**Document ID:** NSP-004
**ISO 27001 Reference:** Annex A.5.12 — Classification of Information
**Version:** 1.0
**Effective Date:** 2026-04-06
**Last Reviewed:** 2026-04-06
**Next Review Due:** 2027-04-06
**Document Owner:** Chief Information Security Officer (CISO)
**Approved By:** Chief Executive Officer

---

## 1. Purpose

This policy defines how information assets owned by or processed by Nexus are classified, handled, retained, and disposed of. Classification ensures that protective controls are proportionate to the sensitivity of the data. Every data asset in the Nexus platform — whether it is a configuration record, a customer CRM contact, or an encryption key — falls into one of four classification levels defined in this policy.

---

## 2. Scope

This policy applies to all information assets created, processed, transmitted, or stored by:

- Nexus microservices and their associated databases (PostgreSQL `nexus` database, TimescaleDB `nexus_events` database, Redis)
- All data exchanged with external systems via Nexus connectors (HubSpot, REST APIs, SMTP, etc.)
- All data transmitted to or received from third-party APIs (Anthropic Claude API, OIDC providers)
- Internal business data (documentation, configuration, source code)
- All environments: development, staging, and production

---

## 3. Classification Levels

### 3.1 Public

**Definition:** Information that is intentionally made available to the general public or that, if disclosed, would cause no harm to Nexus or its customers.

**Examples:**
- Nexus marketing materials (website copy, product descriptions, case studies)
- Published API documentation and integration guides
- Open-source code published under a permissive license
- Public blog posts and press releases
- The Nexus platform README and developer guides

**Handling requirements:**
- No encryption required for storage or transmission (HTTPS for transmission is still best practice)
- No access restrictions; may be shared freely
- No special disposal requirements — standard deletion is sufficient
- May be stored in public repositories, CDNs, or public-facing web servers

---

### 3.2 Internal

**Definition:** Information intended for use by Nexus employees and authorized contractors, which would cause minor business harm or reputational impact if disclosed externally, but does not contain customer data or secrets.

**Examples:**
- Internal business logic and non-customer-facing pipeline configurations
- Platform architecture documentation and developer guides (e.g., `docs/PLATFORM_GUIDE.md`)
- Internal Slack/email communications not containing customer data or credentials
- Ontology schema definitions and template configurations
- Service-to-service API contracts and interface specifications
- Non-production test data (synthetic, anonymized)
- Nexus security policies (this document) in draft state

**Handling requirements:**
- **Storage:** May be stored in internal systems without encryption at rest if access controls are applied (e.g., private git repository, internal wiki)
- **Transmission:** Must be transmitted over encrypted channels (TLS 1.2 minimum) when sent outside the Nexus internal network
- **Access:** Restricted to Nexus employees and authorized contractors. Not shared with customers unless required for support purposes.
- **Disposal:** Standard deletion. Sensitive drafts should be deleted from version history if they were accidentally committed to a public location.
- **Labeling:** Documents should be labeled "Internal" in the footer or document properties

---

### 3.3 Confidential

**Definition:** Sensitive information whose unauthorized disclosure could cause significant harm to customers, third parties, or Nexus's business and legal standing. This is the default classification for any data involving customers.

**Examples:**
- Customer data of any type ingested through Nexus connectors (CRM contacts, deals, pipeline data, business records)
- Ontology records created or managed by customer tenants
- Connector credentials in any form (OAuth tokens, API keys, basic auth credentials stored in the connector-service database)
- Audit log records (contain details of customer actions and data access)
- TimescaleDB event records (contain operational telemetry tied to customer tenants)
- User account information (email addresses, hashed passwords, MFA secrets)
- Customer support communications that reference platform data
- Contractual documents with customers (MSAs, DPAs, SLAs)
- All PII (see Section 5)

**Handling requirements:**
- **Storage:** Must be encrypted at rest. PostgreSQL and TimescaleDB volumes containing Confidential data must use encryption at the volume or database level. Connector credentials stored in the `connectors` table are encrypted at the application layer (AES-256) in addition to any database-level encryption.
- **Transmission:** Must be transmitted exclusively over TLS 1.2 or higher. Connector-service to external APIs must use HTTPS. Internal microservice communication occurs over the Docker `nexus-net` bridge network, which is isolated; additional TLS for internal service calls is recommended for production.
- **Access:** Limited to authorized Nexus employees with a need to know, and to the specific customer tenant that owns the data. Role-based access controls per NSP-002 apply. Developers do not have standing access to production Confidential data.
- **Logging:** All access to Confidential data must generate an audit log entry. The audit-service is responsible for capturing these events.
- **Sharing:** May not be shared with third parties without a signed Data Processing Agreement (DPA) and CISO approval. Sharing with Anthropic via inference prompts is governed by the Supplier Security Policy (NSP-006).
- **Disposal:** Secure deletion required. For database records: DELETE with subsequent VACUUM in PostgreSQL. For encrypted data: crypto-shredding (key destruction, see Section 7) is acceptable as an alternative to data deletion.
- **Labeling:** Documents and exports labeled "Confidential — Nexus"

---

### 3.4 Restricted

**Definition:** The highest classification level. Information whose unauthorized disclosure would directly enable a security breach, compromise authentication or encryption systems, or cause severe and potentially irreversible harm to customers or Nexus.

**Examples:**
- Encryption keys and key material (AES keys used to encrypt connector credentials)
- JWT signing keys (used by auth-service to sign tokens)
- OIDC client secrets (used for federated authentication with customer identity providers)
- Production database passwords (`POSTGRES_PASSWORD` in production `.env`)
- The `ANTHROPIC_API_KEY` in production
- SSH private keys for production host access
- Any secret or private key stored in `.env` or Docker secrets

**Handling requirements:**
- **Storage:** Must never be stored in plaintext in any location accessible to version control. Must be stored in a secrets management system (Docker secrets, AWS Secrets Manager, HashiCorp Vault, or equivalent). The `.env` file in production must have file permissions restricted to the service user (mode 600) and must never be committed to git.
- **Transmission:** Must only be transmitted in encrypted form. Never logged, never included in error messages, never returned in API responses. The platform must mask or omit Restricted data from all log outputs.
- **Access:** Limited to the minimum set of individuals required for platform operation. In practice: CISO, Development Lead, and the automated deployment process. No customer or tenant-level user should ever have access to Restricted data.
- **Rotation:** All Restricted credentials and keys must be rotated at least annually, and immediately upon any of the following: suspected compromise, departure of an authorized holder, or supplier offboarding.
- **Disposal:** Destruction of Restricted key material must use crypto-shredding or verified overwrite. Document the destruction event (what was destroyed, when, by whom) in the ISMS records.
- **Labeling:** Documents labeled "Restricted — Do Not Copy"

---

## 4. Classification by Nexus Data Asset

The following table maps specific Nexus platform data assets to their classification level.

| Data Asset | Location | Classification |
|------------|----------|----------------|
| Customer connector configurations (non-credential fields) | PostgreSQL `connectors` table | Confidential |
| Customer connector OAuth tokens and API keys | PostgreSQL `connectors` table (encrypted column) | Confidential / Restricted (stored as Restricted, treated as Confidential in access policy) |
| Ontology nodes and relationships (customer data) | PostgreSQL `ontology` tables | Confidential |
| Pipeline definitions and step configurations | PostgreSQL `pipelines` tables | Confidential |
| AI inference inputs and outputs | Processed in-memory; logged summary in audit logs | Confidential |
| Audit log records | PostgreSQL `audit_events` table | Confidential |
| TimescaleDB event records | TimescaleDB `nexus_events` database | Confidential |
| User accounts (name, email, role) | PostgreSQL `users` table | Confidential |
| Hashed passwords | PostgreSQL `users` table | Confidential |
| MFA secrets (TOTP seeds) | PostgreSQL `users` table (encrypted) | Restricted |
| JWT signing key | Runtime secret / `.env` | Restricted |
| OIDC client secrets | Runtime secret / `.env` | Restricted |
| ANTHROPIC_API_KEY | Runtime secret / `.env` | Restricted |
| POSTGRES_PASSWORD | Runtime secret / `.env` | Restricted |
| SSH private keys | Individual engineer workstations | Restricted |
| Platform architecture documentation | `docs/` directory, git repository | Internal |
| Security policy documents | `docs/security/`, git repository | Internal |
| API documentation | `docs/`, potentially public | Internal / Public |
| Docker Compose configuration (non-secret) | `docker-compose.yml` | Internal |
| Source code | Git repository (private) | Internal |
| Marketing materials | Website / public channels | Public |

---

## 5. PII Handling

All Personally Identifiable Information (PII) processed by the Nexus platform must be classified at **Confidential** minimum. This includes:

- Customer contact records ingested via the HubSpot connector (names, email addresses, phone numbers, company affiliations)
- User account data (email addresses, names)
- Any PII contained in ontology records or pipeline data

PII must additionally:

- Be handled in accordance with applicable data protection law (GDPR for EU residents, and any applicable national law for the customer's jurisdiction)
- Not be included in AI inference prompts in identifiable form unless the customer has explicitly configured their pipeline to do so, and the DPA with Anthropic is in place
- Not be retained beyond the period necessary for the stated processing purpose
- Be subject to data subject rights requests (access, deletion, rectification) per the customer's DPA with Nexus

The CISO maintains a record of processing activities (ROPA) documenting all PII processing in the platform.

---

## 6. Connector Data Classification

Data fetched through Nexus connectors inherits a classification based on the nature of the source system and the data retrieved. The following defaults apply:

| Connector / Source | Data Type | Default Classification |
|--------------------|-----------|----------------------|
| HubSpot Contacts | CRM contacts (names, emails, phone numbers) | Confidential (PII) |
| HubSpot Deals | Deal pipeline data, revenue figures | Confidential |
| Generic REST API | Depends on configuration — assessed per tenant | Confidential (default) |
| SMTP (email sending) | Message content, recipient addresses | Confidential (may contain PII) |
| Internal/synthetic test data | Non-customer data | Internal |

Customers who configure Restricted-equivalent data (e.g., credentials, authentication tokens) as REST API body parameters in pipeline definitions must be warned via the platform UI that this data will be classified and handled as Confidential and that such configurations are strongly discouraged.

---

## 7. Retention Schedule

| Classification Level | Maximum Retention | Notes |
|---------------------|------------------|-------|
| Public | Indefinite | Retain as long as operationally useful |
| Internal | Indefinite while operationally relevant | Archive or delete when superseded |
| Confidential | 7 years from creation or last access | Includes customer data, audit logs, contracts. Legal requirements may extend this. |
| Restricted | 1 year after the key/secret is rotated and decommissioned | The active credential is retained for its operational life; old versions are destroyed within 1 year of rotation |

Customer data is subject to deletion upon customer contract termination per the applicable MSA. The CISO coordinates data deletion requests with the engineering team within 30 days of contract termination.

Audit logs (Confidential) are retained for a minimum of 1 year in active storage and may be archived for up to 7 years for legal and compliance purposes.

---

## 8. Disposal

### 8.1 Standard Deletion

Sufficient for Public and Internal data. The file or record is deleted via standard operating system or database mechanisms. No additional steps required.

### 8.2 Secure Deletion

Required for Confidential data. For database records:
- `DELETE` the record(s) from PostgreSQL
- Run `VACUUM` on the affected table to reclaim space and prevent recovery from dead tuples
- For bulk customer data deletion: use `TRUNCATE` followed by `VACUUM FULL` on affected tables
- For backup files containing Confidential data: use `shred -u` on Linux hosts or secure erase facilities

### 8.3 Crypto-Shredding

Preferred disposal method for encrypted Confidential data and the only required disposal method for Restricted key material:

- Destroy the encryption key(s) used to encrypt the data
- Confirm key destruction by verifying that the key no longer exists in the secrets management system
- Encrypted data rendered unrecoverable by key destruction is considered disposed
- Document the destruction: what key, what data it protected, when destroyed, by whom

Crypto-shredding is the recommended approach for customer data deletion upon contract termination, as it provides a fast, auditable, and comprehensive disposal mechanism without requiring identification and deletion of every individual record.

---

## 9. Violations

Mishandling of classified data — including storing Restricted data in plaintext, logging Confidential data, transmitting Restricted credentials over unencrypted channels, or retaining data beyond the defined retention period — is a policy violation handled under NSP-001 Section 8.

---

*This document is classified: Internal. Do not distribute outside Nexus without CISO approval.*
