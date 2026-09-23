import 'dotenv/config';
import postgres from 'postgres';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error('FATAL: DATABASE_URL is not set.');
  process.exit(1);
}

const sql = postgres(connectionString, { ssl: 'require' });

async function fixConstraints() {
  console.log('--- Inspecting & Fixing Unique Constraints for Multi-Shift (Pagi & Sore) ---');

  // 1. Cek constraint di booth_assignments
  console.log('Updating booth_assignments constraints...');
  await sql`
    ALTER TABLE booth_assignments DROP CONSTRAINT IF EXISTS uk_booth_date;
  `;
  await sql`
    ALTER TABLE booth_assignments DROP CONSTRAINT IF EXISTS uk_user_date;
  `;
  await sql`
    ALTER TABLE booth_assignments DROP CONSTRAINT IF EXISTS uk_booth_date_shift;
  `;
  await sql`
    ALTER TABLE booth_assignments DROP CONSTRAINT IF EXISTS uk_user_date_shift;
  `;
  
  // Buat constraint baru: (booth_id, assignment_date, shift_type) & (user_id, assignment_date, shift_type)
  await sql`
    ALTER TABLE booth_assignments 
    ADD CONSTRAINT uk_booth_date_shift UNIQUE (booth_id, assignment_date, shift_type);
  `;
  await sql`
    ALTER TABLE booth_assignments 
    ADD CONSTRAINT uk_user_date_shift UNIQUE (user_id, assignment_date, shift_type);
  `;
  console.log('✅ booth_assignments updated: 1 booth can now have 1 PAGI and 1 SORE shift per day!');

  // 2. Cek constraint di daily_reports
  console.log('Updating daily_reports constraints...');
  await sql`
    ALTER TABLE daily_reports DROP CONSTRAINT IF EXISTS uk_booth_report_date;
  `;
  await sql`
    ALTER TABLE daily_reports DROP CONSTRAINT IF EXISTS uk_booth_report_date_shift;
  `;
  await sql`
    ALTER TABLE daily_reports 
    ADD CONSTRAINT uk_booth_report_date_shift UNIQUE (booth_id, report_date, shift_type);
  `;
  console.log('✅ daily_reports updated: 1 booth can now have separate daily_reports for PAGI and SORE!');

  await sql.end();
}

fixConstraints().catch((err) => {
  console.error('Error fixing constraints:', err);
  process.exit(1);
});
