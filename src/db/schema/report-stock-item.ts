import { pgTable, uuid, integer, index } from 'drizzle-orm/pg-core';
import { dailyReports } from './daily-report.js';
import { cupTypes } from './cup-type.js';
export const reportStockItems = pgTable('report_stock_items', {
  id: uuid('id').defaultRandom().primaryKey(),
  dailyReportId: uuid('daily_report_id').references(() => dailyReports.id, { onDelete: 'cascade' }).notNull(),
  cupTypeId: uuid('cup_type_id').references(() => cupTypes.id, { onDelete: 'restrict' }).notNull(),
  qtyInitial: integer('qty_initial').notNull().default(0),
  qtyAdded: integer('qty_added').notNull().default(0),
  qtySold: integer('qty_sold').notNull().default(0),
  priceSnapshot: integer('price_snapshot').notNull(),
}, (table) => ({
  idxStockItemsReport: index('idx_stock_items_report').on(table.dailyReportId),
  idxStockItemsCup: index('idx_stock_items_cup').on(table.cupTypeId),
}));