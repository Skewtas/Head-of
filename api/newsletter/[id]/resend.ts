import { prisma } from '../../_lib/prisma.js';
import type { VercelRequest, VercelResponse } from '@vercel/node';

const buildNewsletterHtml = (opts: {
  introText: string;
  imageData: string | null;
  embedUrl: string | null;
  trackingPixelUrl: string;
  appUrl: string;
}) => {
  const { introText, imageData, embedUrl, trackingPixelUrl, appUrl } = opts;
  const intro = introText ? `<p style="font-size:16px;line-height:1.6;color:#333;margin:0 0 24px;">${introText.replace(/\n/g, '<br/>')}</p>` : '';
  let content = '';
  if (imageData) {
    content = `<img src="${imageData}" alt="Newsletter" style="width:100%;max-width:600px;height:auto;border-radius:12px;" />`;
  } else if (embedUrl) {
    content = `<a href="${embedUrl}" target="_blank" style="display:inline-block;padding:16px 32px;background:#1a1a2e;color:#fff;border-radius:10px;text-decoration:none;font-weight:bold;font-size:14px;">Visa nyhetsbrevet →</a>`;
  }
  return `<!DOCTYPE html><html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width"/></head>
<body style="margin:0;padding:0;background:#f5f3ef;font-family:'Segoe UI',sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f3ef;padding:32px 0;">
  <tr><td align="center">
    <table width="600" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.06);">
      <tr><td style="padding:40px 32px 0;">
        <img src="${appUrl}/logotyp1.png" alt="Stodona" style="height:45px;width:auto;margin-bottom:24px;display:block;" />
        ${intro}
      </td></tr>
      <tr><td style="padding:0 32px 32px;" align="center">
        ${content}
      </td></tr>
      <tr><td style="padding:24px 32px;background:#faf8f5;border-top:1px solid #eae4d9;text-align:center;">
        <p style="margin:0;font-size:12px;color:#999;">© ${new Date().getFullYear()} Stodona AB</p>
        <p style="margin:4px 0 0;font-size:11px;color:#bbb;">Du får detta mail som kund hos Stodona.</p>
      </td></tr>
    </table>
  </td></tr>
</table>
<img src="${trackingPixelUrl}" width="1" height="1" alt="" style="display:none;" />
</body></html>`;
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { id } = req.query;
  const { newSubject } = req.body;

  if (typeof id !== 'string') {
    return res.status(400).json({ error: 'Missing ID' });
  }

  const original = await prisma.newsletter.findUnique({
    where: { id }
  });

  if (!original) {
    return res.status(404).json({ error: "Newsletter not found in database." });
  }

  const recipients = original.recipients as string[] || [];
  const openedBy = original.openedBy as string[] || [];
  
  const unopenedRecipients = recipients.filter(r => !openedBy.includes(r));
  
  if (unopenedRecipients.length === 0) {
    return res.status(400).json({ error: "Alla mottagare har redan öppnat nyhetsbrevet." });
  }

  const subject = newSubject || `Påminnelse: ${original.subject}`;
  const baseUrl = process.env.APP_URL || `https://${req.headers.host}`;
  const fromAddress = process.env.SMTP_FROM || process.env.SMTP_USER || 'info@stodona.se';

  // Create new newsletter record for this resend
  const newNewsletter = await prisma.newsletter.create({
    data: {
      subject,
      category: original.category,
      introText: original.introText,
      imageData: original.imageData,
      embedUrl: original.embedUrl,
      htmlContent: original.htmlContent,
      recipients: unopenedRecipients,
      status: 'sending'
    }
  });

  let successCount = 0;
  const failedRecipients: string[] = [];

  for (const email of unopenedRecipients) {
    const b64 = Buffer.from(email).toString('base64');
    const trackingPixelUrl = `${baseUrl}/api/newsletter/track/${newNewsletter.id}/${b64}`;

    let html: string;
    if (original.htmlContent) {
      let processedContent = original.htmlContent;
      // Re-wrap links with the new ID
      processedContent = processedContent.replace(/<a([^>]+)href="([^"]+)"([^>]*)>/gi, (match: string, before: string, linkUrl: string, after: string) => {
        if (linkUrl.startsWith('mailto:') || linkUrl.startsWith('tel:')) return match;
        // The original HTML might already have tracking links. We should ideally extract the raw URL.
        // But for simplicity, we assume we either send raw or if it's already a tracking link, it might get double wrapped?
        // Wait, original.htmlContent is SAVED clean in send.ts! Yes! `send.ts` saves `req.body.htmlContent` cleanly before modification.
        const encodedLink = encodeURIComponent(linkUrl);
        const trackingClickUrl = `${baseUrl}/api/newsletter/click/${newNewsletter.id}/${b64}?url=${encodedLink}`;
        return `<a${before}href="${trackingClickUrl}"${after}>`;
      });

      html = `<!DOCTYPE html><html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width"/></head>
<body style="margin:0;padding:0;background:#f5f3ef;font-family:'Segoe UI',sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f3ef;padding:32px 0;">
  <tr><td align="center">
    <table width="600" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.06);">
      <tr><td style="padding:40px 32px 0;">
        <img src="${baseUrl}/logotyp1.png" alt="Stodona" style="height:45px;width:auto;margin-bottom:24px;display:block;" />
      </td></tr>
      <tr><td style="padding:0; padding-bottom:32px;">${processedContent}</td></tr>
      <tr><td style="padding:24px 32px;background:#faf8f5;border-top:1px solid #eae4d9;text-align:center;">
        <p style="margin:0;font-size:12px;color:#999;">© ${new Date().getFullYear()} Stodona AB</p>
        <p style="margin:4px 0 0;font-size:11px;color:#bbb;">Du får detta mail som kund hos Stodona.</p>
      </td></tr>
    </table>
  </td></tr>
</table>
<img src="${trackingPixelUrl}" width="1" height="1" alt="" style="display:none;" />
</body></html>`;
    } else {
      html = buildNewsletterHtml({ 
        introText: original.introText || '', 
        imageData: original.imageData, 
        embedUrl: original.embedUrl, 
        trackingPixelUrl,
        appUrl: baseUrl
      });
    }

    if (process.env.RESEND_API_KEY) {
      try {
        const response = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            from: `"Stodona" <${fromAddress}>`,
            to: email,
            subject: subject,
            html: html
          })
        });

        if (!response.ok) {
           const errData = await response.json().catch(()=>({}));
           throw new Error(errData.message || response.statusText);
        }

        successCount++;
      } catch (err: any) {
        failedRecipients.push(email);
      }
    } else {
      successCount++;
    }
  }

  const finalStatus = failedRecipients.length === 0 ? 'sent' : (successCount > 0 ? 'partial' : 'failed');

  await prisma.newsletter.update({
    where: { id: newNewsletter.id },
    data: {
      status: finalStatus,
      successCount,
      failedCount: failedRecipients.length
    }
  });

  res.json({ success: true, message: `Påminnelse skickad till ${successCount}/${unopenedRecipients.length} mottagare via databasen.` });
}
