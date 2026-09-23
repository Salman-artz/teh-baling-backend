import 'dotenv/config';
import postgres from 'postgres';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error('FATAL: DATABASE_URL is not set.');
  process.exit(1);
}

const sql = postgres(connectionString, { ssl: 'require' });

async function syncAllSalePrices() {
  console.log('--- SYNCING ALL SALE ITEMS TO EXACT SERIES CUP PRICES ---');

  // Ambil semua aturan series cup mapping yang aktif
  const rules = await sql`
    SELECT scm.series_id, scm.cup_type_id, scm.price, scm.is_active, ts.name as series_name, ct.name as cup_name
    FROM series_cup_mappings scm
    JOIN tea_series ts ON scm.series_id = ts.id
    JOIN cup_types ct ON scm.cup_type_id = ct.id
    WHERE scm.is_active = true;
  `;
  console.log('Active Series Cup Rules:', rules);

  // Ambil semua sale items yang ada di database
  const saleItems = await sql`
    SELECT rsi.id, rsi.daily_report_id, rsi.product_id, rsi.cup_type_id, tp.name as product_name, tp.series_id, ts.name as series_name, ct.name as cup_name, rsi.qty_sold, rsi.price_snapshot
    FROM report_sale_items rsi
    JOIN tea_products tp ON rsi.product_id = tp.id
    LEFT JOIN tea_series ts ON tp.series_id = ts.id
    JOIN cup_types ct ON rsi.cup_type_id = ct.id;
  `;

  for (const item of saleItems) {
    let exactPrice = 0;

    // Cari dari rules yang cocok dengan series_id dan cup_type_id
    const matched = rules.find((r) => r.series_id === item.series_id && r.cup_type_id === item.cup_type_id);
    if (matched && Number(matched.price) > 0) {
      exactPrice = Number(matched.price);
    } else {
      // Khusus produk dengan nama Ori
      const pName = (item.product_name || '').toLowerCase();
      const cName = (item.cup_name || '').toLowerCase();
      if (pName.includes('ori') || item.series_name?.toLowerCase().includes('original')) {
        if (cName.includes('kecil') || pName === 'ori k') exactPrice = 2500;
        else if (cName.includes('medium') || pName.includes('ori b')) exactPrice = 3000;
        else if (cName.includes('best') || pName.includes('best ori')) exactPrice = 4000;
        else if (cName.includes('big') || cName.includes('jumbo') || pName.includes('big ori')) exactPrice = 5000;
        else exactPrice = 3000;
      }
    }

    if (exactPrice > 0 && exactPrice !== item.price_snapshot) {
      console.log(`[UPDATE] "${item.product_name}" (${item.cup_name}) Qty: ${item.qty_sold} -> Changing price from Rp ${item.price_snapshot} to Rp ${exactPrice}`);
      await sql`
        UPDATE report_sale_items 
        SET price_snapshot = ${exactPrice}
        WHERE id = ${item.id};
      `;
    }
  }

  // Cek hasil akhir
  const updatedItems = await sql`
    SELECT rsi.id, tp.name as product_name, ts.name as series_name, ct.name as cup_name, rsi.qty_sold, rsi.price_snapshot, (rsi.qty_sold * rsi.price_snapshot) as subtotal
    FROM report_sale_items rsi
    JOIN tea_products tp ON rsi.product_id = tp.id
    LEFT JOIN tea_series ts ON tp.series_id = ts.id
    JOIN cup_types ct ON rsi.cup_type_id = ct.id
    ORDER BY tp.name, ct.name;
  `;
  console.log('\n✅ FINAL SYNCED REPORT SALE ITEMS:', updatedItems);

  await sql.end();
}

syncAllSalePrices().catch((err) => {
  console.error(err);
  process.exit(1);
});
