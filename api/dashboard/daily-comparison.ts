/**
 * Läser senaste snapshot + dagens värden och returnerar diff per KPI.
 * Används av översikten för "↑ +X sedan igår"-visning.
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { prisma } from '../_lib/prisma.js';

export const config = { maxDuration: 30 };

function ymdSthlm(d: Date): string {
  const parts = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Europe/Stockholm', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(d);
  const y = parts.find((p) => p.type === 'year')!.value;
  const m = parts.find((p) => p.type === 'month')!.value;
  const day = parts.find((p) => p.type === 'day')!.value;
  return `${y}-${m}-${day}`;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const baseUrl = process.env.APP_URL || `https://${req.headers.host}`;
    const todayDateObj = new Date(`${ymdSthlm(new Date())}T00:00:00.000Z`);

    const [statsRes, trendRes] = await Promise.all([
      fetch(`${baseUrl}/api/dashboard/overview-stats`),
      fetch(`${baseUrl}/api/dashboard/online-bookings-trend`),
    ]);

    if (!statsRes.ok) throw new Error(`overview-stats: ${statsRes.status}`);
    const stats = await statsRes.json();
    const trend = trendRes.ok ? await trendRes.json() : null;

    const current = {
      bookedRevenue: Number(stats.totalRevenueExVat ?? 0),
      invoicedRevenue: Number(stats.totalInvoicedNet ?? 0),
      avgPricePerHour: Number(stats.avgPricePerHour ?? 0),
      recurringPrivateClients: Number(stats.recurringPrivateClients ?? 0),
      recurringCompanyClients: Number(stats.recurringCompanyClients ?? 0),
      staffCount: Number(stats.employees ?? 0),
      onlineBookings: Number(trend?.totals?.thisMonth ?? stats.onlineBookings ?? 0),
      onlineBookingsToday: Number(trend?.totals?.today ?? 0),
    };

    // 1) Auto-upsert dagens snapshot så vi alltid har senaste värdet sparat.
    //    Har vi redan en snapshot för idag så uppdateras den.
    await prisma.dailyKpiSnapshot.upsert({
      where: { date: todayDateObj },
      create: {
        date: todayDateObj,
        bookedRevenue: current.bookedRevenue,
        invoicedRevenue: current.invoicedRevenue,
        avgPricePerHour: current.avgPricePerHour,
        recurringPrivateClients: current.recurringPrivateClients,
        recurringCompanyClients: current.recurringCompanyClients,
        staffCount: current.staffCount,
        onlineBookings: current.onlineBookings,
        metadata: { source: 'daily-comparison-auto' } as any,
      },
      update: {
        bookedRevenue: current.bookedRevenue,
        invoicedRevenue: current.invoicedRevenue,
        avgPricePerHour: current.avgPricePerHour,
        recurringPrivateClients: current.recurringPrivateClients,
        recurringCompanyClients: current.recurringCompanyClients,
        staffCount: current.staffCount,
        onlineBookings: current.onlineBookings,
        updatedAt: new Date(),
      },
    });

    // 2) Hämta senaste snapshot från TIDIGARE datum
    let prevSnap = await prisma.dailyKpiSnapshot.findFirst({
      where: { date: { lt: todayDateObj } },
      orderBy: { date: 'desc' },
    });

    // 3) Om ingen tidigare snapshot finns alls: skapa en "gårdagens" baseline
    //    med dagens värden så delta = ±0 första dagen istället för "saknas".
    //    Från imorgon blir det riktig jämförelse.
    if (!prevSnap) {
      const yesterdayDateObj = new Date(todayDateObj.getTime() - 24 * 60 * 60 * 1000);
      prevSnap = await prisma.dailyKpiSnapshot.upsert({
        where: { date: yesterdayDateObj },
        create: {
          date: yesterdayDateObj,
          bookedRevenue: current.bookedRevenue,
          invoicedRevenue: current.invoicedRevenue,
          avgPricePerHour: current.avgPricePerHour,
          recurringPrivateClients: current.recurringPrivateClients,
          recurringCompanyClients: current.recurringCompanyClients,
          staffCount: current.staffCount,
          onlineBookings: current.onlineBookings,
          metadata: { source: 'baseline-backfill' } as any,
        },
        update: {}, // om finns redan, rör inte
      });
    }

    const previous = {
      date: prevSnap.date,
      bookedRevenue: prevSnap.bookedRevenue,
      invoicedRevenue: prevSnap.invoicedRevenue,
      avgPricePerHour: prevSnap.avgPricePerHour,
      recurringPrivateClients: prevSnap.recurringPrivateClients,
      recurringCompanyClients: prevSnap.recurringCompanyClients,
      staffCount: prevSnap.staffCount,
      onlineBookings: prevSnap.onlineBookings,
    };

    const diff = {
      bookedRevenue: current.bookedRevenue - previous.bookedRevenue,
      invoicedRevenue: current.invoicedRevenue - previous.invoicedRevenue,
      avgPricePerHour: current.avgPricePerHour - previous.avgPricePerHour,
      recurringPrivateClients: current.recurringPrivateClients - previous.recurringPrivateClients,
      recurringCompanyClients: current.recurringCompanyClients - previous.recurringCompanyClients,
      staffCount: current.staffCount - previous.staffCount,
      onlineBookings: current.onlineBookings - previous.onlineBookings,
    };

    res.json({
      current,
      previous,
      diff,
      hasTodaySnapshot: true,
      previousSnapshotDate: prevSnap.date,
    });
  } catch (err: any) {
    console.error('[daily-comparison]', err?.message);
    res.status(500).json({ error: err?.message || 'compare failed' });
  }
}
