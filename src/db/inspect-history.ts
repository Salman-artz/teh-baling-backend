import 'dotenv/config';
import postgres from 'postgres';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error('FATAL: DATABASE_URL is not set.');
  process.exit(1);
}

const sql = postgres(connectionString, { ssl: 'require' });

async function inspectHistory() {
  console.log('=== 1. DAILY REPORTS ===');
  const reports = await sql`
    SELECT dr.id, dr.report_date, dr.shift_type, b.name as booth_name, dr.cash_modal, dr.cash_final, dr.status
    FROM daily_reports dr
    JOIN booths b ON dr.booth_id = b.id
    ORDER BY dr.report_date DESC, dr.created_at DESC;
  `;
  console.log(reports);

  console.log('\n=== 2. ALL PRODUCTS ===');
  const products = await sql`
    SELECT tp.id, tp.name as product_name, tp.series_id, ts.name as series_name, tp.is_active
    FROM tea_products tp
    LEFT JOIN tea_series ts ON tp.series_id = ts.id
    ORDER BY ts.name, tp.name;
  `;
  console.log(products);

  console.log('\n=== 3. ALL SALE ITEMS (Grouped by Report) ===');
  const sales = await sql`
    SELECT rsi.id, rsi.daily_report_id, b.name as booth_name, dr.report_date, dr.shift_type, 
           tp.name as product_name, ts.name as series_name, ct.name as cup_name, 
           rsi.qty_sold, rsi.price_snapshot, (rsi.qty_sold * rsi.price_snapshot) as subtotal
    FROM report_sale_items rsi
    JOIN daily_reports dr ON rsi.daily_report_id = dr.id
    JOIN booths b ON dr.booth_id = b.id
    LEFT JOIN tea_products tp ON rsi.product_id = tp.id
    LEFT JOIN tea_series ts ON tp.series_id = ts.id
    LEFT JOIN cup_types ct ON rsi.cup_type_id = ct.id
    ORDER BY dr.report_date DESC, dr.shift_type, tp.name;
  `;
  console.log(sales);

  console.log('\n=== 4. ALL STOCK ITEMS (Cup Usage per Report) ===');
  const stocks = await sql`
    SELECT rsi.id, rsi.daily_report_id, b.name as booth_name, dr.report_date, dr.shift_type, 
           ct.name as cup_name, rsi.qty_initial, rsi.qty_added, rsi.qty_sold, rsi.price_snapshot
    FROM report_stock_items rsi
    JOIN daily_reports dr ON rsi.daily_report_id = dr.id
    JOIN booths b ON dr.booth_id = b.id
    LEFT JOIN cup_types ct ON rsi.cup_type_id = ct.id
    ORDER BY dr.report_date DESC, dr.shift_type, ct.name;
  `;
  console.log(stocks);

  await sql.end();
}

inspectHistory().catch((err) => {
  console.error(err);
  process.exit(1);
});
