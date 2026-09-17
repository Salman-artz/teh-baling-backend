import { z } from 'zod';

export const createBoothSchema = z.object({
  name: z.string().min(1).max(100),
  address: z.string().min(1).max(255),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
});

export type CreateBoothInput = z.infer<typeof createBoothSchema>;

export const updateBoothSchema = createBoothSchema.partial().extend({
  isActive: z.boolean().optional(),
});

export type UpdateBoothInput = z.infer<typeof updateBoothSchema>;
