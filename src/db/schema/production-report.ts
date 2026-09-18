import { pgTable, uuid, date, numeric, text, timestamp, index } from 'drizzle-orm/pg-core';
import { users } from './user.js';

export const productionReports = pgTable('production_reports', {
  id: uuid('id').defaultRandom().primaryKey(),
  staffId: uuid('staff_id').references(() => users.id, { onDelete: 'restrict' }).notNull(),
  reportDate: date('report_date').notNull().defaultNow(),
  totalLiters: numeric('total_liters', { precision: 8, scale: 2 }).notNull(),
  notes: text('notes'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  idxProductionDate: index('idx_production_date').on(table.reportDate),
  idxProductionStaff: index('idx_production_staff').on(table.staffId),
}));
