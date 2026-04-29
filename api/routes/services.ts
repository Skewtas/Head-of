import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../_lib/prisma.js';
import { requireAuth } from '../_lib/auth.js';
import { asyncHandler, NotFound } from '../_lib/errors.js';
import { parseBody, parseIdParam } from '../_lib/validation.js';

const router = Router();
router.use(requireAuth);

const ServiceInput = z.object({
  name: z.string().min(1),
  description: z.string().nullish(),
  defaultMinutes: z.number().int().default(60),
  defaultHourlyRateCents: z.number().int().default(0),
  category: z.string().nullish(),
  rutCategory: z.enum(['NONE', 'HOUSEHOLD', 'WINDOW', 'MOVING', 'GARDENING']).default('NONE'),
  fortnoxArticleId: z.string().nullish(),
  isBillable: z.boolean().default(true),
  isPayable: z.boolean().default(true),
  active: z.boolean().default(true),
});

router.get(
  '/',
  asyncHandler(async (_req, res) => {
    const rows = await prisma.service.findMany({ orderBy: { name: 'asc' } });
    res.json(rows);
  })
);

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = parseIdParam(req);
    const svc = await prisma.service.findUnique({ where: { id } });
    if (!svc) throw NotFound();
    res.json(svc);
  })
);

router.post(
  '/',
  asyncHandler(async (req, res) => {
    const body = parseBody(ServiceInput, req);
    const created = await prisma.service.create({ data: body });
    res.status(201).json(created);
  })
);

router.put(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = parseIdParam(req);
    const body = parseBody(ServiceInput.partial(), req);
    const updated = await prisma.service.update({ where: { id }, data: body });
    res.json(updated);
  })
);

router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = parseIdParam(req);
    await prisma.service.update({ where: { id }, data: { active: false } });
    res.status(204).end();
  })
);

export default router;
