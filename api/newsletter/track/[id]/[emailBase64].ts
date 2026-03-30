import { prisma } from '../../../_lib/prisma';
import type { VercelRequest, VercelResponse } from '@vercel/node';

const TRACKING_PIXEL = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { id, emailBase64 } = req.query;
  
  if (typeof id === 'string' && typeof emailBase64 === 'string') {
    try {
      const email = Buffer.from(emailBase64, 'base64').toString('utf-8');
      
      const newsletter = await prisma.newsletter.findUnique({
        where: { id }
      });
      
      if (newsletter) {
        const openedBy = newsletter.openedBy as string[] || [];
        const recipients = newsletter.recipients as string[] || [];
        
        if (recipients.includes(email) && !openedBy.includes(email)) {
          openedBy.push(email);
          
          await prisma.newsletter.update({
            where: { id },
            data: { openedBy }
          });
          
          console.log(`[TRACKING] Newsletter ${id} opened by ${email}`);
        }
      }
    } catch (err) {
      console.error('Tracking pixel error:', err);
    }
  }

  // Always return the invisible 1x1 GIF so the email client doesn't break
  res.writeHead(200, { 
    'Content-Type': 'image/gif', 
    'Content-Length': TRACKING_PIXEL.length, 
    'Cache-Control': 'no-store, no-cache, must-revalidate, private' 
  });
  res.end(TRACKING_PIXEL);
}
