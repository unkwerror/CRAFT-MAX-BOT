import { fileURLToPath } from 'node:url';

import { createDatabaseClient } from '@craft72/database';
import { migrate } from 'drizzle-orm/node-postgres/migrator';

const connectionString = process.env.DATABASE_URL;

if (typeof connectionString !== 'string' || connectionString.length === 0) {
  console.error('DATABASE_URL is required for migrations.');
  process.exit(2);
}

const positiveInteger = (name, fallback) => {
  const rawValue = process.env[name];
  if (rawValue === undefined) return fallback;
  if (!/^[1-9][0-9]*$/u.test(rawValue)) {
    console.error(`${name} must be a positive integer.`);
    process.exit(2);
  }
  return Number(rawValue);
};

const databaseClient = createDatabaseClient({
  connectionString,
  max: 1,
  connectionTimeoutMillis: positiveInteger('DB_CONNECTION_TIMEOUT_MS', 5_000),
  statement_timeout: positiveInteger('DB_STATEMENT_TIMEOUT_MS', 10_000),
  application_name: 'craft72-stage3-migrations',
});

const migrationsFolder = fileURLToPath(
  new URL('./node_modules/@craft72/database/drizzle/', import.meta.url),
);

try {
  await migrate(databaseClient.db, { migrationsFolder });
  console.log('All pending database migrations were applied.');
} catch {
  console.error('Database migration failed; connection details were suppressed.');
  process.exitCode = 1;
} finally {
  await databaseClient.close();
}
