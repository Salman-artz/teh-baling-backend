import { z } from 'zod';

export const createTeaSeriesSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().optional(),
});

export type CreateTeaSeriesInput = z.infer<typeof createTeaSeriesSchema>;

export const updateTeaSeriesSchema = createTeaSeriesSchema.partial().extend({
  isActive: z.boolean().optional(),
});

export type UpdateTeaSeriesInput = z.infer<typeof updateTeaSeriesSchema>;
