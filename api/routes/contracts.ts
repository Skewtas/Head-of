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
        select: { id: true, filename: true, contentType: true, fileUrl: true, fileId: true },
        orderBy: { createdAt: 'asc' },
      },
      _count: { select: { signers: true, versions: true, reminders: true, attachments: true } },
    },
    orderBy: [{ updatedAt: 'desc' }],
    take: 200,
  });
  // Migrera gamla /api/contracts-file?id=... på fluggen
  for (const c of contracts as any[]) {
    for (const a of c.attachments) {
      if (a.fileId && a.fileUrl && a.fileUrl.includes('/api/contracts-file')) {
        a.fileUrl = `/api/contracts/file/${a.fileId}`;
      }
    }
  }
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

  // Obligatoriska kontroller innan avtal kan skickas för signering.
  // Regler från Mikaela 2026-09-01 — hårda systemregler, inte bara mall-text.
  const SIGNING_STATUSES = new Set(['READY_FOR_SIGNING', 'SENT', 'PARTIALLY_SIGNED', 'SIGNED', 'ACTIVE']);
  const EMPLOYMENT_CATS = new Set([
    'ANSTALLNINGSAVTAL', 'PROVANSTALLNING', 'TILLSVIDAREANSTALLNING',
    'VISSTIDSANSTALLNING', 'TIMANSTALLNING',
  ]);
  const isEmploymentContract = EMPLOYMENT_CATS.has(c.category);
  const goingToSigning = patch.status && SIGNING_STATUSES.has(patch.status) && !SIGNING_STATUSES.has(c.status);
  if (isEmploymentContract && goingToSigning) {
    const err = await validateContractForSigning(id, c);
    if (err) return res.status(400).json({ error: err });
  }

  const updated = await prisma.contract.update({ where: { id }, data: patch });
  await logAudit(userId, 'updated', id, patch);
  res.json(updated);
});

/**
 * Obligatoriska kontroller innan ett anställningsavtal kan skickas för
 * signering (regler från Mikaela 2026-09-01, hårda systemregler).
 *
 * Kontrollerar i tur och ordning:
 *  1. Arbetsgivare = Stodona Services AB
 *  2. Anställd har namn + personnummer
 *  3. Anställningsform (kategori)
 *  4. Startdatum
 *  5. Lön (månadslön ELLER timlön)
 *  6. Anställningsgrad (metadata.employment.percentage)
 *  7. Årsarbetstid står bredvid anställningsgraden i content
 *  8. INGEN felaktig hänvisning till kollektivavtal
 *
 * Returnerar felmeddelande om något inte stämmer, annars null.
 * För uppladdade PDF-avtal (utan templateId) skippas textuella kontroller
 * eftersom vi inte kan inspektera PDF-innehåll.
 */
async function validateContractForSigning(
  contractId: number,
  contract: any,
): Promise<string | null> {
  // 1. Arbetsgivare måste vara ett godkänt Stodona-bolag med rätt orgnr
  const ownCompany = await prisma.ownCompany.findUnique({
    where: { id: contract.ownCompanyId },
    select: { name: true, organizationNumber: true },
  });
  if (!ownCompany) return 'Avtalet kan inte skickas. Arbetsgivare saknas.';
  const validCompanies: Record<string, string> = {
    'Stodona Services AB': '559481-1332',
    'Stodona AB': '559201-1059',
  };
  const expectedOrgNr = validCompanies[ownCompany.name.trim()];
  if (!expectedOrgNr) {
    return `Avtalet kan inte skickas. Arbetsgivare "${ownCompany.name}" är inte ett godkänt bolag. Använd Stodona Services AB eller Stodona AB.`;
  }
  if (ownCompany.organizationNumber !== expectedOrgNr) {
    return `Avtalet kan inte skickas. Fel organisationsnummer för ${ownCompany.name} (${ownCompany.organizationNumber}). Ska vara ${expectedOrgNr}.`;
  }

  // 2. Person-info
  if (!contract.personId) {
    return 'Avtalet kan inte skickas. Ingen anställd är kopplad till avtalet.';
  }
  const person = await prisma.contractPerson.findUnique({ where: { id: contract.personId } });
  if (!person || !person.firstName || !person.lastName) {
    return 'Avtalet kan inte skickas. Den anställdes namn saknas.';
  }
  if (!person.personalNumber || person.personalNumber.replace(/[^0-9]/g, '').length < 10) {
    return 'Avtalet kan inte skickas. Den anställdes personnummer saknas.';
  }

  // 3. Anställningsform (kategori)
  if (!contract.category) {
    return 'Avtalet kan inte skickas. Anställningsform saknas.';
  }

  // 4. Startdatum
  if (!contract.startDate) {
    return 'Avtalet kan inte skickas. Startdatum saknas.';
  }

  const meta = (contract.metadata ?? {}) as any;
  const emp = meta?.employment ?? {};

  // 4b. Anställningsnummer i Fortnox — obligatoriskt
  const empNumber = String(emp.employment_number ?? emp.employmentNumber ?? '').trim();
  if (!empNumber) {
    return 'Avtalet kan inte skickas. Anställningsnummer saknas (Timewave-ID).';
  }

  // 5. Sysselsättningsgrad — måste finnas (kan vara "Vid behov" eller ett tal)
  const percentage = emp.percentage ?? emp.occupationPct;
  if (percentage == null || String(percentage).trim() === '') {
    return 'Avtalet kan inte skickas. Sysselsättningsgrad saknas.';
  }

  // 6. Löneform + rätt lönefält
  const salaryForm = String(emp.salary_form ?? emp.salaryForm ?? '').toUpperCase();
  const salary = emp.salary;
  const hourlyRate = emp.hourlyRate ?? emp.hourly_rate;

  if (!salaryForm) {
    // Fallback för äldre avtal utan explicit löneform: acceptera om något lönebelopp finns
    if ((!salary || String(salary).trim() === '') && (!hourlyRate || String(hourlyRate).trim() === '')) {
      return 'Avtalet kan inte skickas. Löneform (timlön/månadslön) saknas.';
    }
  } else if (salaryForm === 'HOURLY') {
    if (!hourlyRate || String(hourlyRate).trim() === '') {
      return 'Avtalet kan inte skickas. Timlön saknas.';
    }
    // Semesterersättning-inställning MÅSTE vara satt (true eller false)
    const vac = emp.vacation_included_in_hourly ?? emp.vacationIncludedInHourly;
    if (vac !== true && vac !== false) {
      return 'Avtalet kan inte skickas. Ange om timlönen inkluderar semesterersättning eller ej.';
    }
  } else if (salaryForm === 'MONTHLY') {
    if (!salary || String(salary).trim() === '') {
      return 'Avtalet kan inte skickas. Månadslön saknas.';
    }
  } else {
    return `Avtalet kan inte skickas. Okänd löneform "${salaryForm}".`;
  }

  // 7-8. Textuella kontroller (bara för mall-baserade avtal)
  if (!contract.templateId) return null;
  const version = await prisma.contractVersion.findFirst({
    where: { contractId },
    orderBy: { version: 'desc' },
  });
  if (!version) return 'Avtalet kan inte skickas. Ingen version av avtalet har skapats.';
  const content = version.content || '';

  // 7. Årsarbetstid bredvid anställningsgraden
  if (!content.includes('Årsarbetstid')) {
    return 'Avtalet kan inte skickas. Årsarbetstid måste anges tillsammans med anställningsgraden.';
  }
  const pctStr = String(percentage).trim();
  const idx = content.indexOf('Årsarbetstid');
  const window = content.slice(Math.max(0, idx - 400), idx + 400);
  const nearby = window.includes(`${pctStr} %`) || window.includes(`${pctStr}%`);
  if (!nearby) {
    return 'Avtalet kan inte skickas. Årsarbetstid måste anges tillsammans med anställningsgraden.';
  }

  // 8. Ingen felaktig hänvisning till kollektivavtal — Doma har inget.
  // Vi tolererar ord i explicit "vi har INTE kollektivavtal"-mening bara om
  // det uttryckligen står "har inte kollektivavtal" eller "utan kollektivavtal".
  const lower = content.toLowerCase();
  const mentionsCollective = lower.includes('kollektivavtal');
  if (mentionsCollective) {
    const explicitlyDenied =
      lower.includes('utan kollektivavtal') ||
      lower.includes('har inte kollektivavtal') ||
      lower.includes('har inget kollektivavtal') ||
      lower.includes('inte något kollektivavtal') ||
      lower.includes('omfattas inte av kollektivavtal');
    if (!explicitlyDenied) {
      return 'Avtalet kan inte skickas. Stodona Services AB har inte kollektivavtal — avtalet innehåller en felaktig hänvisning till kollektivavtal som måste tas bort.';
    }
  }

  return null;
}

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

// ─── SERVE ATTACHMENT FILE ─────────────────────────────────────────────
/**
 * GET /api/contracts/file/:fileId — serverar base64-lagrade PDF/DOCX.
 * Blob-URL:er går direkt — den här routen behövs bara för filer som
 * ligger i contract_files-tabellen (< 4 MB).
 */
router.get('/file/:fileId', async (req, res) => {
  const userId = getUserId(req)!;
  const fileId = String(req.params.fileId);

  const file = await prisma.contractFile.findUnique({
    where: { id: fileId },
    include: { attachments: { select: { contractId: true } } },
  });
  if (!file) return res.status(404).json({ error: 'Not found' });

  if (!isSuperadmin(req)) {
    const contractIds = file.attachments.map((a) => a.contractId);
    if (contractIds.length === 0) return res.status(403).json({ error: 'No access' });
    const accessibleCount = await prisma.contract.count({
      where: {
        id: { in: contractIds },
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
    });
    if (accessibleCount === 0) return res.status(403).json({ error: 'No access' });
  }

  const buffer = Buffer.from(file.data, 'base64');
  res.setHeader('Content-Type', file.mime);
  res.setHeader('Content-Length', String(buffer.length));
  res.setHeader('Content-Disposition', `inline; filename="contract-${fileId}.${fileExt(file.mime)}"`);
  res.setHeader('Cache-Control', 'private, max-age=300');
  return res.status(200).send(buffer);
});

function fileExt(mime: string): string {
  if (mime === 'application/pdf') return 'pdf';
  if (mime.includes('word')) return 'docx';
  return 'bin';
}

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
 * En anställd räknas som täckt om det finns MINST ETT anställningsavtal
 * som är kopplat till hen OCH aktivt enligt Stodona-reglerna:
 *
 *   Kopplingsordning (starkaste först):
 *     1. ContractPerson.timewaveEmployeeId === employee.id
 *     2. Personnummer (normaliserat, 10-12 siffror)
 *     3. Email (case-insensitive)
 *     4. Normaliserat för- + efternamn
 *
 *   Aktivt = status ∈ AKTIVA_STATUSAR OCH startdatum-passerat (eller null)
 *            OCH slutdatum-ej-passerat (eller null). Datumjämförelse sker
 *            på DATUM-nivå (Europe/Stockholm) för att slippa tid/tidszon.
 *
 * Endpointen returnerar per anställd:
 *   - hasActiveContract: bool
 *   - reason: NO_CONTRACT | NOT_YET_STARTED | EXPIRED | DRAFT_ONLY | OTHER
 *   - matchedBy: TIMEWAVE_ID | PNR | EMAIL | NAME | null
 *   - candidates[]: alla kontrakt vi hittade (även ej-aktiva) med orsak
 *
 * Extra: ?debug=1 returnerar samma struktur för ALLA anställda (även täckta),
 * så man kan se hela kopplingsanalysen.
 */

const EMPLOYMENT_CATEGORIES = [
  'ANSTALLNINGSAVTAL',
  'PROVANSTALLNING',
  'TILLSVIDAREANSTALLNING',
  'VISSTIDSANSTALLNING',
  'TIMANSTALLNING',
] as const;

// Timewave-poster som INTE är riktiga anställda: dummies för avbokning,
// tidigare anställda som lever kvar i systemet, och användaren själv.
// Samma lista som staff-underfilled + extra dummies.
const EXCLUDE_NAME_SUBSTRINGS = [
  'tenita',
  'laila',
  'erik näf',
  'luisa fernanda',
  'mikaela wigert',
  'aa -',              // "AA - Avbok som debiteras"
  'avbok som',
];

// Statusar som räknas som "avtal på plats" (om datumen stämmer).
// SIGNED + ACTIVE = klart och giltigt.
// EXPIRING_SOON = fortfarande giltigt, bara flaggat för snart utgång.
// SENT + PARTIALLY_SIGNED = utskickat för signering (räknas som "kontrakt finns").
const ACTIVE_STATUSES = new Set([
  'SIGNED',
  'ACTIVE',
  'EXPIRING_SOON',
  'SENT',
  'PARTIALLY_SIGNED',
]);
// Draft/pre-signing — kontrakt finns men är inte klart att räkna som täckning.
const DRAFT_STATUSES = new Set(['DRAFT', 'PENDING_APPROVAL', 'READY_FOR_SIGNING']);
// Räknas som avslutade (visas inte som "väntande" utan som "expired").
const CLOSED_STATUSES = new Set(['EXPIRED', 'TERMINATED', 'ARCHIVED']);

/** YYYY-MM-DD-sträng i Europe/Stockholm — undviker tid + tidszon-bugs. */
function ymdSthlm(d: Date | string | null | undefined): string | null {
  if (!d) return null;
  const dt = d instanceof Date ? d : new Date(d);
  if (isNaN(dt.getTime())) return null;
  // sv-SE ger "YYYY-MM-DD" med Europe/Stockholm när tz sätts explicit
  const parts = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Europe/Stockholm',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(dt);
  const y = parts.find((p) => p.type === 'year')?.value;
  const m = parts.find((p) => p.type === 'month')?.value;
  const day = parts.find((p) => p.type === 'day')?.value;
  return y && m && day ? `${y}-${m}-${day}` : null;
}

type ContractCandidate = {
  id: number;
  title: string;
  category: string;
  status: string;
  startDate: string | null;
  endDate: string | null;
  matchMethod: 'TIMEWAVE_ID' | 'PNR' | 'EMAIL' | 'NAME';
  isActive: boolean;
  activeReason?: string; // varför aktiv / inte aktiv
};

function assessContract(
  c: { status: string; startDate: Date | null; endDate: Date | null },
  todayYmd: string,
): { isActive: boolean; reason: string } {
  if (CLOSED_STATUSES.has(c.status)) return { isActive: false, reason: `Status ${c.status}` };
  if (DRAFT_STATUSES.has(c.status)) return { isActive: false, reason: `Ej färdigsignerat (${c.status})` };
  if (!ACTIVE_STATUSES.has(c.status)) return { isActive: false, reason: `Okänd status: ${c.status}` };

  const startYmd = ymdSthlm(c.startDate);
  const endYmd = ymdSthlm(c.endDate);
  if (startYmd && startYmd > todayYmd) return { isActive: false, reason: `Startar ${startYmd} (ej börjat)` };
  if (endYmd && endYmd < todayYmd) return { isActive: false, reason: `Löpte ut ${endYmd}` };
  return { isActive: true, reason: 'Signerat + giltiga datum' };
}

// ─── DIAGNOS-endpoint — se datakvalitet på ContractPersons ─────────────
router.get('/missing-employees/diagnose', async (_req, res) => {
  try {
    const persons = await prisma.contractPerson.findMany({
      select: {
        id: true, firstName: true, lastName: true, email: true,
        personalNumber: true, timewaveEmployeeId: true,
        contracts: { select: { id: true, status: true, category: true } },
      },
    });
    const totalPersons = persons.length;
    const withTimewaveId = persons.filter((p) => p.timewaveEmployeeId != null).length;
    const withPnr = persons.filter((p) => !!p.personalNumber && p.personalNumber.length >= 10).length;
    const withEmail = persons.filter((p) => !!p.email).length;
    const withName = persons.filter((p) => !!p.firstName && !!p.lastName).length;
    const withEmploymentContract = persons.filter((p) =>
      p.contracts.some((c) => EMPLOYMENT_CATEGORIES.includes(c.category as any)),
    ).length;

    // Sample: första 5 personerna med anställningsavtal
    const sample = persons
      .filter((p) => p.contracts.some((c) => EMPLOYMENT_CATEGORIES.includes(c.category as any)))
      .slice(0, 5)
      .map((p) => ({
        id: p.id,
        name: `${p.firstName} ${p.lastName}`,
        hasTimewaveId: p.timewaveEmployeeId != null,
        timewaveEmployeeId: p.timewaveEmployeeId,
        hasEmail: !!p.email,
        email: p.email,
        hasPnr: !!p.personalNumber,
        pnrLength: p.personalNumber?.length,
        contractCount: p.contracts.length,
        contractStatuses: p.contracts.map((c) => c.status),
      }));

    res.json({
      totalContractPersons: totalPersons,
      withTimewaveId,
      withPersonalNumber: withPnr,
      withEmail,
      withName,
      withEmploymentContract,
      note: 'Om withTimewaveId << withEmploymentContract så matchas nästan inget via ID. Om withEmail/withPersonalNumber också är låga → matchning måste falla på namn (osäkert).',
      sample,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/missing-employees', async (req, res) => {
  try {
    const debug = req.query.debug === '1';
    const baseUrl = process.env.APP_URL || `https://${req.headers.host}`;

    const r = await fetch(`${baseUrl}/api/timewave/employees?page[size]=200`);
    if (!r.ok) return res.status(502).json({ error: 'Kunde inte hämta anställda från Timewave' });
    const data = await r.json();
    const rawEmployees: any[] = (data.data || []).filter(
      (e: any) => !e.deleted && e.status === 'active',
    );
    // Exkludera dummies + tidigare anställda (samma logik som staff-underfilled).
    const excluded: any[] = [];
    const employees: any[] = [];
    for (const e of rawEmployees) {
      const name = `${e.first_name || ''} ${e.last_name || ''}`.toLowerCase();
      if (EXCLUDE_NAME_SUBSTRINGS.some((s) => name.includes(s))) {
        excluded.push({ id: e.id, name: `${e.first_name} ${e.last_name}`.trim() });
        continue;
      }
      employees.push(e);
    }

    // Hämta alla anställningsavtal — INTE bara "aktiva" — så vi kan visa
    // utgångna/kommande som "vi hittade men diskvalificerade" per person.
    const allContracts = await prisma.contract.findMany({
      where: { category: { in: EMPLOYMENT_CATEGORIES as any } },
      select: {
        id: true,
        title: true,
        category: true,
        status: true,
        startDate: true,
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
      orderBy: { startDate: 'desc' },
    });

    // Bygg lookup-tabeller på ContractPerson så vi kan matcha snabbt.
    // Ett kontrakt utan person kan inte matchas på personens fält.
    type ContractRow = (typeof allContracts)[number];
    const byTimewaveId = new Map<number, ContractRow[]>();
    const byPnr = new Map<string, ContractRow[]>();
    const byEmail = new Map<string, ContractRow[]>();
    const byName = new Map<string, ContractRow[]>();
    for (const c of allContracts) {
      if (!c.person) continue;
      const p = c.person;
      if (p.timewaveEmployeeId) {
        const arr = byTimewaveId.get(p.timewaveEmployeeId) ?? [];
        arr.push(c); byTimewaveId.set(p.timewaveEmployeeId, arr);
      }
      if (p.personalNumber) {
        const k = normalizePnr(p.personalNumber);
        if (k) {
          const arr = byPnr.get(k) ?? [];
          arr.push(c); byPnr.set(k, arr);
        }
      }
      if (p.email) {
        const k = p.email.toLowerCase().trim();
        const arr = byEmail.get(k) ?? [];
        arr.push(c); byEmail.set(k, arr);
      }
      const nk = normalizeName(p.firstName, p.lastName);
      if (nk) {
        const arr = byName.get(nk) ?? [];
        arr.push(c); byName.set(nk, arr);
      }
    }

    const todayYmd = ymdSthlm(new Date())!;

    const analyses = employees.map((e) => {
      // Samla kandidat-kontrakt via kopplingsordningen — starkast först.
      // Ett kontrakt kan matchas flera vägar; behåll starkaste matchMethod.
      const seen = new Map<number, ContractCandidate>();
      const addCandidate = (c: ContractRow, method: ContractCandidate['matchMethod']) => {
        if (seen.has(c.id)) return; // starkare metod redan registrerad
        const a = assessContract(c, todayYmd);
        seen.set(c.id, {
          id: c.id,
          title: c.title,
          category: c.category,
          status: c.status,
          startDate: ymdSthlm(c.startDate),
          endDate: ymdSthlm(c.endDate),
          matchMethod: method,
          isActive: a.isActive,
          activeReason: a.reason,
        });
      };
      for (const c of byTimewaveId.get(e.id) ?? []) addCandidate(c, 'TIMEWAVE_ID');
      if (e.personal_number) {
        for (const c of byPnr.get(normalizePnr(String(e.personal_number))) ?? []) addCandidate(c, 'PNR');
      }
      if (e.email) {
        for (const c of byEmail.get(String(e.email).toLowerCase().trim()) ?? []) addCandidate(c, 'EMAIL');
      }
      const nk = normalizeName(e.first_name || '', e.last_name || '');
      if (nk) for (const c of byName.get(nk) ?? []) addCandidate(c, 'NAME');

      const candidates = Array.from(seen.values());
      const activeOnes = candidates.filter((c) => c.isActive);
      const hasActive = activeOnes.length > 0;
      const matchedBy: string | null = hasActive ? activeOnes[0].matchMethod : null;

      let reason: string;
      if (hasActive) reason = 'OK';
      else if (candidates.length === 0) reason = 'NO_CONTRACT';
      else if (candidates.some((c) => c.startDate && c.startDate > todayYmd && !CLOSED_STATUSES.has(c.status))) reason = 'NOT_YET_STARTED';
      else if (candidates.every((c) => c.endDate && c.endDate < todayYmd)) reason = 'EXPIRED';
      else if (candidates.some((c) => DRAFT_STATUSES.has(c.status))) reason = 'DRAFT_ONLY';
      else reason = 'OTHER';

      return {
        timewaveEmployeeId: e.id,
        firstName: e.first_name || '',
        lastName: e.last_name || '',
        email: e.email || null,
        phone: e.mobile || e.phone || null,
        personalNumber: e.personal_number || null,
        startDate: e.employee_startdate || null,
        occupation: e.base_contract?.occupation ?? null,
        hasActiveContract: hasActive,
        matchedBy,
        reason,
        candidates: candidates.sort((a, b) => (b.startDate || '').localeCompare(a.startDate || '')),
      };
    });

    const missing = analyses
      .filter((a) => !a.hasActiveContract)
      .sort((a, b) => (a.lastName + a.firstName).localeCompare(b.lastName + b.firstName));

    res.json({
      todayYmd,
      totalActive: employees.length,
      totalRaw: rawEmployees.length,
      excludedCount: excluded.length,
      excludedNames: excluded.map((e) => e.name),
      withActive: analyses.length - missing.length,
      missingCount: missing.length,
      missing,
      ...(debug ? { all: analyses } : {}),
    });
  } catch (err: any) {
    console.error('[missing-employees] failed:', err.message);
    res.status(500).json({ error: err.message });
  }
});

function normalizeName(first: string, last: string): string {
  const n = `${first || ''} ${last || ''}`.toLowerCase().trim()
    .replace(/[åä]/g, 'a').replace(/ö/g, 'o').replace(/[éè]/g, 'e')
    .replace(/[^a-z\s-]/g, '')  // ta bort specialtecken utom mellanslag/bindestreck
    .replace(/\s+/g, ' ');
  return n;
}
function normalizePnr(s: string): string {
  const digits = s.replace(/[^0-9]/g, '');
  // 10-siffrigt (YYMMDDXXXX) → gör om till 12 (antagen 19/20-prefix) för konsekvens
  if (digits.length === 10) {
    const yy = parseInt(digits.slice(0, 2), 10);
    // Enkel heuristik: >30 → 19xx, annars 20xx. Stodona har vuxna anställda.
    const century = yy > 30 ? '19' : '20';
    return century + digits;
  }
  return digits;
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
        fileUrl = `/api/contracts/file/${file.id}`;
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
  const formLabelsEn: Record<string, string> = {
    TILLSVIDARE: 'Permanent employment',
    PROV: 'Probationary employment',
    VISSTID: 'Fixed-term employment',
    TIM: 'Hourly employment',
  };
  const form = String(emp.employment_form || emp.employmentForm || 'TILLSVIDARE').toUpperCase();
  const employmentFormLabel = formLabels[form] || 'Tillsvidareanställning';
  const employmentFormLabelEn = formLabelsEn[form] || 'Permanent employment';

  const startDate = emp.start_date || emp.startDate || '';
  const endDate = emp.end_date || emp.endDate || '';
  const probEnd = emp.probation_end_date || emp.probationEndDate || '';

  // §3 Anställningsform — HTML-block som substitueras in råtext (via __HTML__ prefix)
  let formParagraph = '';
  if (form === 'PROV') {
    formParagraph = `<p>Anställningen är en provanställning enligt 6 § lagen om anställningsskydd (LAS). Provanställningen gäller från och med <strong>${escapeHtmlText(startDate)}</strong> till och med <strong>${escapeHtmlText(probEnd)}</strong>. Om provanställningen inte avbryts senast två veckor före provperiodens utgång övergår anställningen automatiskt i en tillsvidareanställning. Både Arbetsgivaren och Arbetstagaren har rätt att avbryta provanställningen utan angivande av skäl med tillämpning av gällande varselregler.</p>`;
  } else if (form === 'VISSTID') {
    formParagraph = `<p>Anställningen är en visstidsanställning enligt gällande arbetsrättsliga regler. Anställningen gäller från och med <strong>${escapeHtmlText(startDate)}</strong> till och med <strong>${escapeHtmlText(endDate)}</strong>, då den upphör utan uppsägning. Anställningen kan inte avbrytas i förtid annat än enligt gällande lag.</p>`;
  } else if (form === 'TIM') {
    formParagraph = `<p>Anställningen är en timanställning. Anställningen gäller från och med <strong>${escapeHtmlText(startDate)}</strong> till och med <strong>${escapeHtmlText(endDate)}</strong> (maximalt ett år). Arbete utförs efter överenskommelse i varje enskilt fall. Uppsägning i förtid kan ske enligt uppsägningstiderna nedan.</p>`;
  } else {
    formParagraph = `<p>Anställningen är en tillsvidareanställning enligt lagen om anställningsskydd (LAS). Tillträdesdag är <strong>${escapeHtmlText(startDate)}</strong>.</p>`;
  }

  // §10 Lön (paragraf-varianten för äldre mallar)
  const salary = emp.salary || emp.monthlySalary || '';
  const hourly = emp.hourly_rate || emp.hourlyRate || '';
  let salaryParagraph = '';
  if (form === 'TIM' || (!salary && hourly)) {
    salaryParagraph = `Timlön uppgår till <strong>${escapeHtmlText(String(hourly || ''))} kronor per timme inklusive semesterersättning</strong> (12 % är inräknat i timlönen). Ingen ytterligare semesterersättning utgår.`;
  } else {
    salaryParagraph = `Månadslön uppgår till <strong>${escapeHtmlText(String(salary || ''))} kronor</strong>.`;
  }

  // Fakta-rad för v8-mallen (helhetsrad — månadslön eller timlön)
  let salaryRow = '';
  const rowStyle = 'display:grid;grid-template-columns:210px 1fr;column-gap:24px;padding:10px 0;';
  const labelStyle = 'font-size:10.5px;letter-spacing:0.1em;text-transform:uppercase;color:#8b8578;font-weight:600;padding-top:3px;';
  const labelEnStyle = 'display:block;font-size:10px;color:#8b8578;font-weight:500;margin-top:2px;text-transform:none;font-style:italic;';
  const valStyle = 'font-size:14px;color:#1a1a2e;font-weight:500;';
  if (form === 'TIM' || (!salary && hourly)) {
    salaryRow = `<div style="${rowStyle}"><div style="${labelStyle}">Timlön<span style="${labelEnStyle}">Hourly rate</span></div><div style="${valStyle}"><strong>${escapeHtmlText(String(hourly || ''))} kr/tim inkl. semesterersättning</strong> (12 % inräknat i timlönen — ingen ytterligare semesterlön utgår)<span style="display:block;font-size:12.5px;color:#8b8578;margin-top:3px;font-style:italic;font-weight:400;"><strong>${escapeHtmlText(String(hourly || ''))} kr/hour incl. vacation pay</strong> (12 % included in hourly rate — no additional vacation pay)</span></div></div>`;
  } else {
    salaryRow = `<div style="${rowStyle}"><div style="${labelStyle}">Månadslön<span style="${labelEnStyle}">Monthly salary</span></div><div style="${valStyle}"><strong>${escapeHtmlText(String(salary || ''))} kr</strong></div></div>`;
  }

  // (Tidigare § om kollektivavtal — Stodona har inget kollektivavtal.)
  const collectiveParagraph = '';

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
      employment_form_label_en: employmentFormLabelEn,
      employment_number: emp.employment_number || emp.employmentNumber || '',
      bank_account: emp.bank_account || emp.bankAccount || '',
      // Derived HTML — prefix __HTML__ så substitutionen inte escaper
      form_paragraph: '__HTML__' + formParagraph,
      salary_paragraph: '__HTML__' + salaryParagraph,
      salary_row: '__HTML__' + salaryRow,
      collective_agreement_paragraph: '__HTML__' + collectiveParagraph,
    },
    contract: {
      number: emp.contract_number || 'A-2026-XXXX',
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

// ─── SIGNERING ─────────────────────────────────────────────────────────

/**
 * POST /api/contracts/:id/send-for-signing
 * Skapar/uppdaterar Signer för anställd, skickar mail med HMAC-länk via Resend.
 * Kör alla validering-kontroller innan (validateContractForSigning).
 */
router.post('/:id(\\d+)/send-for-signing', async (req, res) => {
  const userId = getUserId(req)!;
  const id = Number(req.params.id);
  const c = await accessibleContract(userId, req, id);
  if (!c) return res.status(404).json({ error: 'Not found or no access' });

  // Kör alla obligatoriska kontroller
  const err = await validateContractForSigning(id, c);
  if (err) return res.status(400).json({ error: err });

  // Hämta person + version
  const contract = await prisma.contract.findUnique({
    where: { id },
    include: {
      person: true,
      ownCompany: true,
      versions: { orderBy: { version: 'desc' }, take: 1 },
    },
  });
  if (!contract || !contract.person || !contract.person.email) {
    return res.status(400).json({ error: 'Avtalet kan inte skickas — den anställdes e-post saknas.' });
  }

  const version = contract.versions[0];
  if (!version) return res.status(400).json({ error: 'Ingen avtalsversion finns.' });

  const employeeName = `${contract.person.firstName} ${contract.person.lastName}`.trim();
  const employeeEmail = contract.person.email;

  // Skapa/uppdatera Signer-rader: anställd (order 1) + arbetsgivare (order 2)
  const employerName = contract.ownCompany.signatoryName || 'Arbetsgivare';
  const employerEmail = contract.ownCompany.signatoryEmail || 'info@stodona.se';

  // Rensa eventuella tidigare pending signers och skapa nya
  await prisma.signer.deleteMany({
    where: { contractId: id, status: { not: 'SIGNED' } },
  });

  const employeeSigner = await prisma.signer.create({
    data: {
      contractId: id,
      name: employeeName,
      email: employeeEmail,
      signingOrder: 1,
      status: 'PENDING',
    },
  });
  await prisma.signer.upsert({
    where: { contractId_signingOrder: { contractId: id, signingOrder: 2 } as any },
    update: { name: employerName, email: employerEmail, status: 'PENDING' },
    create: {
      contractId: id,
      name: employerName,
      email: employerEmail,
      signingOrder: 2,
      status: 'PENDING',
    },
  }).catch(async () => {
    // Fallback om kompositnyckel inte finns
    await prisma.signer.create({
      data: {
        contractId: id,
        name: employerName,
        email: employerEmail,
        signingOrder: 2,
        status: 'PENDING',
      },
    });
  });

  // Generera HMAC-token för anställdens signering
  const { issueSigningToken } = await import('../_lib/signingToken.js');
  const token = issueSigningToken(id, employeeSigner.id);
  const appUrl = process.env.APP_URL || `https://${req.headers.host}`;
  const signUrl = `${appUrl}/sign?token=${encodeURIComponent(token)}`;

  // Skicka mail via Resend
  const { deliverNewsletter } = await import('../_lib/newsletterSender.js');
  const html = `
    <div style="font-family:Inter,Arial,sans-serif;color:#1a1a2e;line-height:1.6;max-width:560px;margin:0 auto;padding:24px;">
      <h1 style="font-family:'Playfair Display',Georgia,serif;font-size:24px;margin:0 0 16px;">
        Signera ditt anställningsavtal
      </h1>
      <p style="margin:0 0 16px;">Hej ${escapeHtmlText(contract.person.firstName)},</p>
      <p style="margin:0 0 16px;">
        Ett anställningsavtal från <strong>${escapeHtmlText(contract.ownCompany.name)}</strong>
        är redo att signeras av dig. Klicka på knappen för att läsa igenom och signera.
      </p>
      <div style="text-align:center;margin:24px 0;">
        <a href="${signUrl}" style="display:inline-block;padding:14px 28px;background:#1a1a2e;color:#fff;text-decoration:none;border-radius:8px;font-weight:600;">Öppna &amp; signera avtalet</a>
      </div>
      <p style="margin:0 0 8px;font-size:13px;color:#4b4a55;">
        Du behöver ange ditt <strong>personnummer</strong> och <strong>telefonnummer</strong> för att verifiera att det är du som signerar.
      </p>
      <p style="margin:0 0 16px;font-size:12px;color:#8b8578;">
        Länken är personlig och giltig i 30 dagar. Om något krånglar, kontakta ${escapeHtmlText(employerName)} på ${escapeHtmlText(employerEmail)}.
      </p>
      <p style="margin:0;color:#8b8578;font-size:12px;">/${escapeHtmlText(contract.ownCompany.name)}</p>
    </div>
  `;

  try {
    await deliverNewsletter({
      newsletterId: `sign-${contract.id}-${employeeSigner.id}`,
      // Skicka till anställd + alltid CC till mikaela.wigert@stodona.se
      // så du har koll och kan spåra vad som skickats.
      recipients: Array.from(new Set([
        employeeEmail.toLowerCase(),
        'mikaela.wigert@stodona.se',
      ])),
      subject: `Signera ditt anställningsavtal — ${contract.ownCompany.name}`,
      htmlContent: html,
      appUrl,
    });
  } catch (e: any) {
    return res.status(500).json({ error: 'Kunde inte skicka signeringsmail: ' + e?.message });
  }

  // Uppdatera status
  await prisma.contract.update({ where: { id }, data: { status: 'SENT' } });
  await logAudit(userId, 'sent_for_signing', id, { employeeEmail, signerId: employeeSigner.id });

  res.json({
    ok: true,
    signerId: employeeSigner.id,
    signUrl,
    employeeEmail,
    ccTo: 'mikaela.wigert@stodona.se',
    note: `✓ Signeringslänk skickad till ${employeeEmail} (och kopia till mikaela.wigert@stodona.se). Kolla din inkorg — mailet kommer från info@stodona.se.`,
  });
});

/**
 * POST /api/contracts/:id/sign-as-employer
 * Arbetsgivare signerar avtalet direkt från HeadOf-appen (inloggad).
 */
router.post('/:id(\\d+)/sign-as-employer', async (req, res) => {
  const userId = getUserId(req)!;
  const id = Number(req.params.id);
  const c = await accessibleContract(userId, req, id);
  if (!c) return res.status(404).json({ error: 'Not found or no access' });

  // Bara superadmin/owner får arbetsgivarsignera
  if (!isSuperadmin(req) && c.ownerClerkId !== userId) {
    return res.status(403).json({ error: 'Endast superadmin eller ägare kan signera som arbetsgivare.' });
  }

  const employerSigner = await prisma.signer.findFirst({
    where: { contractId: id, signingOrder: 2 },
  });
  if (!employerSigner) {
    return res.status(400).json({ error: 'Ingen arbetsgivar-signerare finns. Skicka avtalet först.' });
  }
  if (employerSigner.status === 'SIGNED') {
    return res.status(400).json({ error: 'Redan signerat av arbetsgivare.' });
  }

  const version = await prisma.contractVersion.findFirst({
    where: { contractId: id },
    orderBy: { version: 'desc' },
  });
  if (!version) return res.status(500).json({ error: 'Ingen avtalsversion finns.' });

  const { contentHash } = await import('../_lib/signingToken.js');
  const ip = String(req.headers['x-forwarded-for'] || req.headers['x-real-ip'] || 'unknown').split(',')[0].trim();
  const signedAt = new Date();

  await prisma.signer.update({
    where: { id: employerSigner.id },
    data: {
      status: 'SIGNED',
      signedAt,
      auditData: {
        signedAt: signedAt.toISOString(),
        ip,
        userAgent: String(req.headers['user-agent'] || 'unknown'),
        contentHash: contentHash(version.content),
        contentVersion: version.version,
        clerkUserId: userId,
        signingOrder: 2,
      } as any,
    },
  });

  const allSigners = await prisma.signer.findMany({ where: { contractId: id } });
  const allSigned = allSigners.every((s) => s.status === 'SIGNED');

  if (allSigned) {
    await prisma.contract.update({ where: { id }, data: { status: 'SIGNED' } });
    await prisma.contractVersion.update({ where: { id: version.id }, data: { locked: true } });
  } else {
    await prisma.contract.update({ where: { id }, data: { status: 'PARTIALLY_SIGNED' } });
  }

  await logAudit(userId, 'signed_as_employer', id, {});
  res.json({ ok: true, allSigned });
});

export default router;
