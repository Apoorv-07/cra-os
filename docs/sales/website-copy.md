# Website and in-product copy

Ready to paste. Anything in `[square brackets]` is a placeholder that needs a
real value before publishing — do not ship invented numbers or testimonials.

---

## Homepage

### Hero

> ## Your product ships to the EU. Prove it's ready.
>
> Connect a repository and get a real SBOM, real vulnerabilities from OSV, KEV
> and EPSS, and a Cyber Resilience Act readiness score with reasons — in
> minutes. Pay per scan. No annual contract, no sales call.
>
> **[ Connect your repository — free ]**  **[ See a sample report ]**
>
> 250 free credits. No card required.

### The deadline strip

> **11 September 2026.** Under Article 14, an actively exploited vulnerability
> starts a 24-hour clock: early warning within 24 hours, notification within 72,
> final report within 14 days of a fix becoming available. It applies to products
> **already on the market**. Penalties reach €15M or 2.5% of worldwide turnover.

### How it works

> **1. Connect.** Install the GitHub App or run the Action in CI. We read your
> lockfiles — nothing else. Your code is never executed.
>
> **2. Scan.** We build a CycloneDX SBOM, match every component against OSV,
> GitHub Advisory, CISA KEV and EPSS, and prioritise by what is actually being
> exploited.
>
> **3. Act.** Get a readiness score across 35 controls in 8 domains — each with
> a plain-English reason and a next step. Export the evidence. Answer the
> questionnaire.

### Proof block

> **What you get**
>
> - A CycloneDX 1.6 SBOM you can download and hand to a customer.
> - Findings ranked by exploitation, not by CVSS theatre.
> - 35 CRA controls, each with a status and a written rationale.
> - An evidence vault with checksums and timestamps — receipts, not claims.
> - Article 14 draft reports when the clock starts.
> - A readiness badge for your README.

### Objection block

> **"We already run Dependabot."**
> Dependabot tells you a dependency is vulnerable. It doesn't tell you what your
> product contains, whether you can answer a CRA obligation, or what to submit
> to a regulator in 24 hours.
>
> **"We're not sure we're in scope."**
> If you place a product with digital elements on the EU market, you are. The
> question is whether you can prove your posture on demand.
>
> **"Is this legal advice?"**
> No. We produce engineering evidence and drafts from your scan data. Your
> team — and your counsel — decide what to file.

### FAQ

> **What does a scan cost?** Credits, per scan. Start with 250 free; buy packs
> as you go, or subscribe for included credits. Prices are on the pricing page —
> no "contact sales".
>
> **Do you execute our code?** No. We read manifests and lockfiles. Nothing in
> your repository is run.
>
> **Which ecosystems?** npm, Python, Go, Rust, Java (Maven/Gradle), PHP, .NET,
> Ruby, and container base images.
>
> **What if we don't use GitHub?** Upload a source archive (`.tar.gz`) instead.
> Same pipeline.
>
> **Do you store our source?** We store the SBOM, findings and evidence
> artefacts — not your repository.
>
> **Can we share results with a customer?** Yes — read-only share links and
> public badges, revocable at any time.

### Footer

> Product · Pricing · Guides · GitHub Action · Security · Privacy · Terms ·
> DPA · Subprocessors · Contact

---

## Pricing page

### Header

> ## Pay for scans, not for seats.
>
> Start free. Buy credits when you need them. Add a plan when you want
> predictable spend.

### Plans (copy only — prices come from the live catalogue)

> **Free**
> 250 credits on signup. Connect a repository, run a few scans, generate one
> readiness report. No card required.
> *For finding out whether this is useful.*
>
> **Pay as you go**
> Credit packs, no expiry pressure, optional auto top-up so monitoring never
> stops mid-incident.
> *For teams that scan when they ship.*
>
> **Team**
> Monthly credits included, all repositories, role-based access, evidence vault,
> API keys, priority scans.
> *For teams that need to answer a customer this quarter.*
>
> **Agency**
> One workspace, many customer projects, pooled credits, per-customer reports.
> *For agencies that resell readiness to their clients.*

### Credit table

Defaults as shipped. Every number is editable in the admin console with no
deploy, so these are starting points, not commitments.

| Action | Credits |
|---|---|
| Repository scan | 10 |
| Deep vulnerability scan | 25 |
| SBOM generation | 5 |
| CRA readiness report | 100 |
| Findings report | 25 |
| Evidence pack | 50 |
| Article 14 draft set (all three stages) | 200 |
| Single Article 14 report | 80 |
| AI explanation | 3 |
| Evidence classification | 2 |

> An unchanged repository is never charged — we fingerprint the resolved
> inventory and release the reservation. A failed scan releases its reservation
> too.

### Packs and plans as shipped

| Pack | Credits | Price |
|---|---|---|
| Starter | 1,000 | $29 |
| Growth | 5,000 | $99 |
| Business | 20,000 | $299 |
| Scale | 60,000 | $799 |

| Plan | Included credits | Price / month |
|---|---|---|
| Free | 250 | $0 |
| Developer | 500 | $49 |
| Startup | 2,500 | $199 |
| Growth | 12,000 | $799 |
| Enterprise | 40,000 | $1,999 |

Change any of these from the admin console before launch — they are seed
defaults, not a pricing decision.

### Pricing FAQ

> **What happens when I run out?** Work stops with a clear
> `insufficient credits` message and the price of what you tried. Nothing is
> charged twice, and nothing is charged for a failed scan.
> **Do credits expire?** [state your policy plainly].
> **Can we get an invoice / VAT treatment?** [state].
> **Do you offer refunds?** [state].

---

## Onboarding

### Step 1 — Create your account

> **Start with 250 free credits.**
> Enough to connect a repository, run a few scans and generate one readiness
> report. No card required.
> `[ Email ]` `[ Password ]` → **Create account**

### Step 2 — Name the organisation

> **What should we call your organisation?**
> This is the name that appears on reports and share links. You can change it
> later.

### Step 3 — Connect a repository

> **Connect your code**
>
> - **[ Install the GitHub App ]** — recommended. Scans trigger on every push.
> - **[ Upload a source archive ]** — `.tar.gz` of your repository root.
> - **[ Add the GitHub Action ]** — run scans in your own CI.
>
> We read manifests and lockfiles. We never execute your code.

### Step 4 — First scan

> **Scanning…**
> Fetching source → reading manifests → resolving components → matching
> advisories → evaluating controls. This is real work; it takes about as long as
> a CI run.

### Step 5 — Result

> **You're at [score]/100 — grade [X].**
> Here is what's driving it, and the three things that would move it most.
> `[ Open the report ]` `[ Export evidence pack ]` `[ Add a badge ]`

### Empty states

> **No repositories yet.** Connect one and your first scan takes about a minute.
>
> **No findings.** Either nothing matched, or no scan has completed yet. Check
> the scan history.
>
> **No evidence yet.** Evidence is created automatically by scans, and you can
> upload policies and runbooks yourself.

---

## Microcopy rules

- Say what happened in plain words: "Completed", "Failed", "Queued", "Code
  push" — not enum values.
- Every status gets a reason, and every reason gets a next action.
- Never say "compliant". Say "readiness", "posture", "evidence".
- Every AI-assisted text carries its sources and is labelled a draft.
- Reports always carry: *Draft — engineering evidence, not legal advice.*
