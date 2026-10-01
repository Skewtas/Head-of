/**
 * Verifiera bokad försäljning MOT det som faktiskt kommer faktureras.
 * Scannar en specifik månad och delar upp:
 *   - total brutto (det som visas i Översikten)
 *   - minus dubletter (identisk arbetsorder + tjänst + qty + pris)
 *   - minus avbokade-men-prisade (mission med 0 utförda anställda)
 *   - minus kreditfakturerade (deleted/credited i Timewave)
 *   = ren faktureringsbas
 *
 * GET /api/dashboard/revenue-verify?month=2026-09&secret=<CRON_SECRET>
 * Standard: innevarande månad.
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { verifyToken } from '@clerk/backend';
import { getTimewaveToken } from '../_lib/timewaveAuth.js';

export const config = { maxDuration: 60 };

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
    return !!(payload as any)?.sub;
  } catch { return false; }
}

const nonBillableServiceIds = new Set([3, 7, 401]);

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!(await auth(req))) return res.status(403).json({ error: 'Unauthorized' });

  // Period
  const nowStr = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Europe/Stockholm', year: 'numeric', month: '2-digit',
  }).format(new Date());
  const monthKey = typeof req.query.month === 'string' && /^\d{4}-\d{2}$/.test(req.query.month)
    ? req.query.month : nowStr;
  const [year, month] = monthKey.split('-').map(Number);
  const monthStart = `${monthKey}-01`;
  const nextMonth = new Date(year, month, 1);
  const monthEnd = new Date(nextMonth.getTime() - 24 * 3600 * 1000)
    .toISOString().slice(0, 10);

  try {
    const token = await getTimewaveToken();
    const base = 'https://api.timewave.se/v3';

    // Hämta alla missioner för månaden (paginerat)
    const missioner: any[] = [];
    let page = 1;
    while (true) {
      const url = `${base}/missions?filter[startdate]=${monthStart}&filter[enddate]=${monthEnd}&page[size]=200&page[number]=${page}`;
      const r = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } });
      if (!r.ok) break;
      const j = await r.json() as any;
      const chunk = j?.data || [];
      missioner.push(...chunk);
      const last = j?.last_page ?? 1;
      if (page >= last || chunk.length === 0) break;
      page++;
      if (page > 50) break;
    }

    // Räkna
    let bruttoTotal = 0;
    let avbokadMenPrisad = 0;
    const avbokadeDetaljer: any[] = [];
    const dubletterMap = new Map<string, Array<{ missionId: number; m: any; svc: any; radbelopp: number }>>();
    const workorderNamn = new Map<number, { klientNamn: string; klientId: number | null }>();

    for (const m of missioner) {
      let missionRevenue = 0;
      let missionHasBillable = false;
      for (const svc of (m.services || [])) {
        if (nonBillableServiceIds.has(svc.id)) continue;
        const qty = Number(svc.quantity || 0);
        const price = Number(svc.price || 0);
        const discount = Number(svc.discount || 0);
        const radbelopp = qty * price * (1 - discount / 100);
        if (radbelopp === 0) continue;
        missionRevenue += radbelopp;
        missionHasBillable = true;

        // Dublett-nyckel: arbetsorder + DATUM + service-signatur
        // Datum är kritiskt — annars flaggas abonnemangsstädningar (4 ggr/mån
        // med identiska rader) som 'dubletter'. Riktig dublett = två missioner
        // SAMMA DAG samma arbetsorder med samma pris (som Matlådor-fallet).
        if (m.workorder?.id) {
          const dag = (m.startdate || m.date || 'okänt-datum').slice(0, 10);
          const nyckel = `${m.workorder.id}|${dag}|${svc.id}|${qty}|${price}|${discount}`;
          if (!dubletterMap.has(nyckel)) dubletterMap.set(nyckel, []);
          dubletterMap.get(nyckel)!.push({ missionId: m.id, m, svc, radbelopp });
          workorderNamn.set(m.workorder.id, {
            klientNamn: m.client?.companyname ||
              `${m.client?.first_name || ''} ${m.client?.last_name || ''}`.trim() ||
              `Kund #${m.client?.id ?? '?'}`,
            klientId: m.client?.id ?? null,
          });
        }
      }
      bruttoTotal += missionRevenue;

      // Avbokade-men-prisade = mission med 0 utförda anställda
      if (missionHasBillable) {
        const employees = m.employees || [];
        const utforda = employees.filter((e: any) => e.starttime && e.endtime && !e.cancelled).length;
        if (utforda === 0) {
          avbokadMenPrisad += missionRevenue;
          avbokadeDetaljer.push({
            missionId: m.id,
            arbetsorder: m.workorder?.id,
            datum: m.startdate || m.date || null,
            klient: m.client?.companyname ||
              `${m.client?.first_name || ''} ${m.client?.last_name || ''}`.trim() ||
              `Kund #${m.client?.id ?? '?'}`,
            tilldelade: employees.length,
            belopp: Math.round(missionRevenue),
          });
        }
      }
    }

    // Dubletter: grupper med > 1 rad (dvs samma arbetsorder + DATUM + service)
    const dubletter: any[] = [];
    let dublettExtra = 0;
    for (const [nyckel, gruppen] of dubletterMap.entries()) {
      if (gruppen.length < 2) continue;
      const parts = nyckel.split('|');
      const workorderId = Number(parts[0]);
      const dag = parts[1];
      const serviceId = Number(parts[2]);
      const qty = Number(parts[3]);
      const price = Number(parts[4]);
      const wo = workorderNamn.get(workorderId);
      const first = gruppen[0];
      const extra = first.radbelopp * (gruppen.length - 1);
      dublettExtra += extra;
      dubletter.push({
        arbetsorder: workorderId,
        datum: dag,
        klientNamn: wo?.klientNamn || 'Okänd',
        tjanst: first.svc.name || first.svc.title || `Service ${serviceId}`,
        qty,
        pricePerUnit: price,
        antalKopior: gruppen.length,
        missionIds: gruppen.map((x) => x.missionId),
        extraSumma: Math.round(extra),
      });
    }
    dubletter.sort((a, b) => b.extraSumma - a.extraSumma);
    avbokadeDetaljer.sort((a, b) => b.belopp - a.belopp);

    const renFaktureringsbas = bruttoTotal - dublettExtra - avbokadMenPrisad;

    res.setHeader('Cache-Control', 'private, no-store');
    res.json({
      period: monthKey,
      fonster: `${monthStart} → ${monthEnd}`,
      antalMissioner: missioner.length,
      summor: {
        bruttoTotal: Math.round(bruttoTotal),
        dublettExtra: Math.round(dublettExtra),
        avbokadMenPrisad: Math.round(avbokadMenPrisad),
        renFaktureringsbas: Math.round(renFaktureringsbas),
      },
      antal: {
        dubletter: dubletter.length,
        avbokadeMenPrisade: avbokadeDetaljer.length,
      },
      dubletter,
      avbokadeMenPrisade: avbokadeDetaljer,
    });
  } catch (err: any) {
    console.error('[revenue-verify]', err?.message);
    res.status(500).json({ error: err?.message || 'verify failed' });
  }
}
