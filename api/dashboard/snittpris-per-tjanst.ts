/**
 * Snittpris per tjänstetyp — så du ser vilken tjänst som drar ned snittet
 * mest och var det finns utrymme att höja.
 *
 * Grupperar innevarande månads missioner per service-namn:
 *   - total revenue (qty × price × (1-discount), exklusive sjuk/ledig)
 *   - total arbetstimmar (summa anställdas starttime→endtime)
 *   - snittpris = revenue / timmar
 *   - antal missioner
 *
 * GET /api/dashboard/snittpris-per-tjanst?month=YYYY-MM
 * Standard: innevarande månad. 60 sek cache.
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getTimewaveToken } from '../_lib/timewaveAuth.js';
import { arUndantagenFranSnittpris } from '../_lib/snittprisUndantag.js';
import { prisma } from '../_lib/prisma.js';

export const config = { maxDuration: 60 };

const KEY_PREFIX = 'snittpris_per_tjanst_v2';
const STALE_SECONDS = 300; // 5 min — månadsdata ändras långsamt

const nonBillableServiceIds = new Set([3, 7, 401]); // sjuk, ledig, ej-fakturerbar
// Dessa drar ned snittet artificiellt (de är tillägg utan egna timmar) —
// håll dem SEPARAT istället för att blanda in i snittet för huvudtjänsten
const addOnServiceIds = new Set([104, 108, 128, 276, 336, 423]);

interface TjansteRad {
  tjanst: string;
  antalMissioner: number;
  totalRevenue: number;
  totalTimmar: number;
  snittKrPerTim: number | null;
  snittPrisPerMission: number;
}

async function berakna(month: string) {
  const [year, m] = month.split('-').map(Number);
  const monthStart = `${month}-01`;
  const nextMonth = new Date(year, m, 1);
  const monthEnd = new Date(nextMonth.getTime() - 24 * 3600 * 1000)
    .toISOString().slice(0, 10);

  const token = await getTimewaveToken();
  const base = 'https://api.timewave.se/v3';

  // Hämta alla missioner för månaden (paginerat)
  const missioner: any[] = [];
  let page = 1;
  while (true) {
    const url = `${base}/missions?filter[startdate]=${monthStart}&filter[enddate]=${monthEnd}&page[size]=200&page[number]=${page}`;
    const r = await fetch(url, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    });
    if (!r.ok) {
      if (r.status === 429 && page === 1) {
        await new Promise((res) => setTimeout(res, 2000));
        continue;
      }
      break;
    }
    const j = await r.json() as any;
    const chunk = j?.data || [];
    missioner.push(...chunk);
    const last = j?.last_page ?? 1;
    if (page >= last || chunk.length === 0) break;
    page++;
    if (page > 50) break;
  }

  const perTjanst = new Map<string, {
    tjanst: string;
    antalMissioner: Set<number>;
    totalRevenue: number;
    totalTimmar: number;
  }>();
  const addOns = new Map<string, { tjanst: string; antalMissioner: Set<number>; totalRevenue: number }>();

  let totalRevenueAll = 0;
  let totalTimmarAll = 0;

  for (const m of missioner) {
    if (arUndantagenFranSnittpris(m)) continue;
    const services = m.services || [];

    // Räkna missionens arbetstimmar en gång (summera alla anställda som faktiskt städat)
    let missionTimmar = 0;
    for (const e of (m.employees || [])) {
      if (e.starttime && e.endtime && !e.cancelled) {
        const [sh, sm] = String(e.starttime).split(':').map(Number);
        const [eh, em] = String(e.endtime).split(':').map(Number);
        missionTimmar += Math.max(0, ((eh * 60 + em) - (sh * 60 + sm)) / 60);
      }
    }

    // Hitta HUVUDTJÄNSTEN — den fakturerbara service som INTE är tillägg
    const huvudtjanster = services.filter((s: any) =>
      !nonBillableServiceIds.has(s.id) && !addOnServiceIds.has(s.id)
    );
    const tillagg = services.filter((s: any) =>
      !nonBillableServiceIds.has(s.id) && addOnServiceIds.has(s.id)
    );

    // Räkna revenue per tjänstetyp. Tillämpa missionens timmar bara på
    // huvudtjänsten (annars dubbelräknar vi timmar om vi har 3 add-ons).
    for (const svc of huvudtjanster) {
      const qty = Number(svc.quantity || 0);
      const price = Number(svc.price || 0);
      const discount = Number(svc.discount || 0);
      const rev = qty * price * (1 - discount / 100);
      if (rev === 0) continue;

      const namn = (svc.name || svc.title || `Service ${svc.id}`).trim();
      // Dela timmar proportionellt om det finns flera huvudtjänster per mission
      const timmarKvot = huvudtjanster.length > 0 ? missionTimmar / huvudtjanster.length : 0;

      if (!perTjanst.has(namn)) {
        perTjanst.set(namn, { tjanst: namn, antalMissioner: new Set(), totalRevenue: 0, totalTimmar: 0 });
      }
      const rad = perTjanst.get(namn)!;
      rad.antalMissioner.add(m.id);
      rad.totalRevenue += rev;
      rad.totalTimmar += timmarKvot;

      totalRevenueAll += rev;
      totalTimmarAll += timmarKvot;
    }

    // Tillägg — grupperade separat så de syns men inte dränker huvudtjänsterna
    for (const svc of tillagg) {
      const qty = Number(svc.quantity || 0);
      const price = Number(svc.price || 0);
      const discount = Number(svc.discount || 0);
      const rev = qty * price * (1 - discount / 100);
      if (rev === 0) continue;
      const namn = (svc.name || svc.title || `Service ${svc.id}`).trim();
      if (!addOns.has(namn)) addOns.set(namn, { tjanst: namn, antalMissioner: new Set(), totalRevenue: 0 });
      const rad = addOns.get(namn)!;
      rad.antalMissioner.add(m.id);
      rad.totalRevenue += rev;
    }
  }

  const rader: TjansteRad[] = [...perTjanst.values()]
    .map((r) => ({
      tjanst: r.tjanst,
      antalMissioner: r.antalMissioner.size,
      totalRevenue: Math.round(r.totalRevenue),
      totalTimmar: Math.round(r.totalTimmar * 10) / 10,
      snittKrPerTim: r.totalTimmar > 0 ? Math.round(r.totalRevenue / r.totalTimmar) : null,
      snittPrisPerMission: r.antalMissioner.size > 0 ? Math.round(r.totalRevenue / r.antalMissioner.size) : 0,
    }))
    .sort((a, b) => b.totalRevenue - a.totalRevenue);

  const tillaggRader = [...addOns.values()]
    .map((r) => ({
      tjanst: r.tjanst,
      antalMissioner: r.antalMissioner.size,
      totalRevenue: Math.round(r.totalRevenue),
    }))
    .sort((a, b) => b.totalRevenue - a.totalRevenue);

  return {
    period: month,
    fonster: `${monthStart} → ${monthEnd}`,
    antalMissioner: missioner.length,
    totalSnittKrPerTim: totalTimmarAll > 0 ? Math.round(totalRevenueAll / totalTimmarAll) : null,
    totalRevenue: Math.round(totalRevenueAll),
    totalTimmar: Math.round(totalTimmarAll * 10) / 10,
    huvudtjanster: rader,
    tillagg: tillaggRader,
    computedAt: new Date().toISOString(),
  };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const nowStr = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Europe/Stockholm', year: 'numeric', month: '2-digit',
  }).format(new Date());
  const month = typeof req.query.month === 'string' && /^\d{4}-\d{2}$/.test(req.query.month)
    ? req.query.month : nowStr;
  const key = `${KEY_PREFIX}:${month}`;
  const force = req.query.refresh === '1';

  if (!force) {
    const snap = await prisma.dashboardSnapshot.findUnique({ where: { key } });
    if (snap && snap.data) {
      const ageMs = Date.now() - snap.computedAt.getTime();
      if (ageMs < STALE_SECONDS * 1000) {
        return res.json({ ...(snap.data as any), cached: true, ageSeconds: Math.round(ageMs / 1000) });
      }
    }
  }

  try {
    const payload = await berakna(month);
    await prisma.dashboardSnapshot.upsert({
      where: { key },
      create: { key, data: payload as any, computedAt: new Date() },
      update: { data: payload as any, computedAt: new Date() },
    });
    res.setHeader('Cache-Control', 'private, max-age=60');
    res.json(payload);
  } catch (err: any) {
    console.error('[snittpris-per-tjanst]', err?.message);
    res.status(500).json({ error: err?.message || 'failed' });
  }
}
