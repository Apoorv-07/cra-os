import { eq, sql } from 'drizzle-orm';
import { getDb } from '../db/index.js';
import { intelSources, kevEntries, vulnerabilities } from '../db/schema.js';
import { env } from '../env.js';
import { log } from '../core/logger.js';

/**
 * CISA Known Exploited Vulnerabilities (KEV).
 *
 * KEV is the highest-signal feed for CRA purposes: it lists CVEs with confirmed
 * active exploitation in the wild. Under Article 14, an actively exploited
 * vulnerability in a shipped component is precisely what starts the 24-hour
 * reporting clock, so KEV membership is treated as a first-class signal
 * throughout the compliance engine rather than a badge.
 *
 * The source URL is configurable because cisa.gov applies bot filtering that
 * can block some networks; the official mirror (cisagov/kev-data) carries the
 * identical payload.
 */

interface KevCatalogue {
  catalogVersion?: string;
  dateReleased?: string;
  count?: number;
  vulnerabilities: Array<{
    cveID: string;
    vendorProject: string;
    product: string;
    vulnerabilityName: string;
    dateAdded: string;
    shortDescription: string;
    requiredAction: string;
    dueDate: string;
    knownRansomwareCampaignUse?: string;
    notes?: string;
  }>;
}

export interface KevSyncResult {
  ok: boolean;
  items: number;
  error?: string;
  source: string;
}

export async function syncKev(): Promise<KevSyncResult> {
  const db = getDb();
  const source = env.KEV_URL;

  try {
    const res = await fetch(source, {
      headers: { 'User-Agent': 'cra-compliance-os (+security-research)', Accept: 'application/json' },
    });

    if (!res.ok) {
      throw new Error(`KEV fetch failed (${res.status})`);
    }

    const catalogue = (await res.json()) as KevCatalogue;
    const entries = catalogue.vulnerabilities ?? [];

    const now = Date.now();
    db.transaction(() => {
      for (const entry of entries) {
        db.insert(kevEntries)
          .values({
            cveId: entry.cveID,
            vendorProject: entry.vendorProject ?? null,
            product: entry.product ?? null,
            vulnerabilityName: entry.vulnerabilityName ?? null,
            dateAdded: entry.dateAdded ?? null,
            shortDescription: entry.shortDescription ?? null,
            requiredAction: entry.requiredAction ?? null,
            dueDate: entry.dueDate ?? null,
            knownRansomware: entry.knownRansomwareCampaignUse ?? null,
            notes: entry.notes ?? null,
            updatedAt: now,
          })
          .onConflictDoUpdate({
            target: kevEntries.cveId,
            set: {
              vendorProject: entry.vendorProject ?? null,
              product: entry.product ?? null,
              vulnerabilityName: entry.vulnerabilityName ?? null,
              dateAdded: entry.dateAdded ?? null,
              shortDescription: entry.shortDescription ?? null,
              requiredAction: entry.requiredAction ?? null,
              dueDate: entry.dueDate ?? null,
              knownRansomware: entry.knownRansomwareCampaignUse ?? null,
              notes: entry.notes ?? null,
              updatedAt: now,
            },
          })
          .run();

        // Propagate the flag onto any vulnerability we already hold.
        db.update(vulnerabilities)
          .set({ kevFlag: true, kevDateAdded: entry.dateAdded ?? null, kevDueDate: entry.dueDate ?? null, updatedAt: now })
          .where(
            sql`(${vulnerabilities.id} = ${'osv:' + entry.cveID} or ${vulnerabilities.id} like ${'%' + entry.cveID + '%'} or ${vulnerabilities.aliasesJson} like ${'%"' + entry.cveID + '"%'})`,
          )
          .run();
      }
    });

    db.insert(intelSources)
      .values({
        key: 'kev',
        lastRunAt: now,
        lastSuccessAt: now,
        lastError: null,
        itemCount: entries.length,
        metaJson: JSON.stringify({ catalogueVersion: catalogue.catalogVersion, dateReleased: catalogue.dateReleased }),
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: intelSources.key,
        set: { lastRunAt: now, lastSuccessAt: now, lastError: null, itemCount: entries.length, updatedAt: now },
      })
      .run();

    log.info('kev synced', { items: entries.length });
    return { ok: true, items: entries.length, source };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error('kev sync failed', { error: message, source });

    getDb()
      .insert(intelSources)
      .values({ key: 'kev', lastRunAt: Date.now(), lastError: message, itemCount: 0, updatedAt: Date.now() })
      .onConflictDoUpdate({
        target: intelSources.key,
        set: { lastRunAt: Date.now(), lastError: message, updatedAt: Date.now() },
      })
      .run();

    return { ok: false, items: 0, error: message, source };
  }
}

export function isKev(cveIdOrAliases: string | string[] | null | undefined): boolean {
  const candidates = Array.isArray(cveIdOrAliases) ? cveIdOrAliases : cveIdOrAliases ? [cveIdOrAliases] : [];
  if (candidates.length === 0) return false;
  const db = getDb();
  for (const candidate of candidates) {
    const row = db.select({ cveId: kevEntries.cveId }).from(kevEntries).where(eq(kevEntries.cveId, candidate)).get();
    if (row) return true;
  }
  return false;
}

export function kevDetails(cveId: string) {
  return getDb().select().from(kevEntries).where(eq(kevEntries.cveId, cveId)).get() ?? null;
}

export function kevStatus() {
  return getDb().select().from(intelSources).where(eq(intelSources.key, 'kev')).get() ?? null;
}

export function kevCount(): number {
  const row = getDb().select({ c: sql<number>`count(*)` }).from(kevEntries).get();
  return Number(row?.c ?? 0);
}
