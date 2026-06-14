/**
 * Bakgrundskö för nyhetsbrev — körs varje minut via Vercel-cron.
 * Plockar upp Newsletter-rader med pendingRecipients[].length > 0 och betar av
 * dem inom 45 s. Det som inte hinns med ligger kvar tills nästa körning.
 *
 * Strömlinjeformat så ett 50 000-utskick rullar av sig själv i bakgrunden:
 * användaren får ett svar direkt från /send med "X skickat, Y i kö", och
 * efterhand som cron körs tickar successCount upp.
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { prisma } from '../_lib/prisma.js';
import { deliverNewsletter } from '../_lib/newsletterSender.js';

export const config = { maxDuration: 60 };

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).send('Method Not Allowed');
  }

  if (process.env.CRON_SECRET) {
    const auth = req.headers.authorization || '';
    if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
  }

  const baseUrl = process.env.APP_URL || `https://${req.headers.host}`;

  // Plocka upp till 3 utskick parallellt — i praktiken blir det 1 åt gången
  // för en typisk kund men vi tar höjd för flera samtidiga sänd-jobb.
  const queued = await prisma.newsletter.findMany({
    where: { status: { in: ['queued', 'sending'] } },
    orderBy: { sentAt: 'asc' },
    take: 3,
  });

  const results: any[] = [];
  for (const n of queued) {
    const pending = (n.pendingRecipients as string[] | undefined) ?? [];
    if (pending.length === 0) {
      // Inget kvar — markera färdig
      await prisma.newsletter.update({
        where: { id: n.id },
        data: {
          status: n.failedCount > 0 ? (n.successCount > 0 ? 'partial' : 'failed') : 'sent',
        },
      });
      continue;
    }
    try {
      const r = await deliverNewsletter({
        newsletterId: n.id,
        recipients: pending,
        subject: n.subject,
        introText: n.introText,
        imageData: n.imageData,
        embedUrl: n.embedUrl,
        htmlContent: n.htmlContent,
        appUrl: baseUrl,
        budgetMs: 45_000,
      });
      const newSuccess = n.successCount + r.sent;
      const newFailed = n.failedCount + r.failed;
      const stillPending = r.remainingRecipients.length;
      const newFailedList = [
        ...((n.failedRecipients as string[] | undefined) ?? []),
        ...r.failedRecipients,
      ];
      const finalStatus =
        stillPending > 0
          ? 'queued'
          : newFailed === 0
            ? 'sent'
            : newSuccess > 0
              ? 'partial'
              : 'failed';
      await prisma.newsletter.update({
        where: { id: n.id },
        data: {
          status: finalStatus,
          successCount: newSuccess,
          failedCount: newFailed,
          failedRecipients: newFailedList as any,
          pendingRecipients: r.remainingRecipients as any,
        },
      });
      results.push({
        id: n.id,
        sent: r.sent,
        failed: r.failed,
        stillPending,
        status: finalStatus,
      });
    } catch (err: any) {
      console.error(`[queue] failed processing ${n.id}:`, err.message);
      results.push({ id: n.id, error: err.message });
    }
  }

  res.json({ ok: true, processed: results.length, results, timestamp: new Date().toISOString() });
}
