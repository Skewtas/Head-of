/**
 * Ellas bokningar — alla bokningar i Bokis (boka.stodona.se) som är kopplade
 * till personalkontot Elvedina (Ella).
 *
 * Samma urval som hennes egen säljvy i Bokis (consultants:listConsultantBookings):
 * bokningar där hennes kod, eller en underkod åt ett samarbete, har använts.
 * Räknas på NÄR bokningen kom in, inte på städdatumet — det är säljinsatsen
 * som mäts. Avbokade räknas med, precis som i hennes vy, så siffrorna stämmer.
 *
 * Kräver inloggning: svaret innehåller kundnamn.
 *
 * ENV: BOKIS_CONVEX_URL, BOKIS_CONVEX_ADMIN_SECRET (se _lib/bokis.ts).
 *      BOKIS_ELLA_EMAIL (valfri) – pekar ut kontot om namnet inte räcker.
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { verifyToken } from '@clerk/backend';
import { bokisQuery, ymdSthlm } from '../_lib/bokis.js';

export const config = { maxDuration: 30 };

type Konto = { id: string; email: string; displayName: string; active: boolean };
type KontoDetalj = { malBokningarPerVecka: number | null; malBokningarPerManad: number | null };
type Rad = {
  id: string;
  service?: string;
  date?: string;
  status?: string;
  customerName?: string;
  estimatedPriceExMoms?: number;
  frequency?: string | null;
  createdAt: string;
};

const VECKODAGAR = ['Mån', 'Tis', 'Ons', 'Tor', 'Fre', 'Lör', 'Sön'];

async function inloggad(req: VercelRequest): Promise<boolean> {
  const token = (req.headers.cookie || '').match(/__session=([^;]+)/)?.[1];
  const secretKey = process.env.CLERK_SECRET_KEY;
  if (!token || !secretKey) return false;
  try {
    const payload = await verifyToken(token, { secretKey });
    return !!(payload as any)?.sub;
  } catch {
    return false;
  }
}

/** ÅÅÅÅ-MM-DD plus n dagar. */
function plusDagar(ymd: string, n: number): string {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Måndagen i veckan som `ymd` ligger i. */
function mandag(ymd: string): string {
  const dow = (new Date(`${ymd}T12:00:00Z`).getUTCDay() + 6) % 7; // 0 = måndag
  return plusDagar(ymd, -dow);
}

async function hittaElla(): Promise<Konto | null> {
  const konton = (await bokisQuery<Konto[]>('consultants:listConsultants')).filter((k) => k.active);
  const epost = process.env.BOKIS_ELLA_EMAIL?.trim().toLowerCase();
  if (epost) return konton.find((k) => k.email === epost) ?? null;
  // Kontot i Bokis står på hennes fullständiga förnamn, Elvedina.
  const fornamn = (k: Konto) => k.displayName.trim().split(/\s+/)[0]?.toLowerCase();
  return konton.find((k) => fornamn(k) === 'elvedina') ?? konton.find((k) => fornamn(k) === 'ella') ?? null;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!(await inloggad(req))) return res.status(401).json({ error: 'Inte inloggad' });

  try {
    const ella = await hittaElla();
    if (!ella) return res.status(404).json({ error: 'Hittar inget aktivt konto för Elvedina (Ella) i Bokis.' });

    const idag = ymdSthlm(new Date());
    const [detalj, data] = await Promise.all([
      bokisQuery<KontoDetalj | null>('consultants:getConsultantById', { id: ella.id }),
      bokisQuery<{ bookings: Rad[] }>('consultants:listConsultantBookings', { consultantId: ella.id, todayIso: idag }),
    ]);

    const rader = (data.bookings ?? []).map((r) => ({ ...r, dag: ymdSthlm(new Date(r.createdAt)) }));
    const veckostart = mandag(idag);
    const forraVeckostart = plusDagar(veckostart, -7);
    const manad = idag.slice(0, 7);

    const perDag = VECKODAGAR.map((namn, i) => {
      const datum = plusDagar(veckostart, i);
      return { namn, datum, antal: rader.filter((r) => r.dag === datum).length, idag: datum === idag, framtid: datum > idag };
    });

    res.json({
      namn: ella.displayName,
      malVecka: detalj?.malBokningarPerVecka ?? null,
      malManad: detalj?.malBokningarPerManad ?? null,
      idag: rader.filter((r) => r.dag === idag).length,
      dennaVecka: rader.filter((r) => r.dag >= veckostart).length,
      forraVecka: rader.filter((r) => r.dag >= forraVeckostart && r.dag < veckostart).length,
      dennaManad: rader.filter((r) => r.dag.slice(0, 7) === manad).length,
      totalt: rader.length,
      perDag,
      senaste: [...rader]
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, 8)
        .map((r) => ({
          id: r.id,
          createdAt: r.createdAt,
          customerName: r.customerName || '—',
          service: r.service ?? null,
          frequency: r.frequency ?? null,
          date: r.date ?? null,
          status: r.status ?? null,
          prisExMoms: r.estimatedPriceExMoms ?? null,
        })),
      computedAt: new Date().toISOString(),
    });
  } catch (err: any) {
    console.error('[ella-bokningar]', err?.message);
    res.status(500).json({ error: err?.message || 'kunde inte hämta Ellas bokningar' });
  }
}
