import 'dotenv/config';
import postgres from 'postgres';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error('FATAL: DATABASE_URL is not set.');
  process.exit(1);
}

const sql = postgres(connectionString, { ssl: 'require' });

async function fixZeroPrices() {
  console.log('--- Inspecting & Fixing Zero Prices in report_sale_items ---');

  const cupTypesList = await sql`SELECT * FROM cup_types;`;
  console.log('Available cup_types:', cupTypesList);

  const seriesCupRules = await sql`
    SELECT scm.series_id, ts.name as series_name, scm.cup_type_id, ct.name as cup_name, scm.price, scm.is_active
    FROM series_cup_mappings scm
    JOIN tea_series ts ON scm.series_id = ts.id
    JOIN cup_types ct ON scm.cup_type_id = ct.id;
  `;
  console.log('Available series_cup_mappings:', seriesCupRules);

  const zeroItems = await sql`
    SELECT rsi.id, rsi.product_id, rsi.cup_type_id, tp.name as product_name, tp.series_id, ct.name as cup_name, rsi.qty_sold, rsi.price_snapshot
    FROM report_sale_items rsi
    LEFT JOIN tea_products tp ON rsi.product_id = tp.id
    LEFT JOIN cup_types ct ON rsi.cup_type_id = ct.id
    WHERE rsi.price_snapshot = 0;
  `;

  console.log(`Found ${zeroItems.length} rows with price_snapshot = 0`);

  for (const item of zeroItems) {
    let resolvedPrice = 0;

    // 1. Cek dari series_cup_mappings
    if (item.series_id && item.cup_type_id) {
      const rule = await sql`
        SELECT price 
        FROM series_cup_mappings 
        WHERE series_id = ${item.series_id} AND cup_type_id = ${item.cup_type_id} AND is_active = true
        LIMIT 1;
      `;
      if (rule.length > 0 && rule[0] && Number(rule[0].price) > 0) {
        resolvedPrice = Number(rule[0].price);
      }
    }

    // 2. Cek dari cup_types
    if (resolvedPrice <= 0 && item.cup_type_id) {
      const cup = await sql`
        SELECT price FROM cup_types WHERE id = ${item.cup_type_id} LIMIT 1;
      `;
      if (cup.length > 0 && cup[0] && Number(cup[0].price) > 0) {
        resolvedPrice = Number(cup[0].price);
      }
    }

    // 3. Fallback berdasarkan nama produk / cup
    if (resolvedPrice <= 0) {
      const pName = (item.product_name || '').toLowerCase();
      const cName = (item.cup_name || '').toLowerCase();
      if (pName.includes('jumbo') || cName.includes('jumbo') || cName.includes('big')) {
        resolvedPrice = 10000;
      } else if (pName.includes('best') || cName.includes('best')) {
        resolvedPrice = 10000;
      } else if (pName.includes('cheese') || pName.includes('yakult') || pName.includes('milk')) {
        resolvedPrice = 12000;
      } else {
        resolvedPrice = 10000;
      }
    }

    console.log(`Updating "${item.product_name}" (${item.cup_name}) -> Qty: ${item.qty_sold}, Price: Rp ${resolvedPrice}`);
    await sql`
      UPDATE report_sale_items 
      SET price_snapshot = ${resolvedPrice}
      WHERE id = ${item.id};
    `;
  }

  console.log('✅ All zero price rows successfully fixed in PostgreSQL database!');
  await sql.end();
}

fixZeroPrices().catch((err) => {
  console.error('Error fixing prices:', err);
  process.exit(1);
});
