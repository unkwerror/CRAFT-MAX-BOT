import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool, type PoolConfig } from 'pg';

import * as schema from './schema.js';

export * from './schema.js';

export type Database = NodePgDatabase<typeof schema>;

export interface DatabaseClient {
  readonly db: Database;
  readonly pool: Pool;
  close(): Promise<void>;
}

export function createDatabase(pool: Pool): Database {
  return drizzle(pool, { schema });
}

export function createDatabaseClient(config: PoolConfig | string): DatabaseClient {
  const pool = new Pool(typeof config === 'string' ? { connectionString: config } : config);

  return {
    db: createDatabase(pool),
    pool,
    close: () => pool.end(),
  };
}
