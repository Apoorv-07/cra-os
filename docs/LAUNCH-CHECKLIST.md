# Founder launch checklist

The technical launch is not the launch. This is the list that turns a working
product into revenue. Assumes `docs/PRODUCTION-CHECKLIST.md` is complete.

---

## 1. Get the story straight (do this first — everything else depends on it)

- [ ] One sentence: *"Connect your repo, get an SBOM, real vulnerabilities and an
      EU Cyber Resilience Act readiness score — pay per scan, no annual contract."*
- [ ] The buyer is named: a **CTO / Head of Engineering / founder** at a
      5–200 person company that ships software into the EU.
- [ ] The trigger is named: the **Article 14 reporting obligations apply from
      11 September 2026** (24-hour early warning, 72-hour notification, final
      report within 14 days of a corrective measure becoming available), with
      penalties up to €15M or 2.5% of worldwide turnover. Note that reporting
      applies from 2026; the main obligations start 11 December 2027.
- [ ] The wedge is named: not "GRC platform" — **"prove what's in your product,
      and be ready to report an incident"**.
- [ ] The anti-pitch is written down too: we are not a consultancy, not a
      certification body, not legal advice, and not a questionnaire.
- [ ] The honest limitation is in the pitch: this produces **engineering
      evidence and drafts**, reviewed by your team — not a legal sign-off.

## 2. Pricing that a founder can defend

- [ ] Public pricing page matches the live catalogue (`GET /api/v1/billing/pricing`).
- [ ] Free tier: **250 credits at signup** — enough to connect a repository, run
      a few scans and generate one readiness report. Enough to feel the product,
      not enough to run a company on it.
- [ ] Pay-as-you-go packs are the default purchase (acquisition), with auto
      top-up offered at checkout (retention).
- [ ] Subscription plan(s) exist for teams that want predictable spend and
      included credits (expansion).
- [ ] Currency is **USD by default**; EUR and GBP are supported.
- [ ] Every price is editable from the admin console **without a deploy** — so
      you can discount, test a price point, or fix a mistake in seconds.
- [ ] Agency/partner model is available: one organisation, many customer
      projects, credits pooled.

## 3. Product surfaces that sell without you

- [ ] Homepage states the deadline, the obligation and the three-step flow.
- [ ] Pricing page answers "what does one scan cost" without a sales call.
- [ ] **GitHub Action** published and usable by someone with no account:
      `uses: cra-compliance-os/cra-action@v1`. This is the top of the funnel.
- [ ] Public **readiness badge** works on any README (share link + SVG).
- [ ] Shareable read-only reports: a customer can send one to their customer.
- [ ] Onboarding ends at the first real scan, not at a settings page.
- [ ] Empty states say what to do next, not "no data".

## 4. Distribution, in the order that compounds

- [ ] Ship the **GitHub Action** first. It is the lowest-friction proof that the
      scanner is real, and it puts the name in front of engineers daily.
- [ ] Post in the places where the deadline is already being discussed: EU
      product/security communities, CTO Slacks, r/ExperiencedDevs-adjacent
      spaces, Hacker News when there is a genuine CRA news hook.
- [ ] Write the article nobody else has written: *"What the CRA Article 14
      clock actually means for a 20-person SaaS team"* — with a real example
      scan and a real draft report in it.
- [ ] Direct outreach (templates in `docs/sales/outreach.md`): 20 personalised
      messages a day to companies shipping software into the EU.
- [ ] Agency/B2B2B: five digital agencies with EU clients. They resell
      compliance readiness to their customers and do not want to build it.
- [ ] Referral credits: existing users get bonus credits for a signup that
      pays. Instrumented in `referrals`.

## 5. Legal and trust pages live

- [ ] Privacy, Terms, Security, DPA, Subprocessors published.
- [ ] No fabricated certifications anywhere on the site or in outbound copy.
- [ ] Security contact published and monitored.

## 6. Instrumentation — you cannot fix what you cannot see

- [ ] Funnel reviewed weekly: `GET /api/v1/admin/funnel`.
- [ ] The five numbers on your wall: signups, repos connected, scans completed,
      reports generated, **paying accounts**.
- [ ] Dead-letter queue reviewed daily (`GET /api/v1/admin/jobs/dead-letter`).
- [ ] Failed payments reviewed weekly — most are recoverable revenue.
- [ ] Feature flags used for anything risky; no deploy needed to turn it off.

## 7. The first ten customers (do this manually, on purpose)

- [ ] Offer to run the first scan **for** them and walk them through the report.
- [ ] Ask each one: "what did you expect this to tell you that it didn't?"
- [ ] Write down the objection you hear most, and fix the product or the pitch.
- [ ] Convert at least three into a recurring plan or an auto top-up.
- [ ] Ask two for a quote you can publish.

## 8. Things that will bite you if you skip them

- [ ] **Do one live purchase yourself, end to end.** Signature logic passing
      tests is not the same as money arriving.
- [ ] **Send one real magic link** from the production deployment.
- [ ] **Restore one backup** on a scratch host.
- [ ] **Read the Article 14 draft a customer would receive** and check it says
      what you would want your own team to read.
- [ ] **Set the free tier deliberately.** Credits are the first impression.

## 9. Weekly rhythm after launch

- [ ] Monday: read DLQ, failed payments, funnel.
- [ ] Tuesday–Thursday: ship, do outreach, talk to users.
- [ ] Friday: write down what you learned; pick next week's one thing.
- [ ] Never: build a feature nobody asked for because it felt like progress.
