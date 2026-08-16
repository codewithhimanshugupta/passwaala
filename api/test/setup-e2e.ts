/**
 * E2E test setup — runs once per test file (setupFilesAfterEnv).
 *
 * Loads .env.test so DATABASE_URL points at the dedicated nearbaz_test DB, and
 * fails fast with a clear message if the test DB isn't reachable (Docker down /
 * migrations not deployed) rather than emitting confusing per-test errors.
 */
import { config } from 'dotenv';
import { join } from 'path';

// Load .env.test (overrides any ambient env for the test run).
config({ path: join(__dirname, '..', '.env.test'), override: true });

if (!process.env.DATABASE_URL || !process.env.DATABASE_URL.includes('nearbaz_test')) {
  throw new Error(
    'E2E tests must run against the nearbaz_test database. ' +
      'Check api/.env.test and that DATABASE_URL points at nearbaz_test.',
  );
}
