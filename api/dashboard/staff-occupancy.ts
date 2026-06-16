/**
 * Cachad lista över anställdas beläggning denna månad.
 * Samma cache-mönster som overview-stats.
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { prisma } from '../_lib/prisma.js';

export const config = { maxDuration: 60 };

const KEY = 'staff_occupancy';
const STALE_MINUTES = 30;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const force = req.query.refresh === '1' || req.method === 'POST';

  if (force) {
    try {
      const data = await refreshAndStore(req);
      return res.json({ ...data, cached: false, stale: false, ageMinutes: 0 });
    } catch (err: any) {
      return res.status(500).json({ error: err?.message || 'refresh failed' });
    }
  }

  const snap = await prisma.dashboardSnapshot.findUnique({ where: { key: KEY } });
  if (!snap) {
    try {
      const data = await refreshAndStore(req);
      return res.json({ ...data, cached: false, stale: false, ageMinutes: 0 });
    } catch (err: any) {
      return res.status(500).json({ error: err?.message || 'first compute failed' });
    }
  }

  const ageMs = Date.now() - snap.computedAt.getTime();
  const stale = ageMs > STALE_MINUTES * 60_000;
  res.json({
    ...(snap.data as any),
    cached: true,
    stale,
    ageMinutes: Math.round(ageMs / 60000),
    computedAt: snap.computedAt,
  });
}

async function refreshAndStore(req: VercelRequest): Promise<any> {
  await prisma.dashboardSnapshot.upsert({
    where: { key: KEY },
    create: { key: KEY, data: {} as any, refreshing: true },
    update: { refreshing: true },
  });
  try {
    const baseUrl = process.env.APP_URL || `https://${req.headers.host}`;
    const r = await fetch(`${baseUrl}/api/timewave-summary/staff`);
    if (!r.ok) throw new Error(`staff fetch failed: ${r.status}`);
    const data = await r.json();
    await prisma.dashboardSnapshot.upsert({
      where: { key: KEY },
      create: { key: KEY, data: data as any, refreshing: false, computedAt: new Date() },
      update: { data: data as any, refreshing: false, computedAt: new Date() },
    });
    return data;
  } catch (err) {
    await prisma.dashboardSnapshot.update({
      where: { key: KEY },
      data: { refreshing: false },
    }).catch(() => {});
    throw err;
  }
}
