/**
 * GET /api/contracts-file?id=<fileId> — serverar en avtalfil (PDF/DOCX).
 *
 * Behörighet: användaren måste vara superadmin, ägare av kontraktet som
 * refererar filen, eller ha ContractPermission (READ+) på det kontraktet.
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getAuth } from '@clerk/express';
import { prisma } from './_lib/prisma.js';

const SUPERADMIN_EMAILS = (
  process.env.CONTRACT_SUPERADMIN_EMAILS || 'mikaela.wigert@stodona.se,info@stodona.se'
)
  .split(',')
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') return res.status(405).send('Method Not Allowed');

  const auth = getAuth(req as any);
  const userId = auth?.userId;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  const id = String(req.query.id || '');
  if (!id) return res.status(400).json({ error: 'id krävs' });

  const file = await prisma.contractFile.findUnique({
    where: { id },
    include: { attachments: { select: { contractId: true } } },
  });
  if (!file) return res.status(404).json({ error: 'Not found' });

  // Är användaren superadmin?
  const email = (auth?.sessionClaims as any)?.email?.toLowerCase?.() ?? '';
  const isSuperadmin = email && SUPERADMIN_EMAILS.includes(email);

  if (!isSuperadmin) {
    const contractIds = file.attachments.map((a) => a.contractId);
    if (contractIds.length === 0) return res.status(403).json({ error: 'No access' });
    const accessibleCount = await prisma.contract.count({
      where: {
        id: { in: contractIds },
        OR: [
          { ownerClerkId: userId },
          {
            permissions: {
              some: {
                clerkUserId: userId,
                OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
              },
            },
          },
        ],
      },
    });
    if (accessibleCount === 0) return res.status(403).json({ error: 'No access' });
  }

  const buffer = Buffer.from(file.data, 'base64');
  res.setHeader('Content-Type', file.mime);
  res.setHeader('Content-Length', String(buffer.length));
  res.setHeader('Content-Disposition', `inline; filename="contract-${id}.${extFor(file.mime)}"`);
  res.setHeader('Cache-Control', 'private, max-age=300');
  res.status(200).send(buffer);
}

function extFor(mime: string): string {
  if (mime === 'application/pdf') return 'pdf';
  if (mime.includes('word')) return 'docx';
  return 'bin';
}
