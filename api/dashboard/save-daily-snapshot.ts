/**
 * Sparar dagliga KPI-snapshots i daily_kpi_snapshots.
 * Kallas av Vercel cron 23:55 varje dag OCH kan triggas manuellt av
 * inloggad superadmin eller via CRON_SECRET.
 *
 * Snapshotet lagras med dagens datum (Europe/Stockholm) som PK.
 * Kör den flera gånger samma dag → uppsertar (senaste värdet vinner).
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { prisma } from '../_lib/prisma.js';

export const config = { maxDuration: 60 };

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
  // Auth: cron-secret ELLER inloggad user
  const secret = process.env.CRON_SECRET;
  const authHdr = req.headers.authorization || '';
  const isCron = secret && authHdr === `Bearer ${secret}`;
  const isQuerySecret = secret && req.query.secret === secret;
  if (secret && !isCron && !isQuerySecret) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const baseUrl = process.env.APP_URL || `https://${req.headers.host}`;
    // Hämta senaste overview-stats (forcerar refresh så vi får FÄRSK data)
    const [statsRes, trendRes] = await Promise.all([
      fetch(`${baseUrl}/api/dashboard/overview-stats?refresh=1`),
      fetch(`${baseUrl}/api/dashboard/online-bookings-trend?refresh=1`),
    ]);
    if (!statsRes.ok) throw new Error(`overview-stats: ${statsRes.status}`);
    const stats = await statsRes.json();
    const trend = trendRes.ok ? await trendRes.json() : null;

    const dateStr = ymdSthlm(new Date());
    const dateObj = new Date(`${dateStr}T00:00:00.000Z`);

    const data = {
      bookedRevenue: Number(stats.totalRevenueExVat ?? 0),
      invoicedRevenue: Number(stats.totalInvoicedNet ?? 0),
      avgPricePerHour: Number(stats.avgPricePerHour ?? 0),
      recurringPrivateClients: Number(stats.recurringPrivateClients ?? 0),
      recurringCompanyClients: Number(stats.recurringCompanyClients ?? 0),
      staffCount: Number(stats.employees ?? 0),
      onlineBookings: Number(trend?.totals?.thisMonth ?? stats.onlineBookings ?? 0),
      metadata: { source: isCron ? 'cron' : 'manual', period: stats.period } as any,
    };

    const upserted = await prisma.dailyKpiSnapshot.upsert({
      where: { date: dateObj },
      create: { date: dateObj, ...data },
      update: { ...data, updatedAt: new Date() },
    });

    res.json({
      ok: true,
      date: dateStr,
      id: upserted.id,
      values: data,
    });
  } catch (err: any) {
    console.error('[save-daily-snapshot]', err?.message);
    res.status(500).json({ error: err?.message || 'save failed' });
  }
}
