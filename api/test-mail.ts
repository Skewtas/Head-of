/**
 * ENGÅNGS-DIAGNOSTIK (2026-09-01): testar Resend-mail-flödet direkt.
 * Öppna https://head-of.vercel.app/api/test-mail?to=mikaela.wigert@stodona.se
 * Returnerar detaljerat svar så vi ser om det gick eller varför inte.
 * Tas bort direkt efter felsökning.
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { deliverNewsletter } from './_lib/newsletterSender.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const to = String(req.query.to || '').trim();
  if (!to || !to.includes('@')) {
    return res.status(400).json({ error: 'Ange ?to=<email>' });
  }
  // Whitelist för säkerhet — bara Stodona-domänen
  if (!to.endsWith('@stodona.se') && !to.endsWith('@gmail.com')) {
    return res.status(400).json({ error: 'Endast @stodona.se eller @gmail.com tillåtet.' });
  }

  const hasKey = !!process.env.RESEND_API_KEY;
  const fromAddr = process.env.SMTP_FROM || process.env.SMTP_USER || 'info@stodona.se';
  const appUrl = process.env.APP_URL || `https://${req.headers.host}`;

  const html = `
    <div style="font-family:Inter,Arial,sans-serif;color:#1a1a2e;padding:24px;max-width:520px;">
      <h1 style="font-family:'Playfair Display',serif;font-size:22px;margin:0 0 12px;">Test-mail från HeadOf</h1>
      <p>Detta är ett testmail. Om du ser det fungerar Resend-integrationen.</p>
      <p style="color:#8b8578;font-size:12px;margin-top:24px;">
        Skickat ${new Date().toISOString()}<br/>
        Från: ${fromAddr}<br/>
        Till: ${to}
      </p>
    </div>
  `;

  try {
    const result = await deliverNewsletter({
      newsletterId: `test-${Date.now()}`,
      recipients: [to],
      subject: `HeadOf test — ${new Date().toLocaleTimeString('sv-SE')}`,
      htmlContent: html,
      appUrl,
    });
    res.json({
      ok: true,
      resendConfigured: hasKey,
      fromAddress: fromAddr,
      result,
      note: hasKey
        ? `Test skickat. Kolla ${to} inom några minuter (även spam).`
        : 'RESEND_API_KEY SAKNAS — inget mail skickas i verkligheten (dry-run).',
    });
  } catch (err: any) {
    res.status(500).json({
      ok: false,
      resendConfigured: hasKey,
      fromAddress: fromAddr,
      error: err?.message,
    });
  }
}
