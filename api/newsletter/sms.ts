import type { VercelRequest, VercelResponse } from '@vercel/node';
import { prisma } from '../_lib/prisma';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const sureSmsKey = process.env.SURESMS_API_KEY;
  if (!sureSmsKey) {
    return res.status(500).json({ error: 'SURESMS_API_KEY is not configured' });
  }

  const { message, recipients, sender, includeOptOutLink } = req.body as {
    message: string;
    recipients: { name: string; phone: string; email: string }[];
    sender?: string;
    includeOptOutLink?: boolean;
  };

  if (!message || !recipients || recipients.length === 0) {
    return res.status(400).json({ error: 'Message and at least one recipient are required' });
  }

  if (message.length > 918) {
    return res.status(400).json({ error: 'SMS-meddelandet är för långt (max 918 tecken / 6 SMS-delar)' });
  }

  // Fetch opt-outs
  const optOutDoc = await prisma.automatedTemplate.findUnique({ where: { id: 'system_optouts' } });
  let optOutData: { emails: string[], phones: string[] } = { emails: [], phones: [] };
  if (optOutDoc && optOutDoc.blocks && typeof optOutDoc.blocks === 'object') {
    optOutData = optOutDoc.blocks as any;
  }
  const optOutSet = new Set(optOutData.phones || []);

  const fromName = sender || 'Stodona.se';
  let successCount = 0;
  const failed: { phone: string; error: string }[] = [];

  for (const recipient of recipients) {
    const { phone, email } = recipient;
    if (!phone) {
      failed.push({ phone: '(saknas)', error: 'Inget telefonnummer' });
      continue;
    }
    if (optOutSet.has(phone)) {
      continue; // Skip opted out phones silently or log them, we just skip them here.
    }

    // Personalize message with {{name}} placeholder
    let finalMessage = message.replace(/\{\{name\}\}/gi, recipient.name.split(' ')[0]);

    if (includeOptOutLink && email) {
      const b64Phone = Buffer.from(phone).toString('base64');
      // For SMS, we use a shorter representation if possible, but base64 is easiest.
      finalMessage += `\n\nAvanmäl: app.stodona.se/api/newsletter/optout?id=${b64Phone}&type=SMS`;
    }

    const smsParams = new URLSearchParams({
      login: 'apikey',
      password: sureSmsKey,
      to: phone,
      text: finalMessage,
      from: fromName,
    });

    try {
      const smsRes = await fetch(
        `https://api.suresms.com/Script/SendSMS.aspx?${smsParams.toString()}`
      );
      const responseText = await smsRes.text();

      if (smsRes.ok && !responseText.toLowerCase().includes('error')) {
        successCount++;
        console.log(`[SMS] ✓ Sent to ${phone}`);
      } else {
        console.error(`[SMS] ✗ Failed for ${phone}:`, responseText);
        failed.push({ phone, error: responseText.substring(0, 100) });
      }
    } catch (err: any) {
      console.error(`[SMS] ✗ Network error for ${phone}:`, err.message);
      failed.push({ phone, error: err.message });
    }
  }

  const total = recipients.length;
  const msg = `SMS skickat till ${successCount}/${total} mottagare${failed.length > 0 ? ` (${failed.length} misslyckades)` : ''}.`;

  return res.json({
    success: successCount > 0,
    message: msg,
    sent: successCount,
    failed: failed.length,
    failedDetails: failed.length > 0 ? failed : undefined,
  });
}
