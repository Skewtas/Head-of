/**
 * "Hur länge stannar våra kunder?" — beräknar kundlojalitet.
 *
 * Hämtar missions från Timewave för de senaste N månaderna (default 24),
 * grupperar per client_id, plockar MIN(datum) = först-sedd och MAX(datum) =
 * senast-sedd. "Aktiv kund" = senast-sedd inom 60 dagar tillbaka. Returnerar
 * snitt, median, totalt antal + fördelning i lojalitetsbuckets.
 *
 * Resultatet cachas i minnet 1 timme per lambda-instans så dashboarden inte
 * hamrar Timewave varje gång den laddas.
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getTimewaveToken, forceRefreshTimewaveToken } from '../_lib/timewaveAuth.js';

interface TenureResult {
  computedAt: string;
  windowMonths: number;
  activeCustomers: number;
  averageMonths: number;
  medianMonths: number;
  buckets: {
    'lt3mo': number;     // < 3 månader
    '3to6mo': number;    // 3–6 månader
    '6to12mo': number;   // 6–12 månader
    '1to2yr': number;    // 1–2 år
    '2plus': number;     // 2+ år (egentligen "minst window-månader")
  };
  oldestKnownMonths: number; // tenure för den äldsta kunden vi hittade
}

let cache: { at: number; data: TenureResult } | null = null;
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 timme

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const force = req.query.refresh === '1' || req.query.refresh === 'true';
  if (!force && cache && Date.now() - cache.at < CACHE_TTL_MS) {
    return res.json({ ...cache.data, cached: true });
  }

  const windowMonths = Math.min(36, Math.max(6, Number(req.query.months) || 24));
  const data = await computeTenure(windowMonths);
  cache = { at: Date.now(), data };
  res.json({ ...data, cached: false });
}

async function computeTenure(windowMonths: number): Promise<TenureResult> {
  const today = new Date();
  const start = new Date(today.getFullYear(), today.getMonth() - windowMonths + 1, 1);

  // Bryt ner perioden i 4-månaderschunks och kör parallellt (max 6 samtidigt).
  const chunks: Array<{ from: Date; to: Date }> = [];
  for (let m = 0; m < windowMonths; m += 4) {
    const from = new Date(start.getFullYear(), start.getMonth() + m, 1);
    const to = new Date(
      start.getFullYear(),
      Math.min(start.getMonth() + m + 4, today.getMonth() + 12),
      0
    );
    if (to > today) to.setTime(today.getTime());
    chunks.push({ from, to });
  }

  const allMissions: any[] = [];
  for (let i = 0; i < chunks.length; i += 4) {
    const slice = chunks.slice(i, i + 4);
    const results = await Promise.all(
      slice.map((c) => fetchMissionsInRange(c.from, c.to).catch(() => []))
    );
    for (const r of results) allMissions.push(...r);
  }

  // Per kund: först-sedd / senast-sedd / antal pass
  const byClient = new Map<number, { first: Date; last: Date; count: number }>();
  for (const m of allMissions) {
    const cid = m.client?.id ?? m.client_id;
    const dateStr = m.startdate || m.date;
    if (!cid || !dateStr) continue;
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) continue;
    const existing = byClient.get(cid);
    if (!existing) {
      byClient.set(cid, { first: d, last: d, count: 1 });
    } else {
      if (d < existing.first) existing.first = d;
      if (d > existing.last) existing.last = d;
      existing.count++;
    }
  }

  // "Aktiv kund" = senast-sedd < 60 dagar sedan
  const activeCutoff = new Date(today.getTime() - 60 * 24 * 3600 * 1000);
  const tenures: number[] = [];
  let oldestMonths = 0;
  for (const [, info] of byClient) {
    if (info.last < activeCutoff) continue;
    const months = monthsBetween(info.first, today);
    tenures.push(months);
    if (months > oldestMonths) oldestMonths = months;
  }

  tenures.sort((a, b) => a - b);
  const totalActive = tenures.length;
  const avg = totalActive ? tenures.reduce((s, x) => s + x, 0) / totalActive : 0;
  const median = totalActive
    ? tenures.length % 2
      ? tenures[Math.floor(tenures.length / 2)]
      : (tenures[tenures.length / 2 - 1] + tenures[tenures.length / 2]) / 2
    : 0;

  const buckets = {
    lt3mo: tenures.filter((t) => t < 3).length,
    '3to6mo': tenures.filter((t) => t >= 3 && t < 6).length,
    '6to12mo': tenures.filter((t) => t >= 6 && t < 12).length,
    '1to2yr': tenures.filter((t) => t >= 12 && t < 24).length,
    '2plus': tenures.filter((t) => t >= 24).length,
  };

  return {
    computedAt: today.toISOString(),
    windowMonths,
    activeCustomers: totalActive,
    averageMonths: Math.round(avg * 10) / 10,
    medianMonths: Math.round(median * 10) / 10,
    buckets,
    oldestKnownMonths: Math.round(oldestMonths * 10) / 10,
  };
}

async function fetchMissionsInRange(from: Date, to: Date): Promise<any[]> {
  let token = await getTimewaveToken();
  const baseUrl = 'https://api.timewave.se/v3';
  const f = formatDate(from);
  const t = formatDate(to);

  const fetchPage = async (page: number) => {
    let res = await fetch(
      `${baseUrl}/missions?filter[startdate]=${f}&filter[enddate]=${t}&page[size]=200&page[number]=${page}`,
      { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } }
    );
    if (res.status === 403) {
      token = await forceRefreshTimewaveToken();
      res = await fetch(
        `${baseUrl}/missions?filter[startdate]=${f}&filter[enddate]=${t}&page[size]=200&page[number]=${page}`,
        { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } }
      );
    }
    if (!res.ok) return { data: [], last_page: 1 };
    return res.json();
  };

  const first = await fetchPage(1);
  const all: any[] = first.data || [];
  const totalPages = first.last_page || 1;
  if (totalPages <= 1) return all;
  const promises: Promise<any>[] = [];
  for (let p = 2; p <= totalPages; p++) promises.push(fetchPage(p));
  const rest = await Promise.all(promises);
  for (const r of rest) all.push(...(r.data || []));
  return all;
}

function formatDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function monthsBetween(a: Date, b: Date): number {
  const ms = b.getTime() - a.getTime();
  return Math.max(0, ms / (1000 * 60 * 60 * 24 * 30.4375));
}
