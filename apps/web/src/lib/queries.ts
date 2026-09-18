import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './api';

/**
 * Shared query hooks. Keys are organisation-scoped so switching organisations
 * never shows another tenant's cached data.
 */

export interface Repository {
  id: string;
  orgId: string;
  provider: string;
  name: string;
  fullName: string | null;
  owner: string | null;
  url: string | null;
  defaultBranch: string | null;
  status: string;
  monitoringEnabled: boolean;
  readinessScore: number | null;
  lastScanAt: number | null;
  lastScanId: string | null;
  badgeToken: string;
  badgeEnabled: boolean;
  createdAt: number;
}

export interface Scan {
  id: string;
  orgId: string;
  repositoryId: string;
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled' | 'skipped';
  trigger: string;
  ref: string | null;
  commitSha: string | null;
  componentCount: number;
  vulnerabilityCount: number;
  criticalCount: number;
  highCount: number;
  mediumCount: number;
  lowCount: number;
  kevCount: number;
  readinessScore: number | null;
  creditsCharged: number;
  durationMs: number | null;
  errorMessage: string | null;
  ecosystemsJson: string | null;
  manifestsJson: string | null;
  startedAt: number | null;
  finishedAt: number | null;
  createdAt: number;
}

export function useRepositories(orgId: string | null) {
  return useQuery({
    queryKey: ['repositories', orgId],
    queryFn: () => api.get<Repository[]>(`/organizations/${orgId}/repositories`),
    enabled: Boolean(orgId),
  });
}

export function useRepository(orgId: string | null, repositoryId: string | undefined) {
  return useQuery({
    queryKey: ['repository', repositoryId],
    queryFn: () => api.get<{ repository: Repository }>(`/organizations/${orgId}/repositories/${repositoryId}`).then((r) => r.repository),
    enabled: Boolean(orgId && repositoryId),
  });
}

export function useScans(orgId: string | null, repositoryId?: string) {
  return useQuery({
    queryKey: ['scans', orgId, repositoryId ?? 'all'],
    queryFn: () =>
      api.get<Scan[]>(`/organizations/${orgId}/scans${repositoryId ? `?repositoryId=${repositoryId}` : ''}`),
    enabled: Boolean(orgId),
    // A running scan must tick: this is the live status the whole product hangs on.
    refetchInterval: (query) => {
      const data = query.state.data as Scan[] | undefined;
      const active = data?.some((s) => s.status === 'queued' || s.status === 'running');
      return active ? 2500 : false;
    },
  });
}

export function useScanStatus(orgId: string | null, scanId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: ['scan-status', scanId],
    queryFn: () =>
      api.get<{
        status: string;
        progressPct: number;
        message: string | null;
        events: Array<{ status: string; progressPct: number; message: string | null; createdAt: number }>;
        error: string | null;
        ready: boolean;
      }>(`/organizations/${orgId}/scans/${scanId}/status`),
    enabled: Boolean(orgId && scanId) && enabled,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === 'queued' || status === 'running' ? 2000 : false;
    },
  });
}

export function useComponents(orgId: string | null, scanId: string | undefined) {
  return useQuery({
    queryKey: ['components', scanId],
    queryFn: () =>
      api.get<Array<{
        id: string;
        name: string;
        version: string | null;
        ecosystem: string;
        purl: string;
        scope: string;
        isDirect: boolean;
        manifestPath: string | null;
        licensesJson: string | null;
      }>>(`/organizations/${orgId}/scans/${scanId}/components`),
    enabled: Boolean(orgId && scanId),
  });
}

export interface VulnerabilityRow {
  id: string;
  state: string;
  fixedVersion: string | null;
  detectedAt: number;
  component: { id: string; name: string; version: string | null; ecosystem: string; purl: string };
  vulnerability: {
    id: string;
    sourceId: string;
    summary: string | null;
    severity: string | null;
    cvssScore: number | null;
    cvssVector: string | null;
    epssScore: number | null;
    kevFlag: boolean;
    fixedVersion?: string | null;
    publishedAt: number | null;
  };
}

export function useVulnerabilities(orgId: string | null, scanId: string | undefined) {
  return useQuery({
    queryKey: ['vulnerabilities', scanId],
    queryFn: () => api.get<VulnerabilityRow[]>(`/organizations/${orgId}/scans/${scanId}/vulnerabilities`),
    enabled: Boolean(orgId && scanId),
  });
}

export interface ReadinessAssessment {
  id: string;
  controlId: string;
  status: string;
  score: number;
  confidence: string;
  rationale: string;
  remediation: string | null;
  evidenceJson: string | null;
  title?: string;
  domain?: string;
  weight?: number;
  legalRef?: string;
  obligation?: string;
}

export interface Readiness {
  score: number;
  grade: string;
  domains: Array<{ id: string; name: string; score: number; controls: number }>;
  assessments: ReadinessAssessment[];
  topActions: string[];
  evaluatedAt: number;
}

export function useReadiness(orgId: string | null, repositoryId: string | undefined) {
  return useQuery({
    queryKey: ['readiness', repositoryId],
    queryFn: () => api.get<Readiness>(`/organizations/${orgId}/repositories/${repositoryId}/readiness`),
    enabled: Boolean(orgId && repositoryId),
  });
}

export function useOrgReadiness(orgId: string | null) {
  return useQuery({
    queryKey: ['readiness-org', orgId],
    queryFn: () => api.get<Readiness>(`/organizations/${orgId}/readiness`),
    enabled: Boolean(orgId),
  });
}

export interface Incident {
  id: string;
  title: string;
  state: string;
  severity: string;
  awarenessAt: number;
  earlyWarningDueAt: number | null;
  notificationDueAt: number | null;
  finalReportDueAt: number | null;
  kevFlag: boolean;
  activelyExploited: boolean;
  repositoryId: string;
  createdAt: number;
}

export function useIncidents(orgId: string | null) {
  return useQuery({
    queryKey: ['incidents', orgId],
    queryFn: () => api.get<Incident[]>(`/organizations/${orgId}/incidents`),
    enabled: Boolean(orgId),
  });
}

export function useBilling(orgId: string | null) {
  return useQuery({
    queryKey: ['billing', orgId],
    queryFn: () =>
      api.get<{
        balance: number;
        lifetimePurchased: number;
        lifetimeGranted: number;
        lifetimeConsumed: number;
        currency: string;
        planKey: string;
        paymentsEnabled: boolean;
        autoTopup: { enabled: boolean; thresholdCredits: number; packKey: string | null };
      }>(`/organizations/${orgId}/billing`),
    enabled: Boolean(orgId),
    refetchInterval: 30_000,
  });
}

export function useLedger(orgId: string | null) {
  return useQuery({
    queryKey: ['ledger', orgId],
    queryFn: () =>
      api.get<
        Array<{
          id: string;
          type: string;
          amount: number;
          balanceAfter: number;
          description: string | null;
          createdAt: number;
        }>
      >(`/organizations/${orgId}/billing/ledger?limit=100`),
    enabled: Boolean(orgId),
  });
}

export function usePricing() {
  return useQuery({
    queryKey: ['pricing'],
    queryFn: () =>
      api.get<{
        currency: string;
        packs: Array<{
          id: string;
          key: string;
          name: string;
          credits: number;
          bonusCredits: number;
          priceCents: number;
          currency: string;
          popular: boolean;
        }>;
        plans: Array<{ id: string; key: string; name: string; priceCents: number; creditsIncluded: number; features: string[] }>;
        usageRules: Array<{ action: string; label: string; credits: number }>;
      }>('/billing/pricing'),
    staleTime: 5 * 60_000,
  });
}

/** Starts a scan and invalidates the dependent caches. */
export function useStartScan(orgId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (repositoryId: string) => api.post<{ scanId: string }>(`/organizations/${orgId}/repositories/${repositoryId}/scan`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['scans', orgId] });
      void qc.invalidateQueries({ queryKey: ['repositories', orgId] });
    },
  });
}

// ---------------------------------------------------------------------------
// Findings — the unified "what is wrong" surface
// ---------------------------------------------------------------------------

export type FindingPriority = 'act_now' | 'prioritise' | 'monitor' | 'review';

export interface Finding {
  id: string;
  state: string;
  priority: FindingPriority;
  headline: string;
  whyItMatters: string;
  remediation: string | null;
  slaDueAt: number | null;
  exploitability: string | null;
  exposure: string | null;
  detectedAt: number;
  repository: { id: string; name: string; monitoringEnabled: boolean };
  component: {
    id: string;
    name: string;
    version: string | null;
    ecosystem: string;
    purl: string;
    isDirect: boolean;
    manifestPath: string | null;
  };
  vulnerability: {
    id: string;
    sourceId: string;
    summary: string | null;
    severity: string | null;
    cvssScore: number | null;
    cvssVector: string | null;
    epssScore: number | null;
    kevFlag: boolean;
    publishedAt: number | null;
    fixedVersion: string | null;
  };
  cra: Array<{ controlId: string; title: string }>;
}

export interface FindingSummary {
  total: number;
  open: number;
  actNow: number;
  prioritise: number;
  monitor: number;
  knownExploited: number;
  bySeverity: { critical: number; high: number; medium: number; low: number; unknown: number };
  overdueSla: number;
  repositoriesAffected: number;
}

export function useFindings(
  orgId: string | null,
  filters: { severity?: string; priority?: string; state?: string; repositoryId?: string; kev?: string; q?: string } = {},
) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value) params.set(key, value);
  }
  const query = params.toString();
  return useQuery({
    queryKey: ['findings', orgId, filters],
    queryFn: () =>
      api.get<{ summary: FindingSummary; rows: Finding[]; total: number }>(
        `/organizations/${orgId}/findings${query ? `?${query}` : ''}`,
      ),
    enabled: Boolean(orgId),
  });
}

export function useTriageFinding(orgId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ findingId, state, note }: { findingId: string; state: string; note?: string }) =>
      api.post(`/organizations/${orgId}/findings/${findingId}/triage`, { state, note }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['findings', orgId] });
      void qc.invalidateQueries({ queryKey: ['readiness-org', orgId] });
      void qc.invalidateQueries({ queryKey: ['repositories', orgId] });
    },
  });
}

// ---------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------

export interface ReportRow {
  id: string;
  kind: 'readiness' | 'findings' | 'evidence_pack';
  title: string;
  status: string;
  repositoryId: string | null;
  creditsCharged: number;
  createdAt: number;
  shared: boolean;
  shareToken: string | null;
  shareExpiresAt: number | null;
  shareViewCount: number;
}

export interface ReportSection {
  id: string;
  heading: string;
  kind: 'prose' | 'list' | 'table' | 'metrics';
  body?: string;
  items?: Array<{ title: string; detail?: string; tone?: 'neutral' | 'warning' | 'critical' | 'good' }>;
  table?: { columns: string[]; rows: Array<Array<string | number>> };
  metrics?: Array<{ label: string; value: string; description?: string }>;
}

export interface ReportDetail {
  id: string;
  kind: string;
  title: string;
  status: string;
  createdAt: number;
  repositoryId: string | null;
  creditsCharged: number;
  organisation: string;
  share: { token: string; expiresAt: number | null; viewCount: number; lastViewedAt: number | null } | null;
  content: {
    kind: string;
    scope: string;
    score?: number;
    grade?: string;
    organisation: string;
    generatedAt: number;
    sections: ReportSection[];
    disclaimer: string;
  } | null;
}

export function useReports(orgId: string | null) {
  return useQuery({
    queryKey: ['reports', orgId],
    queryFn: () => api.get<ReportRow[]>(`/organizations/${orgId}/reports`),
    enabled: Boolean(orgId),
  });
}

export function useReport(orgId: string | null, reportId: string | null) {
  return useQuery({
    queryKey: ['report', reportId],
    queryFn: () => api.get<ReportDetail>(`/organizations/${orgId}/reports/${reportId}`),
    enabled: Boolean(orgId && reportId),
  });
}

export function useGenerateReport(orgId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { kind: 'readiness' | 'findings' | 'evidence_pack'; repositoryId?: string; title?: string }) =>
      api.post<{ id: string; title: string; kind: string; creditsCharged: number }>(
        `/organizations/${orgId}/reports`,
        input,
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['reports', orgId] });
      void qc.invalidateQueries({ queryKey: ['billing', orgId] });
    },
  });
}

export function useShareReport(orgId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ reportId, expiresInDays }: { reportId: string; expiresInDays?: number }) =>
      api.post<{ token: string; url: string }>(`/organizations/${orgId}/reports/${reportId}/share`, { expiresInDays }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['reports', orgId] });
      void qc.invalidateQueries({ queryKey: ['report'] });
    },
  });
}

export function useRevokeShare(orgId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (reportId: string) => api.del(`/organizations/${orgId}/reports/${reportId}/share`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['reports', orgId] });
      void qc.invalidateQueries({ queryKey: ['report'] });
    },
  });
}

// ---------------------------------------------------------------------------
// Overview (estate-level readiness)
// ---------------------------------------------------------------------------

export interface AttentionItem {
  id: string;
  kind: string;
  title: string;
  why: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  repositoryId: string | null;
  repositoryName: string | null;
  href: string | null;
  count: number;
  dueAt: number | null;
}

export interface EstateReadiness {
  score: number;
  grade: string;
  evaluatedAt: number;
  totals: { passed: number; partial: number; missing: number; needsReview: number; notApplicable: number };
  domains: Array<{ domain: string; name: string; shortName: string; score: number; controls: number }>;
  assessments: Array<{
    controlId: string;
    title: string;
    domain: string;
    domainName: string | null;
    status: string;
    score: number;
    confidence: string;
    rationale: string;
    remediation: string;
    evidence: string[];
    repositories: Array<{ id: string; name: string; status: string }>;
  }>;
  topActions: string[];
  actions: Array<{
    controlId: string;
    title: string;
    rationale: string;
    impact: number;
    remediation: string;
    repositoryId?: string;
    repositoryName?: string;
  }>;
  attention: AttentionItem[];
  inventory: { components: number; ecosystems: string[]; repositories: number };
  repositories: Array<{
    id: string;
    name: string;
    score: number;
    grade: string;
    lastScanAt: number | null;
    openCritical: number;
    openHigh: number;
    openKev: number;
  }>;
}

export function useEstateReadiness(orgId: string | null) {
  return useQuery({
    queryKey: ['readiness-org', orgId],
    queryFn: () => api.get<EstateReadiness>(`/organizations/${orgId}/readiness`),
    enabled: Boolean(orgId),
  });
}

// ---------------------------------------------------------------------------
// Control catalogue — needed wherever a control id would otherwise be shown
// to a human.
// ---------------------------------------------------------------------------

export interface Control {
  id: string;
  domain: string;
  title: string;
  description: string;
  legalRef: string;
  obligation: string;
  weight: number;
  evaluation: 'automated' | 'attested' | 'hybrid';
  remediation: string;
  sortOrder: number;
}

export function useControls(orgId: string | null) {
  return useQuery({
    queryKey: ['controls', orgId],
    queryFn: () => api.get<Control[]>(`/organizations/${orgId}/controls`),
    enabled: Boolean(orgId),
    staleTime: 5 * 60_000,
  });
}
