import { Hono } from 'hono';
import { eq, desc, and, gte, lte, inArray } from 'drizzle-orm';
import { db } from '../db/index.js';
import * as schema from '../db/schema/index.js';
import { AppEnv, requireRole } from '../middleware/auth.middleware.js';
import { getWibDateString, getWibCurrentHour } from '../utils/date.js';

export const summaryRouter = new Hono<AppEnv>();

// GET /dashboard/today (HANYA DARI BOOTH YANG AKTIF)
summaryRouter.get('/dashboard/today', requireRole('ADMIN'), async (c) => {
  try {
    const today = getWibDateString();

    // 1. Ambil hanya booth yang AKTIF
    const activeBooths = await db
      .select()
      .from(schema.booths)
      .where(eq(schema.booths.isActive, true))
      .orderBy(desc(schema.booths.createdAt));

    // 2. Ambil laporan shift hari ini yang terhubung ke booth aktif
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
      .innerJoin(schema.booths, and(eq(schema.dailyReports.boothId, schema.booths.id), eq(schema.booths.isActive, true)))
      .leftJoin(schema.users, eq(schema.dailyReports.attendantId, schema.users.id))
      .where(eq(schema.dailyReports.reportDate, today));

    // 3. Ambil jadwal penugasan hari ini yang terhubung ke booth aktif
    const todayAssignments = await db
      .select({
        boothId: schema.boothAssignments.boothId,
        userName: schema.users.name,
        shiftType: schema.boothAssignments.shiftType,
      })
      .from(schema.boothAssignments)
      .innerJoin(schema.booths, and(eq(schema.boothAssignments.boothId, schema.booths.id), eq(schema.booths.isActive, true)))
      .leftJoin(schema.users, eq(schema.boothAssignments.userId, schema.users.id))
      .where(eq(schema.boothAssignments.assignmentDate, today));

    const currentHour = getWibCurrentHour();

    let totalRevenue = 0;
    let totalCupsSold = 0;

    const boothsData = activeBooths.map((b) => {
      const rep = todayReports.find((r) => r.boothId === b.id);
      const assign = todayAssignments.find((a) => a.boothId === b.id);

      const cashModal = rep?.cashModal || 0;
      const cashFinal = rep?.cashFinal || 0;
      const revenue = Math.max(0, cashFinal - cashModal);
      const variance = 0;

      totalRevenue += revenue;
      const cups = Math.round(revenue / 10000);
      totalCupsSold += cups;

      const shiftType: 'PAGI' | 'SORE' = (assign?.shiftType as 'PAGI' | 'SORE') || (currentHour >= 15 ? 'SORE' : 'PAGI');
      const shift = shiftType === 'PAGI' ? 'Shift Pagi (09:00 - 15:00)' : 'Shift Sore (15:00 - 20:30)';

      return {
        id: b.id,
        name: b.name,
        attendantName: rep?.attendantName || assign?.userName || 'Belum Ditugaskan',
        shift,
        shiftType,
        status: rep?.status === 'CLOSED' ? 'Selesai' : rep?.status === 'OPEN' ? 'Beroperasi' : 'Belum Buka',
        revenue,
        cupsSold: cups,
        variance,
      };
    });

    return c.json({
      success: true,
      data: {
        totalRevenue,
        totalCupsSold,
        activeBooths: activeBooths.length,
        booths: boothsData,
      },
    });
  } catch (err) {
    console.error('[Dashboard Error]:', err);
    return c.json({ success: false, error: { code: 'SERVER_ERROR', message: 'Gagal memuat data dashboard' } }, 500);
  }
});

// GET /dashboard/chart (HANYA DARI BOOTH YANG AKTIF)
summaryRouter.get('/dashboard/chart', requireRole('ADMIN'), async (c) => {
  try {
    const boothId = c.req.query('boothId') || 'ALL';
    const period = c.req.query('period') || 'hourly';
    const today = getWibDateString();

    if (period === 'hourly') {
      const timeSlots = ['08:00', '10:00', '12:00', '14:00', '16:00', '18:00', '20:00'];
      
      const todayConditions = [
        eq(schema.booths.isActive, true),
        eq(schema.dailyReports.reportDate, today),
      ];
      if (boothId !== 'ALL') {
        todayConditions.push(eq(schema.dailyReports.boothId, boothId));
      }

      const todayReports = await db
        .select({
          id: schema.dailyReports.id,
          boothId: schema.dailyReports.boothId,
          reportDate: schema.dailyReports.reportDate,
          cashModal: schema.dailyReports.cashModal,
          cashFinal: schema.dailyReports.cashFinal,
          status: schema.dailyReports.status,
        })
        .from(schema.dailyReports)
        .innerJoin(schema.booths, and(eq(schema.dailyReports.boothId, schema.booths.id), eq(schema.booths.isActive, true)))
        .where(and(...todayConditions));

      let totalRevenue = 0;
      let totalCups = 0;

      todayReports.forEach((r) => {
        const rev = Math.max(0, (r.cashFinal || 0) - (r.cashModal || 0));
        totalRevenue += rev;
        totalCups += Math.round(rev / 10000);
      });

      const data = timeSlots.map((slot) => {
        if (boothId !== 'ALL') {
          return {
            label: slot,
            revenue: totalRevenue > 0 ? Math.round(totalRevenue / timeSlots.length) : 0,
            cups: totalRevenue > 0 ? Math.round(totalRevenue / (10000 * timeSlots.length)) : 0,
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
        const dateStr = getWibDateString(d);
        const dayLabel = days[d.getDay()] || 'Hari';
        last7Days.push({ label: dayLabel, dateStr });
      }

      const minDate = last7Days[0]?.dateStr || today;
      const maxDate = last7Days[last7Days.length - 1]?.dateStr || today;

      const conditions = [
        eq(schema.booths.isActive, true),
        gte(schema.dailyReports.reportDate, minDate),
        lte(schema.dailyReports.reportDate, maxDate),
      ];
      if (boothId !== 'ALL') {
        conditions.push(eq(schema.dailyReports.boothId, boothId));
      }

      const reports = await db
        .select({
          id: schema.dailyReports.id,
          boothId: schema.dailyReports.boothId,
          reportDate: schema.dailyReports.reportDate,
          cashModal: schema.dailyReports.cashModal,
          cashFinal: schema.dailyReports.cashFinal,
        })
        .from(schema.dailyReports)
        .innerJoin(schema.booths, and(eq(schema.dailyReports.boothId, schema.booths.id), eq(schema.booths.isActive, true)))
        .where(and(...conditions));

      const data = last7Days.map(({ label, dateStr }) => {
        const dayReports = reports.filter((r) => r.reportDate === dateStr);
        let revenue = 0;
        let cups = 0;

        dayReports.forEach((r) => {
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

    // monthly (Last 30 days grouped into 4 weeks)
    const weeks = ['Minggu 1', 'Minggu 2', 'Minggu 3', 'Minggu 4'];
    const startOfMonth = today.slice(0, 7) + '-01';

    const conditions = [
      eq(schema.booths.isActive, true),
      gte(schema.dailyReports.reportDate, startOfMonth),
      lte(schema.dailyReports.reportDate, today),
    ];
    if (boothId !== 'ALL') {
      conditions.push(eq(schema.dailyReports.boothId, boothId));
    }

    const monthReports = await db
      .select({
        id: schema.dailyReports.id,
        boothId: schema.dailyReports.boothId,
        reportDate: schema.dailyReports.reportDate,
        cashModal: schema.dailyReports.cashModal,
        cashFinal: schema.dailyReports.cashFinal,
      })
      .from(schema.dailyReports)
      .innerJoin(schema.booths, and(eq(schema.dailyReports.boothId, schema.booths.id), eq(schema.booths.isActive, true)))
      .where(and(...conditions));

    let monthRevenue = 0;
    let monthCups = 0;

    monthReports.forEach((r) => {
      const rev = Math.max(0, (r.cashFinal || 0) - (r.cashModal || 0));
      monthRevenue += rev;
      monthCups += Math.round(rev / 10000);
    });

    const data = weeks.map((label) => {
      if (boothId !== 'ALL') {
        return {
          label,
          revenue: monthRevenue > 0 ? Math.round(monthRevenue / 4) : 0,
          cups: monthCups > 0 ? Math.round(monthCups / 4) : 0,
        };
      }

      return {
        label,
        totalRevenue: monthRevenue > 0 ? Math.round(monthRevenue / 4) : 0,
        cups: monthCups > 0 ? Math.round(monthCups / 4) : 0,
      };
    });

    return c.json({ success: true, period, boothId, data });
  } catch (err) {
    console.error('[Dashboard Chart Error]:', err);
    return c.json({ success: false, error: { code: 'SERVER_ERROR', message: 'Gagal memuat data grafik' } }, 500);
  }
});

// GET /dashboard/summary-table (HANYA DARI BOOTH YANG AKTIF DENGAN DETAIL RINCIAN CUP & MENU)
summaryRouter.get('/dashboard/summary-table', requireRole('ADMIN'), async (c) => {
  try {
    const fromDate = c.req.query('from');
    const toDate = c.req.query('to');
    const boothId = c.req.query('boothId');

    const conditions = [eq(schema.booths.isActive, true)];
    if (fromDate) conditions.push(gte(schema.dailyReports.reportDate, fromDate));
    if (toDate) conditions.push(lte(schema.dailyReports.reportDate, toDate));
    if (boothId && boothId !== 'ALL') conditions.push(eq(schema.dailyReports.boothId, boothId));

    const dbReports = await db
      .select({
        id: schema.dailyReports.id,
        date: schema.dailyReports.reportDate,
        shiftType: schema.dailyReports.shiftType,
        boothId: schema.dailyReports.boothId,
        boothName: schema.booths.name,
        boothAddress: schema.booths.address,
        attendantId: schema.dailyReports.attendantId,
        attendantName: schema.users.name,
        cashModal: schema.dailyReports.cashModal,
        cashFinal: schema.dailyReports.cashFinal,
        teaRemainingLiters: schema.dailyReports.teaRemainingLiters,
        notes: schema.dailyReports.notes,
        status: schema.dailyReports.status,
        createdAt: schema.dailyReports.createdAt,
      })
      .from(schema.dailyReports)
      .innerJoin(schema.booths, and(eq(schema.dailyReports.boothId, schema.booths.id), eq(schema.booths.isActive, true)))
      .leftJoin(schema.users, eq(schema.dailyReports.attendantId, schema.users.id))
      .where(and(...conditions))
      .orderBy(desc(schema.dailyReports.reportDate), desc(schema.dailyReports.createdAt));

    const reportIds = dbReports.map((r) => r.id);

    let saleItemsList: any[] = [];
    let stockItemsList: any[] = [];

    if (reportIds.length > 0) {
      saleItemsList = await db
        .select({
          id: schema.reportSaleItems.id,
          dailyReportId: schema.reportSaleItems.dailyReportId,
          productId: schema.reportSaleItems.productId,
          productName: schema.teaProducts.name,
          cupTypeId: schema.reportSaleItems.cupTypeId,
          cupTypeName: schema.cupTypes.name,
          qtySold: schema.reportSaleItems.qtySold,
          priceSnapshot: schema.reportSaleItems.priceSnapshot,
        })
        .from(schema.reportSaleItems)
        .leftJoin(schema.teaProducts, eq(schema.reportSaleItems.productId, schema.teaProducts.id))
        .leftJoin(schema.cupTypes, eq(schema.reportSaleItems.cupTypeId, schema.cupTypes.id))
        .where(inArray(schema.reportSaleItems.dailyReportId, reportIds));

      stockItemsList = await db
        .select({
          id: schema.reportStockItems.id,
          dailyReportId: schema.reportStockItems.dailyReportId,
          cupTypeId: schema.reportStockItems.cupTypeId,
          cupTypeName: schema.cupTypes.name,
          qtyInitial: schema.reportStockItems.qtyInitial,
          qtyAdded: schema.reportStockItems.qtyAdded,
          qtySold: schema.reportStockItems.qtySold,
          priceSnapshot: schema.reportStockItems.priceSnapshot,
        })
        .from(schema.reportStockItems)
        .leftJoin(schema.cupTypes, eq(schema.reportStockItems.cupTypeId, schema.cupTypes.id))
        .where(inArray(schema.reportStockItems.dailyReportId, reportIds));
    }

    const formatted = dbReports.map((r) => {
      const modal = r.cashModal || 0;
      const finalCash = r.cashFinal !== null ? r.cashFinal : null;
      
      const sales = saleItemsList.filter((s) => s.dailyReportId === r.id);
      const stocks = stockItemsList.filter((st) => st.dailyReportId === r.id);

      const calculatedRevenue = sales.reduce((acc, s) => acc + (s.qtySold * s.priceSnapshot), 0);
      const revenue = calculatedRevenue > 0 
        ? calculatedRevenue 
        : (finalCash !== null ? Math.max(0, finalCash - modal) : 0);

      // Hitung total cup terjual dari sale items atau stock items
      let cupsSold = sales.reduce((acc, s) => acc + s.qtySold, 0);
      if (cupsSold === 0 && stocks.length > 0) {
        cupsSold = stocks.reduce((acc, st) => acc + (st.qtySold || 0), 0);
      }
      if (cupsSold === 0 && revenue > 0) {
        cupsSold = Math.round(revenue / 10000);
      }

      // Hitung rincian cup terjual per jenis cup
      const cupBreakdownMap: Record<string, number> = {};
      sales.forEach((s) => {
        const name = s.cupTypeName || 'Cup';
        cupBreakdownMap[name] = (cupBreakdownMap[name] || 0) + s.qtySold;
      });
      if (Object.keys(cupBreakdownMap).length === 0 && stocks.length > 0) {
        stocks.forEach((st) => {
          const name = st.cupTypeName || 'Cup';
          cupBreakdownMap[name] = (cupBreakdownMap[name] || 0) + (st.qtySold || 0);
        });
      }

      const cupBreakdown = Object.entries(cupBreakdownMap).map(([cupName, qty]) => ({
        cupTypeName: cupName,
        qtySold: qty,
      }));

      const expectedTotalCash = modal + revenue;
      const variance = finalCash !== null ? finalCash - expectedTotalCash : 0;

      return {
        id: r.id,
        date: r.date,
        shiftType: r.shiftType || 'PAGI',
        boothId: r.boothId,
        boothName: r.boothName || 'Booth',
        boothAddress: r.boothAddress || '-',
        attendantName: r.attendantName || 'Staf Booth',
        cashModal: modal,
        cashFinal: finalCash,
        revenue,
        cupsSold,
        cupBreakdown,
        expectedTotalCash,
        variance,
        teaRemainingLiters: r.teaRemainingLiters ? parseFloat(r.teaRemainingLiters) : 0,
        notes: r.notes || '',
        status: r.status,
        saleItems: sales.map((s) => ({
          id: s.id,
          productName: s.productName || 'Produk Teh',
          cupTypeName: s.cupTypeName || 'Reguler',
          qtySold: s.qtySold,
          priceSnapshot: s.priceSnapshot,
          subtotal: s.qtySold * s.priceSnapshot,
        })),
        stockItems: stocks.map((st) => ({
          id: st.id,
          cupTypeName: st.cupTypeName || 'Cup',
          qtyInitial: st.qtyInitial,
          qtyAdded: st.qtyAdded || 0,
          qtyFinal: Math.max(0, (st.qtyInitial + (st.qtyAdded || 0)) - st.qtySold),
          qtySold: st.qtySold,
        })),
      };
    });

    // Hitung ringkasan per booth (Booth-Level Breakdown)
    const boothSummaryMap: Record<string, {
      boothId: string;
      boothName: string;
      boothAddress: string;
      totalRevenue: number;
      totalCupsSold: number;
      cupBreakdown: Record<string, number>;
      reportCount: number;
    }> = {};

    formatted.forEach((item) => {
      let bSummary = boothSummaryMap[item.boothId];
      if (!bSummary) {
        bSummary = {
          boothId: item.boothId,
          boothName: item.boothName,
          boothAddress: item.boothAddress,
          totalRevenue: 0,
          totalCupsSold: 0,
          cupBreakdown: {},
          reportCount: 0,
        };
        boothSummaryMap[item.boothId] = bSummary;
      }
      bSummary.totalRevenue += item.revenue;
      bSummary.totalCupsSold += item.cupsSold;
      bSummary.reportCount += 1;

      item.cupBreakdown.forEach((cb) => {
        bSummary.cupBreakdown[cb.cupTypeName] = (bSummary.cupBreakdown[cb.cupTypeName] || 0) + cb.qtySold;
      });
    });

    const boothSummaries = Object.values(boothSummaryMap);

    return c.json({
      success: true,
      data: formatted,
      boothSummaries,
    });
  } catch (err) {
    console.error('[Summary Table Error]:', err);
    return c.json({ success: false, error: { code: 'SERVER_ERROR', message: 'Gagal memuat rekap penjualan' } }, 500);
  }
});

// GET /dashboard/booth-comparison (HANYA DARI BOOTH YANG AKTIF)
summaryRouter.get('/dashboard/booth-comparison', requireRole('ADMIN'), async (c) => {
  try {
    const range = c.req.query('range') || 'today';
    const today = getWibDateString();

    const allBooths = await db
      .select()
      .from(schema.booths)
      .where(eq(schema.booths.isActive, true))
      .orderBy(desc(schema.booths.createdAt));

    const conditions = [eq(schema.booths.isActive, true)];

    if (range === 'today') {
      conditions.push(eq(schema.dailyReports.reportDate, today));
    } else if (range === '7days') {
      const d = new Date();
      d.setDate(d.getDate() - 7);
      conditions.push(gte(schema.dailyReports.reportDate, getWibDateString(d)));
    } else if (range === 'month') {
      const startOfMonth = today.slice(0, 7) + '-01';
      conditions.push(gte(schema.dailyReports.reportDate, startOfMonth));
    }

    const allReports = await db
      .select({
        id: schema.dailyReports.id,
        boothId: schema.dailyReports.boothId,
        reportDate: schema.dailyReports.reportDate,
        cashModal: schema.dailyReports.cashModal,
        cashFinal: schema.dailyReports.cashFinal,
        status: schema.dailyReports.status,
      })
      .from(schema.dailyReports)
      .innerJoin(schema.booths, and(eq(schema.dailyReports.boothId, schema.booths.id), eq(schema.booths.isActive, true)))
      .where(and(...conditions));

    const comparisonData = allBooths.map((booth) => {
      const boothReports = allReports.filter((r) => r.boothId === booth.id);
      let totalRevenue = 0;
      let totalCups = 0;

      boothReports.forEach((r) => {
        const rev = Math.max(0, (r.cashFinal || 0) - (r.cashModal || 0));
        totalRevenue += rev;
        totalCups += Math.round(rev / 10000);
      });

      return {
        boothId: booth.id,
        boothName: booth.name,
        revenue: totalRevenue,
        cupsSold: totalCups,
        totalShifts: boothReports.length,
      };
    });

    return c.json({ success: true, range, data: comparisonData });
  } catch (err) {
    console.error('[Booth Comparison Error]:', err);
    return c.json({ success: false, error: { code: 'SERVER_ERROR', message: 'Gagal memuat data komparasi booth' } }, 500);
  }
});
