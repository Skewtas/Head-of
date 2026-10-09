/**
 * Bokningar från Bokis (boka.stodona.se) – den enda sanna källan till
 * onlinebokningar. Hämtas med ett Convex-anrop.
 *
 * Tidigare gissade dashboarden fram onlinebokningar ur Timewave-taggar, vilket
 * gav noll varje dag i ett helt år trots hundratals riktiga bokningar. Därför
 * ligger hämtningen här, så att alla vyer räknar likadant.
 *
 * ENV (sätts i Vercel):
 *   BOKIS_CONVEX_URL           – t.ex. https://glorious-gerbil-763.convex.cloud
 *   BOKIS_CONVEX_ADMIN_SECRET  – matchar CONVEX_ADMIN_SECRET på Convex-sidan
 */

export type BokisBooking = {
  id: string;
  service?: string;
  date?: string;
  status?: string;
  estimatedPrice?: number;
  useRut?: boolean;
  createdAt?: number;
  _creationTime?: number;
};

/** Datum i svensk tid, ÅÅÅÅ-MM-DD. */
export function ymdSthlm(d: Date): string {
  const delar = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Europe/Stockholm', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(d);
  const y = delar.find((p) => p.type === 'year')!.value;
  const m = delar.find((p) => p.type === 'month')!.value;
  const dag = delar.find((p) => p.type === 'day')!.value;
  return `${y}-${m}-${dag}`;
}

/** Kör en Convex-fråga mot Bokis. Admin-hemligheten läggs till i argumenten. */
export async function bokisQuery<T = unknown>(path: string, args: Record<string, unknown> = {}): Promise<T> {
  const url = process.env.BOKIS_CONVEX_URL;
  const secret = process.env.BOKIS_CONVEX_ADMIN_SECRET;
  if (!url || !secret) {
    throw new Error('BOKIS_CONVEX_URL / BOKIS_CONVEX_ADMIN_SECRET saknas i Vercel-env.');
  }
  const r = await fetch(`${url.replace(/\/$/, '')}/api/query`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path, args: { ...args, secret }, format: 'json' }),
  });
  if (!r.ok) {
    const text = await r.text().catch(() => '');
    throw new Error(`Convex ${r.status}: ${text.substring(0, 200)}`);
  }
  const body = await r.json();
  if (body.status === 'error') throw new Error(`Convex error: ${body.errorMessage || 'okänt fel'}`);
  return (body.value ?? body) as T;
}

export async function fetchBokisBookings(): Promise<BokisBooking[]> {
  const rader = await bokisQuery<unknown>('adminData:listBookings');
  return Array.isArray(rader) ? (rader as BokisBooking[]) : [];
}

/** När bokningen skapades, i svensk tid – inte städdatumet. Avbokade räknas inte. */
export function bokningsdagar(bokningar: BokisBooking[], franOchMed?: string): string[] {
  const dagar: string[] = [];
  for (const b of bokningar) {
    if (b.status === 'cancelled') continue;
    const tid = b._creationTime ?? b.createdAt;
    if (!tid) continue;
    const dag = ymdSthlm(new Date(tid));
    if (!franOchMed || dag >= franOchMed) dagar.push(dag);
  }
  return dagar;
}

// Samma konstanter som Bokis prismodell (convex/lib/commissionEngine.ts).
const MOMS = 1.25;
const FRAMKORNING_EX_MOMS = 456;
const TJANSTER_MED_FRAMKORNING = ['Flyttstädning', 'Byggstädning', 'Fönsterputsning', 'Textiltvätt'];

/**
 * Bokningens pris EX MOMS och FÖRE RUT-avdrag.
 *
 * Bokis `estimatedPrice` är det kunden betalar: inkl moms och EFTER RUT. Det
 * ska aldrig visas i dashboarden — RUT är ett betalningssätt, inte en rabatt,
 * och Stodona får hela beloppet. Räknas baklänges ur prismodellen:
 *   estimatedPrice = arbete_ex_moms × 1,25 × rutFaktor + framkörning_ex_moms × 1,25
 * Framkörningen har varken RUT eller rabatt och läggs tillbaka oförändrad.
 */
export function prisExMomsForeRut(b: { service?: string | null; estimatedPrice?: number | null; useRut?: boolean | null }): number | null {
  const pris = Number(b.estimatedPrice);
  if (!Number.isFinite(pris) || pris <= 0) return null;
  const rutFaktor = b.useRut === false ? 1 : 0.5;
  const framkorning = TJANSTER_MED_FRAMKORNING.includes(b.service ?? '') ? FRAMKORNING_EX_MOMS : 0;
  const arbeteInklMomsEfterRut = pris - framkorning * MOMS;
  if (arbeteInklMomsEfterRut <= 0) return Math.round(pris / MOMS);
  return Math.round(arbeteInklMomsEfterRut / MOMS / rutFaktor + framkorning);
}
