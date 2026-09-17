import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema/index.js';

// C-5 fix: Database URL WAJIB dari environment variable, tidak boleh hardcoded
const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error('FATAL: DATABASE_URL environment variable is not set. Server cannot start.');
  process.exit(1);
}

const client = postgres(connectionString, {
  ssl: 'require',
  max: 1,
  idle_timeout: 20,
  connect_timeout: 10,
});
export const db = drizzle(client, { schema });
