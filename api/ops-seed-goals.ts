/**
 * Idempotent seed av tre mål (Bokad försäljning, Bokningar online, Nya
 * återkommande kunder) för AKTUELL månad + AKTUELL vecka. Skapar inget
 * om det redan finns för perioden.
 *
 * Kör en gång via GET / POST; kan köras om när ny månad/vecka börjar.
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { prisma } from './_lib/prisma.js';

const METRICS = [
  { key: 'booked_revenue',        label: 'Bokad försäljning',       unit: 'kr', sortOrder: 1, monthTarget: 1_250_000, weekTarget: 312_500 },
  { key: 'online_bookings_month', label: 'Bokningar online',         unit: 'st', sortOrder: 2, monthTarget: 85,        weekTarget: 21 },
  { key: 'new_recurring_clients', label: 'Nya återkommande kunder',  unit: 'st', sortOrder: 3, monthTarget: 12,        weekTarget: 3 },
];

function isoWeekBounds(d: Date): { start: Date; end: Date } {
  const date = new Date(d);
  const day = date.getDay() || 7; // Sun=0 → 7
  date.setDate(date.getDate() - (day - 1)); // roll back to monday
  date.setHours(0, 0, 0, 0);
  const start = date;
  const end = new Date(date);
  end.setDate(start.getDate() + 6);
  return { start, end };
}

export default async function handler(_req: VercelRequest, res: VercelResponse) {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  const { start: weekStart, end: weekEnd } = isoWeekBounds(now);

  const created: string[] = [];
  const skipped: string[] = [];

  for (const m of METRICS) {
    // Månad
    const existingMonth = await prisma.opsGoal.findFirst({
      where: { periodType: 'MONTH', periodStart: monthStart, metricKey: m.key },
    });
    if (existingMonth) {
      skipped.push(`MONTH ${m.key}`);
    } else {
      await prisma.opsGoal.create({
        data: {
          periodType: 'MONTH',
          periodStart: monthStart,
          periodEnd: monthEnd,
          metricKey: m.key,
          metricLabel: m.label,
          targetValue: m.monthTarget,
          unit: m.unit,
          sortOrder: m.sortOrder,
        },
      });
      created.push(`MONTH ${m.key}`);
    }

    // Vecka
    const existingWeek = await prisma.opsGoal.findFirst({
      where: { periodType: 'WEEK', periodStart: weekStart, metricKey: m.key },
    });
    if (existingWeek) {
      skipped.push(`WEEK ${m.key}`);
    } else {
      await prisma.opsGoal.create({
        data: {
          periodType: 'WEEK',
          periodStart: weekStart,
          periodEnd: weekEnd,
          metricKey: m.key,
          metricLabel: m.label,
          targetValue: m.weekTarget,
          unit: m.unit,
          sortOrder: m.sortOrder,
        },
      });
      created.push(`WEEK ${m.key}`);
    }
  }

  res.json({
    ok: true,
    created,
    skipped,
    period: {
      month: `${monthStart.toISOString().slice(0, 10)} → ${monthEnd.toISOString().slice(0, 10)}`,
      week: `${weekStart.toISOString().slice(0, 10)} → ${weekEnd.toISOString().slice(0, 10)}`,
    },
    note: 'Placeholder-mål — justera i Head-of via klick på siffran.',
  });
}
