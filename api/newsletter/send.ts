import { prisma } from '../_lib/prisma.js';
import type { VercelRequest, VercelResponse } from '@vercel/node';

const buildNewsletterHtml = (opts: {
  introText: string;
  imageData: string | null;
  embedUrl: string | null;
  trackingPixelUrl: string;
  b64Email: string;
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
        <p style="margin:16px 0 0;font-size:11px;"><a href="${appUrl}/api/newsletter/optout?id=${opts.b64Email}&type=EMAIL" style="color:#999;text-decoration:underline;">Klicka här för att avregistrera dig</a></p>
      </td></tr>
    </table>
  </td></tr>
</table>
<img src="${trackingPixelUrl}" width="1" height="1" alt="" style="display:none;" />
</body></html>`;
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).send('Method Not Allowed');
  const { subject, introText, imageData, embedUrl, htmlContent, recipients, category } = req.body;
  
  if (!subject || !recipients || recipients.length === 0) {
    return res.status(400).json({ error: "Subject and at least one recipient are required." });
  }
  if (!imageData && !embedUrl && !htmlContent) {
    return res.status(400).json({ error: "Nyhetsbrevet behöver innehåll." });
  }

  // Filter out opted-out emails
  const optOutDoc = await prisma.automatedTemplate.findUnique({ where: { id: 'system_optouts' } });
  let optOutData: { emails: string[], phones: string[] } = { emails: [], phones: [] };
  if (optOutDoc && optOutDoc.blocks && typeof optOutDoc.blocks === 'object') {
    optOutData = optOutDoc.blocks as any;
  }
  const optOutSet = new Set(optOutData.emails || []);
  const validRecipients = recipients.filter((email: string) => !optOutSet.has(email));

  if (validRecipients.length === 0) {
    return res.status(400).json({ error: "Alla valda mottagare har avregistrerat sig från e-post." });
  }

  // Create database record first
  const newsletter = await prisma.newsletter.create({
    data: {
      subject,
      category: category || 'Allmänt',
      introText: introText || '',
      imageData: imageData || null,
      embedUrl: embedUrl || null,
      htmlContent: htmlContent || null,
      recipients: validRecipients,
      status: 'sending'
    }
  });

  const baseUrl = process.env.APP_URL || `https://${req.headers.host}`;
  const fromAddress = process.env.SMTP_FROM || process.env.SMTP_USER || 'info@stodona.se';

  let successCount = 0;
  const failedRecipients: string[] = [];

  for (const email of recipients) {
    const b64 = Buffer.from(email).toString('base64');
    const trackingPixelUrl = `${baseUrl}/api/newsletter/track/${newsletter.id}/${b64}`;

    let html: string;
    if (htmlContent) {
      // Wrap generated blocks
      let processedContent = htmlContent;
      processedContent = processedContent.replace(/<a([^>]+)href="([^"]+)"([^>]*)>/gi, (match: string, before: string, linkUrl: string, after: string) => {
        if (linkUrl.startsWith('mailto:') || linkUrl.startsWith('tel:')) return match;
        const encodedLink = encodeURIComponent(linkUrl);
        const trackingClickUrl = `${baseUrl}/api/newsletter/click/${newsletter.id}/${b64}?url=${encodedLink}`;
        return `<a${before}href="${trackingClickUrl}"${after}>`;
      });

      html = `<!DOCTYPE html><html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width"/>
<style>
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600&family=Outfit:wght@300;400;500;600&display=swap');
body, p, a, span, td { font-family: 'Inter', 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif !important; }
h1, h2, h3, h4, h5, h6 { font-family: 'Outfit', 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif !important; }
</style></head>
<body style="margin:0;padding:0;background:#f5f3ef;font-family:'Inter', 'Segoe UI', sans-serif;">
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
        <p style="margin:16px 0 0;font-size:11px;"><a href="${baseUrl}/api/newsletter/optout?id=${b64}&type=EMAIL" style="color:#999;text-decoration:underline;">Klicka här för att avregistrera dig</a></p>
      </td></tr>
    </table>
  </td></tr>
</table>
<img src="${trackingPixelUrl}" width="1" height="1" alt="" style="display:none;" />
</body></html>`;
    } else {
      html = buildNewsletterHtml({ introText: introText || '', imageData, embedUrl, trackingPixelUrl, b64Email: b64, appUrl: baseUrl });
    }

    let imageIndex = 0;
    const finalHtml = html.replace(/src="(data:image\/[^;]+;base64,[^"]+)"/g, () => {
      const url = `${baseUrl}/api/newsletter/image/${newsletter.id}/${imageIndex++}`;
      return `src="${url}"`;
    });

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
            html: finalHtml
          })
        });

        if (!response.ok) {
           const errData = await response.json().catch(()=>({}));
           throw new Error(errData.message || response.statusText);
        }

        successCount++;
        console.log(`  ✓ Sent to ${email}`);
      } catch (err: any) {
        console.error(`  ✗ Failed for ${email}:`, err.message);
        failedRecipients.push(email);
      }
    } else {
      // Dry-run mode
      successCount++;
    }
  }

  const finalStatus = failedRecipients.length === 0 ? 'sent' : (successCount > 0 ? 'partial' : 'failed');

  // Update DB with results
  await prisma.newsletter.update({
    where: { id: newsletter.id },
    data: {
      status: finalStatus,
      successCount,
      failedCount: failedRecipients.length
    }
  });

  const msg = process.env.RESEND_API_KEY
    ? `Skickat till ${successCount}/${recipients.length} mottagare${failedRecipients.length > 0 ? ` (${failedRecipients.length} misslyckades)` : ''}.`
    : `Nyhetsbrev sparat i databas (Resend ej konfigurerat — inga mail skickades). Ange RESEND_API_KEY under .env om test.`;

  res.json({ success: true, message: msg, sent: successCount, failed: failedRecipients.length });
}
