import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../_lib/prisma.js';
import { requireAuth, getUserId } from '../_lib/auth.js';
import { asyncHandler, NotFound, BadRequest, Conflict } from '../_lib/errors.js';
import { parseBody, parseIdParam, parseQuery } from '../_lib/validation.js';
import { audit } from '../_lib/audit.js';

const router = Router();
router.use(requireAuth);

const ListQuery = z.object({
  from: z.string().optional(),
  to: z.string().optional(),
  teamId: z.coerce.number().int().optional(),
  employeeId: z.coerce.number().int().optional(),
  clientId: z.coerce.number().int().optional(),
  status: z
    .enum(['PLANNED', 'ASSIGNED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'NO_SHOW'])
    .optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(500).default(200),
});

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const q = parseQuery(ListQuery, req);
    const where: any = {};
    if (q.from || q.to) {
      where.date = {};
      if (q.from) where.date.gte = new Date(q.from);
      if (q.to) where.date.lte = new Date(q.to);
    }
    if (q.teamId) where.teamId = q.teamId;
    if (q.clientId) where.clientId = q.clientId;
    if (q.status) where.status = q.status;
    if (q.employeeId) where.assignments = { some: { employeeId: q.employeeId } };

    const [rows, total] = await Promise.all([
      prisma.mission.findMany({
        where,
        orderBy: [{ date: 'asc' }, { plannedStart: 'asc' }],
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
        include: {
          client: { select: { id: true, name: true, clientNumber: true } },
          service: { select: { id: true, name: true } },
          assignments: { include: { employee: { select: { id: true, firstName: true, lastName: true } } } },
          _count: { select: { timeEntries: true } },
        },
      }),
      prisma.mission.count({ where }),
    ]);
    res.json({ data: rows, total, page: q.page, pageSize: q.pageSize });
  })
);

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = parseIdParam(req);
    const mission = await prisma.mission.findUnique({
      where: { id },
      include: {
        client: { include: { addresses: true } },
        service: true,
        team: true,
        agreementLine: { include: { agreement: true } },
        assignments: { include: { employee: true } },
        timeEntries: { include: { employee: { select: { id: true, firstName: true, lastName: true } } } },
        extras: true,
      },
    });
    if (!mission) throw NotFound();
    res.json(mission);
  })
);

// --- Create ad-hoc mission (no agreement_line) ---
const AdHocCreate = z.object({
  clientId: z.number().int(),
  serviceId: z.number().int(),
  teamId: z.number().int().nullish(),
  date: z.string(),
  plannedStart: z.string(),
  plannedEnd: z.string(),
  plannedCrewSize: z.number().int().default(1),
  customerInstructions: z.string().nullish(),
  internalNotes: z.string().nullish(),
});

router.post(
  '/',
  asyncHandler(async (req, res) => {
    const body = parseBody(AdHocCreate, req);
    const userId = getUserId(req)!;
    const start = new Date(body.plannedStart);
    const end = new Date(body.plannedEnd);
    if (end <= start) throw BadRequest('plannedEnd must be after plannedStart');
    const minutes = Math.round((end.getTime() - start.getTime()) / 60000);
    const created = await prisma.mission.create({
      data: {
        clientId: body.clientId,
        serviceId: body.serviceId,
        teamId: body.teamId ?? undefined,
        date: new Date(body.date),
        plannedStart: start,
        plannedEnd: end,
        plannedCrewSize: body.plannedCrewSize,
        plannedDurationMinutes: minutes,
        customerInstructions: body.customerInstructions ?? undefined,
        internalNotes: body.internalNotes ?? undefined,
        status: 'PLANNED',
      },
    });
    await audit({ actorClerkId: userId, action: 'CREATE', entityType: 'Mission', entityId: created.id, after: created });
    res.status(201).json(created);
  })
);

// --- Update (time/notes, optimistic lock) ---
const UpdateInput = z.object({
  plannedStart: z.string().optional(),
  plannedEnd: z.string().optional(),
  plannedCrewSize: z.number().int().optional(),
  customerInstructions: z.string().nullish(),
  internalNotes: z.string().nullish(),
  version: z.number().int(),
});

router.put(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = parseIdParam(req);
    const body = parseBody(UpdateInput, req);
    const userId = getUserId(req)!;
    const mission = await prisma.mission.findUnique({ where: { id } });
    if (!mission) throw NotFound();
    if (mission.version !== body.version) throw Conflict('Mission was modified, please reload');

    const data: any = {
      customerInstructions: body.customerInstructions,
      internalNotes: body.internalNotes,
      plannedCrewSize: body.plannedCrewSize,
      version: { increment: 1 },
    };
    if (body.plannedStart) data.plannedStart = new Date(body.plannedStart);
    if (body.plannedEnd) data.plannedEnd = new Date(body.plannedEnd);
    if (body.plannedStart && body.plannedEnd) {
      const s = new Date(body.plannedStart);
      const e = new Date(body.plannedEnd);
      if (e <= s) throw BadRequest('plannedEnd must be after plannedStart');
      data.plannedDurationMinutes = Math.round((e.getTime() - s.getTime()) / 60000);
      data.date = new Date(s.getFullYear(), s.getMonth(), s.getDate());
    }

    const updated = await prisma.mission.update({ where: { id }, data });
    await audit({ actorClerkId: userId, action: 'UPDATE', entityType: 'Mission', entityId: id, before: mission, after: updated });
    res.json(updated);
  })
);

// --- Assign ---
const AssignInput = z.object({
  employeeIds: z.array(z.number().int()).min(1),
  role: z.enum(['LEAD', 'MEMBER']).default('MEMBER'),
});

router.post(
  '/:id/assign',
  asyncHandler(async (req, res) => {
    const missionId = parseIdParam(req);
    const body = parseBody(AssignInput, req);
    const userId = getUserId(req)!;
    const mission = await prisma.mission.findUnique({ where: { id: missionId } });
    if (!mission) throw NotFound();
    if (['CANCELLED', 'COMPLETED'].includes(mission.status)) throw BadRequest('Mission is locked');

    // Conflict check: any of these employees already booked on an overlapping mission?
    const conflicts = await prisma.missionAssignment.findMany({
      where: {
        employeeId: { in: body.employeeIds },
        missionId: { not: missionId },
        mission: { status: { not: 'CANCELLED' } },
        AND: [
          { plannedStart: { lt: mission.plannedEnd } },
          { plannedEnd: { gt: mission.plannedStart } },
        ],
      },
      select: { employeeId: true, missionId: true },
    });
    if (conflicts.length > 0) {
      return res.status(409).json({
        error: 'Scheduling conflict',
        conflicts,
      });
    }

    // Absence check
    const absent = await prisma.absence.findMany({
      where: {
        employeeId: { in: body.employeeIds },
        affectsMissions: true,
        fromDate: { lte: mission.date },
        toDate: { gte: mission.date },
      },
      select: { employeeId: true },
    });
    if (absent.length > 0) {
      return res.status(409).json({
        error: 'Employee has absence',
        absent: absent.map((a) => a.employeeId),
      });
    }

    const results = [] as any[];
    for (const employeeId of body.employeeIds) {
      const link = await prisma.missionAssignment.upsert({
        where: { missionId_employeeId: { missionId, employeeId } },
        create: {
          missionId,
          employeeId,
          role: body.role,
          plannedStart: mission.plannedStart,
          plannedEnd: mission.plannedEnd,
        },
        update: { role: body.role },
      });
      results.push(link);
    }

    // Update mission status if fully assigned
    const assignmentCount = await prisma.missionAssignment.count({ where: { missionId } });
    if (mission.status === 'PLANNED' && assignmentCount >= mission.plannedCrewSize) {
      await prisma.mission.update({ where: { id: missionId }, data: { status: 'ASSIGNED', version: { increment: 1 } } });
    }
    await audit({ actorClerkId: userId, action: 'ASSIGN', entityType: 'Mission', entityId: missionId, after: results });
    res.json(results);
  })
);

router.delete(
  '/:id/assign/:employeeId',
  asyncHandler(async (req, res) => {
    const missionId = parseIdParam(req);
    const employeeId = parseIdParam(req, 'employeeId');
    const userId = getUserId(req)!;
    await prisma.missionAssignment.deleteMany({ where: { missionId, employeeId } });
    // Downgrade status if under-staffed
    const m = await prisma.mission.findUnique({ where: { id: missionId }, include: { _count: { select: { assignments: true } } } });
    if (m && m.status === 'ASSIGNED' && m._count.assignments < m.plannedCrewSize) {
      await prisma.mission.update({ where: { id: missionId }, data: { status: 'PLANNED', version: { increment: 1 } } });
    }
    await audit({ actorClerkId: userId, action: 'UNASSIGN', entityType: 'Mission', entityId: missionId, after: { employeeId } });
    res.status(204).end();
  })
);

// --- Cancel ---
router.post(
  '/:id/cancel',
  asyncHandler(async (req, res) => {
    const id = parseIdParam(req);
    const body = parseBody(z.object({ reason: z.string().min(1), billable: z.boolean().default(false) }), req);
    const userId = getUserId(req)!;
    const mission = await prisma.mission.findUnique({ where: { id } });
    if (!mission) throw NotFound();
    if (mission.status === 'COMPLETED') throw BadRequest('Completed missions cannot be cancelled');
    const updated = await prisma.mission.update({
      where: { id },
      data: {
        status: 'CANCELLED',
        cancellationReason: body.reason,
        cancelledAt: new Date(),
        cancelledBy: userId,
        billableCancellation: body.billable,
        version: { increment: 1 },
      },
    });
    await audit({ actorClerkId: userId, action: 'CANCEL', entityType: 'Mission', entityId: id, before: mission, after: updated });
    res.json(updated);
  })
);

// --- Reschedule (keep id, move time) ---
router.post(
  '/:id/reschedule',
  asyncHandler(async (req, res) => {
    const id = parseIdParam(req);
    const body = parseBody(
      z.object({ newStart: z.string(), newEnd: z.string() }),
      req
    );
    const userId = getUserId(req)!;
    const mission = await prisma.mission.findUnique({ where: { id } });
    if (!mission) throw NotFound();
    const start = new Date(body.newStart);
    const end = new Date(body.newEnd);
    if (end <= start) throw BadRequest('newEnd must be after newStart');

    const updated = await prisma.mission.update({
      where: { id },
      data: {
        plannedStart: start,
        plannedEnd: end,
        date: new Date(start.getFullYear(), start.getMonth(), start.getDate()),
        plannedDurationMinutes: Math.round((end.getTime() - start.getTime()) / 60000),
        version: { increment: 1 },
      },
    });
    // Keep assignments in sync
    await prisma.missionAssignment.updateMany({
      where: { missionId: id },
      data: { plannedStart: start, plannedEnd: end },
    });
    await audit({ actorClerkId: userId, action: 'RESCHEDULE', entityType: 'Mission', entityId: id, before: mission, after: updated });
    res.json(updated);
  })
);

// --- Duplicate ---
router.post(
  '/:id/duplicate',
  asyncHandler(async (req, res) => {
    const id = parseIdParam(req);
    const body = parseBody(z.object({ newDate: z.string() }), req);
    const userId = getUserId(req)!;
    const src = await prisma.mission.findUnique({ where: { id } });
    if (!src) throw NotFound();
    const newDate = new Date(body.newDate);
    const shift = newDate.getTime() - src.date.getTime();
    const copy = await prisma.mission.create({
      data: {
        agreementLineId: null, // ad-hoc duplicate
        clientId: src.clientId,
        serviceId: src.serviceId,
        teamId: src.teamId,
        date: newDate,
        plannedStart: new Date(src.plannedStart.getTime() + shift),
        plannedEnd: new Date(src.plannedEnd.getTime() + shift),
        plannedCrewSize: src.plannedCrewSize,
        plannedDurationMinutes: src.plannedDurationMinutes,
        customerInstructions: src.customerInstructions,
        internalNotes: src.internalNotes,
        status: 'PLANNED',
      },
    });
    await audit({ actorClerkId: userId, action: 'DUPLICATE', entityType: 'Mission', entityId: copy.id, after: copy });
    res.status(201).json(copy);
  })
);

// --- Bulk reassign (move multiple missions to another employee) ---
router.post(
  '/bulk-reassign',
  asyncHandler(async (req, res) => {
    const body = parseBody(
      z.object({
        missionIds: z.array(z.number().int()).min(1),
        fromEmployeeId: z.number().int(),
        toEmployeeId: z.number().int(),
      }),
      req
    );
    const updated = await prisma.$transaction(
      body.missionIds.map((mid) =>
        prisma.missionAssignment.updateMany({
          where: { missionId: mid, employeeId: body.fromEmployeeId },
          data: { employeeId: body.toEmployeeId },
        })
      )
    );
    res.json({ updatedCount: updated.reduce((a, r) => a + r.count, 0) });
  })
);

export default router;
