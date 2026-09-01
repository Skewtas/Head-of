import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../_lib/prisma.js';
import { requireAuth, getUserId } from '../_lib/auth.js';
import { asyncHandler, NotFound } from '../_lib/errors.js';
import { parseBody, parseIdParam, parseQuery } from '../_lib/validation.js';

const router = Router();
router.use(requireAuth);

// ─────────────────────────────────────────────────────────────────────────
// Goals
// ─────────────────────────────────────────────────────────────────────────

const GoalCreate = z.object({
  periodType: z.enum(['YEAR', 'MONTH', 'WEEK']),
  periodStart: z.string(),  // YYYY-MM-DD
  periodEnd: z.string(),
  metricKey: z.string().min(1),
  metricLabel: z.string().min(1),
  targetValue: z.number(),
  actualOverride: z.number().nullish(),
  unit: z.string().nullish(),
  notes: z.string().nullish(),
  sortOrder: z.number().int().default(0),
});
const GoalUpdate = GoalCreate.partial();

router.get(
  '/goals',
  asyncHandler(async (req, res) => {
    const q = parseQuery(
      z.object({
        periodType: z.enum(['YEAR', 'MONTH', 'WEEK']).optional(),
        periodStart: z.string().optional(),
      }),
      req
    );
    const where: any = {};
    if (q.periodType) where.periodType = q.periodType;
    if (q.periodStart) where.periodStart = new Date(q.periodStart);
    const rows = await prisma.opsGoal.findMany({
      where,
      orderBy: [{ periodStart: 'desc' }, { sortOrder: 'asc' }],
    });
    res.json(rows);
  })
);

router.post(
  '/goals',
  asyncHandler(async (req, res) => {
    const body = parseBody(GoalCreate, req);
    const row = await prisma.opsGoal.create({
      data: { ...body, periodStart: new Date(body.periodStart), periodEnd: new Date(body.periodEnd) },
    });
    res.status(201).json(row);
  })
);

router.put(
  '/goals/:id',
  asyncHandler(async (req, res) => {
    const id = parseIdParam(req);
    const body = parseBody(GoalUpdate, req);
    const data: any = { ...body };
    if (body.periodStart) data.periodStart = new Date(body.periodStart);
    if (body.periodEnd) data.periodEnd = new Date(body.periodEnd);
    const row = await prisma.opsGoal.update({ where: { id }, data });
    res.json(row);
  })
);

router.delete(
  '/goals/:id',
  asyncHandler(async (req, res) => {
    const id = parseIdParam(req);
    await prisma.opsGoal.delete({ where: { id } });
    res.status(204).end();
  })
);

// ─────────────────────────────────────────────────────────────────────────
// Tasks (Pipeline + Actions + Personal)
// ─────────────────────────────────────────────────────────────────────────

const TaskCreate = z.object({
  section: z.enum(['PIPELINE', 'ACTION', 'PERSONAL']),
  owner: z.string().nullish(),
  title: z.string().min(1),
  nextStep: z.string().nullish(),
  relatedTo: z.string().nullish(),
  status: z.enum(['OPEN', 'IN_PROGRESS', 'WAITING', 'DONE', 'CANCELLED']).default('OPEN'),
  deadline: z.string().nullish(),
  notes: z.string().nullish(),
  sortOrder: z.number().int().default(0),
});
const TaskUpdate = TaskCreate.partial();

router.get(
  '/tasks',
  asyncHandler(async (req, res) => {
    const q = parseQuery(
      z.object({
        section: z.enum(['PIPELINE', 'ACTION', 'PERSONAL']).optional(),
        owner: z.string().optional(),
        status: z.enum(['OPEN', 'IN_PROGRESS', 'WAITING', 'DONE', 'CANCELLED']).optional(),
        includeDeleted: z.coerce.boolean().default(false),
        includeArchived: z.coerce.boolean().default(false),
      }),
      req
    );
    const where: any = {};
    if (!q.includeDeleted) where.deletedAt = null;
    if (!q.includeArchived) where.archivedAt = null;
    if (q.section) where.section = q.section;
    if (q.owner) where.owner = q.owner;
    if (q.status) where.status = q.status;
    const rows = await prisma.opsTask.findMany({
      where,
      // Ordning: öppna först (OPEN/IN_PROGRESS/WAITING/DONE/CANCELLED = alfabetisk
      // funkar inte perfekt) — sortering finslipas i frontend.
      orderBy: [{ deadline: 'asc' }, { sortOrder: 'asc' }, { createdAt: 'desc' }],
    });
    res.json(rows);
  })
);

router.post(
  '/tasks',
  asyncHandler(async (req, res) => {
    const body = parseBody(TaskCreate, req);
    const userId = getUserId(req);
    const isDone = body.status === 'DONE';
    const row = await prisma.opsTask.create({
      data: {
        ...body,
        deadline: body.deadline ? new Date(body.deadline) : null,
        completedAt: isDone ? new Date() : null,
        completedBy: isDone ? userId : null,
      },
    });
    res.status(201).json(row);
  })
);

router.put(
  '/tasks/:id',
  asyncHandler(async (req, res) => {
    const id = parseIdParam(req);
    const body = parseBody(TaskUpdate, req);
    const userId = getUserId(req);
    const existing = await prisma.opsTask.findUnique({ where: { id } });
    if (!existing) throw NotFound();

    const data: any = { ...body };
    if ('deadline' in body) data.deadline = body.deadline ? new Date(body.deadline) : null;

    // Auto-hantera completedAt/completedBy när status ändras till/från DONE
    if (body.status !== undefined && body.status !== existing.status) {
      if (body.status === 'DONE') {
        data.completedAt = new Date();
        data.completedBy = userId;
      } else {
        data.completedAt = null;
        data.completedBy = null;
      }
    }

    const row = await prisma.opsTask.update({ where: { id }, data });
    res.json(row);
  })
);

// Snabb-bocka-av — atomisk toggle mellan OPEN och DONE.
router.post(
  '/tasks/:id/toggle-complete',
  asyncHandler(async (req, res) => {
    const id = parseIdParam(req);
    const userId = getUserId(req);
    const existing = await prisma.opsTask.findUnique({ where: { id } });
    if (!existing) throw NotFound();
    const isDone = existing.status === 'DONE';
    const row = await prisma.opsTask.update({
      where: { id },
      data: isDone
        ? { status: 'OPEN', completedAt: null, completedBy: null }
        : { status: 'DONE', completedAt: new Date(), completedBy: userId },
    });
    res.json(row);
  })
);

router.delete(
  '/tasks/:id',
  asyncHandler(async (req, res) => {
    const id = parseIdParam(req);
    const row = await prisma.opsTask.findUnique({ where: { id } });
    if (!row) throw NotFound();
    // Soft delete
    await prisma.opsTask.update({ where: { id }, data: { deletedAt: new Date() } });
    res.status(204).end();
  })
);

// ─────────────────────────────────────────────────────────────────────────
// OVERVIEW-GOALS — samma målvärden som Översikten visar. En källa. Läser
// stats från /api/dashboard/overview-stats + slår upp konfigurerbara
// målvärden i OpsGoal-tabellen (fallback till hårdkodade defaults).
// ─────────────────────────────────────────────────────────────────────────

const DEFAULT_MONTH_GOALS: Array<{ key: string; label: string; target: number; unit: string; sortOrder: number }> = [
  { key: 'revenue_booked',   label: 'Bokad försäljning',        target: 850000, unit: 'kr',   sortOrder: 1 },
  { key: 'revenue_invoiced', label: 'Fakturerad försäljning',   target: 850000, unit: 'kr',   sortOrder: 2 },
  { key: 'avg_price',        label: 'Snittpris',                target: 550,    unit: 'kr/h', sortOrder: 3 },
  { key: 'recurring_private',label: 'Återk. kunder (privat)',   target: 250,    unit: 'st',   sortOrder: 4 },
  { key: 'recurring_company',label: 'Återk. kunder (företag)',  target: 50,     unit: 'st',   sortOrder: 5 },
  { key: 'staff_count',      label: 'Personalbas',              target: 20,     unit: 'st',   sortOrder: 6 },
];

router.get(
  '/overview-goals',
  asyncHandler(async (req, res) => {
    const baseUrl = process.env.APP_URL || `https://${req.headers.host}`;
    // Läs samma cache som Översikten (delad snapshot). Skickar inte force-refresh.
    const r = await fetch(`${baseUrl}/api/dashboard/overview-stats`, {
      headers: { cookie: req.headers.cookie || '' },
    });
    if (!r.ok) throw new Error(`overview-stats fetch failed: ${r.status}`);
    const stats = (await r.json()) as any;

    // Aktuell månad: första i månaden till sista i månaden
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);

    // Konfigurerbara target-värden per metric (över DEFAULT_MONTH_GOALS)
    const overrides = await prisma.opsGoal.findMany({
      where: { periodType: 'MONTH', periodStart: monthStart },
    });
    const overrideByKey = new Map(overrides.map((g) => [g.metricKey, g]));

    // Mappa metric-key → aktuellt värde från stats-objektet
    const actualFor = (key: string): number => {
      switch (key) {
        case 'revenue_booked':    return Number(stats.totalRevenueExVat ?? 0);
        case 'revenue_invoiced':  return Number(stats.totalInvoicedNet ?? 0);
        case 'avg_price':         return Number(stats.avgPricePerHour ?? 0);
        case 'recurring_private': return Number(stats.recurringPrivateClients ?? 0);
        case 'recurring_company': return Number(stats.recurringCompanyClients ?? 0);
        case 'staff_count':       return Number(stats.employees ?? 0);
        default:                  return 0;
      }
    };

    const monthNameSv = new Intl.DateTimeFormat('sv-SE', {
      month: 'long', year: 'numeric', timeZone: 'Europe/Stockholm',
    }).format(now);

    const goals = DEFAULT_MONTH_GOALS.map((g) => {
      const override = overrideByKey.get(g.key);
      const target = override?.targetValue ?? g.target;
      const actual = override?.actualOverride ?? actualFor(g.key);
      const progress = target > 0 ? Math.round((actual / target) * 100) : 0;
      const status: 'over' | 'ok' | 'behind' =
        actual >= target ? 'over' : progress >= 70 ? 'ok' : 'behind';
      return {
        key: g.key,
        label: g.label,
        actual,
        target,
        unit: g.unit,
        progress,
        status,
        goalId: override?.id ?? null,
      };
    });

    res.json({
      monthLabel: monthNameSv,
      periodStart: monthStart.toISOString().slice(0, 10),
      periodEnd: monthEnd.toISOString().slice(0, 10),
      goals,
      source: 'overview-stats',
      statsCached: stats.cached ?? null,
      statsStale: stats.stale ?? null,
      statsAgeMinutes: stats.ageMinutes ?? null,
    });
  })
);

// ─────────────────────────────────────────────────────────────────────────
// Seed — populates yearly + monthly goals from Mikaela's spreadsheet.
// Idempotent: skips rows that already exist for the same period+metric.
// ─────────────────────────────────────────────────────────────────────────

router.post(
  '/seed',
  asyncHandler(async (_req, res) => {
    // Räkenskapsår 1 apr 2026 – 31 mar 2027
    const yearStart = new Date('2026-04-01');
    const yearEnd = new Date('2027-03-31');

    const yearly = [
      { metricKey: 'revenue', metricLabel: 'Fakturerad försäljning', targetValue: 13000000, unit: 'kr', sortOrder: 1 },
      { metricKey: 'online_bookings', metricLabel: 'Bokningar online', targetValue: 1000, unit: 'st', sortOrder: 2 },
      { metricKey: 'staff_count', metricLabel: 'Personalbas', targetValue: 45, unit: 'st', sortOrder: 3 },
      { metricKey: 'churn', metricLabel: 'Churn', targetValue: 0, unit: '%', sortOrder: 4 },
      { metricKey: 'avg_price', metricLabel: 'Snittpris', targetValue: 458, unit: 'kr', sortOrder: 5 },
      { metricKey: 'recurring_clients', metricLabel: 'Antal återkommande kunder', targetValue: 500, unit: 'st', sortOrder: 6 },
    ];

    let created = 0;
    let skipped = 0;
    for (const g of yearly) {
      const existing = await prisma.opsGoal.findFirst({
        where: {
          periodType: 'YEAR',
          periodStart: yearStart,
          metricKey: g.metricKey,
        },
      });
      if (existing) {
        skipped++;
        continue;
      }
      await prisma.opsGoal.create({
        data: {
          periodType: 'YEAR',
          periodStart: yearStart,
          periodEnd: yearEnd,
          ...g,
        },
      });
      created++;
    }

    // Monthly revenue targets from the spreadsheet
    const monthly: Array<{ month: string; target: number }> = [
      { month: '2026-04-01', target: 963863 },
      { month: '2026-05-01', target: 900000 },
      { month: '2026-06-01', target: 700000 },
      { month: '2026-07-01', target: 600000 },
      { month: '2026-08-01', target: 1250000 },
      { month: '2026-09-01', target: 1250000 },
      { month: '2026-10-01', target: 1250000 },
      { month: '2026-11-01', target: 1250000 },
      { month: '2026-12-01', target: 1250000 },
      { month: '2027-01-01', target: 1250000 },
      { month: '2027-02-01', target: 1250000 },
      { month: '2027-03-01', target: 1250000 },
    ];

    for (const m of monthly) {
      const ps = new Date(m.month);
      const pe = new Date(ps.getFullYear(), ps.getMonth() + 1, 0); // last day of month
      const existing = await prisma.opsGoal.findFirst({
        where: { periodType: 'MONTH', periodStart: ps, metricKey: 'revenue' },
      });
      if (existing) {
        skipped++;
        continue;
      }
      await prisma.opsGoal.create({
        data: {
          periodType: 'MONTH',
          periodStart: ps,
          periodEnd: pe,
          metricKey: 'revenue',
          metricLabel: 'Fakturerad försäljning',
          targetValue: m.target,
          unit: 'kr',
          sortOrder: 1,
        },
      });
      created++;
    }
    res.json({ created, skipped });
  })
);

export default router;
