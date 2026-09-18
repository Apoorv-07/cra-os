# CRAOS — rescue audit, repairs and productionization

**Date:** 15–16 September 2026 (two passes)
**Scope:** whole repository, frontend and backend
**Method:** read every route and page, ran the stack, exercised the real flow
(register → upload → scan → findings → readiness → report → share) against a live
database, then fixed what broke.

---

## 1. How this audit was done

Reading code is not evidence that a product works, so every conclusion below
comes from one of three places:

1. **Running the stack** — API on 8787 with the worker in-process, web on 5173.
2. **Driving the real flow** with `curl`: register, upload an archive, wait for
   the worker, read findings, read readiness, generate a report, share it, fetch
   the public link unauthenticated.
3. **Comparing every frontend call against the backend response**, which is how
   the contract mismatches below were found.

Tests were then written to pin each repaired contract, so these failures cannot
return silently.

---

## 2. Gap matrix

| Area | State before | What was wrong | State now |
|---|---|---|---|
| **Overview** | Prototype | Four metric cards, no prioritisation. `totalFindings` computed with `reduce((sum, r) => sum, 0)` — always `0`. | Command centre: score + plain-English explanation, domain breakdown, "N things need attention" with an action on every item, recommended next steps. |
| **Navigation** | Inconsistent | "CRA readiness", "Credits"; no Findings or Reports | Eight-item IA: Overview, Repositories, Compliance, Findings, Evidence, Incidents, Reports, Billing, Settings. Admin separated. |
| **Compliance page** | **Broken** | The page read `detail.controls` and `detail.topActions`; the API returned `assessments`/`actions` keyed by control id → the page threw | Backend now serves the product shape: human titles, domain names, CRA references, weights, evidence, review state. Domains sorted worst-first. |
| **Findings** | Missing | Findings existed only inside repository detail, as raw CVE rows | Dedicated org-wide surface with prioritisation (`act_now` → `prioritise` → `monitor`), plain-language "why this matters", recommended action, triage workflow, and technical scores behind a disclosure. |
| **Findings API** | Missing | No org-wide endpoint | `GET /organizations/:orgId/findings` with filters + summary; `POST …/triage`; `GET …/findings/:id` returning evidence and related controls. |
| **Reports** | **Dead feature** | `reports` table existed in the schema with 0 readers and 0 writers | Full lifecycle: generate (readiness / findings / evidence pack), list, read as a *document*, share with a revocable token, delete. |
| **Share links** | **Dead feature** | `shareLinks` table had a public reader and no writer anywhere in the codebase — sharing was impossible | Share links are created, expire, are revoked, count views, and can be re-issued. Public view serves reports. |
| **Org readiness** | Contract mismatch | Returned `{score, repositories, totals, worst}` — no `grade`, no `domains`, no `assessments`; the frontend read `readiness.grade` and rendered nothing | Unified estate evaluation: grade, totals, domains, worst-status-per-control across the estate, top actions, inventory, attention list. |
| **Error handling** | Absent | No error boundary anywhere; one render error blanked the product | `ErrorBoundary` on every route, plus `ErrorState` (panel) and `PageError` (route). Technical detail is behind a disclosure, never shown cold. |
| **Uploads** | Dead end | A `.zip` was accepted, stored, charged, and failed 30 seconds later inside the worker with "not a valid gzip archive" | Magic-byte validation up front with an actionable message ("Create one with: tar -czf repo.tar.gz ."). |
| **Free tier economics** | Broken | Welcome credits (100) were less than the cost of one readiness report (100), so the core flow could not be completed without paying | Signup credits raised to 250; catalogue copy and pricing page updated to match. |
| **Plan seeding** | Stale | Seeds skipped existing rows, so plan copy could never be corrected after first release | Seeds now refresh catalogue *content* (name, features, limits) and never touch an admin-set price. |
| **Payment webhook** | Fragile | An unparseable payload returned 500, which triggers ~30 hours of retries | Verification and processing failures are logged, written to the audit trail, and acknowledged with 202. |
| **Status wording** | Jargon | "Gap", "Review", "Partial" | "Needs attention", "Needs confirmation", "Partially met" — the state of the obligation, not the enum. |
| **Compliance controls** | Id-first | Control ids sat in the reading flow next to the obligation | Ids moved into a collapsed disclosure; the reading flow carries title, status, reason and remediation. |

---

## 3. The unifying idea

The product now answers one question per screen, in this order:

| Screen | The question it answers |
|---|---|
| Overview | What is my current CRA compliance situation? |
| Repositories | What do I own, and what condition is it in? |
| Compliance | How compliant am I, and why does CRAOS think that? |
| Findings | What is wrong, and what do I do first? |
| Evidence | What proves the conclusion? |
| Incidents | What is on fire, and what is the clock? |
| Reports | What can I show an auditor, customer or board? |
| Settings / Billing | How do I run my account? |

Complexity is not deleted — it is moved below the fold. CVSS, EPSS, KEV, PURLs,
manifests, control ids and job state are all still there, one interaction away,
for the engineer who needs them.

---

## 4. Backend changes

**New files**

- `src/routes/findings.ts` — unified findings API. Priority is computed, not
  copied from severity: a known-exploited high-severity issue outranks a
  critical one nobody has been seen exploiting (`riskScore`). Every row carries
  a headline, a plain-language consequence, the recommended action, the CRA
  expectations it touches, and the technical detail nested underneath.
- `src/routes/reports.ts` — report generation, storage, listing, sharing and
  revocation. Reports are stored as **documents** (title, scope, sections,
  disclaimer), not as snapshots of a screen.
- `src/compliance/estate.ts` — estate-level aggregation. One rule everywhere:
  *an organisation is only as compliant as its weakest repository.* Also
  produces the Overview's attention list from real rows — KEV matches, overdue
  SLAs, control gaps, missing evidence, stale scans, failed scans.
- `src/core/crypto.ts` — `randomToken()` for capability URLs.

**Changed**

- `src/routes/compliance.ts` — repository readiness now returns the
  product-shaped control register; organisation readiness returns the estate
  evaluation plus attention.
- `src/routes/public.ts` — the public share endpoint serves reports.
- `src/routes/repositories.ts` — archive validation before charging.
- `src/routes/billing.ts` — webhook failures acknowledged, not retried for 30
  hours; plan content re-seeded without touching prices.
- `src/modules/billing/usage-rules.ts` — added `report.findings` (25 credits).
- `src/db/schema.ts` — `reports.kind` accepts `findings`.
- `src/app.ts` — mounted the findings and reports routers.

**No migration required.** The `reports` table already existed and SQLite stores
enums as `text`, so adding a value is a type-level change only. Nothing was
dropped, renamed or back-filled; existing data is untouched.

---

## 5. Frontend changes

- `src/App.tsx` — new IA, every route behind an `ErrorBoundary`, `/app/readiness`
  redirects to `/app/compliance` so old links keep working.
- `src/pages/Dashboard.tsx` — rewritten as the command centre.
- `src/pages/Findings.tsx` — new.
- `src/pages/Reports.tsx` — new, including a document renderer and a share panel.
- `src/components/errors.tsx` — new: boundary, panel error, page error.
- `src/components/layout.tsx` — eight-item navigation.
- `src/lib/queries.ts` — typed hooks for findings, reports, sharing, triage and
  estate readiness.
- `src/lib/format.ts` — human status labels.
- `src/pages/Readiness.tsx` — control ids demoted to technical detail.

---

### Second pass — the remaining screens

The first pass fixed the Overview, Compliance, Findings and Reports. The second
pass dealt with the rest:

- **Repository detail** rewritten. It was five stat cards over a tabbed table
  dump; it now reads: identity and one-line verdict → current health with an
  explainable score → "what needs attention in this repository" with an action
  on each item → findings / components / **CRA impact** / **evidence** / scan
  history. Raw enum values in the scan table became "Completed", "Code push",
  and so on.
- **Incidents** — the status map used two keys that do not exist in the state
  enum, so those badges rendered unstyled. Replaced with the real states and
  human labels ("Early warning drafted", "Final report filed"), and the three
  metric cards became a single strip that says how many clocks are overdue and
  why that matters.
- **Incident detail** — added the visible workflow
  (Detected → Triaging → Assessing → Early warning drafted → Notified → Final
  report filed) and human labels for report states.
- **Evidence** — reframed as the receipts behind the claims: an artefacts and
  coverage strip ("N of M CRA expectations now have supporting evidence"),
  control badges showing titles instead of `vuln.known_exploited`, and an error
  state.
- **Route-level code splitting** — every screen is now lazy-loaded. Initial
  JavaScript fell from 537 kB to ~330 kB (gzip 153 → 100 kB); the marketing
  pages no longer pay for the authenticated app.
- **Security hardening**: `requireOrg` preferred the `X-Organization-Id` header
  over the route parameter, so a URL for one organisation could answer with
  another's data (the caller's own). Not exploitable across tenants, but a
  trap. Header and URL must now agree or the request is refused.
- **End-to-end suite** (`tests/e2e/journey.test.ts`, 17 tests) covering the
  launch gate: register → empty posture → reject a bad archive → upload →
  charge → real worker scan → inventory + SBOM → prioritised findings →
  explainable compliance → evidence with checksum → report → share → public
  read → ledger integrity. Then the failure states: insufficient credits,
  cross-tenant reads, unknown routes, mismatched organisation context, admin
  routes.
- **Documentation**: [`.env.example`](../.env.example) with every variable
  explained, and [`DEPLOYMENT.md`](DEPLOYMENT.md) — what runs, first-time
  setup, database and backups, production topologies, health checks,
  integration order, test commands, troubleshooting, operator security notes.

## 6. Verification

| Check | Result |
|---|---|
| API typecheck | clean |
| Web typecheck | clean |
| Web production build | clean — 1.51 kB HTML / 60.01 kB CSS (11.92 gz) / largest JS chunk 280.61 kB (86.05 gz) |
| API test suite | **269 passed** across 15 files |
| Web test suite | **11 passed** across 2 files |
| End-to-end suite | **17 passed** — the full launch-gate journey plus failure states |
| Live flow | register → upload → scan → 47 findings → readiness 19/E → report → share → public read: all verified end-to-end |

New test files: `tests/integration/findings.test.ts` (19),
`tests/integration/reports.test.ts` (16),
`tests/integration/compliance.test.ts` (10),
`tests/integration/queue.test.ts` (19),
`tests/integration/github.test.ts` (11),
`tests/e2e/journey.test.ts` (17), and
`apps/web/src/__tests__/app.render.test.tsx` (6) for the authenticated
surfaces.

---

## 7. Known issues and what is still open

Stated plainly, because "production ready" means nothing if the caveats are
hidden.

1. **Visual QA has not been done in a browser.** Typecheck, build, render
   tests, API contracts and the end-to-end journey all pass, but nobody has
   looked at the rebuilt screens at 360 / 768 / 1440 / 2560 px. This is the
   single largest remaining risk and it needs a human pass.
2. **Billing, Settings, Admin and Onboarding** have not yet been rewritten for
   the attention-first hierarchy. They function and are integrated, but they
   read like the older generation of the product.
3. **The design system is still partly one-off.** `styles.css` is 128 lines of
   tokens; many components carry local class strings. The primitives in
   `ui.tsx` are good, but spacing, type and colour are not yet centrally
   governed.
4. **Documentation is complete** — architecture, schema, deployment, testing,
   production and launch checklists, sales assets, four CRA guides and the
   roadmap all live in `docs/`. What is left is external: publish the domain,
   submit the sitemap, and work the launch checklist.

---

## 8. Immediate next steps, in order

1. Browser pass on every screen at four widths; fix what looks wrong.
2. One live purchase, one real magic link, one backup restore — in that order.
3. Billing, Settings, Admin and Onboarding brought to the same standard.
4. Publish the domain, submit the sitemap, work the launch checklist.
