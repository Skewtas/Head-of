import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../_lib/prisma.js';
import { requireAuth, getUserId } from '../_lib/auth.js';
import { asyncHandler, NotFound, BadRequest } from '../_lib/errors.js';
import { parseBody, parseIdParam, parseQuery } from '../_lib/validation.js';
import { audit } from '../_lib/audit.js';
import {
  getClientAlertsForUser,
  clientsWithBlockerAlerts,
} from '../_lib/alerts.js';

const router = Router();
router.use(requireAuth);

// ---------- Schemas ----------

const AddressInput = z.object({
  type: z.enum(['INVOICE', 'SERVICE']),
  street: z.string().min(1),
  zip: z.string().min(1),
  city: z.string().min(1),
  doorCode: z.string().nullish(),
  parkingInfo: z.string().nullish(),
  lat: z.number().nullish(),
  lng: z.number().nullish(),
  isDefault: z.boolean().optional(),
});

const ClientCreate = z.object({
  clientNumber: z.string().min(1).optional(),
  type: z.enum(['PRIVATE', 'COMPANY']).default('PRIVATE'),
  name: z.string().min(1),
  orgNumber: z.string().nullish(),
  personalNumber: z.string().nullish(),
  phone: z.string().nullish(),
  email: z.string().email().nullish(),
  preferredCommunication: z.string().nullish(),
  rutEligible: z.boolean().default(false),
  rutShare: z.number().nullish(),
  rutPersonalNumber: z.string().nullish(),
  priceModel: z.enum(['HOURLY', 'FIXED', 'SUBSCRIPTION']).default('HOURLY'),
  fortnoxCustomerId: z.string().nullish(),
  invoiceMethod: z.enum(['EMAIL', 'POST', 'E_INVOICE']).default('EMAIL'),
  paymentTermsDays: z.number().int().default(30),
  status: z.enum(['PROSPECT', 'ACTIVE', 'PAUSED', 'TERMINATED']).default('ACTIVE'),
  source: z.string().nullish(),
  addresses: z.array(AddressInput).optional(),
});

const ClientUpdate = ClientCreate.partial().omit({ addresses: true });

const ListQuery = z.object({
  q: z.string().optional(),
  status: z.enum(['PROSPECT', 'ACTIVE', 'PAUSED', 'TERMINATED']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});

// ---------- List ----------

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const q = parseQuery(ListQuery, req);
    const where: any = { deletedAt: null };
    if (q.status) where.status = q.status;
    if (q.q) {
      where.OR = [
        { name: { contains: q.q, mode: 'insensitive' } },
        { clientNumber: { contains: q.q, mode: 'insensitive' } },
        { orgNumber: { contains: q.q } },
        { email: { contains: q.q, mode: 'insensitive' } },
      ];
    }
    const [rows, total] = await Promise.all([
      prisma.client.findMany({
        where,
        orderBy: { name: 'asc' },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
      prisma.client.count({ where }),
    ]);
    const blockerSet = await clientsWithBlockerAlerts(rows.map((r) => r.id));
    res.json({
      data: rows.map((r) => ({ ...r, hasBlockerAlert: blockerSet.has(r.id) })),
      total,
      page: q.page,
      pageSize: q.pageSize,
    });
  })
);

// ---------- Get one ----------

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = parseIdParam(req);
    const userId = getUserId(req)!;
    const client = await prisma.client.findFirst({
      where: { id, deletedAt: null },
      include: { addresses: true },
    });
    if (!client) throw NotFound();
    const alerts = await getClientAlertsForUser(id, userId);
    res.json({ ...client, alerts });
  })
);

// ---------- Create ----------

async function nextClientNumber(): Promise<string> {
  const latest = await prisma.client.findFirst({
    where: { clientNumber: { startsWith: 'C-' } },
    orderBy: { createdAt: 'desc' },
    select: { clientNumber: true },
  });
  const n = latest ? parseInt(latest.clientNumber.replace('C-', ''), 10) + 1 : 1001;
  return `C-${n}`;
}

router.post(
  '/',
  asyncHandler(async (req, res) => {
    const body = parseBody(ClientCreate, req);
    const userId = getUserId(req)!;
    const clientNumber = body.clientNumber ?? (await nextClientNumber());
    const { addresses, ...clientData } = body;
    const created = await prisma.client.create({
      data: {
        ...clientData,
        clientNumber,
        addresses: addresses ? { create: addresses } : undefined,
      },
      include: { addresses: true },
    });
    await audit({
      actorClerkId: userId,
      action: 'CREATE',
      entityType: 'Client',
      entityId: created.id,
      after: created,
    });
    res.status(201).json(created);
  })
);

// ---------- Update ----------

router.put(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = parseIdParam(req);
    const body = parseBody(ClientUpdate, req);
    const userId = getUserId(req)!;
    const before = await prisma.client.findFirst({ where: { id, deletedAt: null } });
    if (!before) throw NotFound();
    const updated = await prisma.client.update({
      where: { id },
      data: body,
      include: { addresses: true },
    });
    await audit({
      actorClerkId: userId,
      action: 'UPDATE',
      entityType: 'Client',
      entityId: id,
      before,
      after: updated,
    });
    res.json(updated);
  })
);

// ---------- Soft delete ----------

router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = parseIdParam(req);
    const userId = getUserId(req)!;
    const client = await prisma.client.findFirst({ where: { id, deletedAt: null } });
    if (!client) throw NotFound();
    await prisma.client.update({
      where: { id },
      data: { deletedAt: new Date(), status: 'TERMINATED' },
    });
    await audit({
      actorClerkId: userId,
      action: 'DELETE',
      entityType: 'Client',
      entityId: id,
      before: client,
    });
    res.status(204).end();
  })
);

// ---------- Addresses ----------

router.post(
  '/:id/addresses',
  asyncHandler(async (req, res) => {
    const clientId = parseIdParam(req);
    const body = parseBody(AddressInput, req);
    const created = await prisma.clientAddress.create({
      data: { ...body, clientId },
    });
    res.status(201).json(created);
  })
);

router.put(
  '/:id/addresses/:addressId',
  asyncHandler(async (req, res) => {
    const clientId = parseIdParam(req);
    const addressId = parseIdParam(req, 'addressId');
    const body = parseBody(AddressInput.partial(), req);
    const addr = await prisma.clientAddress.findFirst({
      where: { id: addressId, clientId },
    });
    if (!addr) throw NotFound();
    const updated = await prisma.clientAddress.update({
      where: { id: addressId },
      data: body,
    });
    res.json(updated);
  })
);

router.delete(
  '/:id/addresses/:addressId',
  asyncHandler(async (req, res) => {
    const clientId = parseIdParam(req);
    const addressId = parseIdParam(req, 'addressId');
    const addr = await prisma.clientAddress.findFirst({
      where: { id: addressId, clientId },
    });
    if (!addr) throw NotFound();
    await prisma.clientAddress.delete({ where: { id: addressId } });
    res.status(204).end();
  })
);

// ---------- Alerts ----------

const AlertInput = z.object({
  severity: z.enum(['INFO', 'WARNING', 'BLOCKER']).default('WARNING'),
  category: z.enum(['ECONOMY', 'CREDIT', 'PAYMENT', 'BEHAVIOR', 'SAFETY', 'OTHER']),
  title: z.string().min(1),
  body: z.string().min(1),
});

router.get(
  '/:id/alerts',
  asyncHandler(async (req, res) => {
    const clientId = parseIdParam(req);
    const userId = getUserId(req)!;
    const alerts = await getClientAlertsForUser(clientId, userId);
    res.json(alerts);
  })
);

router.post(
  '/:id/alerts',
  asyncHandler(async (req, res) => {
    const clientId = parseIdParam(req);
    const body = parseBody(AlertInput, req);
    const userId = getUserId(req)!;
    const client = await prisma.client.findFirst({ where: { id: clientId, deletedAt: null } });
    if (!client) throw NotFound();
    const created = await prisma.clientAlert.create({
      data: { ...body, clientId, createdBy: userId },
    });
    await audit({
      actorClerkId: userId,
      action: 'CREATE',
      entityType: 'ClientAlert',
      entityId: created.id,
      after: created,
    });
    res.status(201).json(created);
  })
);

router.put(
  '/:id/alerts/:alertId',
  asyncHandler(async (req, res) => {
    const clientId = parseIdParam(req);
    const alertId = parseIdParam(req, 'alertId');
    const body = parseBody(AlertInput.partial().extend({ active: z.boolean().optional() }), req);
    const userId = getUserId(req)!;
    const alert = await prisma.clientAlert.findFirst({ where: { id: alertId, clientId } });
    if (!alert) throw NotFound();
    const updated = await prisma.clientAlert.update({
      where: { id: alertId },
      data: body,
    });
    // Bumping content → invalidate prior acks so users re-read
    if (body.title || body.body || body.severity) {
      await prisma.clientAlertAcknowledgement.deleteMany({ where: { alertId } });
    }
    await audit({
      actorClerkId: userId,
      action: 'UPDATE',
      entityType: 'ClientAlert',
      entityId: alertId,
      before: alert,
      after: updated,
    });
    res.json(updated);
  })
);

router.post(
  '/:id/alerts/:alertId/acknowledge',
  asyncHandler(async (req, res) => {
    const clientId = parseIdParam(req);
    const alertId = parseIdParam(req, 'alertId');
    const userId = getUserId(req)!;
    const alert = await prisma.clientAlert.findFirst({ where: { id: alertId, clientId, active: true } });
    if (!alert) throw NotFound();
    const ack = await prisma.clientAlertAcknowledgement.upsert({
      where: { alertId_userClerkId: { alertId, userClerkId: userId } },
      create: { alertId, userClerkId: userId },
      update: { acknowledgedAt: new Date() },
    });
    res.json(ack);
  })
);

router.delete(
  '/:id/alerts/:alertId',
  asyncHandler(async (req, res) => {
    const clientId = parseIdParam(req);
    const alertId = parseIdParam(req, 'alertId');
    const userId = getUserId(req)!;
    const alert = await prisma.clientAlert.findFirst({ where: { id: alertId, clientId } });
    if (!alert) throw NotFound();
    await prisma.clientAlert.update({ where: { id: alertId }, data: { active: false } });
    await audit({
      actorClerkId: userId,
      action: 'DEACTIVATE',
      entityType: 'ClientAlert',
      entityId: alertId,
      before: alert,
    });
    res.status(204).end();
  })
);

export default router;
