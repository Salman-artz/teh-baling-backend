import { pgTable, uuid, integer, boolean, timestamp, unique, index } from 'drizzle-orm/pg-core';
import { teaSeries } from './tea-series.js';
import { cupTypes } from './cup-type.js';

export const seriesCupMappings = pgTable('series_cup_mappings', {
  id: uuid('id').defaultRandom().primaryKey(),
  seriesId: uuid('series_id').references(() => teaSeries.id, { onDelete: 'cascade' }).notNull(),
  cupTypeId: uuid('cup_type_id').references(() => cupTypes.id, { onDelete: 'cascade' }).notNull(),
  price: integer('price').default(10000).notNull(),
  isActive: boolean('is_active').default(true).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  ukSeriesCup: unique('uk_series_cup').on(table.seriesId, table.cupTypeId),
  idxScmSeries: index('idx_scm_series').on(table.seriesId),
  idxScmCup: index('idx_scm_cup').on(table.cupTypeId),
}));

// Backward compatibility export
export const productCupMappings = seriesCupMappings;
