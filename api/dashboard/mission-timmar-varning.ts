/**
 * Varnar när för många städ-timmar schemalagts på en mission i förhållande
 * till vad kunden betalar.
 *
 * Logik: för varje mission denna + nästa vecka, räkna
 *   schemalagda timmar = summa av anställdas starttime→endtime (ej cancelled)
 *   effektivtPris = missionRevenue / schemalagda timmar
 * Om effektivtPris < THRESHOLD → flagga.
 *
 * Default THRESHOLD = 400 kr/h (räknar bort RUT-effekten konservativt).
 *
 * GET /api/dashboard/mission-timmar-varning?threshold=400&weeks=2
 * Returnerar lista sorterad på LÄGST kr/h först.
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getTimewaveToken } from '../_lib/timewaveAuth.js';
import { prisma } from '../_lib/prisma.js';

export const config = { maxDuration: 60 };

const KEY_PREFIX = 'mission_timmar_varning_v1';
const STALE_SECONDS = 300;

const nonBillableServiceIds = new Set([3, 7, 401]);

interface Varning {
  missionId: number;
  arbetsorder: number | null;
  klientNamn: string;
  klientId: number | null;
  datum: string | null;
  tjanst: string;
  revenue: number;
  schemaladaTimmar: number;
  antalStadare: number;
  effektivtPris: number;
  overskott: number; // kr som "försvinner" jmf tröskel
}

async function berakna(threshold: number, weeks: number): Promise<any> {
  const now = new Date();
  const startDate = now.toISOString().slice(0, 10);
  const end = new Date(now.getTime() + weeks * 7 * 24 * 3600 * 1000);
  const endDate = end.toISOString().slice(0, 10);

  const token = await getTimewaveToken();
  const base = 'https://api.timewave.se/v3';

  const missioner: any[] = [];
  let page = 1;
  while (true) {
    const url = `${base}/missions?filter[startdate]=${startDate}&filter[enddate]=${endDate}&page[size]=200&page[number]=${page}`;
    const r = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } });
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

  const varningar: Varning[] = [];

  for (const m of missioner) {
    // Revenue
    let revenue = 0;
    const tjanstnamnLista: string[] = [];
    for (const svc of (m.services || [])) {
      if (nonBillableServiceIds.has(svc.id)) continue;
      const qty = Number(svc.quantity || 0);
      const price = Number(svc.price || 0);
      const discount = Number(svc.discount || 0);
      revenue += qty * price * (1 - discount / 100);
      if (!nonBillableServiceIds.has(svc.id)) {
        tjanstnamnLista.push((svc.name || svc.title || `#${svc.id}`).trim());
      }
    }
    if (revenue <= 0) continue;

    // Schemalagda timmar
    let timmar = 0;
    let antalStadare = 0;
    for (const e of (m.employees || [])) {
      if (e.cancelled) continue;
      if (!e.starttime || !e.endtime) continue;
      const [sh, sm] = String(e.starttime).split(':').map(Number);
      const [eh, em] = String(e.endtime).split(':').map(Number);
      const h = Math.max(0, ((eh * 60 + em) - (sh * 60 + sm)) / 60);
      if (h > 0) {
        timmar += h;
        antalStadare++;
      }
    }
    if (timmar <= 0) continue;

    const effektivtPris = revenue / timmar;
    if (effektivtPris >= threshold) continue;

    const overskott = Math.round(timmar * threshold - revenue);
    varningar.push({
      missionId: m.id,
      arbetsorder: m.workorder?.id ?? null,
      klientNamn: m.client?.companyname ||
        `${m.client?.first_name || ''} ${m.client?.last_name || ''}`.trim() ||
        `Kund #${m.client?.id ?? '?'}`,
      klientId: m.client?.id ?? null,
      datum: (m.startdate || m.date || null)?.slice(0, 10) || null,
      tjanst: tjanstnamnLista.join(' + ') || 'okänd tjänst',
      revenue: Math.round(revenue),
      schemaladaTimmar: Math.round(timmar * 10) / 10,
      antalStadare,
      effektivtPris: Math.round(effektivtPris),
      overskott,
    });
  }

  varningar.sort((a, b) => a.effektivtPris - b.effektivtPris);

  const totalOverskott = varningar.reduce((n, v) => n + v.overskott, 0);
  return {
    period: `${startDate} → ${endDate}`,
    threshold,
    antalScannade: missioner.length,
    antalVarningar: varningar.length,
    totalOverskott,
    varningar: varningar.slice(0, 30),
    computedAt: new Date().toISOString(),
  };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const threshold = Math.max(100, Math.min(1000, Number(req.query.threshold) || 400));
  const weeks = Math.max(1, Math.min(8, Number(req.query.weeks) || 2));
  const key = `${KEY_PREFIX}:${threshold}:${weeks}`;
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
    const payload = await berakna(threshold, weeks);
    await prisma.dashboardSnapshot.upsert({
      where: { key },
      create: { key, data: payload as any, computedAt: new Date() },
      update: { data: payload as any, computedAt: new Date() },
    });
    res.setHeader('Cache-Control', 'private, max-age=60');
    res.json(payload);
  } catch (err: any) {
    console.error('[mission-timmar-varning]', err?.message);
    res.status(500).json({ error: err?.message || 'failed' });
  }
}
