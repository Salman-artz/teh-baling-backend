import { pgTable, uuid, date, integer, text, numeric, timestamp, varchar, pgEnum, unique, index } from 'drizzle-orm/pg-core';
import { booths } from './booth.js';
import { users } from './user.js';
export const statusEnum = pgEnum('report_status', ['OPEN', 'CLOSED']);
export const dailyReports = pgTable('daily_reports', {
  id: uuid('id').defaultRandom().primaryKey(),
  boothId: uuid('booth_id').references(() => booths.id, { onDelete: 'restrict' }).notNull(),
  attendantId: uuid('attendant_id').references(() => users.id, { onDelete: 'restrict' }).notNull(),
  reportDate: date('report_date').notNull().defaultNow(),
  shiftType: varchar('shift_type', { length: 10 }).default('PAGI').notNull(),
  cashModal: integer('cash_modal').notNull().default(0),
  cashFinal: integer('cash_final'),
  teaRemainingLiters: numeric('tea_remaining_liters', { precision: 8, scale: 2 }).default('0'),
  notes: text('notes'),
  gpsLatStart: numeric('gps_lat_start', { precision: 10, scale: 7 }),
  gpsLngStart: numeric('gps_lng_start', { precision: 10, scale: 7 }),
  gpsAccuracyStart: numeric('gps_accuracy_start', { precision: 8, scale: 2 }),
  gpsTimeStart: timestamp('gps_time_start', { withTimezone: true }),
  gpsLatEnd: numeric('gps_lat_end', { precision: 10, scale: 7 }),
  gpsLngEnd: numeric('gps_lng_end', { precision: 10, scale: 7 }),
  gpsAccuracyEnd: numeric('gps_accuracy_end', { precision: 8, scale: 2 }),
  gpsTimeEnd: timestamp('gps_time_end', { withTimezone: true }),
  status: statusEnum('status').default('OPEN').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  ukBoothReportDate: unique('uk_booth_report_date').on(table.boothId, table.reportDate),
  idxDailyReportDate: index('idx_daily_reports_date').on(table.reportDate),
  idxDailyReportBooth: index('idx_daily_reports_booth').on(table.boothId),
  idxDailyReportAttendant: index('idx_daily_reports_attendant').on(table.attendantId),
  idxDailyReportStatus: index('idx_daily_reports_status').on(table.status),
}));