/**
 * POST /api/newsletter/:id/resend-failed — försök igen med exakt de
 * mottagare som misslyckades på det förra utskicket. Lägger sig som ett
 * BARN-Newsletter med parentNewsletterId så vi kan följa statistiken
 * separat. Använder samma deliverNewsletter och därmed batch-API:t.
 */
import { prisma } from '../../_lib/prisma.js';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { deliverNewsletter } from '../../_lib/newsletterSender.js';

export const config = { maxDuration: 60 };

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).send('Method Not Allowed');

  const { id } = req.query;
  if (typeof id !== 'string') return res.status(400).json({ error: 'invalid id' });

  const parent = await prisma.newsletter.findUnique({ where: { id } });
  if (!parent) return res.status(404).json({ error: 'newsletter not found' });

  const failed = (parent.failedRecipients as string[] | undefined) ?? [];
  if (failed.length === 0) {
    return res.status(400).json({ error: 'Inga misslyckade mottagare att skicka om till.' });
  }

  // Filtrera bort opt-outs
  const optOutDoc = await prisma.automatedTemplate.findUnique({ where: { id: 'system_optouts' } });
  const optOutEmails: string[] = (optOutDoc?.blocks as any)?.emails || [];
  const optOutSet = new Set(optOutEmails);
  const targets = failed.filter((e) => !optOutSet.has(e));
  if (targets.length === 0) {
    return res.status(400).json({ error: 'Alla misslyckade mottagare har avregistrerat sig.' });
  }

  const baseUrl = process.env.APP_URL || `https://${req.headers.host}`;

  const child = await prisma.newsletter.create({
    data: {
      subject: parent.subject,
      category: parent.category,
      introText: parent.introText,
      imageData: parent.imageData,
      embedUrl: parent.embedUrl,
      htmlContent: parent.htmlContent,
      recipients: targets as any,
      status: 'sending',
      parentNewsletterId: parent.id,
    },
  });

  const result = await deliverNewsletter({
    newsletterId: child.id,
    recipients: targets,
    subject: parent.subject,
    introText: parent.introText,
    imageData: parent.imageData,
    embedUrl: parent.embedUrl,
    htmlContent: parent.htmlContent,
    appUrl: baseUrl,
  });

  const finalStatus = result.failed === 0 ? 'sent' : result.sent > 0 ? 'partial' : 'failed';
  await prisma.newsletter.update({
    where: { id: child.id },
    data: {
      status: finalStatus,
      successCount: result.sent,
      failedCount: result.failed,
      failedRecipients: result.failedRecipients as any,
      sentAt: new Date(),
    },
  });

  // Töm parent.failedRecipients för de som nu lyckades
  const stillFailed = result.failedRecipients;
  await prisma.newsletter.update({
    where: { id: parent.id },
    data: { failedRecipients: stillFailed as any },
  });

  res.json({
    success: true,
    childNewsletterId: child.id,
    attempted: targets.length,
    sent: result.sent,
    stillFailed: stillFailed.length,
  });
}
