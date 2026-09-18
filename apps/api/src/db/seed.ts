import { eq } from 'drizzle-orm';
import { getDb } from './index.js';
import { featureFlags, intelSources, kevEntries, users } from './schema.js';
import { seedComplianceControls } from '../compliance/controls.js';
import { seedPricingCatalogue } from '../routes/billing.js';
import { seedUsageRules } from '../modules/billing/usage-rules.js';
import { enqueue } from '../jobs/queue.js';
import { env, env as appEnv } from '../env.js';
import { log } from '../core/logger.js';

/**
 * Idempotent reference-data seed.
 *
 * Safe to run on every boot: every insert is guarded by a lookup, so this is
 * what makes a deployment deterministic rather than a manual setup step.
 */
export function seedDatabase(): void {
  const db = getDb();

  const controls = seedComplianceControls();
  seedUsageRules();
  seedPricingCatalogue();

  const flags: Array<{ key: string; enabled: boolean; description: string }> = [
    { key: 'public_badges', enabled: env.PUBLIC_BADGES, description: 'Serve public readiness badges.' },
    { key: 'auto_topup', enabled: true, description: 'Automatic credit top-up when balance falls below threshold.' },
    { key: 'ai_drafts', enabled: env.AI_PROVIDER !== 'none', description: 'Allow model-drafted Article 14 reports.' },
    { key: 'share_links', enabled: true, description: 'Read-only shareable reports and evidence.' },
    { key: 'referrals', enabled: true, description: 'Referral credit bonuses.' },
    { key: 'scheduled_monitoring', enabled: true, description: 'Recurring repository scans.' },
  ];

  for (const flag of flags) {
    const existing = db.select().from(featureFlags).where(eq(featureFlags.key, flag.key)).get();
    if (existing) continue;
    db.insert(featureFlags)
      .values({
        key: flag.key,
        enabled: flag.enabled,
        description: flag.description,
        rolloutPct: 100,
        updatedAt: Date.now(),
      })
      .run();
  }

  // First boot: queue exploit-intelligence ingestion so KEV matching works
  // from the very first scan rather than after the first scheduled run.
  const kevStatusRow = db.select().from(intelSources).where(eq(intelSources.key, 'kev')).get();
  if (!kevStatusRow) {
    enqueue({ type: 'intel.kev.sync', payload: {}, dedupeKey: 'intel.kev.sync' });
    log.info('queued initial KEV ingestion');
  }

  // Promote the configured admin emails, so the console is reachable after a
  // fresh deploy without manual database surgery.
  for (const email of appEnv.adminEmails) {
    const user = db.select().from(users).where(eq(users.emailNormalised, email)).get();
    if (user && !user.isSystemAdmin) {
      db.update(users).set({ isSystemAdmin: true, updatedAt: Date.now() }).where(eq(users.id, user.id)).run();
      log.info('promoted system admin', { email });
    }
  }

  if (controls > 0) log.info('seeded compliance controls', { inserted: controls });
  const kevCount = db.select().from(kevEntries).get();
  void kevCount;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  seedDatabase();
  log.info('seed complete');
  process.exit(0);
}
