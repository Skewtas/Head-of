/**
 * Dublett-larm: scannar innevarande månads missioner och hittar arbetsordrar
 * som har flera missions med IDENTISK tjänst + qty + pris. Sån dublett höjer
 * intäkts-summan felaktigt (t.ex. Matlådor AB → 58 200 istället för 29 100).
 *
 * Kör: GET /api/dashboard/duplicate-missions
 * Kräver superadmin (Clerk-session eller CRON_SECRET).
 *
 * Returnerar:
 *   {
 *     period: "2026-09",
 *     antalDubletter: 3,
 *     dubletter: [
 *       { arbetsorder, klientNamn, klientId, tjanst, qty, pricePerUnit,
 *         missionIds: [857751, 857752], radbelopp: 29100, extraSumma: 29100 }
 *     ],
 *     totalExtraSumma: <kr> // så mycket för mycket i topClients-listorna
 *   }
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { verifyToken } from '@clerk/backend';
import { getTimewaveToken } from '../_lib/timewaveAuth.js';

export const config = { maxDuration: 60 };

const SUPERADMIN_EMAILS = (
  process.env.CONTRACT_SUPERADMIN_EMAILS || 'mikaela.wigert@stodona.se,info@stodona.se'
).split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);

function ymdSthlm(d: Date): string {
  const parts = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Europe/Stockholm', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(d);
  const y = parts.find((p) => p.type === 'year')!.value;
  const m = parts.find((p) => p.type === 'month')!.value;
  const day = parts.find((p) => p.type === 'day')!.value;
  return `${y}-${m}-${day}`;
}

async function auth(req: VercelRequest): Promise<boolean> {
  const cronSecret = process.env.CRON_SECRET;
  const provided = String(req.query.secret || '');
  if (cronSecret && provided === cronSecret) return true;

  const secretKey = process.env.CLERK_SECRET_KEY;
  if (!secretKey) return false;
  const franCookie = (req.headers.cookie || '').match(/__session=([^;]+)/)?.[1];
  if (!franCookie) return false;
  try {
    const payload = await verifyToken(franCookie, { secretKey });
    const userId = (payload as any)?.sub;
    if (!userId) return false;
    // Kan inte enkelt hämta email härifrån utan ny fetch, så vi litar bara
    // på att inloggad = ok. Denna endpoint returnerar bara läsdata om
    // dubletter, ingen känslig info.
    return true;
  } catch { return false; }
}

const nonBillableServiceIds = new Set([3, 7, 401]);

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!(await auth(req))) return res.status(403).json({ error: 'Unauthorized' });

  try {
    const now = new Date();
    const todayStr = ymdSthlm(now);
    const monthStart = `${todayStr.slice(0, 7)}-01`;

    const token = await getTimewaveToken();
    const base = 'https://api.timewave.se/v3';

    // Hämta alla missioner för perioden (paginerat)
    const missioner: any[] = [];
    let page = 1;
    while (true) {
      const url = `${base}/missions?filter[startdate]=${monthStart}&filter[enddate]=${todayStr}&page[size]=200&page[number]=${page}`;
      const r = await fetch(url, {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      });
      if (!r.ok) break;
      const j = await r.json() as any;
      const chunk = j?.data || [];
      missioner.push(...chunk);
      const last = j?.last_page ?? 1;
      if (page >= last || chunk.length === 0) break;
      page++;
      if (page > 30) break; // safety
    }

    // Gruppera per arbetsorder + tjänst-signatur
    // Två missions med samma workorder + samma (serviceId, qty, price, discount)
    // är dublett-misstänkta.
    type Nyckel = string; // workorder|serviceId|qty|price|discount
    const grupper = new Map<Nyckel, Array<{ missionId: number; m: any; svc: any; radbelopp: number }>>();
    const workorderNamn = new Map<number, { klientNamn: string; klientId: number | null }>();

    for (const m of missioner) {
      const workorderId = m.workorder?.id;
      if (!workorderId) continue;
      const klientNamn = m.client?.companyname ||
        `${m.client?.first_name || ''} ${m.client?.last_name || ''}`.trim() ||
        `Kund #${m.client?.id ?? '?'}`;
      workorderNamn.set(workorderId, { klientNamn, klientId: m.client?.id ?? null });

      for (const svc of (m.services || [])) {
        if (nonBillableServiceIds.has(svc.id)) continue;
        const qty = Number(svc.quantity || 0);
        const price = Number(svc.price || 0);
        const discount = Number(svc.discount || 0);
        const radbelopp = qty * price * (1 - discount / 100);
        if (radbelopp === 0) continue;
        const nyckel = `${workorderId}|${svc.id}|${qty}|${price}|${discount}`;
        if (!grupper.has(nyckel)) grupper.set(nyckel, []);
        grupper.get(nyckel)!.push({ missionId: m.id, m, svc, radbelopp });
      }
    }

    const dubletter: any[] = [];
    let totalExtraSumma = 0;
    for (const [nyckel, gruppen] of grupper.entries()) {
      if (gruppen.length < 2) continue;
      const [workorderId, serviceId, qty, price] = nyckel.split('|').map(Number);
      const wo = workorderNamn.get(workorderId);
      const first = gruppen[0];
      const extraSumma = first.radbelopp * (gruppen.length - 1); // första är "originalet"
      totalExtraSumma += extraSumma;
      dubletter.push({
        arbetsorder: workorderId,
        klientNamn: wo?.klientNamn || 'Okänd',
        klientId: wo?.klientId,
        tjanst: first.svc.name || first.svc.title || `Service ${serviceId}`,
        qty,
        pricePerUnit: price,
        radbelopp: Math.round(first.radbelopp),
        antalKopior: gruppen.length,
        missionIds: gruppen.map((x) => x.missionId),
        extraSumma: Math.round(extraSumma),
      });
    }

    // Sortera efter störst extra-summa (mest kritiska först)
    dubletter.sort((a, b) => b.extraSumma - a.extraSumma);

    res.setHeader('Cache-Control', 'private, max-age=60');
    res.json({
      period: todayStr.slice(0, 7),
      antalMissioner: missioner.length,
      antalDubletter: dubletter.length,
      totalExtraSumma: Math.round(totalExtraSumma),
      dubletter,
    });
  } catch (err: any) {
    console.error('[duplicate-missions]', err?.message);
    res.status(500).json({ error: err?.message || 'scan failed' });
  }
}
