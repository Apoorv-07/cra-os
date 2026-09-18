import { beforeAll, afterAll } from 'vitest';
import { runMigrations } from '../src/db/migrate.js';
import { closeDb, getDb } from '../src/db/index.js';
import { seedComplianceControls } from '../src/compliance/controls.js';
import { seedPricingCatalogue } from '../src/routes/billing.js';
import { seedUsageRules } from '../src/modules/billing/usage-rules.js';

/**
 * Test bootstrap.
 *
 * Every test file gets a fresh in-memory SQLite database with the real
 * migrations applied. That is the point: the tests exercise the same schema and
 * the same code paths as production, not a hand-rolled mock database.
 */

beforeAll(() => {
  runMigrations();
  seedUsageRules();
  seedPricingCatalogue();
  seedComplianceControls();
  // Touch the connection so failures surface here rather than in a random test.
  getDb();
});

afterAll(() => {
  try {
    closeDb();
  } catch {
    /* already closed */
  }
});
