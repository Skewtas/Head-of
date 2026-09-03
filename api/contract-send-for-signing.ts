/**
 * Dedikerad flat-endpoint för att skicka signeringslänk.
 * Snabbare cold-start än Express-routen som laddar 15+ routers.
 *
 * POST /api/contract-send-for-signing?id=<contractId>
 * Kräver Clerk-session (samma som resten av appen).
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { clerkClient, verifyToken } from '@clerk/backend';
import { prisma } from './_lib/prisma.js';
import { issueSigningToken } from './_lib/signingToken.js';
import { deliverNewsletter } from './_lib/newsletterSender.js';

export const config = { maxDuration: 60 };

async function getClerkUserId(req: VercelRequest): Promise<string | null> {
  // Läser Clerk-session från cookie (samma som Express-appens clerkMiddleware)
  const cookieHdr = req.headers.cookie || '';
  const sessionMatch = cookieHdr.match(/__session=([^;]+)/);
  const token = sessionMatch?.[1];
  if (!token) return null;
  try {
    const secretKey = process.env.CLERK_SECRET_KEY;
    if (!secretKey) return null;
    const payload = await verifyToken(token, { secretKey });
    return (payload as any)?.sub || null;
  } catch { return null; }
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Diagnostik: /api/contract-send-for-signing?envcheck=1 → visa env-status utan auth
  if (req.query.envcheck === '1') {
    return res.json({
      SIGNING_SECRET: !!process.env.SIGNING_SECRET,
      SIGNING_SECRET_length: process.env.SIGNING_SECRET?.length || 0,
      CRON_SECRET: !!process.env.CRON_SECRET,
      CRON_SECRET_length: process.env.CRON_SECRET?.length || 0,
      RESEND_API_KEY: !!process.env.RESEND_API_KEY,
      CLERK_SECRET_KEY: !!process.env.CLERK_SECRET_KEY,
      SMTP_FROM: process.env.SMTP_FROM || null,
      APP_URL: process.env.APP_URL || null,
      VERCEL_ENV: process.env.VERCEL_ENV || null,
      NODE_ENV: process.env.NODE_ENV || null,
    });
  }
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const userId = await getClerkUserId(req);
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  const id = Number(req.query.id || (req.body as any)?.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'Ogiltigt contract-id' });

  try {
    // Hämta allt vi behöver i EN query (undviker sekventiella round-trips)
    const contract = await prisma.contract.findUnique({
      where: { id },
      include: {
        person: true,
        ownCompany: true,
        versions: { orderBy: { version: 'desc' }, take: 1 },
        signers: { orderBy: { signingOrder: 'asc' } },
      },
    });
    if (!contract) return res.status(404).json({ error: 'Avtalet hittades inte.' });
    if (!contract.person?.email) {
      return res.status(400).json({ error: 'Avtalet kan inte skickas — den anställdes e-post saknas.' });
    }
    if (!contract.versions[0]) return res.status(400).json({ error: 'Ingen avtalsversion finns.' });

    const employeeName = `${contract.person.firstName} ${contract.person.lastName}`.trim();
    const employeeEmail = contract.person.email;
    const employerName = contract.ownCompany.signatoryName || 'Arbetsgivare';
    const employerEmail = contract.ownCompany.signatoryEmail || 'info@stodona.se';

    // Upsert signers: återanvänd befintliga PENDING istället för deleteMany
    let employeeSigner = contract.signers.find((s) => s.signingOrder === 1);
    if (!employeeSigner) {
      employeeSigner = await prisma.signer.create({
        data: { contractId: id, name: employeeName, email: employeeEmail, signingOrder: 1, status: 'PENDING' },
      });
    } else if (employeeSigner.status !== 'SIGNED') {
      employeeSigner = await prisma.signer.update({
        where: { id: employeeSigner.id },
        data: { name: employeeName, email: employeeEmail, status: 'PENDING' },
      });
    }
    const employerSigner = contract.signers.find((s) => s.signingOrder === 2);
    if (!employerSigner) {
      await prisma.signer.create({
        data: { contractId: id, name: employerName, email: employerEmail, signingOrder: 2, status: 'PENDING' },
      });
    } else if (employerSigner.status !== 'SIGNED') {
      await prisma.signer.update({
        where: { id: employerSigner.id },
        data: { name: employerName, email: employerEmail, status: 'PENDING' },
      });
    }

    const appUrl = process.env.APP_URL || `https://${req.headers.host}`;
    const token = issueSigningToken(id, employeeSigner.id);
    const signUrl = `${appUrl}/sign?token=${encodeURIComponent(token)}`;

    const html = `
      <div style="font-family:Inter,Arial,sans-serif;color:#1a1a2e;line-height:1.6;max-width:560px;margin:0 auto;padding:24px;">
        <h1 style="font-family:'Playfair Display',Georgia,serif;font-size:24px;margin:0 0 16px;">Signera ditt anställningsavtal</h1>
        <p style="margin:0 0 16px;">Hej ${escapeHtml(contract.person.firstName)},</p>
        <p style="margin:0 0 16px;">Ett anställningsavtal från <strong>${escapeHtml(contract.ownCompany.name)}</strong> är redo att signeras av dig.</p>
        <div style="text-align:center;margin:24px 0;">
          <a href="${signUrl}" style="display:inline-block;padding:14px 28px;background:#1a1a2e;color:#fff;text-decoration:none;border-radius:8px;font-weight:600;">Öppna &amp; signera avtalet</a>
        </div>
        <p style="margin:0 0 8px;font-size:13px;color:#4b4a55;">Du behöver ange ditt namn, personnummer och mobilnummer för att verifiera identitet.</p>
        <p style="margin:0;font-size:12px;color:#8b8578;">Länken är personlig och giltig i 30 dagar.</p>
      </div>
    `;

    const recipients = Array.from(new Set([employeeEmail.toLowerCase(), 'mikaela.wigert@stodona.se']));
    const fromAddr = process.env.SMTP_FROM || 'info@stodona.se';

    let deliverResult: any = null;
    let deliverError: string | null = null;
    try {
      deliverResult = await deliverNewsletter({
        newsletterId: `sign-${id}-${employeeSigner.id}-${Date.now()}`,
        recipients,
        subject: `Signera ditt anställningsavtal — ${contract.ownCompany.name}`,
        htmlContent: html,
        appUrl,
      });
    } catch (e: any) {
      deliverError = e?.message || String(e);
    }

    const mailSent = deliverResult && deliverResult.sent > 0;
    if (!mailSent) {
      return res.status(500).json({
        error: '❌ Mailet gick inte iväg.',
        debug: {
          resendConfigured: !!process.env.RESEND_API_KEY,
          fromAddress: fromAddr,
          recipients,
          deliverResult,
          deliverError,
          signUrl,
        },
      });
    }

    await prisma.contract.update({ where: { id }, data: { status: 'SENT' } });

    return res.json({
      ok: true,
      signerId: employeeSigner.id,
      signUrl,
      employeeEmail,
      recipients,
      fromAddress: fromAddr,
      deliverResult,
      note: `✓ Signeringslänk skickad till ${recipients.join(', ')} från ${fromAddr}.`,
    });
  } catch (err: any) {
    console.error('[contract-send-for-signing]', err?.message, err?.stack);
    res.status(500).json({ error: err?.message || 'Internt fel', stack: err?.stack });
  }
}
