# CRA Compliance OS — data model and migrations

46 tables, one migration, one file. This document explains what each table is
for, the invariants that must hold, and how migrations are handled.

Source of truth: `apps/api/src/db/schema.ts` (Drizzle, SQLite dialect).
Generated SQL: `drizzle/0000_init.sql` (46 `CREATE TABLE`, 97 indexes).

---

## 1. Conventions

**Every table** uses a text primary key (`id`) with a typed prefix — `usr_`,
`org_`, `scan_`, `repo_`, `job_`, `rpt_`, `inc_`, `evd_`, `txn_` — minted by
`core/ids.ts`. Prefixes are checked at compile time, so an id cannot be
accidentally constructed for the wrong entity.

**Timestamps** are integer epoch **milliseconds UTC**, defaulting to
`(unixepoch() * 1000)`. Nothing in the database is stored in local time;
timezone is a presentation concern only (`users.timezone`).

**Enums** are `text` columns constrained at the application layer by Zod and
TypeScript. SQLite has no native enum, which is deliberate: adding a state to a
workflow is a code change, not a migration.

**Soft deletes** exist where a customer may expect recovery (`users`,
`organizations`, `projects`, `repositories`) via `deleted_at`. Queries filter on
it explicitly.

**JSON columns** are suffixed `Json` and hold small, bounded structures. They
are used where the shape is genuinely variable (raw provider payloads, provider
metadata), never where a join is needed.

---

## 2. Identity and access

| Table | Purpose |
|---|---|
| `users` | Email, password hash (scrypt), verification, `is_system_admin`, preferred timezone and locale |
| `identities` | Linked OAuth accounts (GitHub). `access_token_enc` / `refresh_token_enc` are **AES-256-GCM encrypted** with `ENCRYPTION_KEY` and never leave the server |
| `sessions` | Session token stored as a hash; IP, user agent, expiry, revocation |
| `magic_links` | Single-use passwordless tokens, hashed, with expiry and consumption time |
| `organizations` | The tenant. Plan, currency, retention, agency flag, auto top-up settings, optional `parent_org_id` for agency → customer hierarchies |
| `organization_members` | `(org_id, user_id)` with role: `owner` / `admin` / `member` / `viewer` |
| `invites` | Hashed invitation tokens with role and expiry |

**Invariant:** an authenticated request carries exactly one organisation
context. `requireOrg()` verifies membership, and the header and URL must agree.

---

## 3. Source control

| Table | Purpose |
|---|---|
| `integrations` | GitHub App installations per organisation (installation id, account login, permissions, revocation) |
| `projects` | Optional grouping of repositories into a "product" — carries product name, version and `support_period_months`, which several CRA controls depend on |
| `repositories` | A connected repo: provider ids, default branch, monitoring schedule, badge token, last scan, and **denormalised posture** (`readiness_score`, `open_critical`, `open_high`, `open_kev`, `status`, `last_error`) so list views never recompute |
| `scans` | One execution. Trigger, ref, commit sha, status, fingerprint, counters by severity, KEV count, readiness score, duration, progress, `credits_charged`, error code/message |

**Invariant:** `scans.fingerprint` is a hash of the resolved inventory. An
identical fingerprint means the repository has not changed, and the credit
reservation is released rather than charged.

---

## 4. Inventory, SBOM and vulnerability intelligence

| Table | Purpose |
|---|---|
| `components` | The normalised component: name, version, ecosystem, `purl`, group, licences, scope, manifest path, direct/transitive |
| `dependencies` | Edges of the dependency graph (`from_component_id` → `to_component_id`) with a type |
| `sboms` | Generated documents: format, CycloneDX spec version, serial number, storage key, size, **sha256**, component count |
| `vulnerabilities` | Global (tenant-independent) advisory cache: source and source id, aliases, summary, severity, CVSS score/vector/version, EPSS score and percentile, KEV flag and dates, exploit maturity, weaknesses, affected ranges, fixed versions, raw payload |
| `component_vulnerabilities` | The **finding**: a vulnerability as it applies to one component in one scan. Carries triage `state` (`open` / `fixed` / `ignored` / `risk_accepted`), `exploitability`, `exposure`, remediation, `sla_due_at`, rationale, assignment, resolution |
| `intel_sources` | Per-feed sync bookkeeping: last run, last success, last error, item count |
| `kev_entries` | Local mirror of the CISA KEV catalogue (CVE id primary key) so KEV lookups never depend on a live call |

**Invariants:**
- `vulnerabilities` is unique per `(source, source_id)` and shared across
  tenants — it is a cache of public data, not customer data.
- `component_vulnerabilities` is unique per `(scan_id, component_id,
  vulnerability_id)`, which is what makes re-scanning idempotent.
- An SBOM's `sha256` is computed over the exact stored bytes; re-downloading and
  re-hashing is how evidence is verified.

---

## 5. Compliance

| Table | Purpose |
|---|---|
| `compliance_controls` | The catalogue (35 controls): domain, title, description, `legal_ref` (e.g. `Annex I Part II(1)`, `Art. 14(2)`), obligation, weight, accepted evidence types, applicability rule, remediation, evaluation mode (`automated` / `attested` / `hybrid`) |
| `compliance_assessments` | The evaluation of one control for one repository: `status` (`passed` / `partial` / `missing` / `not_applicable` / `needs_review`), 0..1 `score`, `confidence`, **`rationale`** (the written "why"), evidence references, remediation, owner, review metadata |
| `evidence` | The vault: type, title, storage key, file name, mime, size, **sha256**, source, linked control ids, confidence, version chain (`previous_evidence_id`), retention, and a monotonic per-organisation `seq` |

**Invariants:**
- Unique on `(org_id, repository_id, control_id)` — one current assessment per
  control per repository.
- **Evidence rows are never updated after insert.** Corrections create a new
  version linked to the previous one. This is what makes the vault auditable.
- Every assessment carries a `rationale`. A score without a reason is treated
  as a bug, and the smoke test asserts that rationales are present.

Domains (8): Component transparency, Vulnerability handling, Incident
reporting, Secure development, Update & support, Documentation, Security
properties, Governance.

Grading: ≥ 90 A, ≥ 75 B, ≥ 60 C, ≥ 40 D, else E. An organisation with no
repositories scores `N/A` rather than 0 — "no data" is not "non-compliant".

---

## 6. Incidents (Article 14)

| Table | Purpose |
|---|---|
| `incidents` | The case: linked finding, title, `state`, severity, `awareness_at` (the clock origin), `detected_at`, and the computed `early_warning_due_at` (24 h) and `notification_due_at` (72 h). `final_report_due_at` stays `null` until a corrective measure is recorded, because the 14-day clock runs from the availability of that measure, not from awareness |
| `incident_events` | Append-only timeline: created, state changed, draft generated, edited, approved, exported, note, closed — with actor and payload |
| `incident_reports` | One document per stage (`early_warning` / `notification` / `final`): markdown body, status (`draft` / `in_review` / `approved` / `exported`), `generated_by` (`template` / `ai` / `manual`), **`sources_json`**, model and confidence, approval and export metadata |

**Invariant:** unique on `(incident_id, stage)`. Editing a draft updates the
same row and appends an event; nothing is silently overwritten without a trace.

---

## 7. Reports and sharing

| Table | Purpose |
|---|---|
| `reports` | Generated documents (`readiness`, `findings`, `evidence_pack`, `incident`, `sbom_summary`) with content, storage key, share token and expiry, credits charged |
| `share_links` | Read-only public links for any resource: token, expiry, revocation, view count, last viewed |

Public reads (`/share/:token`, `/badge/:token`) are unauthenticated and return
only the report and its supporting evidence. They never expose billing,
settings or unfiltered vulnerability detail.

---

## 8. Billing

| Table | Purpose |
|---|---|
| `credit_accounts` | One per organisation: `balance`, lifetime purchased/granted/consumed, currency, and a **`revision`** counter incremented on every write |
| `credit_transactions` | Append-only ledger: `type` (`purchase`, `grant`, `promo`, `bonus`, `referral`, `reservation`, `commit`, `release`, `refund`, `expiry`, `adjustment`), **signed `amount`**, `balance_after`, reference, expiry, actor, and a unique **`idempotency_key`** |
| `usage_events` | What was metered: action, quantity, credits, status, resource, and the reservation/commit transaction ids |
| `payments` | Provider records: provider, payment id, checkout id, customer id, amount, currency, pack, credits granted, receipt URL, failure reason, raw payload |
| `subscriptions` | Optional recurring plans: plan key, status, period end, cancellation flag, seats |
| `credit_packs` | Admin-editable prepaid packs (credits, price, bonus, currency, provider product id, popularity, ordering) |
| `plans` | Admin-editable subscription plans: interval, price, included credits, repo and seat limits, features |
| `usage_rules` | Admin-editable price per action (scan, SBOM, report, draft …) — keyed by action, so prices change without a deploy |
| `coupons` | Percentage off, bonus credits, redemption caps, expiry |
| `referrals` | Referral codes, referred organisation, reward credits, conversion |

**The invariants that matter:**

1. `credit_accounts.balance` **equals the arithmetic sum** of
   `credit_transactions.amount`. Asserted by `GET /organizations/:orgId/billing/integrity`
   and by the test suite.
2. Every ledger row records `balance_after`, so the balance can be reconstructed
   and audited at any historical point.
3. `idempotency_key` is uniquely indexed. A replayed webhook or a retried request
   cannot double-apply.
4. Credits are **reserved before billable work and settled after**. Work that
   fails or that finds an unchanged repository releases the reservation.
5. Pricing tables (`credit_packs`, `plans`, `usage_rules`) are read at request
   time. Admin changes take effect immediately with no restart, and the seed
   script never overwrites an admin-edited price.

Payment providers are interchangeable behind `modules/billing/providers/`; with
`PAYMENT_PROVIDER=manual` no money moves and credits are granted by an admin —
a real operating mode, not a stub.

---

## 9. Platform

| Table | Purpose |
|---|---|
| `jobs` | Queue: type, payload, status, attempts, max attempts, dedupe key, `run_at`, timings, progress pct/message, last error, result |
| `job_events` | Job timeline for live status and post-mortems |
| `api_keys` | Hashed keys with prefix, scopes, last used, expiry, revocation |
| `webhooks` / `webhook_deliveries` | Outbound customer webhooks: URL, encrypted secret, event filters, delivery attempts, response status, errors |
| `notifications` | In-app notifications per organisation and user |
| `audit_logs` | Security-relevant actions: actor, type, action, target, metadata, IP, user agent |
| `system_events` | Operator-visible system problems with level and source |
| `feature_flags` | Key-based flags with rollout percentage and JSON value |
| `analytics_events` | Product funnel instrumentation (anonymous id, session, name, properties, path, referrer) |
| `coupons`, `referrals`, `share_links` | Distribution loops |

---

## 10. Migrations

- **One migration file:** `drizzle/0000_init.sql`, tracked by
  `drizzle/meta/_journal.json` and applied by Drizzle's migrator into
  `__drizzle_migrations`.
- **Applied automatically at boot**, before the server accepts a request. The
  process is either fully migrated or not listening — there is no half-deployed
  state.
- **Also runnable on demand:** `npm run db:migrate`.
- **Generating a new one:** edit `apps/api/src/db/schema.ts`, then
  `npm run db:generate`. Drizzle writes the next numbered migration; commit it.
- **Rules for this project's migrations:** additive and forward-only. Add
  columns with defaults, add tables, add indexes. Never drop or rewrite a column
  in place — add the new one, backfill, then remove the old one in a later
  release once no running instance reads it.
- **Enum widening is not a migration.** Because enums are application-level
  `text`, adding a state requires no SQL.

### Seeding

`npm run db:seed` (also runs at boot) is idempotent:

- Inserts the CRA control catalogue (35 controls) — matched by id, refreshed.
- Inserts default pricing (packs, plans, usage rules) — **matched by key; an
  admin-edited price is never overwritten**.
- Inserts feature flags and the KEV sync job if absent.

---

## 11. Retention and deletion

- `organizations.retention_days` (default set per plan) drives `evidence.retention_until`
  and the `billing.expire_credits` job.
- Deleting an organisation cascades: members, projects, repositories, scans,
  components, findings, assessments, evidence, reports, incidents, credits, API
  keys, webhooks, jobs and share links. Foreign keys are declared with
  `onDelete: 'cascade'` so there are no orphans.
- `users.deleted_at` soft-deletes the account; session and magic-link rows are
  invalidated at that point.
- Export is available at the object level: SBOMs, reports and evidence are all
  downloadable, and the Evidence Pack bundles them with a manifest of checksums.
