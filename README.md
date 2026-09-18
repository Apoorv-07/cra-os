# CRA Compliance OS

**Continuous EU Cyber Resilience Act compliance for software products.**

Connect a repository. Get a real SBOM, real vulnerability intelligence, an
explainable CRA readiness score, an evidence vault with receipts, and Article 14
incident drafts — metered with prepaid credits.

```
signup → connect repo → scan → SBOM → vulnerabilities → readiness → evidence →
        → Article 14 draft → buy credits → usage deducted → deployed
```

That flow is the launch gate, and it works end to end against real infrastructure.

---

## Quick start

```bash
git clone <repo> && cd cra-compliance-os
npm install

cp .env.example .env
# fill SESSION_SECRET and ENCRYPTION_KEY:
openssl rand -hex 32

npm run db:migrate
npm run dev            # API :8787, worker, web :5173
```

Open http://localhost:5173. Sign up, connect a repository by uploading a
`.tar.gz` (or install a GitHub App), and watch a real scan run.

Production deployment: [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md).

---

## What it does

| Capability | Detail |
|---|---|
| **SBOM** | CycloneDX 1.6 (JSON + XML) from npm, Python, Go, Rust, Java, PHP, .NET, Ruby and Docker base images |
| **Vulnerability intelligence** | OSV + GitHub Advisory matching, CISA KEV, EPSS, CVSS computed from the vector. Deduped, cached, retried with backoff |
| **CRA readiness** | 35 controls across 8 domains, each with a status, a written rationale, evidence and a next action. Grades A–E, domains worst-first |
| **Article 14** | 24-hour early warning, 72-hour notification, final report within 14 days of a corrective measure becoming available — drafted from real scan data, editable, approvable, exportable, with a full audit trail |
| **Evidence vault** | Append-only artefacts with sha256 checksums, timestamps and an exportable Evidence Pack |
| **Credits** | Durable ledger: reserve → commit/release, idempotent payment webhooks, auto top-up, refunds, promos, referrals |
| **Admin console** | Users, orgs, jobs, DLQ, credits, revenue, live pricing edits, feature flags, funnel |
| **API** | Versioned `/api/v1`, OpenAPI at `/api/v1/openapi.json`, API keys, pagination, idempotency, rate limits |
| **Distribution** | GitHub Action, public readiness badges, read-only share links, referral bonuses, four long-form CRA guides at `/guides/*` |

AI is used only to summarise, draft and classify data the platform already
holds. It never assigns a compliance status, and every output stores its
sources. With `AI_PROVIDER=none` the product is complete.

**This is engineering evidence, not legal advice.** Generated reports say so
themselves, and that sentence is asserted by the test suite.

---

## Repository layout

```
apps/api/     Hono API, worker, domain modules, SQLite schema (46 tables)
apps/web/     React 19 SPA, 20 route-split screens, 4 long-form CRA guides
action/       GitHub Action (Node 20 built-ins, zero dependencies)
drizzle/      Generated SQL migrations
infra/        Docker, systemd, backup, reverse proxy, Cloudflare blueprint
scripts/      smoke.sh — end-to-end HTTP verification
docs/         Architecture, schema, deployment, testing, checklists, sales, roadmap
```

## Commands

```bash
npm run dev        # API + worker + web
npm run build      # web, then API
npm run typecheck  # both workspaces
npm run lint       # eslint, zero warnings tolerated
npm run test       # 269 unit + integration tests
npm run test:e2e   # 17-test launch-gate journey
npm run db:migrate # apply migrations
npm run db:seed    # idempotent reference data
./scripts/smoke.sh # verify a running deployment over HTTP
```

---

## Documentation

| Document | What it covers |
|---|---|
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | System diagram, request lifecycle, scan pipeline, design decisions and trade-offs, scaling path |
| [`docs/SCHEMA.md`](docs/SCHEMA.md) | All 46 tables, invariants, enums, migration and seeding policy, retention |
| [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) | What runs, first-time setup, database and backups, production topologies, health checks, troubleshooting |
| [`docs/TESTING.md`](docs/TESTING.md) | Test results (269 + 17 + 11), what is covered, what is deliberately not faked, known issues |
| [`docs/PRODUCTION-CHECKLIST.md`](docs/PRODUCTION-CHECKLIST.md) | Operator checklist: host, secrets, security, integrations, verification, launch day |
| [`docs/LAUNCH-CHECKLIST.md`](docs/LAUNCH-CHECKLIST.md) | Founder checklist: positioning, pricing, distribution, first ten customers |
| [`docs/ROADMAP.md`](docs/ROADMAP.md) | Post-launch phases and the explicit "not planned" list |
| [`docs/RESCUE-AUDIT.md`](docs/RESCUE-AUDIT.md) | Gap analysis and the rebuild record |
| [`docs/FRONTEND-TRANSFORMATION.md`](docs/FRONTEND-TRANSFORMATION.md) | Frontend scope, constraints and design language |
| [`docs/sales/`](docs/sales/) | Positioning, website copy, outreach templates |
| [`action/README.md`](action/README.md) | GitHub Action documentation |
| [`.env.example`](.env.example) | Every environment variable, explained |

---

## Status

Working and verified:

- Real scans against real repositories, through the same worker production uses.
- Real SBOM output validated as CycloneDX 1.6.
- Real payment webhook signature handling and a ledger whose balance always
  equals the sum of its transactions.
- Real tenant isolation, RBAC, rate limiting, CSRF and audit logging.
- 304 automated tests, lint/typecheck/build clean.

Not yet done, stated plainly:

- No human visual QA pass at multiple viewport widths.
- Billing, Settings, Admin and Onboarding screens are functional but not yet
  redesigned to the current standard.
- No live card has been captured through a production webhook.
- No accessibility audit.
- Single-node deployment is the tested configuration.

See §5 of [`docs/TESTING.md`](docs/TESTING.md) for the full list.

---

## Licence and contact

Set your licence here before publishing. Security reports:
`security@[your-domain]`.
