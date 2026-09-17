import { Hono } from 'hono';
import { z } from 'zod';
import { eq, and, desc } from 'drizzle-orm';
import { db } from '../db/index.js';
import * as schema from '../db/schema/index.js';
import { AppEnv, AuthContextUser, requireRole } from '../middleware/auth.middleware.js';

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
  saleItems: z
    .array(
      z.object({
        productId: z.string().optional(),
        cupTypeId: z.string().optional(),
        qtySold: z.coerce.number().int().min(0),
      })
    )
    .optional(),
  notes: z.string().trim().optional().nullable(),
  gpsLatitude: z.coerce.number().nullable().optional(),
  gpsLongitude: z.coerce.number().nullable().optional(),
  gpsAccuracy: z.coerce.number().nullable().optional(),
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

export const shiftsRouter = new Hono<AppEnv>();

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

    const { cashModal, gpsLatitude, gpsLongitude, gpsAccuracy } = parseResult.data;
    const today: string = new Date().toISOString().split('T')[0]!;

    const assignment = await db.query.boothAssignments.findFirst({
      where: and(
        eq(schema.boothAssignments.userId, user.id),
        eq(schema.boothAssignments.assignmentDate, today)
      ),
    });

    let targetBoothId: string | null = assignment?.boothId || null;

    if (!targetBoothId) {
      return c.json(
        {
          success: false,
          error: { code: 'NO_BOOTH_ASSIGNMENT', message: 'Akses Ditolak: Anda tidak memiliki jadwal penugasan shift pada hari ini' },
        },
        403
      );
    }

    // Validasi radius GPS maksimal 200 meter
    const booth = await db.query.booths.findFirst({
      where: eq(schema.booths.id, targetBoothId),
    });

    if (booth && booth.latitude && booth.longitude && gpsLatitude != null && gpsLongitude != null) {
      const bLat = parseFloat(booth.latitude);
      const bLng = parseFloat(booth.longitude);
      if (!isNaN(bLat) && !isNaN(bLng)) {
        const dist = calculateDistanceMeters(bLat, bLng, gpsLatitude, gpsLongitude);
        if (dist > MAX_ATTENDANCE_DISTANCE_METERS) {
          return c.json(
            {
              success: false,
              error: {
                code: 'GPS_OUT_OF_RANGE',
                message: `Akses Ditolak: Lokasi Anda (${Math.round(dist)} meter) berada di luar batas radius maksimal 200 meter dari booth (${booth.name || 'Booth'}).`,
              },
            },
            400
          );
        }
      }
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
          updatedAt: new Date(),
        },
      })
      .returning();

    return c.json({ success: true, data: report });
  } catch (err) {
    console.error('[Start Shift Error]:', err);
    return c.json({ success: false, error: { code: 'SERVER_ERROR', message: 'Gagal memulai laporan shift' } }, 500);
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

    const { cashFinal, notes, gpsLatitude, gpsLongitude, gpsAccuracy } = parseResult.data;
    const today: string = new Date().toISOString().split('T')[0]!;

    const existingReport = await db.query.dailyReports.findFirst({
      where: and(
        eq(schema.dailyReports.attendantId, user.id),
        eq(schema.dailyReports.reportDate, today)
      ),
    });

    const targetBoothId = existingReport?.boothId || (
      await db.query.boothAssignments.findFirst({
        where: and(
          eq(schema.boothAssignments.userId, user.id),
          eq(schema.boothAssignments.assignmentDate, today)
        ),
      })
    )?.boothId;

    if (targetBoothId) {
      const booth = await db.query.booths.findFirst({
        where: eq(schema.booths.id, targetBoothId),
      });

      if (booth && booth.latitude && booth.longitude && gpsLatitude != null && gpsLongitude != null) {
        const bLat = parseFloat(booth.latitude);
        const bLng = parseFloat(booth.longitude);
        if (!isNaN(bLat) && !isNaN(bLng)) {
          const dist = calculateDistanceMeters(bLat, bLng, gpsLatitude, gpsLongitude);
          if (dist > MAX_ATTENDANCE_DISTANCE_METERS) {
            return c.json(
              {
                success: false,
                error: {
                  code: 'GPS_OUT_OF_RANGE',
                  message: `Akses Ditolak: Lokasi Anda (${Math.round(dist)} meter) berada di luar batas radius maksimal 200 meter dari booth (${booth.name || 'Booth'}).`,
                },
              },
              400
            );
          }
        }
      }
    }

    if (existingReport) {
      const [updated] = await db
        .update(schema.dailyReports)
        .set({
          cashFinal,
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

      return c.json({ success: true, data: updated });
    }

    const assignment = await db.query.boothAssignments.findFirst({
      where: and(
        eq(schema.boothAssignments.userId, user.id),
        eq(schema.boothAssignments.assignmentDate, today)
      ),
    });

    const boothId = assignment?.boothId;
    if (!boothId) {
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
        boothId,
        attendantId: user.id,
        reportDate: today,
        cashModal: 50000,
        cashFinal,
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
          notes: notes || null,
          status: 'CLOSED',
          updatedAt: new Date(),
        },
      })
      .returning();

    return c.json({ success: true, data: created });
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
