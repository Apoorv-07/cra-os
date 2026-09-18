# Positioning

The short document that decides what we say no to.

---

## One-liner

**Connect your repository. Get an SBOM, real vulnerabilities and an EU Cyber
Resilience Act readiness score you can show a customer — pay per scan, no annual
contract, no sales call.**

## The buyer

- **Primary:** CTO, VP Engineering, Head of Platform, or technical founder at a
  5–200 person software company that sells into the EU.
- **Secondary:** the same person at a digital agency, on behalf of their
  customers' products (B2B2B).
- **Champion:** a senior engineer or security-minded lead who has just been
  asked "are we CRA-ready?" and has no good answer.

They are **not** a CISO at a 5,000-person enterprise with a GRC team, and they
do not want to become one.

## The moment that creates the pain

Article 14 of the EU Cyber Resilience Act applies from **11 September 2026**.
Manufacturers of products with digital elements must report:

| Obligation | Clock | To whom |
|---|---|---|
| Early warning of an actively exploited vulnerability | **24 hours** from becoming aware | CSIRT coordinator + ENISA (via the Single Reporting Platform) |
| Vulnerability notification | **72 hours** | Same submission, then users |
| Final report | **14 days after a corrective or mitigating measure is available** | CSIRT + ENISA + users |
| Severe incident | **72 hours** for the notification, **final report within 1 month** | CSIRT + ENISA |

Two details most summaries get wrong, and that the product gets right: the
14-day clock runs from the **availability of a fix**, not from awareness; and
vulnerabilities found through good-faith testing, coordinated disclosure or bug
bounty programmes are **excluded** from mandatory reporting.

Timeline: Article 14 reporting applies from **11 September 2026**; the main
obligations (essential requirements, vulnerability handling, SBOM in technical
documentation, conformity assessment) apply from **11 December 2027**.

Penalties reach **€15M or 2.5% of worldwide annual turnover**. Most teams
discover this in a customer security questionnaire, three weeks before a deal
stalls.

## What we sell

Not compliance. **Readiness, with receipts.**

1. **Know what's in the product.** Real SBOM from real lockfiles — npm, Python,
   Go, Rust, Java, PHP, .NET, Ruby, plus container base images.
2. **Know what's wrong with it.** Vulnerabilities matched against OSV, GitHub
   Advisory, CISA KEV and EPSS, prioritised by *exploited in the wild* first,
   not by CVSS theatre.
3. **Know where you stand.** 35 CRA controls across 8 domains, each with a
   status, a written reason and a next action. A score you can explain.
4. **Be able to respond.** When something blows up, the 24-hour clock starts.
   We generate the draft early warning, notification and final report from the
   data you already have.

## Why not the obvious alternatives

| They'd say | We say |
|---|---|
| **"We have Dependabot / Snyk / Renovate."** | Those tell you a dependency is vulnerable. They do not tell you what your product contains, whether you can answer a CRA obligation, or what to submit to a regulator in 24 hours. Different job. |
| **"We'll use a GRC platform (Vanta, Drata…)."** | GRC platforms collect attestations for auditors. They don't read your lockfiles. We produce the technical evidence their questionnaires ask for. |
| **"We'll hire a consultant."** | A consultant costs five figures and delivers a PDF. We cost per scan and deliver evidence that updates every time you push. Use both: they interpret, we measure. |
| **"We're not in scope / we'll wait."** | If you sell software into the EU, you are in scope. The deadline is a date, not an opinion. |
| **"AI can write our compliance docs."** | It can write a document. It cannot know what your product contains. We generate drafts **from scan data**, and every claim is traceable to it. |

## What we are not

Stated here so nobody on the team drifts:

- **Not legal advice.** Reports are labelled "Draft — engineering evidence,
  not legal advice", in the document text, not just the footer.
- **Not a certification body.** We will never say "CRA certified".
- **Not a generic scanner.** A CVE list is not a compliance posture.
- **Not a questionnaire.** Progress comes from your repository, not from
  ticking boxes.

## The wedge and the expansion

```
Acquire     Pay-as-you-go credits + free GitHub Action  →  one repo, one scan
Retain      Continuous monitoring: every push re-scans, posture drifts visibly
Expand      More repos → org features (RBAC, evidence vault, API) →
            agency workspaces → enterprise override
```

Land with one engineer and one repository. Expand to the whole product
portfolio, because readiness is only meaningful at portfolio level.

## Pricing logic

- **Credits, not seats.** You pay for work done, not for colleagues existing.
  A three-person team and a thirty-person team can both start cheap.
- **Free tier is generous enough to complete the core flow** (250 credits:
  connect, scan a few times, generate one report) and not generous enough to
  run production monitoring for free.
- **Auto top-up** converts usage into predictable spend without a contract.
- **Subscriptions** exist for teams that want budgeting certainty and included
  credits.
- **Prices are admin-editable at runtime**, so discounting and price
  experiments do not require an engineer.

## Messaging rules

- Lead with the **deadline and the obligation**, not with features.
- Every claim is about something the product demonstrably does today.
- Prefer "here is what your scan says" over "here is what we can do".
- Numbers over adjectives: "35 controls across 8 domains" beats
  "comprehensive coverage".
- Never imply legal certainty. The product doesn't, and neither do we.
