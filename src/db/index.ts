import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema/index.js';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error('FATAL: DATABASE_URL environment variable is not set. Server cannot start.');
  process.exit(1);
}

// Serverless-optimized connection pool settings
const client = postgres(connectionString, {
  ssl: 'require',
  max: 1, // Single connection per serverless function instance to avoid pool starvation
  idle_timeout: 10,
  connect_timeout: 10,
  prepare: false, // Essential for connection poolers like PgBouncer / Aiven
});

export const db = drizzle(client, { schema });
