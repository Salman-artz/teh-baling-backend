import 'dotenv/config';
import postgres from 'postgres';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error('FATAL: DATABASE_URL is not set.');
  process.exit(1);
}

const sql = postgres(connectionString, { ssl: 'require' });

async function checkOriProducts() {
  const oriProducts = await sql`
    SELECT id, name, series_id, is_active, created_at 
    FROM tea_products 
    WHERE series_id = '11111111-1111-1111-1111-111111111111' 
       OR name ILIKE '%ori%' 
       OR name ILIKE '%original%'
    ORDER BY created_at;
  `;
  console.log('Ori Products in Database:', oriProducts);

  const seriesCup = await sql`
    SELECT * FROM series_cup_mappings 
    WHERE series_id = '11111111-1111-1111-1111-111111111111';
  `;
  console.log('Original Tea Series Cup Rules:', seriesCup);

  await sql.end();
}

checkOriProducts().catch((err) => {
  console.error(err);
  process.exit(1);
});
