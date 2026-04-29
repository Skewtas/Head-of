import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../_lib/prisma.js';
import { requireAuth, getUserId } from '../_lib/auth.js';
import { asyncHandler, NotFound, BadRequest } from '../_lib/errors.js';
import { parseBody, parseIdParam, parseQuery } from '../_lib/validation.js';
import { audit } from '../_lib/audit.js';
import { generateMissionsForLine } from '../_lib/missionGenerator.js';

const router = Router();
router.use(requireAuth);

const AgreementCreate = z.object({
  clientId: z.number().int(),
  teamId: z.number().int().nullish(),
  status: z.enum(['DRAFT', 'QUOTED', 'ACTIVE', 'PAUSED', 'TERMINATED', 'ARCHIVED']).default('DRAFT'),
  validFrom: z.string().nullish(),
  validTo: z.string().nullish(),
  invoiceAddressId: z.number().int().nullish(),
  serviceAddressId: z.number().int().nullish(),
  paymentTermsDays: z.number().int().nullish(),
  cancellationPolicyHours: z.number().int().default(24),
  cancellationFeePercent: z.number().int().default(50),
  internalNotes: z.string().nullish(),
});
const AgreementUpdate = AgreementCreate.partial().omit({ clientId: true });

const LineCreate = z.object({
  serviceId: z.number().int(),
  rrule: z.string().min(1),
  defaultStartTime: z.string().regex(/^\d{2}:\d{2}$/),
  defaultDurationMinutes: z.number().int().positive(),
  plannedCrewSize: z.number().int().default(1),
  preferredEmployeeIds: z.array(z.number().int()).default([]),
  priceRule: z.enum(['HOURLY', 'FIXED_PER_VISIT', 'INCLUDED_IN_MONTHLY']).default('HOURLY'),
  hourlyRateCents: z.number().int().nullish(),
  fixedPriceCents: z.number().int().nullish(),
  validFrom: z.string().nullish(),
  validTo: z.string().nullish(),
  customerInstructions: z.string().nullish(),
});
const LineUpdate = LineCreate.partial();

const ListQuery = z.object({
  clientId: z.coerce.number().int().optional(),
  status: z.enum(['DRAFT', 'QUOTED', 'ACTIVE', 'PAUSED', 'TERMINATED', 'ARCHIVED']).optional(),
  teamId: z.coerce.number().int().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});

async function nextAgreementNumber(): Promise<string> {
  const latest = await prisma.agreement.findFirst({
    where: { agreementNumber: { startsWith: 'A-' } },
    orderBy: { createdAt: 'desc' },
    select: { agreementNumber: true },
  });
  const n = latest ? parseInt(latest.agreementNumber.replace('A-', ''), 10) + 1 : 1001;
  return `A-${n}`;
}

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const q = parseQuery(ListQuery, req);
    const where: any = {};
    if (q.clientId) where.clientId = q.clientId;
    if (q.status) where.status = q.status;
    if (q.teamId) where.teamId = q.teamId;
    const [rows, total] = await Promise.all([
      prisma.agreement.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
        include: { client: { select: { id: true, name: true, clientNumber: true } }, _count: { select: { lines: true } } },
      }),
      prisma.agreement.count({ where }),
    ]);
    res.json({ data: rows, total, page: q.page, pageSize: q.pageSize });
  })
);

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = parseIdParam(req);
    const ag = await prisma.agreement.findUnique({
      where: { id },
      include: {
        client: true,
        team: true,
        invoiceAddress: true,
        serviceAddress: true,
        lines: { include: { service: true } },
      },
    });
    if (!ag) throw NotFound();
    res.json(ag);
  })
);

router.post(
  '/',
  asyncHandler(async (req, res) => {
    const body = parseBody(AgreementCreate, req);
    const userId = getUserId(req)!;
    const agreementNumber = await nextAgreementNumber();
    const created = await prisma.agreement.create({
      data: {
        ...body,
        agreementNumber,
        validFrom: body.validFrom ? new Date(body.validFrom) : undefined,
        validTo: body.validTo ? new Date(body.validTo) : undefined,
      },
    });
    await audit({ actorClerkId: userId, action: 'CREATE', entityType: 'Agreement', entityId: created.id, after: created });
    res.status(201).json(created);
  })
);

router.put(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = parseIdParam(req);
    const body = parseBody(AgreementUpdate, req);
    const userId = getUserId(req)!;
    const before = await prisma.agreement.findUnique({ where: { id } });
    if (!before) throw NotFound();
    const updated = await prisma.agreement.update({
      where: { id },
      data: {
        ...body,
        validFrom: body.validFrom ? new Date(body.validFrom) : undefined,
        validTo: body.validTo ? new Date(body.validTo) : undefined,
      },
    });
    await audit({ actorClerkId: userId, action: 'UPDATE', entityType: 'Agreement', entityId: id, before, after: updated });
    res.json(updated);
  })
);

router.post(
  '/:id/pause',
  asyncHandler(async (req, res) => {
    const id = parseIdParam(req);
    const body = parseBody(z.object({ fromDate: z.string(), toDate: z.string().nullish() }), req);
    const userId = getUserId(req)!;
    await prisma.agreement.update({ where: { id }, data: { status: 'PAUSED' } });
    // Cancel PLANNED missions in the paused window
    const from = new Date(body.fromDate);
    const to = body.toDate ? new Date(body.toDate) : new Date('2099-12-31');
    const result = await prisma.mission.updateMany({
      where: {
        agreementLine: { agreementId: id },
        date: { gte: from, lte: to },
        status: { in: ['PLANNED', 'ASSIGNED'] },
      },
      data: {
        status: 'CANCELLED',
        cancellationReason: 'agreement_paused',
        cancelledAt: new Date(),
        cancelledBy: userId,
      },
    });
    res.json({ cancelled: result.count });
  })
);

router.post(
  '/:id/resume',
  asyncHandler(async (req, res) => {
    const id = parseIdParam(req);
    await prisma.agreement.update({ where: { id }, data: { status: 'ACTIVE' } });
    res.json({ ok: true });
  })
);

router.post(
  '/:id/terminate',
  asyncHandler(async (req, res) => {
    const id = parseIdParam(req);
    const body = parseBody(z.object({ effectiveDate: z.string().optional() }), req);
    const userId = getUserId(req)!;
    const effective = body.effectiveDate ? new Date(body.effectiveDate) : new Date();
    await prisma.agreement.update({
      where: { id },
      data: { status: 'TERMINATED', closedAt: new Date(), validTo: effective },
    });
    const result = await prisma.mission.updateMany({
      where: {
        agreementLine: { agreementId: id },
        date: { gt: effective },
        status: { in: ['PLANNED', 'ASSIGNED'] },
      },
      data: {
        status: 'CANCELLED',
        cancellationReason: 'agreement_terminated',
        cancelledAt: new Date(),
        cancelledBy: userId,
      },
    });
    res.json({ cancelled: result.count });
  })
);

// ---------- Lines ----------

router.post(
  '/:id/lines',
  asyncHandler(async (req, res) => {
    const agreementId = parseIdParam(req);
    const body = parseBody(LineCreate, req);
    const created = await prisma.agreementLine.create({
      data: {
        ...body,
        agreementId,
        validFrom: body.validFrom ? new Date(body.validFrom) : undefined,
        validTo: body.validTo ? new Date(body.validTo) : undefined,
      },
    });
    res.status(201).json(created);
  })
);

router.put(
  '/:id/lines/:lineId',
  asyncHandler(async (req, res) => {
    const agreementId = parseIdParam(req);
    const lineId = parseIdParam(req, 'lineId');
    const body = parseBody(LineUpdate, req);
    const line = await prisma.agreementLine.findFirst({ where: { id: lineId, agreementId } });
    if (!line) throw NotFound();
    const updated = await prisma.agreementLine.update({
      where: { id: lineId },
      data: {
        ...body,
        validFrom: body.validFrom ? new Date(body.validFrom) : undefined,
        validTo: body.validTo ? new Date(body.validTo) : undefined,
      },
    });
    res.json(updated);
  })
);

router.delete(
  '/:id/lines/:lineId',
  asyncHandler(async (req, res) => {
    const agreementId = parseIdParam(req);
    const lineId = parseIdParam(req, 'lineId');
    const line = await prisma.agreementLine.findFirst({ where: { id: lineId, agreementId } });
    if (!line) throw NotFound();
    await prisma.agreementLine.update({ where: { id: lineId }, data: { status: 'ENDED', validTo: new Date() } });
    res.status(204).end();
  })
);

// Materialize missions for a single line or all lines in an agreement
router.post(
  '/:id/generate-missions',
  asyncHandler(async (req, res) => {
    const agreementId = parseIdParam(req);
    const body = parseBody(
      z.object({ until: z.string(), lineId: z.number().int().optional() }),
      req
    );
    const until = new Date(body.until);
    if (isNaN(until.getTime())) throw BadRequest('Invalid until date');
    const from = new Date();
    from.setHours(0, 0, 0, 0);

    const lines = body.lineId
      ? await prisma.agreementLine.findMany({ where: { id: body.lineId, agreementId } })
      : await prisma.agreementLine.findMany({ where: { agreementId, status: 'ACTIVE' } });

    const results = [] as any[];
    for (const line of lines) {
      results.push(await generateMissionsForLine(line.id, from, until));
    }
    res.json(results);
  })
);

export default router;
