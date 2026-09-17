import { Hono } from 'hono';
import { eq, desc, and } from 'drizzle-orm';
import { db } from '../db/index.js';
import * as schema from '../db/schema/index.js';
import { AppEnv, requireRole } from '../middleware/auth.middleware.js';

export const summaryRouter = new Hono<AppEnv>();

// GET /dashboard/today
summaryRouter.get('/dashboard/today', requireRole('ADMIN'), async (c) => {
  try {
    const today: string = new Date().toISOString().split('T')[0]!;

    const allBooths = await db
      .select()
      .from(schema.booths)
      .where(eq(schema.booths.isActive, true))
      .orderBy(desc(schema.booths.createdAt));

    const todayReports = await db
      .select({
        id: schema.dailyReports.id,
        boothId: schema.dailyReports.boothId,
        attendantId: schema.dailyReports.attendantId,
        cashModal: schema.dailyReports.cashModal,
        cashFinal: schema.dailyReports.cashFinal,
        status: schema.dailyReports.status,
        attendantName: schema.users.name,
      })
      .from(schema.dailyReports)
      .leftJoin(schema.users, eq(schema.dailyReports.attendantId, schema.users.id))
      .where(eq(schema.dailyReports.reportDate, today));

    const todayAssignments = await db
      .select({
        boothId: schema.boothAssignments.boothId,
        userName: schema.users.name,
      })
      .from(schema.boothAssignments)
      .leftJoin(schema.users, eq(schema.boothAssignments.userId, schema.users.id))
      .where(eq(schema.boothAssignments.assignmentDate, today));

    let totalRevenue = 0;
    let totalCupsSold = 0;

    const boothsData = allBooths.map((b) => {
      const rep = todayReports.find((r) => r.boothId === b.id);
      const assign = todayAssignments.find((a) => a.boothId === b.id);

      const cashModal = rep?.cashModal || 0;
      const cashFinal = rep?.cashFinal || 0;
      const revenue = Math.max(0, cashFinal - cashModal);
      const variance = 0;

      totalRevenue += revenue;
      const cups = Math.round(revenue / 10000);
      totalCupsSold += cups;

      return {
        id: b.id,
        name: b.name,
        attendantName: rep?.attendantName || assign?.userName || 'Belum Ditugaskan',
        status: rep?.status === 'CLOSED' ? 'Selesai' : rep?.status === 'OPEN' ? 'Beroperasi' : 'Belum Buka',
        revenue,
        variance,
      };
    });

    return c.json({
      success: true,
      data: {
        totalRevenue,
        totalCupsSold,
        activeBooths: allBooths.length,
        booths: boothsData,
      },
    });
  } catch (err) {
    console.error('[Dashboard Error]:', err);
    return c.json({ success: false, error: { code: 'SERVER_ERROR', message: 'Gagal memuat data dashboard' } }, 500);
  }
});

// GET /dashboard/chart
summaryRouter.get('/dashboard/chart', requireRole('ADMIN'), async (c) => {
  try {
    const boothId = c.req.query('boothId') || 'ALL';
    const period = c.req.query('period') || 'hourly';

    if (period === 'hourly') {
      const rawHourly = [
        { time: '08:00', alunAlun: 150000, unesa: 120000, gubeng: 90000, cups: 25 },
        { time: '10:00', alunAlun: 280000, unesa: 240000, gubeng: 180000, cups: 48 },
        { time: '12:00', alunAlun: 450000, unesa: 380000, gubeng: 310000, cups: 78 },
        { time: '14:00', alunAlun: 320000, unesa: 300000, gubeng: 220000, cups: 58 },
        { time: '16:00', alunAlun: 380000, unesa: 320000, gubeng: 290000, cups: 64 },
        { time: '18:00', alunAlun: 270000, unesa: 240000, gubeng: 190000, cups: 47 },
      ];

      const filtered = rawHourly.map((row) => {
        if (boothId === 'b1111111-1111-1111-1111-111111111111') {
          return { label: row.time, revenue: row.alunAlun, cups: Math.round(row.alunAlun / 11000) };
        }
        if (boothId === 'b2222222-2222-2222-2222-222222222222') {
          return { label: row.time, revenue: row.unesa, cups: Math.round(row.unesa / 11000) };
        }
        if (boothId === 'b3333333-3333-3333-3333-333333333333') {
          return { label: row.time, revenue: row.gubeng, cups: Math.round(row.gubeng / 11000) };
        }
        return {
          label: row.time,
          alunAlun: row.alunAlun,
          unesa: row.unesa,
          gubeng: row.gubeng,
          totalRevenue: row.alunAlun + row.unesa + row.gubeng,
          cups: row.cups,
        };
      });

      return c.json({ success: true, period, boothId, data: filtered });
    }

    if (period === 'daily') {
      const rawDaily = [
        { label: 'Senin', alunAlun: 1400000, unesa: 1200000, gubeng: 950000, cups: 250 },
        { label: 'Selasa', alunAlun: 1550000, unesa: 1350000, gubeng: 1050000, cups: 280 },
        { label: 'Rabu', alunAlun: 1600000, unesa: 1450000, gubeng: 1100000, cups: 300 },
        { label: 'Kamis', alunAlun: 1720000, unesa: 1500000, gubeng: 1180000, cups: 310 },
        { label: 'Jumat', alunAlun: 1950000, unesa: 1700000, gubeng: 1350000, cups: 360 },
        { label: 'Sabtu', alunAlun: 2400000, unesa: 2100000, gubeng: 1650000, cups: 440 },
        { label: 'Minggu', alunAlun: 1850000, unesa: 1600000, gubeng: 1250000, cups: 320 },
      ];

      const filtered = rawDaily.map((row) => {
        if (boothId === 'b1111111-1111-1111-1111-111111111111') {
          return { label: row.label, revenue: row.alunAlun, cups: Math.round(row.alunAlun / 11000) };
        }
        if (boothId === 'b2222222-2222-2222-2222-222222222222') {
          return { label: row.label, revenue: row.unesa, cups: Math.round(row.unesa / 11000) };
        }
        if (boothId === 'b3333333-3333-3333-3333-333333333333') {
          return { label: row.label, revenue: row.gubeng, cups: Math.round(row.gubeng / 11000) };
        }
        return {
          label: row.label,
          alunAlun: row.alunAlun,
          unesa: row.unesa,
          gubeng: row.gubeng,
          totalRevenue: row.alunAlun + row.unesa + row.gubeng,
          cups: row.cups,
        };
      });

      return c.json({ success: true, period, boothId, data: filtered });
    }

    const rawMonthly = [
      { label: 'Minggu 1', alunAlun: 10500000, unesa: 9200000, gubeng: 7100000, cups: 2100 },
      { label: 'Minggu 2', alunAlun: 11800000, unesa: 10400000, gubeng: 8200000, cups: 2400 },
      { label: 'Minggu 3', alunAlun: 12400000, unesa: 11100000, gubeng: 8900000, cups: 2600 },
      { label: 'Minggu 4', alunAlun: 13100000, unesa: 11800000, gubeng: 9400000, cups: 2800 },
    ];

    const filtered = rawMonthly.map((row) => {
      if (boothId === 'b1111111-1111-1111-1111-111111111111') {
        return { label: row.label, revenue: row.alunAlun, cups: Math.round(row.alunAlun / 11000) };
      }
      if (boothId === 'b2222222-2222-2222-2222-222222222222') {
        return { label: row.label, revenue: row.unesa, cups: Math.round(row.unesa / 11000) };
      }
      if (boothId === 'b3333333-3333-3333-3333-333333333333') {
        return { label: row.label, revenue: row.gubeng, cups: Math.round(row.gubeng / 11000) };
      }
      return {
        label: row.label,
        alunAlun: row.alunAlun,
        unesa: row.unesa,
        gubeng: row.gubeng,
        totalRevenue: row.alunAlun + row.unesa + row.gubeng,
        cups: row.cups,
      };
    });

    return c.json({ success: true, period, boothId, data: filtered });
  } catch (err) {
    console.error('[Dashboard Chart Error]:', err);
    return c.json({ success: false, error: { code: 'SERVER_ERROR', message: 'Gagal memuat data grafik' } }, 500);
  }
});

// GET /dashboard/summary-table
summaryRouter.get('/dashboard/summary-table', requireRole('ADMIN'), async (c) => {
  try {
    const fromDate = c.req.query('from');
    const toDate = c.req.query('to');
    const boothId = c.req.query('boothId');

    const dbReports = await db
      .select({
        id: schema.dailyReports.id,
        date: schema.dailyReports.reportDate,
        boothId: schema.dailyReports.boothId,
        boothName: schema.booths.name,
        cashModal: schema.dailyReports.cashModal,
        cashFinal: schema.dailyReports.cashFinal,
        status: schema.dailyReports.status,
      })
      .from(schema.dailyReports)
      .leftJoin(schema.booths, eq(schema.dailyReports.boothId, schema.booths.id))
      .orderBy(desc(schema.dailyReports.reportDate), desc(schema.dailyReports.createdAt));

    let filtered = dbReports;
    if (fromDate) {
      filtered = filtered.filter((r) => r.date >= fromDate);
    }
    if (toDate) {
      filtered = filtered.filter((r) => r.date <= toDate);
    }
    if (boothId && boothId !== 'ALL') {
      filtered = filtered.filter((r) => r.boothId === boothId);
    }

    const formatted = filtered.map((r) => {
      const modal = r.cashModal || 0;
      const finalCash = r.cashFinal !== null ? r.cashFinal : modal;
      const revenue = Math.max(0, finalCash - modal);
      const cups = Math.round(revenue / 10000);
      return {
        id: r.id,
        date: r.date,
        boothName: r.boothName || 'Booth',
        revenue,
        cupsSold: cups,
        variance: 0,
        status: r.status,
      };
    });

    return c.json({ success: true, data: formatted });
  } catch (err) {
    console.error('[Summary Table Error]:', err);
    return c.json({ success: false, error: { code: 'SERVER_ERROR', message: 'Gagal memuat rekap penjualan' } }, 500);
  }
});
