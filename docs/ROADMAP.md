# Roadmap

What comes next, in the order it should be done, and why. The rule that orders
everything: **revenue-producing work beats architectural work until the
architectural work is the thing blocking revenue.**

---

## Status today

The launch gate is complete end to end: signup → GitHub connect → repository
select → real scan → real SBOM → real vulnerabilities → CRA readiness →
evidence → Article 14 draft → credit purchase → usage deduction → production
deploy. 297 automated tests pass; lint, typecheck and build are clean.

What is *not* finished is polish and proof: no human visual QA pass, four
screens still on the older design generation, and no live money captured yet.

---

## Phase 0 — Before announcing anything (days 0–7)

Sequenced so that each item removes launch-blocking risk.

1. **One live purchase, end to end.** Real card, real webhook, credits land in
   the ledger. Nothing else on this list matters as much.
2. **One real magic link** from the production deployment.
3. **One backup restore** onto a scratch host.
4. **Visual QA at 360 / 768 / 1440 / 2560 px** across every screen. Fix what
   looks wrong. This is the single largest known risk.
5. **Accessibility pass**: keyboard navigation, focus visibility, contrast,
   one screen-reader run on the core flow.
6. **Billing, Settings, Admin, Onboarding** brought to the attention-first
   standard the rest of the app now uses.
7. **Publish the GitHub Action** to the Marketplace with the README in
   `action/README.md`.
8. **Publish the sample report** — one real, shareable readiness report that
   every piece of outreach links to.

**Exit criteria:** a stranger can find the site, sign up, scan a repository,
buy credits and share a report without contacting you.

---

## Phase 1 — Acquisition loops (weeks 2–8)

The goal is engineers arriving without being sold to.

- **GitHub Action maturity**: PR annotations inline (not just a summary
  comment), badge in the workflow summary, zero-config mode for public repos.
- **Public readiness badges** promoted hard: a README badge is a permanent ad.
- **Sample report gallery**: three real reports across ecosystems, public.
- [x] **SEO pages for high-intent queries** — four guides live at `/guides/*`
  (readiness checklist, SBOM requirements, Article 14 reporting, plain-English
  CRA overview), plus `robots.txt` and `sitemap.xml`. Remaining work here is
  **off-page**: publish the domain, submit the sitemap, and extend the set with
  the next queries — "CRA Annex I Part II explained", "CRA conformity assessment
  routes", "CRA for open source maintainers".
- **Free single-repository scan without signup** — email the report. Highest
  conversion surface available and it costs one scan's worth of compute.
- **Content**: the Article 14 walkthrough article, published and posted where
  the deadline is already being discussed.

**Metric:** signups per week, and the percentage that complete a first scan.

---

## Phase 2 — Retention: make monitoring the habit (weeks 6–16)

Acquisition without retention is a leaky bucket.

- **Scheduled monitoring** surfaced properly: posture drift over time, "three
  new exploited vulnerabilities since last week" digests.
- **Diff-aware scanning**: what changed between two scans, not just the current
  state.
- **Notifications that people want**: weekly digest, alert only on KEV or a new
  critical, Slack and email delivery.
- **Auto top-up** made the default at checkout — the difference between a
  one-off buyer and a recurring one.
- **Remediation guidance that engineers act on**: fixed version, upgrade path,
  whether a fix is available at all.
- **Pull request integration**: open a PR that bumps the vulnerable dependency.

**Metric:** accounts with ≥ 1 scan per week; auto top-up attach rate.

---

## Phase 3 — Expansion: from one engineer to one company (months 4–9)

This is where $100k MRR comes from — not from more one-off scans.

- **Portfolio view**: readiness across all products, compared, with a
  worst-first ordering. This is the screen a CTO pays for.
- **Organisation features**: SSO (SAML/OIDC), SCIM provisioning, audit log
  export, granular roles, per-project access.
- **Agency/B2B2B workspaces**: customer projects under one account, pooled
  credits, white-labelled reports, per-customer billing export.
- **Enterprise override**: custom contracts, invoicing, custom data residency,
  dedicated support SLAs, volume pricing negotiated and applied via the admin
  console without a deploy.
- **API and integrations**: webhooks are already there — add Jira, Linear,
  Slack and ServiceNow connectors so findings land where engineers work.
- **Terraform provider** for managing repositories and projects as code.

**Metric:** revenue per account, seats per account, number of accounts above
[your expansion threshold].

---

## Phase 4 — Depth of the compliance engine (months 6–18)

The moat is that the engine knows more about CRA than a generic scanner.

- **Full Annex I coverage** with per-control evidence requirements and
  remediation templates, kept current as guidance lands.
- **Attested controls workflow**: assign an owner, attach evidence, set a review
  cadence, show evidence freshness ("this policy was last reviewed 14 months
  ago").
- **Machine-readable export** for the EU's reporting formats as they are
  finalised — being early here is a genuine differentiator.
- **Support period tracking** against declared product support windows (a CRA
  obligation most tools ignore entirely).
- **Supply-chain depth**: transitive risk, maintainer signals, licence
  obligations, container image layers, IaC misconfiguration.
- **Multi-framework mapping**: one evidence set mapped to CRA, NIS2, DORA and
  ISO 27001 controls — the same work reused, which is the expansion story.

---

## Phase 5 — Platform work, when revenue demands it (months 9+)

Deliberately last. Trigger-based, not calendar-based.

| Trigger | Work |
|---|---|
| Write contention or backup windows hurt | Postgres migration (Drizzle makes this mechanical) |
| One node can't keep up with scan volume | Horizontal worker scaling, per-tenant queues |
| EU customers demand EU data residency | Region-pinned deployment + Cloudflare port (D1/R2/Queues bindings already specified in `infra/cloudflare/`) |
| Enterprise asks for self-hosting | Single-tenant image + licence model |
| Scan latency becomes a sales objection | Incremental scanning (only re-parse changed manifests) |

---

## Explicitly not planned

Saying no on purpose:

- **A consultancy arm.** Manual per-customer servicing breaks the economics of a
  solo-built, automated product.
- **Certification claims.** We will never say "CRA certified".
- **Legal advice features.** Drafts, evidence and explanation only.
- **A generic SBOM generator.** Covered, but it is not the product.
- **An AI chatbot.** AI summarises and drafts from real data with cited sources;
  it does not answer compliance questions from model knowledge.
- **Per-seat pricing.** Credits align price with value delivered.
- **Mobile apps.** Responsive web is enough.
- **Multi-cloud from day one.** One correct deployment beats three aspirational
  ones.

---

## How to decide what's next

In order, every time:

1. Does it block someone from paying?
2. Does it stop a paying customer from leaving?
3. Does it bring in a stranger who hasn't heard of us?
4. Does it make the product cheaper or faster to run?
5. Is it architecturally interesting?

If the honest answer is 4 or 5, it waits.
