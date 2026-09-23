import 'dotenv/config';
import postgres from 'postgres';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error('FATAL: DATABASE_URL is not set.');
  process.exit(1);
}

const sql = postgres(connectionString, { ssl: 'require' });

async function unifyOri() {
  console.log('--- CHECKING EXISTING SALE ITEMS FOR ORIGINAL TEA ---');
  const sales = await sql`
    SELECT rsi.id, dr.report_date, dr.shift_type, b.name as booth_name,
           tp.name as product_name, ct.name as cup_name, rsi.qty_sold, rsi.price_snapshot
    FROM report_sale_items rsi
    JOIN daily_reports dr ON rsi.daily_report_id = dr.id
    JOIN booths b ON dr.booth_id = b.id
    JOIN tea_products tp ON rsi.product_id = tp.id
    JOIN cup_types ct ON rsi.cup_type_id = ct.id
    WHERE tp.series_id = '11111111-1111-1111-1111-111111111111'
    ORDER BY dr.report_date DESC, dr.shift_type;
  `;
  console.log('Ori Sale Items:', sales);

  // Single product ID for Original Tea
  const singleOriId = 'f97f1006-6f2b-46ed-af06-a7ea3aae7c0d';

  // 1. Point any sale items referencing other Ori products to the single Original product
  const updateSales = await sql`
    UPDATE report_sale_items
    SET product_id = ${singleOriId}
    WHERE product_id IN (
      '6c2e512d-4251-4f4b-9eeb-5e81090a2fd0', -- Ori K
      '60dd2177-5946-4a22-adab-b62731eedc10', -- Ori B (medium)
      'd6a33833-3527-407a-9f6d-86b238747137', -- Best Ori
      '218065d8-267f-4f1b-9603-ae3d9754b91b', -- Big Ori (jumbo)
      '2218e91e-3fdb-49e2-96d8-e5e884e860ec'  -- Teh Baling Melati Original
    );
  `;
  console.log('Updated sale items to single Original product:', updateSales.count);

  // 2. Activate the single product 'Original Tea' / 'Original'
  await sql`
    UPDATE tea_products
    SET name = 'Original Tea', is_active = true
    WHERE id = ${singleOriId};
  `;

  // 3. Deactivate individual Original Tea products
  await sql`
    UPDATE tea_products
    SET is_active = false
    WHERE series_id = '11111111-1111-1111-1111-111111111111'
      AND id != ${singleOriId};
  `;

  console.log('\n--- ACTIVE PRODUCTS IN ORIGINAL TEA SERIES ---');
  const activeOri = await sql`
    SELECT id, name, series_id, is_active
    FROM tea_products
    WHERE series_id = '11111111-1111-1111-1111-111111111111'
    ORDER BY name;
  `;
  console.log(activeOri);

  await sql.end();
}

unifyOri().catch((err) => {
  console.error(err);
  process.exit(1);
});
