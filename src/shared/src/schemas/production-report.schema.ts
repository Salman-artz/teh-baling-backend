import { z } from 'zod';

export const productionReportItemSchema = z.object({
  seriesId: z.string().uuid(),
  liters: z.number().positive(),
});

export type ProductionReportItemInput = z.infer<typeof productionReportItemSchema>;

export const createProductionReportSchema = z.object({
  reportDate: z.string().date(),
  items: z.array(productionReportItemSchema).min(1),
  notes: z.string().optional(),
});

export type CreateProductionReportInput = z.infer<typeof createProductionReportSchema>;
