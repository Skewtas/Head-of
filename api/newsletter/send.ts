import { prisma } from '../_lib/prisma.js';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { deliverNewsletter } from '../_lib/newsletterSender.js';

// Stora nyhetsbrev med många bilder kan lätt passera 4.5 MB-defaultet,
// och vid 100+ mottagare hinner inte default-timeouten på 10 s med —
// sätt 60 s explicit (max för Vercel Pro).
export const config = {
  api: { bodyParser: { sizeLimit: '15mb' } },
  maxDuration: 60,
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).send('Method Not Allowed');
  const {
    subject,
    introText,
    imageData,
    embedUrl,
    htmlContent,
    recipients,
    category,
    blocks,
    // Scheduling
    scheduledFor,
    reminderEnabled,
    reminderScheduledFor,
    reminderSubject,
  } = req.body as {
    subject: string;
    introText?: string;
    imageData?: string;
    embedUrl?: string;
    htmlContent?: string;
    recipients: string[];
    category?: string;
    blocks?: unknown;
    scheduledFor?: string | null;
    reminderEnabled?: boolean;
    reminderScheduledFor?: string | null;
    reminderSubject?: string;
  };

  if (!subject || !recipients || recipients.length === 0) {
    return res.status(400).json({ error: 'Subject and at least one recipient are required.' });
  }
  if (!imageData && !embedUrl && !htmlContent) {
    return res.status(400).json({ error: 'Nyhetsbrevet behöver innehåll.' });
  }

  // Filter out opted-out emails
  const optOutDoc = await prisma.automatedTemplate.findUnique({ where: { id: 'system_optouts' } });
  let optOutData: { emails: string[]; phones: string[] } = { emails: [], phones: [] };
  if (optOutDoc && optOutDoc.blocks && typeof optOutDoc.blocks === 'object') {
    optOutData = optOutDoc.blocks as any;
  }
  const optOutSet = new Set(optOutData.emails || []);
  const validRecipients = recipients.filter((email: string) => !optOutSet.has(email));

  if (validRecipients.length === 0) {
    return res.status(400).json({ error: 'Alla valda mottagare har avregistrerat sig från e-post.' });
  }

  const now = Date.now();
  const scheduledAt = scheduledFor ? new Date(scheduledFor) : null;
  const isScheduled = !!(scheduledAt && scheduledAt.getTime() > now + 30_000); // > 30s in future

  // Compute reminder schedule:
  //  - if user provided reminderScheduledFor → use it
  //  - else fall back: 48h after send time
  let reminderAt: Date | null = null;
  if (reminderEnabled) {
    if (reminderScheduledFor) {
      reminderAt = new Date(reminderScheduledFor);
    } else {
      const baseTime = scheduledAt ?? new Date();
      reminderAt = new Date(baseTime.getTime() + 48 * 3600_000);
    }
  }

  const baseUrl = process.env.APP_URL || `https://${req.headers.host}`;

  // Create the row
  const newsletter = await prisma.newsletter.create({
    data: {
      subject,
      category: category || 'Allmänt',
      introText: introText || '',
      imageData: imageData || null,
      embedUrl: embedUrl || null,
      htmlContent: htmlContent || null,
      blocks: (blocks as any) ?? undefined,
      recipients: validRecipients,
      status: isScheduled ? 'scheduled' : 'sending',
      scheduledFor: scheduledAt ?? undefined,
      reminderEnabled: !!reminderEnabled,
      reminderScheduledFor: reminderAt ?? undefined,
      reminderSubject: reminderSubject || null,
    },
  });

  // Scheduled — just store and return
  if (isScheduled) {
    return res.json({
      success: true,
      scheduled: true,
      message: `Nyhetsbrev schemalagt till ${scheduledAt!.toLocaleString('sv-SE')}.`,
      newsletterId: newsletter.id,
    });
  }

  // Pre-fyll kön med alla giltiga mottagare så cron kan ta över om
  // vi inte hinner med dem i det första funktionsanropet.
  await prisma.newsletter.update({
    where: { id: newsletter.id },
    data: { pendingRecipients: validRecipients as any },
  });

  // Försök skicka så mycket som möjligt direkt — men avbryt på 45 s
  // så funktionen hinner returnera innan Vercels 60 s-tak.
  const result = await deliverNewsletter({
    newsletterId: newsletter.id,
    recipients: validRecipients,
    subject,
    introText,
    imageData,
    embedUrl,
    htmlContent,
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
    where: { id: newsletter.id },
    data: {
      status: finalStatus,
      successCount: result.sent,
      failedCount: result.failed,
      failedRecipients: result.failedRecipients as any,
      pendingRecipients: result.remainingRecipients as any,
      sentAt: new Date(),
    },
  });

  const msg = !process.env.RESEND_API_KEY
    ? `Nyhetsbrev sparat (Resend ej konfigurerat — inga mail skickades).`
    : isQueued
      ? `Skickade ${result.sent} direkt, ${result.remainingRecipients.length} ligger i kö (körs i bakgrunden varje minut).`
      : `Skickat till ${result.sent}/${validRecipients.length} mottagare${result.failed > 0 ? ` (${result.failed} misslyckades)` : ''}.`;

  res.json({
    success: true,
    scheduled: false,
    queued: isQueued,
    message: msg,
    sent: result.sent,
    failed: result.failed,
    pending: result.remainingRecipients.length,
    newsletterId: newsletter.id,
    reminderScheduledFor: reminderAt,
  });
}
