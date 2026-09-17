import { z } from 'zod';
import { ROLES } from '../constants/roles';

export const userRoleSchema = z.enum([
  ROLES.ADMIN,
  ROLES.BOOTH_ATTENDANT,
  ROLES.PRODUCTION,
]);

export type UserRole = z.infer<typeof userRoleSchema>;

export const createUserSchema = z.object({
  name: z.string().min(1).max(100),
  email: z.string().email(),
  password: z.string().min(6),
  role: z.enum(['ADMIN', 'BOOTH_ATTENDANT', 'PRODUCTION']),
});

export type CreateUserInput = z.infer<typeof createUserSchema>;

export const updateUserSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  email: z.string().email().optional(),
  role: z.enum(['ADMIN', 'BOOTH_ATTENDANT', 'PRODUCTION']).optional(),
  isActive: z.boolean().optional(),
});

export type UpdateUserInput = z.infer<typeof updateUserSchema>;
