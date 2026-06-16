/**
 * POST /api/newsletter/:id/daily-reminder
 * body: { enabled: boolean, until?: string (YYYY-MM-DD) }
 *
 * Aktiverar/inaktiverar daglig påminnelse till mottagare som inte öppnat
 * nyhetsbrevet. Cron-jobbet process-daily-reminders kör en gång per dygn och
 * skickar samma innehåll till de som fortfarande inte öppnat.
 */
import { prisma } from '../../_lib/prisma.js';
import type { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).send('Method Not Allowed');

  const { id } = req.query;
  const { enabled, until } = (req.body || {}) as { enabled?: boolean; until?: string | null };
  if (typeof id !== 'string') return res.status(400).json({ error: 'Missing id' });

  const newsletter = await prisma.newsletter.findUnique({ where: { id } });
  if (!newsletter) return res.status(404).json({ error: 'Newsletter not found' });

  const updated = await prisma.newsletter.update({
    where: { id },
    data: {
      dailyReminderEnabled: !!enabled,
      dailyReminderUntil: until ? new Date(until) : null,
    },
  });

  res.json({
    success: true,
    id: updated.id,
    dailyReminderEnabled: updated.dailyReminderEnabled,
    dailyReminderUntil: updated.dailyReminderUntil,
  });
}
