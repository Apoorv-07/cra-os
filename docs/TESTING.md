# CRA Compliance OS — test results and known issues

Numbers from the state of the repository at the time of writing. Re-run the
commands below to regenerate them; nothing here is asserted from memory.

---

## 1. Current status

| Check | Command | Result |
|---|---|---|
| API typecheck | `npm run typecheck` (api) | **clean** |
| Web typecheck | `npm run typecheck` (web) | **clean** |
| API lint | `npm run lint` (api, `--max-warnings 0`) | **clean** |
| Web lint | `npm run lint` (web, `--max-warnings 0`) | **clean** |
| API unit + integration | `npm run test` | **269 passed**, 15 files |
| API end-to-end | `npm run test:e2e` | **17 passed**, 1 file, ~14 s |
| Web render tests | `npm run test` (web) | **18 passed**, 3 files |
| Web build | `npm run build` | **clean** |
| Live smoke run | `./scripts/smoke.sh` | **31 passed, 0 failed** against a running server |

Total: **304 automated tests**, plus a shell smoke suite that exercises the
running system over HTTP.

---

## 2. What is actually tested

### Unit — pure logic, no I/O (`apps/api/tests/unit/`)

| File | Tests | Covers |
|---|---|---|
| `parsers.test.ts` | 26 | Every manifest parser: npm lockfiles, yarn, pnpm, requirements, poetry, pyproject, go.mod/go.sum, Cargo, pom.xml, Gradle coordinates, composer, NuGet, Gemfile, Dockerfile |
| `normalization.test.ts` | 25 | Component normalisation, dedupe, ecosystem mapping, scope and direct/transitive resolution |
| `purl.test.ts` | 19 | Package URL construction, version comparison, OSV ecosystem mapping |
| `scoring.test.ts` | 18 | Readiness scoring, grades, weighting, domain rollups, `N/A` handling |
| `ledger.test.ts` | 15 | Credit reserve/commit/release, idempotency keys, expiry, refunds, balance integrity |
| `permissions.test.ts` | 16 | RBAC matrix across owner/admin/member/viewer and cross-organisation access |
| `sbom.test.ts` | 17 | CycloneDX 1.6 serialisation, both JSON and XML, component counts, licence handling |
| `cvss.test.ts` | 11 | CVSS vector parsing and base-score computation across v2/v3/v4 |

### Integration — real database, real HTTP handlers (`apps/api/tests/integration/`)

| File | Tests | Covers |
|---|---|---|
| `api.test.ts` | 31 | Auth (signup/login/magic link/GitHub), organisations, members, invites, projects, repositories, uploads, API keys, pagination, error envelopes |
| `queue.test.ts` | 19 | Enqueue, claim, progress, retry with exponential backoff, dead-letter, requeue, cancellation, dedupe keys, stats |
| `findings.test.ts` | 19 | Finding prioritisation ordering (KEV → exploitability → severity → EPSS), filters, triage transitions, cross-tenant isolation |
| `reports.test.ts` | 16 | Report generation for each kind, credit charging, share links, revocation, deletion, public access |
| `payments.test.ts` | 16 | Dodo checkout session creation, **webhook signature verification** (valid, invalid, replay, out-of-order), credit grant idempotency, refunds |
| `github.test.ts` | 11 | GitHub App JWT, installation token exchange, webhook signature validation, push → scan enqueue, installation revocation |
| `compliance.test.ts` | 10 | The readiness contract: control id ≠ title, worst-first domain ordering, rationale presence, persisted review, outsider forbidden, empty-organisation `N/A` |

### End to end — the launch gate (`apps/api/tests/e2e/journey.test.ts`, 17 tests)

One journey, asserted in order, against a real database and the **real worker**:

1. Signup creates an organisation **and** grants welcome credits.
2. The posture of a brand-new account is honestly empty — not a demo dashboard.
3. A non-tar.gz upload is rejected (magic-byte validation works).
4. A valid archive uploads, **reserves credits** and enqueues a scan.
5. The scan runs through `runJobNow` — the same handler production uses.
6. Inventory and SBOM are produced with real component counts.
7. Findings are prioritised, not merely listed.
8. Readiness is explainable: score, grade, domains, controls, actions.
9. Evidence is stored with a checksum.
10. A report is generated, shared, and readable **unauthenticated**.
11. The credit ledger balances: sum of transactions equals account balance.

Then the failure states:

12. Insufficient credits → `402 insufficient_credits`.
13. Another organisation's repository → 404 (not 403 — no existence leak).
14. Unknown route → 404 with a structured error envelope.
15. `X-Organization-Id` header disagreeing with the URL → 403.
16. Admin routes closed to members.
17. Unauthenticated access → 401.

### Frontend (`apps/web/src/__tests__/`)

| File | Tests | Covers |
|---|---|---|
| `app.render.test.tsx` | 6 | Overview as a command centre, Findings triage, Reports list, Compliance as an explainable register, incident and repository surfaces render from stubbed API payloads |
| `marketing.render.test.tsx` | 5 | Home, Pricing, Legal, Onboarding and share-report pages render their claims and structure |
| `guides.render.test.tsx` | 7 | All four CRA guides mount with their heading, the "not legal advice" disclaimer and a single CTA; the index lists them; title, meta description and canonical are written for crawlers; an unknown slug redirects |

---

## 3. Running the suites

```bash
npm install                 # node_modules is not committed
npm run typecheck           # both workspaces
npm run lint                # eslint, zero warnings tolerated
npm run test                # API unit + integration (269)
npm run test:e2e            # API end-to-end journey (17)
npm run test --workspace @cra/web   # frontend render tests (11)
npm run build               # frontend, then API
```

Against a **running** server:

```bash
npm run dev                 # API + worker + web
./scripts/smoke.sh          # ~30 assertions over HTTP, exit 1 on any failure
```

The smoke script is the fastest way to prove a deployment is healthy: it signs
up, uploads, waits for a real scan, validates the SBOM is genuine CycloneDX 1.6,
checks CVSS and EPSS enrichment, walks the Article 14 clock, verifies the draft
carries the "not legal advice" label, asserts ledger integrity and confirms
tenant isolation.

Last run against a live server: **31 passed, 0 failed** — 11 components resolved,
92 vulnerability matches from OSV, CVSS on 60, EPSS on 91, readiness 26/E with
33 assessments each carrying a written rationale.

---

## 4. What is deliberately *not* faked

Stated plainly, because "tested" is easy to claim:

- **No mock scan.** The e2e suite executes the same `scan.repository` handler
  production runs; a real archive is extracted, parsed and matched.
- **No mock payment capture.** Tests verify webhook *signature* handling,
  idempotency and ledger effects. No test invents a successful charge.
- **No mock GitHub.** Webhook tests validate signatures and job enqueueing;
  token exchange is exercised against a stubbed transport, not a fake app.
- **No fake progress.** Progress assertions read the `jobs` row the worker wrote.
- **No seeded "demo data" in the product path.** The empty-state test asserts a
  new account sees an honest empty posture.

---

## 5. Known issues and open risks

Ordered by how much they should worry you.

1. **No human visual QA has been done in a browser.** Typecheck, lint, build,
   render tests, API contracts and the end-to-end journey all pass, but no one
   has looked at the rebuilt screens at 360 / 768 / 1440 / 2560 px. This is the
   largest remaining risk. It needs one deliberate pass before launch.
2. **Billing, Settings, Admin and Onboarding screens** are functional and
   integrated but have not been rewritten to the attention-first hierarchy used
   by Overview, Findings, Reports and Repository detail. They read like an older
   generation of the product.
3. **The design system is only partly centralised.** `styles.css` holds the
   tokens, but many components still carry local class strings. Spacing, type
   and colour are not yet governed in one place.
4. **Single-node only, in practice.** The worker can run out of process, but
   there is no horizontal scaling story tested. SQLite writes serialise; this is
   fine well past early revenue and must be revisited at real volume.
5. **No load testing.** Rate limits and worker concurrency are configured by
   reasoning, not measurement.
6. **Email delivery is unproven in production.** `MAIL_DRIVER=console` is
   verified; the Resend path is written against the documented API but has not
   sent a real message from a live deployment.
7. **Dodo Payments is verified against signature logic, not a live checkout** —
   no real card has been captured through a production webhook yet. Run one
   live purchase before announcing.
8. **Accessibility has not been audited.** Semantics, focus management and
   reduced-motion handling are implemented, but there has been no screen-reader
   pass or automated axe run.
9. **KEV sync depends on an external feed** that rate-limits some networks. The
   mirror URL is configurable and the sync job records failures in
   `intel_sources`; a prolonged outage degrades KEV freshness, not correctness.
10. **No automated dependency vulnerability gating in CI yet** — `npm audit`
    runs, but the pipeline does not fail on advisories.

---

## 6. Regression discipline

New behaviour gets a test in the same change. The suites that exist because of a
specific bug are:

- `compliance.test.ts` — written after the readiness endpoint returned raw
  control ids where titles were expected.
- `findings.test.ts` — written after severity-only ordering ranked a
  non-exploited critical above a confirmed-exploited high.
- The org-mismatch case in `journey.test.ts` — written after `requireOrg`
  preferred the header over the URL.
- `payments.test.ts` webhook cases — written to pin signature verification
  before any money-handling code was trusted.
