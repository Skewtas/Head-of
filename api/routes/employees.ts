import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../_lib/prisma.js';
import { requireAuth, getUserId } from '../_lib/auth.js';
import { asyncHandler, NotFound } from '../_lib/errors.js';
import { parseBody, parseIdParam, parseQuery } from '../_lib/validation.js';
import { audit } from '../_lib/audit.js';

const router = Router();
router.use(requireAuth);

const EmployeeCreate = z.object({
  clerkUserId: z.string().nullish(),
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  email: z.string().email().nullish(),
  phone: z.string().nullish(),
  personalNumber: z.string().nullish(),
  employmentType: z.enum(['PERMANENT', 'HOURLY', 'SUBCONTRACTOR']).default('HOURLY'),
  baseHourlyRateCents: z.number().int().default(0),
  obMultiplier: z.number().default(1),
  primaryTeamId: z.number().int().nullish(),
  homeLat: z.number().nullish(),
  homeLng: z.number().nullish(),
  tags: z.array(z.string()).default([]),
  fortnoxEmployeeId: z.string().nullish(),
  status: z.enum(['ACTIVE', 'INACTIVE']).default('ACTIVE'),
  teamIds: z.array(z.number().int()).optional(),
});
const EmployeeUpdate = EmployeeCreate.partial().omit({ teamIds: true });

const ListQuery = z.object({
  q: z.string().optional(),
  status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
  teamId: z.coerce.number().int().optional(),
  tag: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const q = parseQuery(ListQuery, req);
    const where: any = { deletedAt: null };
    if (q.status) where.status = q.status;
    if (q.tag) where.tags = { has: q.tag };
    if (q.teamId) where.teams = { some: { teamId: q.teamId } };
    if (q.q) {
      where.OR = [
        { firstName: { contains: q.q, mode: 'insensitive' } },
        { lastName: { contains: q.q, mode: 'insensitive' } },
        { email: { contains: q.q, mode: 'insensitive' } },
      ];
    }
    const [rows, total] = await Promise.all([
      prisma.employee.findMany({
        where,
        orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
        include: { teams: { include: { team: true } } },
      }),
      prisma.employee.count({ where }),
    ]);
    res.json({ data: rows, total, page: q.page, pageSize: q.pageSize });
  })
);

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = parseIdParam(req);
    const emp = await prisma.employee.findFirst({
      where: { id, deletedAt: null },
      include: { teams: { include: { team: true } } },
    });
    if (!emp) throw NotFound();
    res.json(emp);
  })
);

router.post(
  '/',
  asyncHandler(async (req, res) => {
    const body = parseBody(EmployeeCreate, req);
    const userId = getUserId(req)!;
    const { teamIds, ...data } = body;
    const created = await prisma.employee.create({
      data: {
        ...data,
        teams: teamIds
          ? {
              create: teamIds.map((teamId) => ({
                teamId,
                isPrimary: teamId === body.primaryTeamId,
              })),
            }
          : undefined,
      },
      include: { teams: true },
    });
    await audit({ actorClerkId: userId, action: 'CREATE', entityType: 'Employee', entityId: created.id, after: created });
    res.status(201).json(created);
  })
);

router.put(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = parseIdParam(req);
    const body = parseBody(EmployeeUpdate, req);
    const userId = getUserId(req)!;
    const before = await prisma.employee.findFirst({ where: { id, deletedAt: null } });
    if (!before) throw NotFound();
    const updated = await prisma.employee.update({ where: { id }, data: body });
    await audit({ actorClerkId: userId, action: 'UPDATE', entityType: 'Employee', entityId: id, before, after: updated });
    res.json(updated);
  })
);

router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = parseIdParam(req);
    const userId = getUserId(req)!;
    const emp = await prisma.employee.findFirst({ where: { id, deletedAt: null } });
    if (!emp) throw NotFound();
    await prisma.employee.update({ where: { id }, data: { deletedAt: new Date(), status: 'INACTIVE' } });
    await audit({ actorClerkId: userId, action: 'DELETE', entityType: 'Employee', entityId: id, before: emp });
    res.status(204).end();
  })
);

// Team memberships
router.post(
  '/:id/teams/:teamId',
  asyncHandler(async (req, res) => {
    const employeeId = parseIdParam(req);
    const teamId = parseIdParam(req, 'teamId');
    const body = parseBody(z.object({ isPrimary: z.boolean().optional() }), req);
    const link = await prisma.employeeTeam.upsert({
      where: { employeeId_teamId: { employeeId, teamId } },
      create: { employeeId, teamId, isPrimary: body.isPrimary ?? false },
      update: { isPrimary: body.isPrimary ?? false },
    });
    res.json(link);
  })
);

router.delete(
  '/:id/teams/:teamId',
  asyncHandler(async (req, res) => {
    const employeeId = parseIdParam(req);
    const teamId = parseIdParam(req, 'teamId');
    await prisma.employeeTeam.deleteMany({ where: { employeeId, teamId } });
    res.status(204).end();
  })
);

// Absences
const AbsenceInput = z.object({
  fromDate: z.string(),
  toDate: z.string(),
  type: z.enum(['SICK', 'VACATION', 'PARENTAL', 'VAB', 'COMP_TIME', 'OTHER']),
  affectsMissions: z.boolean().default(true),
  note: z.string().nullish(),
});

router.get(
  '/:id/absences',
  asyncHandler(async (req, res) => {
    const employeeId = parseIdParam(req);
    const rows = await prisma.absence.findMany({
      where: { employeeId },
      orderBy: { fromDate: 'desc' },
    });
    res.json(rows);
  })
);

router.post(
  '/:id/absences',
  asyncHandler(async (req, res) => {
    const employeeId = parseIdParam(req);
    const body = parseBody(AbsenceInput, req);
    const userId = getUserId(req)!;
    const created = await prisma.absence.create({
      data: {
        employeeId,
        fromDate: new Date(body.fromDate),
        toDate: new Date(body.toDate),
        type: body.type,
        affectsMissions: body.affectsMissions,
        note: body.note ?? undefined,
      },
    });
    // Auto-unassign employee from affected PLANNED/ASSIGNED missions
    if (body.affectsMissions) {
      await prisma.missionAssignment.deleteMany({
        where: {
          employeeId,
          mission: {
            date: { gte: new Date(body.fromDate), lte: new Date(body.toDate) },
            status: { in: ['PLANNED', 'ASSIGNED'] },
          },
        },
      });
    }
    await audit({ actorClerkId: userId, action: 'CREATE', entityType: 'Absence', entityId: created.id, after: created });
    res.status(201).json(created);
  })
);

router.delete(
  '/:id/absences/:absenceId',
  asyncHandler(async (req, res) => {
    const employeeId = parseIdParam(req);
    const absenceId = parseIdParam(req, 'absenceId');
    await prisma.absence.deleteMany({ where: { id: absenceId, employeeId } });
    res.status(204).end();
  })
);

export default router;
