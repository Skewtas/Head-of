/**
 * Growth — bokningstratten från Bokis (boka.stodona.se) till Översikten.
 *
 * Hämtar färdigräknade siffror ur Bokis mätning (bookingAttempts:growthSummary):
 * vald period och lika lång period närmast före, så att allt kan jämföras.
 * Mätningen är anonym — svaret innehåller inga kunduppgifter.
 *
 * Belopp skickas INTE vidare. Bokis räknar bokningsvärde på kundens pris efter
 * RUT, och det ska aldrig visas här (se prisExMomsForeRut i _lib/bokis.ts).
 * Hela Growth Dashboard med intäkter finns i Bokis admin under fliken Growth.
 *
 * Kräver inloggning. ENV: BOKIS_CONVEX_URL, BOKIS_CONVEX_ADMIN_SECRET.
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { verifyToken } from '@clerk/backend';
import { bokisQuery } from '../_lib/bokis.js';

export const config = { maxDuration: 30 };

const DAG = 24 * 60 * 60 * 1000;

type Steg = { key: string; attempts: number; continuedPercent: number | null; droppedPercent: number | null; lost: number | null };
type Summering = {
  visits: number; started: number; completed: number; quotes: number; abandoned: number;
  conversionPercent: number | null; subscriptions: number; subscriptionSharePercent: number | null;
  biggestDrop: { from: string; to: string; lost: number; droppedPercent: number } | null;
  steps: Steg[];
};
type Period = { sinceMs: number; untilMs: number; total: Summering };

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

/** Bara det Översikten visar — och inga belopp. */
function utanBelopp(p: Period) {
  const t = p.total;
  return {
    sinceMs: p.sinceMs,
    untilMs: p.untilMs,
    visits: t.visits,
    started: t.started,
    completed: t.completed,
    quotes: t.quotes,
    abandoned: t.abandoned,
    conversionPercent: t.conversionPercent,
    subscriptions: t.subscriptions,
    subscriptionSharePercent: t.subscriptionSharePercent,
    biggestDrop: t.biggestDrop,
    steps: t.steps.map((s) => ({
      key: s.key, attempts: s.attempts, continuedPercent: s.continuedPercent, droppedPercent: s.droppedPercent, lost: s.lost,
    })),
  };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!(await inloggad(req))) return res.status(401).json({ error: 'Inte inloggad' });

  const dagar = Math.min(Math.max(parseInt(String(req.query.days ?? '30'), 10) || 30, 1), 90);
  const nu = Date.now();
  const fran = nu - dagar * DAG;

  try {
    const [current, previous] = await Promise.all([
      bokisQuery<Period>('bookingAttempts:growthSummary', { sinceMs: fran, untilMs: nu, nowMs: nu }),
      bokisQuery<Period>('bookingAttempts:growthSummary', { sinceMs: fran - dagar * DAG, untilMs: fran, nowMs: nu }),
    ]);
    res.json({ days: dagar, current: utanBelopp(current), previous: utanBelopp(previous) });
  } catch (err: any) {
    console.error('[growth]', err?.message);
    res.status(500).json({ error: err?.message || 'Kunde inte hämta mätdata från Bokis' });
  }
}
