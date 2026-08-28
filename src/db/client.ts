import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres, { type Sql } from 'postgres';
import * as schema from './schema.js';

export type AfsDatabase = PostgresJsDatabase<typeof schema>;

export interface DatabaseConnection {
  db: AfsDatabase;
  sql: Sql;
  close: () => Promise<void>;
}

export interface DatabaseConnectionOptions {
  connectionString?: string;
  maxConnections?: number;
}

/**
 * Server/worker-only connection. `prepare: false` is compatible with Supabase's
 * transaction pooler; callers own the lifecycle and must call close().
 */
export function createDatabaseConnection(options: DatabaseConnectionOptions = {}): DatabaseConnection {
  const connectionString = options.connectionString ?? process.env.SUPABASE_DB_URL;
  if (!connectionString) throw new Error('SUPABASE_DB_URL is required');

  const sql = postgres(connectionString, {
    max: options.maxConnections ?? 5,
    prepare: false,
  });

  return {
    db: drizzle(sql, { schema }),
    sql,
    close: () => sql.end(),
  };
}
