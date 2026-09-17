import { Context, Next } from 'hono';
import { AppEnv, AuthContextUser } from './auth.middleware.js';

interface RateLimitRecord {
  count: number;
  resetTime: number;
}

interface LockoutRecord {
  failedAttempts: number;
  lockedUntil: number;
}

export const ipRateLimits = new Map<string, RateLimitRecord>();
export const emailLockouts = new Map<string, LockoutRecord>();

export function checkRateLimit(key: string, maxRequests: number, windowMs: number): boolean {
  const now = Date.now();
  const record = ipRateLimits.get(key);

  if (!record || now > record.resetTime) {
    ipRateLimits.set(key, { count: 1, resetTime: now + windowMs });
    return true;
  }

  if (record.count >= maxRequests) {
    return false;
  }

  record.count += 1;
  return true;
}

export async function rateLimitMiddleware(c: Context<AppEnv>, next: Next) {
  const clientIp = c.req.header('x-forwarded-for') || c.req.header('x-real-ip') || '127.0.0.1';

  // H-4: Strict rate limit on login endpoint (max 10 requests / 15 mins per IP)
  if (c.req.path === '/api/v1/auth/login' && c.req.method === 'POST') {
    const allowed = checkRateLimit(`login_${clientIp}`, 10, 15 * 60 * 1000);
    if (!allowed) {
      return c.json(
        {
          success: false,
          error: {
            code: 'TOO_MANY_REQUESTS',
            message: 'Terlalu banyak percobaan login dari IP ini. Coba lagi dalam 15 menit.',
          },
        },
        429
      );
    }
  }

  // General rate limit: 250 requests per minute per IP
  const generalAllowed = checkRateLimit(`general_${clientIp}`, 250, 60 * 1000);
  if (!generalAllowed) {
    return c.json(
      {
        success: false,
        error: {
          code: 'TOO_MANY_REQUESTS',
          message: 'Batas permintaan tercapai. Silakan coba sesaat lagi.',
        },
      },
      429
    );
  }

  return next();
}

export async function auditLoggerMiddleware(c: Context<AppEnv>, next: Next) {
  const start = Date.now();
  const clientIp = c.req.header('x-forwarded-for') || c.req.header('x-real-ip') || '127.0.0.1';
  const method = c.req.method;
  const path = c.req.path;

  await next();

  const duration = Date.now() - start;
  const status = c.res.status;
  const user = c.get('user') as AuthContextUser | undefined;
  const userStr = user ? `[User: ${user.id} (${user.role})]` : '[Anon]';

  console.log(
    `[AUDIT] ${new Date().toISOString()} | ${method} ${path} | Status: ${status} | ${duration}ms | IP: ${clientIp} | ${userStr}`
  );
}
