# U1 Screenshot Shot List

Five screenshots are referenced from `u1-nexus-101.md`. Capture them against a freshly-seeded `tenant-learn` (run `scripts/seed_tenant_learn.py` first). Save as PNG at the listed dimensions into `docs/certification/shots/`.

Rules of thumb:
- **Browser:** Chrome at 1440 × 900, system zoom 100 %.
- **Theme:** Light theme. The Nexus UI ships with both; pick the one the rest of the docs use.
- **Cursor:** Don't include the cursor in shots. Use a UI inspector or screenshot tool that hides it.
- **PII:** All seed data is fake. If you accidentally seed against a real tenant, retake. Faces, emails, real vendor names must not appear.
- **Redaction:** If your username or tenant ID appears in a corner, blur it (10px Gaussian).

---

## Shot 1 — `u1-ontology-explorer-vendor.png`

**Where used:** Section 2, "The Ontology"  
**Dimensions:** 1440 × 900 (full window)  
**Page:** `/ontology/explorer`

**State to capture:**
- Left rail shows the three object types (`Vendor`, `PurchaseOrder`, `LineItem`) with `Vendor` highlighted.
- Main pane shows the `Vendor` list view with at least 6 rows visible.
- Click into the **first** vendor row so the right panel opens.
- Right panel shows: property list at top (name, tier, address, etc.) and **Action history** scrolled to show at least 3 entries.

**Notes:**
- The vendor's `created_at` should be more than 7 days old to look "real" — the seed script handles this.
- Action history should include one `createVendor` and at least one `addNote` (seed adds these).

---

## Shot 2 — `u1-action-add-note.png`

**Where used:** Section 3, "Actions"  
**Dimensions:** 800 × 600 (modal centered, slight backdrop visible)  
**Page:** Same as Shot 1, but with the **Add Note** action modal open.

**State to capture:**
- Modal title: "Add Note".
- Single text input with the placeholder text visible (don't type anything — keep it pre-input).
- "Cancel" and "Submit" buttons at bottom.
- Vendor name visible in the modal header or subtitle.

**Notes:**
- Don't capture mid-typing. Either empty or with a clean example value like `Followed up with vendor 2026-05-12`.

---

## Shot 3 — `u1-apps-catalog.png`

**Where used:** Section 4, "Apps, Dashboards, and the Assistant"  
**Dimensions:** 1440 × 900  
**Page:** `/apps/catalog`

**State to capture:**
- Catalog grid showing at least 6 apps.
- **Vendor Tracker** card is in the first row, with the **Install** button visible (not yet installed).
- Search/filter bar empty.

**Notes:**
- If the Vendor Tracker card is below the fold, scroll the catalog so it sits in row 1.

---

## Shot 4 — `u1-dashboard-pinned.png`

**Where used:** Section 4  
**Dimensions:** 1440 × 900  
**Page:** Dashboard view mode after pinning Vendor Tracker.

**State to capture:**
- Dashboard in **view mode**.
- Vendor Tracker is pinned and rendering a populated table (the seed data).
- The dashboard tab shows a small **Home** indicator (star icon, "Home" badge — whatever the UI uses) confirming this is set as Home.
- Top bar shows tenant name "tenant-learn" or your subtenant.

**Notes:**
- Capture *after* the Vendor Tracker app has finished loading — no spinners.

---

## Shot 5 — `u1-profile-tenant.png`

**Where used:** Section 5, "Tenants"  
**Dimensions:** 1000 × 700 (Settings panel only, not full window)  
**Page:** `/settings/profile`

**State to capture:**
- Profile section visible: avatar, display name, email.
- **Tenant ID** row highlighted (the field showing `tenant-learn-<name>` or similar).
- The tenant ID is partially blurred (last 4 chars) if you're capturing against a real account — otherwise leave it.

**Notes:**
- Don't capture a real user's email. Use the seeded `learner@nexus.local` account.

---

## After capture

1. Save all 5 PNGs into `docs/certification/shots/`.
2. Optimize: `pngquant --quality 80-95 --ext .png --force docs/certification/shots/*.png`.
3. Commit alongside any text changes to `u1-nexus-101.md`.
4. Verify each `![alt](shots/...)` link in the lesson renders.

If the UI changes meaningfully between captures and the next U1 revision, re-shoot rather than patch — out-of-date screenshots erode trust in the lesson faster than missing ones.
