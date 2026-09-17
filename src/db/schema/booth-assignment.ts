import { pgTable, uuid, date, timestamp, varchar, unique } from 'drizzle-orm/pg-core';
import { booths } from './booth.js';
import { users } from './user.js';
export const boothAssignments = pgTable('booth_assignments', {
  id: uuid('id').defaultRandom().primaryKey(),
  boothId: uuid('booth_id').references(() => booths.id, { onDelete: 'restrict' }).notNull(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'restrict' }).notNull(),
  assignmentDate: date('assignment_date').notNull(),
  shiftType: varchar('shift_type', { length: 10 }).default('PAGI').notNull(),
  createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  ukBoothDate: unique('uk_booth_date').on(table.boothId, table.assignmentDate),
  ukUserDate: unique('uk_user_date').on(table.userId, table.assignmentDate),
}));