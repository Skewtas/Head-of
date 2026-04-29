import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../_lib/prisma.js';
import { requireAuth } from '../_lib/auth.js';
import { asyncHandler, NotFound } from '../_lib/errors.js';
import { parseBody, parseIdParam } from '../_lib/validation.js';

const router = Router();
router.use(requireAuth);

const TeamInput = z.object({
  name: z.string().min(1),
  regionCode: z.string().nullish(),
  status: z.string().default('ACTIVE'),
});

router.get(
  '/',
  asyncHandler(async (_req, res) => {
    const rows = await prisma.team.findMany({
      orderBy: { name: 'asc' },
      include: { _count: { select: { employees: true, missions: true } } },
    });
    res.json(rows);
  })
);

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = parseIdParam(req);
    const team = await prisma.team.findUnique({
      where: { id },
      include: { employees: { include: { employee: true } } },
    });
    if (!team) throw NotFound();
    res.json(team);
  })
);

router.post(
  '/',
  asyncHandler(async (req, res) => {
    const body = parseBody(TeamInput, req);
    const created = await prisma.team.create({ data: body });
    res.status(201).json(created);
  })
);

router.put(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = parseIdParam(req);
    const body = parseBody(TeamInput.partial(), req);
    const updated = await prisma.team.update({ where: { id }, data: body });
    res.json(updated);
  })
);

router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = parseIdParam(req);
    await prisma.team.update({ where: { id }, data: { status: 'INACTIVE' } });
    res.status(204).end();
  })
);

export default router;
