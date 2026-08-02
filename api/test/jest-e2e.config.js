/**
 * Jest E2E / integration config (plan → Testing Standard: integration tests hit
 * a REAL Postgres test DB, not mocks). Runs *.e2e-spec.ts files under test/.
 *
 * These require the Docker Postgres+PostGIS container up and the passwala_test
 * database migrated (npm run test:e2e handles setup). Kept separate from the
 * unit jest config in package.json (which runs src/ *.spec.ts, DB-free).
 */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: '..',
  roots: ['<rootDir>/test'],
  moduleFileExtensions: ['js', 'json', 'ts'],
  testRegex: '.*\\.e2e-spec\\.ts$',
  transform: {
    '^.+\\.ts$': 'ts-jest',
  },
  // Load .env.test + open a shared Prisma client before the suite.
  setupFilesAfterEnv: ['<rootDir>/test/setup-e2e.ts'],
  // Integration tests touch a real DB and boot Nest — give them room.
  testTimeout: 30000,
  // A single worker: tests share one test DB and truncate between cases, so
  // parallel workers would race on the same tables.
  maxWorkers: 1,
};
