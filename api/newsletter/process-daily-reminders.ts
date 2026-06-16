/**
 * Vercel-cron varje dag (09:00 lokalt). Plockar upp Newsletter-rader där
 * dailyReminderEnabled = true och skickar samma innehåll igen till de som
 * inte öppnat. Skapar ett barn-Newsletter per omgång (parentNewsletterId =
 * original) och fyller pendingRecipients så att process-queue cronen sen tar
 * över själva levereransen.
 *
 * Stoppar automatiskt:
 *  - när alla mottagare har öppnat (recipients - openedBy är tom)
 *  - när dailyReminderUntil passerats
 *  - om det inte finns några opt-in-mottagare kvar
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { prisma } from '../_lib/prisma.js';

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

  const now = new Date();
  const dayAgo = new Date(now.getTime() - 23 * 3600 * 1000);

  // Hitta originals med dagligt-läge på + senast skickad >= 23 h sedan
  const candidates = await prisma.newsletter.findMany({
    where: {
      dailyReminderEnabled: true,
      parentNewsletterId: null, // bara originals, inte tidigare påminnelser
      OR: [
        { dailyReminderLastSentAt: null },
        { dailyReminderLastSentAt: { lt: dayAgo } },
      ],
    },
  });

  const optOutDoc = await prisma.automatedTemplate.findUnique({ where: { id: 'system_optouts' } });
  const optOutEmails: string[] = (optOutDoc?.blocks as any)?.emails || [];
  const optOutSet = new Set(optOutEmails);

  const results: any[] = [];

  for (const original of candidates) {
    // Auto-disable om until-datumet är passerat
    if (original.dailyReminderUntil && original.dailyReminderUntil < now) {
      await prisma.newsletter.update({
        where: { id: original.id },
        data: { dailyReminderEnabled: false },
      });
      results.push({ id: original.id, action: 'disabled-by-until' });
      continue;
    }

    // Räkna ut vilka som ska få påminnelsen.
    // Vi sammanfogar openedBy från ALLA barn-Newsletters också så vi inte
    // skickar igen till någon som öppnade just gårdagens påminnelse.
    const children = await prisma.newsletter.findMany({
      where: { parentNewsletterId: original.id },
      select: { openedBy: true },
    });
    const opened = new Set<string>();
    for (const r of (original.openedBy as string[]) ?? []) opened.add(r);
    for (const c of children) {
      for (const r of (c.openedBy as string[]) ?? []) opened.add(r);
    }

    const allRecipients = ((original.recipients as string[]) ?? []).filter(
      (e) => !optOutSet.has(e)
    );
    const targets = allRecipients.filter((e) => !opened.has(e));

    if (targets.length === 0) {
      await prisma.newsletter.update({
        where: { id: original.id },
        data: { dailyReminderEnabled: false, dailyReminderLastSentAt: now },
      });
      results.push({ id: original.id, action: 'disabled-everyone-opened' });
      continue;
    }

    // Skapa ett barn-Newsletter och pre-fyll kön. process-queue cronen
    // tar sen över själva levereransen.
    const child = await prisma.newsletter.create({
      data: {
        subject: original.subject,
        category: original.category,
        introText: original.introText,
        imageData: original.imageData,
        embedUrl: original.embedUrl,
        htmlContent: original.htmlContent,
        recipients: targets as any,
        pendingRecipients: targets as any,
        status: 'queued',
        parentNewsletterId: original.id,
      },
    });

    await prisma.newsletter.update({
      where: { id: original.id },
      data: { dailyReminderLastSentAt: now },
    });

    results.push({
      id: original.id,
      action: 'queued',
      childId: child.id,
      targets: targets.length,
    });
  }

  res.json({
    ok: true,
    processed: results.length,
    results,
    timestamp: now.toISOString(),
  });
}
