/**
 * POST /api/newsletter/:id/resend — påminnelse till alla mottagare som
 * INTE öppnat nyhetsbrevet. Skapar ett barn-Newsletter och enqueua hela
 * mottagarlistan; cron processar resten i bakgrunden.
 */
import { prisma } from '../../_lib/prisma.js';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { deliverNewsletter } from '../../_lib/newsletterSender.js';

export const config = { maxDuration: 60 };

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { id } = req.query;
  const { newSubject } = (req.body || {}) as { newSubject?: string };
  if (typeof id !== 'string') return res.status(400).json({ error: 'Missing ID' });

  const original = await prisma.newsletter.findUnique({ where: { id } });
  if (!original) return res.status(404).json({ error: 'Newsletter not found.' });

  const recipients = (original.recipients as string[]) || [];
  const openedBy = (original.openedBy as string[]) || [];
  const unopened = recipients.filter((r) => !openedBy.includes(r));

  if (unopened.length === 0) {
    return res.status(400).json({ error: 'Alla mottagare har redan öppnat nyhetsbrevet.' });
  }

  // Filtrera bort blockerade via central suppressionList
  const { filterAllowedEmails } = await import('../../_lib/suppressionList.js');
  const targets = await filterAllowedEmails(unopened);
  if (targets.length === 0) {
    return res.status(400).json({ error: 'Alla återstående mottagare har avregistrerat sig.' });
  }

  const subject = newSubject || `Påminnelse: ${original.subject}`;
  const baseUrl = process.env.APP_URL || `https://${req.headers.host}`;

  // Skapa ny rad och pre-fyll kön
  const child = await prisma.newsletter.create({
    data: {
      subject,
      category: original.category,
      introText: original.introText,
      imageData: original.imageData,
      embedUrl: original.embedUrl,
      htmlContent: original.htmlContent,
      recipients: targets as any,
      pendingRecipients: targets as any,
      status: 'sending',
      parentNewsletterId: original.id,
    },
  });

  // Försök max 45 s synkront, resten via cron
  const result = await deliverNewsletter({
    newsletterId: child.id,
    recipients: targets,
    subject,
    introText: original.introText,
    imageData: original.imageData,
    embedUrl: original.embedUrl,
    htmlContent: original.htmlContent,
    appUrl: baseUrl,
    budgetMs: 45_000,
  });

  const isQueued = result.remainingRecipients.length > 0;
  const finalStatus = isQueued
    ? 'queued'
    : result.failed === 0
      ? 'sent'
      : result.sent > 0
        ? 'partial'
        : 'failed';

  await prisma.newsletter.update({
    where: { id: child.id },
    data: {
      status: finalStatus,
      successCount: result.sent,
      failedCount: result.failed,
      failedRecipients: result.failedRecipients as any,
      pendingRecipients: result.remainingRecipients as any,
      sentAt: new Date(),
    },
  });

  res.json({
    success: true,
    childNewsletterId: child.id,
    queued: isQueued,
    sent: result.sent,
    pending: result.remainingRecipients.length,
    failed: result.failed,
    targets: targets.length,
    message: isQueued
      ? `Skickade ${result.sent} direkt, ${result.remainingRecipients.length} ligger i kö (bakgrund).`
      : `Skickat till ${result.sent}/${targets.length} mottagare.`,
  });
}
