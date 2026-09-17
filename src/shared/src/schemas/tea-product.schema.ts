import { z } from 'zod';

export const createTeaProductSchema = z.object({
  name: z.string().min(1).max(100),
  seriesId: z.string().uuid(),
  description: z.string().optional(),
});

export type CreateTeaProductInput = z.infer<typeof createTeaProductSchema>;

export const updateTeaProductSchema = createTeaProductSchema.partial().extend({
  isActive: z.boolean().optional(),
});

export type UpdateTeaProductInput = z.infer<typeof updateTeaProductSchema>;
