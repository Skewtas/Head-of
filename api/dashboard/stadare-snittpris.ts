/**
 * Städar-snittpris-analys: för varje aktiv städare, aggregera över senaste
 * N dagar: antal missioner de varit med på, total arbetstid, total intäkt
 * på de missionerna, snitt kr/h.
 *
 * Städare som systematiskt är med på missioner med lågt snitt är ofta en
 * signal om EN av tre saker:
 *   1. De schemaläggs ofta på pass med dåligt pris (teamleader-fråga)
 *   2. De stämplar/schemaläggs för mycket tid relative till bokningen
 *   3. De städar lugnt och säkert i senior tempo (positivt för kvalitet,
 *      inte något att åtgärda)
 *
 * GET /api/dashboard/stadare-snittpris?days=30
 * Returnerar lista sorterad på LÄGST snitt kr/h.
 * 5 min cache.
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getTimewaveToken } from '../_lib/timewaveAuth.js';
import { prisma } from '../_lib/prisma.js';

export const config = { maxDuration: 60 };

const KEY_PREFIX = 'stadare_snittpris_v1';
const STALE_SECONDS = 300;

const nonBillableServiceIds = new Set([3, 7, 401]);

async function berakna(days: number) {
  const now = new Date();
  const start = new Date(now.getTime() - days * 24 * 3600 * 1000);
  const startStr = start.toISOString().slice(0, 10);
  const endStr = now.toISOString().slice(0, 10);

  const token = await getTimewaveToken();
  const base = 'https://api.timewave.se/v3';

  const missioner: any[] = [];
  let page = 1;
  while (true) {
    const url = `${base}/missions?filter[startdate]=${startStr}&filter[enddate]=${endStr}&page[size]=200&page[number]=${page}`;
    const r = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } });
    if (!r.ok) {
      if (r.status === 429 && page === 1) { await new Promise((res) => setTimeout(res, 2000)); continue; }
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

  // Per städare: aggregera
  const perStadare = new Map<number, {
    employeeId: number;
    namn: string;
    missioner: Set<number>;
    totalTimmar: number;
    totalRevenueDel: number;  // städarens andel av missionens revenue
    laga: number;             // antal pass med < 300 kr/h (per manna)
  }>();

  for (const m of missioner) {
    // Mission-level revenue
    let missionRevenue = 0;
    for (const svc of (m.services || [])) {
      if (nonBillableServiceIds.has(svc.id)) continue;
      const qty = Number(svc.quantity || 0);
      const price = Number(svc.price || 0);
      const discount = Number(svc.discount || 0);
      missionRevenue += qty * price * (1 - discount / 100);
    }
    if (missionRevenue === 0) continue;

    // Räkna aktiva städare på missionen + varje stdares tid
    const aktiva = (m.employees || []).filter((e: any) =>
      !e.cancelled && e.starttime && e.endtime
    );
    if (aktiva.length === 0) continue;

    let missionTotalTimmar = 0;
    const stadareTimmar = new Map<number, number>();
    for (const e of aktiva) {
      const [sh, sm] = String(e.starttime).split(':').map(Number);
      const [eh, em] = String(e.endtime).split(':').map(Number);
      const h = Math.max(0, ((eh * 60 + em) - (sh * 60 + sm)) / 60);
      if (h > 0 && e.id) {
        stadareTimmar.set(e.id, (stadareTimmar.get(e.id) || 0) + h);
        missionTotalTimmar += h;
      }
    }
    if (missionTotalTimmar === 0) continue;

    const missionSnitt = missionRevenue / missionTotalTimmar;

    // Fördela missionens revenue proportionellt över städarnas timmar
    for (const [empId, h] of stadareTimmar.entries()) {
      const andel = h / missionTotalTimmar;
      const empRevDel = missionRevenue * andel;

      if (!perStadare.has(empId)) {
        // Hämta namn via emp-attribut i mission (first_name/last_name om tillgängligt)
        const empObj = aktiva.find((e: any) => e.id === empId);
        const namn = empObj
          ? `${empObj.first_name || ''} ${empObj.last_name || ''}`.trim() || empObj.full_name || empObj.name || `#${empId}`
          : `#${empId}`;
        perStadare.set(empId, {
          employeeId: empId,
          namn,
          missioner: new Set(),
          totalTimmar: 0,
          totalRevenueDel: 0,
          laga: 0,
        });
      }
      const s = perStadare.get(empId)!;
      s.missioner.add(m.id);
      s.totalTimmar += h;
      s.totalRevenueDel += empRevDel;
      if (missionSnitt < 300) s.laga++;
    }
  }

  const rader = [...perStadare.values()]
    .filter((s) => s.missioner.size >= 3 && s.totalTimmar > 1)
    .map((s) => ({
      employeeId: s.employeeId,
      namn: s.namn,
      antalMissioner: s.missioner.size,
      totalTimmar: Math.round(s.totalTimmar * 10) / 10,
      totalRevenue: Math.round(s.totalRevenueDel),
      snittKrPerTim: Math.round(s.totalRevenueDel / s.totalTimmar),
      antalLagaPass: s.laga,
      andelLagaProc: s.missioner.size > 0 ? Math.round((s.laga / s.missioner.size) * 100) : 0,
    }));

  const sorteratLagsta = [...rader].sort((a, b) => a.snittKrPerTim - b.snittKrPerTim);
  const sorteratHogsta = [...rader].sort((a, b) => b.snittKrPerTim - a.snittKrPerTim);

  return {
    period: `${startStr} → ${endStr}`,
    antalStadare: rader.length,
    antalMissionerScannade: missioner.length,
    bottom20: sorteratLagsta.slice(0, 20),
    top20: sorteratHogsta.slice(0, 20),
    computedAt: new Date().toISOString(),
  };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const days = Math.max(7, Math.min(90, Number(req.query.days) || 30));
  const key = `${KEY_PREFIX}:${days}`;
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
    const payload = await berakna(days);
    await prisma.dashboardSnapshot.upsert({
      where: { key },
      create: { key, data: payload as any, computedAt: new Date() },
      update: { data: payload as any, computedAt: new Date() },
    });
    res.setHeader('Cache-Control', 'private, max-age=60');
    res.json(payload);
  } catch (err: any) {
    console.error('[stadare-snittpris]', err?.message);
    res.status(500).json({ error: err?.message || 'failed' });
  }
}
