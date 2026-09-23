import 'dotenv/config';
import postgres from 'postgres';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error('FATAL: DATABASE_URL is not set.');
  process.exit(1);
}

const sql = postgres(connectionString, { ssl: 'require' });

async function restoreOriProducts() {
  console.log('--- RESTORING ORI PRODUCTS 1 BY 1 ---');

  // Aktifkan kembali 4 produk original 1 per 1
  await sql`
    UPDATE tea_products 
    SET is_active = true 
    WHERE id IN (
      '6c2e512d-4251-4f4b-9eeb-5e81090a2fd0', -- Ori K
      '60dd2177-5946-4a22-adab-b62731eedc10', -- Ori B (medium)
      'd6a33833-3527-407a-9f6d-86b238747137', -- Best Ori
      '218065d8-267f-4f1b-9603-ae3d9754b91b'  -- Big Ori (jumbo)
    );
  `;

  // Nonaktifkan produk 'Original' gabungan agar tidak dobel
  await sql`
    UPDATE tea_products 
    SET is_active = false 
    WHERE id = 'f97f1006-6f2b-46ed-af06-a7ea3aae7c0d';
  `;

  const activeProducts = await sql`
    SELECT id, name, is_active 
    FROM tea_products 
    WHERE series_id = '11111111-1111-1111-1111-111111111111'
    ORDER BY name;
  `;
  console.log('Original Tea Products Status:', activeProducts);

  await sql.end();
}

restoreOriProducts().catch((err) => {
  console.error(err);
  process.exit(1);
});
