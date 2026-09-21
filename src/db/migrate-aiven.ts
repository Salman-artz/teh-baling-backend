import postgres from 'postgres';
import bcrypt from 'bcryptjs';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error('FATAL: DATABASE_URL is not set.');
  process.exit(1);
}

console.log('Connecting to Aiven PostgreSQL...');
const sql = postgres(connectionString, { ssl: 'require' });

async function migrateAndSeed() {
  try {
    console.log('1. Creating Enum Types...');
    await sql`
      DO $$ BEGIN
        CREATE TYPE user_role AS ENUM ('ADMIN', 'BOOTH_ATTENDANT', 'PRODUCTION');
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `;
    await sql`
      DO $$ BEGIN
        CREATE TYPE report_status AS ENUM ('OPEN', 'CLOSED');
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `;

    console.log('2. Creating Tables...');
    // users
    await sql`
      CREATE TABLE IF NOT EXISTS users (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name VARCHAR(100) NOT NULL,
        email VARCHAR(255) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        role user_role NOT NULL DEFAULT 'BOOTH_ATTENDANT',
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `;

    // tea_series
    await sql`
      CREATE TABLE IF NOT EXISTS tea_series (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name VARCHAR(100) UNIQUE NOT NULL,
        description TEXT,
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `;

    // tea_products
    await sql`
      CREATE TABLE IF NOT EXISTS tea_products (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        series_id UUID NOT NULL REFERENCES tea_series(id) ON DELETE RESTRICT,
        name VARCHAR(100) NOT NULL,
        description TEXT,
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `;

    // cup_types
    await sql`
      CREATE TABLE IF NOT EXISTS cup_types (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name VARCHAR(50) NOT NULL,
        price INT NOT NULL CHECK (price >= 0),
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `;

    // series_cup_mappings
    await sql`
      CREATE TABLE IF NOT EXISTS series_cup_mappings (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        series_id UUID NOT NULL REFERENCES tea_series(id) ON DELETE CASCADE,
        cup_type_id UUID NOT NULL REFERENCES cup_types(id) ON DELETE CASCADE,
        price INT NOT NULL DEFAULT 10000,
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT uk_series_cup UNIQUE (series_id, cup_type_id)
      );
    `;

    // booths
    await sql`
      CREATE TABLE IF NOT EXISTS booths (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name VARCHAR(100) NOT NULL,
        address VARCHAR(255) NOT NULL,
        latitude NUMERIC(10, 7),
        longitude NUMERIC(10, 7),
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `;

    // booth_assignments
    await sql`
      CREATE TABLE IF NOT EXISTS booth_assignments (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        booth_id UUID NOT NULL REFERENCES booths(id) ON DELETE RESTRICT,
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        assignment_date DATE NOT NULL,
        created_by UUID REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT uk_booth_date UNIQUE (booth_id, assignment_date),
        CONSTRAINT uk_user_date UNIQUE (user_id, assignment_date)
      );
    `;

    // daily_reports
    await sql`
      CREATE TABLE IF NOT EXISTS daily_reports (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        booth_id UUID NOT NULL REFERENCES booths(id) ON DELETE RESTRICT,
        attendant_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        report_date DATE NOT NULL DEFAULT CURRENT_DATE,
        cash_modal INT NOT NULL DEFAULT 0,
        cash_final INT,
        notes TEXT,
        gps_lat_start NUMERIC(10, 7),
        gps_lng_start NUMERIC(10, 7),
        gps_accuracy_start NUMERIC(8, 2),
        gps_time_start TIMESTAMPTZ,
        gps_lat_end NUMERIC(10, 7),
        gps_lng_end NUMERIC(10, 7),
        gps_accuracy_end NUMERIC(8, 2),
        gps_time_end TIMESTAMPTZ,
        status report_status NOT NULL DEFAULT 'OPEN',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT uk_booth_report_date UNIQUE (booth_id, report_date)
      );
    `;

    // report_stock_items
    await sql`
      CREATE TABLE IF NOT EXISTS report_stock_items (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        daily_report_id UUID NOT NULL REFERENCES daily_reports(id) ON DELETE CASCADE,
        cup_type_id UUID NOT NULL REFERENCES cup_types(id) ON DELETE RESTRICT,
        qty_initial INT NOT NULL DEFAULT 0,
        qty_sold INT NOT NULL DEFAULT 0,
        qty_remaining INT GENERATED ALWAYS AS (qty_initial - qty_sold) STORED,
        price_snapshot INT NOT NULL
      );
    `;

    // report_sale_items
    await sql`
      CREATE TABLE IF NOT EXISTS report_sale_items (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        daily_report_id UUID NOT NULL REFERENCES daily_reports(id) ON DELETE CASCADE,
        product_id UUID NOT NULL REFERENCES tea_products(id) ON DELETE RESTRICT,
        cup_type_id UUID NOT NULL REFERENCES cup_types(id) ON DELETE RESTRICT,
        qty_sold INT NOT NULL CHECK (qty_sold >= 0),
        price_snapshot INT NOT NULL,
        subtotal INT GENERATED ALWAYS AS (qty_sold * price_snapshot) STORED
      );
    `;

    // production_reports
    await sql`
      CREATE TABLE IF NOT EXISTS production_reports (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        staff_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        report_date DATE NOT NULL DEFAULT CURRENT_DATE,
        total_liters NUMERIC(8, 2) NOT NULL CHECK (total_liters > 0),
        notes TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `;

    // production_deliveries
    await sql`
      CREATE TABLE IF NOT EXISTS production_deliveries (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        staff_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        booth_id UUID NOT NULL REFERENCES booths(id) ON DELETE RESTRICT,
        delivery_date DATE NOT NULL DEFAULT CURRENT_DATE,
        total_liters NUMERIC(8, 2) NOT NULL CHECK (total_liters > 0),
        notes TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `;

    console.log('3. Seeding Initial Data into Aiven PostgreSQL...');
    const defaultPassword = 'password123';
    const passwordHash = await bcrypt.hash(defaultPassword, 10);
    const today = new Date().toISOString().split('T')[0]!;

    // Seed Users
    await sql`
      INSERT INTO users (id, name, email, password_hash, role)
      VALUES
        ('a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'Pak Budi (Owner / Admin)', 'admin@tehbaling.com', ${passwordHash}, 'ADMIN'),
        ('b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a22', 'Rina (Penjaga Booth 1)', 'rina@tehbaling.com', ${passwordHash}, 'BOOTH_ATTENDANT'),
        ('c0eebc99-9c0b-4ef8-bb6d-6bb9bd380a33', 'Siti (Penjaga Booth 2)', 'siti@tehbaling.com', ${passwordHash}, 'BOOTH_ATTENDANT'),
        ('d0eebc99-9c0b-4ef8-bb6d-6bb9bd380a44', 'Mas Joko (Staf Produksi)', 'joko@tehbaling.com', ${passwordHash}, 'PRODUCTION')
      ON CONFLICT (email) DO NOTHING;
    `;

    // Seed Tea Series
    await sql`
      INSERT INTO tea_series (id, name, description)
      VALUES
        ('11111111-1111-1111-1111-111111111111', 'Original Tea Series', 'Teh Asli Melati Khas Baling'),
        ('22222222-2222-2222-2222-222222222222', 'Yakult Series', 'Perpaduan Teh Segar dan Yakult'),
        ('33333333-3333-3333-3333-333333333333', 'Fruity Series', 'Varian Rasa Buah-Buahan Segar')
      ON CONFLICT (name) DO NOTHING;
    `;

    // Seed Cup Types
    await sql`
      INSERT INTO cup_types (id, name, price)
      VALUES
        ('c1111111-1111-1111-1111-111111111111', 'Cup Kecil', 5000),
        ('c2222222-2222-2222-2222-222222222222', 'Cup Medium', 8000),
        ('c3333333-3333-3333-3333-333333333333', 'Cup Big', 12000),
        ('c4444444-4444-4444-4444-444444444444', 'Cup Jumbo', 15000)
      ON CONFLICT (id) DO NOTHING;
    `;

    // Seed Booths
    await sql`
      INSERT INTO booths (id, name, address, latitude, longitude)
      VALUES
        ('b1111111-1111-1111-1111-111111111111', 'Booth Alun-Alun Kota', 'Jl. Merdeka No. 1', -7.250445, 112.768845),
        ('b2222222-2222-2222-2222-222222222222', 'Booth Kampus UNESA', 'Jl. Ketintang No. 45', -7.311234, 112.729123)
      ON CONFLICT (id) DO NOTHING;
    `;

    // Seed Booth Assignments
    await sql`
      INSERT INTO booth_assignments (booth_id, user_id, assignment_date, created_by)
      VALUES
        ('b1111111-1111-1111-1111-111111111111', 'b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a22', ${today}::date, 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'),
        ('b2222222-2222-2222-2222-222222222222', 'c0eebc99-9c0b-4ef8-bb6d-6bb9bd380a33', ${today}::date, 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11')
      ON CONFLICT DO NOTHING;
    `;

    console.log('✅ MIGRASI DAN SEED KE AIVEN POSTGRESQL SUKSES 100%!');
    await sql.end();
    process.exit(0);
  } catch (err) {
    console.error('❌ Error during migration:', err);
    await sql.end();
    process.exit(1);
  }
}

migrateAndSeed();
