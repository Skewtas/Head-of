/**
 * Trend för online-bokningar (från Bokis via Timewave).
 *
 * Returnerar tidsserier:
 *   - daily:   senaste 30 dagar
 *   - weekly:  senaste 12 veckor
 *   - monthly: senaste 12 månader
 *
 * En "online-bokning" är samma definition som redan används i
 * timewave-summary/missions.ts — missions vars källa/tag innehåller
 * "online", "boka.stodona", "webform" eller "web".
 *
 * Datum bestäms med följande prioordning:
 *   mission.created_at → mission.booked_at → mission.date_ordered → mission.startdate
 * Så vi räknar "bokning-flödet" när fältet finns, annars fallback till
 * städtillfället (bättre än ingenting).
 *
 * Cachear i DashboardSnapshot i 30 min (samma mönster som overview-stats).
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getTimewaveToken, forceRefreshTimewaveToken } from '../_lib/timewaveAuth.js';
import { prisma } from '../_lib/prisma.js';

export const config = { maxDuration: 60 };

const KEY = 'online_bookings_trend';
const STALE_MINUTES = 30;
const DAILY_WINDOW = 30;
const WEEKLY_WINDOW = 12;
const MONTHLY_WINDOW = 12;

interface TrendResult {
  daily: Array<{ date: string; count: number }>;
  weekly: Array<{ weekStart: string; label: string; count: number }>;
  monthly: Array<{ month: string; label: string; count: number }>;
  totals: {
    today: number;
    thisWeek: number;
    thisMonth: number;
    last30d: number;
  };
  computedAt: string;
  windowStart: string;
  windowEnd: string;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const force = req.query.refresh === '1';

  if (!force) {
    const snap = await prisma.dashboardSnapshot.findUnique({ where: { key: KEY } });
    if (snap && snap.data && (snap.data as any).daily) {
      const ageMs = Date.now() - snap.computedAt.getTime();
      const stale = ageMs > STALE_MINUTES * 60_000;
      // Om cachen är stale men färsk nog för att visa direkt — returnera + refresh i bakgrund
      if (!stale) {
        return res.json({ ...(snap.data as any), cached: true, ageMinutes: Math.round(ageMs / 60000) });
      }
      // Fall through till refresh
    }
  }

  try {
    const data = await compute(req);
    await prisma.dashboardSnapshot.upsert({
      where: { key: KEY },
      create: { key: KEY, data: data as any, computedAt: new Date() },
      update: { data: data as any, computedAt: new Date() },
    });
    res.json({ ...data, cached: false, ageMinutes: 0 });
  } catch (err: any) {
    console.error('[online-bookings-trend]', err?.message);
    res.status(500).json({ error: err?.message || 'compute failed' });
  }
}

async function compute(req: VercelRequest): Promise<TrendResult> {
  const timewaveBaseUrl = 'https://api.timewave.se/v3';
  let token = await getTimewaveToken();

  // Fönster: idag - 100 dagar → idag (för att täcka 12 veckor + lite marginal)
  const now = new Date();
  const windowStart = new Date(now);
  windowStart.setDate(windowStart.getDate() - 100);

  const pad = (n: number) => String(n).padStart(2, '0');
  const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

  // Vi behöver även månader bakåt — se till att fetch täcker 12 månader
  const monthlyStart = new Date(now.getFullYear(), now.getMonth() - (MONTHLY_WINDOW - 1), 1);
  const effectiveStart = monthlyStart < windowStart ? monthlyStart : windowStart;

  const urlBase = `${timewaveBaseUrl}/missions?filter[startdate]=${iso(effectiveStart)}&filter[enddate]=${iso(now)}&page[size]=200`;
  const fetchPage = async (p: number, retry = true): Promise<any> => {
    let r = await fetch(`${urlBase}&page[number]=${p}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    });
    if (r.status === 403 && retry) {
      token = await forceRefreshTimewaveToken();
      return fetchPage(p, false);
    }
    if (r.status === 429) {
      await new Promise((res) => setTimeout(res, 1000));
      r = await fetch(`${urlBase}&page[number]=${p}`, {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      });
    }
    if (!r.ok) throw new Error(`Timewave ${r.status}`);
    return r.json();
  };

  const firstData = await fetchPage(1);
  const lastPage = firstData.last_page || 1;
  let missions: any[] = firstData.data || [];
  if (lastPage > 1) {
    const PAR = 4;
    for (let p = 2; p <= lastPage; p += PAR) {
      const batch: number[] = [];
      for (let i = 0; i < PAR && p + i <= lastPage; i++) batch.push(p + i);
      const results = await Promise.all(
        batch.map((pn) => fetchPage(pn).catch(() => ({ data: [] })))
      );
      results.forEach((d: any) => { missions = missions.concat(d.data || []); });
    }
  }

  // Filtrera bara online-bokningar + hitta bokningsdatum per mission
  const isOnline = (m: any): boolean => {
    const candidates = [
      m.source, m.origin, m.channel,
      m.workorder?.workordergroup?.name,
      m.workordergroup?.name,
      ...(Array.isArray(m.tags) ? m.tags.map((t: any) => t?.name).filter(Boolean) : []),
    ].filter(Boolean).map((s: any) => String(s).toLowerCase());
    return candidates.some((s) => s.includes('online') || s.includes('boka.stodona') || s.includes('webform') || s === 'web');
  };
  const bookingDate = (m: any): string | null => {
    const raw = m.created_at || m.booked_at || m.date_ordered || m.order_date || m.startdate || m.date;
    if (!raw) return null;
    const s = String(raw).slice(0, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
  };

  const onlineDates: string[] = [];
  for (const m of missions) {
    if (!isOnline(m)) continue;
    if (!m.client?.id) continue; // samma villkor som existerande beräkningen
    const d = bookingDate(m);
    if (d) onlineDates.push(d);
  }

  // Aggregera per dag
  const dailyMap = new Map<string, number>();
  for (const d of onlineDates) dailyMap.set(d, (dailyMap.get(d) ?? 0) + 1);

  // Bygg daily-array för senaste 30 dagar
  const daily: Array<{ date: string; count: number }> = [];
  for (let i = DAILY_WINDOW - 1; i >= 0; i--) {
    const d = new Date(now); d.setDate(d.getDate() - i);
    const key = iso(d);
    daily.push({ date: key, count: dailyMap.get(key) ?? 0 });
  }

  // Bygg weekly (12 veckor bakåt) — vecka börjar måndag
  const weekly: Array<{ weekStart: string; label: string; count: number }> = [];
  const startOfWeek = (d: Date) => {
    const x = new Date(d); x.setHours(0, 0, 0, 0);
    const dow = (x.getDay() + 6) % 7;
    x.setDate(x.getDate() - dow);
    return x;
  };
  const isoWeekNum = (d: Date) => {
    const x = new Date(d.getTime());
    x.setHours(0, 0, 0, 0);
    x.setDate(x.getDate() + 3 - ((x.getDay() + 6) % 7));
    const w1 = new Date(x.getFullYear(), 0, 4);
    return 1 + Math.round(((x.getTime() - w1.getTime()) / 86400000 - 3 + ((w1.getDay() + 6) % 7)) / 7);
  };
  for (let i = WEEKLY_WINDOW - 1; i >= 0; i--) {
    const ws = startOfWeek(now);
    ws.setDate(ws.getDate() - i * 7);
    const we = new Date(ws); we.setDate(we.getDate() + 6);
    let count = 0;
    for (const d of onlineDates) {
      if (d >= iso(ws) && d <= iso(we)) count++;
    }
    weekly.push({ weekStart: iso(ws), label: `v.${isoWeekNum(ws)}`, count });
  }

  // Bygg monthly (12 månader bakåt)
  const monthly: Array<{ month: string; label: string; count: number }> = [];
  for (let i = MONTHLY_WINDOW - 1; i >= 0; i--) {
    const ms = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const me = new Date(now.getFullYear(), now.getMonth() - i + 1, 0);
    let count = 0;
    for (const d of onlineDates) {
      if (d >= iso(ms) && d <= iso(me)) count++;
    }
    const label = new Intl.DateTimeFormat('sv-SE', { month: 'short', year: '2-digit' }).format(ms);
    monthly.push({ month: iso(ms).slice(0, 7), label, count });
  }

  // Totals
  const todayKey = iso(now);
  const weekStartKey = iso(startOfWeek(now));
  const weekEndKey = iso(new Date(startOfWeek(now).getTime() + 6 * 86400000));
  const monthStartKey = iso(new Date(now.getFullYear(), now.getMonth(), 1));
  const monthEndKey = iso(new Date(now.getFullYear(), now.getMonth() + 1, 0));
  const thirtyDaysAgo = iso(new Date(now.getTime() - 30 * 86400000));

  const totals = {
    today: dailyMap.get(todayKey) ?? 0,
    thisWeek: onlineDates.filter((d) => d >= weekStartKey && d <= weekEndKey).length,
    thisMonth: onlineDates.filter((d) => d >= monthStartKey && d <= monthEndKey).length,
    last30d: onlineDates.filter((d) => d >= thirtyDaysAgo).length,
  };

  return {
    daily, weekly, monthly, totals,
    computedAt: now.toISOString(),
    windowStart: iso(effectiveStart),
    windowEnd: iso(now),
  };
}
