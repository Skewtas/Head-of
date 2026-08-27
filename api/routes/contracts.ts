/**
 * /api/contracts — Contract management CRUD.
 *
 * Behörighetsmodell (backend-enforced, aldrig bara frontend):
 *   - SUPERADMIN (bestäms via CONTRACT_SUPERADMIN_EMAILS env eller
 *     fallback ['mikaela.wigert@stodona.se']) → ser allt, kan allt.
 *   - Vanliga användare → ser bara:
 *       (a) kontrakt där ownerClerkId === deras clerk-id
 *       (b) kontrakt där ContractPermission ger dem READ+
 *   - Radera/dela: kräver ADMIN på just det kontraktet ELLER superadmin.
 */
import express, { Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../_lib/prisma.js';
import { requireAuth, getUserId } from '../_lib/auth.js';

const router = express.Router();
router.use(requireAuth);

const SUPERADMIN_EMAILS = (
  process.env.CONTRACT_SUPERADMIN_EMAILS || 'mikaela.wigert@stodona.se'
)
  .split(',')
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

// Clerk gick igenom i requireAuth; hämta email från req om det finns.
function getUserEmail(req: Request): string | null {
  const email = (req as any).auth?.sessionClaims?.email
    ?? (req as any).auth?.user?.emailAddresses?.[0]?.emailAddress
    ?? (req as any).userEmail;
  return email ? String(email).toLowerCase() : null;
}
function isSuperadmin(req: Request): boolean {
  const email = getUserEmail(req);
  return !!email && SUPERADMIN_EMAILS.includes(email);
}

/** Returnerar hela Contract-raden om användaren har åtkomst, annars null. */
async function accessibleContract(userId: string, req: Request, contractId: number) {
  if (isSuperadmin(req)) {
    return prisma.contract.findUnique({ where: { id: contractId } });
  }
  return prisma.contract.findFirst({
    where: {
      id: contractId,
      OR: [
        { ownerClerkId: userId },
        { permissions: { some: { clerkUserId: userId, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] } } },
      ],
    },
  });
}

// ─── LIST ────────────────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  const userId = getUserId(req)!;
  const q = z
    .object({
      status: z.string().optional(),
      category: z.string().optional(),
      companyId: z.coerce.number().optional(),
      search: z.string().optional(),
    })
    .parse(req.query);

  const baseWhere: any = {};
  if (q.status) baseWhere.status = q.status;
  if (q.category) baseWhere.category = q.category;
  if (q.companyId) baseWhere.ownCompanyId = q.companyId;
  if (q.search) baseWhere.title = { contains: q.search, mode: 'insensitive' };

  const where = isSuperadmin(req)
    ? baseWhere
    : {
        AND: [
          baseWhere,
          {
            OR: [
              { ownerClerkId: userId },
              {
                permissions: {
                  some: {
                    clerkUserId: userId,
                    OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
                  },
                },
              },
            ],
          },
        ],
      };

  const contracts = await prisma.contract.findMany({
    where,
    include: {
      person: true,
      ownCompany: true,
      _count: { select: { signers: true, versions: true, reminders: true } },
    },
    orderBy: [{ updatedAt: 'desc' }],
    take: 200,
  });
  res.json({ data: contracts, isSuperadmin: isSuperadmin(req) });
});

// ─── DASHBOARD STATS ─────────────────────────────────────────────────────
router.get('/stats', async (req, res) => {
  const userId = getUserId(req)!;
  const scopeWhere = isSuperadmin(req)
    ? {}
    : {
        OR: [
          { ownerClerkId: userId },
          { permissions: { some: { clerkUserId: userId } } },
        ],
      };

  const now = new Date();
  const soon = new Date(now.getTime() + 60 * 86_400_000);

  const [total, active, awaiting, expiring, expired] = await Promise.all([
    prisma.contract.count({ where: scopeWhere }),
    prisma.contract.count({ where: { ...scopeWhere, status: { in: ['ACTIVE', 'SIGNED'] } } }),
    prisma.contract.count({ where: { ...scopeWhere, status: { in: ['SENT', 'PARTIALLY_SIGNED', 'READY_FOR_SIGNING'] } } }),
    prisma.contract.count({
      where: {
        ...scopeWhere,
        status: { in: ['ACTIVE', 'SIGNED'] },
        endDate: { gte: now, lte: soon },
      },
    }),
    prisma.contract.count({
      where: { ...scopeWhere, status: 'EXPIRED' },
    }),
  ]);

  res.json({ total, active, awaiting, expiring, expired });
});

// ─── DETAIL ──────────────────────────────────────────────────────────────
router.get('/:id(\\d+)', async (req, res) => {
  const userId = getUserId(req)!;
  const id = Number(req.params.id);
  const c = await accessibleContract(userId, req, id);
  if (!c) return res.status(404).json({ error: 'Not found or no access' });

  const full = await prisma.contract.findUnique({
    where: { id },
    include: {
      person: true,
      ownCompany: true,
      template: true,
      versions: { orderBy: { version: 'desc' } },
      signers: { orderBy: { signingOrder: 'asc' } },
      reminders: { orderBy: { reminderDate: 'asc' } },
      attachments: true,
      permissions: true,
    },
  });
  res.json(full);
});

// ─── CREATE ──────────────────────────────────────────────────────────────
const CreateContract = z.object({
  title: z.string().min(1),
  category: z.string(),
  ownCompanyId: z.number(),
  personId: z.number().optional().nullable(),
  externalCompanyName: z.string().optional().nullable(),
  externalCompanyOrgNr: z.string().optional().nullable(),
  startDate: z.string().optional().nullable(),
  endDate: z.string().optional().nullable(),
  noticeDate: z.string().optional().nullable(),
  probationEndDate: z.string().optional().nullable(),
  automaticRenewal: z.boolean().optional(),
  templateId: z.number().optional().nullable(),
  status: z.string().optional(),
  metadata: z.any().optional(),
});

router.post('/', async (req, res) => {
  const userId = getUserId(req)!;
  const body = CreateContract.parse(req.body);

  const contract = await prisma.contract.create({
    data: {
      title: body.title,
      category: body.category as any,
      status: (body.status || 'DRAFT') as any,
      ownCompanyId: body.ownCompanyId,
      personId: body.personId ?? null,
      externalCompanyName: body.externalCompanyName ?? null,
      externalCompanyOrgNr: body.externalCompanyOrgNr ?? null,
      startDate: body.startDate ? new Date(body.startDate) : null,
      endDate: body.endDate ? new Date(body.endDate) : null,
      noticeDate: body.noticeDate ? new Date(body.noticeDate) : null,
      probationEndDate: body.probationEndDate ? new Date(body.probationEndDate) : null,
      automaticRenewal: body.automaticRenewal ?? false,
      ownerClerkId: userId,
      templateId: body.templateId ?? null,
      metadata: body.metadata ?? undefined,
    },
  });
  await logAudit(userId, 'created', contract.id, { title: contract.title });
  res.status(201).json(contract);
});

// ─── UPDATE ──────────────────────────────────────────────────────────────
router.put('/:id(\\d+)', async (req, res) => {
  const userId = getUserId(req)!;
  const id = Number(req.params.id);
  const c = await accessibleContract(userId, req, id);
  if (!c) return res.status(404).json({ error: 'Not found or no access' });

  // Kolla EDIT-behörighet
  const canEdit = isSuperadmin(req) || c.ownerClerkId === userId || (
    await prisma.contractPermission.findFirst({
      where: {
        contractId: id,
        clerkUserId: userId,
        level: { in: ['EDIT', 'ADMIN'] },
      },
    })
  );
  if (!canEdit) return res.status(403).json({ error: 'Kräver EDIT-behörighet' });

  const patch: any = { ...req.body };
  for (const dateField of ['startDate', 'endDate', 'noticeDate', 'probationEndDate']) {
    if (patch[dateField] !== undefined) {
      patch[dateField] = patch[dateField] ? new Date(patch[dateField]) : null;
    }
  }
  // Explicit deny på ownerClerkId-change här
  delete patch.ownerClerkId;
  const updated = await prisma.contract.update({ where: { id }, data: patch });
  await logAudit(userId, 'updated', id, patch);
  res.json(updated);
});

// ─── DELETE (soft — arkivera) ───────────────────────────────────────────
router.delete('/:id(\\d+)', async (req, res) => {
  const userId = getUserId(req)!;
  const id = Number(req.params.id);
  const c = await accessibleContract(userId, req, id);
  if (!c) return res.status(404).json({ error: 'Not found or no access' });

  const canAdmin = isSuperadmin(req) || c.ownerClerkId === userId || (
    await prisma.contractPermission.findFirst({
      where: { contractId: id, clerkUserId: userId, level: 'ADMIN' },
    })
  );
  if (!canAdmin) return res.status(403).json({ error: 'Kräver ADMIN-behörighet' });

  await prisma.contract.update({
    where: { id },
    data: { archivedAt: new Date(), status: 'ARCHIVED' },
  });
  await logAudit(userId, 'archived', id, {});
  res.json({ ok: true });
});

// ─── PERMISSIONS ────────────────────────────────────────────────────────
router.post('/:id(\\d+)/permissions', async (req, res) => {
  const userId = getUserId(req)!;
  const id = Number(req.params.id);
  const c = await accessibleContract(userId, req, id);
  if (!c) return res.status(404).json({ error: 'Not found or no access' });

  const canGrant = isSuperadmin(req) || c.ownerClerkId === userId || (
    await prisma.contractPermission.findFirst({
      where: { contractId: id, clerkUserId: userId, level: 'ADMIN' },
    })
  );
  if (!canGrant) return res.status(403).json({ error: 'Kräver ADMIN på avtalet' });

  const body = z.object({
    clerkUserId: z.string(),
    level: z.enum(['READ', 'COMMENT', 'EDIT', 'ADMIN']),
    expiresAt: z.string().optional().nullable(),
  }).parse(req.body);

  const perm = await prisma.contractPermission.upsert({
    where: { contractId_clerkUserId: { contractId: id, clerkUserId: body.clerkUserId } },
    create: {
      contractId: id,
      clerkUserId: body.clerkUserId,
      level: body.level,
      grantedByClerkId: userId,
      expiresAt: body.expiresAt ? new Date(body.expiresAt) : null,
    },
    update: {
      level: body.level,
      grantedByClerkId: userId,
      expiresAt: body.expiresAt ? new Date(body.expiresAt) : null,
    },
  });
  await logAudit(userId, 'permission_granted', id, { grantee: body.clerkUserId, level: body.level });
  res.json(perm);
});

router.delete('/:id(\\d+)/permissions/:userId', async (req, res) => {
  const userId = getUserId(req)!;
  const id = Number(req.params.id);
  const target = String(req.params.userId);
  const c = await accessibleContract(userId, req, id);
  if (!c) return res.status(404).json({ error: 'Not found or no access' });

  const canGrant = isSuperadmin(req) || c.ownerClerkId === userId;
  if (!canGrant) return res.status(403).json({ error: 'Kräver ADMIN på avtalet' });

  await prisma.contractPermission.deleteMany({
    where: { contractId: id, clerkUserId: target },
  });
  await logAudit(userId, 'permission_revoked', id, { revoked: target });
  res.json({ ok: true });
});

// ─── OWN COMPANIES ──────────────────────────────────────────────────────
router.get('/companies', async (_req, res) => {
  const list = await prisma.ownCompany.findMany({ orderBy: { name: 'asc' } });
  res.json(list);
});

// ─── UPLOAD EXISTING CONTRACT (PDF/DOCX) ───────────────────────────────
/**
 * Skapar Contract + ContractPerson + Attachment + File i en transaktion.
 * Fil kan skickas antingen som base64 (för filer under ~4 MB) eller som
 * en tidigare uppladdad Blob-URL (för filer över 4,5 MB Vercel-caps).
 */
router.post('/upload', async (req, res) => {
  const userId = getUserId(req)!;
  const b = req.body as any;

  if (!b?.title || !b?.category || !b?.ownCompanyId) {
    return res.status(400).json({ error: 'title, category och ownCompanyId krävs' });
  }
  if (!b?.file?.filename) {
    return res.status(400).json({ error: 'file.filename krävs' });
  }

  const useBase64 = typeof b.file.base64 === 'string' && b.file.base64.length > 0;
  const useBlobUrl = typeof b.file.blobUrl === 'string' && b.file.blobUrl.length > 0;
  if (!useBase64 && !useBlobUrl) {
    return res.status(400).json({ error: 'file.base64 eller file.blobUrl krävs' });
  }

  const contentType = b.file.contentType || guessContentType(b.file.filename);
  if (contentType !== 'application/pdf' && !contentType.includes('word') && !contentType.includes('officedocument')) {
    return res.status(400).json({ error: `Otillåten filtyp: ${contentType}` });
  }

  let pureBase64: string | null = null;
  let sizeBytes = Number(b.file.sizeBytes) || 0;
  if (useBase64) {
    const raw = String(b.file.base64);
    const m = raw.match(/^data:[^;]+;base64,(.+)$/);
    pureBase64 = m ? m[1] : raw;
    sizeBytes = Math.floor((pureBase64.length * 3) / 4);
  }

  try {
    const contract = await prisma.$transaction(async (tx) => {
      let personId: number | null = null;
      if (typeof b.personId === 'number') {
        personId = b.personId;
      } else if (b.person && (b.person.firstName || b.person.lastName)) {
        const p = await tx.contractPerson.create({
          data: {
            firstName: (b.person.firstName || '').trim(),
            lastName: (b.person.lastName || '').trim(),
            personalNumber: b.person.personalNumber || null,
            email: b.person.email || null,
            phone: b.person.phone || null,
            address: b.person.address || null,
            postalCode: b.person.postalCode || null,
            city: b.person.city || null,
            linkedEmployeeId: b.person.linkedEmployeeId || null,
          },
        });
        personId = p.id;
      }

      const alreadySigned = !!b.alreadySigned;
      const status = alreadySigned
        ? (b.endDate && new Date(b.endDate).getTime() < Date.now() ? 'EXPIRED' : 'ACTIVE')
        : 'DRAFT';

      const c = await tx.contract.create({
        data: {
          title: String(b.title),
          category: String(b.category) as any,
          status: status as any,
          ownCompanyId: Number(b.ownCompanyId),
          personId,
          externalCompanyName: b.externalCompanyName || null,
          externalCompanyOrgNr: b.externalCompanyOrgNr || null,
          startDate: b.startDate ? new Date(b.startDate) : null,
          endDate: b.endDate ? new Date(b.endDate) : null,
          probationEndDate: b.probationEndDate ? new Date(b.probationEndDate) : null,
          ownerClerkId: userId,
          metadata: {
            uploadedExisting: true,
            alreadySigned,
            signedAt: b.signedAt ?? null,
            storage: useBlobUrl ? 'blob' : 'db',
          } as any,
        },
      });

      let fileId: string | null = null;
      let fileUrl: string;
      if (useBase64 && pureBase64) {
        const file = await tx.contractFile.create({
          data: { mime: contentType, data: pureBase64, sizeBytes },
        });
        fileId = file.id;
        fileUrl = `/api/contracts-file?id=${file.id}`;
      } else {
        fileUrl = b.file.blobUrl;
      }

      await tx.contractAttachment.create({
        data: {
          contractId: c.id,
          filename: b.file.filename,
          contentType,
          fileUrl,
          fileId,
          uploadedByClerkId: userId,
        },
      });

      await tx.auditLog.create({
        data: {
          actorClerkId: userId,
          action: 'uploaded_existing',
          entityType: 'Contract',
          entityId: String(c.id),
          after: {
            title: c.title,
            filename: b.file.filename,
            alreadySigned,
            storage: useBlobUrl ? 'blob' : 'db',
            sizeBytes,
          },
        },
      });

      return c;
    });

    res.status(201).json({ id: contract.id, title: contract.title, status: contract.status });
  } catch (err: any) {
    console.error('[contracts/upload] failed:', err.message, err.stack);
    res.status(500).json({ error: err.message || 'Uppladdning misslyckades' });
  }
});

function guessContentType(filename: string): string {
  const ext = filename.toLowerCase().split('.').pop();
  if (ext === 'pdf') return 'application/pdf';
  if (ext === 'docx') return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  if (ext === 'doc') return 'application/msword';
  return 'application/octet-stream';
}

// ─── TEMPLATES ──────────────────────────────────────────────────────────
router.get('/templates', async (req, res) => {
  const category = typeof req.query.category === 'string' ? req.query.category : undefined;
  const where: any = { archivedAt: null };
  if (category) where.category = category;
  const list = await prisma.contractTemplate.findMany({
    where,
    orderBy: [{ category: 'asc' }, { name: 'asc' }],
    include: { ownCompany: { select: { name: true } } },
  });
  res.json(list);
});

router.get('/templates/:id(\\d+)', async (req, res) => {
  const id = Number(req.params.id);
  const t = await prisma.contractTemplate.findUnique({ where: { id } });
  if (!t) return res.status(404).json({ error: 'Not found' });
  res.json(t);
});

// ─── SUBSTITUTE VARIABLES + CREATE FROM TEMPLATE ────────────────────────
/** Ersätter {{path.to.value}} med värden från context. Tomma vid saknad path. */
function substituteVariables(template: string, ctx: Record<string, any>): string {
  return template.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_, path: string) => {
    const parts = path.split('.');
    let cur: any = ctx;
    for (const p of parts) {
      if (cur == null || typeof cur !== 'object') return '';
      cur = cur[p];
    }
    if (cur == null) return '';
    return escapeHtmlText(String(cur));
  });
}

function escapeHtmlText(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** POST /preview-template — kör substitutionen utan att skapa något, för wizardens preview-steg. */
router.post('/preview-template', async (req, res) => {
  const body = z.object({
    templateId: z.number(),
    ownCompanyId: z.number(),
    person: z.record(z.any()).optional(),
    employment: z.record(z.any()).optional(),
  }).parse(req.body);

  const template = await prisma.contractTemplate.findUnique({ where: { id: body.templateId } });
  if (!template) return res.status(404).json({ error: 'Mall hittades inte' });
  const company = await prisma.ownCompany.findUnique({ where: { id: body.ownCompanyId } });
  if (!company) return res.status(404).json({ error: 'Företag hittades inte' });

  const p = body.person || {};
  const ctx = {
    today: new Date().toLocaleDateString('sv-SE'),
    employee: {
      firstName: p.firstName || '',
      lastName: p.lastName || '',
      personalNumber: p.personalNumber || '',
      email: p.email || '',
      address: [p.address, p.postalCode, p.city].filter(Boolean).join(', '),
    },
    company: {
      name: company.name,
      organizationNumber: company.organizationNumber,
      address: [company.address, company.postalCode, company.city].filter(Boolean).join(', '),
      signatoryName: company.signatoryName || '',
    },
    employment: body.employment || {},
  };
  res.json({ content: substituteVariables(template.content, ctx), templateName: template.name });
});

router.post('/from-template', async (req, res) => {
  const userId = getUserId(req)!;

  const body = z.object({
    templateId: z.number(),
    title: z.string().optional(),
    ownCompanyId: z.number(),
    person: z
      .object({
        firstName: z.string(),
        lastName: z.string(),
        personalNumber: z.string().optional().nullable(),
        email: z.string().optional().nullable(),
        phone: z.string().optional().nullable(),
        address: z.string().optional().nullable(),
        postalCode: z.string().optional().nullable(),
        city: z.string().optional().nullable(),
        linkedEmployeeId: z.number().optional().nullable(),
      })
      .optional(),
    personId: z.number().optional().nullable(),
    employment: z.record(z.any()).optional(),        // fri metadata — förs in i {{employment.*}}
    startDate: z.string().optional().nullable(),
    endDate: z.string().optional().nullable(),
    probationEndDate: z.string().optional().nullable(),
  }).parse(req.body);

  const template = await prisma.contractTemplate.findUnique({ where: { id: body.templateId } });
  if (!template) return res.status(404).json({ error: 'Mall hittades inte' });
  const company = await prisma.ownCompany.findUnique({ where: { id: body.ownCompanyId } });
  if (!company) return res.status(404).json({ error: 'Företag hittades inte' });

  const result = await prisma.$transaction(async (tx) => {
    // Skapa/koppla person
    let personId: number | null = body.personId ?? null;
    let personRow: any = null;
    if (personId) {
      personRow = await tx.contractPerson.findUnique({ where: { id: personId } });
    } else if (body.person) {
      personRow = await tx.contractPerson.create({
        data: {
          firstName: body.person.firstName,
          lastName: body.person.lastName,
          personalNumber: body.person.personalNumber ?? null,
          email: body.person.email ?? null,
          phone: body.person.phone ?? null,
          address: body.person.address ?? null,
          postalCode: body.person.postalCode ?? null,
          city: body.person.city ?? null,
          linkedEmployeeId: body.person.linkedEmployeeId ?? null,
        },
      });
      personId = personRow.id;
    }

    // Bygg context för variabelsubstitution
    const ctx = {
      today: new Date().toLocaleDateString('sv-SE'),
      employee: personRow
        ? {
            firstName: personRow.firstName,
            lastName: personRow.lastName,
            personalNumber: personRow.personalNumber || '',
            email: personRow.email || '',
            address: [personRow.address, personRow.postalCode, personRow.city].filter(Boolean).join(', '),
          }
        : {},
      company: {
        name: company.name,
        organizationNumber: company.organizationNumber,
        address: [company.address, company.postalCode, company.city].filter(Boolean).join(', '),
        signatoryName: company.signatoryName || '',
      },
      employment: body.employment ?? {},
    };
    const content = substituteVariables(template.content, ctx);

    // Titel-fallback: "<Mall> — <Namn>" eller mall-namnet
    const title = body.title
      || (personRow ? `${template.name} — ${personRow.firstName} ${personRow.lastName}` : template.name);

    // Skapa Contract
    const contract = await tx.contract.create({
      data: {
        title,
        category: template.category,
        status: 'DRAFT',
        ownCompanyId: body.ownCompanyId,
        personId,
        startDate: body.startDate ? new Date(body.startDate) : null,
        endDate: body.endDate ? new Date(body.endDate) : null,
        probationEndDate: body.probationEndDate ? new Date(body.probationEndDate) : null,
        ownerClerkId: userId,
        templateId: template.id,
        metadata: { employment: body.employment ?? {} } as any,
      },
    });

    // Skapa Version 1 med det ifyllda innehållet
    const version = await tx.contractVersion.create({
      data: {
        contractId: contract.id,
        version: 1,
        content,
        createdByClerkId: userId,
      },
    });

    await tx.auditLog.create({
      data: {
        actorClerkId: userId,
        action: 'created_from_template',
        entityType: 'Contract',
        entityId: String(contract.id),
        after: { templateId: template.id, templateName: template.name, title },
      },
    });

    return { contract, version };
  });

  res.status(201).json(result);
});

// ─── AUDIT-LOG-hjälpare ─────────────────────────────────────────────────
async function logAudit(userId: string, action: string, contractId: number, after: any) {
  try {
    await prisma.auditLog.create({
      data: {
        actorClerkId: userId,
        action,
        entityType: 'Contract',
        entityId: String(contractId),
        after,
      },
    });
  } catch (e: any) {
    console.error('[contracts] audit log failed:', e?.message);
  }
}

export default router;
