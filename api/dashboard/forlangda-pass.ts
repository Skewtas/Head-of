/**
 * Hittar pass som "gradvis förlängts" — återkommande städningar där
 * schemalagda timmar per tillfälle har ökat jämfört med föregående period.
 *
 * Mikaela 2026-10-03: 'ta fram en lista på dom passen som ofta förlängs,
 * det innebär att kollegan efterfrågar mer tid'.
 *
 * Logik:
 *   1. Hämta missioner senaste 30 dagar (aktuell period)
 *   2. Hämta missioner 60-30 dagar bakåt (referens-period)
 *   3. Gruppera per arbetsorder (AO)
 *   4. För AO med ≥2 pass i båda perioderna: jämför snitt-timmar
 *   5. Flagga AO där aktuell-snitt > ref-snitt * 1.15 (minst 15% ökning)
 *      ELLER aktuell-snitt > ref-snitt + 0.5h (minst 30 min ökning)
 *   6. Returnera sorterat på största ökning
 *
 * GET /api/dashboard/forlangda-pass
 * 10 min cache.
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getTimewaveToken } from '../_lib/timewaveAuth.js';
import { prisma } from '../_lib/prisma.js';

export const config = { maxDuration: 60 };

const KEY = 'forlangda_pass_v2';
// Prisökning per pass under denna nivå räknas som "priset har inte justerats"
const PRIS_JUSTERAT_MIN_PROC = 2;
const STALE_SECONDS = 600;

const nonBillableServiceIds = new Set([3, 7, 401]);

interface AoData {
  arbetsorder: number;
  klientNamn: string;
  klientId: number | null;
  tjanst: string;
  antalPass: number;
  totalTimmar: number;
  snittTimmar: number;
  totalRevenue: number;
  snittPris: number;
  stadare: Set<number>;
  stadareNamn: Map<number, string>;
}

function parsePerAO(missioner: any[]): Map<number, AoData> {
  const perAO = new Map<number, AoData>();
  for (const m of missioner) {
    const woId = m.workorder?.id;
    if (!woId) continue;

    let missionRevenue = 0;
    const tjansterLista: string[] = [];
    for (const svc of (m.services || [])) {
      if (nonBillableServiceIds.has(svc.id)) continue;
      const qty = Number(svc.quantity || 0);
      const price = Number(svc.price || 0);
      const discount = Number(svc.discount || 0);
      missionRevenue += qty * price * (1 - discount / 100);
      tjansterLista.push((svc.name || svc.title || `#${svc.id}`).trim());
    }
    if (missionRevenue === 0) continue;

    let missionTimmar = 0;
    const stadareIds: number[] = [];
    const stadareNamn = new Map<number, string>();
    for (const e of (m.employees || [])) {
      if (e.cancelled || !e.starttime || !e.endtime) continue;
      const [sh, sm] = String(e.starttime).split(':').map(Number);
      const [eh, em] = String(e.endtime).split(':').map(Number);
      const h = Math.max(0, ((eh * 60 + em) - (sh * 60 + sm)) / 60);
      if (h > 0 && e.id) {
        missionTimmar += h;
        stadareIds.push(e.id);
        const namn = `${e.first_name || ''} ${e.last_name || ''}`.trim() || e.full_name || e.name || `#${e.id}`;
        stadareNamn.set(e.id, namn);
      }
    }
    if (missionTimmar === 0) continue;

    if (!perAO.has(woId)) {
      perAO.set(woId, {
        arbetsorder: woId,
        klientNamn: m.client?.companyname ||
          `${m.client?.first_name || ''} ${m.client?.last_name || ''}`.trim() ||
          `Kund #${m.client?.id ?? '?'}`,
        klientId: m.client?.id ?? null,
        tjanst: tjansterLista.join(' + '),
        antalPass: 0,
        totalTimmar: 0,
        snittTimmar: 0,
        totalRevenue: 0,
        snittPris: 0,
        stadare: new Set(),
        stadareNamn: new Map(),
      });
    }
    const a = perAO.get(woId)!;
    a.antalPass++;
    a.totalTimmar += missionTimmar;
    a.totalRevenue += missionRevenue;
    for (const id of stadareIds) a.stadare.add(id);
    for (const [id, namn] of stadareNamn) if (!a.stadareNamn.has(id)) a.stadareNamn.set(id, namn);
  }

  for (const a of perAO.values()) {
    a.snittTimmar = a.totalTimmar / a.antalPass;
    a.snittPris = a.totalRevenue / a.antalPass;
  }
  return perAO;
}

export async function hamta(start: string, end: string, token: string): Promise<any[]> {
  const base = 'https://api.timewave.se/v3';
  const out: any[] = [];
  let page = 1;
  while (true) {
    const url = `${base}/missions?filter[startdate]=${start}&filter[enddate]=${end}&page[size]=200&page[number]=${page}`;
    const r = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } });
    if (!r.ok) {
      if (r.status === 429 && page === 1) { await new Promise((res) => setTimeout(res, 2000)); continue; }
      break;
    }
    const j = await r.json() as any;
    const chunk = j?.data || [];
    out.push(...chunk);
    const last = j?.last_page ?? 1;
    if (page >= last || chunk.length === 0) break;
    page++;
    if (page > 50) break;
  }
  return out;
}

export async function beraknaForlangdaPass(forhamtat?: { aktuella: any[]; referens: any[] }) {
  const now = new Date();
  const d30 = new Date(now.getTime() - 30 * 24 * 3600 * 1000);
  const d60 = new Date(now.getTime() - 60 * 24 * 3600 * 1000);
  const ymd = (d: Date) => d.toISOString().slice(0, 10);

  let aktuella: any[];
  let referens: any[];
  if (forhamtat) {
    ({ aktuella, referens } = forhamtat);
  } else {
    const token = await getTimewaveToken();
    [aktuella, referens] = await Promise.all([
      hamta(ymd(d30), ymd(now), token),
      hamta(ymd(d60), ymd(d30), token),
    ]);
  }

  const perAOAktuell = parsePerAO(aktuella);
  const perAORef = parsePerAO(referens);

  // Jämför: AO med ≥2 pass i båda perioder
  const forlangda: Array<{
    arbetsorder: number;
    klientNamn: string;
    klientId: number | null;
    tjanst: string;
    stadare: string[];
    refPass: number;
    refSnittTim: number;
    aktuellPass: number;
    aktuellSnittTim: number;
    diffTim: number;
    diffProc: number;
    extraTimPerManad: number;
    snittPris: number;
    snittKrPerTim: number;
    refSnittPris: number;
    prisDiffKr: number;
    prisDiffProc: number;
    prisJusterat: boolean;
  }> = [];

  for (const [ao, aktuell] of perAOAktuell.entries()) {
    if (aktuell.antalPass < 2) continue;
    const ref = perAORef.get(ao);
    if (!ref || ref.antalPass < 2) continue;

    const diffTim = aktuell.snittTimmar - ref.snittTimmar;
    const diffProc = ref.snittTimmar > 0 ? (diffTim / ref.snittTimmar) * 100 : 0;

    // Flagga om minst 15% ökning ELLER minst 30 min längre pass
    if (diffProc < 15 && diffTim < 0.5) continue;
    // Och faktiskt ökning (inte minskning)
    if (diffTim < 0) continue;

    // Extra timmar per månad = diff per pass × antal pass denna månad
    const extraTimPerManad = diffTim * aktuell.antalPass;

    // Har priset per pass följt med? Under PRIS_JUSTERAT_MIN_PROC räknas som oförändrat.
    const prisDiffKr = aktuell.snittPris - ref.snittPris;
    const prisDiffProc = ref.snittPris > 0 ? (prisDiffKr / ref.snittPris) * 100 : 0;

    forlangda.push({
      arbetsorder: ao,
      klientNamn: aktuell.klientNamn,
      klientId: aktuell.klientId,
      tjanst: aktuell.tjanst,
      stadare: [...aktuell.stadareNamn.values()],
      refPass: ref.antalPass,
      refSnittTim: Math.round(ref.snittTimmar * 10) / 10,
      aktuellPass: aktuell.antalPass,
      aktuellSnittTim: Math.round(aktuell.snittTimmar * 10) / 10,
      diffTim: Math.round(diffTim * 10) / 10,
      diffProc: Math.round(diffProc),
      extraTimPerManad: Math.round(extraTimPerManad * 10) / 10,
      snittPris: Math.round(aktuell.snittPris),
      snittKrPerTim: aktuell.totalTimmar > 0 ? Math.round(aktuell.totalRevenue / aktuell.totalTimmar) : 0,
      refSnittPris: Math.round(ref.snittPris),
      prisDiffKr: Math.round(prisDiffKr),
      prisDiffProc: Math.round(prisDiffProc),
      prisJusterat: prisDiffProc >= PRIS_JUSTERAT_MIN_PROC,
    });
  }

  forlangda.sort((a, b) => b.extraTimPerManad - a.extraTimPerManad);

  const utanPrisjustering = forlangda.filter((f) => !f.prisJusterat);
  const totalExtraTim = forlangda.reduce((n, f) => n + f.extraTimPerManad, 0);
  const totalForloradInkomst = Math.round(
    forlangda.reduce((n, f) => n + f.extraTimPerManad * (550 - f.snittKrPerTim), 0)
  );

  const payload = {
    aktuellPeriod: `${ymd(d30)} → ${ymd(now)}`,
    refPeriod: `${ymd(d60)} → ${ymd(d30)}`,
    antalForlangda: forlangda.length,
    totalExtraTimPerManad: Math.round(totalExtraTim * 10) / 10,
    totalForloradInkomst,
    forlangda: forlangda.slice(0, 30),
    // Förlängda pass där priset per pass INTE höjts — kräver kundens godkännande
    utanPrisjustering,
    antalUtanPrisjustering: utanPrisjustering.length,
    extraTimUtanPrisjustering: Math.round(utanPrisjustering.reduce((n, f) => n + f.extraTimPerManad, 0) * 10) / 10,
    computedAt: new Date().toISOString(),
  };
  return payload;
}

export interface EnskiltForlangtPass {
  missionId: number;
  arbetsorder: number;
  klientNamn: string;
  tjanst: string;
  datum: string;
  stadare: string[];
  vanligTim: number;      // median schemalagd tid på arbetsorderns tidigare pass
  passTim: number;
  extraTim: number;
  vanligtPris: number;    // medianpris på tidigare pass
  passPris: number;
  kommentarer: string[];  // städarnas kommentarer på tidsavvikelser
  nytt: boolean;          // passet låg inom de senaste 7 dagarna
}

const median = (a: number[]): number => {
  const s = [...a].sort((x, y) => x - y);
  const n = s.length;
  return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
};

/**
 * Enskilda pass som blivit längre än arbetsorderns vanliga tid utan att priset
 * ändrats. Fångar även jobb som bara har ett pass i månaden och engångs-
 * förlängningar som inte syns i periodsnittet ovan.
 *
 *   historik = pass FÖRE de senaste 30 dagarna (baslinje, minst 2 pass krävs)
 *   aktuella = pass de senaste 30 dagarna
 * Flaggas: minst 30 min eller 15 % längre än medianen, och pris ≤ medianpris + 2 %.
 */
export function beraknaEnskildaForlangdaPass(aktuella: any[], historik: any[], now = new Date()): EnskiltForlangtPass[] {
  const ymd = (d: Date) => d.toISOString().slice(0, 10);
  const idag = ymd(now);
  const d30 = ymd(new Date(now.getTime() - 30 * 24 * 3600 * 1000));
  const d7 = ymd(new Date(now.getTime() - 7 * 24 * 3600 * 1000));

  interface Pass { missionId: number; datum: string; tim: number; pris: number; tjanst: string; stadare: string[]; kommentarer: string[]; }
  const perAO = new Map<number, { klientNamn: string; pass: Pass[] }>();
  const sedda = new Set<number>();

  for (const m of [...aktuella, ...historik]) {
    const woId = m.workorder?.id;
    if (!woId || sedda.has(m.id)) continue;
    sedda.add(m.id);

    let pris = 0;
    const tjanster: string[] = [];
    for (const svc of (m.services || [])) {
      if (nonBillableServiceIds.has(svc.id)) continue;
      pris += Number(svc.quantity || 0) * Number(svc.price || 0) * (1 - Number(svc.discount || 0) / 100);
      tjanster.push((svc.name || svc.title || `#${svc.id}`).trim());
    }
    if (pris === 0) continue;

    let tim = 0;
    let datum: string | null = null;
    const stadare: string[] = [];
    const kommentarer: string[] = [];
    for (const e of (m.employees || [])) {
      if (e.cancelled || !e.starttime || !e.endtime) continue;
      const [sh, sm] = String(e.starttime).split(':').map(Number);
      const [eh, em] = String(e.endtime).split(':').map(Number);
      const h = Math.max(0, ((eh * 60 + em) - (sh * 60 + sm)) / 60);
      if (h <= 0) continue;
      tim += h;
      const namn = `${e.first_name || ''} ${e.last_name || ''}`.trim() || e.full_name || e.name || `#${e.id}`;
      stadare.push(namn);
      const d = String(e.startdate || '').slice(0, 10);
      if (d && (!datum || d < datum)) datum = d;
      // Tidsavvikelser kan vara ett objekt eller en lista. Kommentarer med koder tas inte med.
      const avv = Array.isArray(e.deviations) ? e.deviations : (e.deviations?.id ? [e.deviations] : []);
      for (const a of avv) {
        const k = String(a.comment || '').trim();
        if (k && !/kod|code/i.test(k)) kommentarer.push(`${namn}: ${k}`);
      }
    }
    if (tim === 0 || !datum) continue;

    if (!perAO.has(woId)) {
      perAO.set(woId, {
        klientNamn: m.client?.companyname ||
          `${m.client?.first_name || ''} ${m.client?.last_name || ''}`.trim() ||
          `Kund #${m.client?.id ?? '?'}`,
        pass: [],
      });
    }
    perAO.get(woId)!.pass.push({ missionId: m.id, datum, tim, pris, tjanst: tjanster.join(' + '), stadare, kommentarer });
  }

  const ut: EnskiltForlangtPass[] = [];
  for (const [ao, a] of perAO.entries()) {
    const bas = a.pass.filter((p) => p.datum < d30);
    const nu = a.pass.filter((p) => p.datum >= d30 && p.datum <= idag);
    if (bas.length < 2 || nu.length === 0) continue;
    const vanligTim = median(bas.map((p) => p.tim));
    const vanligtPris = median(bas.map((p) => p.pris));
    for (const p of nu) {
      const extra = p.tim - vanligTim;
      if (extra <= 0) continue;
      if (extra < 0.5 && extra / vanligTim < 0.15) continue;
      if (p.pris > vanligtPris * (1 + PRIS_JUSTERAT_MIN_PROC / 100)) continue;
      ut.push({
        missionId: p.missionId,
        arbetsorder: ao,
        klientNamn: a.klientNamn,
        tjanst: p.tjanst,
        datum: p.datum,
        stadare: p.stadare,
        vanligTim: Math.round(vanligTim * 10) / 10,
        passTim: Math.round(p.tim * 10) / 10,
        extraTim: Math.round(extra * 10) / 10,
        vanligtPris: Math.round(vanligtPris),
        passPris: Math.round(p.pris),
        kommentarer: p.kommentarer,
        nytt: p.datum >= d7,
      });
    }
  }
  return ut.sort((x, y) => (x.datum < y.datum ? 1 : x.datum > y.datum ? -1 : y.extraTim - x.extraTim));
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
    const payload = await beraknaForlangdaPass();

    await prisma.dashboardSnapshot.upsert({
      where: { key: KEY },
      create: { key: KEY, data: payload as any, computedAt: new Date() },
      update: { data: payload as any, computedAt: new Date() },
    });
    res.setHeader('Cache-Control', 'private, max-age=60');
    res.json(payload);
  } catch (err: any) {
    console.error('[forlangda-pass]', err?.message);
    res.status(500).json({ error: err?.message || 'failed' });
  }
}
