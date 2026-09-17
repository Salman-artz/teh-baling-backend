import { z } from 'zod';

export const createCupTypeSchema = z.object({
  name: z.string().min(1).max(50),
  price: z.number().int().positive(),
});

export type CreateCupTypeInput = z.infer<typeof createCupTypeSchema>;

export const updateCupTypeSchema = createCupTypeSchema.partial().extend({
  isActive: z.boolean().optional(),
});

export type UpdateCupTypeInput = z.infer<typeof updateCupTypeSchema>;
