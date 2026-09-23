import { Hono } from 'hono';
import { z } from 'zod';
import { eq, and, desc, ilike } from 'drizzle-orm';
import { db } from '../db/index.js';
import * as schema from '../db/schema/index.js';
import { AppEnv, AuthContextUser, requireRole } from '../middleware/auth.middleware.js';
import { getWibDateString } from '../utils/date.js';

const dailyReportStartSchema = z.object({
  cashModal: z.coerce.number().int().min(0, 'Modal cash tidak boleh bernilai negatif'),
  stockItems: z
    .array(
      z.object({
        cupTypeId: z.string(),
        qtyInitial: z.coerce.number().int().min(0),
      })
    )
    .optional(),
  gpsLatitude: z.coerce.number().nullable().optional(),
  gpsLongitude: z.coerce.number().nullable().optional(),
  gpsAccuracy: z.coerce.number().nullable().optional(),
});

const dailyReportEndSchema = z.object({
  cashFinal: z.coerce.number().int().min(0, 'Uang akhir kasir tidak boleh bernilai negatif'),
  stockItems: z
    .array(
      z.object({
        cupTypeId: z.string(),
        qtyInitial: z.coerce.number().int().min(0).optional(),
        qtyAdded: z.coerce.number().int().min(0).optional(),
        qtyFinal: z.coerce.number().int().min(0).optional(),
        qtySold: z.coerce.number().int().min(0).optional(),
      })
    )
    .optional(),
  saleItems: z
    .array(
      z.object({
        productId: z.string(),
        cupTypeId: z.string().optional(),
        qtySold: z.coerce.number().int().min(0),
      })
    )
    .optional(),
  teaRemainingLiters: z.coerce.number().min(0, 'Sisa teh tidak boleh bernilai negatif').optional(),
  notes: z.string().trim().optional().nullable(),
  gpsLatitude: z.coerce.number().nullable().optional(),
  gpsLongitude: z.coerce.number().nullable().optional(),
  gpsAccuracy: z.coerce.number().nullable().optional(),
});

const restockCupsSchema = z.object({
  cupTypeId: z.string().uuid('ID cup type wajib valid'),
  qtyAdded: z.coerce.number().int().positive('Jumlah penambahan cup wajib lebih dari 0'),
  notes: z.string().trim().optional().nullable(),
});

function calculateDistanceMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371e3; // Radius bumi dalam meter
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

const MAX_ATTENDANCE_DISTANCE_METERS = 200;
const KRAS_CENTRAL_LAT = -7.9546871;
const KRAS_CENTRAL_LNG = 111.9627637;

async function validateAttendanceLocation(
  targetBoothId: string | null | undefined,
  gpsLatitude: number | null | undefined,
  gpsLongitude: number | null | undefined
): Promise<{ valid: boolean; message?: string }> {
  if (gpsLatitude == null || gpsLongitude == null) {
    return {
      valid: false,
      message: 'Akses Ditolak: Lokasi GPS belum terdeteksi. Anda wajib mendeteksi lokasi GPS sebelum melanjutkan.',
    };
  }

  let targetBoothName = 'Booth';
  let distTarget: number | null = null;

  if (targetBoothId) {
    const booth = await db.query.booths.findFirst({
      where: eq(schema.booths.id, targetBoothId),
    });
    if (booth) {
      targetBoothName = booth.name || 'Booth';
      if (booth.latitude && booth.longitude) {
        const bLat = parseFloat(booth.latitude);
        const bLng = parseFloat(booth.longitude);
        if (!isNaN(bLat) && !isNaN(bLng)) {
          distTarget = calculateDistanceMeters(bLat, bLng, gpsLatitude, gpsLongitude);
        }
      }
    }
  }

  // Hitung jarak ke Pusat Produksi Kras (Outlet Kras)
  let krasLat = KRAS_CENTRAL_LAT;
  let krasLng = KRAS_CENTRAL_LNG;
  try {
    const krasBooth = await db.query.booths.findFirst({
      where: and(eq(schema.booths.isActive, true), ilike(schema.booths.name, '%Kras%')),
    });
    if (krasBooth && krasBooth.latitude && krasBooth.longitude) {
      const lat = parseFloat(krasBooth.latitude);
      const lng = parseFloat(krasBooth.longitude);
      if (!isNaN(lat) && !isNaN(lng)) {
        krasLat = lat;
        krasLng = lng;
      }
    }
  } catch (err) {
    // fallback to static coordinates
  }

  const distKras = calculateDistanceMeters(krasLat, krasLng, gpsLatitude, gpsLongitude);

  // Jika dekat dengan target booth (<=200m) ATAU dekat dengan Pusat Produksi Kras (<=200m)
  const isAtTarget = distTarget !== null && distTarget <= MAX_ATTENDANCE_DISTANCE_METERS;
  const isAtKras = distKras <= MAX_ATTENDANCE_DISTANCE_METERS;

  if (isAtTarget || isAtKras || distTarget === null) {
    return { valid: true };
  }

  return {
    valid: false,
    message: `Akses Ditolak: Lokasi Anda saat ini berada di luar radius 200m dari ${targetBoothName} (${Math.round(distTarget)} meter) maupun Pusat Produksi Kras (${Math.round(distKras)} meter).`,
  };
}

export const shiftsRouter = new Hono<AppEnv>();

// GET /daily-reports/today (Cek Laporan Shift Hari Ini)
shiftsRouter.get('/daily-reports/today', requireRole('BOOTH_ATTENDANT'), async (c) => {
  try {
    const user = c.get('user') as AuthContextUser;
    const dateQuery = c.req.query('date') || getWibDateString();

    const normalizeDate = (d: unknown): string => {
      if (!d) return '';
      if (typeof d === 'string') return d.includes('T') ? (d.split('T')[0] || '') : d;
      if (d instanceof Date) return getWibDateString(d);
      return String(d).split('T')[0] || '';
    };

    const userReports = await db
      .select({
        id: schema.dailyReports.id,
        boothId: schema.dailyReports.boothId,
        boothName: schema.booths.name,
        reportDate: schema.dailyReports.reportDate,
        shiftType: schema.dailyReports.shiftType,
        cashModal: schema.dailyReports.cashModal,
        cashFinal: schema.dailyReports.cashFinal,
        teaRemainingLiters: schema.dailyReports.teaRemainingLiters,
        status: schema.dailyReports.status,
        gpsTimeStart: schema.dailyReports.gpsTimeStart,
        gpsTimeEnd: schema.dailyReports.gpsTimeEnd,
        createdAt: schema.dailyReports.createdAt,
      })
      .from(schema.dailyReports)
      .leftJoin(schema.booths, eq(schema.dailyReports.boothId, schema.booths.id))
      .where(and(eq(schema.dailyReports.attendantId, user.id), eq(schema.dailyReports.reportDate, dateQuery)))
      .orderBy(desc(schema.dailyReports.createdAt))
      .limit(1);

    const todayReport = userReports[0] || null;

    if (!todayReport) {
      return c.json({ success: true, data: null });
    }

    const [stockItems, saleItems] = await Promise.all([
      db.query.reportStockItems.findMany({
        where: eq(schema.reportStockItems.dailyReportId, todayReport.id),
      }),
      db.query.reportSaleItems.findMany({
        where: eq(schema.reportSaleItems.dailyReportId, todayReport.id),
      }),
    ]);

    return c.json({
      success: true,
      data: {
        ...todayReport,
        reportDate: normalizeDate(todayReport.reportDate),
        teaRemainingLiters: parseFloat(todayReport.teaRemainingLiters || '0') || 0,
        stockItems: stockItems.map((s) => ({
          cupTypeId: s.cupTypeId,
          qtyInitial: s.qtyInitial,
          qtyAdded: s.qtyAdded || 0,
          qtySold: s.qtySold,
          priceSnapshot: s.priceSnapshot,
        })),
        saleItems: saleItems.map((si) => ({
          productId: si.productId,
          cupTypeId: si.cupTypeId,
          qtySold: si.qtySold,
          priceSnapshot: si.priceSnapshot,
        })),
      },
    });
  } catch (err) {
    console.error('[Get Today Report Error]:', err);
    return c.json({ success: false, error: { code: 'SERVER_ERROR', message: 'Gagal memuat status shift hari ini' } }, 500);
  }
});

// POST /daily-reports/start
shiftsRouter.post('/daily-reports/start', requireRole('BOOTH_ATTENDANT'), async (c) => {
  try {
    const user = c.get('user') as AuthContextUser;
    const rawBody = await c.req.json();
    const parseResult = dailyReportStartSchema.safeParse(rawBody);

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

    const { cashModal, stockItems, gpsLatitude, gpsLongitude, gpsAccuracy } = parseResult.data;
    const today = getWibDateString();

    const normalizeDate = (d: unknown): string => {
      if (!d) return '';
      if (typeof d === 'string') return d.includes('T') ? (d.split('T')[0] || '') : d;
      if (d instanceof Date) return getWibDateString(d);
      return String(d).split('T')[0] || '';
    };

    // KUNCI: Cek jika attendant sudah pernah mulai shift hari ini
    const existingStart = await db.query.dailyReports.findFirst({
      where: and(
        eq(schema.dailyReports.attendantId, user.id),
        eq(schema.dailyReports.reportDate, today)
      ),
    });

    if (existingStart && (existingStart.status === 'OPEN' || existingStart.status === 'CLOSED')) {
      return c.json(
        {
          success: false,
          error: {
            code: 'SHIFT_ALREADY_LOCKED',
            message: 'Akses Ditolak: Anda sudah memulai shift untuk hari ini dan data telah dikunci. Anda tidak dapat mengedit data mulai shift kembali.',
          },
        },
        400
      );
    }

    const userAssignments = await db.query.boothAssignments.findMany({
      where: eq(schema.boothAssignments.userId, user.id),
    });

    const assignment = userAssignments.find((a) => normalizeDate(a.assignmentDate) === today) || userAssignments[0];
    const targetBoothId: string | null = assignment?.boothId || null;

    if (!targetBoothId) {
      return c.json(
        {
          success: false,
          error: { code: 'NO_BOOTH_ASSIGNMENT', message: 'Akses Ditolak: Anda tidak memiliki jadwal penugasan shift pada hari ini' },
        },
        403
      );
    }

    // Validasi radius GPS maksimal 200 meter (Dual-Radius: Booth Tujuan ATAU Pusat Kras)
    const locationCheck = await validateAttendanceLocation(targetBoothId, gpsLatitude, gpsLongitude);
    if (!locationCheck.valid) {
      return c.json(
        {
          success: false,
          error: {
            code: 'GPS_OUT_OF_RANGE',
            message: locationCheck.message,
          },
        },
        400
      );
    }

    const [report] = await db
      .insert(schema.dailyReports)
      .values({
        boothId: targetBoothId,
        attendantId: user.id,
        reportDate: today,
        shiftType: assignment?.shiftType || 'PAGI',
        cashModal,
        gpsLatStart: gpsLatitude !== undefined && gpsLatitude !== null ? String(gpsLatitude) : null,
        gpsLngStart: gpsLongitude !== undefined && gpsLongitude !== null ? String(gpsLongitude) : null,
        gpsAccuracyStart: gpsAccuracy !== undefined && gpsAccuracy !== null ? String(gpsAccuracy) : null,
        gpsTimeStart: new Date(),
        status: 'OPEN',
      })
      .onConflictDoUpdate({
        target: [schema.dailyReports.boothId, schema.dailyReports.reportDate],
        set: {
          cashModal,
          status: 'OPEN',
          updatedAt: new Date(),
        },
      })
      .returning();

    // Simpan Cup Stock Items jika disediakan (Batch Insert)
    if (report && stockItems && Array.isArray(stockItems) && stockItems.length > 0) {
      const allCupTypes = await db.query.cupTypes.findMany();
      const cupPriceMap = new Map(allCupTypes.map((c) => [c.id, c.price]));

      await db.delete(schema.reportStockItems).where(eq(schema.reportStockItems.dailyReportId, report.id));

      const stockRows = stockItems
        .filter((item) => item.cupTypeId)
        .map((item) => ({
          dailyReportId: report.id,
          cupTypeId: item.cupTypeId,
          qtyInitial: item.qtyInitial || 0,
          qtyAdded: 0,
          qtySold: 0,
          priceSnapshot: cupPriceMap.get(item.cupTypeId) || 0,
        }));

      if (stockRows.length > 0) {
        await db.insert(schema.reportStockItems).values(stockRows);
      }
    }

    return c.json({ success: true, data: report });
  } catch (err: unknown) {
    const errorDetail = err instanceof Error ? err.message : String(err);
    console.error('[Start Shift Error]:', err);
    return c.json({ success: false, error: { code: 'SERVER_ERROR', message: `Gagal memulai laporan shift: ${errorDetail}` } }, 500);
  }
});

// POST /daily-reports/restock-cups (Tambah Stok Cup di Tengah Penjualan)
shiftsRouter.post('/daily-reports/restock-cups', requireRole('BOOTH_ATTENDANT'), async (c) => {
  try {
    const user = c.get('user') as AuthContextUser;
    const rawBody = await c.req.json();
    const parseResult = restockCupsSchema.safeParse(rawBody);

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

    const { cupTypeId, qtyAdded } = parseResult.data;
    const today = getWibDateString();

    const report = await db.query.dailyReports.findFirst({
      where: and(
        eq(schema.dailyReports.attendantId, user.id),
        eq(schema.dailyReports.reportDate, today)
      ),
    });

    if (!report) {
      return c.json(
        {
          success: false,
          error: {
            code: 'NO_ACTIVE_SHIFT',
            message: 'Akses Ditolak: Anda belum memulai shift hari ini. Silakan mulai shift terlebih dahulu sebelum menambah cup.',
          },
        },
        400
      );
    }

    if (report.status === 'CLOSED') {
      return c.json(
        {
          success: false,
          error: {
            code: 'SHIFT_ALREADY_CLOSED',
            message: 'Akses Ditolak: Shift hari ini telah ditutup (closing). Penambahan cup tidak dapat dilakukan.',
          },
        },
        400
      );
    }

    // Periksa apakah item stok cup sudah ada di reportStockItems
    const existingStock = await db.query.reportStockItems.findFirst({
      where: and(
        eq(schema.reportStockItems.dailyReportId, report.id),
        eq(schema.reportStockItems.cupTypeId, cupTypeId)
      ),
    });

    if (existingStock) {
      const updatedQtyAdded = (existingStock.qtyAdded || 0) + qtyAdded;
      await db
        .update(schema.reportStockItems)
        .set({ qtyAdded: updatedQtyAdded })
        .where(eq(schema.reportStockItems.id, existingStock.id));
    } else {
      const cup = await db.query.cupTypes.findFirst({
        where: eq(schema.cupTypes.id, cupTypeId),
      });

      await db.insert(schema.reportStockItems).values({
        dailyReportId: report.id,
        cupTypeId,
        qtyInitial: 0,
        qtyAdded,
        qtySold: 0,
        priceSnapshot: cup?.price || 0,
      });
    }

    return c.json({
      success: true,
      message: `Berhasil menambahkan ${qtyAdded} pcs stok cup ke shift aktif.`,
    });
  } catch (err) {
    console.error('[Restock Cups Error]:', err);
    return c.json({ success: false, error: { code: 'SERVER_ERROR', message: 'Gagal menambahkan stok cup' } }, 500);
  }
});

// POST /daily-reports/end
shiftsRouter.post('/daily-reports/end', requireRole('BOOTH_ATTENDANT'), async (c) => {
  try {
    const user = c.get('user') as AuthContextUser;
    const rawBody = await c.req.json();
    const parseResult = dailyReportEndSchema.safeParse(rawBody);

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

    const { cashFinal, stockItems, saleItems, teaRemainingLiters, notes, gpsLatitude, gpsLongitude, gpsAccuracy } = parseResult.data;
    const today = getWibDateString();

    const normalizeDate = (d: unknown): string => {
      if (!d) return '';
      if (typeof d === 'string') return d.includes('T') ? (d.split('T')[0] || '') : d;
      if (d instanceof Date) return getWibDateString(d);
      return String(d).split('T')[0] || '';
    };

    const existingReport = await db.query.dailyReports.findFirst({
      where: and(
        eq(schema.dailyReports.attendantId, user.id),
        eq(schema.dailyReports.reportDate, today)
      ),
    });

    if (existingReport && existingReport.status === 'CLOSED') {
      return c.json(
        {
          success: false,
          error: {
            code: 'SHIFT_ALREADY_CLOSED',
            message: 'Akses Ditolak: Anda sudah menyelesaikan Tutup Shift (closing) hari ini dan laporan telah dikunci secara permanen.',
          },
        },
        400
      );
    }

    const userAssignments = await db.query.boothAssignments.findMany({
      where: eq(schema.boothAssignments.userId, user.id),
    });
    const assignment = userAssignments.find((a) => normalizeDate(a.assignmentDate) === today) || userAssignments[0];
    const targetBoothId = existingReport?.boothId || assignment?.boothId;

    // Validasi radius GPS maksimal 200 meter (Dual-Radius: Booth Tujuan ATAU Pusat Kras)
    if (targetBoothId) {
      const locationCheck = await validateAttendanceLocation(targetBoothId, gpsLatitude, gpsLongitude);
      if (!locationCheck.valid) {
        return c.json(
          {
            success: false,
            error: {
              code: 'GPS_OUT_OF_RANGE',
              message: locationCheck.message,
            },
          },
          400
        );
      }
    }

    let finalReport;

    const remainingTeaVal = teaRemainingLiters !== undefined ? String(teaRemainingLiters) : '0';

    if (existingReport) {
      const [updated] = await db
        .update(schema.dailyReports)
        .set({
          cashFinal,
          teaRemainingLiters: remainingTeaVal,
          notes: notes || null,
          gpsLatEnd: gpsLatitude !== undefined && gpsLatitude !== null ? String(gpsLatitude) : null,
          gpsLngEnd: gpsLongitude !== undefined && gpsLongitude !== null ? String(gpsLongitude) : null,
          gpsAccuracyEnd: gpsAccuracy !== undefined && gpsAccuracy !== null ? String(gpsAccuracy) : null,
          gpsTimeEnd: new Date(),
          status: 'CLOSED',
          updatedAt: new Date(),
        })
        .where(eq(schema.dailyReports.id, existingReport.id))
        .returning();
      finalReport = updated;
    } else {
      if (!targetBoothId) {
        return c.json(
          {
            success: false,
            error: { code: 'NO_BOOTH_ASSIGNMENT', message: 'Akses Ditolak: Anda tidak memiliki jadwal penugasan shift pada hari ini' },
          },
          403
        );
      }

      const [created] = await db
        .insert(schema.dailyReports)
        .values({
          boothId: targetBoothId,
          attendantId: user.id,
          reportDate: today,
          shiftType: assignment?.shiftType || 'PAGI',
          cashModal: 50000,
          cashFinal,
          teaRemainingLiters: remainingTeaVal,
          notes: notes || null,
          gpsLatEnd: gpsLatitude !== undefined && gpsLatitude !== null ? String(gpsLatitude) : null,
          gpsLngEnd: gpsLongitude !== undefined && gpsLongitude !== null ? String(gpsLongitude) : null,
          gpsAccuracyEnd: gpsAccuracy !== undefined && gpsAccuracy !== null ? String(gpsAccuracy) : null,
          gpsTimeEnd: new Date(),
          status: 'CLOSED',
        })
        .onConflictDoUpdate({
          target: [schema.dailyReports.boothId, schema.dailyReports.reportDate],
          set: {
            cashFinal,
            teaRemainingLiters: remainingTeaVal,
            notes: notes || null,
            status: 'CLOSED',
            updatedAt: new Date(),
          },
        })
        .returning();
      finalReport = created;
    }

    if (finalReport) {
      const allCupTypes = await db.query.cupTypes.findMany();
      const cupPriceMap = new Map(allCupTypes.map((c) => [c.id, c.price]));
      const defaultCupId = allCupTypes[0]?.id;

      // Simpan Sisa Cup & Cup Terpakai (Batch Insert)
      if (stockItems && Array.isArray(stockItems) && stockItems.length > 0) {
        await db.delete(schema.reportStockItems).where(eq(schema.reportStockItems.dailyReportId, finalReport.id));
        const stockRows = stockItems
          .filter((item) => item.cupTypeId)
          .map((item) => {
            const priceSnapshot = cupPriceMap.get(item.cupTypeId) || 0;
            const initial = item.qtyInitial ?? 0;
            const added = item.qtyAdded ?? 0;
            const final = item.qtyFinal ?? 0;
            const totalAvailable = initial + added;
            const sold = item.qtySold !== undefined ? item.qtySold : Math.max(0, totalAvailable - final);
            return {
              dailyReportId: finalReport.id,
              cupTypeId: item.cupTypeId,
              qtyInitial: initial,
              qtyAdded: added,
              qtySold: sold,
              priceSnapshot,
            };
          });

        if (stockRows.length > 0) {
          await db.insert(schema.reportStockItems).values(stockRows);
        }
      }

      // Simpan Item Penjualan Produk (Batch Insert)
      if (saleItems && Array.isArray(saleItems) && saleItems.length > 0) {
        await db.delete(schema.reportSaleItems).where(eq(schema.reportSaleItems.dailyReportId, finalReport.id));
        const saleRows = saleItems
          .filter((s) => s.productId && s.qtySold > 0)
          .map((s) => {
            const cupId = s.cupTypeId || defaultCupId;
            const priceSnapshot = cupId ? (cupPriceMap.get(cupId) || 0) : 0;
            return {
              dailyReportId: finalReport.id,
              productId: s.productId,
              cupTypeId: cupId!,
              qtySold: s.qtySold,
              priceSnapshot,
            };
          })
          .filter((s) => Boolean(s.cupTypeId));

        if (saleRows.length > 0) {
          await db.insert(schema.reportSaleItems).values(saleRows);
        }
      }
    }

    return c.json({ success: true, data: finalReport });
  } catch (err) {
    console.error('[End Shift Error]:', err);
    return c.json({ success: false, error: { code: 'SERVER_ERROR', message: 'Gagal menutup laporan shift' } }, 500);
  }
});

// GET /daily-reports/my (Attendant Shift History)
shiftsRouter.get('/daily-reports/my', requireRole('BOOTH_ATTENDANT'), async (c) => {
  try {
    const user = c.get('user') as AuthContextUser;
    const reports = await db
      .select({
        id: schema.dailyReports.id,
        date: schema.dailyReports.reportDate,
        boothName: schema.booths.name,
        cashModal: schema.dailyReports.cashModal,
        cashFinal: schema.dailyReports.cashFinal,
        status: schema.dailyReports.status,
        createdAt: schema.dailyReports.createdAt,
      })
      .from(schema.dailyReports)
      .leftJoin(schema.booths, eq(schema.dailyReports.boothId, schema.booths.id))
      .where(eq(schema.dailyReports.attendantId, user.id))
      .orderBy(desc(schema.dailyReports.createdAt));

    const formatted = reports.map((r) => {
      const modal = r.cashModal || 0;
      const finalCash = r.cashFinal !== null ? r.cashFinal : null;
      const revenue = finalCash !== null ? Math.max(0, finalCash - modal) : 0;
      return {
        id: r.id,
        date: r.date,
        boothName: r.boothName || 'Booth',
        modal,
        cashFinal: finalCash !== null ? finalCash : 0,
        revenue,
        cupsSold: 0,
        variance: 0,
        status: r.status || 'OPEN',
      };
    });

    return c.json({ success: true, data: formatted });
  } catch (err) {
    console.error('[Get My Reports Error]:', err);
    return c.json({ success: false, error: { code: 'SERVER_ERROR', message: 'Gagal memuat riwayat shift' } }, 500);
  }
});
