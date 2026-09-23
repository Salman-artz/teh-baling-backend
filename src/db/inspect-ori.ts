import 'dotenv/config';
import postgres from 'postgres';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error('FATAL: DATABASE_URL is not set.');
  process.exit(1);
}

const sql = postgres(connectionString, { ssl: 'require' });

async function checkAndFixOri() {
  console.log('=== 1. CHECK ALL PRODUCTS WITH ORI ===');
  const products = await sql`
    SELECT tp.id, tp.name as product_name, tp.series_id, ts.name as series_name 
    FROM tea_products tp
    LEFT JOIN tea_series ts ON tp.series_id = ts.id
    ORDER BY tp.name;
  `;
  console.log('All Products in DB:', products);

  console.log('\n=== 2. CHECK CUP RULES FOR ORIGINAL TEA ===');
  const originalRules = await sql`
    SELECT scm.series_id, ts.name as series_name, scm.cup_type_id, ct.name as cup_name, scm.price, scm.is_active
    FROM series_cup_mappings scm
    JOIN tea_series ts ON scm.series_id = ts.id
    JOIN cup_types ct ON scm.cup_type_id = ct.id
    WHERE ts.name ILIKE '%original%';
  `;
  console.log('Original Series Cup Rules:', originalRules);

  console.log('\n=== 3. CHECK ALL CURRENT SALE ITEMS IN DB ===');
  const saleItems = await sql`
    SELECT rsi.id, rsi.daily_report_id, tp.name as product_name, ts.name as series_name, ct.name as cup_name, rsi.qty_sold, rsi.price_snapshot, (rsi.qty_sold * rsi.price_snapshot) as subtotal
    FROM report_sale_items rsi
    JOIN tea_products tp ON rsi.product_id = tp.id
    LEFT JOIN tea_series ts ON tp.series_id = ts.id
    JOIN cup_types ct ON rsi.cup_type_id = ct.id
    ORDER BY rsi.id;
  `;
  console.log('Current Sale Items:', saleItems);

  await sql.end();
}

checkAndFixOri().catch((err) => {
  console.error(err);
  process.exit(1);
});
