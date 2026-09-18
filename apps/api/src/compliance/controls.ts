import { getDb } from '../db/index.js';
import { complianceControls } from '../db/schema.js';
import type { ComplianceControl } from '../db/schema.js';

/**
 * CRA control catalogue.
 *
 * This is the intellectual core of the product, so it is deliberately not a
 * generic checklist. Each control maps to a specific provision of Regulation
 * (EU) 2024/2847, states what evidence would satisfy it, and declares whether
 * the platform can evaluate it from machine data (`automated`), requires a human
 * artefact (`attested`), or both (`hybrid`).
 *
 * Weighting is commercial honesty: an actively exploited dependency is worth
 * more to the readiness number than a missing pen-test report, because it is
 * what triggers the Article 14 clock.
 */

export type ControlDomain =
  | 'Component transparency'
  | 'Vulnerability handling'
  | 'Incident reporting'
  | 'Secure development'
  | 'Update & support'
  | 'Documentation'
  | 'Security properties'
  | 'Governance';

export interface ControlDefinition {
  id: string;
  domain: ControlDomain;
  title: string;
  description: string;
  legalRef: string;
  obligation: string;
  weight: number;
  evidenceTypes: string[];
  evaluation: 'automated' | 'attested' | 'hybrid';
  remediation: string;
  references: string[];
  sortOrder: number;
}

export const CONTROL_CATALOGUE: ControlDefinition[] = [
  // -------------------------------------------------------------------------
  // Component transparency
  // -------------------------------------------------------------------------
  {
    id: 'cra.sbom.present',
    domain: 'Component transparency',
    title: 'Software bill of materials exists',
    description:
      'A machine-readable SBOM (CycloneDX or SPDX) exists for the current release and is regenerated on every change.',
    legalRef: 'Annex I Part II(1)',
    obligation: 'Manufacturers must identify and document the components contained in products with digital elements.',
    weight: 3,
    evidenceTypes: ['sbom', 'scan_result'],
    evaluation: 'automated',
    remediation: 'Run a scan to generate a CycloneDX SBOM, then wire the GitHub Action into CI so it stays current.',
    references: ['https://eur-lex.europa.eu/eli/reg/2024/2847/oj'],
    sortOrder: 10,
  },
  {
    id: 'cra.sbom.completeness',
    domain: 'Component transparency',
    title: 'SBOM completeness',
    description:
      'Every component in the SBOM carries a resolvable identifier (purl) and, where available, a licence.',
    legalRef: 'Annex I Part II(1)',
    obligation: 'The SBOM must be sufficient to identify components and their provenance, including top-level dependencies.',
    weight: 2,
    evidenceTypes: ['sbom'],
    evaluation: 'automated',
    remediation: 'Commit a lockfile so exact versions (not ranges) are captured, and declare licences in the manifest.',
    references: [],
    sortOrder: 20,
  },
  {
    id: 'cra.inventory.direct',
    domain: 'Component transparency',
    title: 'Top-level dependency declaration',
    description:
      'Direct dependencies are distinguishable from transitive ones, so blast radius can be reasoned about.',
    legalRef: 'Annex I Part II(1)',
    obligation: 'Documentation must cover, at minimum, the top-level dependencies of the product.',
    weight: 1,
    evidenceTypes: ['sbom', 'scan_result'],
    evaluation: 'automated',
    remediation: 'Ensure your manifest declares direct dependencies rather than relying only on resolved lock entries.',
    references: [],
    sortOrder: 30,
  },

  // -------------------------------------------------------------------------
  // Vulnerability handling
  // -------------------------------------------------------------------------
  {
    id: 'cra.vuln.known_exploited',
    domain: 'Vulnerability handling',
    title: 'No known-exploited vulnerabilities',
    description:
      'No component in the shipped product matches a CVE on the CISA Known Exploited Vulnerability catalogue.',
    legalRef: 'Art. 14(1) + Annex I Part II(2)',
    obligation:
      'Actively exploited vulnerabilities must be reported within 24 hours of becoming aware, and products must ship without known exploitable vulnerabilities.',
    weight: 5,
    evidenceTypes: ['scan_result', 'vulnerability_record'],
    evaluation: 'automated',
    remediation:
      'Patch or remove the affected dependency immediately. If no fix exists, open an Article 14 incident and document the mitigating measure.',
    references: ['https://www.cisa.gov/known-exploited-vulnerabilities-catalog'],
    sortOrder: 40,
  },
  {
    id: 'cra.vuln.critical_open',
    domain: 'Vulnerability handling',
    title: 'Critical and high vulnerabilities remediated',
    description: 'Open critical/high severity vulnerabilities have an owner, a target date and a documented decision.',
    legalRef: 'Annex I Part II(2)',
    obligation: 'Manufacturers must identify and document vulnerabilities and handle them without delay.',
    weight: 4,
    evidenceTypes: ['scan_result', 'remediation'],
    evaluation: 'hybrid',
    remediation: 'Triage every critical/high finding: record a fix, an accepted risk, or a compensating control.',
    references: [],
    sortOrder: 50,
  },
  {
    id: 'cra.vuln.monitoring',
    domain: 'Vulnerability handling',
    title: 'Continuous advisory monitoring',
    description: 'The repository is monitored continuously, not scanned once, so new advisories are detected promptly.',
    legalRef: 'Art. 13(2)',
    obligation: 'Vulnerabilities must be identified and addressed throughout the support period.',
    weight: 3,
    evidenceTypes: ['scan_result', 'policy'],
    evaluation: 'automated',
    remediation: 'Enable scheduled monitoring on this repository so new advisories raise an alert automatically.',
    references: [],
    sortOrder: 60,
  },
  {
    id: 'cra.vuln.sla',
    domain: 'Vulnerability handling',
    title: 'Remediation service levels defined',
    description:
      'Documented remediation timelines exist, and each open finding carries a due date consistent with them.',
    legalRef: 'Art. 13(3)',
    obligation: 'Manufacturers must define and apply a documented vulnerability handling policy.',
    weight: 2,
    evidenceTypes: ['policy', 'remediation'],
    evaluation: 'hybrid',
    remediation: 'Upload your vulnerability handling policy and assign due dates to open findings.',
    references: [],
    sortOrder: 70,
  },
  {
    id: 'cra.vuln.triage',
    domain: 'Vulnerability handling',
    title: 'Findings are triaged, not ignored',
    description: 'Open findings have been reviewed and assigned, rather than sitting unowned in the backlog.',
    legalRef: 'Art. 13(2)',
    obligation: 'Vulnerability handling requires active triage and remediation tracking.',
    weight: 2,
    evidenceTypes: ['scan_result', 'remediation'],
    evaluation: 'automated',
    remediation: 'Assign an owner and set exploitability/exposure for each open finding.',
    references: [],
    sortOrder: 80,
  },

  // -------------------------------------------------------------------------
  // Incident reporting
  // -------------------------------------------------------------------------
  {
    id: 'cra.incident.process',
    domain: 'Incident reporting',
    title: 'Article 14 reporting process defined',
    description:
      'A documented process exists to produce the 24-hour early warning, 72-hour notification and the final report within 14 days of a corrective measure.',
    legalRef: 'Art. 14(1)-(4)',
    obligation:
      'Manufacturers must report actively exploited vulnerabilities to the CSIRT coordinator and ENISA: early warning within 24 hours of becoming aware, notification within 72 hours, and a final report within 14 days of a corrective measure becoming available. Severe incidents follow a 72-hour notification and a final report within one month.',
    weight: 4,
    evidenceTypes: ['policy', 'report'],
    evaluation: 'hybrid',
    remediation: 'Upload an incident response runbook, then generate an Article 14 draft set to rehearse the workflow.',
    references: ['https://eur-lex.europa.eu/eli/reg/2024/2847/oj'],
    sortOrder: 90,
  },
  {
    id: 'cra.incident.rehearsal',
    domain: 'Incident reporting',
    title: 'Reporting workflow rehearsed',
    description: 'At least one Article 14 report set has been drafted and reviewed, proving the clock can be met.',
    legalRef: 'Art. 14(1)',
    obligation: 'The 24-hour deadline is only achievable with a pre-prepared reporting capability.',
    weight: 3,
    evidenceTypes: ['report'],
    evaluation: 'automated',
    remediation: 'Open an incident from a real finding and generate the 24-hour, 72-hour and final-report drafts.',
    references: [],
    sortOrder: 100,
  },
  {
    id: 'cra.incident.escalation',
    domain: 'Incident reporting',
    title: 'Ownership and escalation assigned',
    description: 'A named owner is responsible for filing reports, with a defined escalation path.',
    legalRef: 'Art. 14(1)',
    obligation: 'Reporting obligations require clear internal accountability to meet statutory deadlines.',
    weight: 2,
    evidenceTypes: ['policy', 'remediation'],
    evaluation: 'attested',
    remediation: 'Assign an owner to the incident workflow and document the escalation path.',
    references: [],
    sortOrder: 110,
  },

  // -------------------------------------------------------------------------
  // Secure development
  // -------------------------------------------------------------------------
  {
    id: 'cra.dev.disclosure',
    domain: 'Secure development',
    title: 'Coordinated vulnerability disclosure policy',
    description: 'A SECURITY.md (or equivalent) tells researchers how to report vulnerabilities.',
    legalRef: 'Annex I Part II(2)',
    obligation: 'Manufacturers must provide a channel for reporting vulnerabilities and handle reports without delay.',
    weight: 3,
    evidenceTypes: ['policy'],
    evaluation: 'automated',
    remediation: 'Add SECURITY.md at the repository root with a security contact and disclosure timeline.',
    references: [],
    sortOrder: 120,
  },
  {
    id: 'cra.dev.dependency_updates',
    domain: 'Secure development',
    title: 'Automated dependency update tooling',
    description: 'Dependabot, Renovate or equivalent is configured to raise update pull requests.',
    legalRef: 'Annex I Part II(1)',
    obligation: 'Products must be delivered with up-to-date components and no known exploitable vulnerabilities.',
    weight: 2,
    evidenceTypes: ['policy', 'scan_result'],
    evaluation: 'automated',
    remediation: 'Enable Dependabot or Renovate so security updates are proposed automatically.',
    references: [],
    sortOrder: 130,
  },
  {
    id: 'cra.dev.ci',
    domain: 'Secure development',
    title: 'Build and test automation',
    description: 'A CI pipeline builds and tests the product, providing reproducible build evidence.',
    legalRef: 'Annex I Part I(1)(f)',
    obligation: 'Products must be developed with an appropriate level of security and build integrity controls.',
    weight: 2,
    evidenceTypes: ['policy', 'scan_result'],
    evaluation: 'automated',
    remediation: 'Add a CI workflow that builds and tests on every push and pull request.',
    references: [],
    sortOrder: 140,
  },
  {
    id: 'cra.dev.code_review',
    domain: 'Secure development',
    title: 'Change review discipline',
    description: 'Code owners are defined and changes are reviewed before merge.',
    legalRef: 'Annex I Part I(1)(f)',
    obligation: 'Secure development requires controlled, reviewed change management.',
    weight: 1,
    evidenceTypes: ['policy'],
    evaluation: 'automated',
    remediation: 'Add a CODEOWNERS file and require review before merge.',
    references: [],
    sortOrder: 150,
  },
  {
    id: 'cra.dev.threat_model',
    domain: 'Secure development',
    title: 'Threat model or security design record',
    description: 'A threat model, security design document or architecture risk review exists.',
    legalRef: 'Annex I Part I(1)',
    obligation: 'Security must be considered by design, and documented as part of the technical file.',
    weight: 2,
    evidenceTypes: ['document', 'policy'],
    evaluation: 'hybrid',
    remediation: 'Upload a threat model or security design note for this product.',
    references: [],
    sortOrder: 160,
  },
  {
    id: 'cra.dev.sast',
    domain: 'Secure development',
    title: 'Static analysis or security scanning in CI',
    description: 'SAST, secret scanning or container scanning runs as part of the pipeline.',
    legalRef: 'Annex I Part I(1)(f)',
    obligation: 'Automated security testing is expected as part of secure development.',
    weight: 1.5,
    evidenceTypes: ['policy', 'scan_result'],
    evaluation: 'automated',
    remediation: 'Add a SAST or secret-scanning step (CodeQL, Semgrep, Trivy, gitleaks) to CI.',
    references: [],
    sortOrder: 170,
  },

  // -------------------------------------------------------------------------
  // Update & support
  // -------------------------------------------------------------------------
  {
    id: 'cra.support.period',
    domain: 'Update & support',
    title: 'Support period declared',
    description: 'The period during which security updates will be provided is declared (minimum 5 years for most products).',
    legalRef: 'Art. 13(8) + Annex I Part II',
    obligation: 'Manufacturers must specify and honour a support period for security updates.',
    weight: 3,
    evidenceTypes: ['policy', 'document'],
    evaluation: 'hybrid',
    remediation: 'Declare a support period on the product and publish it in the technical documentation.',
    references: [],
    sortOrder: 180,
  },
  {
    id: 'cra.support.updates_process',
    domain: 'Update & support',
    title: 'Security update delivery process',
    description: 'A process exists to build, test and ship security updates promptly.',
    legalRef: 'Art. 13(1)',
    obligation: 'Security updates must be released without delay once a fix is available.',
    weight: 2,
    evidenceTypes: ['policy', 'document'],
    evaluation: 'attested',
    remediation: 'Document how a security fix moves from triage to release.',
    references: [],
    sortOrder: 190,
  },
  {
    id: 'cra.support.integrity',
    domain: 'Update & support',
    title: 'Update integrity protection',
    description: 'Updates are signed or otherwise integrity-protected before distribution.',
    legalRef: 'Annex I Part I(2)(f)',
    obligation: 'Update mechanisms must be protected against tampering.',
    weight: 2,
    evidenceTypes: ['document', 'policy'],
    evaluation: 'attested',
    remediation: 'Sign release artifacts (Sigstore/cosign or package-manager signatures) and verify on install.',
    references: [],
    sortOrder: 200,
  },

  // -------------------------------------------------------------------------
  // Documentation
  // -------------------------------------------------------------------------
  {
    id: 'cra.doc.technical',
    domain: 'Documentation',
    title: 'Technical documentation assembled',
    description:
      'A technical file exists covering product description, components, support period and security properties.',
    legalRef: 'Annex I Part II + Annex VII',
    obligation: 'Manufacturers must draw up and keep technical documentation for the product.',
    weight: 3,
    evidenceTypes: ['document', 'sbom', 'report'],
    evaluation: 'hybrid',
    remediation: 'Generate the readiness report and attach the required documents to the evidence vault.',
    references: [],
    sortOrder: 210,
  },
  {
    id: 'cra.doc.user_information',
    domain: 'Documentation',
    title: 'User security information',
    description: 'Instructions and security information accompany the product (README or user docs).',
    legalRef: 'Annex I Part II(3)',
    obligation: 'Products must be accompanied by information and instructions for safe use.',
    weight: 1.5,
    evidenceTypes: ['document', 'policy'],
    evaluation: 'automated',
    remediation: 'Include secure configuration and update guidance in the README or user documentation.',
    references: [],
    sortOrder: 220,
  },
  {
    id: 'cra.doc.licensing',
    domain: 'Documentation',
    title: 'Third-party licence record',
    description: 'Licences for included components are recorded so obligations can be assessed.',
    legalRef: 'Annex I Part II(1)',
    obligation: 'Component documentation supports the assessment of the product as a whole.',
    weight: 1,
    evidenceTypes: ['sbom', 'document'],
    evaluation: 'automated',
    remediation: 'Declare licences in manifests so the SBOM captures them.',
    references: [],
    sortOrder: 230,
  },

  // -------------------------------------------------------------------------
  // Security properties
  // -------------------------------------------------------------------------
  {
    id: 'cra.sec.secure_defaults',
    domain: 'Security properties',
    title: 'Secure by default configuration',
    description: 'The product ships with secure default settings and no unnecessary services or credentials.',
    legalRef: 'Annex I Part I(2)(a)',
    obligation: 'Products must be delivered with a secure-by-default configuration.',
    weight: 2.5,
    evidenceTypes: ['document', 'policy'],
    evaluation: 'attested',
    remediation: 'Document the default configuration and confirm no default credentials or debug features ship enabled.',
    references: [],
    sortOrder: 240,
  },
  {
    id: 'cra.sec.access_control',
    domain: 'Security properties',
    title: 'Access control and authentication',
    description: 'Authentication, authorisation and access control mechanisms are documented and appropriate.',
    legalRef: 'Annex I Part I(2)(c)',
    obligation: 'Products must include appropriate access control mechanisms.',
    weight: 2,
    evidenceTypes: ['document', 'policy'],
    evaluation: 'attested',
    remediation: 'Attach an access control description or architecture note covering authentication and authorisation.',
    references: [],
    sortOrder: 250,
  },
  {
    id: 'cra.sec.data_protection',
    domain: 'Security properties',
    title: 'Confidentiality and integrity of data',
    description: 'Measures protecting stored and transmitted data are documented (encryption in transit and at rest).',
    legalRef: 'Annex I Part I(2)(b)',
    obligation: 'Products must protect the confidentiality and integrity of data at rest and in transit.',
    weight: 2,
    evidenceTypes: ['document', 'policy'],
    evaluation: 'attested',
    remediation: 'Document encryption and key handling for data at rest and in transit.',
    references: [],
    sortOrder: 260,
  },
  {
    id: 'cra.sec.logging',
    domain: 'Security properties',
    title: 'Logging and monitoring',
    description: 'Security-relevant events are logged and can be monitored or reviewed.',
    legalRef: 'Annex I Part I(2)(i)',
    obligation: 'Products must provide means to monitor and record security-relevant activity.',
    weight: 2,
    evidenceTypes: ['document', 'policy'],
    evaluation: 'attested',
    remediation: 'Describe what security events are logged, where they go, and who reviews them.',
    references: [],
    sortOrder: 270,
  },
  {
    id: 'cra.sec.input_validation',
    domain: 'Security properties',
    title: 'Input validation and error handling',
    description: 'Untrusted input is validated and errors are handled without leaking sensitive state.',
    legalRef: 'Annex I Part I(2)(d)',
    obligation: 'Products must limit the attack surface and handle erroneous input safely.',
    weight: 1.5,
    evidenceTypes: ['document', 'policy'],
    evaluation: 'attested',
    remediation: 'Document input validation and error handling expectations for the product.',
    references: [],
    sortOrder: 280,
  },

  // -------------------------------------------------------------------------
  // Governance
  // -------------------------------------------------------------------------
  {
    id: 'cra.gov.risk_assessment',
    domain: 'Governance',
    title: 'Cybersecurity risk assessment',
    description: 'A documented cybersecurity risk assessment exists for the product.',
    legalRef: 'Art. 13(2) + Annex I Part I(1)',
    obligation: 'Manufacturers must carry out a cybersecurity risk assessment and take it into account.',
    weight: 2.5,
    evidenceTypes: ['document'],
    evaluation: 'hybrid',
    remediation: 'Upload a risk assessment or link the threat model to this product.',
    references: [],
    sortOrder: 290,
  },
  {
    id: 'cra.gov.pen_test',
    domain: 'Governance',
    title: 'Independent security testing',
    description: 'Penetration test report or security review evidence exists for the product.',
    legalRef: 'Annex I Part I(1)',
    obligation: 'Security testing supports the assessment of the product against essential requirements.',
    weight: 1.5,
    evidenceTypes: ['document'],
    evaluation: 'attested',
    remediation: 'Attach a penetration test report or security review summary.',
    references: [],
    sortOrder: 300,
  },
  {
    id: 'cra.gov.conformity',
    domain: 'Governance',
    title: 'Conformity assessment plan',
    description: 'The conformity assessment route is identified and its evidence is being collected.',
    legalRef: 'Art. 32 + Annex VI',
    obligation: 'Products must undergo an applicable conformity assessment procedure before being placed on the market.',
    weight: 2,
    evidenceTypes: ['document', 'report'],
    evaluation: 'attested',
    remediation: 'Record which conformity assessment route applies (self-assessment or notified body) and why.',
    references: [],
    sortOrder: 310,
  },
  {
    id: 'cra.gov.supply_chain',
    domain: 'Governance',
    title: 'Supply chain due diligence',
    description: 'Third-party components are tracked and their provenance reviewed as part of supplier risk.',
    legalRef: 'Art. 13(4) + Annex I Part II(1)',
    obligation: 'Manufacturers must consider third-party components and the cybersecurity practices of suppliers.',
    weight: 2,
    evidenceTypes: ['sbom', 'document'],
    evaluation: 'hybrid',
    remediation: 'Review the component inventory for unmaintained or single-maintainer dependencies and record the outcome.',
    references: [],
    sortOrder: 320,
  },
  {
    id: 'cra.gov.retention',
    domain: 'Governance',
    title: 'Evidence retention configured',
    description: 'Evidence and technical documentation are retained for the required period.',
    legalRef: 'Art. 13(9) + Annex VII',
    obligation: 'Technical documentation must be kept available for the required retention period.',
    weight: 1,
    evidenceTypes: ['policy'],
    evaluation: 'automated',
    remediation: 'Raise the organisation retention period to at least the product support period.',
    references: [],
    sortOrder: 330,
  },
];

export function seedComplianceControls(): number {
  const db = getDb();
  const existing = new Set(db.select({ id: complianceControls.id }).from(complianceControls).all().map((r) => r.id));
  let inserted = 0;

  for (const control of CONTROL_CATALOGUE) {
    const values = {
      id: control.id,
      domain: control.domain,
      title: control.title,
      description: control.description,
      legalRef: control.legalRef,
      obligation: control.obligation,
      weight: control.weight,
      evidenceTypesJson: JSON.stringify(control.evidenceTypes),
      applicabilityRule: 'always',
      remediation: control.remediation,
      referencesJson: JSON.stringify(control.references),
      evaluation: control.evaluation,
      sortOrder: control.sortOrder,
      isActive: true,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    if (existing.has(control.id)) {
      db.update(complianceControls)
        .set({
          domain: values.domain,
          title: values.title,
          description: values.description,
          legalRef: values.legalRef,
          obligation: values.obligation,
          weight: values.weight,
          evidenceTypesJson: values.evidenceTypesJson,
          remediation: values.remediation,
          referencesJson: values.referencesJson,
          evaluation: values.evaluation,
          sortOrder: values.sortOrder,
          updatedAt: Date.now(),
        })
        .run();
    } else {
      db.insert(complianceControls).values(values).run();
      inserted += 1;
    }
  }

  return inserted;
}

export const CONTROL_IDS: string[] = CONTROL_CATALOGUE.map((c) => c.id);
export const DOMAINS: ControlDomain[] = [
  'Component transparency',
  'Vulnerability handling',
  'Incident reporting',
  'Secure development',
  'Update & support',
  'Documentation',
  'Security properties',
  'Governance',
];

export type { ComplianceControl };
