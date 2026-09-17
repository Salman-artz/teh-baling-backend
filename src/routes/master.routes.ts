import { Hono } from 'hono';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { eq, desc } from 'drizzle-orm';
import { db } from '../db/index.js';
import * as schema from '../db/schema/index.js';
import { AppEnv, AuthContextUser, requireRole } from '../middleware/auth.middleware.js';

const teaSeriesCreateSchema = z.object({
  name: z.string().trim().min(1, 'Nama series wajib diisi').max(100, 'Nama series maksimal 100 karakter'),
  description: z.string().trim().optional(),
});

async function hashPassword(password: string): Promise<string> {
  const hashFn =
    (bcrypt as any)?.hash ||
    (bcrypt as any)?.default?.hash ||
    (bcrypt as any)?.hashSync ||
    (bcrypt as any)?.default?.hashSync;
  if (typeof hashFn === 'function') {
    return await hashFn(password, 10);
  }
  return await bcrypt.hash(password, 10);
}

export const masterRouter = new Hono<AppEnv>();

// =============================================================================
// TEA SERIES
// =============================================================================

masterRouter.get('/tea-series', requireRole('ADMIN', 'BOOTH_ATTENDANT', 'PRODUCTION'), async (c) => {
  try {
    const list = await db.select().from(schema.teaSeries).where(eq(schema.teaSeries.isActive, true));
    return c.json({ success: true, data: list });
  } catch (err) {
    console.error('[Get Tea Series Error]:', err);
    return c.json({ success: false, error: { code: 'SERVER_ERROR', message: 'Gagal mengambil data series teh' } }, 500);
  }
});

masterRouter.post('/tea-series', requireRole('ADMIN'), async (c) => {
  try {
    const rawBody = await c.req.json();
    const parseResult = teaSeriesCreateSchema.safeParse(rawBody);

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

    const { name, description } = parseResult.data;
    const [created] = await db
      .insert(schema.teaSeries)
      .values({ name, description: description || null })
      .returning();

    return c.json({ success: true, data: created });
  } catch (err) {
    console.error('[Create Tea Series Error]:', err);
    return c.json({ success: false, error: { code: 'SERVER_ERROR', message: 'Gagal menambahkan series teh' } }, 500);
  }
});

// =============================================================================
// TEA PRODUCTS
// =============================================================================

masterRouter.get('/tea-products', requireRole('ADMIN', 'BOOTH_ATTENDANT', 'PRODUCTION'), async (c) => {
  try {
    const list = await db.select().from(schema.teaProducts).where(eq(schema.teaProducts.isActive, true));
    return c.json({ success: true, data: list });
  } catch (err) {
    console.error('[Get Tea Products Error]:', err);
    return c.json({ success: false, error: { code: 'SERVER_ERROR', message: 'Gagal mengambil data produk teh' } }, 500);
  }
});

// =============================================================================
// CUP TYPES
// =============================================================================

masterRouter.get('/cup-types', requireRole('ADMIN', 'BOOTH_ATTENDANT', 'PRODUCTION'), async (c) => {
  try {
    const list = await db.select().from(schema.cupTypes).where(eq(schema.cupTypes.isActive, true));
    return c.json({ success: true, data: list });
  } catch (err) {
    console.error('[Get Cup Types Error]:', err);
    return c.json({ success: false, error: { code: 'SERVER_ERROR', message: 'Gagal mengambil data tipe cup' } }, 500);
  }
});

// =============================================================================
// BOOTHS
// =============================================================================

masterRouter.get('/booths', requireRole('ADMIN', 'BOOTH_ATTENDANT', 'PRODUCTION'), async (c) => {
  try {
    const status = c.req.query('status');
    let list;
    if (status === 'active') {
      list = await db.select().from(schema.booths).where(eq(schema.booths.isActive, true)).orderBy(desc(schema.booths.createdAt));
    } else if (status === 'inactive') {
      list = await db.select().from(schema.booths).where(eq(schema.booths.isActive, false)).orderBy(desc(schema.booths.createdAt));
    } else {
      list = await db.select().from(schema.booths).orderBy(desc(schema.booths.createdAt));
    }
    return c.json({ success: true, data: list });
  } catch (err) {
    console.error('[Get Booths Error]:', err);
    return c.json({ success: false, error: { code: 'SERVER_ERROR', message: 'Gagal mengambil data booth' } }, 500);
  }
});

masterRouter.post('/booths', requireRole('ADMIN'), async (c) => {
  try {
    const rawBody = await c.req.json();
    const { name, address, latitude, longitude, isActive } = rawBody;

    if (!name || !name.trim()) {
      return c.json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Nama booth wajib diisi' } }, 400);
    }
    if (!address || !address.trim()) {
      return c.json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Alamat booth wajib diisi' } }, 400);
    }

    const [newBooth] = await db
      .insert(schema.booths)
      .values({
        name: name.trim(),
        address: address.trim(),
        latitude: latitude ? String(latitude) : '-7.2575000',
        longitude: longitude ? String(longitude) : '112.7521000',
        isActive: isActive !== undefined ? Boolean(isActive) : true,
      })
      .returning();

    return c.json({ success: true, data: newBooth }, 201);
  } catch (err) {
    console.error('[Create Booth Error]:', err);
    return c.json({ success: false, error: { code: 'SERVER_ERROR', message: 'Gagal menambahkan booth baru' } }, 500);
  }
});

masterRouter.patch('/booths/:id', requireRole('ADMIN'), async (c) => {
  try {
    const boothId = c.req.param('id');
    if (!boothId) {
      return c.json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'ID booth wajib disertakan' } }, 400);
    }
    const rawBody = await c.req.json();
    const { name, address, latitude, longitude, isActive } = rawBody;

    const updateData: any = { updatedAt: new Date() };
    if (name !== undefined) updateData.name = name.trim();
    if (address !== undefined) updateData.address = address.trim();
    if (latitude !== undefined) updateData.latitude = String(latitude);
    if (longitude !== undefined) updateData.longitude = String(longitude);
    if (isActive !== undefined) updateData.isActive = Boolean(isActive);

    const [updated] = await db
      .update(schema.booths)
      .set(updateData)
      .where(eq(schema.booths.id, boothId))
      .returning();

    if (!updated) {
      return c.json({ success: false, error: { code: 'NOT_FOUND', message: 'Booth tidak ditemukan' } }, 404);
    }

    return c.json({ success: true, data: updated });
  } catch (err) {
    console.error('[Update Booth Error]:', err);
    return c.json({ success: false, error: { code: 'SERVER_ERROR', message: 'Gagal memperbarui booth' } }, 500);
  }
});

masterRouter.delete('/booths/:id', requireRole('ADMIN'), async (c) => {
  try {
    const boothId = c.req.param('id');
    if (!boothId) {
      return c.json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'ID booth wajib disertakan' } }, 400);
    }
    try {
      await db.delete(schema.booths).where(eq(schema.booths.id, boothId));
    } catch {
      await db.update(schema.booths).set({ isActive: false, updatedAt: new Date() }).where(eq(schema.booths.id, boothId));
    }
    return c.json({ success: true, message: 'Booth berhasil dihapus' });
  } catch (err) {
    console.error('[Delete Booth Error]:', err);
    return c.json({ success: false, error: { code: 'SERVER_ERROR', message: 'Gagal menghapus booth' } }, 500);
  }
});

// Resolve Google Maps shortlinks / URLs into exact coordinates
masterRouter.get('/booths/resolve-gmaps', async (c) => {
  try {
    const url = c.req.query('url');
    if (!url) {
      return c.json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Parameter URL dibutuhkan' } }, 400);
    }

    let targetUrl = url.trim();
    if (!targetUrl.startsWith('http://') && !targetUrl.startsWith('https://')) {
      targetUrl = `https://${targetUrl}`;
    }

    const response = await fetch(targetUrl, {
      method: 'GET',
      redirect: 'follow',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
    });

    const finalUrl = response.url || targetUrl;
    const bodyText = await response.text().catch(() => '');

    let lat: number | null = null;
    let lng: number | null = null;

    const dataMatch = (finalUrl + ' ' + bodyText).match(/!3d(-?\d{1,2}\.\d+)!4d(-?\d{1,3}\.\d+)/);
    if (dataMatch && dataMatch[1] && dataMatch[2]) {
      lat = parseFloat(dataMatch[1]);
      lng = parseFloat(dataMatch[2]);
    }

    if (lat === null) {
      const atMatch = finalUrl.match(/@(-?\d{1,2}\.\d+),(-?\d{1,3}\.\d+)/);
      if (atMatch && atMatch[1] && atMatch[2]) {
        lat = parseFloat(atMatch[1]);
        lng = parseFloat(atMatch[2]);
      }
    }

    if (lat === null) {
      const qMatch = finalUrl.match(/[?&](?:q|query|ll|center)=(-?\d{1,2}\.\d+),(-?\d{1,3}\.\d+)/);
      if (qMatch && qMatch[1] && qMatch[2]) {
        lat = parseFloat(qMatch[1]);
        lng = parseFloat(qMatch[2]);
      }
    }

    if (lat === null && bodyText) {
      const initMatch = bodyText.match(/\[null,null,(-?\d{1,2}\.\d{4,}),(-?\d{1,3}\.\d{4,})\]/);
      if (initMatch && initMatch[1] && initMatch[2]) {
        lat = parseFloat(initMatch[1]);
        lng = parseFloat(initMatch[2]);
      }
    }

    if (lat !== null && lng !== null && !isNaN(lat) && !isNaN(lng)) {
      return c.json({
        success: true,
        data: {
          latitude: lat.toFixed(7),
          longitude: lng.toFixed(7),
          resolvedUrl: finalUrl,
        },
      });
    }

    return c.json(
      {
        success: false,
        error: { code: 'COORDINATES_NOT_FOUND', message: 'Tidak dapat menemukan koordinat dari link tersebut' },
      },
      400
    );
  } catch (err) {
    console.error('[Resolve GMaps Error]:', err);
    return c.json({ success: false, error: { code: 'SERVER_ERROR', message: 'Gagal memproses link Google Maps' } }, 500);
  }
});

// =============================================================================
// USER MANAGEMENT
// =============================================================================

masterRouter.get('/users', requireRole('ADMIN'), async (c) => {
  try {
    const list = await db
      .select({
        id: schema.users.id,
        name: schema.users.name,
        email: schema.users.email,
        role: schema.users.role,
        isActive: schema.users.isActive,
        createdAt: schema.users.createdAt,
      })
      .from(schema.users)
      .orderBy(desc(schema.users.createdAt));
    return c.json({ success: true, data: list });
  } catch (err) {
    console.error('[Get Users Error]:', err);
    return c.json({ success: false, error: { code: 'SERVER_ERROR', message: 'Gagal mengambil data pengguna' } }, 500);
  }
});

masterRouter.post('/users', requireRole('ADMIN'), async (c) => {
  try {
    const rawBody = await c.req.json();
    const { name, email, password, role } = rawBody;

    if (!name || !name.trim()) {
      return c.json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Nama pengguna wajib diisi' } }, 400);
    }
    if (!email || !email.includes('@')) {
      return c.json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Email pengguna tidak valid' } }, 400);
    }
    if (!password || password.length < 6) {
      return c.json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Password minimal 6 karakter' } }, 400);
    }

    const normalizedEmail = email.toLowerCase().trim();
    const existing = await db.query.users.findFirst({
      where: eq(schema.users.email, normalizedEmail),
    });
    if (existing) {
      return c.json({ success: false, error: { code: 'CONFLICT', message: 'Email sudah terdaftar' } }, 400);
    }

    const passwordHash = await hashPassword(password);
    const [newUser] = await db
      .insert(schema.users)
      .values({
        name: name.trim(),
        email: normalizedEmail,
        passwordHash,
        role: role || 'BOOTH_ATTENDANT',
        isActive: true,
      })
      .returning({
        id: schema.users.id,
        name: schema.users.name,
        email: schema.users.email,
        role: schema.users.role,
        isActive: schema.users.isActive,
        createdAt: schema.users.createdAt,
      });

    return c.json({ success: true, data: newUser }, 201);
  } catch (err) {
    console.error('[Create User Error]:', err);
    return c.json({ success: false, error: { code: 'SERVER_ERROR', message: 'Gagal menambahkan pengguna baru' } }, 500);
  }
});

masterRouter.patch('/users/:id', requireRole('ADMIN'), async (c) => {
  try {
    const userId = c.req.param('id');
    if (!userId) {
      return c.json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'ID pengguna wajib disertakan' } }, 400);
    }
    const currentUser = c.get('user') as AuthContextUser;
    const rawBody = await c.req.json();
    const { name, email, password, role, isActive } = rawBody;

    const existingUser = await db.query.users.findFirst({
      where: eq(schema.users.id, userId),
    });

    if (!existingUser) {
      return c.json({ success: false, error: { code: 'NOT_FOUND', message: 'Pengguna tidak ditemukan' } }, 404);
    }

    if (userId === currentUser.id && isActive === false) {
      return c.json({ success: false, error: { code: 'FORBIDDEN', message: 'Anda tidak dapat menonaktifkan akun sendiri' } }, 400);
    }

    const updateData: any = { updatedAt: new Date() };
    if (name !== undefined) updateData.name = name.trim();
    if (email !== undefined) updateData.email = email.toLowerCase().trim();
    if (role !== undefined) updateData.role = role;
    if (isActive !== undefined) updateData.isActive = Boolean(isActive);
    if (password && password.trim().length >= 6) {
      updateData.passwordHash = await hashPassword(password);
    }

    const [updated] = await db
      .update(schema.users)
      .set(updateData)
      .where(eq(schema.users.id, userId))
      .returning({
        id: schema.users.id,
        name: schema.users.name,
        email: schema.users.email,
        role: schema.users.role,
        isActive: schema.users.isActive,
        createdAt: schema.users.createdAt,
      });

    return c.json({ success: true, data: updated });
  } catch (err) {
    console.error('[Update User Error]:', err);
    return c.json({ success: false, error: { code: 'SERVER_ERROR', message: 'Gagal memperbarui pengguna' } }, 500);
  }
});

masterRouter.patch('/users/:id/toggle-status', requireRole('ADMIN'), async (c) => {
  try {
    const userId = c.req.param('id');
    if (!userId) {
      return c.json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'ID pengguna wajib disertakan' } }, 400);
    }
    const currentUser = c.get('user') as AuthContextUser;

    if (userId === currentUser.id) {
      return c.json({ success: false, error: { code: 'FORBIDDEN', message: 'Anda tidak dapat menonaktifkan akun sendiri' } }, 400);
    }

    const existingUser = await db.query.users.findFirst({
      where: eq(schema.users.id, userId),
    });

    if (!existingUser) {
      return c.json({ success: false, error: { code: 'NOT_FOUND', message: 'Pengguna tidak ditemukan' } }, 404);
    }

    const newStatus = !existingUser.isActive;
    const [updated] = await db
      .update(schema.users)
      .set({ isActive: newStatus, updatedAt: new Date() })
      .where(eq(schema.users.id, userId))
      .returning({
        id: schema.users.id,
        name: schema.users.name,
        email: schema.users.email,
        role: schema.users.role,
        isActive: schema.users.isActive,
        createdAt: schema.users.createdAt,
      });

    return c.json({ success: true, data: updated });
  } catch (err) {
    console.error('[Toggle User Status Error]:', err);
    return c.json({ success: false, error: { code: 'SERVER_ERROR', message: 'Gagal mengubah status pengguna' } }, 500);
  }
});

masterRouter.delete('/users/:id', requireRole('ADMIN'), async (c) => {
  try {
    const userId = c.req.param('id');
    if (!userId) {
      return c.json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'ID pengguna wajib disertakan' } }, 400);
    }
    const currentUser = c.get('user') as AuthContextUser;

    if (userId === currentUser.id) {
      return c.json({ success: false, error: { code: 'FORBIDDEN', message: 'Anda tidak dapat menghapus akun sendiri' } }, 400);
    }

    try {
      await db.delete(schema.users).where(eq(schema.users.id, userId));
    } catch {
      await db.update(schema.users).set({ isActive: false, updatedAt: new Date() }).where(eq(schema.users.id, userId));
    }
    return c.json({ success: true, message: 'Pengguna berhasil dihapus' });
  } catch (err) {
    console.error('[Delete User Error]:', err);
    return c.json({ success: false, error: { code: 'SERVER_ERROR', message: 'Gagal menghapus pengguna' } }, 500);
  }
});
