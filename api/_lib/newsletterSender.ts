/**
 * Newsletter delivery — shared between immediate send (api/newsletter/send.ts)
 * and the scheduled cron processor (api/newsletter/process-scheduled.ts).
 */
import { prisma } from './prisma.js';

const SIMPLE_TEMPLATE_HEAD = `<link rel="preconnect" href="https://fonts.googleapis.com"/>
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin/>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=Playfair+Display:ital,wght@0,400..900;1,400..900&display=swap" rel="stylesheet"/>
<style>
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=Playfair+Display:ital,wght@0,400..900;1,400..900&display=swap');
body, p, a, span, td, li { font-family: 'Inter', 'Helvetica Neue', Arial, sans-serif !important; }
h1, h2, h3, h4, h5, h6 { font-family: 'Playfair Display', Georgia, 'Times New Roman', serif !important; }
</style>`;

function buildSimpleHtml(opts: {
  introText: string;
  imageData: string | null;
  embedUrl: string | null;
  trackingPixelUrl: string;
  b64Email: string;
  appUrl: string;
}) {
  const { introText, imageData, embedUrl, trackingPixelUrl, appUrl, b64Email } = opts;
  const intro = introText
    ? `<p style="font-size:16px;line-height:1.6;color:#333;margin:0 0 24px;">${introText.replace(/\n/g, '<br/>')}</p>`
    : '';
  let content = '';
  if (imageData) {
    content = `<img src="${imageData}" alt="Newsletter" style="width:100%;max-width:600px;height:auto;border-radius:12px;" />`;
  } else if (embedUrl) {
    content = `<a href="${embedUrl}" target="_blank" style="display:inline-block;padding:16px 32px;background:#1a1a2e;color:#fff;border-radius:10px;text-decoration:none;font-weight:bold;font-size:14px;">Visa nyhetsbrevet →</a>`;
  }
  return `<!DOCTYPE html><html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width"/>
${SIMPLE_TEMPLATE_HEAD}
</head>
<body style="margin:0;padding:0;background:#f5f3ef;font-family:'Inter','Helvetica Neue',Arial,sans-serif;">
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
        <p style="margin:0;font-size:13px;color:#666;"><a href="https://stodona.se" style="color:#c9a96e;text-decoration:none;font-weight:500;">stodona.se</a></p>
        <p style="margin:6px 0 0;font-size:12px;color:#999;">© ${new Date().getFullYear()} Stodona AB</p>
        <p style="margin:4px 0 0;font-size:11px;color:#bbb;">Du får detta mail som kund hos Stodona.</p>
        <p style="margin:16px 0 0;font-size:11px;"><a href="${appUrl}/api/newsletter/optout?id=${b64Email}&type=EMAIL" style="color:#999;text-decoration:underline;">Klicka här för att avregistrera dig</a></p>
      </td></tr>
    </table>
  </td></tr>
</table>
<img src="${trackingPixelUrl}" width="1" height="1" alt="" style="display:none;" />
</body></html>`;
}

function buildBlockHtml(opts: {
  htmlContent: string;
  trackingPixelUrl: string;
  b64Email: string;
  appUrl: string;
}) {
  const { htmlContent, trackingPixelUrl, appUrl, b64Email } = opts;
  return `<!DOCTYPE html><html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width"/>
${SIMPLE_TEMPLATE_HEAD}
</head>
<body style="margin:0;padding:0;background:#f5f3ef;font-family:'Inter','Helvetica Neue',Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f3ef;padding:32px 0;">
  <tr><td align="center">
    <table width="600" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.06);">
      <tr><td style="padding:40px 32px 0;">
        <img src="${appUrl}/logotyp1.png" alt="Stodona" style="height:45px;width:auto;margin-bottom:24px;display:block;" />
      </td></tr>
      <tr><td style="padding:0; padding-bottom:32px;">${htmlContent}</td></tr>
      <tr><td style="padding:24px 32px;background:#faf8f5;border-top:1px solid #eae4d9;text-align:center;">
        <p style="margin:0;font-size:13px;color:#666;"><a href="https://stodona.se" style="color:#c9a96e;text-decoration:none;font-weight:500;">stodona.se</a></p>
        <p style="margin:6px 0 0;font-size:12px;color:#999;">© ${new Date().getFullYear()} Stodona AB</p>
        <p style="margin:4px 0 0;font-size:11px;color:#bbb;">Du får detta mail som kund hos Stodona.</p>
        <p style="margin:16px 0 0;font-size:11px;"><a href="${appUrl}/api/newsletter/optout?id=${b64Email}&type=EMAIL" style="color:#999;text-decoration:underline;">Klicka här för att avregistrera dig</a></p>
      </td></tr>
    </table>
  </td></tr>
</table>
<img src="${trackingPixelUrl}" width="1" height="1" alt="" style="display:none;" />
</body></html>`;
}

export interface SendNewsletterOpts {
  newsletterId: string;            // row to deliver against (tracking pixels use this id)
  recipients: string[];            // list of emails to actually send to (already filtered)
  subject: string;
  introText?: string | null;
  imageData?: string | null;
  embedUrl?: string | null;
  htmlContent?: string | null;
  appUrl: string;
  /**
   * Avbryt när vi närmar oss budgeten (i ms) — det som finns kvar
   * returneras som `remainingRecipients` så att kallaren kan spara
   * tillbaka kön och fortsätta i nästa funktionsanrop.
   */
  budgetMs?: number;
}

export interface SendNewsletterResult {
  sent: number;
  failed: number;
  failedRecipients: string[];
  remainingRecipients: string[];
}

/**
 * Deliver the newsletter to a list of recipients via Resend.
 * Does NOT create or update any Newsletter row — caller is responsible.
 */
export async function deliverNewsletter(opts: SendNewsletterOpts): Promise<SendNewsletterResult> {
  const { newsletterId, recipients, subject, introText, imageData, embedUrl, htmlContent, appUrl } = opts;
  const fromAddress = process.env.SMTP_FROM || process.env.SMTP_USER || 'info@stodona.se';

  let sent = 0;
  const failedRecipients: string[] = [];

  const renderHtml = (b64: string): string => {
    const trackingPixelUrl = `${appUrl}/api/newsletter/track/${newsletterId}/${b64}`;
    let html: string;
    if (htmlContent) {
      const processed = htmlContent.replace(
        /<a([^>]+)href="([^"]+)"([^>]*)>/gi,
        (match: string, before: string, linkUrl: string, after: string) => {
          if (linkUrl.startsWith('mailto:') || linkUrl.startsWith('tel:')) return match;
          const encodedLink = encodeURIComponent(linkUrl);
          const trackingClickUrl = `${appUrl}/api/newsletter/click/${newsletterId}/${b64}?url=${encodedLink}`;
          return `<a${before}href="${trackingClickUrl}"${after}>`;
        }
      );
      html = buildBlockHtml({ htmlContent: processed, trackingPixelUrl, appUrl, b64Email: b64 });
    } else {
      html = buildSimpleHtml({
        introText: introText || '',
        imageData: imageData || null,
        embedUrl: embedUrl || null,
        trackingPixelUrl,
        b64Email: b64,
        appUrl,
      });
    }
    let imageIndex = 0;
    return html.replace(/src="(data:image\/[^;]+;base64,[^"]+)"/g, () => {
      const url = `${appUrl}/api/newsletter/image/${newsletterId}/${imageIndex++}`;
      return `src="${url}"`;
    });
  };

  if (!process.env.RESEND_API_KEY) {
    // Dry-run
    return { sent: recipients.length, failed: 0, failedRecipients: [], remainingRecipients: [] };
  }

  const startedAt = Date.now();
  const budget = opts.budgetMs ?? Number.POSITIVE_INFINITY;
  const pending = [...recipients];

  // Resends batch-endpoint (POST /emails/batch) tar upp till 100 mejl per
  // anrop. Det gör ett 2000-mottagar-utskick till ~20 HTTP-anrop istället
  // för 2000 — fits comfortably i Vercels 60 s-fönster.
  const CHUNK = 100;
  const PARALLEL = 4;

  const buildBatch = (slice: string[]) =>
    slice.map((email) => {
      const b64 = Buffer.from(email).toString('base64');
      return {
        from: `"Stodona" <${fromAddress}>`,
        to: email,
        subject,
        html: renderHtml(b64),
      };
    });

  const sendBatch = async (slice: string[]) => {
    const body = buildBatch(slice);
    try {
      const r = await fetch('https://api.resend.com/emails/batch', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });
      if (r.status === 429) {
        // Backoff och försök igen en gång
        await new Promise((res) => setTimeout(res, 1500));
        const retry = await fetch('https://api.resend.com/emails/batch', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(body),
        });
        if (!retry.ok) throw new Error(`429 + retry ${retry.status}`);
      } else if (!r.ok) {
        const errData = await r.json().catch(() => ({}));
        throw new Error((errData as any).message || `${r.status} ${r.statusText}`);
      }
      sent += slice.length;
    } catch (err: any) {
      console.error(
        `Newsletter ${newsletterId} batch failed (${slice.length} recipients):`,
        err.message
      );
      failedRecipients.push(...slice);
    }
  };

  // Bygg listor av 100-mottagar-chunks och kör 4 batchar samtidigt.
  // Avbryt så snart vi närmar oss budgeten — det som ligger kvar i `pending`
  // returneras så att kallaren kan spara det och fortsätta i nästa anrop.
  while (pending.length > 0) {
    if (Date.now() - startedAt > budget) break;
    const next: string[][] = [];
    for (let i = 0; i < PARALLEL && pending.length > 0; i++) {
      next.push(pending.splice(0, CHUNK));
    }
    await Promise.all(next.map(sendBatch));
  }

  return {
    sent,
    failed: failedRecipients.length,
    failedRecipients,
    remainingRecipients: pending,
  };
}

/**
 * Send a previously-saved scheduled Newsletter row. Updates the row's status
 * + counts based on result.
 */
export async function sendScheduledNewsletter(newsletterId: string, appUrl: string): Promise<SendNewsletterResult> {
  const newsletter = await prisma.newsletter.findUnique({ where: { id: newsletterId } });
  if (!newsletter) throw new Error(`Newsletter ${newsletterId} not found`);
  const recipients = (newsletter.recipients as string[] | undefined) ?? [];

  await prisma.newsletter.update({
    where: { id: newsletterId },
    data: { status: 'sending', sentAt: new Date() },
  });

  const result = await deliverNewsletter({
    newsletterId,
    recipients,
    subject: newsletter.subject,
    introText: newsletter.introText,
    imageData: newsletter.imageData,
    embedUrl: newsletter.embedUrl,
    htmlContent: newsletter.htmlContent,
    appUrl,
  });

  const finalStatus = result.failed === 0 ? 'sent' : result.sent > 0 ? 'partial' : 'failed';
  await prisma.newsletter.update({
    where: { id: newsletterId },
    data: {
      status: finalStatus,
      successCount: result.sent,
      failedCount: result.failed,
    },
  });
  return result;
}

/**
 * Send a reminder for a previously-sent newsletter to recipients who didn't open it.
 * Creates a CHILD Newsletter row, sends, and stamps the parent's reminderSentAt.
 */
export async function sendNewsletterReminder(parentId: string, appUrl: string): Promise<{ childId: string; result: SendNewsletterResult } | null> {
  const parent = await prisma.newsletter.findUnique({ where: { id: parentId } });
  if (!parent) throw new Error(`Parent newsletter ${parentId} not found`);

  const recipients = (parent.recipients as string[] | undefined) ?? [];
  const openedBy = (parent.openedBy as string[] | undefined) ?? [];
  const targets = recipients.filter((r) => !openedBy.includes(r));
  if (targets.length === 0) {
    await prisma.newsletter.update({
      where: { id: parentId },
      data: { reminderSentAt: new Date() },
    });
    return null;
  }

  const child = await prisma.newsletter.create({
    data: {
      subject: parent.reminderSubject || `Påminnelse: ${parent.subject}`,
      category: parent.category,
      introText: parent.introText,
      imageData: parent.imageData,
      embedUrl: parent.embedUrl,
      htmlContent: parent.htmlContent,
      recipients: targets,
      status: 'sending',
      parentNewsletterId: parentId,
    },
  });

  const result = await deliverNewsletter({
    newsletterId: child.id,
    recipients: targets,
    subject: child.subject,
    introText: parent.introText,
    imageData: parent.imageData,
    embedUrl: parent.embedUrl,
    htmlContent: parent.htmlContent,
    appUrl,
  });

  const finalStatus = result.failed === 0 ? 'sent' : result.sent > 0 ? 'partial' : 'failed';
  await prisma.newsletter.update({
    where: { id: child.id },
    data: { status: finalStatus, successCount: result.sent, failedCount: result.failed },
  });
  await prisma.newsletter.update({
    where: { id: parentId },
    data: { reminderSentAt: new Date() },
  });

  return { childId: child.id, result };
}
