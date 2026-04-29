import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../_lib/prisma.js';
import { requireAuth, getUserId } from '../_lib/auth.js';
import { asyncHandler, NotFound, BadRequest } from '../_lib/errors.js';
import { parseBody, parseIdParam, parseQuery } from '../_lib/validation.js';
import { audit } from '../_lib/audit.js';

const router = Router();
router.use(requireAuth);

// ---------- Check in ----------
const CheckIn = z.object({
  missionId: z.number().int(),
  employeeId: z.number().int(),
  at: z.string().optional(),
  lat: z.number().nullish(),
  lng: z.number().nullish(),
});

router.post(
  '/check-in',
  asyncHandler(async (req, res) => {
    const body = parseBody(CheckIn, req);
    const userId = getUserId(req)!;
    const mission = await prisma.mission.findUnique({ where: { id: body.missionId } });
    if (!mission) throw NotFound('Mission not found');
    if (['CANCELLED'].includes(mission.status)) throw BadRequest('Cannot check in to cancelled mission');
    const at = body.at ? new Date(body.at) : new Date();

    const entry = await prisma.timeEntry.upsert({
      where: { missionId_employeeId: { missionId: body.missionId, employeeId: body.employeeId } },
      create: {
        missionId: body.missionId,
        employeeId: body.employeeId,
        checkInAt: at,
        checkInLat: body.lat ?? undefined,
        checkInLng: body.lng ?? undefined,
      },
      update: {
        checkInAt: at,
        checkInLat: body.lat ?? undefined,
        checkInLng: body.lng ?? undefined,
      },
    });
    if (mission.status !== 'IN_PROGRESS') {
      await prisma.mission.update({ where: { id: mission.id }, data: { status: 'IN_PROGRESS', version: { increment: 1 } } });
    }
    await audit({ actorClerkId: userId, action: 'CHECK_IN', entityType: 'TimeEntry', entityId: entry.id, after: entry });
    res.json(entry);
  })
);

// ---------- Check out ----------
const CheckOut = z.object({
  missionId: z.number().int(),
  employeeId: z.number().int(),
  at: z.string().optional(),
  lat: z.number().nullish(),
  lng: z.number().nullish(),
  breakMinutes: z.number().int().default(0),
  deviationType: z
    .enum([
      'NONE',
      'LATE',
      'EARLY_END',
      'EXTRA_WORK',
      'CUSTOMER_ABSENT',
      'CANCELLED_ONSITE',
      'SICK_DURING',
      'EQUIPMENT_FAILURE',
    ])
    .default('NONE'),
  deviationNote: z.string().nullish(),
  extras: z
    .array(
      z.object({
        type: z.enum(['SERVICE', 'MATERIAL', 'OUTLAY']),
        serviceId: z.number().int().nullish(),
        description: z.string().min(1),
        quantity: z.number().default(1),
        unitPriceCents: z.number().int().default(0),
        billable: z.boolean().default(true),
      })
    )
    .optional(),
});

router.post(
  '/check-out',
  asyncHandler(async (req, res) => {
    const body = parseBody(CheckOut, req);
    const userId = getUserId(req)!;
    const entry = await prisma.timeEntry.findUnique({
      where: { missionId_employeeId: { missionId: body.missionId, employeeId: body.employeeId } },
    });
    if (!entry) throw NotFound('No active check-in found for this employee on this mission');
    if (!entry.checkInAt) throw BadRequest('Employee has not checked in');

    const at = body.at ? new Date(body.at) : new Date();
    const actualMinutes =
      Math.round((at.getTime() - entry.checkInAt.getTime()) / 60000) - body.breakMinutes;

    const updated = await prisma.timeEntry.update({
      where: { id: entry.id },
      data: {
        checkOutAt: at,
        checkOutLat: body.lat ?? undefined,
        checkOutLng: body.lng ?? undefined,
        breakMinutes: body.breakMinutes,
        actualMinutes: Math.max(0, actualMinutes),
        deviationType: body.deviationType,
        deviationNote: body.deviationNote ?? undefined,
        employeeApprovedAt: new Date(),
      },
    });

    if (body.extras && body.extras.length > 0) {
      await prisma.missionExtra.createMany({
        data: body.extras.map((e) => ({
          missionId: body.missionId,
          timeEntryId: entry.id,
          type: e.type,
          serviceId: e.serviceId ?? undefined,
          description: e.description,
          quantity: e.quantity,
          unitPriceCents: e.unitPriceCents,
          totalCents: Math.round(e.unitPriceCents * e.quantity),
          billable: e.billable,
          payableToEmployeeId: e.type === 'OUTLAY' ? body.employeeId : null,
        })),
      });
    }

    await audit({ actorClerkId: userId, action: 'CHECK_OUT', entityType: 'TimeEntry', entityId: entry.id, after: updated });
    res.json(updated);
  })
);

// ---------- List ----------
const ListQuery = z.object({
  employeeId: z.coerce.number().int().optional(),
  missionId: z.coerce.number().int().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  approved: z.enum(['yes', 'no', 'any']).default('any'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(500).default(100),
});

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const q = parseQuery(ListQuery, req);
    const where: any = {};
    if (q.employeeId) where.employeeId = q.employeeId;
    if (q.missionId) where.missionId = q.missionId;
    if (q.from || q.to) {
      where.checkInAt = {};
      if (q.from) where.checkInAt.gte = new Date(q.from);
      if (q.to) where.checkInAt.lte = new Date(q.to);
    }
    if (q.approved === 'yes') where.adminApprovedAt = { not: null };
    if (q.approved === 'no') where.adminApprovedAt = null;

    const [rows, total] = await Promise.all([
      prisma.timeEntry.findMany({
        where,
        orderBy: { checkInAt: 'desc' },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
        include: {
          employee: { select: { id: true, firstName: true, lastName: true } },
          mission: {
            select: {
              id: true,
              date: true,
              plannedStart: true,
              plannedEnd: true,
              client: { select: { id: true, name: true } },
              service: { select: { id: true, name: true } },
            },
          },
        },
      }),
      prisma.timeEntry.count({ where }),
    ]);
    res.json({ data: rows, total, page: q.page, pageSize: q.pageSize });
  })
);

// ---------- Update (admin correction) ----------
router.put(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = parseIdParam(req);
    const body = parseBody(
      z.object({
        checkInAt: z.string().optional(),
        checkOutAt: z.string().optional(),
        breakMinutes: z.number().int().optional(),
        actualMinutes: z.number().int().optional(),
        deviationType: z
          .enum([
            'NONE',
            'LATE',
            'EARLY_END',
            'EXTRA_WORK',
            'CUSTOMER_ABSENT',
            'CANCELLED_ONSITE',
            'SICK_DURING',
            'EQUIPMENT_FAILURE',
          ])
          .optional(),
        deviationNote: z.string().nullish(),
      }),
      req
    );
    const userId = getUserId(req)!;
    const before = await prisma.timeEntry.findUnique({ where: { id } });
    if (!before) throw NotFound();
    const updated = await prisma.timeEntry.update({
      where: { id },
      data: {
        ...body,
        checkInAt: body.checkInAt ? new Date(body.checkInAt) : undefined,
        checkOutAt: body.checkOutAt ? new Date(body.checkOutAt) : undefined,
      },
    });
    await audit({ actorClerkId: userId, action: 'UPDATE', entityType: 'TimeEntry', entityId: id, before, after: updated });
    res.json(updated);
  })
);

// ---------- Approve / unapprove ----------
router.post(
  '/:id/approve',
  asyncHandler(async (req, res) => {
    const id = parseIdParam(req);
    const userId = getUserId(req)!;
    const updated = await prisma.timeEntry.update({
      where: { id },
      data: { adminApprovedAt: new Date(), adminApprovedBy: userId },
    });
    // If all time_entries on mission are approved → mission COMPLETED
    await maybeMarkComplete(updated.missionId);
    await audit({ actorClerkId: userId, action: 'APPROVE', entityType: 'TimeEntry', entityId: id });
    res.json(updated);
  })
);

router.post(
  '/:id/unapprove',
  asyncHandler(async (req, res) => {
    const id = parseIdParam(req);
    const userId = getUserId(req)!;
    const updated = await prisma.timeEntry.update({
      where: { id },
      data: { adminApprovedAt: null, adminApprovedBy: null },
    });
    await audit({ actorClerkId: userId, action: 'UNAPPROVE', entityType: 'TimeEntry', entityId: id });
    res.json(updated);
  })
);

router.post(
  '/bulk-approve',
  asyncHandler(async (req, res) => {
    const body = parseBody(z.object({ ids: z.array(z.number().int()).min(1) }), req);
    const userId = getUserId(req)!;
    const result = await prisma.timeEntry.updateMany({
      where: { id: { in: body.ids }, adminApprovedAt: null },
      data: { adminApprovedAt: new Date(), adminApprovedBy: userId },
    });
    // Re-check each mission
    const missions = await prisma.timeEntry.findMany({
      where: { id: { in: body.ids } },
      select: { missionId: true },
      distinct: ['missionId'],
    });
    for (const m of missions) await maybeMarkComplete(m.missionId);
    res.json({ approved: result.count });
  })
);

async function maybeMarkComplete(missionId: number) {
  const mission = await prisma.mission.findUnique({
    where: { id: missionId },
    include: {
      assignments: true,
      timeEntries: true,
    },
  });
  if (!mission) return;
  if (mission.assignments.length === 0) return;
  const allApproved = mission.assignments.every((a) =>
    mission.timeEntries.some((t) => t.employeeId === a.employeeId && t.adminApprovedAt)
  );
  if (allApproved && mission.status !== 'COMPLETED') {
    await prisma.mission.update({
      where: { id: missionId },
      data: { status: 'COMPLETED', version: { increment: 1 } },
    });
  }
}

export default router;
