import { prisma } from '../../../_lib/prisma.js';
import type { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { id, emailBase64, url } = req.query;

  if (!url || typeof url !== 'string') {
    return res.status(400).send("Invalid link");
  }

  if (typeof id === 'string' && typeof emailBase64 === 'string') {
    try {
      const email = Buffer.from(emailBase64, 'base64').toString('utf-8');
      
      const newsletter = await prisma.newsletter.findUnique({
        where: { id }
      });
      
      if (newsletter) {
        const clickedBy = newsletter.clickedBy as string[] || [];
        
        if (!clickedBy.includes(email)) {
          clickedBy.push(email);
          
          await prisma.newsletter.update({
            where: { id },
            data: { clickedBy }
          });
          
          console.log(`[TRACKING] Newsletter ${id} LINK CLICKED by ${email} -> ${url}`);
        }
      }
    } catch (err) {
      console.error('Click tracking error:', err);
    }
  }

  // Redirect to the original URL
  res.redirect(url as string);
}
