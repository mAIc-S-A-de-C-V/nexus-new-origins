# Nexus Certification

The Nexus Certification program has three stackable tiers:

| Tier | Audience | Duration | Prereq |
|---|---|---|---|
| **User (Bronze)** | App consumers, MJSP staff | ~3h | none |
| **Builder (Silver)** | App developers, partners | ~12h | User |
| **Architect (Gold)** | Tenant admins, deployment owners | ~18h | Builder |

Each course pairs reading with a hands-on lab in a sandbox tenant. Each tier ends with a capstone exam: theory (multiple choice + short answer) and a practical (auto-graded against your sandbox tenant state).

## Status

Course material is being authored tier-by-tier. **U1 (Nexus 101) is the format pilot** — once we validate voice and grading shape against real learners, the rest follow the same pattern.

- [x] Curriculum outline
- [x] U1 — Nexus 101 ← *pilot*
- [ ] U2 — Dashboards & Apps
- [ ] U3 — Ontology Basics
- [ ] B1–B5 — Builder track
- [ ] A1–A5 — Architect track

## Tooling decision

For a developer-flavored cert with interactive Ontology labs, the right stack is **not** a traditional video-first LMS. After comparing options the recommended stack is:

| Layer | Tool | Why |
|---|---|---|
| **Written content** | [Mintlify](https://mintlify.com) or self-hosted Docusaurus | Markdown/MDX, dev-friendly, MCP server lets the Assistant query the docs |
| **Hands-on labs** | [Instruqt](https://instruqt.com) (phase 1) → Nexus-native app (phase 2) | Instruqt is the de-facto platform for vendor-led hands-on labs (HashiCorp, Snowflake, Google Cloud all use it). Migrate to a Nexus app once the program stabilizes — dogfooding the platform is the strongest possible reference for the Builder tier. |
| **Cert issuance** | Nexus itself | Certifications are `Certification` Ontology objects, queryable by anyone with a verification link. No third-party badge service. |
| **AI-assisted authoring** | Claude / [Coursebox.ai](https://coursebox.ai) for non-technical User-tier content | Use AI for drafting, not for final lesson voice. |

**What we explicitly rejected:**
- **All-in-one AI course builders** (Coursebox, One Course, Lingio) — optimized for video-heavy non-technical training. Wrong shape for a developer cert.
- **Articulate 360 Rise** — solid for corporate training, weak for code labs.
- **Pure GitBook** — strong docs, no native lab harness.

See [tooling-rationale.md](tooling-rationale.md) (TODO) for the long-form comparison.

## What you need to run the program

- **A learn tenant.** Provisioned by `scripts/seed_tenant_learn.py`. Each candidate gets their own subtenant for the practical exam.
- **The Mintlify (or Docusaurus) site** hosting written modules and shot list.
- **The auto-grader.** Per-course Python script (e.g., `scripts/grade_cert_u1.py`) that queries the candidate's tenant via the Ontology + EventLog APIs and emits a pass/fail report.
- **Screenshots.** Captured by the trainer against `tenant-learn` — see `u1-shot-list.md` for the U1 list.

## File layout

```
docs/certification/
├── README.md                  ← you are here
├── u1-nexus-101.md            ← lesson content
├── u1-shot-list.md            ← screenshots to capture for U1
└── shots/                     ← captured PNGs (TODO)

scripts/
├── seed_tenant_learn.py       ← provisions tenant-learn and a per-candidate subtenant
└── grade_cert_u1.py           ← auto-graders the U1 practical
```
