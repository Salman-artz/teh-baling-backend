import postgres from 'postgres';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error('FATAL: DATABASE_URL is not set.');
  process.exit(1);
}

const sql = postgres(connectionString, { ssl: 'require' });

async function checkDatabase() {
  console.log('--- CEK ISI DATABASE TEH BALING DI AIVEN ---');
  
  const tables = await sql`
    SELECT table_name 
    FROM information_schema.tables 
    WHERE table_schema = 'public' 
    ORDER BY table_name;
  `;
  console.log('\n📋 Daftar Tabel yang Berhasil Dibuat:');
  tables.forEach((t, i) => console.log(` ${i + 1}. ${t.table_name}`));

  const users = await sql`SELECT id, name, email, role FROM users`;
  console.log('\n👥 Data Users:');
  console.table(users);

  const series = await sql`SELECT id, name, description FROM tea_series`;
  console.log('\n🍵 Data Tea Series:');
  console.table(series);

  const cups = await sql`SELECT id, name, price FROM cup_types`;
  console.log('\n🥤 Data Cup Types:');
  console.table(cups);

  const booths = await sql`SELECT id, name, address FROM booths`;
  console.log('\n🏪 Data Booths:');
  console.table(booths);

  await sql.end();
}

checkDatabase().catch(console.error);
