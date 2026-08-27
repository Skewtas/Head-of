/**
 * Vercel Blob client-upload token endpoint för avtal.
 *
 * Klienten ropar POST /api/contracts-blob-upload med en JSON-body enligt
 * @vercel/blob/client-protokollet. Servern genererar en signerad upload-
 * URL som klienten sen laddar upp filen direkt till (kringgår Vercels
 * 4,5 MB request-body-cap).
 *
 * Kräver BLOB_READ_WRITE_TOKEN i miljön (skapas automatiskt när Blob
 * aktiveras för projektet i Vercel-dashboarden).
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { handleUpload, type HandleUploadBody } from '@vercel/blob/client';
import { getAuth } from '@clerk/express';

export const config = { maxDuration: 30 };

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).send('Method Not Allowed');

  // OBS: klient-upload-flödet MÅSTE själv autentisera i onBeforeGenerateToken.
  try {
    const body = req.body as HandleUploadBody;
    const jsonResponse = await handleUpload({
      body,
      request: req as any,
      onBeforeGenerateToken: async (pathname, _clientPayload) => {
        // Verifiera att en riktig användare är påloggad
        let userId: string | null = null;
        try {
          const auth = getAuth(req as any);
          userId = auth?.userId ?? null;
        } catch { /* ignore */ }
        if (!userId) throw new Error('Unauthorized');

        // Begränsa filtyp och storlek
        return {
          allowedContentTypes: [
            'application/pdf',
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            'application/msword',
          ],
          maximumSizeInBytes: 50 * 1024 * 1024, // 50 MB räcker för alla PDF/DOCX
          tokenPayload: JSON.stringify({ userId, pathname }),
        };
      },
      onUploadCompleted: async ({ blob, tokenPayload }) => {
        // Loggning — själva Contract-raden skapas i /api/contracts/upload
        // när klienten postar blob.url + metadata.
        console.log('[contracts-blob-upload] done:', blob.url, tokenPayload);
      },
    });

    return res.status(200).json(jsonResponse);
  } catch (err: any) {
    console.error('[contracts-blob-upload] failed:', err.message);
    return res.status(400).json({ error: err.message });
  }
}
