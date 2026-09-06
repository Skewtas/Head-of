/**
 * Bokningar från Bokis (stodona-bokningsmodul) — Convex-anrop.
 *
 * Ersätter det gamla online-bookings-trend som gissade från Timewave-taggar.
 * Här hämtar vi äkta data direkt från källan: alla bokningar som skapats via
 * bokningsmodulens frontend.
 *
 * ENV krävs (sätts i Vercel):
 *   BOKIS_CONVEX_URL           – t.ex. https://glorious-gerbil-763.convex.cloud
 *   BOKIS_CONVEX_ADMIN_SECRET  – matchar CONVEX_ADMIN_SECRET på Convex-sidan
 *
 * Caches 15 min i DashboardSnapshot.
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { prisma } from '../_lib/prisma.js';

export const config = { maxDuration: 30 };

const KEY = 'bokis_bookings_counts';
const STALE_MINUTES = 15;

function ymdSthlm(d: Date): string {
  const parts = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Europe/Stockholm', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(d);
  const y = parts.find((p) => p.type === 'year')!.value;
  const m = parts.find((p) => p.type === 'month')!.value;
  const day = parts.find((p) => p.type === 'day')!.value;
  return `${y}-${m}-${day}`;
}

function monthKey(dateStr: string): string {
  return dateStr.slice(0, 7); // YYYY-MM
}

type BokisBooking = {
  id: string;
  service?: string;
  date?: string;         // t.ex. "2026-09-06"
  status?: string;
  createdAt?: number;    // convex _creationTime ms
  _creationTime?: number;
};

async function fetchBokisBookings(): Promise<BokisBooking[]> {
  const url = process.env.BOKIS_CONVEX_URL;
  const secret = process.env.BOKIS_CONVEX_ADMIN_SECRET;
  if (!url || !secret) {
    throw new Error(
      'BOKIS_CONVEX_URL / BOKIS_CONVEX_ADMIN_SECRET saknas i Vercel-env.',
    );
  }
  // Convex HTTP-query: POST {baseUrl}/api/query { path, args, format:"json" }
  const r = await fetch(`${url.replace(/\/$/, '')}/api/query`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      path: 'adminData:listBookings',
      args: { secret },
      format: 'json',
    }),
  });
  if (!r.ok) {
    const text = await r.text().catch(() => '');
    throw new Error(`Convex ${r.status}: ${text.substring(0, 200)}`);
  }
  const body = await r.json();
  if (body.status === 'error') {
    throw new Error(`Convex error: ${body.errorMessage || 'unknown'}`);
  }
  const rows = body.value || body;
  if (!Array.isArray(rows)) return [];
  return rows as BokisBooking[];
}

function computeCounts(bookings: BokisBooking[]) {
  const now = new Date();
  const todayKey = ymdSthlm(now);
  const thisMonthKey = todayKey.slice(0, 7);
  const weekStart = new Date(now);
  weekStart.setDate(weekStart.getDate() - 6);
  const weekStartKey = ymdSthlm(weekStart);

  let today = 0;
  let thisWeek = 0;
  let thisMonth = 0;
  let total = 0;
  let cancelled = 0;

  // Räkna baserat på _creationTime (när bokningen skapades) — inte städdatumet.
  // Det är "bokningsflödet" som är intressant för trend/dashboards.
  for (const b of bookings) {
    total++;
    if (b.status === 'cancelled') cancelled++;
    const createdAt = b._creationTime ?? b.createdAt;
    if (!createdAt) continue;
    const createdKey = ymdSthlm(new Date(createdAt));
    if (createdKey === todayKey) today++;
    if (createdKey >= weekStartKey) thisWeek++;
    if (monthKey(createdKey) === thisMonthKey) thisMonth++;
  }

  return { today, thisWeek, thisMonth, total, cancelled };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const force = req.query.refresh === '1';

  if (!force) {
    const snap = await prisma.dashboardSnapshot.findUnique({ where: { key: KEY } });
    if (snap && snap.data) {
      const ageMs = Date.now() - snap.computedAt.getTime();
      if (ageMs < STALE_MINUTES * 60_000) {
        return res.json({ ...(snap.data as any), cached: true, ageMinutes: Math.round(ageMs / 60000) });
      }
    }
  }

  try {
    const bookings = await fetchBokisBookings();
    const counts = computeCounts(bookings);
    const payload = {
      source: 'bokis-convex',
      totals: counts,
      sampleSize: bookings.length,
      computedAt: new Date().toISOString(),
    };
    await prisma.dashboardSnapshot.upsert({
      where: { key: KEY },
      create: { key: KEY, data: payload as any, computedAt: new Date() },
      update: { data: payload as any, computedAt: new Date() },
    });
    res.json(payload);
  } catch (err: any) {
    console.error('[bokis-bookings]', err?.message);
    // Fallback till stale cache om något gick fel — visa hellre gammal siffra
    // än 0. Om ingen cache finns → returnera nollor med felmeddelande.
    const snap = await prisma.dashboardSnapshot.findUnique({ where: { key: KEY } });
    if (snap && snap.data) {
      return res.json({ ...(snap.data as any), stale: true, error: err?.message });
    }
    res.status(500).json({
      error: err?.message || 'kunde inte hämta bokningar',
      totals: { today: 0, thisWeek: 0, thisMonth: 0, total: 0, cancelled: 0 },
    });
  }
}
