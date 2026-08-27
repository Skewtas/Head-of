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
import { handleUpload, type HandleUploadBody } from '@vercel/blob/client';
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
      attachments: {
        select: { id: true, filename: true, contentType: true, fileUrl: true },
        orderBy: { createdAt: 'asc' },
      },
      _count: { select: { signers: true, versions: true, reminders: true, attachments: true } },
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

// ─── VERCEL BLOB CLIENT-UPLOAD TOKEN ───────────────────────────────────
/**
 * Genererar en signerad upload-URL som klienten sen laddar filen direkt
 * mot (kringgår Vercels 4,5 MB request-cap). Kräver BLOB_READ_WRITE_TOKEN.
 */
router.post('/blob-upload', async (req, res) => {
  const userId = getUserId(req)!;
  try {
    const jsonResponse = await handleUpload({
      body: req.body as HandleUploadBody,
      request: req as any,
      onBeforeGenerateToken: async () => ({
        allowedContentTypes: [
          'application/pdf',
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          'application/msword',
        ],
        maximumSizeInBytes: 50 * 1024 * 1024,
        tokenPayload: JSON.stringify({ userId }),
      }),
      onUploadCompleted: async ({ blob }) => {
        console.log('[contracts/blob-upload] done:', blob.url);
      },
    });
    return res.status(200).json(jsonResponse);
  } catch (err: any) {
    console.error('[contracts/blob-upload] failed:', err.message, err.stack);
    return res.status(400).json({ error: err.message || 'Blob token misslyckades' });
  }
});

// ─── OWN COMPANIES ──────────────────────────────────────────────────────
router.get('/companies', async (_req, res) => {
  const list = await prisma.ownCompany.findMany({ orderBy: { name: 'asc' } });
  res.json(list);
});

// ─── ANSTÄLLDA UTAN AKTIVT ANSTÄLLNINGSAVTAL ───────────────────────────
/**
 * Hämtar aktiva Timewave-anställda och korsreferar mot ContractPersons +
 * aktiva avtal. Returnerar dem som saknar ett aktivt/signerat anställnings-
 * kontrakt.
 */
router.get('/missing-employees', async (req, res) => {
  try {
    const baseUrl = process.env.APP_URL || `https://${req.headers.host}`;
    // Fetcha via vår Timewave-proxy — går genom befintlig token-refresh
    const r = await fetch(`${baseUrl}/api/timewave/employees?page[size]=200`);
    if (!r.ok) return res.status(502).json({ error: 'Kunde inte hämta anställda från Timewave' });
    const data = await r.json();
    const employees: any[] = (data.data || []).filter((e: any) => !e.deleted && e.status === 'active');

    // Hämta alla aktiva anställningsavtal + linked person
    const EMPLOYMENT_CATEGORIES = [
      'ANSTALLNINGSAVTAL',
      'PROVANSTALLNING',
      'TILLSVIDAREANSTALLNING',
      'VISSTIDSANSTALLNING',
      'TIMANSTALLNING',
    ];
    const activeContracts = await prisma.contract.findMany({
      where: {
        status: { in: ['ACTIVE', 'SIGNED', 'SENT', 'PARTIALLY_SIGNED'] },
        category: { in: EMPLOYMENT_CATEGORIES as any },
      },
      select: {
        id: true,
        endDate: true,
        person: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            personalNumber: true,
            timewaveEmployeeId: true,
          },
        },
      },
    });

    const now = Date.now();
    const covered = new Set<number>();
    const nameKeys = new Map<string, number>();  // normalized name → contract count
    const emailKeys = new Map<string, number>();
    const personalKeys = new Map<string, number>();
    for (const c of activeContracts) {
      // Räknas bara som "aktivt" om det inte är utgånget
      if (c.endDate && c.endDate.getTime() < now) continue;
      if (!c.person) continue;
      if (c.person.timewaveEmployeeId) covered.add(c.person.timewaveEmployeeId);
      const nk = normalizeName(c.person.firstName, c.person.lastName);
      if (nk) nameKeys.set(nk, (nameKeys.get(nk) ?? 0) + 1);
      if (c.person.email) emailKeys.set(c.person.email.toLowerCase(), (emailKeys.get(c.person.email.toLowerCase()) ?? 0) + 1);
      if (c.person.personalNumber) personalKeys.set(normalizePnr(c.person.personalNumber), 1);
    }

    const missing = employees
      .filter((e) => {
        if (covered.has(e.id)) return false;
        const nk = normalizeName(e.first_name || '', e.last_name || '');
        if (nk && nameKeys.get(nk)) return false;
        if (e.email && emailKeys.get(String(e.email).toLowerCase())) return false;
        if (e.personal_number && personalKeys.get(normalizePnr(String(e.personal_number)))) return false;
        return true;
      })
      .map((e) => ({
        timewaveEmployeeId: e.id,
        firstName: e.first_name || '',
        lastName: e.last_name || '',
        email: e.email || null,
        phone: e.mobile || e.phone || null,
        personalNumber: e.personal_number || null,
        startDate: e.employee_startdate || null,
        occupation: e.base_contract?.occupation ?? null,
      }))
      .sort((a, b) => (a.lastName + a.firstName).localeCompare(b.lastName + b.firstName));

    res.json({
      totalActive: employees.length,
      missing,
      missingCount: missing.length,
    });
  } catch (err: any) {
    console.error('[missing-employees] failed:', err.message);
    res.status(500).json({ error: err.message });
  }
});

function normalizeName(first: string, last: string): string {
  const n = `${first} ${last}`.toLowerCase().trim()
    .replace(/[åä]/g, 'a').replace(/ö/g, 'o').replace(/[éè]/g, 'e')
    .replace(/\s+/g, ' ');
  return n;
}
function normalizePnr(s: string): string {
  return s.replace(/[^0-9]/g, '');
}

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
            timewaveEmployeeId: b.person.timewaveEmployeeId || null,
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
    // Derived paragrafer är redan sanerad HTML — släpp igenom orört.
    // Övriga värden HTML-escapas.
    if (typeof cur === 'string' && cur.startsWith('__HTML__')) return cur.slice(8);
    return escapeHtmlText(String(cur));
  });
}

/** Bygger snake_case-context för Stodona Standard-mallen med derived paragrafer. */
function buildSubstitutionContext(
  company: { name: string; organizationNumber: string; address?: string | null; postalCode?: string | null; city?: string | null; signatoryName?: string | null },
  person: Record<string, any>,
  employment: Record<string, any>,
): Record<string, any> {
  const emp = employment || {};

  const formLabels: Record<string, string> = {
    TILLSVIDARE: 'Tillsvidareanställning',
    PROV: 'Provanställning',
    VISSTID: 'Visstidsanställning',
    TIM: 'Timanställning',
  };
  const form = String(emp.employment_form || emp.employmentForm || 'TILLSVIDARE').toUpperCase();
  const employmentFormLabel = formLabels[form] || 'Tillsvidareanställning';

  const startDate = emp.start_date || emp.startDate || '';
  const endDate = emp.end_date || emp.endDate || '';
  const probEnd = emp.probation_end_date || emp.probationEndDate || '';

  // §3 Anställningsform — HTML-block som substitueras in råtext (via __HTML__ prefix)
  let formParagraph = '';
  if (form === 'PROV') {
    formParagraph = `<p>Anställningen är en provanställning enligt 6 § lagen om anställningsskydd (LAS). Provanställningen gäller från och med <strong>${escapeHtmlText(startDate)}</strong> till och med <strong>${escapeHtmlText(probEnd)}</strong>. Om provanställningen inte avbryts senast två veckor före provperiodens utgång övergår anställningen automatiskt i en tillsvidareanställning. Både Arbetsgivaren och Arbetstagaren har rätt att avbryta provanställningen utan angivande av skäl med tillämpning av gällande varselregler.</p>`;
  } else if (form === 'VISSTID') {
    formParagraph = `<p>Anställningen är en visstidsanställning enligt gällande arbetsrättsliga regler. Anställningen gäller från och med <strong>${escapeHtmlText(startDate)}</strong> till och med <strong>${escapeHtmlText(endDate)}</strong>, då den upphör utan uppsägning. Anställningen kan inte avbrytas i förtid annat än enligt gällande lag och kollektivavtal.</p>`;
  } else if (form === 'TIM') {
    formParagraph = `<p>Anställningen är en timanställning (intermittent). Arbete utförs efter överenskommelse i varje enskilt fall. Arbetstagaren är inte skyldig att stå till Arbetsgivarens förfogande utanför de arbetstillfällen som överenskommits. Tillträdesdag är <strong>${escapeHtmlText(startDate)}</strong>.</p>`;
  } else {
    formParagraph = `<p>Anställningen är en tillsvidareanställning enligt lagen om anställningsskydd (LAS). Tillträdesdag är <strong>${escapeHtmlText(startDate)}</strong>.</p>`;
  }

  // §10 Lön
  const salary = emp.salary || emp.monthlySalary || '';
  const hourly = emp.hourly_rate || emp.hourlyRate || '';
  let salaryParagraph = '';
  if (form === 'TIM' || (!salary && hourly)) {
    salaryParagraph = `Timlön uppgår till <strong>${escapeHtmlText(String(hourly || ''))} kronor per timme</strong>. Semesterersättning om 12 % samt eventuellt OB-tillägg utgår enligt tillämpligt kollektivavtal utöver timlönen.`;
  } else {
    salaryParagraph = `Månadslön uppgår till <strong>${escapeHtmlText(String(salary || ''))} kronor</strong>.`;
  }

  // §23 Kollektivavtal
  const collective = String(emp.collective_agreement || emp.collectiveAgreement || '').trim();
  const collectiveParagraph = collective
    ? `Följande kollektivavtal tillämpas på anställningen: <strong>${escapeHtmlText(collective)}</strong>. Vid motstridighet mellan detta avtal och kollektivavtalet har kollektivavtalet företräde i den utsträckning kollektivavtalets bestämmelser är tvingande.`
    : `Något kollektivavtal tillämpas för närvarande inte på anställningen.`;

  return {
    today: new Date().toLocaleDateString('sv-SE'),
    employee: {
      first_name: person.firstName || person.first_name || '',
      last_name: person.lastName || person.last_name || '',
      personal_number: person.personalNumber || person.personal_number || '',
      email: person.email || '',
      phone: person.phone || '',
      address: [person.address, person.postalCode || person.postal_code, person.city].filter(Boolean).join(', '),
      // camelCase alias för äldre mallar
      firstName: person.firstName || person.first_name || '',
      lastName: person.lastName || person.last_name || '',
      personalNumber: person.personalNumber || person.personal_number || '',
    },
    company: {
      name: company.name,
      organization_number: company.organizationNumber,
      organizationNumber: company.organizationNumber,
      address: [company.address, company.postalCode, company.city].filter(Boolean).join(', '),
      signatory_name: company.signatoryName || '',
      signatoryName: company.signatoryName || '',
    },
    employment: {
      ...emp,
      job_title: emp.job_title || emp.role || '',
      role: emp.role || emp.job_title || '',
      percentage: emp.percentage || emp.occupationPct || '',
      occupationPct: emp.occupationPct || emp.percentage || '',
      start_date: startDate,
      startDate,
      end_date: endDate,
      endDate,
      probation_end_date: probEnd,
      probationEndDate: probEnd,
      work_area: emp.work_area || emp.workplace || '',
      workplace: emp.workplace || emp.work_area || '',
      notice_period: emp.notice_period || emp.noticePeriod || '',
      noticePeriod: emp.noticePeriod || emp.notice_period || '',
      employment_form: form,
      employment_form_label: employmentFormLabel,
      // Derived HTML — prefix __HTML__ så substitutionen inte escaper
      form_paragraph: '__HTML__' + formParagraph,
      salary_paragraph: '__HTML__' + salaryParagraph,
      collective_agreement_paragraph: '__HTML__' + collectiveParagraph,
    },
  };
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

  const ctx = buildSubstitutionContext(company, body.person || {}, body.employment || {});
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
        timewaveEmployeeId: z.number().optional().nullable(),
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
          timewaveEmployeeId: body.person.timewaveEmployeeId ?? null,
        },
      });
      personId = personRow.id;
    }

    // Bygg context för variabelsubstitution (delad hjälpare — samma som preview)
    const ctx = buildSubstitutionContext(company, personRow || {}, body.employment ?? {});
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
