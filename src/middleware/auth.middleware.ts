import { Context, Next } from 'hono';
import { jwtVerify, SignJWT } from 'jose';
import { eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import * as schema from '../db/schema/index.js';

export interface AuthContextUser {
  id: string;
  name: string;
  email: string;
  role: string;
  token?: string;
}

export type AppEnv = {
  Variables: {
    user: AuthContextUser;
  };
};

const JWT_SECRET_RAW = process.env.JWT_SECRET || 'fallback_secret_teh_baling_2026_super_key';
export const JWT_SECRET = new TextEncoder().encode(JWT_SECRET_RAW);

const JWT_REFRESH_SECRET_RAW = process.env.JWT_REFRESH_SECRET || `${JWT_SECRET_RAW}_refresh_key_salt_32chars`;
export const JWT_REFRESH_SECRET = new TextEncoder().encode(JWT_REFRESH_SECRET_RAW);

export const tokenBlacklist = new Set<string>();

export async function signAccessToken(payload: { id: string; email: string; role: string }) {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(JWT_SECRET);
}

export async function signRefreshToken(payload: { id: string; email: string }) {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('7d')
    .sign(JWT_REFRESH_SECRET);
}

// Authentication Middleware
export async function authMiddleware(c: Context<AppEnv>, next: Next) {
  // Skip auth for public auth routes
  if (
    c.req.path === '/api/v1/auth/login' ||
    c.req.path === '/api/v1/auth/refresh' ||
    c.req.path === '/api/v1/booths/resolve-gmaps'
  ) {
    return next();
  }

  let token = '';
  const authHeader = c.req.header('Authorization');
  if (authHeader?.startsWith('Bearer ')) {
    token = authHeader.slice(7);
  } else if (c.req.query('token')) {
    token = c.req.query('token') as string;
  }

  if (!token) {
    return c.json(
      { success: false, error: { code: 'UNAUTHORIZED', message: 'Token otentikasi tidak ditemukan' } },
      401
    );
  }

  if (tokenBlacklist.has(token)) {
    return c.json(
      { success: false, error: { code: 'UNAUTHORIZED', message: 'Sesi telah berakhir (Token telah direvoke)' } },
      401
    );
  }

  try {
    const { payload } = await jwtVerify(token, JWT_SECRET);
    const userId = payload.id as string;

    const user = await db.query.users.findFirst({
      where: eq(schema.users.id, userId),
    });

    if (!user || !user.isActive) {
      return c.json(
        { success: false, error: { code: 'UNAUTHORIZED', message: 'Akun Anda telah dinonaktifkan atau tidak ditemukan' } },
        401
      );
    }

    c.set('user', {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      token,
    });

    return next();
  } catch {
    return c.json(
      { success: false, error: { code: 'UNAUTHORIZED', message: 'Token tidak valid atau telah kadaluarsa' } },
      401
    );
  }
}

// Role authorization middleware factory
export function requireRole(...roles: string[]) {
  return async (c: Context<AppEnv>, next: Next) => {
    const user = c.get('user') as AuthContextUser | undefined;
    if (!user || !roles.includes(user.role)) {
      return c.json(
        {
          success: false,
          error: { code: 'FORBIDDEN', message: 'Anda tidak memiliki hak akses ke resource ini' },
        },
        403
      );
    }
    return next();
  };
}
