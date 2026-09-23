import 'dotenv/config';
import postgres from 'postgres';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error('FATAL: DATABASE_URL is not set.');
  process.exit(1);
}

const sql = postgres(connectionString, { ssl: 'require' });

async function listAll() {
  const series = await sql`
    SELECT ts.id, ts.name, ts.description, ts.is_active, COUNT(tp.id) as product_count
    FROM tea_series ts
    LEFT JOIN tea_products tp ON tp.series_id = ts.id
    GROUP BY ts.id, ts.name, ts.description, ts.is_active
    ORDER BY ts.name;
  `;
  console.log('=== ALL SERIES ===');
  console.log(series);

  const products = await sql`
    SELECT tp.id, tp.name, tp.description, tp.is_active, ts.name as series_name, tp.created_at
    FROM tea_products tp
    LEFT JOIN tea_series ts ON tp.series_id = ts.id
    ORDER BY ts.name, tp.name;
  `;
  console.log('\n=== ALL PRODUCTS ===');
  console.log(products);

  await sql.end();
}

listAll().catch((err) => {
  console.error(err);
  process.exit(1);
});
