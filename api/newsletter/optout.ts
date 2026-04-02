import type { VercelRequest, VercelResponse } from '@vercel/node';
import { prisma } from '../_lib/prisma.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    return res.status(405).send('Method not allowed');
  }

  const { id, type } = req.query;

  if (!id || typeof id !== 'string' || !type || typeof type !== 'string') {
    return res.status(400).send('Ogiltig länk');
  }

  try {
    // Decode base64 identifier
    const identifier = Buffer.from(id as string, 'base64').toString('utf-8');
    const isSms = (type as string).toUpperCase() === 'SMS';

    // Fetch existing opt-outs
    let optOutDoc = await prisma.automatedTemplate.findUnique({
      where: { id: 'system_optouts' }
    });

    let optOutData: { emails: string[], phones: string[] } = { emails: [], phones: [] };
    
    if (optOutDoc && optOutDoc.blocks && typeof optOutDoc.blocks === 'object') {
      optOutData = optOutDoc.blocks as any;
    }

    if (!optOutData.emails) optOutData.emails = [];
    if (!optOutData.phones) optOutData.phones = [];

    if (isSms && !optOutData.phones.includes(identifier)) {
      optOutData.phones.push(identifier);
    } else if (!isSms && !optOutData.emails.includes(identifier)) {
      optOutData.emails.push(identifier);
    }

    // Upsert the system_optouts document
    await prisma.automatedTemplate.upsert({
      where: { id: 'system_optouts' },
      update: { blocks: optOutData as any },
      create: {
        id: 'system_optouts',
        subject: 'SYSTEM_OPTOUTS',
        blocks: optOutData as any
      }
    });

    const html = `
    <!DOCTYPE html>
    <html lang="sv">
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <title>Avregistrering bekräftad</title>
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #f5f3ef; color: #1a1a2e; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; text-align: center; padding: 20px; }
        .card { background: white; padding: 40px; border-radius: 16px; box-shadow: 0 4px 20px rgba(0,0,0,0.05); max-width: 400px; width: 100%; }
        .icon { width: 64px; height: 64px; background: #fee2e2; color: #ef4444; border-radius: 50%; display: flex; align-items: center; justify-content: center; margin: 0 auto 24px; font-size: 32px; }
        h1 { font-size: 24px; margin-top: 0; margin-bottom: 16px; font-weight: 500; }
        p { color: #666; line-height: 1.6; margin-bottom: 24px; }
        .footer { font-size: 13px; color: #999; }
      </style>
    </head>
    <body>
      <div class="card">
        <div class="icon">✓</div>
        <h1>Avregistrering bekräftad</h1>
        <p>
          Du har nu avregistrerats och kommer inte längre att ta emot ${(type as string).toUpperCase() === 'SMS' ? 'SMS' : 'e-post'}-utskick från Stodona.
        </p>
        <div class="footer">Stodona AB</div>
      </div>
    </body>
    </html>
    `;

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.status(200).send(html);
  } catch (err) {
    console.error('Opt-out error:', err);
    res.status(500).send('Ett serverfel uppstod. Vänligen kontakta support.');
  }
}
