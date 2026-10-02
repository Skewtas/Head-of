/**
 * Snittpris per kund — listar kunder sorterade efter LÄGST snittpris.
 *
 * Så du ser direkt vilka avtal som drar ner snittet mest — kandidater för
 * prisindexering, omförhandling eller fakturerings-check (städare kanske
 * jobbar längre än debiterat).
 *
 * Formel: totalt revenue på kundens missioner / totalt faktiskt städade timmar
 * (= summa av anställdas endtime - starttime, ej cancelled).
 *
 * GET /api/dashboard/snittpris-per-kund?month=YYYY-MM&min=3
 *   month = månad, default innevarande
 *   min   = minsta antal missioner för att komma med (default 2, så vi inte
 *           flaggar engångs-rabatter)
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getTimewaveToken } from '../_lib/timewaveAuth.js';
import { prisma } from '../_lib/prisma.js';

export const config = { maxDuration: 60 };

const KEY_PREFIX = 'snittpris_per_kund_v1';
const STALE_SECONDS = 300;

const nonBillableServiceIds = new Set([3, 7, 401]);

interface KundRad {
  klientId: number;
  klientNamn: string;
  typ: 'företag' | 'privat' | 'okänd';
  antalMissioner: number;
  totalRevenue: number;
  totalTimmar: number;
  snittKrPerTim: number;
  snittPrisPerMission: number;
  tjansterSnabb: string; // kort sammanfattning
}

async function berakna(month: string, minMissioner: number): Promise<any> {
  const [year, m] = month.split('-').map(Number);
  const monthStart = `${month}-01`;
  const nextMonth = new Date(year, m, 1);
  const monthEnd = new Date(nextMonth.getTime() - 24 * 3600 * 1000)
    .toISOString().slice(0, 10);

  const token = await getTimewaveToken();
  const base = 'https://api.timewave.se/v3';

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

  const perKund = new Map<number, {
    klientId: number;
    klientNamn: string;
    typ: 'företag' | 'privat' | 'okänd';
    missioner: Set<number>;
    totalRevenue: number;
    totalTimmar: number;
    tjanster: Map<string, number>;
  }>();

  for (const m of missioner) {
    if (!m.client?.id) continue;

    let missionRevenue = 0;
    const tjansterIMission: string[] = [];
    for (const svc of (m.services || [])) {
      if (nonBillableServiceIds.has(svc.id)) continue;
      const qty = Number(svc.quantity || 0);
      const price = Number(svc.price || 0);
      const discount = Number(svc.discount || 0);
      const rev = qty * price * (1 - discount / 100);
      if (rev === 0) continue;
      missionRevenue += rev;
      tjansterIMission.push((svc.name || svc.title || `#${svc.id}`).trim());
    }
    if (missionRevenue === 0) continue;

    let missionTimmar = 0;
    for (const e of (m.employees || [])) {
      if (e.starttime && e.endtime && !e.cancelled) {
        const [sh, sm] = String(e.starttime).split(':').map(Number);
        const [eh, em] = String(e.endtime).split(':').map(Number);
        missionTimmar += Math.max(0, ((eh * 60 + em) - (sh * 60 + sm)) / 60);
      }
    }

    const klientNamn = m.client.companyname ||
      `${m.client.first_name || ''} ${m.client.last_name || ''}`.trim() ||
      `Kund #${m.client.id}`;
    const typ: KundRad['typ'] = m.client.companyname ? 'företag' :
      (m.client.type === 1 ? 'privat' : 'okänd');

    if (!perKund.has(m.client.id)) {
      perKund.set(m.client.id, {
        klientId: m.client.id,
        klientNamn,
        typ,
        missioner: new Set(),
        totalRevenue: 0,
        totalTimmar: 0,
        tjanster: new Map(),
      });
    }
    const rad = perKund.get(m.client.id)!;
    rad.missioner.add(m.id);
    rad.totalRevenue += missionRevenue;
    rad.totalTimmar += missionTimmar;
    for (const tj of tjansterIMission) {
      rad.tjanster.set(tj, (rad.tjanster.get(tj) || 0) + 1);
    }
  }

  const rader: KundRad[] = [...perKund.values()]
    .filter((r) => r.totalTimmar > 0.1 && r.missioner.size >= minMissioner)
    .map((r) => ({
      klientId: r.klientId,
      klientNamn: r.klientNamn,
      typ: r.typ,
      antalMissioner: r.missioner.size,
      totalRevenue: Math.round(r.totalRevenue),
      totalTimmar: Math.round(r.totalTimmar * 10) / 10,
      snittKrPerTim: Math.round(r.totalRevenue / r.totalTimmar),
      snittPrisPerMission: Math.round(r.totalRevenue / r.missioner.size),
      tjansterSnabb: [...r.tjanster.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 2)
        .map(([t, n]) => `${t} (${n})`)
        .join(', '),
    }))
    .sort((a, b) => a.snittKrPerTim - b.snittKrPerTim);

  return {
    period: month,
    fonster: `${monthStart} → ${monthEnd}`,
    antalKunder: rader.length,
    minMissionerFiltrera: minMissioner,
    lagsta20: rader.slice(0, 20),
    highest20: [...rader].sort((a, b) => b.snittKrPerTim - a.snittKrPerTim).slice(0, 20),
    computedAt: new Date().toISOString(),
  };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const nowStr = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Europe/Stockholm', year: 'numeric', month: '2-digit',
  }).format(new Date());
  const month = typeof req.query.month === 'string' && /^\d{4}-\d{2}$/.test(req.query.month)
    ? req.query.month : nowStr;
  const min = Math.max(1, Math.min(50, Number(req.query.min) || 2));
  const key = `${KEY_PREFIX}:${month}:${min}`;
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
    const payload = await berakna(month, min);
    await prisma.dashboardSnapshot.upsert({
      where: { key },
      create: { key, data: payload as any, computedAt: new Date() },
      update: { data: payload as any, computedAt: new Date() },
    });
    res.setHeader('Cache-Control', 'private, max-age=60');
    res.json(payload);
  } catch (err: any) {
    console.error('[snittpris-per-kund]', err?.message);
    res.status(500).json({ error: err?.message || 'failed' });
  }
}
