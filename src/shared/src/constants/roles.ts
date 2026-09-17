export const ROLES = {
  ADMIN: 'ADMIN',
  BOOTH_ATTENDANT: 'BOOTH_ATTENDANT',
  PRODUCTION: 'PRODUCTION',
} as const;

export type Role = (typeof ROLES)[keyof typeof ROLES];
