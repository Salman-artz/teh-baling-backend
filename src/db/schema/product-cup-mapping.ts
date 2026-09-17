import { pgTable, uuid, boolean, timestamp, unique } from 'drizzle-orm/pg-core';
import { teaProducts } from './tea-product.js';
import { cupTypes } from './cup-type.js';
export const productCupMappings = pgTable('product_cup_mappings', {
  id: uuid('id').defaultRandom().primaryKey(),
  productId: uuid('product_id').references(() => teaProducts.id, { onDelete: 'cascade' }).notNull(),
  cupTypeId: uuid('cup_type_id').references(() => cupTypes.id, { onDelete: 'cascade' }).notNull(),
  isActive: boolean('is_active').default(true).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  ukProductCup: unique('uk_product_cup').on(table.productId, table.cupTypeId),
}));