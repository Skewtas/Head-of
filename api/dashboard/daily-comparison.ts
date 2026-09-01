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

    const [statsRes, trendRes, todaySnap, prevSnap] = await Promise.all([
      fetch(`${baseUrl}/api/dashboard/overview-stats`),
      fetch(`${baseUrl}/api/dashboard/online-bookings-trend`),
      (async () => {
        const today = new Date(`${ymdSthlm(new Date())}T00:00:00.000Z`);
        return prisma.dailyKpiSnapshot.findUnique({ where: { date: today } });
      })(),
      prisma.dailyKpiSnapshot.findFirst({
        where: { date: { lt: new Date(`${ymdSthlm(new Date())}T00:00:00.000Z`) } },
        orderBy: { date: 'desc' },
      }),
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

    const previous = prevSnap ? {
      date: prevSnap.date,
      bookedRevenue: prevSnap.bookedRevenue,
      invoicedRevenue: prevSnap.invoicedRevenue,
      avgPricePerHour: prevSnap.avgPricePerHour,
      recurringPrivateClients: prevSnap.recurringPrivateClients,
      recurringCompanyClients: prevSnap.recurringCompanyClients,
      staffCount: prevSnap.staffCount,
      onlineBookings: prevSnap.onlineBookings,
    } : null;

    const diff = previous ? {
      bookedRevenue: current.bookedRevenue - previous.bookedRevenue,
      invoicedRevenue: current.invoicedRevenue - previous.invoicedRevenue,
      avgPricePerHour: current.avgPricePerHour - previous.avgPricePerHour,
      recurringPrivateClients: current.recurringPrivateClients - previous.recurringPrivateClients,
      recurringCompanyClients: current.recurringCompanyClients - previous.recurringCompanyClients,
      staffCount: current.staffCount - previous.staffCount,
      onlineBookings: current.onlineBookings - previous.onlineBookings,
    } : null;

    res.json({
      current,
      previous,
      diff,
      hasTodaySnapshot: !!todaySnap,
      previousSnapshotDate: prevSnap?.date ?? null,
    });
  } catch (err: any) {
    console.error('[daily-comparison]', err?.message);
    res.status(500).json({ error: err?.message || 'compare failed' });
  }
}
