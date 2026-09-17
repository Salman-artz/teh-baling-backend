import { pgTable, uuid, integer } from 'drizzle-orm/pg-core';
import { dailyReports } from './daily-report.js';
import { teaProducts } from './tea-product.js';
import { cupTypes } from './cup-type.js';
export const reportSaleItems = pgTable('report_sale_items', {
  id: uuid('id').defaultRandom().primaryKey(),
  dailyReportId: uuid('daily_report_id').references(() => dailyReports.id, { onDelete: 'cascade' }).notNull(),
  productId: uuid('product_id').references(() => teaProducts.id, { onDelete: 'restrict' }).notNull(),
  cupTypeId: uuid('cup_type_id').references(() => cupTypes.id, { onDelete: 'restrict' }).notNull(),
  qtySold: integer('qty_sold').notNull(),
  priceSnapshot: integer('price_snapshot').notNull(),
});