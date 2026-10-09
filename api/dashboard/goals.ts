/**
 * Månadsmål — läsa + skriva.
 *
 * GET  /api/dashboard/goals?month=YYYY-MM   → aktuella mål (defaults om tomt)
 * PUT  /api/dashboard/goals                  → spara mål för en månad
 *      body: { month: "2026-10", bookedRevenue, avgPricePerHour,
 *              recurringPrivateClients, recurringCompanyClients,
 *              staffCount, onlineBookings }
 *
 * PUT kräver Clerk-session (vem som helst inloggad får ändra — om du vill
 * spärra till superadmin, lägg till check mot CONTRACT_SUPERADMIN_EMAILS).
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClerkClient, verifyToken } from '@clerk/backend';
import { prisma } from '../_lib/prisma.js';

export const config = { maxDuration: 15 };

const clerk = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY || '' });

const DEFAULT_GOALS = {
  bookedRevenue: 850_000,
  avgPricePerHour: 550,
  recurringPrivateClients: 250,
  recurringCompanyClients: 50,
  staffCount: 20,
  onlineBookings: 60,
};

async function getLoggedInUser(req: VercelRequest): Promise<{ userId: string; email: string | null } | null> {
  const cookieHdr = req.headers.cookie || '';
  const sessionMatch = cookieHdr.match(/__session=([^;]+)/);
  const token = sessionMatch?.[1];
  if (!token) return null;
  const secretKey = process.env.CLERK_SECRET_KEY;
  if (!secretKey) return null;
  try {
    const payload = await verifyToken(token, { secretKey });
    const userId = (payload as any)?.sub;
    if (!userId) return null;
    try {
      const u = await clerk.users.getUser(userId);
      const primary = u.emailAddresses?.find((e: any) => e.id === u.primaryEmailAddressId)?.emailAddress;
      return { userId, email: primary?.toLowerCase() ?? null };
    } catch {
      return { userId, email: null };
    }
  } catch {
    return null;
  }
}

function currentMonth(): string {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Europe/Stockholm', year: 'numeric', month: '2-digit',
  }).format(new Date());
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const month = typeof req.query.month === 'string' && /^\d{4}-\d{2}$/.test(req.query.month)
    ? req.query.month
    : currentMonth();

  if (req.method === 'GET') {
    const row = await prisma.monthlyGoal.findUnique({ where: { month } });
    if (row) {
      res.setHeader('Cache-Control', 'private, max-age=30');
      return res.json({
        month,
        bookedRevenue: row.bookedRevenue,
        avgPricePerHour: row.avgPricePerHour,
        recurringPrivateClients: row.recurringPrivateClients,
        recurringCompanyClients: row.recurringCompanyClients,
        staffCount: row.staffCount,
        onlineBookings: row.onlineBookings,
        updatedAt: row.updatedAt,
        updatedBy: row.updatedBy,
        isDefault: false,
      });
    }
    res.json({ month, ...DEFAULT_GOALS, updatedAt: null, updatedBy: null, isDefault: true });
    return;
  }

  if (req.method === 'PUT' || req.method === 'POST') {
    const user = await getLoggedInUser(req);
    if (!user) return res.status(401).json({ error: 'Logga in först' });

    const body = (req.body || {}) as Partial<typeof DEFAULT_GOALS> & { month?: string };
    const targetMonth = typeof body.month === 'string' && /^\d{4}-\d{2}$/.test(body.month) ? body.month : month;

    const n = (v: unknown, min = 0, max = 100_000_000): number | null => {
      const x = Math.round(Number(v));
      if (!Number.isFinite(x) || x < min || x > max) return null;
      return x;
    };
    const data = {
      bookedRevenue: n(body.bookedRevenue),
      avgPricePerHour: n(body.avgPricePerHour, 0, 10_000),
      recurringPrivateClients: n(body.recurringPrivateClients, 0, 100_000),
      recurringCompanyClients: n(body.recurringCompanyClients, 0, 100_000),
      staffCount: n(body.staffCount, 0, 10_000),
      onlineBookings: n(body.onlineBookings, 0, 100_000),
    };
    const errFields = Object.entries(data).filter(([, v]) => v === null).map(([k]) => k);
    if (errFields.length > 0) return res.status(400).json({ error: `Ogiltigt värde i: ${errFields.join(', ')}` });

    const row = await prisma.monthlyGoal.upsert({
      where: { month: targetMonth },
      create: {
        month: targetMonth,
        ...(data as Record<string, number>),
        updatedBy: user.email || user.userId,
      } as any,
      update: {
        ...(data as Record<string, number>),
        updatedBy: user.email || user.userId,
      } as any,
    });

    return res.json({ ok: true, month: row.month, ...data, updatedBy: row.updatedBy, updatedAt: row.updatedAt });
  }

  res.status(405).json({ error: 'Method not allowed' });
}
