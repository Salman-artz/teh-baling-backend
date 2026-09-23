import { pgTable, uuid, date, timestamp, varchar, unique, index } from 'drizzle-orm/pg-core';
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
  ukBoothDateShift: unique('uk_booth_date_shift').on(table.boothId, table.assignmentDate, table.shiftType),
  ukUserDateShift: unique('uk_user_date_shift').on(table.userId, table.assignmentDate, table.shiftType),
  idxAssignmentDate: index('idx_assignment_date').on(table.assignmentDate),
  idxAssignmentUser: index('idx_assignment_user').on(table.userId),
  idxAssignmentBooth: index('idx_assignment_booth').on(table.boothId),
}));