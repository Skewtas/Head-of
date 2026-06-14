/**
 * GET /api/newsletter/staged-image/:id — serverar en pre-uppladdad bild.
 * Cachas aggressivt så Gmail/Outlook bara hämtar den en gång per mottagare.
 */
import { prisma } from '../../_lib/prisma.js';
import type { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const { id } = req.query;
  if (typeof id !== 'string') return res.status(400).send('Invalid id');

  const row = await prisma.newsletterImage.findUnique({ where: { id } });
  if (!row) return res.status(404).send('Not found');

  const buffer = Buffer.from(row.data, 'base64');
  res.setHeader('Content-Type', row.mime || 'image/jpeg');
  res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  res.send(buffer);
}
