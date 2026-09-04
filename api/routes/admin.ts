/**
 * /api/admin — Superadmin-endpoints (Mikaela / CONTRACT_SUPERADMIN_EMAILS).
 *
 * Fas 1: Bjud in ny användare via Clerk (skickar aktiveringsmail till
 * angiven email — mottagaren sätter själv sitt lösenord). Ingen risk för
 * att lösenord läcker.
 */
import express, { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { clerkClient } from '@clerk/express';
import { requireAuth, getUserId } from '../_lib/auth.js';
import { deliverNewsletter } from '../_lib/newsletterSender.js';

const router = express.Router();

// Auth-middleware: godkänner ANTINGEN Clerk-session (vanligt) ELLER
// Bearer <CRON_SECRET> (för superadmin-skript/curl).
function authOrCronSecret(req: Request, res: Response, next: NextFunction) {
  const authHdr = req.headers.authorization || '';
  const secret = process.env.CRON_SECRET;
  if (secret && authHdr === `Bearer ${secret}`) {
    (req as any).authSource = 'cron_secret';
    return next();
  }
  return requireAuth(req, res, next);
}
router.use(authOrCronSecret);

const SUPERADMIN_EMAILS = (
  process.env.CONTRACT_SUPERADMIN_EMAILS || 'mikaela.wigert@stodona.se'
).split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);

async function requireSuperadmin(req: Request, res: Response): Promise<boolean> {
  // CRON_SECRET bypass — anropad från serversida med korrekt bearer
  if ((req as any).authSource === 'cron_secret') return true;

  const userId = getUserId(req);
  if (!userId) { res.status(401).json({ error: 'Unauthorized' }); return false; }
  try {
    const u = await clerkClient.users.getUser(userId);
    const email = u.emailAddresses?.find((e: any) => e.id === u.primaryEmailAddressId)?.emailAddress
      ?? u.emailAddresses?.[0]?.emailAddress
      ?? '';
    if (SUPERADMIN_EMAILS.includes(email.toLowerCase())) return true;
    res.status(403).json({ error: 'Endast superadmin.', yourEmail: email });
    return false;
  } catch (e: any) {
    res.status(500).json({ error: e?.message || 'auth check failed' });
    return false;
  }
}

/**
 * POST /api/admin/invite-user
 * Skickar en Clerk-invitation till angiven email.
 * Mottagaren får ett aktiveringsmail, klickar på länken, sätter lösenord,
 * och kan logga in på head-of.vercel.app.
 */
router.post('/invite-user', async (req, res) => {
  if (!(await requireSuperadmin(req, res))) return;

  const body = z.object({
    email: z.string().email(),
    firstName: z.string().optional(),
    lastName: z.string().optional(),
    notes: z.string().optional(),
    /** Om satt: skicka även ett notifieringsmail till dessa adresser med info om nytt konto */
    notifyRecipients: z.array(z.string().email()).optional(),
    /** Vem inbjudan gäller (om delat konto: t.ex. "Elvedina") */
    forPersonName: z.string().optional(),
  }).parse(req.body);

  try {
    // Kolla om användare med samma email redan finns
    const existing = await clerkClient.users.getUserList({ emailAddress: [body.email] });
    const existingArr = (existing as any)?.data ?? (Array.isArray(existing) ? existing : []);
    if (existingArr.length > 0) {
      return res.status(409).json({
        error: `En användare med email ${body.email} finns redan.`,
        userId: existingArr[0].id,
        suggestion: 'Använd Clerk-dashboarden för att skicka lösenordsåterställning istället.',
      });
    }

    // Skapa invitation via Clerk Backend API
    const appUrl = process.env.APP_URL || `https://${req.headers.host}`;
    const invitation = await clerkClient.invitations.createInvitation({
      emailAddress: body.email,
      redirectUrl: appUrl,
      publicMetadata: {
        invitedBy: getUserId(req),
        invitedAt: new Date().toISOString(),
        notes: body.notes || null,
      } as any,
      notify: true, // Clerk skickar automatiskt aktiveringsmail
      ignoreExisting: false,
    });

    // Skicka bekräftelse-/info-mail (om notifyRecipients är satt)
    let notification: any = null;
    if (body.notifyRecipients && body.notifyRecipients.length > 0) {
      const forName = body.forPersonName || body.firstName || 'ny användare';
      const html = `
        <div style="font-family:Inter,Arial,sans-serif;color:#1a1a2e;line-height:1.6;max-width:560px;margin:0 auto;padding:24px;">
          <h1 style="font-family:'Playfair Display',Georgia,serif;font-size:24px;margin:0 0 16px;">
            Nytt inlogg — ${escapeHtml(forName)}
          </h1>
          <p style="margin:0 0 16px;">Hej,</p>
          <p style="margin:0 0 16px;">
            Ett användarkonto har skapats för <strong>${escapeHtml(forName)}</strong> i HeadOf-systemet.
          </p>
          <div style="padding:16px 20px;background:#faf7ee;border-left:3px solid #c9a96e;margin:0 0 16px;">
            <div style="font-size:11px;letter-spacing:0.14em;text-transform:uppercase;color:#a68a4e;font-weight:700;margin-bottom:8px;">Så här loggar hen in</div>
            <p style="margin:0 0 8px;"><strong>Adress:</strong> <a href="${appUrl}" style="color:#a68a4e;">${appUrl}</a></p>
            <p style="margin:0 0 8px;"><strong>Inlogg (email):</strong> ${escapeHtml(body.email)}</p>
            <p style="margin:0;"><strong>Lösenord:</strong> sätts av mottagaren själv via aktiveringslänken i inbjudningsmailet från Clerk (kolla inkorgen på ${escapeHtml(body.email)})</p>
          </div>
          <p style="margin:0 0 16px;">
            Om aktiveringsmailet inte kommer fram, kolla skräppost eller be om en ny inbjudan.
          </p>
          <p style="margin:0 0 0;color:#8b8578;font-size:12px;">
            /HeadOf-systemet
          </p>
        </div>
      `;
      try {
        const notifRes = await deliverNewsletter({
          newsletterId: `invite-${invitation.id}`,
          recipients: body.notifyRecipients,
          subject: `Nytt inlogg — ${forName}`,
          htmlContent: html,
          appUrl,
        });
        notification = { sent: notifRes.sent, failed: notifRes.failed };
      } catch (e: any) {
        notification = { error: e?.message || 'notification failed' };
      }
    }

    res.json({
      ok: true,
      invitationId: invitation.id,
      email: body.email,
      status: invitation.status,
      note: `Aktiveringsmail har skickats till ${body.email}. Mottagaren klickar på länken och sätter sitt eget lösenord.`,
      notification,
    });
  } catch (err: any) {
    console.error('[invite-user]', err?.message, err?.errors);
    res.status(500).json({
      error: err?.message || 'Kunde inte skicka inbjudan',
      details: err?.errors || null,
    });
  }
});

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export default router;
