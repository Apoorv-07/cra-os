/**
 * OpenAPI 3.1 specification.
 *
 * Hand-maintained rather than generated: it is the public contract for the API,
 * CI/CD integrations and the GitHub Action, so it is written to be read by
 * humans first and machines second.
 */

const json = (description: string, example?: unknown) => ({
  description,
  ...(example ? { example } : {}),
});

const errorResponse = {
  description: 'Error response.',
  content: {
    'application/json': {
      schema: {
        type: 'object',
        properties: {
          error: {
            type: 'object',
            properties: {
              code: { type: 'string' },
              message: { type: 'string' },
              details: {},
              hint: { type: 'string', nullable: true },
            },
          },
        },
      },
    },
  },
};

const bearer = [{ bearerAuth: [] }, { apiKeyAuth: [] }];

export function openApiDocument(): Record<string, unknown> {
  return {
    openapi: '3.1.0',
    info: {
      title: 'CRA Compliance OS API',
      version: '1.0.0',
      description:
        'Continuous EU Cyber Resilience Act compliance: SBOM generation, vulnerability intelligence, readiness scoring, evidence and Article 14 reporting.',
      contact: { name: 'CRA Compliance OS', url: 'https://example.com' },
    },
    servers: [{ url: '/api/v1', description: 'Versioned API root' }],
    security: [],
    tags: [
      { name: 'auth' },
      { name: 'organizations' },
      { name: 'repositories' },
      { name: 'scans' },
      { name: 'compliance' },
      { name: 'evidence' },
      { name: 'incidents' },
      { name: 'billing' },
      { name: 'admin' },
    ],
    paths: {
      '/auth/me': {
        get: {
          tags: ['auth'],
          summary: 'Current user, organisations and platform capabilities',
          security: bearer,
          responses: { 200: json('OK'), 401: errorResponse },
        },
      },
      '/organizations/{orgId}/repositories': {
        get: { tags: ['repositories'], summary: 'List repositories', security: bearer, responses: { 200: json('OK') } },
        post: {
          tags: ['repositories'],
          summary: 'Register a repository and optionally scan it immediately',
          security: bearer,
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['owner', 'name'],
                  properties: {
                    owner: { type: 'string' },
                    name: { type: 'string' },
                    fullName: { type: 'string' },
                    url: { type: 'string' },
                    defaultBranch: { type: 'string' },
                    projectId: { type: 'string' },
                    provider: { type: 'string', enum: ['github', 'gitlab', 'upload', 'other'] },
                    autoScan: { type: 'boolean' },
                  },
                },
              },
            },
          },
          responses: { 201: json('Created', { id: 'repo_x', scanId: 'scan_x' }) },
        },
      },
      '/organizations/{orgId}/repositories/{repositoryId}/scan': {
        post: {
          tags: ['scans'],
          summary: 'Start a scan (reserves credits, returns immediately)',
          security: bearer,
          responses: { 201: json('Scan queued', { scanId: 'scan_x' }), 402: errorResponse },
        },
      },
      '/organizations/{orgId}/repositories/upload': {
        post: {
          tags: ['scans'],
          summary: 'Scan a .tar.gz or .tgz source archive without connecting a git provider',
          security: bearer,
          requestBody: {
            content: {
              'multipart/form-data': {
                schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' }, name: { type: 'string' } } },
              },
            },
          },
          responses: { 201: json('Created') },
        },
      },
      '/organizations/{orgId}/scans/{scanId}/status': {
        get: { tags: ['scans'], summary: 'Poll scan progress and stage events', security: bearer, responses: { 200: json('OK') } },
      },
      '/organizations/{orgId}/scans/{scanId}/components': {
        get: { tags: ['scans'], summary: 'Component inventory for a scan', security: bearer, responses: { 200: json('OK') } },
      },
      '/organizations/{orgId}/scans/{scanId}/vulnerabilities': {
        get: { tags: ['scans'], summary: 'Matched vulnerabilities with components', security: bearer, responses: { 200: json('OK') } },
      },
      '/organizations/{orgId}/repositories/{repositoryId}/readiness': {
        get: { tags: ['compliance'], summary: 'Explainable CRA readiness score', security: bearer, responses: { 200: json('OK') } },
      },
      '/organizations/{orgId}/repositories/{repositoryId}/evidence-pack': {
        post: { tags: ['evidence'], summary: 'Generate a checksummed evidence pack', security: bearer, responses: { 201: json('Created') } },
      },
      '/organizations/{orgId}/incidents': {
        post: {
          tags: ['incidents'],
          summary: 'Open an Article 14 incident from a vulnerability finding',
          security: bearer,
          requestBody: {
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['componentVulnerabilityId'],
                  properties: { componentVulnerabilityId: { type: 'string' }, activelyExploited: { type: 'boolean' } },
                },
              },
            },
          },
          responses: { 201: json('Created', { id: 'inc_x' }) },
        },
      },
      '/organizations/{orgId}/incidents/{incidentId}/drafts': {
        post: {
          tags: ['incidents'],
          summary: 'Generate the 24h / 72h / 14-day report drafts',
          security: bearer,
          responses: { 201: json('Created') },
        },
      },
      '/organizations/{orgId}/billing/checkout': {
        post: { tags: ['billing'], summary: 'Create a payment checkout session', security: bearer, responses: { 201: json('Created') } },
      },
      '/billing/pricing': {
        get: { tags: ['billing'], summary: 'Public credit packs, plans and usage rules', responses: { 200: json('OK') } },
      },
    },
    components: {
      securitySchemes: {
        bearerAuth: { type: 'http', scheme: 'bearer', description: 'Session token or API key.' },
        apiKeyAuth: { type: 'apiKey', in: 'header', name: 'X-API-Key' },
      },
    },
  };
}
