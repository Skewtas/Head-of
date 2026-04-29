import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../_lib/prisma.js';
import { requireAuth, getUserId } from '../_lib/auth.js';
import { asyncHandler, NotFound, BadRequest } from '../_lib/errors.js';
import { parseBody, parseIdParam, parseQuery } from '../_lib/validation.js';
import { audit } from '../_lib/audit.js';
import { generateInvoicesForPeriod } from '../_lib/invoicingService.js';
import { fortnoxRequest, FortnoxError } from '../_lib/fortnoxClient.js';
import { toFortnoxInvoicePayload, toFortnoxCustomerPayload } from '../_lib/fortnoxMappers.js';

const router = Router();
router.use(requireAuth);

// ---------- List ----------
const ListQuery = z.object({
  status: z
    .enum(['DRAFT', 'READY_FOR_REVIEW', 'APPROVED', 'SENT_TO_FORTNOX', 'PAID', 'FAILED'])
    .optional(),
  clientId: z.coerce.number().int().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
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
    if (q.from || q.to) {
      where.periodStart = {};
      if (q.from) where.periodStart.gte = new Date(q.from);
      if (q.to) where.periodStart.lte = new Date(q.to);
    }
    const [rows, total] = await Promise.all([
      prisma.invoice.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
        include: {
          client: { select: { id: true, name: true, clientNumber: true } },
          _count: { select: { lines: true } },
        },
      }),
      prisma.invoice.count({ where }),
    ]);
    res.json({ data: rows, total, page: q.page, pageSize: q.pageSize });
  })
);

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = parseIdParam(req);
    const inv = await prisma.invoice.findUnique({
      where: { id },
      include: { client: true, agreement: true, lines: true },
    });
    if (!inv) throw NotFound();
    res.json(inv);
  })
);

// ---------- Generate invoices for period ----------
router.post(
  '/generate',
  asyncHandler(async (req, res) => {
    const body = parseBody(
      z.object({
        periodStart: z.string(),
        periodEnd: z.string(),
        clientIds: z.array(z.number().int()).optional(),
      }),
      req
    );
    const userId = getUserId(req)!;
    const results = await generateInvoicesForPeriod({
      periodStart: new Date(body.periodStart),
      periodEnd: new Date(body.periodEnd),
      clientIds: body.clientIds,
    });
    await audit({
      actorClerkId: userId,
      action: 'GENERATE',
      entityType: 'InvoiceRun',
      entityId: `${body.periodStart}_${body.periodEnd}`,
      after: results,
    });
    res.json(results);
  })
);

// ---------- Approve & send ----------
router.post(
  '/:id/approve',
  asyncHandler(async (req, res) => {
    const id = parseIdParam(req);
    const userId = getUserId(req)!;
    const updated = await prisma.invoice.update({
      where: { id },
      data: { status: 'APPROVED', approvedBy: userId },
    });
    await audit({ actorClerkId: userId, action: 'APPROVE', entityType: 'Invoice', entityId: id });
    res.json(updated);
  })
);

/**
 * Push an APPROVED invoice to Fortnox.
 * Accepts { accessToken } so the existing Fortnox OAuth flow can supply it.
 */
router.post(
  '/:id/send',
  asyncHandler(async (req, res) => {
    const id = parseIdParam(req);
    const body = parseBody(z.object({ accessToken: z.string().min(1) }), req);
    const userId = getUserId(req)!;
    const invoice = await prisma.invoice.findUnique({
      where: { id },
      include: { client: true, lines: true },
    });
    if (!invoice) throw NotFound();
    if (invoice.status !== 'APPROVED') throw BadRequest('Invoice must be APPROVED before sending');
    if (invoice.fortnoxInvoiceId) throw BadRequest('Invoice already sent');

    // Ensure customer exists in Fortnox
    let fortnoxCustomerId = invoice.client.fortnoxCustomerId;
    if (!fortnoxCustomerId) {
      const cust = await fortnoxRequest(body.accessToken, {
        method: 'POST',
        path: '/customers',
        body: toFortnoxCustomerPayload(invoice.client),
        entityType: 'Customer',
        entityId: invoice.client.id,
      });
      fortnoxCustomerId = cust?.Customer?.CustomerNumber;
      if (fortnoxCustomerId) {
        await prisma.client.update({
          where: { id: invoice.client.id },
          data: { fortnoxCustomerId },
        });
      }
    }

    try {
      const payload = toFortnoxInvoicePayload(
        { ...invoice, client: { ...invoice.client, fortnoxCustomerId } } as any,
        { ...invoice.client, fortnoxCustomerId } as any
      );
      const result = await fortnoxRequest(body.accessToken, {
        method: 'POST',
        path: '/invoices',
        body: payload,
        entityType: 'Invoice',
        entityId: id,
      });
      const updated = await prisma.invoice.update({
        where: { id },
        data: {
          status: 'SENT_TO_FORTNOX',
          fortnoxInvoiceId: result?.Invoice?.DocumentNumber ?? null,
          fortnoxInvoiceNumber: result?.Invoice?.DocumentNumber ?? null,
          sentAt: new Date(),
          lastSyncError: null,
        },
      });
      await audit({ actorClerkId: userId, action: 'SEND', entityType: 'Invoice', entityId: id, after: updated });
      res.json(updated);
    } catch (err) {
      const msg = err instanceof FortnoxError ? `${err.status}: ${err.message}` : String(err);
      await prisma.invoice.update({
        where: { id },
        data: { status: 'FAILED', lastSyncError: msg },
      });
      throw err;
    }
  })
);

// ---------- Mark paid (manual or webhook) ----------
router.post(
  '/:id/mark-paid',
  asyncHandler(async (req, res) => {
    const id = parseIdParam(req);
    const userId = getUserId(req)!;
    const updated = await prisma.invoice.update({
      where: { id },
      data: { status: 'PAID', paidAt: new Date() },
    });
    await audit({ actorClerkId: userId, action: 'MARK_PAID', entityType: 'Invoice', entityId: id });
    res.json(updated);
  })
);

// ---------- Manual line adjustments (before approve) ----------
router.put(
  '/:id/lines/:lineId',
  asyncHandler(async (req, res) => {
    const id = parseIdParam(req);
    const lineId = parseIdParam(req, 'lineId');
    const body = parseBody(
      z.object({
        description: z.string().optional(),
        quantity: z.number().optional(),
        unitPriceCents: z.number().int().optional(),
      }),
      req
    );
    const invoice = await prisma.invoice.findUnique({ where: { id } });
    if (!invoice) throw NotFound();
    if (!['DRAFT', 'READY_FOR_REVIEW'].includes(invoice.status))
      throw BadRequest('Can only edit DRAFT/READY invoices');
    const line = await prisma.invoiceLine.findFirst({ where: { id: lineId, invoiceId: id } });
    if (!line) throw NotFound();
    const quantity = body.quantity ?? line.quantity;
    const unitPriceCents = body.unitPriceCents ?? line.unitPriceCents;
    const lineTotalCents = Math.round(quantity * unitPriceCents);
    const updated = await prisma.invoiceLine.update({
      where: { id: lineId },
      data: {
        description: body.description,
        quantity,
        unitPriceCents,
        lineTotalCents,
      },
    });
    await recalcInvoice(id);
    res.json(updated);
  })
);

async function recalcInvoice(invoiceId: number) {
  const lines = await prisma.invoiceLine.findMany({ where: { invoiceId } });
  const subtotalCents = lines.reduce((s, l) => s + l.lineTotalCents, 0);
  const rutCents = lines.reduce((s, l) => s + l.rutAmountCents, 0);
  const vatCents = Math.round(lines.reduce((s, l) => s + l.lineTotalCents * (l.vatRate / 100), 0));
  const totalCents = subtotalCents + vatCents - rutCents;
  await prisma.invoice.update({
    where: { id: invoiceId },
    data: { subtotalCents, rutCents, vatCents, totalCents },
  });
}

export default router;
