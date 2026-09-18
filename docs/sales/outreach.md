# Outreach and distribution

Templates to copy, adapt and send. Personalise the first two lines every time —
generic outreach to engineers is deleted on sight.

Rules that apply to all of them:

- Lead with their product, not with our features.
- One ask: "want me to run a scan and send you the report?"
- No fake urgency, no invented claims about their stack, no "just following up"
  chains beyond two attempts.

---

## 1. Cold email — engineering leader (primary)

> **Subject:** CRA Article 14 — can you produce an SBOM this week?
>
> Hi [First name],
>
> [One specific thing about their product — a feature, a recent release, their
> docs.]
>
> Practical question: if a critical vulnerability in [their product] was being
> exploited tomorrow, could you produce an SBOM and a regulator-ready summary
> within 24 hours? From 11 September 2026 Article 14 says you have 24 hours for
> the early warning, 72 for the notification, and a final report within 14
> days of a fix becoming available. It applies to products already on the market.
>
> I built CRA Compliance OS for teams that are asked this in a customer security
> questionnaire and don't have a good answer. You connect the repo, it reads the
> lockfiles, builds a CycloneDX SBOM, matches against OSV/KEV/EPSS, and scores
> readiness across 35 CRA controls — with a written reason for every one.
>
> Want me to run a scan on [repo] and send you the report? No call, no card —
> I'll send the PDF and you can tell me it's useless.
>
> [Name]
> [link]

## 2. Cold email — agency / B2B2B

> **Subject:** CRA readiness for your clients' products
>
> Hi [First name],
>
> Your clients shipping into the EU will start asking who is handling Cyber
> Resilience Act readiness — and most agencies I talk to don't want to build
> that.
>
> CRA Compliance OS is a workspace where each client gets its own project and
> reports, on one pool of credits. You connect their repos, we produce the SBOM,
> the vulnerability picture and a readiness report you can hand over under your
> own name. Usage-based, so you only pay when you actually run something.
>
> Worth 15 minutes? I'll show you a real client workspace with a real scan in it.
>
> [Name]

## 3. GitHub Action — engineer who already found us

> **Subject:** your CRA Action run
>
> Hi [First name],
>
> You ran the CRA Compliance Action on [repo] — thanks. You found [N]
> components and [N] findings; [N] of them are in the CISA known-exploited
> catalogue, which is what starts the 24-hour Article 14 clock.
>
> The Action covers CI. If you want the readiness posture across all your
> repositories, the evidence vault and the incident drafts, that's the hosted
> product — 250 free credits, no card.
>
> Happy to answer questions about the scanner either way.
>
> [Name]

## 4. LinkedIn / DM

> Hi [First name] — saw [specific thing].
>
> Quick one: from 11 Sep 2026, CRA Article 14 gives you 24 hours to report an
> actively exploited vulnerability in a shipped product. Most teams I speak to
> can't produce an SBOM on demand, let alone a draft report.
>
> I built a tool that reads your lockfiles and produces both. Want me to run it
> on [repo] and send you the output? No pitch deck involved.

## 5. Follow-up (once, five days later)

> Hi [First name] — following up once.
>
> I scanned [repo] anyway: [N] components, [N] findings, [N] known-exploited.
> Readiness [score]/100. Report attached — it's a real document, not a
> screenshot.
>
> If it's not useful, say so and I'll stop. If it is, 250 credits are free and
> you can keep going without me.

## 6. Objection responses

| They say | You say |
|---|---|
| "We have Dependabot." | It tells you a dependency is vulnerable. It doesn't tell you what your product contains, or what you'd submit in 24 hours. Different job — run both. |
| "We'll deal with it closer to the deadline." | The deadline is 11 Sep 2026 and the hard part isn't the deadline, it's the first time a customer asks. That question can arrive next Tuesday. |
| "We're not in scope." | If you place a product with digital elements on the EU market, you are. Happy to send the criteria so you can judge for yourself. |
| "Too expensive." | It's per scan, and an unchanged repo isn't charged. Start on the free credits; if it doesn't change what you do, don't buy anything. |
| "Is this legal advice?" | No — it produces engineering evidence and drafts from your scan data. Your team and your counsel decide what to file. |
| "Can we self-host?" | [Honest answer: not yet / here's the timeline.] |

---

## 7. Community posts

### Hacker News (only with a genuine news hook)

> Title: *Show HN: Connect a repo, get an SBOM and an EU CRA readiness score*
>
> Body: what it does in one paragraph. Then: the Article 14 clocks, that the
> scanner reads lockfiles and never executes code, that drafts are labelled
> engineering evidence not legal advice, that money is pay-per-scan. Link to a
> **real** public sample report. Answer every technical question in the thread,
> including uncomfortable ones about coverage.

### Reddit / forums

Post the substance, not the link: a walkthrough of what a 24-hour report
actually contains, using a real example. Mention the tool at the end and only
where self-promotion is welcome.

### The article nobody else has written

*"What the CRA Article 14 clock means for a 20-person SaaS team"* — with a real
scan, a real draft early-warning report, and the honest gaps. This is the single
best piece of content for the funnel because it is the question.
