/** Presentation helpers. All timestamps are stored as UTC epoch milliseconds. */

export type Severity = 'critical' | 'high' | 'medium' | 'low' | 'unknown';

export const SEVERITY_COLOUR: Record<Severity, string> = {
  critical: 'var(--color-critical)',
  high: 'var(--color-high)',
  medium: 'var(--color-medium)',
  low: 'var(--color-low)',
  unknown: 'var(--color-faint)',
};

export const SEVERITY_CLASS: Record<Severity, string> = {
  critical: 'text-critical border-critical/30 bg-critical/10',
  high: 'text-high border-high/30 bg-high/10',
  medium: 'text-medium border-medium/30 bg-medium/10',
  low: 'text-low border-low/30 bg-low/10',
  unknown: 'text-faint border-border bg-surface-2',
};

export type ControlStatus = 'passed' | 'partial' | 'missing' | 'not_applicable' | 'needs_review';

/**
 * Control statuses, in the words a compliance lead would use to a director.
 * "Gap" and "Review" are fine in an engineer's table and useless in a board
 * pack, so the labels describe the state of the obligation, not the enum.
 */
export const STATUS_LABEL: Record<ControlStatus, string> = {
  passed: 'Met',
  partial: 'Partially met',
  missing: 'Needs attention',
  not_applicable: 'Not applicable',
  needs_review: 'Needs confirmation',
};

export const STATUS_CLASS: Record<ControlStatus, string> = {
  passed: 'text-pass border-pass/30 bg-pass/10',
  partial: 'text-partial border-partial/30 bg-partial/10',
  missing: 'text-fail border-fail/30 bg-fail/10',
  not_applicable: 'text-faint border-border bg-surface-2',
  needs_review: 'text-info border-info/30 bg-info/10',
};

export function severity(value: string | null | undefined): Severity {
  const v = (value ?? '').toLowerCase();
  return v === 'critical' || v === 'high' || v === 'medium' || v === 'low' ? v : 'unknown';
}

export function gradeColour(grade: string | null | undefined): string {
  switch ((grade ?? '').toUpperCase()) {
    case 'A':
      return 'var(--color-pass)';
    case 'B':
      return '#7dd3a0';
    case 'C':
      return 'var(--color-partial)';
    case 'D':
      return 'var(--color-high)';
    case 'E':
      return 'var(--color-critical)';
    default:
      return 'var(--color-faint)';
  }
}

const DATE_FMT = new Intl.DateTimeFormat('en-GB', {
  year: 'numeric',
  month: 'short',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'UTC',
  timeZoneName: 'short',
});

export function formatDate(ms: number | null | undefined): string {
  if (!ms) return '—';
  return DATE_FMT.format(new Date(ms));
}

export function formatDateShort(ms: number | null | undefined): string {
  if (!ms) return '—';
  return new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(
    new Date(ms),
  );
}

/** "in 3h", "2d ago" — for Article 14 clocks, where the countdown is the point. */
export function relativeTime(ms: number | null | undefined, now = Date.now()): string {
  if (!ms) return '—';
  const diff = ms - now;
  const abs = Math.abs(diff);
  const units: Array<[Intl.RelativeTimeFormatUnit, number]> = [
    ['day', 86_400_000],
    ['hour', 3_600_000],
    ['minute', 60_000],
  ];
  const fmt = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
  for (const [unit, size] of units) {
    if (abs >= size || unit === 'minute') return fmt.format(Math.round(diff / size), unit);
  }
  return fmt.format(Math.round(diff / 60_000), 'minute');
}

export function formatNumber(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—';
  return new Intl.NumberFormat('en-US').format(n);
}

export function formatMoney(cents: number, currency = 'USD'): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency, minimumFractionDigits: cents % 100 === 0 ? 0 : 2 }).format(
    cents / 100,
  );
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** Truncates advisory ids and purls without hiding the discriminating part. */
export function truncate(value: string, max = 42): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max - 1)}…`;
}

export function ecosystemLabel(id: string): string {
  const map: Record<string, string> = {
    npm: 'npm',
    pypi: 'PyPI',
    go: 'Go',
    crates: 'Cargo',
    maven: 'Maven',
    composer: 'Composer',
    nuget: 'NuGet',
    rubygems: 'RubyGems',
    hex: 'Hex',
    docker: 'Container',
  };
  return map[id] ?? id;
}

export function initials(name: string | null | undefined, email: string): string {
  const source = (name ?? email ?? '?').trim();
  const parts = source.split(/[\s@._-]+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[1]![0]!).toUpperCase();
}

export function cx(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(' ');
}

/**
 * Incident states.
 *
 * These are Article 14 milestones, not a generic workflow, so the labels say
 * what has actually happened rather than hiding it behind "investigating":
 * under an active incident, "early warning drafted" and "notified" are facts
 * someone is accountable for.
 */
export const INCIDENT_STATE_LABEL: Record<string, string> = {
  detected: 'Detected',
  triage: 'Triaging',
  assessing: 'Assessing',
  early_warning_drafted: 'Early warning drafted',
  notified: 'Notified',
  final_reported: 'Final report filed',
  closed: 'Closed',
};

export const INCIDENT_STATE_CLASS: Record<string, string> = {
  detected: 'border-fail/30 bg-fail/10 text-fail',
  triage: 'border-partial/30 bg-partial/10 text-partial',
  assessing: 'border-partial/30 bg-partial/10 text-partial',
  early_warning_drafted: 'border-info/30 bg-info/10 text-info',
  notified: 'border-info/30 bg-info/10 text-info',
  final_reported: 'border-pass/30 bg-pass/10 text-pass',
  closed: 'border-border bg-surface-2 text-faint',
};

/** The order an incident moves through, for progress displays. */
export const INCIDENT_PROGRESS: string[] = [
  'detected',
  'triage',
  'assessing',
  'early_warning_drafted',
  'notified',
  'final_reported',
  'closed',
];

export function incidentLabel(state: string): string {
  return INCIDENT_STATE_LABEL[state] ?? state.replace(/_/g, ' ');
}
