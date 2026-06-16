/**
 * Vercel-cron som uppdaterar samtliga dashboard-snapshots i bakgrunden.
 * Vidare ned: refresh-all körs var 30:e minut (vercel.json) och triggar varje
 * undermetrik via ?refresh=1. Då slipper användaren se "stale"-data — och
 * även om det fallerar har frontend kvar den gamla cachen.
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';

export const config = { maxDuration: 60 };

const METRICS = ['overview-stats', 'staff-occupancy', 'customer-tenure'];

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).send('Method Not Allowed');
  }
  if (process.env.CRON_SECRET) {
    const auth = req.headers.authorization || '';
    if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
  }

  const baseUrl = process.env.APP_URL || `https://${req.headers.host}`;
  const startedAt = Date.now();
  const results: any[] = [];

  // Sekventiellt så vi inte sätter eld på Timewave-rate-limit
  for (const metric of METRICS) {
    const t0 = Date.now();
    try {
      const r = await fetch(`${baseUrl}/api/dashboard/${metric}?refresh=1`, {
        method: 'GET',
      });
      results.push({
        metric,
        ok: r.ok,
        status: r.status,
        durationMs: Date.now() - t0,
      });
    } catch (err: any) {
      results.push({
        metric,
        ok: false,
        error: err?.message,
        durationMs: Date.now() - t0,
      });
    }
  }

  res.json({
    ok: results.every((r) => r.ok),
    totalDurationMs: Date.now() - startedAt,
    results,
    timestamp: new Date().toISOString(),
  });
}
