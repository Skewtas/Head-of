/**
 * Intäktstrend — senaste N dagarnas snapshots med dygns-delta.
 *
 * Returnerar array (nyast först):
 *   [
 *     { date: '2026-09-10', bookedRevenue: 820586, delta: null, isToday: true, ageHours: 0 },
 *     { date: '2026-09-09', bookedRevenue: 815009, delta: -5577 → +5577 relativt 08 },
 *     ...
 *   ]
 *
 * Så översikten kan visa både:
 *   - "sedan igår: +5 577 kr"
 *   - hela 7-dagars-trenden i en liten sparkline/tabell
 *
 * Om cron inte hunnit köra idag (t.ex. tidig morgon) beräknas dagens värde
 * från live overview-stats så vi ALLTID kan visa en delta.
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
    const days = Math.min(Math.max(Number(req.query.days) || 7, 2), 30);
    const baseUrl = process.env.APP_URL || `https://${req.headers.host}`;

    // 1) Hämta lagrade snapshots (senaste N + lite marginal, filtrera bort baseline-backfill)
    const raw = await prisma.dailyKpiSnapshot.findMany({
      orderBy: { date: 'desc' },
      take: days + 5,
    });
    const cleanSnaps = raw
      .filter((s) => {
        const src = (s.metadata as any)?.source;
        return src !== 'baseline-backfill' && src !== 'daily-comparison-auto';
      })
      .slice(0, days + 1);

    const todayStr = ymdSthlm(new Date());
    const bySthlmDate = new Map<string, typeof cleanSnaps[number]>();
    for (const s of cleanSnaps) {
      const dateStr = ymdSthlm(s.date);
      if (!bySthlmDate.has(dateStr)) bySthlmDate.set(dateStr, s);
    }

    // 2) Bygg dags-listan (nyast först). Om ingen snapshot för idag → hämta
    //    live overview-stats så användaren alltid ser en delta.
    let liveTodayRevenue: number | null = null;
    if (!bySthlmDate.has(todayStr)) {
      try {
        const r = await fetch(`${baseUrl}/api/dashboard/overview-stats`);
        if (r.ok) {
          const j = await r.json();
          liveTodayRevenue = Number(j?.totalRevenueExVat ?? 0);
        }
      } catch { /* ignore */ }
    }

    // 3) Bygg output — nyast först
    type Row = {
      date: string;
      isToday: boolean;
      source: 'snapshot' | 'live';
      bookedRevenue: number;
      invoicedRevenue: number | null;
      onlineBookings: number | null;
      delta: {
        bookedRevenue: number | null;
        percent: number | null;
      };
      comparedTo: string | null;
    };

    const orderedDates: string[] = [];
    if (liveTodayRevenue !== null) orderedDates.push(todayStr);
    for (const s of cleanSnaps) {
      const d = ymdSthlm(s.date);
      if (!orderedDates.includes(d)) orderedDates.push(d);
    }

    const rows: Row[] = [];
    for (let i = 0; i < orderedDates.length && i <= days; i++) {
      const date = orderedDates[i];
      const isToday = date === todayStr;
      const snap = bySthlmDate.get(date);
      const bookedRevenue = isToday && liveTodayRevenue !== null && !snap
        ? liveTodayRevenue
        : Number(snap?.bookedRevenue ?? 0);

      // Föregående dags värde för delta
      const prevDate = orderedDates[i + 1];
      let delta: Row['delta'] = { bookedRevenue: null, percent: null };
      if (prevDate) {
        const prevSnap = bySthlmDate.get(prevDate);
        const prevRev = Number(prevSnap?.bookedRevenue ?? 0);
        const d = bookedRevenue - prevRev;
        delta = {
          bookedRevenue: d,
          percent: prevRev > 0 ? Math.round((d / prevRev) * 1000) / 10 : null,
        };
      }
      rows.push({
        date,
        isToday,
        source: snap ? 'snapshot' : 'live',
        bookedRevenue,
        invoicedRevenue: snap ? Number(snap.invoicedRevenue ?? 0) : null,
        onlineBookings: snap ? Number(snap.onlineBookings ?? 0) : null,
        delta,
        comparedTo: prevDate || null,
      });
    }

    res.setHeader('Cache-Control', 'no-store');
    res.json({
      days,
      todayDate: todayStr,
      rows,
      hasSnapshotToday: bySthlmDate.has(todayStr),
    });
  } catch (err: any) {
    console.error('[revenue-trend]', err?.message);
    res.status(500).json({ error: err?.message || 'trend failed' });
  }
}
