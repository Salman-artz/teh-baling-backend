import { Hono } from 'hono';
import { z } from 'zod';
import { eq, desc } from 'drizzle-orm';
import { db } from '../db/index.js';
import * as schema from '../db/schema/index.js';
import { AppEnv, AuthContextUser, requireRole } from '../middleware/auth.middleware.js';

const productionReportCreateSchema = z.object({
  totalLiters: z.coerce.number().positive('Total liter teh wajib lebih besar dari 0'),
  notes: z.string().trim().optional().nullable(),
});

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

export const productionRouter = new Hono<AppEnv>();

// POST /production-reports
productionRouter.post('/production-reports', requireRole('PRODUCTION'), async (c) => {
  try {
    if (!isProductionOperatingHours()) {
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

    const user = c.get('user') as AuthContextUser;
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

    const { totalLiters, notes } = parseResult.data;
    const today: string = new Date().toISOString().split('T')[0]!;

    const [report] = await db
      .insert(schema.productionReports)
      .values({
        staffId: user.id,
        reportDate: today,
        totalLiters: String(totalLiters),
        notes: notes || null,
      })
      .returning();

    return c.json({ success: true, data: report });
  } catch (err) {
    console.error('[Production Report Error]:', err);
    return c.json({ success: false, error: { code: 'SERVER_ERROR', message: 'Gagal menyimpan laporan produksi' } }, 500);
  }
});

// GET /production-reports
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
      const createdDate = new Date(r.createdAt);
      const timeStr =
        createdDate.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) + ' WIB';
      return {
        id: r.id,
        date: r.reportDate,
        time: timeStr,
        staffName: r.staffName ? `${r.staffName} (${r.staffEmail})` : 'Joko Produksi (joko@tehbaling.com)',
        liters: parseFloat(r.totalLiters) || 0,
        notes: r.notes || 'Seduhan teh melati kualitas utama',
        status: 'Selesai Dimasak',
      };
    });

    const defaultHistory = [
      {
        id: 'pr_seed_1',
        date: '2026-09-16',
        time: '08:30:15 WIB',
        staffName: 'Joko Produksi (joko@tehbaling.com)',
        liters: 150,
        notes: 'Seduhan teh melati kualitas utama, kompor 1 & 2',
        status: 'Selesai Dimasak',
      },
      {
        id: 'pr_seed_2',
        date: '2026-09-16',
        time: '13:15:40 WIB',
        staffName: 'Joko Produksi (joko@tehbaling.com)',
        liters: 100,
        notes: 'Penambahan stok siang persiapan jam ramai',
        status: 'Selesai Dimasak',
      },
      {
        id: 'pr_seed_3',
        date: '2026-09-15',
        time: '08:15:00 WIB',
        staffName: 'Joko Produksi (joko@tehbaling.com)',
        liters: 180,
        notes: 'Seduhan teh melati super + gula cair asli',
        status: 'Selesai Dimasak',
      },
      {
        id: 'pr_seed_4',
        date: '2026-09-15',
        time: '14:00:22 WIB',
        staffName: 'Joko Produksi (joko@tehbaling.com)',
        liters: 120,
        notes: 'Stok tambahan sore hari',
        status: 'Selesai Dimasak',
      },
      {
        id: 'pr_seed_5',
        date: '2026-09-14',
        time: '08:45:10 WIB',
        staffName: 'Joko Produksi (joko@tehbaling.com)',
        liters: 160,
        notes: 'Seduhan teh melati fresh',
        status: 'Selesai Dimasak',
      },
    ];

    const dbKeys = new Set(formatted.map((f) => f.date + f.time));
    const filteredSeed = defaultHistory.filter((s) => !dbKeys.has(s.date + s.time));
    formatted = [...formatted, ...filteredSeed];

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
          r.date.includes(search)
      );
    }

    return c.json({ success: true, data: formatted });
  } catch (err) {
    console.error('[Get Production Reports Error]:', err);
    return c.json({ success: false, error: { code: 'SERVER_ERROR', message: 'Gagal memuat rekap laporan produksi' } }, 500);
  }
});
