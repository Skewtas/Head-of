/**
 * POST /api/newsletter/staged-image — accepts a single base64-encoded image
 * and stores it in the newsletter_images table. Returns { id, url } that the
 * frontend can drop into <img src> before sending the actual newsletter.
 *
 * Splitting upload from send keeps the /api/newsletter/send POST tiny (just
 * subject + small htmlContent with URLs), so we stay well under Vercel's
 * 4.5 MB request-body cap.
 */
import { prisma } from '../_lib/prisma.js';
import type { VercelRequest, VercelResponse } from '@vercel/node';

export const config = { api: { bodyParser: { sizeLimit: '8mb' } } };

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).send('Method Not Allowed');

  const { data, mime } = (req.body || {}) as { data?: string; mime?: string };
  if (!data || typeof data !== 'string') {
    return res.status(400).json({ error: 'data (base64 string) krävs' });
  }

  // Acceptera både ren base64 och "data:image/...;base64,..."
  let pureBase64 = data;
  let detectedMime = mime;
  const m = data.match(/^data:(image\/[^;]+);base64,(.+)$/);
  if (m) {
    detectedMime = detectedMime || m[1];
    pureBase64 = m[2];
  }
  if (!detectedMime) detectedMime = 'image/jpeg';

  const row = await prisma.newsletterImage.create({
    data: { data: pureBase64, mime: detectedMime },
  });

  const baseUrl = process.env.APP_URL || `https://${req.headers.host}`;
  res.json({ id: row.id, url: `${baseUrl}/api/newsletter/staged-image/${row.id}` });
}
