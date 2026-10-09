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
