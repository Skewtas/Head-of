/**
 * Läser senaste snapshot + dagens värden och returnerar diff per KPI.
 * Används av översikten för "↑ +X sedan igår"-visning.
 *
 * VIKTIGT: skriver ALDRIG till dagens snapshot. Bara cron
 * (save-daily-snapshot, 23:55) sparar dagliga värden. Att skriva på varje
 * read gav flip-flop-deltan (fake -36 st, -211 944 kr) när Timewave-cachen
 * bytte värde mellan requests.
 *
 * Om ingen tidigare snapshot finns → diff = null (frontend visar ±0).
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

    // Hämta senaste snapshot från TIDIGARE datum (< idag). Skriver aldrig.
    // Filtrera bort artificiella baselines från den gamla koden — de skapades
    // med DAGENS värde vid random-tidpunkt och gav flip-flop-deltan.
    const candidates = await prisma.dailyKpiSnapshot.findMany({
      where: { date: { lt: todayDateObj } },
      orderBy: { date: 'desc' },
      take: 10,
    });
    const prevSnap = candidates.find((s) => {
      const src = (s.metadata as any)?.source;
      return src !== 'baseline-backfill' && src !== 'daily-comparison-auto';
    }) || null;

    let previous: any = null;
    let diff: any = null;

    if (prevSnap) {
      previous = {
        date: prevSnap.date,
        bookedRevenue: prevSnap.bookedRevenue,
        invoicedRevenue: prevSnap.invoicedRevenue,
        avgPricePerHour: prevSnap.avgPricePerHour,
        recurringPrivateClients: prevSnap.recurringPrivateClients,
        recurringCompanyClients: prevSnap.recurringCompanyClients,
        staffCount: prevSnap.staffCount,
        onlineBookings: prevSnap.onlineBookings,
      };
      diff = {
        bookedRevenue: current.bookedRevenue - previous.bookedRevenue,
        invoicedRevenue: current.invoicedRevenue - previous.invoicedRevenue,
        avgPricePerHour: current.avgPricePerHour - previous.avgPricePerHour,
        recurringPrivateClients: current.recurringPrivateClients - previous.recurringPrivateClients,
        recurringCompanyClients: current.recurringCompanyClients - previous.recurringCompanyClients,
        staffCount: current.staffCount - previous.staffCount,
        onlineBookings: current.onlineBookings - previous.onlineBookings,
      };
    }

    res.json({
      current,
      previous,
      diff,
      previousSnapshotDate: prevSnap?.date ?? null,
    });
  } catch (err: any) {
    console.error('[daily-comparison]', err?.message);
    res.status(500).json({ error: err?.message || 'compare failed' });
  }
}
