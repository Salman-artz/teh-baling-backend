import { z } from 'zod';

export const startShiftStockItemSchema = z.object({
  cupTypeId: z.string().uuid(),
  qtyInitial: z.number().int().nonnegative(),
});

export type StartShiftStockItemInput = z.infer<typeof startShiftStockItemSchema>;

export const startShiftSchema = z.object({
  stockItems: z.array(startShiftStockItemSchema).min(1),
  cashModal: z.number().int().nonnegative(),
  notes: z.string().optional(),
  gpsLatitude: z.number().min(-90).max(90).nullable(),
  gpsLongitude: z.number().min(-180).max(180).nullable(),
  gpsAccuracy: z.number().nonnegative().nullable(),
});

export type StartShiftInput = z.infer<typeof startShiftSchema>;

export const endShiftSaleItemSchema = z.object({
  productId: z.string().uuid(),
  cupTypeId: z.string().uuid(),
  qtySold: z.number().int().nonnegative(),
});

export type EndShiftSaleItemInput = z.infer<typeof endShiftSaleItemSchema>;

export const endShiftSchema = z.object({
  saleItems: z.array(endShiftSaleItemSchema).min(1),
  cashFinal: z.number().int().nonnegative(),
  notes: z.string().optional(),
  gpsLatitude: z.number().min(-90).max(90).nullable(),
  gpsLongitude: z.number().min(-180).max(180).nullable(),
  gpsAccuracy: z.number().nonnegative().nullable(),
});

export type EndShiftInput = z.infer<typeof endShiftSchema>;
