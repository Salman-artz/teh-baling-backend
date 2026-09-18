import { Hono } from 'hono';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { eq, desc, and } from 'drizzle-orm';
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
    const showAll = c.req.query('all') === 'true';
    const user = c.get('user') as AuthContextUser;
    const isGlobal = showAll || user.role === 'ADMIN';

    const list = isGlobal
      ? await db.select().from(schema.teaSeries).orderBy(desc(schema.teaSeries.createdAt))
      : await db.select().from(schema.teaSeries).where(eq(schema.teaSeries.isActive, true)).orderBy(desc(schema.teaSeries.createdAt));

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

masterRouter.patch('/tea-series/:id', requireRole('ADMIN'), async (c) => {
  try {
    const id = c.req.param('id');
    if (!id) {
      return c.json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'ID series wajib disertakan' } }, 400);
    }
    const { name, description, isActive } = await c.req.json();
    const updateData: any = { updatedAt: new Date() };
    if (name !== undefined) updateData.name = name.trim();
    if (description !== undefined) updateData.description = description ? description.trim() : null;
    if (isActive !== undefined) updateData.isActive = Boolean(isActive);

    const [updated] = await db
      .update(schema.teaSeries)
      .set(updateData)
      .where(eq(schema.teaSeries.id, id))
      .returning();
    return c.json({ success: true, data: updated });
  } catch (err) {
    console.error('[Update Tea Series Error]:', err);
    return c.json({ success: false, error: { code: 'SERVER_ERROR', message: 'Gagal mengubah series teh' } }, 500);
  }
});

masterRouter.delete('/tea-series/:id', requireRole('ADMIN'), async (c) => {
  try {
    const id = c.req.param('id');
    if (!id) {
      return c.json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'ID series wajib disertakan' } }, 400);
    }
    try {
      await db.delete(schema.teaSeries).where(eq(schema.teaSeries.id, id));
    } catch {
      await db.update(schema.teaSeries).set({ isActive: false, updatedAt: new Date() }).where(eq(schema.teaSeries.id, id));
    }
    return c.json({ success: true, message: 'Series teh berhasil dihapus' });
  } catch (err) {
    console.error('[Delete Tea Series Error]:', err);
    return c.json({ success: false, error: { code: 'SERVER_ERROR', message: 'Gagal menghapus series teh' } }, 500);
  }
});

// =============================================================================
// TEA PRODUCTS
// =============================================================================

masterRouter.get('/tea-products', requireRole('ADMIN', 'BOOTH_ATTENDANT', 'PRODUCTION'), async (c) => {
  try {
    const showAll = c.req.query('all') === 'true';
    const user = c.get('user') as AuthContextUser;
    const isGlobal = showAll || user.role === 'ADMIN';

    let query = db
      .select({
        id: schema.teaProducts.id,
        name: schema.teaProducts.name,
        seriesId: schema.teaProducts.seriesId,
        seriesName: schema.teaSeries.name,
        description: schema.teaProducts.description,
        isActive: schema.teaProducts.isActive,
        createdAt: schema.teaProducts.createdAt,
      })
      .from(schema.teaProducts)
      .leftJoin(schema.teaSeries, eq(schema.teaProducts.seriesId, schema.teaSeries.id));

    let list = isGlobal
      ? await query.orderBy(desc(schema.teaProducts.createdAt))
      : await query.where(eq(schema.teaProducts.isActive, true)).orderBy(desc(schema.teaProducts.createdAt));

    // Auto-seed default products if empty so attendant is never blocked
    if (list.length === 0) {
      let series = await db.query.teaSeries.findFirst();
      if (!series) {
        const [newSeries] = await db
          .insert(schema.teaSeries)
          .values({
            name: 'Original Tea Series',
            description: 'Varian Teh Racikan Asli Teh Baling',
          })
          .returning();
        series = newSeries;
      }

      if (series) {
        await db
          .insert(schema.teaProducts)
          .values([
            { name: 'Teh Baling Melati Original', seriesId: series.id, description: 'Teh melati wangi khas' },
            { name: 'Teh Kampul Lemon Segar', seriesId: series.id, description: 'Teh kampul perasan lemon asli' },
            { name: 'Teh Baling Yakult Segar', seriesId: series.id, description: 'Teh manis segar perpaduan Yakult' },
            { name: 'Teh Baling Lychee Fruity', seriesId: series.id, description: 'Teh rasa leci segar' },
          ])
          .onConflictDoNothing();

        list = isGlobal
          ? await query.orderBy(desc(schema.teaProducts.createdAt))
          : await query.where(eq(schema.teaProducts.isActive, true)).orderBy(desc(schema.teaProducts.createdAt));
      }
    }

    return c.json({ success: true, data: list });
  } catch (err) {
    console.error('[Get Tea Products Error]:', err);
    return c.json({ success: false, error: { code: 'SERVER_ERROR', message: 'Gagal mengambil data produk teh' } }, 500);
  }
});

masterRouter.post('/tea-products', requireRole('ADMIN'), async (c) => {
  try {
    const { name, seriesId, description } = await c.req.json();
    if (!name || !name.trim()) {
      return c.json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Nama produk wajib diisi' } }, 400);
    }
    if (!seriesId) {
      return c.json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Pilih series teh' } }, 400);
    }

    const [created] = await db
      .insert(schema.teaProducts)
      .values({
        name: name.trim(),
        seriesId,
        description: description ? description.trim() : null,
      })
      .returning();

    return c.json({ success: true, data: created }, 201);
  } catch (err) {
    console.error('[Create Tea Product Error]:', err);
    return c.json({ success: false, error: { code: 'SERVER_ERROR', message: 'Gagal menambahkan produk teh' } }, 500);
  }
});

masterRouter.patch('/tea-products/:id', requireRole('ADMIN'), async (c) => {
  try {
    const id = c.req.param('id');
    if (!id) {
      return c.json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'ID produk wajib disertakan' } }, 400);
    }
    const { name, seriesId, description, isActive } = await c.req.json();
    const updateData: any = { updatedAt: new Date() };
    if (name !== undefined) updateData.name = name.trim();
    if (seriesId !== undefined) updateData.seriesId = seriesId;
    if (description !== undefined) updateData.description = description ? description.trim() : null;
    if (isActive !== undefined) updateData.isActive = Boolean(isActive);

    const [updated] = await db
      .update(schema.teaProducts)
      .set(updateData)
      .where(eq(schema.teaProducts.id, id))
      .returning();
    return c.json({ success: true, data: updated });
  } catch (err) {
    console.error('[Update Tea Product Error]:', err);
    return c.json({ success: false, error: { code: 'SERVER_ERROR', message: 'Gagal mengubah produk teh' } }, 500);
  }
});

masterRouter.delete('/tea-products/:id', requireRole('ADMIN'), async (c) => {
  try {
    const id = c.req.param('id');
    if (!id) {
      return c.json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'ID produk wajib disertakan' } }, 400);
    }
    try {
      await db.delete(schema.teaProducts).where(eq(schema.teaProducts.id, id));
    } catch {
      await db.update(schema.teaProducts).set({ isActive: false, updatedAt: new Date() }).where(eq(schema.teaProducts.id, id));
    }
    return c.json({ success: true, message: 'Produk teh berhasil dihapus' });
  } catch (err) {
    console.error('[Delete Tea Product Error]:', err);
    return c.json({ success: false, error: { code: 'SERVER_ERROR', message: 'Gagal menghapus produk teh' } }, 500);
  }
});

// =============================================================================
// CUP TYPES
// =============================================================================

masterRouter.get('/cup-types', requireRole('ADMIN', 'BOOTH_ATTENDANT', 'PRODUCTION'), async (c) => {
  try {
    const showAll = c.req.query('all') === 'true';
    const user = c.get('user') as AuthContextUser;
    const isGlobal = showAll || user.role === 'ADMIN';

    let list = isGlobal
      ? await db.select().from(schema.cupTypes).orderBy(desc(schema.cupTypes.createdAt))
      : await db.select().from(schema.cupTypes).where(eq(schema.cupTypes.isActive, true)).orderBy(desc(schema.cupTypes.createdAt));

    if (list.length === 0) {
      await db.insert(schema.cupTypes).values([
        { id: 'c1111111-1111-1111-1111-111111111111', name: 'Cup Kecil (Reguler)', price: 5000 },
        { id: 'c2222222-2222-2222-2222-222222222222', name: 'Cup Medium (Sedang)', price: 8000 },
        { id: 'c3333333-3333-3333-3333-333333333333', name: 'Cup Big (Besar)', price: 10000 },
        { id: 'c4444444-4444-4444-4444-444444444444', name: 'Cup Jumbo (1 Liter)', price: 12000 },
      ]).onConflictDoNothing();
      list = isGlobal
        ? await db.select().from(schema.cupTypes).orderBy(desc(schema.cupTypes.createdAt))
        : await db.select().from(schema.cupTypes).where(eq(schema.cupTypes.isActive, true)).orderBy(desc(schema.cupTypes.createdAt));
    }
    return c.json({ success: true, data: list });
  } catch (err) {
    console.error('[Get Cup Types Error]:', err);
    return c.json({ success: false, error: { code: 'SERVER_ERROR', message: 'Gagal mengambil data tipe cup' } }, 500);
  }
});

masterRouter.post('/cup-types', requireRole('ADMIN'), async (c) => {
  try {
    const { name, price } = await c.req.json();
    if (!name || !name.trim()) {
      return c.json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Nama ukuran cup wajib diisi' } }, 400);
    }
    const [created] = await db
      .insert(schema.cupTypes)
      .values({
        name: name.trim(),
        price: typeof price === 'number' ? price : 10000,
      })
      .returning();
    return c.json({ success: true, data: created }, 201);
  } catch (err) {
    console.error('[Create Cup Type Error]:', err);
    return c.json({ success: false, error: { code: 'SERVER_ERROR', message: 'Gagal menambahkan ukuran cup' } }, 500);
  }
});

masterRouter.patch('/cup-types/:id', requireRole('ADMIN'), async (c) => {
  try {
    const id = c.req.param('id');
    if (!id) {
      return c.json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'ID cup wajib disertakan' } }, 400);
    }
    const { name, price, isActive } = await c.req.json();
    const updateData: any = { updatedAt: new Date() };
    if (name !== undefined) updateData.name = name.trim();
    if (price !== undefined) updateData.price = Number(price);
    if (isActive !== undefined) updateData.isActive = Boolean(isActive);

    const [updated] = await db
      .update(schema.cupTypes)
      .set(updateData)
      .where(eq(schema.cupTypes.id, id))
      .returning();
    return c.json({ success: true, data: updated });
  } catch (err) {
    console.error('[Update Cup Type Error]:', err);
    return c.json({ success: false, error: { code: 'SERVER_ERROR', message: 'Gagal mengubah ukuran cup' } }, 500);
  }
});

masterRouter.delete('/cup-types/:id', requireRole('ADMIN'), async (c) => {
  try {
    const id = c.req.param('id');
    if (!id) {
      return c.json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'ID cup wajib disertakan' } }, 400);
    }
    try {
      await db.delete(schema.cupTypes).where(eq(schema.cupTypes.id, id));
    } catch {
      await db.update(schema.cupTypes).set({ isActive: false }).where(eq(schema.cupTypes.id, id));
    }
    return c.json({ success: true, message: 'Ukuran cup berhasil dihapus' });
  } catch (err) {
    console.error('[Delete Cup Type Error]:', err);
    return c.json({ success: false, error: { code: 'SERVER_ERROR', message: 'Gagal menghapus ukuran cup' } }, 500);
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
    const roleQuery = c.req.query('role');
    let list = await db
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

    if (roleQuery && roleQuery !== 'ALL') {
      list = list.filter((u) => u.role === roleQuery);
    }

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

// =============================================================================
// BOOTH ASSIGNMENTS (PENUGASAN SHIFT BOOTH)
// =============================================================================

masterRouter.get('/booth-assignments', requireRole('ADMIN', 'BOOTH_ATTENDANT', 'PRODUCTION'), async (c) => {
  try {
    const dateQuery = c.req.query('date');
    const boothIdQuery = c.req.query('boothId');

    const dbList = await db
      .select({
        id: schema.boothAssignments.id,
        boothId: schema.boothAssignments.boothId,
        boothName: schema.booths.name,
        boothAddress: schema.booths.address,
        latitude: schema.booths.latitude,
        longitude: schema.booths.longitude,
        userId: schema.boothAssignments.userId,
        userName: schema.users.name,
        userEmail: schema.users.email,
        assignmentDate: schema.boothAssignments.assignmentDate,
        shiftType: schema.boothAssignments.shiftType,
        createdAt: schema.boothAssignments.createdAt,
      })
      .from(schema.boothAssignments)
      .innerJoin(schema.booths, eq(schema.boothAssignments.boothId, schema.booths.id))
      .innerJoin(schema.users, eq(schema.boothAssignments.userId, schema.users.id))
      .orderBy(desc(schema.boothAssignments.assignmentDate), desc(schema.boothAssignments.createdAt));

    const normalizeDate = (d: unknown): string => {
      if (!d) return '';
      if (typeof d === 'string') return d.includes('T') ? (d.split('T')[0] || '') : d;
      if (d instanceof Date) return d.toISOString().split('T')[0] || '';
      return String(d).split('T')[0] || '';
    };

    let filtered = dbList;
    if (dateQuery) {
      filtered = filtered.filter((a) => normalizeDate(a.assignmentDate) === dateQuery);
    }
    if (boothIdQuery) {
      filtered = filtered.filter((a) => a.boothId === boothIdQuery);
    }

    const formatted = filtered.map((a) => ({
      id: a.id,
      date: normalizeDate(a.assignmentDate),
      shiftType: a.shiftType || 'PAGI',
      boothId: a.boothId,
      boothName: a.boothName,
      boothAddress: a.boothAddress || 'Alamat Booth',
      latitude: a.latitude ? parseFloat(a.latitude) : -7.2575,
      longitude: a.longitude ? parseFloat(a.longitude) : 112.7521,
      userId: a.userId,
      userEmail: a.userEmail,
      userName: a.userName,
      assignedBy: 'Administrator',
      status: 'OPEN',
    }));

    return c.json({ success: true, data: formatted });
  } catch (err) {
    console.error('[Get Booth Assignments Error]:', err);
    return c.json({ success: false, error: { code: 'SERVER_ERROR', message: 'Gagal memuat jadwal penugasan shift' } }, 500);
  }
});

masterRouter.post('/booth-assignments', requireRole('ADMIN'), async (c) => {
  try {
    const rawBody = await c.req.json();
    const { boothId, userId, date, shiftType } = rawBody;
    const currentUser = c.get('user') as AuthContextUser;

    if (!boothId) {
      return c.json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Pilih booth penugasan' } }, 400);
    }
    if (!userId) {
      return c.json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Pilih staf attendant' } }, 400);
    }
    if (!date) {
      return c.json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Tanggal penugasan wajib diisi' } }, 400);
    }

    const validShiftType = shiftType === 'SORE' ? 'SORE' : 'PAGI';

    // Cek booth aktif
    const booth = await db.query.booths.findFirst({
      where: eq(schema.booths.id, boothId),
    });
    if (!booth) {
      return c.json({ success: false, error: { code: 'NOT_FOUND', message: 'Booth tidak ditemukan' } }, 404);
    }

    // Cek staf penugasan dan perannya
    const targetUser = await db.query.users.findFirst({
      where: eq(schema.users.id, userId),
    });
    if (!targetUser) {
      return c.json({ success: false, error: { code: 'NOT_FOUND', message: 'Staf pengguna tidak ditemukan' } }, 404);
    }
    if (targetUser.role !== 'BOOTH_ATTENDANT') {
      return c.json(
        {
          success: false,
          error: {
            code: 'INVALID_ROLE',
            message: `Akses Ditolak: Hanya staf stand booth (BOOTH_ATTENDANT) yang dapat dijadwalkan shift. Akun "${targetUser.name}" adalah ${targetUser.role === 'ADMIN' ? 'Administrator' : 'Staf Produksi Dapur'} (Admin & Produksi tidak bisa dijadwalkan shift booth).`,
          },
        },
        400
      );
    }

    // Validasi aturan: 1 Booth tidak boleh memiliki 2 penugasan pada tanggal yang sama
    const existingBoothAssignment = await db.query.boothAssignments.findFirst({
      where: and(
        eq(schema.boothAssignments.boothId, boothId),
        eq(schema.boothAssignments.assignmentDate, date)
      ),
    });
    if (existingBoothAssignment) {
      return c.json(
        {
          success: false,
          error: {
            code: 'BOOTH_ALREADY_ASSIGNED',
            message: `Akses Ditolak: Booth "${booth.name}" sudah memiliki penugasan pada tanggal ${date}. Tidak boleh ada 2 shift di satu booth yang sama.`,
          },
        },
        400
      );
    }

    // Validasi aturan: 1 Staf tidak boleh bertugas di 2 booth berbeda pada tanggal yang sama
    const existingUserAssignment = await db.query.boothAssignments.findFirst({
      where: and(
        eq(schema.boothAssignments.userId, userId),
        eq(schema.boothAssignments.assignmentDate, date)
      ),
    });
    if (existingUserAssignment) {
      return c.json(
        {
          success: false,
          error: {
            code: 'USER_ALREADY_ASSIGNED',
            message: `Staf ini sudah memiliki jadwal penugasan booth lain pada tanggal ${date}.`,
          },
        },
        400
      );
    }

    const [newAssignment] = await db
      .insert(schema.boothAssignments)
      .values({
        boothId,
        userId,
        assignmentDate: date,
        shiftType: validShiftType,
        createdBy: currentUser.id,
      })
      .returning();

    return c.json({ success: true, data: newAssignment }, 201);
  } catch (err) {
    console.error('[Create Booth Assignment Error]:', err);
    return c.json({ success: false, error: { code: 'SERVER_ERROR', message: 'Gagal membuat penugasan shift' } }, 500);
  }
});

masterRouter.delete('/booth-assignments/:id', requireRole('ADMIN'), async (c) => {
  try {
    const id = c.req.param('id');
    if (!id) {
      return c.json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'ID penugasan wajib disertakan' } }, 400);
    }

    await db.delete(schema.boothAssignments).where(eq(schema.boothAssignments.id, id));
    return c.json({ success: true, message: 'Penugasan shift berhasil dihapus' });
  } catch (err) {
    console.error('[Delete Booth Assignment Error]:', err);
    return c.json({ success: false, error: { code: 'SERVER_ERROR', message: 'Gagal menghapus penugasan shift' } }, 500);
  }
});
