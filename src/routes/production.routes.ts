import { Hono } from 'hono';
import { z } from 'zod';
import { eq, desc, and } from 'drizzle-orm';
import { db } from '../db/index.js';
import * as schema from '../db/schema/index.js';
import { AppEnv, AuthContextUser, requireRole } from '../middleware/auth.middleware.js';

const productionReportCreateSchema = z.object({
  totalLiters: z.coerce.number().positive('Total liter teh wajib lebih besar dari 0'),
  notes: z.string().trim().optional().nullable(),
  staffId: z.string().uuid().optional(),
  reportDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Format tanggal YYYY-MM-DD').optional(),
});

const productionReportUpdateSchema = z.object({
  totalLiters: z.coerce.number().positive('Total liter teh wajib lebih besar dari 0').optional(),
  notes: z.string().trim().optional().nullable(),
  staffId: z.string().uuid().optional(),
  reportDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Format tanggal YYYY-MM-DD').optional(),
});

const productionDeliveryCreateSchema = z.object({
  boothId: z.string().uuid('ID booth wajib berupa UUID valid'),
  totalLiters: z.coerce.number().positive('Total liter pengiriman teh wajib lebih besar dari 0'),
  notes: z.string().trim().optional().nullable(),
  staffId: z.string().uuid().optional(),
  deliveryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Format tanggal YYYY-MM-DD').optional(),
});

const productionDeliveryUpdateSchema = z.object({
  boothId: z.string().uuid('ID booth wajib berupa UUID valid').optional(),
  totalLiters: z.coerce.number().positive('Total liter pengiriman teh wajib lebih besar dari 0').optional(),
  notes: z.string().trim().optional().nullable(),
  staffId: z.string().uuid().optional(),
  deliveryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Format tanggal YYYY-MM-DD').optional(),
});

function getWibDateString(): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jakarta',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const year = parts.find((p) => p.type === 'year')?.value;
  const month = parts.find((p) => p.type === 'month')?.value;
  const day = parts.find((p) => p.type === 'day')?.value;
  return `${year}-${month}-${day}`;
}

function formatWibTime(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return (
    new Intl.DateTimeFormat('id-ID', {
      timeZone: 'Asia/Jakarta',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).format(d) + ' WIB'
  );
}

function isProductionOperatingHours(): boolean {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Jakarta',
    hour: 'numeric',
    minute: 'numeric',
    hour12: false,
  }).formatToParts(new Date());

  const hour = parseInt(parts.find((p) => p.type === 'hour')?.value || '0', 10);
  const minute = parseInt(parts.find((p) => p.type === 'minute')?.value || '0', 10);
  const totalMinutes = hour * 60 + minute;

  // 05:00 WIB (300 mins) to 21:00 WIB (1260 mins)
  return totalMinutes >= 5 * 60 && totalMinutes <= 21 * 60;
}

/**
 * Menghitung rekapitulasi stok teh dapur (Dimasak vs Terkirim) pada tanggal tertentu
 * Memastikan tidak terjadi defisit (pengiriman melebihi jumlah yang dimasak)
 */
async function getTeaStockSummary(targetDate: string, excludeDeliveryId?: string) {
  // 1. Ambil semua sesi memasak pada tanggal tersebut
  const cookingRecords = await db
    .select({ totalLiters: schema.productionReports.totalLiters })
    .from(schema.productionReports)
    .where(eq(schema.productionReports.reportDate, targetDate));

  const totalCooked = cookingRecords.reduce((acc, r) => acc + (parseFloat(r.totalLiters) || 0), 0);

  // 2. Ambil semua pengiriman ke booth pada tanggal tersebut
  const deliveryRecords = await db
    .select({ id: schema.productionDeliveries.id, totalLiters: schema.productionDeliveries.totalLiters })
    .from(schema.productionDeliveries)
    .where(eq(schema.productionDeliveries.deliveryDate, targetDate));

  const filteredDeliveries = excludeDeliveryId
    ? deliveryRecords.filter((d) => d.id !== excludeDeliveryId)
    : deliveryRecords;

  const totalDelivered = filteredDeliveries.reduce((acc, d) => acc + (parseFloat(d.totalLiters) || 0), 0);
  const remainingStock = Math.max(0, totalCooked - totalDelivered);

  return {
    date: targetDate,
    totalCooked: Math.round(totalCooked * 100) / 100,
    totalDelivered: Math.round(totalDelivered * 100) / 100,
    remainingStock: Math.round(remainingStock * 100) / 100,
  };
}

export const productionRouter = new Hono<AppEnv>();

// GET /production-stock (Cek Stok Teh Dapur Hari Ini / Per Tanggal)
productionRouter.get('/production-stock', requireRole('ADMIN', 'PRODUCTION'), async (c) => {
  try {
    const targetDate = c.req.query('date') || getWibDateString();
    const stock = await getTeaStockSummary(targetDate);
    return c.json({ success: true, data: stock });
  } catch (err) {
    console.error('[Get Production Stock Error]:', err);
    return c.json({ success: false, error: { code: 'SERVER_ERROR', message: 'Gagal memuat info stok teh dapur' } }, 500);
  }
});

// =============================================================================
// PRODUCTION REPORTS (MEMASAK TEH DI DAPUR)
// =============================================================================

// POST /production-reports (Create - Production Staff & Admin)
productionRouter.post('/production-reports', requireRole('ADMIN', 'PRODUCTION'), async (c) => {
  try {
    const user = c.get('user') as AuthContextUser;

    // Staf produksi dibatasi jam operasional 05:00-21:00, Admin memiliki akses bypass kapan saja
    if (user.role === 'PRODUCTION' && !isProductionOperatingHours()) {
      return c.json(
        {
          success: false,
          error: {
            code: 'OUTSIDE_OPERATING_HOURS',
            message: 'Akses Ditolak: Penginputan laporan memasak teh hanya dapat dilakukan pada jam operasional 05:00 - 21:00 WIB',
          },
        },
        403
      );
    }

    const rawBody = await c.req.json();
    const parseResult = productionReportCreateSchema.safeParse(rawBody);

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

    const { totalLiters, notes, staffId, reportDate } = parseResult.data;
    const targetDate = reportDate || getWibDateString();
    const targetStaffId = (user.role === 'ADMIN' && staffId) ? staffId : user.id;

    const [report] = await db
      .insert(schema.productionReports)
      .values({
        staffId: targetStaffId,
        reportDate: targetDate,
        totalLiters: String(totalLiters),
        notes: notes || null,
      })
      .returning();

    return c.json({ success: true, data: report }, 201);
  } catch (err) {
    console.error('[Production Report Create Error]:', err);
    return c.json({ success: false, error: { code: 'SERVER_ERROR', message: 'Gagal menyimpan laporan produksi' } }, 500);
  }
});

// GET /production-reports (Read List)
productionRouter.get('/production-reports', requireRole('ADMIN', 'PRODUCTION'), async (c) => {
  try {
    const fromDate = c.req.query('fromDate');
    const toDate = c.req.query('toDate');
    const search = (c.req.query('search') || '').toLowerCase().trim();

    const dbReports = await db
      .select({
        id: schema.productionReports.id,
        staffId: schema.productionReports.staffId,
        reportDate: schema.productionReports.reportDate,
        totalLiters: schema.productionReports.totalLiters,
        notes: schema.productionReports.notes,
        createdAt: schema.productionReports.createdAt,
        staffName: schema.users.name,
        staffEmail: schema.users.email,
      })
      .from(schema.productionReports)
      .leftJoin(schema.users, eq(schema.productionReports.staffId, schema.users.id))
      .orderBy(desc(schema.productionReports.createdAt));

    let formatted = dbReports.map((r) => {
      const timeStr = formatWibTime(r.createdAt);
      return {
        id: r.id,
        staffId: r.staffId,
        date: r.reportDate,
        time: timeStr,
        staffName: r.staffName ? `${r.staffName}` : 'Staf Dapur',
        staffEmail: r.staffEmail || '',
        liters: parseFloat(r.totalLiters) || 0,
        notes: r.notes || '-',
        status: 'Selesai Dimasak',
      };
    });

    if (fromDate) {
      formatted = formatted.filter((r) => r.date >= fromDate);
    }
    if (toDate) {
      formatted = formatted.filter((r) => r.date <= toDate);
    }
    if (search) {
      formatted = formatted.filter(
        (r) =>
          r.notes.toLowerCase().includes(search) ||
          r.staffName.toLowerCase().includes(search) ||
          r.date.includes(search) ||
          r.time.toLowerCase().includes(search)
      );
    }

    return c.json({ success: true, data: formatted });
  } catch (err) {
    console.error('[Get Production Reports Error]:', err);
    return c.json({ success: false, error: { code: 'SERVER_ERROR', message: 'Gagal memuat rekap laporan produksi' } }, 500);
  }
});

// PATCH /production-reports/:id (Update - Admin Only)
productionRouter.patch('/production-reports/:id', requireRole('ADMIN'), async (c) => {
  try {
    const id = c.req.param('id');
    if (!id) {
      return c.json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'ID laporan wajib disertakan' } }, 400);
    }

    const [currentReport] = await db
      .select()
      .from(schema.productionReports)
      .where(eq(schema.productionReports.id, id));

    if (!currentReport) {
      return c.json({ success: false, error: { code: 'NOT_FOUND', message: 'Laporan produksi tidak ditemukan' } }, 404);
    }

    const rawBody = await c.req.json();
    const parseResult = productionReportUpdateSchema.safeParse(rawBody);

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

    const { totalLiters, notes, staffId, reportDate } = parseResult.data;
    const targetDate = reportDate || currentReport.reportDate;
    const targetLiters = totalLiters !== undefined ? totalLiters : parseFloat(currentReport.totalLiters);

    // Safeguard Defisit: Pastikan perubahan total masak tidak lebih kecil dari total yang sudah dikirim ke booth
    const allCookings = await db
      .select()
      .from(schema.productionReports)
      .where(eq(schema.productionReports.reportDate, targetDate));

    const otherCooked = allCookings
      .filter((r) => r.id !== id)
      .reduce((acc, r) => acc + (parseFloat(r.totalLiters) || 0), 0);

    const newTotalCooked = otherCooked + targetLiters;

    const deliveries = await db
      .select()
      .from(schema.productionDeliveries)
      .where(eq(schema.productionDeliveries.deliveryDate, targetDate));

    const totalDelivered = deliveries.reduce((acc, d) => acc + (parseFloat(d.totalLiters) || 0), 0);

    if (newTotalCooked < totalDelivered) {
      return c.json(
        {
          success: false,
          error: {
            code: 'DEFICIT_NOT_ALLOWED',
            message: `Perubahan ditolak: Total teh terkirim ke booth pada tanggal ${targetDate} sudah mencapai ${totalDelivered} Liter. Mengubah total memasak menjadi ${newTotalCooked} Liter akan menyebabkan defisit stok.`,
          },
        },
        400
      );
    }

    const updateData: any = { updatedAt: new Date() };
    if (totalLiters !== undefined) updateData.totalLiters = String(totalLiters);
    if (notes !== undefined) updateData.notes = notes ? notes.trim() : null;
    if (staffId !== undefined) updateData.staffId = staffId;
    if (reportDate !== undefined) updateData.reportDate = reportDate;

    const [updated] = await db
      .update(schema.productionReports)
      .set(updateData)
      .where(eq(schema.productionReports.id, id))
      .returning();

    return c.json({ success: true, data: updated, message: 'Laporan produksi berhasil diperbarui' });
  } catch (err) {
    console.error('[Update Production Report Error]:', err);
    return c.json({ success: false, error: { code: 'SERVER_ERROR', message: 'Gagal memperbarui laporan produksi' } }, 500);
  }
});

// DELETE /production-reports/:id (Delete - Admin Only)
productionRouter.delete('/production-reports/:id', requireRole('ADMIN'), async (c) => {
  try {
    const id = c.req.param('id');
    if (!id) {
      return c.json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'ID laporan wajib disertakan' } }, 400);
    }

    const [currentReport] = await db
      .select()
      .from(schema.productionReports)
      .where(eq(schema.productionReports.id, id));

    if (!currentReport) {
      return c.json({ success: false, error: { code: 'NOT_FOUND', message: 'Laporan produksi tidak ditemukan' } }, 404);
    }

    // Safeguard Defisit: Pastikan penghapusan laporan masak tidak membuat total masak < total terkirim
    const targetDate = currentReport.reportDate;
    const allCookings = await db
      .select()
      .from(schema.productionReports)
      .where(eq(schema.productionReports.reportDate, targetDate));

    const remainingCooked = allCookings
      .filter((r) => r.id !== id)
      .reduce((acc, r) => acc + (parseFloat(r.totalLiters) || 0), 0);

    const deliveries = await db
      .select()
      .from(schema.productionDeliveries)
      .where(eq(schema.productionDeliveries.deliveryDate, targetDate));

    const totalDelivered = deliveries.reduce((acc, d) => acc + (parseFloat(d.totalLiters) || 0), 0);

    if (remainingCooked < totalDelivered) {
      return c.json(
        {
          success: false,
          error: {
            code: 'DEFICIT_NOT_ALLOWED',
            message: `Tidak dapat menghapus laporan memasak ini: Total teh terkirim ke booth pada tanggal ${targetDate} adalah ${totalDelivered} Liter. Menghapus sesi masak ini menyisakan ${remainingCooked} Liter yang akan menyebabkan defisit stok.`,
          },
        },
        400
      );
    }

    const [deleted] = await db
      .delete(schema.productionReports)
      .where(eq(schema.productionReports.id, id))
      .returning();

    return c.json({ success: true, message: 'Laporan produksi berhasil dihapus' });
  } catch (err) {
    console.error('[Delete Production Report Error]:', err);
    return c.json({ success: false, error: { code: 'SERVER_ERROR', message: 'Gagal menghapus laporan produksi' } }, 500);
  }
});

// =============================================================================
// PRODUCTION DELIVERIES (PENGIRIMAN TEH KE BOOTH)
// =============================================================================

// POST /production-deliveries (Create Delivery - Production Staff & Admin)
productionRouter.post('/production-deliveries', requireRole('ADMIN', 'PRODUCTION'), async (c) => {
  try {
    const user = c.get('user') as AuthContextUser;

    // Staf produksi dibatasi jam operasional 05:00-21:00, Admin memiliki akses bypass kapan saja
    if (user.role === 'PRODUCTION' && !isProductionOperatingHours()) {
      return c.json(
        {
          success: false,
          error: {
            code: 'OUTSIDE_OPERATING_HOURS',
            message: 'Akses Ditolak: Penginputan pengiriman teh hanya dapat dilakukan pada jam operasional 05:00 - 21:00 WIB',
          },
        },
        403
      );
    }

    const rawBody = await c.req.json();
    const parseResult = productionDeliveryCreateSchema.safeParse(rawBody);

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

    const { boothId, totalLiters, notes, staffId, deliveryDate } = parseResult.data;
    const targetDate = deliveryDate || getWibDateString();
    const targetStaffId = (user.role === 'ADMIN' && staffId) ? staffId : user.id;

    // 1. Verifikasi stok teh yang tersedia di dapur (Total Dimasak vs Total Terkirim)
    const stockSummary = await getTeaStockSummary(targetDate);

    if (totalLiters > stockSummary.remainingStock) {
      return c.json(
        {
          success: false,
          error: {
            code: 'INSUFFICIENT_STOCK',
            message: `Stok teh dapur tidak mencukupi: Total dimasak hari ini (${targetDate}) adalah ${stockSummary.totalCooked} Liter (sudah terkirim ${stockSummary.totalDelivered} Liter, sisa stok ${stockSummary.remainingStock} Liter). Pengiriman ${totalLiters} Liter melebihi stok yang tersedia (tidak boleh defisit).`,
          },
        },
        400
      );
    }

    // 2. Verifikasi booth tujuan aktif
    const [booth] = await db
      .select()
      .from(schema.booths)
      .where(eq(schema.booths.id, boothId));

    if (!booth) {
      return c.json({ success: false, error: { code: 'NOT_FOUND', message: 'Booth tujuan tidak ditemukan' } }, 404);
    }

    const [delivery] = await db
      .insert(schema.productionDeliveries)
      .values({
        staffId: targetStaffId,
        boothId: boothId,
        deliveryDate: targetDate,
        totalLiters: String(totalLiters),
        notes: notes || null,
      })
      .returning();

    return c.json({ success: true, data: delivery, message: 'Laporan pengiriman teh ke booth berhasil dicatat' }, 201);
  } catch (err) {
    console.error('[Production Delivery Create Error]:', err);
    return c.json({ success: false, error: { code: 'SERVER_ERROR', message: 'Gagal menyimpan laporan pengiriman ke booth' } }, 500);
  }
});

// GET /production-deliveries (List Deliveries - Admin & Production Staff)
productionRouter.get('/production-deliveries', requireRole('ADMIN', 'PRODUCTION'), async (c) => {
  try {
    const fromDate = c.req.query('fromDate');
    const toDate = c.req.query('toDate');
    const boothId = c.req.query('boothId');
    const search = (c.req.query('search') || '').toLowerCase().trim();

    const dbDeliveries = await db
      .select({
        id: schema.productionDeliveries.id,
        staffId: schema.productionDeliveries.staffId,
        boothId: schema.productionDeliveries.boothId,
        deliveryDate: schema.productionDeliveries.deliveryDate,
        totalLiters: schema.productionDeliveries.totalLiters,
        notes: schema.productionDeliveries.notes,
        createdAt: schema.productionDeliveries.createdAt,
        staffName: schema.users.name,
        staffEmail: schema.users.email,
        boothName: schema.booths.name,
        boothAddress: schema.booths.address,
      })
      .from(schema.productionDeliveries)
      .leftJoin(schema.users, eq(schema.productionDeliveries.staffId, schema.users.id))
      .leftJoin(schema.booths, eq(schema.productionDeliveries.boothId, schema.booths.id))
      .orderBy(desc(schema.productionDeliveries.createdAt));

    let formatted = dbDeliveries.map((d) => {
      const timeStr = formatWibTime(d.createdAt);
      return {
        id: d.id,
        staffId: d.staffId,
        boothId: d.boothId,
        date: d.deliveryDate,
        time: timeStr,
        staffName: d.staffName ? `${d.staffName}` : 'Staf Dapur',
        staffEmail: d.staffEmail || '',
        boothName: d.boothName || 'Booth Teh Baling',
        boothAddress: d.boothAddress || '-',
        liters: parseFloat(d.totalLiters) || 0,
        notes: d.notes || '-',
        status: 'Terkirim ke Booth',
      };
    });

    if (fromDate) {
      formatted = formatted.filter((d) => d.date >= fromDate);
    }
    if (toDate) {
      formatted = formatted.filter((d) => d.date <= toDate);
    }
    if (boothId && boothId !== 'ALL') {
      formatted = formatted.filter((d) => d.boothId === boothId);
    }
    if (search) {
      formatted = formatted.filter(
        (d) =>
          d.notes.toLowerCase().includes(search) ||
          d.staffName.toLowerCase().includes(search) ||
          d.boothName.toLowerCase().includes(search) ||
          d.date.includes(search) ||
          d.time.toLowerCase().includes(search)
      );
    }

    return c.json({ success: true, data: formatted });
  } catch (err) {
    console.error('[Get Production Deliveries Error]:', err);
    return c.json({ success: false, error: { code: 'SERVER_ERROR', message: 'Gagal memuat rekap laporan pengiriman booth' } }, 500);
  }
});

// PATCH /production-deliveries/:id (Update Delivery - Admin Only)
productionRouter.patch('/production-deliveries/:id', requireRole('ADMIN'), async (c) => {
  try {
    const id = c.req.param('id');
    if (!id) {
      return c.json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'ID pengiriman wajib disertakan' } }, 400);
    }

    const [currentDelivery] = await db
      .select()
      .from(schema.productionDeliveries)
      .where(eq(schema.productionDeliveries.id, id));

    if (!currentDelivery) {
      return c.json({ success: false, error: { code: 'NOT_FOUND', message: 'Data pengiriman tidak ditemukan' } }, 404);
    }

    const rawBody = await c.req.json();
    const parseResult = productionDeliveryUpdateSchema.safeParse(rawBody);

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

    const { boothId, totalLiters, notes, staffId, deliveryDate } = parseResult.data;
    const targetDate = deliveryDate || currentDelivery.deliveryDate;
    const targetLiters = totalLiters !== undefined ? totalLiters : parseFloat(currentDelivery.totalLiters);

    // Safeguard Defisit: Verifikasi stok teh tersedia mengecualikan pengiriman ini
    const stockSummary = await getTeaStockSummary(targetDate, id);

    if (targetLiters > stockSummary.remainingStock) {
      return c.json(
        {
          success: false,
          error: {
            code: 'INSUFFICIENT_STOCK',
            message: `Stok teh dapur tidak mencukupi: Total dimasak pada tanggal ${targetDate} adalah ${stockSummary.totalCooked} Liter (sudah terkirim ${stockSummary.totalDelivered} Liter, sisa stok ${stockSummary.remainingStock} Liter). Pengiriman ${targetLiters} Liter melebihi stok yang tersedia.`,
          },
        },
        400
      );
    }

    const updateData: any = { updatedAt: new Date() };
    if (boothId !== undefined) updateData.boothId = boothId;
    if (totalLiters !== undefined) updateData.totalLiters = String(totalLiters);
    if (notes !== undefined) updateData.notes = notes ? notes.trim() : null;
    if (staffId !== undefined) updateData.staffId = staffId;
    if (deliveryDate !== undefined) updateData.deliveryDate = deliveryDate;

    const [updated] = await db
      .update(schema.productionDeliveries)
      .set(updateData)
      .where(eq(schema.productionDeliveries.id, id))
      .returning();

    return c.json({ success: true, data: updated, message: 'Laporan pengiriman booth berhasil diperbarui' });
  } catch (err) {
    console.error('[Update Production Delivery Error]:', err);
    return c.json({ success: false, error: { code: 'SERVER_ERROR', message: 'Gagal memperbarui data pengiriman' } }, 500);
  }
});

// DELETE /production-deliveries/:id (Delete Delivery - Admin Only)
productionRouter.delete('/production-deliveries/:id', requireRole('ADMIN'), async (c) => {
  try {
    const id = c.req.param('id');
    if (!id) {
      return c.json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'ID pengiriman wajib disertakan' } }, 400);
    }

    const [deleted] = await db
      .delete(schema.productionDeliveries)
      .where(eq(schema.productionDeliveries.id, id))
      .returning();

    if (!deleted) {
      return c.json({ success: false, error: { code: 'NOT_FOUND', message: 'Data pengiriman tidak ditemukan' } }, 404);
    }

    return c.json({ success: true, message: 'Laporan pengiriman booth berhasil dihapus' });
  } catch (err) {
    console.error('[Delete Production Delivery Error]:', err);
    return c.json({ success: false, error: { code: 'SERVER_ERROR', message: 'Gagal menghapus data pengiriman' } }, 500);
  }
});
