import postgres from 'postgres';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error('FATAL: DATABASE_URL is not set.');
  process.exit(1);
}

const sql = postgres(connectionString, { ssl: 'require' });

async function checkColumns() {
  const stockCols = await sql`
    SELECT column_name, data_type 
    FROM information_schema.columns 
    WHERE table_name = 'report_stock_items';
  `;
  console.log('Columns in report_stock_items:');
  console.table(stockCols);

  const reportCols = await sql`
    SELECT column_name, data_type 
    FROM information_schema.columns 
    WHERE table_name = 'daily_reports';
  `;
  console.log('Columns in daily_reports:');
  console.table(reportCols);

  const constraints = await sql`
    SELECT conname, contype, pg_get_constraintdef(c.oid)
    FROM pg_constraint c
    JOIN pg_namespace n ON n.oid = c.connamespace
    WHERE conrelid = 'daily_reports'::regclass;
  `;
  console.log('Constraints on daily_reports:');
  console.table(constraints);

  await sql.end();
}

checkColumns().catch(console.error);
