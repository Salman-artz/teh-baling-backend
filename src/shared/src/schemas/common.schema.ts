import { z } from 'zod';

export const paginationSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

export type PaginationInput = z.infer<typeof paginationSchema>;
export type PaginationQuery = PaginationInput;

export const idParamSchema = z.object({
  id: z.string().uuid(),
});

export type IdParamInput = z.infer<typeof idParamSchema>;
export type IdParam = IdParamInput;

export const dateRangeSchema = z.object({
  from: z.string().date().optional(),
  to: z.string().date().optional(),
  boothId: z.string().uuid().optional(),
});

export type DateRangeInput = z.infer<typeof dateRangeSchema>;
export type DateRangeQuery = DateRangeInput;
