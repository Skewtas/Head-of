/**
 * /api/personalbrev — enkel modul för att skicka veckobrev (email) eller
 * veckosms till personal. Använder befintliga sändare:
 *   - Email: api/_lib/newsletterSender.deliverNewsletter (Resend)
 *   - SMS:   api/_lib/smsSender.sendSms (SureSMS)
 * Lagring: existerande Newsletter-tabellen med category 'Personalbrev' eller
 * 'Personalbrev-SMS'.
 */
import express, { Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../_lib/prisma.js';
import { requireAuth, getUserId } from '../_lib/auth.js';
import { deliverNewsletter } from '../_lib/newsletterSender.js';
import { sendSms } from '../_lib/smsSender.js';

const router = express.Router();
router.use(requireAuth);

const CATEGORY_EMAIL = 'Personalbrev';
const CATEGORY_SMS = 'Personalbrev-SMS';

const BodySchema = z.object({
  type: z.enum(['EMAIL', 'SMS']),
  title: z.string().optional(),
  subject: z.string().optional(),           // rubrik / SMS-preview
  body: z.string().optional(),              // rich text (email) eller plain (SMS)
  intro: z.string().optional(),             // struktur för email
  weekInfo: z.string().optional(),
  keyDates: z.string().optional(),
  outro: z.string().optional(),
  recipients: z.array(z.number()).default([]),     // Employee-IDn
  recipientMode: z.enum(['ALL', 'TEAM', 'INDIVIDUAL']).optional(),
  recipientTeamId: z.number().nullable().optional(),
  scheduledFor: z.string().nullable().optional(),
});
type Body = z.infer<typeof BodySchema>;

// Konvertera struktur till HTML för email preview + skickning
function renderEmailHtml(b: Body): string {
  if (b.body && !b.intro && !b.weekInfo && !b.keyDates && !b.outro) {
    // Fritext-läge — bara wrappa
    return `<div style="font-family:Inter,Arial,sans-serif;color:#1a1a2e;line-height:1.55;max-width:640px;margin:0 auto;">${(b.body || '').replace(/\n/g, '<br/>')}</div>`;
  }
  const esc = (s?: string) => (s || '').replace(/</g, '&lt;').replace(/\n/g, '<br/>');
  return `<div style="font-family:Inter,Arial,sans-serif;color:#1a1a2e;line-height:1.6;max-width:640px;margin:0 auto;padding:24px;">
    ${b.subject ? `<h1 style="font-family:'Playfair Display',Georgia,serif;font-size:28px;color:#1a1a2e;margin:0 0 20px;">${esc(b.subject)}</h1>` : ''}
    ${b.intro ? `<p style="margin:0 0 16px;color:#1a1a2e;">${esc(b.intro)}</p>` : ''}
    ${b.weekInfo ? `<div style="margin:0 0 20px;padding:16px 20px;background:#faf7ee;border-left:3px solid #c9a96e;">
      <div style="font-size:11px;letter-spacing:0.14em;text-transform:uppercase;color:#a68a4e;font-weight:700;margin-bottom:6px;">Veckans information</div>
      <div style="color:#4b4a55;">${esc(b.weekInfo)}</div>
    </div>` : ''}
    ${b.keyDates ? `<div style="margin:0 0 20px;padding:16px 20px;background:#f5f3ee;border-radius:6px;">
      <div style="font-size:11px;letter-spacing:0.14em;text-transform:uppercase;color:#a68a4e;font-weight:700;margin-bottom:6px;">Viktiga datum</div>
      <div style="color:#4b4a55;">${esc(b.keyDates)}</div>
    </div>` : ''}
    ${b.outro ? `<p style="margin:16px 0 0;color:#1a1a2e;">${esc(b.outro)}</p>` : ''}
    <div style="margin-top:32px;padding-top:16px;border-top:1px solid #eae4d9;font-size:12px;color:#8b8578;text-align:center;">Stodona</div>
  </div>`;
}

// Bygg SMS-text från strukturen (rå text, radbrytningar bevaras)
function renderSmsText(b: Body): string {
  if (b.body) return b.body.trim();
  const parts = [b.subject, b.intro, b.weekInfo, b.keyDates, b.outro]
    .filter(Boolean)
    .map((s) => s!.trim());
  return parts.join('\n\n');
}

// Hjälpare: hämta anställda och filtrera till kontaktbara mottagare
async function resolveRecipients(type: 'EMAIL' | 'SMS', ids: number[]) {
  if (ids.length === 0) return [];
  const employees = await prisma.employee.findMany({
    where: { id: { in: ids }, status: 'ACTIVE' },
    select: { id: true, firstName: true, lastName: true, email: true, phone: true },
  });
  if (type === 'EMAIL') {
    return employees.filter((e) => !!e.email).map((e) => ({
      employeeId: e.id, name: `${e.firstName} ${e.lastName}`.trim(),
      email: e.email!, phone: e.phone || null,
    }));
  }
  return employees.filter((e) => !!e.phone).map((e) => ({
    employeeId: e.id, name: `${e.firstName} ${e.lastName}`.trim(),
    email: e.email || null, phone: e.phone!,
  }));
}

// ─── RECIPIENT-VAL ──────────────────────────────────────────────────────
// Returnerar aktiva anställda + teams för mottagarväljaren.
router.get('/recipient-options', async (_req, res) => {
  const [employees, teams] = await Promise.all([
    prisma.employee.findMany({
      where: { status: 'ACTIVE' },
      select: {
        id: true, firstName: true, lastName: true, email: true, phone: true,
        teams: { select: { teamId: true } },
      },
      orderBy: [{ firstName: 'asc' }],
    }),
    prisma.team.findMany({
      where: { status: 'ACTIVE' },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    }),
  ]);
  res.json({
    employees: employees.map((e) => ({
      id: e.id,
      name: `${e.firstName} ${e.lastName}`.trim(),
      email: e.email || null,
      phone: e.phone || null,
      teamIds: e.teams.map((t) => t.teamId),
    })),
    teams,
  });
});

// ─── LISTA HISTORIK ─────────────────────────────────────────────────────
router.get('/', async (_req, res) => {
  const rows = await prisma.newsletter.findMany({
    where: { category: { in: [CATEGORY_EMAIL, CATEGORY_SMS] } },
    orderBy: [{ scheduledFor: 'desc' }, { sentAt: 'desc' }],
    take: 100,
    select: {
      id: true, subject: true, category: true, status: true,
      sentAt: true, scheduledFor: true, successCount: true, failedCount: true,
      recipients: true, introText: true, htmlContent: true, blocks: true,
    },
  });
  res.json(rows);
});

// ─── HÄMTA ETT ──────────────────────────────────────────────────────────
router.get('/:id', async (req, res) => {
  const row = await prisma.newsletter.findUnique({ where: { id: req.params.id } });
  if (!row) return res.status(404).json({ error: 'not found' });
  res.json(row);
});

// ─── SKAPA UTKAST ──────────────────────────────────────────────────────
router.post('/', async (req, res) => {
  const body = BodySchema.parse(req.body);
  const category = body.type === 'EMAIL' ? CATEGORY_EMAIL : CATEGORY_SMS;
  const subject = body.subject?.trim() || body.title?.trim() || 'Utkast';
  const created = await prisma.newsletter.create({
    data: {
      subject,
      category,
      status: 'draft',
      recipients: body.recipients as any,
      introText: renderSmsText(body).slice(0, 5000),
      htmlContent: body.type === 'EMAIL' ? renderEmailHtml(body) : renderSmsText(body),
      blocks: {
        type: body.type,
        title: body.title || null,
        subject: body.subject || null,
        intro: body.intro || null,
        weekInfo: body.weekInfo || null,
        keyDates: body.keyDates || null,
        outro: body.outro || null,
        body: body.body || null,
        recipientMode: body.recipientMode || 'INDIVIDUAL',
        recipientTeamId: body.recipientTeamId ?? null,
        recipientIds: body.recipients,
      } as any,
      scheduledFor: body.scheduledFor ? new Date(body.scheduledFor) : null,
    },
  });
  res.json(created);
});

// ─── AUTOSAVE / UPPDATERA UTKAST ───────────────────────────────────────
router.put('/:id', async (req, res) => {
  const existing = await prisma.newsletter.findUnique({ where: { id: req.params.id } });
  if (!existing) return res.status(404).json({ error: 'not found' });
  if (existing.status === 'sent') return res.status(400).json({ error: 'Skickat utkast går inte att ändra.' });

  const body = BodySchema.parse(req.body);
  const category = body.type === 'EMAIL' ? CATEGORY_EMAIL : CATEGORY_SMS;
  const subject = body.subject?.trim() || body.title?.trim() || 'Utkast';

  const updated = await prisma.newsletter.update({
    where: { id: req.params.id },
    data: {
      subject,
      category,
      recipients: body.recipients as any,
      introText: renderSmsText(body).slice(0, 5000),
      htmlContent: body.type === 'EMAIL' ? renderEmailHtml(body) : renderSmsText(body),
      blocks: {
        type: body.type,
        title: body.title || null,
        subject: body.subject || null,
        intro: body.intro || null,
        weekInfo: body.weekInfo || null,
        keyDates: body.keyDates || null,
        outro: body.outro || null,
        body: body.body || null,
        recipientMode: body.recipientMode || 'INDIVIDUAL',
        recipientTeamId: body.recipientTeamId ?? null,
        recipientIds: body.recipients,
      } as any,
      scheduledFor: body.scheduledFor ? new Date(body.scheduledFor) : null,
      status: body.scheduledFor ? 'scheduled' : 'draft',
    },
  });
  res.json(updated);
});

// ─── DUPLICERA ─────────────────────────────────────────────────────────
router.post('/:id/duplicate', async (req, res) => {
  const src = await prisma.newsletter.findUnique({ where: { id: req.params.id } });
  if (!src) return res.status(404).json({ error: 'not found' });
  const copy = await prisma.newsletter.create({
    data: {
      subject: `Kopia — ${src.subject}`,
      category: src.category,
      status: 'draft',
      recipients: src.recipients as any,
      introText: src.introText,
      htmlContent: src.htmlContent,
      blocks: src.blocks as any,
      scheduledFor: null,
    },
  });
  res.json(copy);
});

// ─── RADERA UTKAST ─────────────────────────────────────────────────────
router.delete('/:id', async (req, res) => {
  const existing = await prisma.newsletter.findUnique({ where: { id: req.params.id } });
  if (!existing) return res.status(404).json({ error: 'not found' });
  if (existing.status === 'sent') return res.status(400).json({ error: 'Skickade utskick kan inte raderas — bara utkast/schemalagda.' });
  await prisma.newsletter.delete({ where: { id: req.params.id } });
  res.json({ ok: true });
});

// ─── SKICKA NU ─────────────────────────────────────────────────────────
router.post('/:id/send', async (req, res) => {
  const row = await prisma.newsletter.findUnique({ where: { id: req.params.id } });
  if (!row) return res.status(404).json({ error: 'not found' });
  if (row.status === 'sent') return res.status(400).json({ error: 'Redan skickat.' });

  const blocks = (row.blocks as any) || {};
  const type: 'EMAIL' | 'SMS' = row.category === CATEGORY_SMS ? 'SMS' : 'EMAIL';
  const ids: number[] = Array.isArray(blocks.recipientIds) ? blocks.recipientIds : [];
  if (ids.length === 0) return res.status(400).json({ error: 'Inga mottagare valda.' });

  const contacts = await resolveRecipients(type, ids);
  if (contacts.length === 0) {
    return res.status(400).json({
      error: type === 'EMAIL'
        ? 'Ingen av mottagarna har en e-postadress.'
        : 'Ingen av mottagarna har ett telefonnummer.',
    });
  }

  await prisma.newsletter.update({
    where: { id: row.id },
    data: { status: 'sending' },
  });

  try {
    if (type === 'EMAIL') {
      const appUrl = process.env.APP_URL || `https://${req.headers.host}`;
      const result = await deliverNewsletter({
        newsletterId: row.id,
        recipients: contacts.map((c) => c.email!).filter(Boolean),
        subject: row.subject,
        htmlContent: row.htmlContent || '',
        appUrl,
      });
      await prisma.newsletter.update({
        where: { id: row.id },
        data: {
          status: result.failed === 0 ? 'sent' : 'partial',
          sentAt: new Date(),
          successCount: result.sent,
          failedCount: result.failed,
          failedRecipients: result.failedRecipients as any,
        },
      });
      return res.json({ ok: true, sent: result.sent, failed: result.failed });
    } else {
      const result = await sendSms({
        message: row.htmlContent || row.introText || '',
        recipients: contacts.map((c) => ({ name: c.name, phone: c.phone!, email: c.email })),
        sender: 'Stodona',
      });
      await prisma.newsletter.update({
        where: { id: row.id },
        data: {
          status: result.failed === 0 ? 'sent' : 'partial',
          sentAt: new Date(),
          successCount: result.sent,
          failedCount: result.failed,
          failedRecipients: result.failedRecipients as any,
        },
      });
      return res.json({ ok: true, sent: result.sent, failed: result.failed, optedOut: result.optedOut });
    }
  } catch (err: any) {
    await prisma.newsletter.update({
      where: { id: row.id },
      data: { status: 'failed' },
    });
    return res.status(500).json({ error: err?.message || 'Sändning misslyckades.' });
  }
});

export default router;
