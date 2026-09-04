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
  // 6 månader (var 12 tidigare — tar för lång tid för Vercel)
  start.setMonth(start.getMonth() - 6);

  const fromISO = `${start.getFullYear()}-${pad(start.getMonth() + 1)}-${pad(start.getDate())}`;
  const toISO = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;

  let token = await getTimewaveToken();
  const base = 'https://api.timewave.se/v3';

  // Hämta anställda för namn
  const empResp = await fetch(`${base}/employees?page[size]=200`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  });
  const empData = await empResp.json();
  const employees = new Map<number, { name: string; email: string | null }>();
  for (const e of empData.data || []) {
    employees.set(e.id, {
      name: `${e.first_name || ''} ${e.last_name || ''}`.trim(),
      email: e.email || null,
    });
  }

  type Row = { name: string; email: string | null; days: Set<string>; missions: any[] };
  const perEmp = new Map<number, Row>();

  // Hämta första sidan för att veta totalt antal
  const fetchPage = async (p: number, retry = true): Promise<any> => {
    const url = `${base}/missions?filter[startdate]=${fromISO}&filter[enddate]=${toISO}&page[size]=200&page[number]=${p}`;
    const r = await fetch(url, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    });
    if (r.status === 403 && retry) {
      token = await forceRefreshTimewaveToken();
      return fetchPage(p, false);
    }
    if (!r.ok) throw new Error(`Timewave missions p${p} → ${r.status}`);
    return r.json();
  };

  const firstData = await fetchPage(1);
  const totalPages = firstData.last_page || 1;
  let allMissions: any[] = firstData.data || [];

  // Hämta resterande sidor parallellt (4 åt gången)
  if (totalPages > 1) {
    const PAR = 4;
    for (let p = 2; p <= totalPages; p += PAR) {
      const batch: number[] = [];
      for (let i = 0; i < PAR && p + i <= totalPages; i++) batch.push(p + i);
      const results = await Promise.all(batch.map((pn) => fetchPage(pn).catch(() => ({ data: [] }))));
      for (const r of results) allMissions = allMissions.concat(r.data || []);
    }
  }

  // Räkna sjuk-missions
  let sickMissionsFound = 0;
  for (const m of allMissions) {
    const services = m.services || [];
    const isSick = services.some((s: any) => {
      const sid = s.service_id || s.id;
      return sid === SICK_SERVICE_ID;
    });
    if (!isSick) continue;
    sickMissionsFound++;
    {
      const date: string = String(m.startdate || m.date || '').slice(0, 10);
      if (!date) continue;

      for (const emp of m.employees || []) {
        const empId = emp.employee_id || emp.id;
        if (!empId) continue;
        const info = employees.get(empId);
        if (!info) continue;
        let row = perEmp.get(empId);
        if (!row) {
          row = { name: info.name, email: info.email, days: new Set(), missions: [] };
          perEmp.set(empId, row);
        }
        row.days.add(date);
        row.missions.push({ date, missionId: m.id, cancelled: emp.cancelled });
      }
    }
  }

  // Räkna episoder: sammanhängande sjukdagar (dag n+1 räknas som samma episod)
  const summary: Array<{
    timewaveEmployeeId: number;
    name: string;
    email: string | null;
    episodes: number;
    days: number;
    latest: string;
    triggeredThreshold: 'STRONG' | 'WARNING' | 'DAYS' | null;
  }> = [];

  for (const [empId, row] of perEmp.entries()) {
    const days = Array.from(row.days).sort();
    const episodes: string[][] = [];
    let current: string[] = [];
    for (let i = 0; i < days.length; i++) {
      const d = days[i];
      if (i === 0) {
        current = [d];
      } else {
        const prev = new Date(days[i - 1]);
        const curr = new Date(d);
        const diff = Math.round((curr.getTime() - prev.getTime()) / (1000 * 60 * 60 * 24));
        if (diff <= 1) current.push(d);
        else {
          episodes.push(current);
          current = [d];
        }
      }
    }
    if (current.length) episodes.push(current);

    const episodeCount = episodes.length;
    const dayCount = days.length;
    let trigger: 'STRONG' | 'WARNING' | 'DAYS' | null = null;
    if (episodeCount >= THRESHOLD_EPISODES_STRONG) trigger = 'STRONG';
    else if (episodeCount >= THRESHOLD_EPISODES_WARNING) trigger = 'WARNING';
    else if (dayCount >= THRESHOLD_TOTAL_DAYS) trigger = 'DAYS';

    summary.push({
      timewaveEmployeeId: empId,
      name: row.name,
      email: row.email,
      episodes: episodeCount,
      days: dayCount,
      latest: days[days.length - 1] || '',
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

  const elapsedMs = Date.now() - startedAt;
  res.json({
    ok: true,
    windowStart: fromISO,
    windowEnd: toISO,
    totalMissions: allMissions.length,
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
