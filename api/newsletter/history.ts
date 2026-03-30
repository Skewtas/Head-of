import { prisma } from '../_lib/prisma';
import type { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const newsletters = await prisma.newsletter.findMany({
      orderBy: {
        sentAt: 'desc',
      },
    });

    const historyList = newsletters.map((n) => ({
      id: n.id,
      subject: n.subject,
      recipients: n.recipients,
      openedBy: n.openedBy,
      clickedBy: n.clickedBy || [],
      sentAt: n.sentAt.toLocaleString('sv-SE'),
      status: n.status,
      category: n.category,
      successCount: n.successCount,
      failedCount: n.failedCount,
    }));

    return res.json(historyList);
  } catch (error: any) {
    console.error('Error fetching newsletter history:', error);
    return res.status(500).json({ error: 'Database error fetching history' });
  }
}
