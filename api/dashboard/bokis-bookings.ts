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
// 60 sekunder cache — så "LIVE återkommande" känns live men vi inte pumpar
// Convex vid varje polling. Frontend pollar var 30 sekund → ny bokning
// dyker upp inom ~60-90 s.
const STALE_SECONDS = 60;

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
  frequency?: string;    // "Varje vecka" | "Varannan vecka" | "Var tredje vecka" | "Var fjärde vecka" | "Engång"
  firstName?: string;
  lastName?: string;
  customerName?: string;
  city?: string;
  estimatedPrice?: number;
  sqm?: number;
  createdAt?: number;    // convex _creationTime ms
  _creationTime?: number;
};

const RECURRING_FREQ = new Set([
  'Varje vecka',
  'Varannan vecka',
  'Var tredje vecka',
  'Var fjärde vecka',
]);
function isRecurring(b: BokisBooking): boolean {
  return !!b.frequency && RECURRING_FREQ.has(b.frequency);
}

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

  // Rullande fönster istället för kalenderdag — så gårdagens bokning
  // fortfarande syns kl 08:00 nästa morgon (Mikaelas fråga 2026-09-29:
  // 5 abonnemang igår men Idag = 0). Nu räknar 'Senaste 24 tim' bakåt
  // från just NU.
  const nowMs = now.getTime();
  const dayAgo = nowMs - 24 * 3600 * 1000;

  let today = 0;              // kalenderdag (för bakåt-kompatibilitet)
  let last24h = 0;            // rullande 24 tim
  let thisWeek = 0;
  let thisMonth = 0;
  let total = 0;
  let cancelled = 0;

  let recurringToday = 0;
  let recurringLast24h = 0;
  let recurringThisWeek = 0;
  let recurringThisMonth = 0;
  let recurringTotal = 0;

  for (const b of bookings) {
    total++;
    if (b.status === 'cancelled') cancelled++;
    const recurring = isRecurring(b);
    if (recurring) recurringTotal++;
    const createdAt = b._creationTime ?? b.createdAt;
    if (!createdAt) continue;
    const createdKey = ymdSthlm(new Date(createdAt));
    if (createdKey === todayKey) { today++; if (recurring) recurringToday++; }
    if (createdAt >= dayAgo) { last24h++; if (recurring) recurringLast24h++; }
    if (createdKey >= weekStartKey) { thisWeek++; if (recurring) recurringThisWeek++; }
    if (monthKey(createdKey) === thisMonthKey) {
      thisMonth++; if (recurring) recurringThisMonth++;
    }
  }

  return {
    today, last24h, thisWeek, thisMonth, total, cancelled,
    recurringToday, recurringLast24h, recurringThisWeek, recurringThisMonth, recurringTotal,
  };
}

/** De senaste N återkommande bokningarna för live-feed på dashboarden. */
function latestRecurring(bookings: BokisBooking[], n: number) {
  return bookings
    .filter((b) => isRecurring(b) && b.status !== 'cancelled')
    .sort((a, b) => (b._creationTime ?? b.createdAt ?? 0) - (a._creationTime ?? a.createdAt ?? 0))
    .slice(0, n)
    .map((b) => ({
      id: b.id,
      createdAt: b._creationTime ?? b.createdAt ?? null,
      customerName:
        b.customerName ||
        [b.firstName, b.lastName].filter(Boolean).join(' ').trim() ||
        'Okänd kund',
      city: b.city || null,
      service: b.service || null,
      frequency: b.frequency || null,
      sqm: b.sqm ?? null,
      estimatedPrice: b.estimatedPrice ?? null,
      date: b.date || null,
    }));
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const force = req.query.refresh === '1';

  if (!force) {
    const snap = await prisma.dashboardSnapshot.findUnique({ where: { key: KEY } });
    if (snap && snap.data) {
      const ageMs = Date.now() - snap.computedAt.getTime();
      if (ageMs < STALE_SECONDS * 1000) {
        return res.json({ ...(snap.data as any), cached: true, ageSeconds: Math.round(ageMs / 1000) });
      }
    }
  }

  try {
    const bookings = await fetchBokisBookings();
    const counts = computeCounts(bookings);
    const payload = {
      source: 'bokis-convex',
      totals: counts,
      senasteAterkommande: latestRecurring(bookings, 10),
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
