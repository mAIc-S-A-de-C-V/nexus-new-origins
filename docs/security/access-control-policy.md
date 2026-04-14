# Nexus Access Control Policy

**Document ID:** NSP-002
**ISO 27001 Reference:** Annex A.8.2 (Privileged Access Rights), A.8.3 (Information Access Restriction)
**Version:** 1.0
**Effective Date:** 2026-04-06
**Last Reviewed:** 2026-04-06
**Next Review Due:** 2027-04-06
**Document Owner:** Chief Information Security Officer (CISO)
**Approved By:** Chief Executive Officer

---

## 1. Purpose

This policy governs how access to the Nexus platform, its underlying infrastructure, and the data it processes is granted, maintained, and revoked. Nexus processes customer-supplied business data — including CRM records, connector credentials, ontology graphs, audit logs, and AI inference outputs — on behalf of B2B customers. Unauthorized or excessive access to these assets represents a material risk to customer confidentiality and to Nexus's operational integrity.

---

## 2. Scope

This policy applies to:

- All Nexus platform user accounts (customer-facing and internal)
- All infrastructure access: SSH to production hosts, direct database access, Docker management, cloud console access
- All service accounts used by Nexus microservices to communicate with each other or with external systems
- All third-party integrations and connector OAuth tokens stored within the platform
- All environments: development, staging, and production

---

## 3. Principle of Least Privilege

Access to any Nexus system, service, or data asset is granted at the minimum level required to perform the intended function. This principle is non-negotiable and applies to human users, service accounts, and automated processes alike.

Specifically:

- No user or service is granted blanket access to all platform resources
- Permissions are additive — a new account starts with no access and is granted only what is needed
- Elevated access (admin) is granted only for the duration it is required and reviewed quarterly
- Developers do not have standing access to production databases; access requires an approved change request and is logged

---

## 4. Role Definitions

Nexus defines three tiers of platform access for human users. Role assignment is part of the provisioning workflow (Section 6).

### 4.1 Viewer

Viewers have read-only access to Nexus platform resources assigned to their tenant.

**Can access:**
- View existing connector configurations (credentials are masked/redacted in UI)
- View ontology graph (read-only)
- View pipeline definitions and execution history
- View dashboards, alerts, and correlation outputs
- View audit log summaries (not raw log records)

**Cannot access:**
- Modify any configuration, pipeline, or connector
- View raw connector credentials or OAuth tokens
- Access audit log raw records or export functionality
- Manage user accounts
- Access administrative settings or billing

**Applicable to:** External stakeholders, read-only customer users, junior analysts in internal teams

### 4.2 Analyst

Analysts can create and modify data operations within their assigned tenant scope.

**Can access:**
- Everything a Viewer can access
- Create, edit, and delete connectors (including configuring credentials)
- Build and modify ontology nodes and relationships
- Create, edit, run, and delete pipelines
- Configure alert rules and correlation logic
- Export data within their tenant
- View full audit log records for their tenant

**Cannot access:**
- Manage user accounts or modify roles
- Access other tenants' data
- Modify platform-level settings (authentication configuration, encryption settings)
- Access infrastructure (servers, databases, Docker hosts)
- Perform bulk data deletion

**Applicable to:** Customer power users, internal data engineers, integration specialists

### 4.3 Admin

Admins have full access within their scope of responsibility. Two sub-types exist:

**Tenant Admin:**
- Everything an Analyst can access
- Create, modify, deactivate, and delete user accounts within their tenant
- Assign and modify roles within their tenant (cannot assign roles above Analyst without escalation)
- Access full audit logs including export
- Manage tenant-level settings (SMTP configuration, API key visibility)

**Platform Admin (Nexus internal staff only):**
- Full access across all tenants (used for support and incident response only)
- Infrastructure access (per change management process)
- Ability to modify system-level configuration
- User management across all tenants

Platform Admin access requires MFA (Section 7) and is subject to quarterly review (Section 9). All Platform Admin actions are recorded in the audit log.

---

## 5. User Provisioning

### 5.1 Customer Accounts — Domain-Based Auto-Provisioning

When a new B2B customer signs an agreement with Nexus, their organization domain is registered in the platform. Users from that domain who authenticate via the organization's configured OIDC provider (e.g., Google Workspace, Azure AD, Okta) are automatically provisioned with Viewer role by default.

Customers may configure their OIDC provider to pass role claims in the JWT, which the auth-service (`backend/auth_service/`) maps to Nexus roles at login time. Supported claim mapping:
- `nexus:viewer` → Viewer
- `nexus:analyst` → Analyst
- `nexus:admin` → Tenant Admin (requires confirmation — see Section 5.2)

### 5.2 Admin Account Provisioning — Approval Workflow

Assignment of Tenant Admin or Platform Admin roles is never automatic. The workflow is:

1. The requesting user or their manager submits a written request (email or ticketing system) to the Nexus CISO (for Platform Admin) or the existing Tenant Admin (for Tenant Admin), stating the business justification and intended access duration
2. The approver reviews the request and confirms it meets least-privilege requirements
3. Upon approval, the role is assigned by an existing admin in the platform
4. The provisioning event is recorded in the audit log with the approver's identity
5. The new admin account is enrolled in MFA (Section 7) before the role is activated

Unapproved admin assignments discovered in audit log review are treated as policy violations per NSP-001 Section 8.

### 5.3 Internal Nexus Employee Accounts

Internal accounts are provisioned by the CISO or delegated IT administrator. Developer accounts in production are limited to read access for debugging; write access requires an approved change request per NSP-005.

---

## 6. Multi-Factor Authentication (MFA)

MFA is mandatory for:

- All Tenant Admin accounts
- All Platform Admin accounts
- All SSH access to production infrastructure
- All direct database access (when granted for incident response or maintenance)

MFA is strongly recommended for Analyst accounts and must be offered as an option to all users.

Acceptable MFA methods:
- TOTP authenticator app (Google Authenticator, Authy, 1Password)
- Hardware security key (FIDO2/WebAuthn)

SMS-based one-time passwords are not acceptable as an MFA method due to SIM-swap vulnerability.

Admin accounts that have not enrolled in MFA within 7 days of provisioning will be suspended until enrollment is complete. The CISO is notified automatically of any admin account without active MFA.

---

## 7. Password Policy

All Nexus platform accounts that use password-based authentication (i.e., accounts not exclusively relying on OIDC SSO) must comply with the following:

- **Minimum length:** 12 characters
- **Complexity:** Must include at least one uppercase letter, one lowercase letter, one digit, and one special character (`!@#$%^&*()-_=+[]{}|;:,.<>?`)
- **Rotation:** Passwords must be changed every 90 days. The platform enforces this by requiring a password reset upon expiry
- **History:** The last 10 passwords may not be reused
- **Breach detection:** Passwords are checked against the HaveIBeenPwned API (k-anonymity model) at set time; accounts with compromised passwords are forced to reset immediately
- **Failed attempts:** After 10 consecutive failed login attempts, the account is locked for 30 minutes. After 20 cumulative failed attempts within 24 hours, the account is locked and requires admin reset. Failed login attempts are logged in the audit service.

Password hashing uses bcrypt with a minimum work factor of 12, implemented in `backend/auth_service/password_utils.py`.

---

## 8. Service Accounts

Service accounts are used by Nexus microservices to authenticate with each other and with external systems (e.g., the database connection used by connector-service, OAuth tokens used to fetch data from HubSpot).

Rules governing service accounts:

- **Naming convention:** Service accounts are named `svc-<service>-<purpose>` (e.g., `svc-connector-hubspot`)
- **Permissions:** Restricted to only the permissions required for the service's function. Database service accounts are schema-specific; they do not have superuser privileges.
- **No interactive login:** Service account credentials are never used for interactive sessions. If a human needs to perform an action, they use their own account.
- **Credential storage:** Service account credentials (database passwords, OAuth tokens) are stored as Docker environment secrets or in the `.env` file, never hardcoded in source code. Production secrets are managed outside the repository.
- **Rotation:** Service account credentials are rotated annually at minimum, or immediately upon:
  - Suspected or confirmed compromise
  - Departure of any team member who had access to the credential
  - Termination of a supplier relationship (per NSP-006)
- **Connector OAuth tokens:** Treated as Restricted-class data per NSP-004. Stored encrypted in the PostgreSQL database. Rotation is triggered by the customer re-authenticating the connector.

---

## 9. Access Review

All active Nexus accounts are reviewed quarterly. The review is conducted by the CISO (for Platform Admin and internal accounts) and by Tenant Admins (for their tenant's users), with results reported to the CISO.

The review process:
1. The CISO generates an access report from the audit service listing all active accounts, their roles, last login date, and MFA status
2. Reviewers confirm that each account's role is still appropriate for that user's current function
3. Accounts for which no business justification exists (role creep, forgotten accounts) are deactivated within 5 business days of the review
4. Users who have not logged in for 90 days are flagged for deactivation unless a business justification is provided
5. Accounts lacking MFA where it is required are suspended immediately
6. Review completion and findings are documented in the ISMS records

---

## 10. Offboarding and Account Deactivation

When an employee, contractor, or customer user departs:

- **Internal employees and contractors:** All Nexus platform and infrastructure access is deactivated within **24 hours** of confirmed departure. The IT administrator or CISO performs the deactivation. SSH keys are revoked, OAuth tokens are invalidated, and the account is locked (not deleted — account records are retained for audit purposes per NSP-004).
- **Customer users:** Tenant Admins are responsible for deactivating departing user accounts within their organization. Nexus's quarterly access review serves as a backstop to catch accounts that were not deactivated in time.
- **Service accounts:** If a departing employee had knowledge of service account credentials, those credentials are rotated within 24 hours of departure.

The offboarding checklist is maintained by HR in coordination with the CISO. Failure to complete offboarding within the defined window is reported to the CISO and treated as a policy exception requiring documentation.

---

## 11. Shared Accounts

Shared accounts — any account where credentials are used by more than one individual — are **prohibited** on the Nexus platform and all supporting infrastructure. Every human user and every service must have a uniquely identified account.

Rationale: Shared accounts prevent attribution of actions in audit logs, undermine incident investigation, and make access revocation unreliable.

If a situation arises where a team member claims to require a shared account, the correct resolution is to provision a properly scoped individual account or service account. The CISO must be consulted. There are no exceptions to this rule.

---

## 12. Physical and Remote Access

- Production infrastructure access is via SSH with key-based authentication. Password-based SSH authentication is disabled on production hosts.
- SSH private keys must be passphrase-protected and stored on the user's device only (not in shared storage or version control).
- Remote access sessions to production must be logged. Session logs are retained for 90 days.
- VPN or equivalent network-level control is required for direct database access when conducted remotely.

---

## 13. Violations

Violations of this policy — including unauthorized privilege escalation, shared account usage, failure to deactivate departing user accounts within defined windows, or bypassing MFA requirements — are handled under NSP-001 Section 8 (Policy Violations).

---

*This document is classified: Internal. Do not distribute outside Nexus without CISO approval.*
