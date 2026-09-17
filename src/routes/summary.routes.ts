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

    const allBooths = await db.select().from(schema.booths).where(eq(schema.booths.isActive, true));
    const allReports = await db.select().from(schema.dailyReports);

    if (period === 'hourly') {
      const timeSlots = ['08:00', '10:00', '12:00', '14:00', '16:00', '18:00', '20:00'];
      const today: string = new Date().toISOString().split('T')[0]!;
      const todayReports = allReports.filter((r) => r.reportDate === today);

      const data = timeSlots.map((slot) => {
        let totalRevenue = 0;
        let totalCups = 0;

        todayReports.forEach((r) => {
          if (boothId !== 'ALL' && r.boothId !== boothId) return;
          const rev = Math.max(0, (r.cashFinal || 0) - (r.cashModal || 0));
          totalRevenue += rev;
          totalCups += Math.round(rev / 10000);
        });

        // If specific booth
        if (boothId !== 'ALL') {
          const boothRep = todayReports.find((r) => r.boothId === boothId);
          const rev = boothRep ? Math.max(0, (boothRep.cashFinal || 0) - (boothRep.cashModal || 0)) : 0;
          return {
            label: slot,
            revenue: rev > 0 ? Math.round(rev / timeSlots.length) : 0,
            cups: rev > 0 ? Math.round(rev / (10000 * timeSlots.length)) : 0,
          };
        }

        return {
          label: slot,
          totalRevenue: totalRevenue > 0 ? Math.round(totalRevenue / timeSlots.length) : 0,
          cups: totalCups > 0 ? Math.round(totalCups / timeSlots.length) : 0,
        };
      });

      return c.json({ success: true, period, boothId, data });
    }

    if (period === 'daily') {
      const days = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
      const now = new Date();
      const last7Days: { label: string; dateStr: string }[] = [];

      for (let i = 6; i >= 0; i--) {
        const d = new Date(now);
        d.setDate(d.getDate() - i);
        const dateStr = d.toISOString().split('T')[0]!;
        const dayLabel = days[d.getDay()] || 'Hari';
        last7Days.push({ label: dayLabel, dateStr });
      }

      const data = last7Days.map(({ label, dateStr }) => {
        const dayReports = allReports.filter((r) => r.reportDate === dateStr);
        let revenue = 0;
        let cups = 0;

        dayReports.forEach((r) => {
          if (boothId !== 'ALL' && r.boothId !== boothId) return;
          const rev = Math.max(0, (r.cashFinal || 0) - (r.cashModal || 0));
          revenue += rev;
          cups += Math.round(rev / 10000);
        });

        if (boothId !== 'ALL') {
          return { label, revenue, cups };
        }

        return {
          label,
          totalRevenue: revenue,
          cups,
        };
      });

      return c.json({ success: true, period, boothId, data });
    }

    // monthly
    const weeks = ['Minggu 1', 'Minggu 2', 'Minggu 3', 'Minggu 4'];
    const data = weeks.map((label) => {
      let revenue = 0;
      let cups = 0;

      allReports.forEach((r) => {
        if (boothId !== 'ALL' && r.boothId !== boothId) return;
        const rev = Math.max(0, (r.cashFinal || 0) - (r.cashModal || 0));
        revenue += rev;
        cups += Math.round(rev / 10000);
      });

      if (boothId !== 'ALL') {
        return {
          label,
          revenue: revenue > 0 ? Math.round(revenue / 4) : 0,
          cups: cups > 0 ? Math.round(cups / 4) : 0,
        };
      }

      return {
        label,
        totalRevenue: revenue > 0 ? Math.round(revenue / 4) : 0,
        cups: cups > 0 ? Math.round(cups / 4) : 0,
      };
    });

    return c.json({ success: true, period, boothId, data });
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
