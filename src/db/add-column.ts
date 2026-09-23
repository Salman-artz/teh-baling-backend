import postgres from 'postgres';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error('FATAL: DATABASE_URL is not set.');
  process.exit(1);
}

const sql = postgres(connectionString, { ssl: 'require' });

async function addMissingColumn() {
  console.log('Adding qty_added column to report_stock_items if not exists...');
  await sql`
    ALTER TABLE report_stock_items 
    ADD COLUMN IF NOT EXISTS qty_added INT NOT NULL DEFAULT 0;
  `;
  console.log('✅ Column qty_added successfully added to report_stock_items in Aiven PostgreSQL!');
  await sql.end();
}

addMissingColumn().catch(console.error);
