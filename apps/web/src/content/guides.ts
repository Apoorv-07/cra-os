/**
 * Long-form reference guides for high-intent CRA searches.
 *
 * These are written to be useful even if the reader never signs up — that is
 * what makes them rank and what makes them worth linking to. Every factual
 * claim is about the regulation as published, and every page carries the same
 * disclaimer: this is engineering guidance, not legal advice.
 *
 * Review these whenever the regulation's application guidance changes. The
 * dates are load-bearing.
 */

export interface GuideSection {
  h: string;
  p?: string[];
  bullets?: string[];
  /** A short numbered or tabular structure, rendered as a definition list. */
  steps?: Array<{ label: string; text: string }>;
}

export interface Guide {
  slug: string;
  title: string;
  /** H1 as it should appear on the page. */
  heading: string;
  description: string;
  eyebrow: string;
  intro: string;
  sections: GuideSection[];
  /** Links to the other guides, by slug. */
  related: string[];
  cta: { heading: string; body: string };
}

export const GUIDES: Guide[] = [
  {
    slug: 'cra-readiness-checklist',
    title: 'CRA readiness checklist: what to have in place before December 2027',
    heading: 'A Cyber Resilience Act readiness checklist for software teams',
    description:
      'A practical, engineering-first checklist for EU Cyber Resilience Act readiness: inventory, vulnerability handling, documentation, support periods and incident reporting — with what to do first.',
    eyebrow: 'Guide',
    intro:
      'The Cyber Resilience Act (Regulation (EU) 2024/2847) applies to products with digital elements placed on the EU market. Most of its obligations apply from 11 December 2027, but the reporting obligations under Article 14 arrive earlier, on 11 September 2026. This checklist is written for engineering teams who have to build the evidence, not for lawyers — and it is ordered by what unblocks everything else.',
    sections: [
      {
        h: 'Start here: three dates that shape everything',
        p: [
          'The regulation entered into force on 10 December 2024. Two application dates follow, and confusing them is the most common planning error.',
        ],
        steps: [
          {
            label: '11 September 2026',
            text: 'Article 14 reporting obligations apply. If you become aware of an actively exploited vulnerability in a product already on the market, the clock starts — 24 hours for an early warning, 72 hours for the notification, and a final report within 14 days of a corrective measure becoming available.',
          },
          {
            label: '11 December 2027',
            text: 'The main obligations apply: essential cybersecurity requirements, vulnerability handling processes, the SBOM in technical documentation, conformity assessment, CE marking and the declaration of conformity.',
          },
          {
            label: 'Now',
            text: 'Everything else on this list. The reporting obligation does not wait for you to be ready, so build the parts that let you answer it under time pressure.',
          },
        ],
      },
      {
        h: '1. Know what is in the product',
        p: [
          'You cannot report on a vulnerability in a component you do not know you ship. An SBOM is the foundation every other obligation rests on, and it is the one artefact that is cheap to produce today and painful to reconstruct during an incident.',
          'The regulation asks for an SBOM in a commonly used, machine-readable format covering at least the top-level dependencies. CycloneDX and SPDX are the two formats in general use; CycloneDX is what most vulnerability tooling consumes.',
        ],
        bullets: [
          'Generate the SBOM from lockfiles, not from memory — a hand-maintained inventory is wrong by the second sprint.',
          'Regenerate on every release. A stale SBOM is worse than no SBOM because it looks authoritative.',
          'Cover every ecosystem in the build, including transitive dependencies and container base images.',
          'Store each generated SBOM with a checksum and a timestamp so you can prove what you knew and when.',
        ],
      },
      {
        h: '2. Know which of those components are dangerous',
        p: [
          'A list of components is not a risk picture. What matters for the CRA — and what actually starts the reporting clock — is whether a vulnerability is being exploited in the wild, not only how severe it scores on paper.',
        ],
        bullets: [
          'Match components against public advisory sources: OSV and the GitHub Advisory Database are the practical baseline.',
          'Check every match against the CISA Known Exploited Vulnerabilities catalogue. KEV membership is the closest public proxy for "actively exploited".',
          'Use EPSS to rank everything else: it estimates the probability of exploitation in the next 30 days, which is what a triage queue needs.',
          'Record the triage decision, not just the finding. "We assessed this and accepted the risk because X" is the evidence an auditor asks for.',
        ],
      },
      {
        h: '3. Be able to report within 24 hours',
        p: [
          'Article 14 is triggered when you become aware of an actively exploited vulnerability. "Actively exploited" has a specific meaning: reliable evidence that a malicious actor has exploited the vulnerability in a system without the owner\'s permission. Vulnerabilities reported through good-faith testing, coordinated disclosure or bug bounty programmes are excluded.',
          'When it is triggered, you notify the CSIRT designated as coordinator for the Member State of your main EU establishment, and ENISA — in practice through the EU Single Reporting Platform — and you inform affected users.',
        ],
        bullets: [
          'Decide in advance who can start the clock, and how. Awareness has to land somewhere a human sees it.',
          'Prepare the shape of the report now: what is affected, how it is exploited, what users can do, what you are doing.',
          'Rehearse it. A 24-hour deadline is not the moment to discover that nobody knows the product versioning scheme.',
        ],
      },
      {
        h: '4. Write down how you handle vulnerabilities',
        p: [
          'The vulnerability handling requirements are binding from December 2027, but the process takes longer than a quarter to build and be able to evidence. It needs: a monitored intake channel, triage with defined severity and exploitability criteria, remediation with owners and target dates, security updates distributed without undue delay, and a published disclosure policy.',
        ],
      },
      {
        h: '5. Documentation and the boring artefacts',
        bullets: [
          'A cybersecurity risk assessment for the product, and the design decisions that follow from it.',
          'Technical documentation: description, intended use, how the essential requirements are met, testing records.',
          'A declared support period for the product, and what happens at the end of it.',
          'Security instructions for users: secure configuration, update mechanism, what to do when something goes wrong.',
          'An EU declaration of conformity and CE marking, via the conformity assessment route for your product category.',
        ],
      },
      {
        h: '6. What to do in the next two weeks',
        steps: [
          { label: 'Day 1', text: 'Generate an SBOM for your main product and look at it. Most teams find at least one surprise.' },
          { label: 'Day 2', text: 'Match it against KEV. If anything hits, you have work to do before anything else on this list.' },
          { label: 'Week 1', text: 'Wire SBOM generation into CI so it regenerates on every release without anyone remembering.' },
          { label: 'Week 2', text: 'Run one incident rehearsal end to end, from a KEV-matching finding to a draft 24-hour report.' },
        ],
      },
      {
        h: 'Honest limits of this checklist',
        p: [
          'This is engineering guidance. It is not legal advice and it is not exhaustive — the regulation runs to well over a hundred articles, and sector-specific rules may apply to you. Product categorisation (standard, important class I or II, critical) changes the conformity assessment route, which is a question for whoever signs your declaration of conformity.',
        ],
      },
    ],
    related: ['article-14-reporting', 'cra-sbom-requirements'],
    cta: {
      heading: 'Stop assembling this by hand',
      body: 'Connect a repository and get the SBOM, the vulnerability picture with KEV and EPSS, and a readiness score across 35 CRA controls — each with a written reason. 250 free credits.',
    },
  },

  {
    slug: 'cra-sbom-requirements',
    title: 'CRA SBOM requirements: what your software bill of materials must contain',
    heading: 'What the Cyber Resilience Act requires from your SBOM',
    description:
      'What the EU Cyber Resilience Act asks for in a software bill of materials: format, depth, when it must be produced, and how to generate one from real lockfiles in every major ecosystem.',
    eyebrow: 'Guide',
    intro:
      'The Cyber Resilience Act does not ask for a perfect inventory. It asks for a machine-readable record of the components your product contains, covering at least the top-level dependencies, kept in your technical documentation. That is a much lower bar than most teams fear — and a much more specific one than "we have Dependabot".',
    sections: [
      {
        h: 'What the regulation actually asks for',
        p: [
          'The vulnerability handling requirements in Annex I Part II ask manufacturers to identify and document the vulnerabilities and components contained in the product, including by drawing up a software bill of materials in a commonly used and machine-readable format covering at least the top-level dependencies of the product.',
          'Three things follow from that sentence, and all three are testable:',
        ],
        bullets: [
          'Machine-readable. A spreadsheet or a wiki page does not qualify. CycloneDX and SPDX are the formats in general use.',
          'At least top-level dependencies. Direct dependencies are the floor, not the target. Transitive depth is what finds the vulnerability that actually ships.',
          'Maintained, not archived. The SBOM is part of technical documentation, and it has to reflect the product as placed on the market.',
        ],
      },
      {
        h: 'What a useful SBOM record contains',
        bullets: [
          'Component name, version and ecosystem, plus a package URL (purl) so the identifier is unambiguous across tools.',
          'Dependency relationships — which component pulls in which — so you can answer "how do we get this?" and "what breaks if we upgrade?".',
          'Licence information where known; it is not a CRA requirement, but it is free to collect at the same time and it answers the next question.',
          'The scope of each component: direct or transitive, runtime or build-time.',
          'Authorship and timestamp: which tool generated it, from which commit, when.',
        ],
      },
      {
        h: 'Generate it from lockfiles, not from guesswork',
        p: [
          'An SBOM reconstructed from memory or from a package manifest without resolved versions is not evidence of anything. Lockfiles are: they record what was actually resolved and installed.',
        ],
        bullets: [
          'npm: package-lock.json, yarn.lock, pnpm-lock.yaml (package.json alone gives you declared ranges, not resolved versions).',
          'Python: requirements.txt with pins, poetry.lock, or pyproject.toml.',
          'Go: go.mod plus go.sum; the module graph is the dependency graph.',
          'Rust: Cargo.lock. Java: pom.xml or resolved Gradle coordinates. PHP: composer.lock.',
          '.NET: packages.lock.json or .csproj. Ruby: Gemfile.lock.',
          'Containers: the base image in your Dockerfile is a component too, and it is the one teams most often forget.',
        ],
      },
      {
        h: 'CycloneDX or SPDX?',
        p: [
          'Both satisfy the "commonly used and machine-readable" requirement. In practice the choice is made by what consumes the output: CycloneDX is focused on security use cases and is what most vulnerability and compliance tooling ingests; SPDX is broader on licensing and provenance. If you are producing one document for both customers and internal triage, CycloneDX 1.6 is the pragmatic default — and it is what CRA Compliance OS generates.',
        ],
      },
      {
        h: 'Keep it alive',
        p: [
          'The failure mode is not a missing SBOM — it is an SBOM from eight months ago that nobody trusts. Three habits prevent that:',
        ],
        steps: [
          { label: 'Generate in CI', text: 'Every release produces a new SBOM. No human step, no reminder email.' },
          { label: 'Store each version', text: 'Content-addressed storage with a checksum, so you can prove which SBOM was current when a decision was made.' },
          { label: 'Diff between releases', text: '"Three new components, one with a KEV entry" is a useful release note. A 4,000-line JSON file is not.' },
        ],
      },
      {
        h: 'Common mistakes',
        bullets: [
          'Generating from source at build time only — build-time and runtime dependencies are different sets, and you may need both.',
          'Ignoring transitive dependencies because the requirement says "top-level". The floor is not the goal.',
          'Forgetting the container base image and the toolchain that ships with it.',
          'Producing a document nobody reads, and discovering during an incident that it has been wrong for a year.',
        ],
      },
    ],
    related: ['cra-readiness-checklist', 'article-14-reporting'],
    cta: {
      heading: 'Generate one in about a minute',
      body: 'Connect a repository or run the GitHub Action. You get a CycloneDX 1.6 SBOM with every resolved component, matched against OSV, KEV and EPSS — downloadable, versioned and checksummed.',
    },
  },

  {
    slug: 'article-14-reporting',
    title: 'CRA Article 14 reporting: 24 hours, 72 hours, 14 days — explained',
    heading: 'Article 14 of the Cyber Resilience Act, in engineering terms',
    description:
      'What triggers CRA Article 14 reporting, the 24-hour early warning, 72-hour notification and final report deadlines, who you notify, and what each report has to contain.',
    eyebrow: 'Guide',
    intro:
      'Article 14 is the first CRA obligation that applies — from 11 September 2026 — and the only one measured in hours. It is also the one most teams have no process for. This page explains the triggers, the clocks and the content of each report, in the order you would need them.',
    sections: [
      {
        h: 'What triggers it',
        p: [
          'Two events trigger Article 14 reporting: an actively exploited vulnerability in the product, and a severe incident having an impact on the security of the product.',
          'An actively exploited vulnerability is one for which there is reliable evidence that a malicious actor has exploited it in a system without the permission of the system owner. That is a real exploitation, not a theoretical one — which is why the CISA KEV catalogue is the single most useful public signal for spotting a likely trigger.',
          'A severe incident is an attack on the manufacturer\'s own infrastructure — development environments, build systems, update pipelines — that affects, or is capable of affecting, the security of the product, or that could introduce malicious code into it.',
          'Two important exclusions: vulnerabilities discovered through good-faith security testing, coordinated vulnerability disclosure, or bug bounty programmes are not subject to mandatory notification. And the obligation applies to products already placed on the market before the date, not only to new ones.',
        ],
      },
      {
        h: 'The clocks',
        p: [
          'All three deadlines run from when you became aware, except the final report, which runs from when a corrective or mitigating measure becomes available. That distinction matters: you are not required to file a final report 14 days after you find out, you are required to file it 14 days after you have something to tell users to do.',
        ],
        steps: [
          { label: '24 hours', text: 'Early warning. From becoming aware of the actively exploited vulnerability.' },
          { label: '72 hours', text: 'Vulnerability notification, with substantially more detail. Also the deadline for a severe incident notification.' },
          { label: '14 days', text: 'Final report, counted from when a corrective or mitigating measure is available — not from awareness.' },
          { label: '1 month', text: 'Final report for a severe incident, counted from the incident notification.' },
        ],
      },
      {
        h: 'Who you notify',
        p: [
          'You notify the CSIRT designated as coordinator for the Member State where you have your main establishment in the EU, and ENISA. A single submission through the EU Single Reporting Platform covers both. You also inform the users affected by the vulnerability or incident, in a way proportionate to the risk.',
          'If you have no EU establishment, the authority is determined by a decision tree based on whether you have an authorised representative, importer or distributor in the EU. Work that out before you need it, not during the 24 hours.',
        ],
      },
      {
        h: 'What each report contains',
        steps: [
          {
            label: 'Early warning (24h)',
            text: 'That an actively exploited vulnerability exists, which product is affected, and the nature of the exploitation. It is deliberately short — the point is to start the clock, not to finish the analysis.',
          },
          {
            label: 'Notification (72h)',
            text: 'General information about the nature of the incident, an initial assessment, corrective and mitigating measures taken or planned, measures users can take themselves, and the sensitivity of the information you are sharing.',
          },
          {
            label: 'Final report (14 days from a fix)',
            text: 'What happened, root cause, the full corrective measure, affected versions, and what users must do. Not required if the earlier submissions already covered it.',
          },
        ],
      },
      {
        h: 'Why the 24 hours is the hard part',
        p: [
          'Seventy-two hours is a working day and a half. Twenty-four hours is one on-call rotation. The teams who handle this well are not the ones with the best incident plan on paper — they are the ones who already knew, before the incident, which components each product ships and where to look.',
          'That is the whole argument for doing this work now: the report content can only be gathered after the event, but the inventory can be ready in advance.',
        ],
      },
      {
        h: 'A minimum viable process',
        bullets: [
          'One monitored channel where exploitation signals land, with a named human responsible for seeing them.',
          'A pre-agreed definition of "we are now aware", so the clock start is not debated later.',
          'A per-product inventory you trust, so "what is affected" takes minutes rather than days.',
          'A draft template for each of the three reports, with the static parts already written.',
          'A rehearsal, at least once, before the obligation starts.',
        ],
      },
      {
        h: 'Not legal advice',
        p: [
          'This page explains the mechanics so engineering teams can prepare. It is not legal advice, and it is not a substitute for reading the regulation or taking advice on your specific products. The classification of an event as reportable is a judgement your organisation has to make and record.',
        ],
      },
    ],
    related: ['cra-readiness-checklist', 'cra-sbom-requirements'],
    cta: {
      heading: 'Draft the reports from real data',
      body: 'Open an incident from a finding and get the early warning, notification and final report drafted from your scan data — with the advisory id, CVSS vector, affected components and deadlines filled in. Review, edit, approve, export.',
    },
  },

  {
    slug: 'cyber-resilience-act-for-software-teams',
    title: 'The Cyber Resilience Act for software teams, in plain English',
    heading: 'The Cyber Resilience Act, explained for the people who build the product',
    description:
      'What the EU Cyber Resilience Act means for software teams: scope, product categories, essential requirements, vulnerability handling, conformity assessment, and what to build first.',
    eyebrow: 'Guide',
    intro:
      'Most writing about the Cyber Resilience Act is written for compliance professionals. This is written for the engineers who will have to produce the evidence: what is in scope, what the regulation asks of a product, and what that means in terms of work.',
    sections: [
      {
        h: 'What it is',
        p: [
          'The Cyber Resilience Act — Regulation (EU) 2024/2847 — sets cybersecurity requirements for products with digital elements placed on the EU market. It entered into force on 10 December 2024. It applies to software and hardware alike, and it reaches economic operators manufacturers, authorised representatives, importers and distributors, with the heaviest obligations on manufacturers because they control design and development.',
          'If you sell software into the EU, including as a service with a client component, assume it applies to you and confirm the details with whoever owns conformity for your product.',
        ],
      },
      {
        h: 'When it bites',
        steps: [
          { label: '11 September 2026', text: 'Article 14 reporting obligations: actively exploited vulnerabilities and severe incidents, on clocks measured in hours.' },
          { label: '11 December 2027', text: 'Everything else: essential requirements, vulnerability handling, technical documentation including the SBOM, conformity assessment, CE marking.' },
        ],
      },
      {
        h: 'Product categories',
        p: [
          'The conformity assessment route depends on how the product is categorised, which is the first question to settle because it determines how much work everything else is.',
        ],
        bullets: [
          'Standard products: products with digital elements not listed as important or critical. Manufacturer self-assessment is generally available.',
          'Important products, class I and II: listed in Annex III, with progressively heavier conformity assessment requirements.',
          'Critical products: listed in Annex IV, with the highest assurance expectations.',
        ],
      },
      {
        h: 'What the product itself must do',
        p: [
          'Annex I Part I sets essential cybersecurity requirements that the product must meet when placed on the market. In engineering terms, they cluster into a few recognisable themes:',
        ],
        bullets: [
          'Ship without known exploitable vulnerabilities, and with secure default configuration.',
          'Protect the confidentiality and integrity of data, and control access to every interface.',
          'Ensure software integrity — signed updates, verified images, tamper resistance.',
          'Minimise the attack surface, including by not shipping functionality nobody uses.',
          'Be resilient: availability, and recovering from an attack without losing state.',
          'Produce logs that make an incident investigable afterwards.',
        ],
      },
      {
        h: 'What you must do after shipping',
        p: [
          'Annex I Part II sets the vulnerability handling requirements, and this is where most engineering work lands:',
        ],
        bullets: [
          'Identify and document the components in the product — the SBOM requirement.',
          'Address vulnerabilities without delay, including by shipping security updates.',
          'Run a coordinated vulnerability disclosure process with a published policy and a monitored intake channel.',
          'Distribute security updates automatically where possible, and separately from feature releases where practical.',
          'Share information about fixed vulnerabilities so downstream users can act.',
          'Declare and honour a support period for the product.',
        ],
      },
      {
        h: 'Open source',
        p: [
          'The regulation distinguishes non-commercial open source development from commercial activity, and introduces the role of open source software steward with a lighter set of obligations. If you maintain an open source project that others commercialise, this matters to you; if you ship a commercial product containing open source — which is everyone — your obligations as a manufacturer are unchanged.',
        ],
      },
      {
        h: 'Penalties',
        p: [
          'Non-compliance can be penalised up to €15,000,000 or 2.5% of the total worldwide annual turnover of the undertaking, whichever is higher. For most teams reading this, the more immediate consequence is commercial: a customer security questionnaire that cannot be answered, and a deal that stops.',
        ],
      },
      {
        h: 'What to build first',
        steps: [
          { label: 'Inventory', text: 'You cannot assess risk in a product whose contents you cannot list. Generate the SBOM.' },
          { label: 'Matching', text: 'Compare the inventory against public vulnerability intelligence, with exploitation signal first.' },
          { label: 'Process', text: 'A monitored intake channel, triage criteria, remediation owners and a disclosure policy — written down.' },
          { label: 'Reporting', text: 'The Article 14 drafts and the rehearsal. This is the 2026 deadline.' },
        ],
      },
      {
        h: 'Limits',
        p: [
          'This is a summary for engineering planning, not legal advice, and it is not exhaustive. Sector-specific rules, national implementation and the harmonised standards that give presumption of conformity all matter to the final answer.',
        ],
      },
    ],
    related: ['cra-readiness-checklist', 'cra-sbom-requirements', 'article-14-reporting'],
    cta: {
      heading: 'Turn this into a score you can explain',
      body: 'CRA Compliance OS evaluates 35 controls across 8 domains against real scan data, and gives every one a status and a written reason. Connect a repository — 250 credits are free.',
    },
  },
];

export const guideBySlug = (slug: string | undefined): Guide | undefined =>
  GUIDES.find((g) => g.slug === slug);
