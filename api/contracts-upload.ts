/**
 * POST /api/contracts-upload — upload existing signed/unsigned contract.
 *
 * Body: { title, category, ownCompanyId, person: {...} | personId,
 *         externalCompanyName?, externalCompanyOrgNr?,
 *         startDate?, endDate?, alreadySigned, signedAt?,
 *         file: { filename, contentType, base64 } }
 *
 * Skapar Contract + ContractPerson (om ny) + ContractAttachment + ContractFile
 * i en enda transaktion. Ownern blir current clerk user.
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { prisma } from './_lib/prisma.js';
import { getAuth } from '@clerk/express';

// Vercel-body cap är 4.5 MB → tillåt 5 för att lämna lite marginal på metadata
export const config = { api: { bodyParser: { sizeLimit: '5mb' } }, maxDuration: 30 };

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).send('Method Not Allowed');

  const auth = getAuth(req as any);
  const userId = auth?.userId;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  const b = (req.body || {}) as any;

  // Validera minimum
  if (!b.title || !b.category || !b.ownCompanyId) {
    return res.status(400).json({ error: 'title, category och ownCompanyId krävs' });
  }
  if (!b.file?.base64 || !b.file?.filename) {
    return res.status(400).json({ error: 'file.base64 + file.filename krävs' });
  }

  const contentType = b.file.contentType || guessContentType(b.file.filename);
  if (contentType !== 'application/pdf' && !contentType.includes('word') && !contentType.includes('officedocument')) {
    return res.status(400).json({ error: `Otillåten filtyp: ${contentType}` });
  }

  // Strippa data: prefix om det finns
  let pureBase64 = b.file.base64 as string;
  const m = pureBase64.match(/^data:[^;]+;base64,(.+)$/);
  if (m) pureBase64 = m[1];
  const sizeBytes = Math.floor((pureBase64.length * 3) / 4);
  if (sizeBytes > 4_500_000) {
    return res.status(413).json({ error: 'Filen är större än 4.5 MB' });
  }

  try {
    const contract = await prisma.$transaction(async (tx) => {
      // Person: befintlig id eller skapa ny
      let personId: number | null = null;
      if (typeof b.personId === 'number') {
        personId = b.personId;
      } else if (b.person && (b.person.firstName || b.person.lastName)) {
        const p = await tx.contractPerson.create({
          data: {
            firstName: (b.person.firstName || '').trim(),
            lastName: (b.person.lastName || '').trim(),
            personalNumber: b.person.personalNumber || null,
            email: b.person.email || null,
            phone: b.person.phone || null,
            address: b.person.address || null,
            postalCode: b.person.postalCode || null,
            city: b.person.city || null,
            linkedEmployeeId: b.person.linkedEmployeeId || null,
          },
        });
        personId = p.id;
      }

      // Kontrakt
      const alreadySigned = !!b.alreadySigned;
      const status = alreadySigned
        ? (isActive(b.endDate) ? 'ACTIVE' : 'EXPIRED')
        : 'DRAFT';

      const c = await tx.contract.create({
        data: {
          title: b.title,
          category: b.category,
          status,
          ownCompanyId: b.ownCompanyId,
          personId,
          externalCompanyName: b.externalCompanyName || null,
          externalCompanyOrgNr: b.externalCompanyOrgNr || null,
          startDate: b.startDate ? new Date(b.startDate) : null,
          endDate: b.endDate ? new Date(b.endDate) : null,
          probationEndDate: b.probationEndDate ? new Date(b.probationEndDate) : null,
          ownerClerkId: userId,
          metadata: {
            uploadedExisting: true,
            alreadySigned,
            signedAt: b.signedAt ?? null,
          } as any,
        },
      });

      // Fil
      const file = await tx.contractFile.create({
        data: { mime: contentType, data: pureBase64, sizeBytes },
      });

      // Attachment
      await tx.contractAttachment.create({
        data: {
          contractId: c.id,
          filename: b.file.filename,
          contentType,
          fileUrl: `/api/contracts-file?id=${file.id}`,
          fileId: file.id,
          uploadedByClerkId: userId,
        },
      });

      // Audit
      await tx.auditLog.create({
        data: {
          actorClerkId: userId,
          action: 'uploaded_existing',
          entityType: 'Contract',
          entityId: String(c.id),
          after: { title: c.title, filename: b.file.filename, alreadySigned },
        },
      });

      return c;
    });

    res.status(201).json({ id: contract.id, title: contract.title, status: contract.status });
  } catch (err: any) {
    console.error('[contracts-upload]', err.message);
    res.status(500).json({ error: err.message });
  }
}

function isActive(endDateIso?: string | null): boolean {
  if (!endDateIso) return true;
  return new Date(endDateIso).getTime() >= Date.now();
}

function guessContentType(filename: string): string {
  const ext = filename.toLowerCase().split('.').pop();
  if (ext === 'pdf') return 'application/pdf';
  if (ext === 'docx') return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  if (ext === 'doc') return 'application/msword';
  return 'application/octet-stream';
}
