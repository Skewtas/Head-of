import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../_lib/prisma.js';
import { requireAuth, getUserId } from '../_lib/auth.js';
import { asyncHandler, NotFound } from '../_lib/errors.js';
import { parseBody, parseIdParam, parseQuery } from '../_lib/validation.js';

const router = Router();
router.use(requireAuth);

const NoteInput = z.object({
  resourceType: z.enum(['CLIENT', 'AGREEMENT', 'AGREEMENT_LINE', 'MISSION', 'EMPLOYEE', 'INVOICE', 'TICKET']),
  resourceId: z.number().int(),
  body: z.string().min(1),
  visibility: z.enum(['INTERNAL', 'MISSION', 'CLIENT_VISIBLE']).default('INTERNAL'),
});

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const q = parseQuery(
      z.object({
        resourceType: z.enum(['CLIENT', 'AGREEMENT', 'AGREEMENT_LINE', 'MISSION', 'EMPLOYEE', 'INVOICE', 'TICKET']),
        resourceId: z.coerce.number().int(),
      }),
      req
    );
    const rows = await prisma.note.findMany({
      where: { resourceType: q.resourceType, resourceId: q.resourceId },
      orderBy: { createdAt: 'desc' },
    });
    res.json(rows);
  })
);

router.post(
  '/',
  asyncHandler(async (req, res) => {
    const body = parseBody(NoteInput, req);
    const userId = getUserId(req)!;
    const created = await prisma.note.create({
      data: { ...body, author: userId },
    });
    res.status(201).json(created);
  })
);

router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = parseIdParam(req);
    const note = await prisma.note.findUnique({ where: { id } });
    if (!note) throw NotFound();
    await prisma.note.delete({ where: { id } });
    res.status(204).end();
  })
);

export default router;
