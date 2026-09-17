import { Hono } from 'hono';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { jwtVerify } from 'jose';
import { eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import * as schema from '../db/schema/index.js';
import {
  AppEnv,
  JWT_REFRESH_SECRET,
  signAccessToken,
  signRefreshToken,
  tokenBlacklist,
} from '../middleware/auth.middleware.js';
import { emailLockouts } from '../middleware/rate-limit.middleware.js';

const loginSchema = z.object({
  email: z.string().trim().email('Format email tidak valid'),
  password: z.string().min(1, 'Password wajib diisi'),
});

const refreshSchema = z.object({
  refreshToken: z.string().min(1, 'Refresh token wajib diisi'),
});

export const authRouter = new Hono<AppEnv>();

// POST /auth/login
authRouter.post('/login', async (c) => {
  try {
    const rawBody = await c.req.json();
    const parseResult = loginSchema.safeParse(rawBody);

    if (!parseResult.success) {
      return c.json(
        {
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: parseResult.error.errors.map((e) => e.message).join(', '),
          },
        },
        400
      );
    }

    const { email, password } = parseResult.data;
    const normalizedEmail = email.toLowerCase().trim();
    const now = Date.now();

    // L-3: Account Lockout check per email
    const lockout = emailLockouts.get(normalizedEmail);
    if (lockout && lockout.lockedUntil > now) {
      const remainingMinutes = Math.ceil((lockout.lockedUntil - now) / 60000);
      return c.json(
        {
          success: false,
          error: {
            code: 'ACCOUNT_LOCKED',
            message: `Akun terkunci sementara karena terlalu banyak percobaan login gagal. Coba lagi dalam ${remainingMinutes} menit.`,
          },
        },
        423
      );
    }

    const user = await db.query.users.findFirst({
      where: eq(schema.users.email, normalizedEmail),
    });

    if (!user || !user.isActive) {
      const attempts = (lockout?.failedAttempts || 0) + 1;
      if (attempts >= 5) {
        emailLockouts.set(normalizedEmail, { failedAttempts: attempts, lockedUntil: now + 15 * 60 * 1000 });
      } else {
        emailLockouts.set(normalizedEmail, { failedAttempts: attempts, lockedUntil: 0 });
      }
      return c.json({ success: false, error: { code: 'UNAUTHORIZED', message: 'Email atau password salah' } }, 401);
    }

    const compareFn =
      (bcrypt as any)?.compare ||
      (bcrypt as any)?.default?.compare ||
      (bcrypt as any)?.compareSync ||
      (bcrypt as any)?.default?.compareSync;

    if (typeof compareFn !== 'function') {
      console.error('[FATAL] bcrypt compare function could not be resolved from module');
      return c.json({ success: false, error: { code: 'SERVER_ERROR', message: 'Terjadi kesalahan konfigurasi server' } }, 500);
    }

    const validPassword = await compareFn(password, user.passwordHash);
    if (!validPassword) {
      const attempts = (lockout?.failedAttempts || 0) + 1;
      if (attempts >= 5) {
        emailLockouts.set(normalizedEmail, { failedAttempts: attempts, lockedUntil: now + 15 * 60 * 1000 });
      } else {
        emailLockouts.set(normalizedEmail, { failedAttempts: attempts, lockedUntil: 0 });
      }
      return c.json({ success: false, error: { code: 'UNAUTHORIZED', message: 'Email atau password salah' } }, 401);
    }

    emailLockouts.delete(normalizedEmail);

    const accessToken = await signAccessToken({ id: user.id, email: user.email, role: user.role });
    const refreshToken = await signRefreshToken({ id: user.id, email: user.email });

    return c.json({
      success: true,
      data: {
        accessToken,
        refreshToken,
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
        },
      },
    });
  } catch (err) {
    console.error('[Login Error]:', err);
    return c.json({ success: false, error: { code: 'SERVER_ERROR', message: 'Terjadi kesalahan pada server' } }, 500);
  }
});

// POST /auth/refresh
authRouter.post('/refresh', async (c) => {
  try {
    const rawBody = await c.req.json();
    const parseResult = refreshSchema.safeParse(rawBody);

    if (!parseResult.success) {
      return c.json(
        {
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'Refresh token wajib disertakan' },
        },
        400
      );
    }

    const { refreshToken } = parseResult.data;
    const { payload } = await jwtVerify(refreshToken, JWT_REFRESH_SECRET);
    const userId = payload.id as string;

    const user = await db.query.users.findFirst({
      where: eq(schema.users.id, userId),
    });

    if (!user || !user.isActive) {
      return c.json({ success: false, error: { code: 'UNAUTHORIZED', message: 'User tidak aktif atau tidak ditemukan' } }, 401);
    }

    const newAccessToken = await signAccessToken({ id: user.id, email: user.email, role: user.role });
    const newRefreshToken = await signRefreshToken({ id: user.id, email: user.email });

    return c.json({
      success: true,
      data: {
        accessToken: newAccessToken,
        refreshToken: newRefreshToken,
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
        },
      },
    });
  } catch {
    return c.json(
      { success: false, error: { code: 'UNAUTHORIZED', message: 'Refresh token tidak valid atau telah kadaluarsa' } },
      401
    );
  }
});

// POST /auth/logout
authRouter.post('/logout', async (c) => {
  const user = c.get('user');
  if (user?.token) {
    tokenBlacklist.add(user.token);
  }
  return c.json({ success: true, message: 'Berhasil keluar (logout)' });
});

// GET /auth/me
authRouter.get('/me', async (c) => {
  const user = c.get('user');
  if (!user) {
    return c.json({ success: false, error: { code: 'UNAUTHORIZED', message: 'Sesi tidak valid' } }, 401);
  }
  return c.json({
    success: true,
    data: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
    },
  });
});
