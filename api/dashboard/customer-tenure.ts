/**
 * "Hur länge stannar våra kunder?" — beräknar kundlojalitet på fakturahistorik.
 *
 * Fakturor är ett bättre underlag än workorders/missions eftersom workorders
 * stängs och återskapas — då ser det ut som om kunden är "ny" trots flera
 * års relation. En faktura speglar däremot en faktisk affärsrelation.
 *
 * Hämtar fakturor från Timewave bakifrån (senaste → äldsta), grupperar per
 * client_id, plockar MIN(invoice_date) = kund-sedan och MAX = senast-fakturerad.
 * "Aktiv kund" = fakturerad inom de senaste 90 dagarna. Snitt + median +
 * fördelning över fem buckets returneras.
 *
 * Resultatet cachas i minnet 1 h per lambda-instans.
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getTimewaveToken, forceRefreshTimewaveToken } from '../_lib/timewaveAuth.js';

interface TenureResult {
  computedAt: string;
  windowMonths: number;
  source: 'invoices';
  activeCustomers: number;
  averageMonths: number;
  medianMonths: number;
  buckets: {
    'lt3mo': number;
    '3to6mo': number;
    '6to12mo': number;
    '1to2yr': number;
    '2plus': number;
  };
  oldestKnownMonths: number;
  invoicesScanned: number;
}

let cache: { at: number; data: TenureResult } | null = null;
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 timme

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const force = req.query.refresh === '1' || req.query.refresh === 'true';
  if (!force && cache && Date.now() - cache.at < CACHE_TTL_MS) {
    return res.json({ ...cache.data, cached: true });
  }

  const windowMonths = Math.min(120, Math.max(12, Number(req.query.months) || 60));
  try {
    const data = await computeTenureFromInvoices(windowMonths);
    cache = { at: Date.now(), data };
    res.json({ ...data, cached: false });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Failed to compute tenure' });
  }
}

async function computeTenureFromInvoices(windowMonths: number): Promise<TenureResult> {
  const today = new Date();
  const cutoff = new Date(today.getFullYear(), today.getMonth() - windowMonths, 1);
  const cutoffStr = formatDate(cutoff);

  let token = await getTimewaveToken();
  const baseUrl = 'https://api.timewave.se/v3';

  const fetchPage = async (page: number): Promise<{ data: any[]; last_page: number }> => {
    let res = await fetch(`${baseUrl}/invoices?page[number]=${page}&page[size]=200`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    });
    if (res.status === 403) {
      token = await forceRefreshTimewaveToken();
      res = await fetch(`${baseUrl}/invoices?page[number]=${page}&page[size]=200`, {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      });
    }
    if (!res.ok) return { data: [], last_page: 1 };
    return res.json() as Promise<{ data: any[]; last_page: number }>;
  };

  // Första sidan ger oss last_page (där nyaste fakturorna ligger)
  const first = await fetchPage(1);
  const lastPage = first.last_page || 1;

  // Vi går bakåt från sista sidan (nyaste) tills vi når cutoff
  const byClient = new Map<number, { first: string; last: string; count: number }>();
  let invoicesScanned = 0;
  let stopScanning = false;
  // Bryt i parallella 4-page-batches för fart
  for (let page = lastPage; page > 0 && !stopScanning; page -= 4) {
    const pages: number[] = [];
    for (let i = 0; i < 4 && page - i > 0; i++) pages.push(page - i);
    const results = await Promise.all(pages.map((p) => fetchPage(p).catch(() => ({ data: [], last_page: 1 }))));
    for (const r of results) {
      const invoices = r.data || [];
      let pageAllBeforeCutoff = invoices.length > 0;
      for (const inv of invoices) {
        invoicesScanned++;
        if (inv.deleted || inv.credited) continue;
        const cid = inv.client_id ?? inv.client?.id;
        const date: string | undefined = inv.invoice_date;
        if (!cid || !date) continue;
        if (date >= cutoffStr) pageAllBeforeCutoff = false;
        if (date < cutoffStr) continue;
        const existing = byClient.get(cid);
        if (!existing) {
          byClient.set(cid, { first: date, last: date, count: 1 });
        } else {
          if (date < existing.first) existing.first = date;
          if (date > existing.last) existing.last = date;
          existing.count++;
        }
      }
      // Om en hel sida ligger före cutoff är vi färdiga
      if (pageAllBeforeCutoff) stopScanning = true;
    }
  }

  // "Aktiv kund" = fakturerad inom de senaste 90 dagarna
  const activeCutoff = new Date(today.getTime() - 90 * 24 * 3600 * 1000);
  const activeCutoffStr = formatDate(activeCutoff);

  const tenures: number[] = [];
  let oldestMonths = 0;
  for (const [, info] of byClient) {
    if (info.last < activeCutoffStr) continue;
    const firstDate = new Date(info.first);
    const months = monthsBetween(firstDate, today);
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

  return {
    computedAt: today.toISOString(),
    windowMonths,
    source: 'invoices',
    activeCustomers: totalActive,
    averageMonths: Math.round(avg * 10) / 10,
    medianMonths: Math.round(median * 10) / 10,
    buckets: {
      lt3mo: tenures.filter((t) => t < 3).length,
      '3to6mo': tenures.filter((t) => t >= 3 && t < 6).length,
      '6to12mo': tenures.filter((t) => t >= 6 && t < 12).length,
      '1to2yr': tenures.filter((t) => t >= 12 && t < 24).length,
      '2plus': tenures.filter((t) => t >= 24).length,
    },
    oldestKnownMonths: Math.round(oldestMonths * 10) / 10,
    invoicesScanned,
  };
}

function formatDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function monthsBetween(a: Date, b: Date): number {
  const ms = b.getTime() - a.getTime();
  return Math.max(0, ms / (1000 * 60 * 60 * 24 * 30.4375));
}
