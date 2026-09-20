import { pgTable, uuid, date, numeric, text, timestamp, index } from 'drizzle-orm/pg-core';
import { users } from './user.js';
import { booths } from './booth.js';

export const productionDeliveries = pgTable('production_deliveries', {
  id: uuid('id').defaultRandom().primaryKey(),
  staffId: uuid('staff_id').references(() => users.id, { onDelete: 'restrict' }).notNull(),
  boothId: uuid('booth_id').references(() => booths.id, { onDelete: 'restrict' }).notNull(),
  deliveryDate: date('delivery_date').notNull().defaultNow(),
  totalLiters: numeric('total_liters', { precision: 8, scale: 2 }).notNull(),
  notes: text('notes'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  idxDeliveryDate: index('idx_delivery_date').on(table.deliveryDate),
  idxDeliveryStaff: index('idx_delivery_staff').on(table.staffId),
  idxDeliveryBooth: index('idx_delivery_booth').on(table.boothId),
}));
