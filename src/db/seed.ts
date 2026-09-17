import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema/index.js';
import bcrypt from 'bcryptjs';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error('FATAL: DATABASE_URL environment variable is not set.');
  process.exit(1);
}
const client = postgres(connectionString);
const db = drizzle(client, { schema });

async function main() {
  console.log('Seeding database...');
  // M-3 Fix: Strong seed default password from environment variable or secure fallback
  const defaultPassword = process.env.SEED_DEFAULT_PASSWORD || (process.env.NODE_ENV === 'test' ? 'password123' : 'TehBaling#Secure2026!');
  const passwordHash = await bcrypt.hash(defaultPassword, 10);
  const today: string = new Date().toISOString().split('T')[0]!;

  // Insert Users
  await db.insert(schema.users).values([
    { id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', name: 'Pak Budi (Owner)', email: 'admin@tehbaling.com', passwordHash, role: 'ADMIN' },
    { id: 'b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a22', name: 'Rina (Penjaga Booth 1)', email: 'rina@tehbaling.com', passwordHash, role: 'BOOTH_ATTENDANT' },
    { id: 'c0eebc99-9c0b-4ef8-bb6d-6bb9bd380a33', name: 'Siti (Penjaga Booth 2)', email: 'siti@tehbaling.com', passwordHash, role: 'BOOTH_ATTENDANT' },
    { id: 'd0eebc99-9c0b-4ef8-bb6d-6bb9bd380a44', name: 'Mas Joko (Staf Produksi)', email: 'joko@tehbaling.com', passwordHash, role: 'PRODUCTION' },
  ]).onConflictDoNothing();

  // Insert Tea Series
  await db.insert(schema.teaSeries).values([
    { id: '11111111-1111-1111-1111-111111111111', name: 'Original Tea Series', description: 'Teh Asli Melati Khas Baling' },
    { id: '22222222-2222-2222-2222-222222222222', name: 'Yakult Series', description: 'Perpaduan Teh Segar dan Yakult' },
    { id: '33333333-3333-3333-3333-333333333333', name: 'Fruity Series', description: 'Varian Rasa Buah-Buahan Segar' },
  ]).onConflictDoNothing();

  // Insert Cup Types
  await db.insert(schema.cupTypes).values([
    { id: 'c1111111-1111-1111-1111-111111111111', name: 'Cup Kecil', price: 5000 },
    { id: 'c2222222-2222-2222-2222-222222222222', name: 'Cup Medium', price: 8000 },
    { id: 'c3333333-3333-3333-3333-333333333333', name: 'Cup Big', price: 12000 },
    { id: 'c4444444-4444-4444-4444-444444444444', name: 'Cup Jumbo', price: 15000 },
  ]).onConflictDoNothing();

  // Insert Booths
  await db.insert(schema.booths).values([
    { id: 'b1111111-1111-1111-1111-111111111111', name: 'Booth Alun-Alun Kota', address: 'Jl. Merdeka No. 1', latitude: '-7.250445', longitude: '112.768845' },
    { id: 'b2222222-2222-2222-2222-222222222222', name: 'Booth Kampus UNESA', address: 'Jl. Ketintang No. 45', latitude: '-7.311234', longitude: '112.729123' },
  ]).onConflictDoNothing();

  // Insert Booth Assignments for Today (L-2 / C-1 prerequisite)
  await db.insert(schema.boothAssignments).values([
    {
      boothId: 'b1111111-1111-1111-1111-111111111111',
      userId: 'b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a22', // Rina
      assignmentDate: today,
      createdBy: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', // Pak Budi
    },
    {
      boothId: 'b2222222-2222-2222-2222-222222222222',
      userId: 'c0eebc99-9c0b-4ef8-bb6d-6bb9bd380a33', // Siti
      assignmentDate: today,
      createdBy: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', // Pak Budi
    },
  ]).onConflictDoNothing();

  console.log('Seeding complete.');
  process.exit(0);
}

main().catch(console.error);
