/**
 * /api/admin — Superadmin-endpoints (Mikaela / CONTRACT_SUPERADMIN_EMAILS).
 *
 * Fas 1: Bjud in ny användare via Clerk (skickar aktiveringsmail till
 * angiven email — mottagaren sätter själv sitt lösenord). Ingen risk för
 * att lösenord läcker.
 */
import express, { Request, Response } from 'express';
import { z } from 'zod';
import { clerkClient } from '@clerk/express';
import { requireAuth, getUserId } from '../_lib/auth.js';

const router = express.Router();
router.use(requireAuth);

const SUPERADMIN_EMAILS = (
  process.env.CONTRACT_SUPERADMIN_EMAILS || 'mikaela.wigert@stodona.se'
).split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);

async function requireSuperadmin(req: Request, res: Response): Promise<boolean> {
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

    res.json({
      ok: true,
      invitationId: invitation.id,
      email: body.email,
      status: invitation.status,
      note: `Aktiveringsmail har skickats till ${body.email}. Mottagaren klickar på länken och sätter sitt eget lösenord.`,
    });
  } catch (err: any) {
    console.error('[invite-user]', err?.message, err?.errors);
    res.status(500).json({
      error: err?.message || 'Kunde inte skicka inbjudan',
      details: err?.errors || null,
    });
  }
});

export default router;
