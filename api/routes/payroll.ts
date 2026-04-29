import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../_lib/prisma.js';
import { requireAuth, getUserId } from '../_lib/auth.js';
import { asyncHandler, BadRequest } from '../_lib/errors.js';
import { parseBody, parseQuery } from '../_lib/validation.js';
import { audit } from '../_lib/audit.js';
import { generatePayrollForPeriod } from '../_lib/payrollService.js';

const router = Router();
router.use(requireAuth);

const ListQuery = z.object({
  employeeId: z.coerce.number().int().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  type: z.string().optional(),
});

router.get(
  '/lines',
  asyncHandler(async (req, res) => {
    const q = parseQuery(ListQuery, req);
    const where: any = {};
    if (q.employeeId) where.employeeId = q.employeeId;
    if (q.from) where.periodStart = { gte: new Date(q.from) };
    if (q.to) where.periodEnd = { lte: new Date(q.to) };
    if (q.type) where.type = q.type;
    const rows = await prisma.payrollLine.findMany({
      where,
      orderBy: [{ periodStart: 'desc' }, { employeeId: 'asc' }],
      include: { employee: { select: { id: true, firstName: true, lastName: true } } },
    });
    res.json(rows);
  })
);

// Summary: grouped per employee in a period
router.get(
  '/summary',
  asyncHandler(async (req, res) => {
    const q = parseQuery(
      z.object({
        periodStart: z.string(),
        periodEnd: z.string(),
      }),
      req
    );
    const lines = await prisma.payrollLine.findMany({
      where: {
        periodStart: new Date(q.periodStart),
        periodEnd: new Date(q.periodEnd),
      },
      include: { employee: { select: { id: true, firstName: true, lastName: true } } },
    });
    const summary = new Map<number, any>();
    for (const l of lines) {
      const cur = summary.get(l.employeeId) ?? {
        employeeId: l.employeeId,
        employeeName: `${l.employee.firstName} ${l.employee.lastName}`,
        totalMinutes: 0,
        totalAmountCents: 0,
        byType: {},
      };
      cur.totalMinutes += l.minutes;
      cur.totalAmountCents += l.amountCents;
      cur.byType[l.type] = (cur.byType[l.type] ?? 0) + l.minutes;
      summary.set(l.employeeId, cur);
    }
    res.json(Array.from(summary.values()));
  })
);

router.post(
  '/generate',
  asyncHandler(async (req, res) => {
    const body = parseBody(
      z.object({
        periodStart: z.string(),
        periodEnd: z.string(),
        employeeIds: z.array(z.number().int()).optional(),
      }),
      req
    );
    const userId = getUserId(req)!;
    const results = await generatePayrollForPeriod({
      periodStart: new Date(body.periodStart),
      periodEnd: new Date(body.periodEnd),
      employeeIds: body.employeeIds,
    });
    await audit({
      actorClerkId: userId,
      action: 'GENERATE',
      entityType: 'PayrollRun',
      entityId: `${body.periodStart}_${body.periodEnd}`,
      after: results,
    });
    res.json(results);
  })
);

// Mark period as sent to Fortnox (actual push depends on Fortnox payroll API, skipped for MVP)
router.post(
  '/mark-sent',
  asyncHandler(async (req, res) => {
    const body = parseBody(
      z.object({ periodStart: z.string(), periodEnd: z.string(), fortnoxPayrollId: z.string().optional() }),
      req
    );
    const userId = getUserId(req)!;
    const result = await prisma.payrollLine.updateMany({
      where: {
        periodStart: new Date(body.periodStart),
        periodEnd: new Date(body.periodEnd),
        sentToFortnoxAt: null,
      },
      data: {
        sentToFortnoxAt: new Date(),
        fortnoxPayrollId: body.fortnoxPayrollId ?? null,
      },
    });
    await audit({ actorClerkId: userId, action: 'SEND', entityType: 'PayrollRun', entityId: `${body.periodStart}_${body.periodEnd}` });
    res.json({ markedSent: result.count });
  })
);

export default router;
