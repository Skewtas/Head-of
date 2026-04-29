import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../_lib/prisma.js';
import { requireAuth, getUserId } from '../_lib/auth.js';
import { asyncHandler, NotFound } from '../_lib/errors.js';
import { parseBody, parseIdParam, parseQuery } from '../_lib/validation.js';

const router = Router();
router.use(requireAuth);

const TicketCreate = z.object({
  clientId: z.number().int().nullish(),
  agreementId: z.number().int().nullish(),
  missionId: z.number().int().nullish(),
  type: z.enum(['COMPLAINT', 'QUESTION', 'FOLLOWUP', 'INTERNAL']).default('COMPLAINT'),
  subject: z.string().min(1),
  content: z.string().min(1),
  priority: z.number().int().default(3),
  assigneeEmployeeId: z.number().int().nullish(),
  reporter: z.string().nullish(),
});
const TicketUpdate = z.object({
  subject: z.string().optional(),
  content: z.string().optional(),
  status: z.enum(['OPEN', 'IN_PROGRESS', 'WAITING', 'RESOLVED', 'CLOSED']).optional(),
  priority: z.number().int().optional(),
  assigneeEmployeeId: z.number().int().nullish().optional(),
});

const ListQuery = z.object({
  status: z.enum(['OPEN', 'IN_PROGRESS', 'WAITING', 'RESOLVED', 'CLOSED']).optional(),
  clientId: z.coerce.number().int().optional(),
  assigneeEmployeeId: z.coerce.number().int().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const q = parseQuery(ListQuery, req);
    const where: any = {};
    if (q.status) where.status = q.status;
    if (q.clientId) where.clientId = q.clientId;
    if (q.assigneeEmployeeId) where.assigneeEmployeeId = q.assigneeEmployeeId;
    const [rows, total] = await Promise.all([
      prisma.ticket.findMany({
        where,
        orderBy: [{ priority: 'asc' }, { createdAt: 'desc' }],
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
        include: {
          client: { select: { id: true, name: true } },
          assignee: { select: { id: true, firstName: true, lastName: true } },
          _count: { select: { comments: true } },
        },
      }),
      prisma.ticket.count({ where }),
    ]);
    res.json({ data: rows, total });
  })
);

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = parseIdParam(req);
    const t = await prisma.ticket.findUnique({
      where: { id },
      include: {
        client: true,
        agreement: true,
        mission: true,
        assignee: true,
        comments: { orderBy: { createdAt: 'asc' } },
      },
    });
    if (!t) throw NotFound();
    res.json(t);
  })
);

router.post(
  '/',
  asyncHandler(async (req, res) => {
    const body = parseBody(TicketCreate, req);
    const userId = getUserId(req)!;
    const created = await prisma.ticket.create({
      data: {
        ...body,
        reporter: body.reporter ?? userId,
      },
    });
    res.status(201).json(created);
  })
);

router.put(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = parseIdParam(req);
    const body = parseBody(TicketUpdate, req);
    const existing = await prisma.ticket.findUnique({ where: { id } });
    if (!existing) throw NotFound();
    const updated = await prisma.ticket.update({
      where: { id },
      data: {
        ...body,
        resolvedAt: body.status === 'RESOLVED' || body.status === 'CLOSED' ? new Date() : undefined,
      },
    });
    res.json(updated);
  })
);

router.post(
  '/:id/comments',
  asyncHandler(async (req, res) => {
    const ticketId = parseIdParam(req);
    const body = parseBody(z.object({ body: z.string().min(1) }), req);
    const userId = getUserId(req)!;
    const comment = await prisma.ticketComment.create({
      data: { ticketId, author: userId, body: body.body },
    });
    res.status(201).json(comment);
  })
);

export default router;
