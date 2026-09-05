/**
 * /api/hr — HR-modul (Fas 1: sjukfrånvaro-uppföljning).
 *
 * SENSITIVT. Åtkomst endast för HR + superadmin.
 *   - HR_ADMIN_EMAILS env (kommaseparerad lista)
 *   - Fallback: mikaela.wigert@stodona.se
 *
 * Fas 1 = foundation:
 *   - Skanna Timewave-sjukfrånvaro (service 3) senaste 12 månader
 *   - Skapa case-rader när trösklar överskrids
 *   - Läsvy (lista + detalj) — INGEN mailsändning ännu
 *   - Anteckningar + avfärdande
 */
import express, { Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../_lib/prisma.js';
import { requireAuth, getUserId } from '../_lib/auth.js';
import { getTimewaveToken, forceRefreshTimewaveToken } from '../_lib/timewaveAuth.js';
import { computeSickLeaveByMonth } from '../_lib/sickLeaveService.js';
import { clerkClient } from '@clerk/express';

const router = express.Router();
router.use(requireAuth);

const HR_EMAILS = (
  process.env.HR_ADMIN_EMAILS ||
  'mikaela.wigert@stodona.se,mikaela.wigert@gmail.com,mikaela@stodona.se,info@stodona.se'
)
  .split(',')
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

// Contracts-superadmin faller alltid tillbaka på HR-access (samma personer).
const SUPERADMIN_EMAILS = (
  process.env.CONTRACT_SUPERADMIN_EMAILS || 'mikaela.wigert@stodona.se'
)
  .split(',')
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

/**
 * Clerk-express: req.auth kan vara en funktion (nyare versioner) ELLER ett
 * objekt (äldre). Hämta sessionClaims robust.
 */
function getSessionClaims(req: Request): any {
  const a = (req as any).auth;
  if (!a) return null;
  if (typeof a === 'function') {
    try { return a().sessionClaims ?? null; } catch { return null; }
  }
  return a.sessionClaims ?? null;
}

/**
 * Email hämtas i denna ordning:
 * 1. sessionClaims.email (om JWT-templaten inkluderar den)
 * 2. sessionClaims.primary_email_address / primaryEmailAddress
 * 3. Slå upp användaren via Clerk API (kostar 1 request men alltid rätt)
 */
async function getUserEmail(req: Request): Promise<string | null> {
  const claims = getSessionClaims(req);
  const claimEmail =
    claims?.email ??
    claims?.primary_email_address ??
    claims?.primaryEmailAddress ??
    (req as any).userEmail;
  if (claimEmail) return String(claimEmail).toLowerCase();

  const userId = getUserId(req);
  if (!userId) return null;
  try {
    const u = await clerkClient.users.getUser(userId);
    const primary =
      u.emailAddresses?.find((e: any) => e.id === u.primaryEmailAddressId)?.emailAddress ??
      u.emailAddresses?.[0]?.emailAddress ??
      null;
    return primary ? String(primary).toLowerCase() : null;
  } catch {
    return null;
  }
}

async function requireHR(req: Request, res: Response): Promise<boolean> {
  const email = await getUserEmail(req);
  if (email && (HR_EMAILS.includes(email) || SUPERADMIN_EMAILS.includes(email))) {
    return true;
  }
  res.status(403).json({
    error: 'Åtkomst nekad — endast HR.',
    debug: email
      ? `Din email (${email}) finns inte i HR_ADMIN_EMAILS-listan.`
      : 'Ingen email kunde hämtas från din Clerk-session.',
  });
  return false;
}

// ─── DEBUG (visar vad backend hämtar om användaren) ────────────────────
// Kräver bara att man är inloggad — INTE HR. Så man kan felsöka access.
router.get('/whoami', async (req, res) => {
  const userId = getUserId(req);
  const claims = getSessionClaims(req);
  let clerkUser: any = null;
  let clerkError: string | null = null;
  if (userId) {
    try {
      const u = await clerkClient.users.getUser(userId);
      clerkUser = {
        id: u.id,
        primaryEmailAddressId: u.primaryEmailAddressId,
        emailAddresses: u.emailAddresses?.map((e: any) => ({ id: e.id, email: e.emailAddress })),
      };
    } catch (e: any) {
      clerkError = e?.message || String(e);
    }
  }
  const resolvedEmail = await getUserEmail(req);
  res.json({
    userId,
    resolvedEmail,
    isInHrList: !!(resolvedEmail && (HR_EMAILS.includes(resolvedEmail) || SUPERADMIN_EMAILS.includes(resolvedEmail))),
    hrEmails: HR_EMAILS,
    superadminEmails: SUPERADMIN_EMAILS,
    sessionClaims: claims,
    clerkUser,
    clerkError,
    envSet: {
      HR_ADMIN_EMAILS: !!process.env.HR_ADMIN_EMAILS,
      CONTRACT_SUPERADMIN_EMAILS: !!process.env.CONTRACT_SUPERADMIN_EMAILS,
      CLERK_SECRET_KEY: !!process.env.CLERK_SECRET_KEY,
    },
  });
});

// ─── TRÖSKLAR ───────────────────────────────────────────────────────────
// Rehabregeln: 6 sjuktillfällen på 12 månader → arbetsgivare måste utreda.
// Vi flaggar även 4-5 tillfällen på 12 mån (varning) och >21 dagar totalt.
const THRESHOLD_EPISODES_STRONG = 6;
const THRESHOLD_EPISODES_WARNING = 4;
const THRESHOLD_TOTAL_DAYS = 21;
const SICK_SERVICE_ID = 3;

// ─── SKANNING ───────────────────────────────────────────────────────────
/**
 * POST /api/hr/sick-leave/scan
 * Skannar Timewave-missions för sjukfrånvaro senaste 12 månader.
 * Grupperar per anställd, räknar episoder + dagar.
 * Skapar nya case-rader när tröskel överskrids (inga dubletter för
 * samma anställd inom 30 dagar).
 * Returnerar sammanställning inklusive alla anställda under tröskel.
 */
router.post('/sick-leave/scan', async (req, res) => {
  if (!(await requireHR(req, res))) return;

  const startedAt = Date.now();
  const pad = (n: number) => String(n).padStart(2, '0');
  const today = new Date();
  const start = new Date(today);
  // 3 månader tillbaka (regel Mikaela 2026-09-01)
  start.setMonth(start.getMonth() - 3);
  start.setDate(1); // första i månaden för prydliga månads-buckets

  const fromISO = `${start.getFullYear()}-${pad(start.getMonth() + 1)}-${pad(start.getDate())}`;
  const toISO = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;

  // Hämta anställdas email via employees-endpoint (namnen kommer från servicen).
  const token = await getTimewaveToken();
  const base = 'https://api.timewave.se/v3';
  const empResp = await fetch(`${base}/employees?page[size]=200`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  });
  const empData = await empResp.json();
  const employeeNames = new Map<number, string>();
  const employeeEmails = new Map<number, string | null>();
  for (const e of empData.data || []) {
    employeeNames.set(e.id, `${e.first_name || ''} ${e.last_name || ''}`.trim());
    employeeEmails.set(e.id, e.email || null);
  }

  // ─── DELAD KÄLLA: använd computeSickLeaveByMonth från sickLeaveService ─
  // Samma logik som Översikten. Enda source of truth.
  const sickData = await computeSickLeaveByMonth(start, today, employeeNames);
  const monthKeys = sickData.months;
  const sickMissionsFound = sickData.sickMissionsFound;
  const allMissionsLength = sickData.totalMissions;

  // Bygg summary per anställd baserat på delad service-data
  const summary: Array<{
    timewaveEmployeeId: number;
    name: string;
    email: string | null;
    episodes: number;
    days: number;
    latest: string;
    triggeredThreshold: 'STRONG' | 'WARNING' | 'DAYS' | null;
    byMonth: Record<string, number>;
  }> = [];

  for (const totalEntry of sickData.total) {
    const empId = totalEntry.employeeId;
    const byMonth: Record<string, number> = {};
    for (const k of monthKeys) {
      const inMonth = sickData.perMonth[k]?.find((e) => e.employeeId === empId);
      byMonth[k] = inMonth?.count || 0;
    }
    const totalCount = totalEntry.count;
    const episodeCount = Object.values(byMonth).filter((n) => n > 0).length;
    const dayCount = totalCount;
    let trigger: 'STRONG' | 'WARNING' | 'DAYS' | null = null;
    if (episodeCount >= THRESHOLD_EPISODES_STRONG) trigger = 'STRONG';
    else if (episodeCount >= THRESHOLD_EPISODES_WARNING) trigger = 'WARNING';
    else if (dayCount >= THRESHOLD_TOTAL_DAYS) trigger = 'DAYS';

    const latestMonth = monthKeys.slice().reverse().find((k) => (byMonth[k] || 0) > 0) || '';
    summary.push({
      byMonth,
      timewaveEmployeeId: empId,
      name: totalEntry.name,
      email: employeeEmails.get(empId) || null,
      episodes: episodeCount,
      days: dayCount,
      latest: latestMonth,
      triggeredThreshold: trigger,
    });
  }

  // Skapa case för alla som triggade — men bara om det inte redan
  // finns ett öppet case eller ett case skapat senaste 30 dagarna.
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const created: number[] = [];
  const skipped: number[] = [];

  for (const s of summary) {
    if (!s.triggeredThreshold) continue;
    const existing = await prisma.sickLeaveCase.findFirst({
      where: {
        timewaveEmployeeId: s.timewaveEmployeeId,
        OR: [
          { status: { notIn: ['RESOLVED', 'DISMISSED'] } },
          { createdAt: { gte: thirtyDaysAgo } },
        ],
      },
    });
    if (existing) {
      skipped.push(s.timewaveEmployeeId);
      continue;
    }
    const c = await prisma.sickLeaveCase.create({
      data: {
        timewaveEmployeeId: s.timewaveEmployeeId,
        employeeName: s.name,
        episodesCount: s.episodes,
        daysCount: s.days,
        windowStartDate: start,
        windowEndDate: today,
        status: 'NEW',
        metadata: { triggeredThreshold: s.triggeredThreshold, email: s.email, latest: s.latest },
      },
    });
    await prisma.sickLeaveCaseEvent.create({
      data: {
        caseId: c.id,
        actorClerkId: getUserId(req),
        action: 'created',
        metadata: { source: 'scan', threshold: s.triggeredThreshold },
      },
    });
    created.push(s.timewaveEmployeeId);
  }

  // Totaler per månad över alla anställda
  const monthlyTotals: Record<string, { totalDays: number; employees: number }> = {};
  for (const k of monthKeys) monthlyTotals[k] = { totalDays: 0, employees: 0 };
  for (const s of summary) {
    for (const [mk, days] of Object.entries(s.byMonth)) {
      if (days > 0) {
        monthlyTotals[mk].totalDays += days;
        monthlyTotals[mk].employees++;
      }
    }
  }

  const elapsedMs = Date.now() - startedAt;
  res.json({
    ok: true,
    windowStart: fromISO,
    windowEnd: toISO,
    months: monthKeys,
    monthlyTotals,
    totalMissions: allMissionsLength,
    sickMissionsFound,
    employeesWithSickness: perEmp.size,
    scanned: summary.length,
    triggered: summary.filter((s) => s.triggeredThreshold).length,
    created: created.length,
    skipped: skipped.length,
    elapsedMs,
    sickServiceIdUsed: SICK_SERVICE_ID,
    summary: summary
      .filter((s) => s.episodes > 0)
      .sort((a, b) => b.episodes - a.episodes || b.days - a.days),
  });
});

// ─── SKAPA CASE MANUELLT (från översikten) ─────────────────────────────
router.post('/sick-leave/cases', async (req, res) => {
  if (!(await requireHR(req, res))) return;
  const body = z
    .object({
      timewaveEmployeeId: z.number(),
      employeeName: z.string(),
    })
    .parse(req.body);

  // Om öppet case redan finns, återanvänd det
  const existing = await prisma.sickLeaveCase.findFirst({
    where: {
      timewaveEmployeeId: body.timewaveEmployeeId,
      status: { notIn: ['RESOLVED', 'DISMISSED'] },
    },
  });
  if (existing) return res.json({ case: existing, reused: true });

  const today = new Date();
  const start = new Date(today);
  start.setMonth(start.getMonth() - 12);

  const c = await prisma.sickLeaveCase.create({
    data: {
      timewaveEmployeeId: body.timewaveEmployeeId,
      employeeName: body.employeeName,
      episodesCount: 0,
      daysCount: 0,
      windowStartDate: start,
      windowEndDate: today,
      status: 'UNDER_REVIEW',
      metadata: { createdManually: true },
    },
  });
  await prisma.sickLeaveCaseEvent.create({
    data: {
      caseId: c.id,
      actorClerkId: getUserId(req),
      action: 'created_manually',
    },
  });
  res.json({ case: c });
});

// ─── LISTA CASES ───────────────────────────────────────────────────────
router.get('/sick-leave/cases', async (req, res) => {
  if (!(await requireHR(req, res))) return;
  const q = z
    .object({
      status: z.string().optional(),
    })
    .parse(req.query);
  const where: any = {};
  if (q.status) where.status = q.status;
  const cases = await prisma.sickLeaveCase.findMany({
    where,
    orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
  });
  res.json({ cases });
});

// ─── HÄMTA CASE + HÄNDELSER ────────────────────────────────────────────
router.get('/sick-leave/cases/:id', async (req, res) => {
  if (!(await requireHR(req, res))) return;
  const id = Number(req.params.id);
  const c = await prisma.sickLeaveCase.findUnique({
    where: { id },
    include: { events: { orderBy: { createdAt: 'desc' } } },
  });
  if (!c) return res.status(404).json({ error: 'not found' });
  res.json({ case: c });
});

// ─── UPPDATERA CASE (avfärda / anteckning / status) ────────────────────
router.put('/sick-leave/cases/:id', async (req, res) => {
  if (!(await requireHR(req, res))) return;
  const id = Number(req.params.id);
  const body = z
    .object({
      status: z
        .enum([
          'NEW',
          'UNDER_REVIEW',
          'EMAIL1_DRAFTED',
          'EMAIL1_SENT',
          'MEETING_SCHEDULED',
          'MEETING_HELD',
          'EMAIL2_DRAFTED',
          'EMAIL2_SENT',
          'RESOLVED',
          'DISMISSED',
        ])
        .optional(),
      notes: z.string().optional(),
      dismissReason: z.string().optional(),
      meetingDate: z.string().optional(),
    })
    .parse(req.body);

  const existing = await prisma.sickLeaveCase.findUnique({ where: { id } });
  if (!existing) return res.status(404).json({ error: 'not found' });

  const data: any = {};
  if (body.status !== undefined) data.status = body.status;
  if (body.notes !== undefined) data.notes = body.notes;
  if (body.dismissReason !== undefined) data.dismissReason = body.dismissReason;
  if (body.meetingDate !== undefined) data.meetingDate = body.meetingDate ? new Date(body.meetingDate) : null;

  const updated = await prisma.sickLeaveCase.update({ where: { id }, data });
  await prisma.sickLeaveCaseEvent.create({
    data: {
      caseId: id,
      actorClerkId: getUserId(req),
      action: body.status ? `status_${body.status.toLowerCase()}` : 'updated',
      metadata: { changed: Object.keys(data), from: existing.status, to: body.status },
    },
  });
  res.json({ case: updated });
});

// ─── EMAIL-FÖRHANDSVISNING (Fas 1: bara visa, inte skicka) ─────────────
router.get('/sick-leave/cases/:id/email-preview', async (req, res) => {
  if (!(await requireHR(req, res))) return;
  const id = Number(req.params.id);
  const which = String(req.query.which || 'email1');
  const c = await prisma.sickLeaveCase.findUnique({ where: { id } });
  if (!c) return res.status(404).json({ error: 'not found' });

  const firstName = (c.employeeName || '').split(' ')[0] || 'kollega';
  if (which === 'email1') {
    res.json({
      subject: `Hej ${firstName} — hur mår du?`,
      body:
        `Hej ${firstName},\n\n` +
        `Vi har lagt märke till att du har varit borta från jobbet några gånger den senaste tiden ` +
        `(${c.episodesCount} tillfällen, totalt ${c.daysCount} dagar). Vi ville bara höra av oss och fråga hur du mår.\n\n` +
        `Är det något som vi som arbetsgivare kan hjälpa till med? Det kan handla om arbetsmiljö, ` +
        `schemaläggning eller något helt annat. Du behöver inte berätta vad det är för sjukdom — ` +
        `det är privat. Men vi vill gärna veta om det finns något vi kan göra för att hjälpa dig.\n\n` +
        `Hör gärna av dig till mig, så bokar vi en kort pratstund.\n\n` +
        `Ta hand om dig.\n\nMed vänliga hälsningar,\nHR / Stodona`,
      disclaimer:
        'Detta är ett vänligt omtankesmejl. Skickas efter HR-granskning. ' +
        'Frågar aldrig om diagnos.',
    });
  } else if (which === 'email2') {
    res.json({
      subject: `Beslut om förstadagsintyg — ${firstName}`,
      body:
        `Hej ${firstName},\n\n` +
        `Vid vårt uppföljningssamtal diskuterade vi din upprepade sjukfrånvaro under det senaste året ` +
        `(${c.episodesCount} tillfällen, totalt ${c.daysCount} dagar).\n\n` +
        `Som arbetsgivare har vi enligt sjuklönelagen möjlighet att begära läkarintyg från första sjukdagen ` +
        `om det finns särskilda skäl. Vi bedömer att sådana skäl föreligger och beslutar därför att införa ` +
        `krav på förstadagsintyg för dig under en period.\n\n` +
        `Detta innebär att du behöver lämna in läkarintyg redan från första sjukdagen för att sjuklön ska ` +
        `betalas ut. Beslutet gäller under en tidsbestämd period och kommer att omprövas.\n\n` +
        `Om du har frågor är du varmt välkommen att kontakta HR.\n\n` +
        `Med vänliga hälsningar,\nHR / Stodona`,
      disclaimer:
        'Formellt beslut. Skickas ENDAST efter uppföljningssamtal och HR-granskning. ' +
        'Arbetsrättsjurist bör granska formulering vid osäkerhet.',
    });
  } else {
    res.status(400).json({ error: 'which must be email1 or email2' });
  }
});

export default router;
