/**
 * Daily dashboard summary email.
 *
 * Invoked by Vercel Cron (vercel.json) every morning. Fetches the same data the
 * ÖVERSIKT page renders and sends a tidy HTML summary to the operations team.
 *
 * Recipients: configurable via DASHBOARD_DAILY_EMAILS env (comma-separated),
 * falls back to the three core stakeholders below.
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';

const DEFAULT_RECIPIENTS = [
  'mikaela.wigert@stodona.se',
  'info@stodona.se',
  'elvedina@stodona.se',
];

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).send('Method Not Allowed');
  }

  // Cron secret protection (Vercel cron sets Authorization: Bearer <secret>)
  if (process.env.CRON_SECRET) {
    const auth = req.headers.authorization || '';
    if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
  }

  const baseUrl = process.env.APP_URL || `https://${req.headers.host}`;
  const fromAddress = process.env.SMTP_FROM || process.env.SMTP_USER || 'info@stodona.se';
  const recipients = (process.env.DASHBOARD_DAILY_EMAILS || DEFAULT_RECIPIENTS.join(','))
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  // Date range: full current month so the email mirrors what people see when
  // they open ÖVERSIKT in the browser.
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const monthStart = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-01`;
  const monthEnd = (() => {
    const d = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  })();

  let summary: any = null;
  try {
    const r = await fetch(
      `${baseUrl}/api/timewave-summary/missions?startDate=${monthStart}&endDate=${monthEnd}`
    );
    if (r.ok) summary = await r.json();
  } catch (e: any) {
    console.error('[email-summary] fetch failed:', e?.message);
  }

  if (!summary) {
    return res.status(502).json({ error: 'Kunde inte hämta översikten från Timewave-proxy' });
  }

  const html = buildSummaryHtml(summary, { monthStart, monthEnd, appUrl: baseUrl });
  const subject = `HeadOf — Översikt ${now.toLocaleDateString('sv-SE', {
    weekday: 'short',
    day: 'numeric',
    month: 'long',
  })}`;

  if (!process.env.RESEND_API_KEY) {
    return res.json({
      ok: true,
      dryRun: true,
      message: 'RESEND_API_KEY saknas — inga mail skickades.',
      recipients,
      subject,
    });
  }

  const sent: string[] = [];
  const failed: { email: string; error: string }[] = [];

  for (const to of recipients) {
    try {
      const r = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: `"Stodona HeadOf" <${fromAddress}>`,
          to,
          subject,
          html,
        }),
      });
      if (!r.ok) {
        const errData = await r.json().catch(() => ({}));
        throw new Error((errData as any).message || r.statusText);
      }
      sent.push(to);
    } catch (e: any) {
      failed.push({ email: to, error: e?.message ?? String(e) });
    }
  }

  res.json({
    ok: failed.length === 0,
    subject,
    sent,
    failed,
    period: { monthStart, monthEnd },
  });
}

// ──────────────────────────────────────────────────────────────────────────────
// HTML builder
// ──────────────────────────────────────────────────────────────────────────────

function buildSummaryHtml(
  s: any,
  { monthStart, monthEnd, appUrl }: { monthStart: string; monthEnd: string; appUrl: string }
): string {
  const fmt = (n: number) => new Intl.NumberFormat('sv-SE').format(Math.round(n));
  const monthName = new Date(monthStart).toLocaleDateString('sv-SE', {
    month: 'long',
    year: 'numeric',
  });

  const sickList = (s.sickLeaveThisMonth || []) as { name: string; count: number }[];
  const sickList3m = (s.sickLeave3Months || []) as { name: string; count: number }[];
  const topClients = (s.topClients || []) as { name: string; revenue: number }[];
  const bottomClients = (s.bottomClients || []) as { name: string; revenue: number }[];
  const teamBreakdown = (s.teamBreakdown || []) as {
    name: string;
    hours: number;
    revenue: number;
  }[];

  const kpiCard = (label: string, value: string, accent = '#1a1a2e') => `
    <td valign="top" style="padding:12px;">
      <div style="background:#fff;border:1px solid #eae4d9;border-radius:12px;padding:16px;">
        <div style="font-size:11px;text-transform:uppercase;letter-spacing:0.5px;color:#999;font-family:'Inter','Helvetica Neue',Arial,sans-serif;">${label}</div>
        <div style="font-size:22px;font-weight:600;color:${accent};margin-top:6px;font-family:'Inter','Helvetica Neue',Arial,sans-serif;">${value}</div>
      </div>
    </td>`;

  const listRows = (
    rows: Array<{ name: string; count?: number; revenue?: number }>,
    rightSuffix = '',
    rightColor = '#1a1a2e'
  ): string =>
    rows.length === 0
      ? `<tr><td colspan="2" style="padding:8px 12px;color:#999;font-style:italic;">Inga rader.</td></tr>`
      : rows
          .map(
            (r) => `
              <tr>
                <td style="padding:8px 12px;border-top:1px solid #f0ebe0;color:#1a1a2e;">${escapeHtml(r.name)}</td>
                <td style="padding:8px 12px;border-top:1px solid #f0ebe0;color:${rightColor};text-align:right;font-weight:600;">${
                  r.revenue != null ? fmt(r.revenue) + ' kr' : (r.count ?? 0) + rightSuffix
                }</td>
              </tr>`
          )
          .join('');

  return `<!DOCTYPE html><html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width"/>
<link rel="preconnect" href="https://fonts.googleapis.com"/>
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin/>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=Playfair+Display:ital,wght@0,400..900;1,400..900&display=swap" rel="stylesheet"/>
<style>
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=Playfair+Display:ital,wght@0,400..900;1,400..900&display=swap');
body, p, a, span, td, li { font-family: 'Inter', 'Helvetica Neue', Arial, sans-serif !important; }
h1, h2, h3 { font-family: 'Playfair Display', Georgia, 'Times New Roman', serif !important; }
</style></head>
<body style="margin:0;padding:0;background:#f5f3ef;font-family:'Inter','Helvetica Neue',Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f3ef;padding:24px 0;">
  <tr><td align="center">
    <table width="640" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.06);">
      <tr><td style="padding:32px 32px 8px;">
        <h1 style="margin:0;font-size:26px;font-weight:400;color:#1a1a2e;">Översikt — ${escapeHtml(monthName)}</h1>
        <p style="margin:6px 0 0;color:#999;font-size:13px;">${monthStart} → ${monthEnd}</p>
      </td></tr>

      <tr><td style="padding:16px 20px 0;">
        <table width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:separate;">
          <tr>
            ${kpiCard('Uppdrag', fmt(s.totalJobs ?? 0))}
            ${kpiCard('Timmar utförda', fmt(s.totalHours ?? 0))}
            ${kpiCard('Snittpris/tim', fmt(s.avgPricePerHour ?? 0) + ' kr')}
          </tr>
          <tr>
            ${kpiCard('Intäkt ex. moms', fmt(s.totalRevenueExVat ?? 0) + ' kr', '#1a1a2e')}
            ${kpiCard('Fakturerat netto', fmt(s.totalInvoicedNet ?? 0) + ' kr', '#1a1a2e')}
            ${kpiCard('Nya arbetsorder', fmt(s.newWorkOrdersThisMonth ?? 0))}
          </tr>
          <tr>
            ${kpiCard('Återkommande privatkunder', fmt(s.recurringPrivateClients ?? 0))}
            ${kpiCard('Återkommande företagskunder', fmt(s.recurringCompanyClients ?? 0))}
            ${kpiCard('Onlinebokningar', fmt(s.onlineBookings ?? 0))}
          </tr>
        </table>
      </td></tr>

      <tr><td style="padding:20px 32px 0;">
        <h2 style="margin:0 0 12px;font-size:18px;color:#1a1a2e;">Sjukfrånvaro — denna månad</h2>
        <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #eae4d9;border-radius:10px;border-collapse:separate;overflow:hidden;">
          <tr style="background:#faf8f5;"><th style="text-align:left;padding:8px 12px;font-size:11px;text-transform:uppercase;color:#999;letter-spacing:0.5px;">Personal</th><th style="text-align:right;padding:8px 12px;font-size:11px;text-transform:uppercase;color:#999;letter-spacing:0.5px;">Tillfällen</th></tr>
          ${listRows(sickList, '', '#e63946')}
        </table>
      </td></tr>

      <tr><td style="padding:20px 32px 0;">
        <h2 style="margin:0 0 12px;font-size:18px;color:#1a1a2e;">Sjukfrånvaro — senaste 3 månaderna</h2>
        <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #eae4d9;border-radius:10px;border-collapse:separate;overflow:hidden;">
          <tr style="background:#faf8f5;"><th style="text-align:left;padding:8px 12px;font-size:11px;text-transform:uppercase;color:#999;letter-spacing:0.5px;">Personal</th><th style="text-align:right;padding:8px 12px;font-size:11px;text-transform:uppercase;color:#999;letter-spacing:0.5px;">Tillfällen</th></tr>
          ${listRows(sickList3m, '', '#d99837')}
        </table>
      </td></tr>

      <tr><td style="padding:20px 32px 0;">
        <h2 style="margin:0 0 12px;font-size:18px;color:#1a1a2e;">Topp 10 kunder (intäkt)</h2>
        <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #eae4d9;border-radius:10px;border-collapse:separate;overflow:hidden;">
          ${listRows(topClients)}
        </table>
      </td></tr>

      <tr><td style="padding:20px 32px 0;">
        <h2 style="margin:0 0 12px;font-size:18px;color:#1a1a2e;">Botten 10 kunder (intäkt)</h2>
        <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #eae4d9;border-radius:10px;border-collapse:separate;overflow:hidden;">
          ${listRows(bottomClients)}
        </table>
      </td></tr>

      <tr><td style="padding:20px 32px 0;">
        <h2 style="margin:0 0 12px;font-size:18px;color:#1a1a2e;">Team — timmar & intäkt</h2>
        <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #eae4d9;border-radius:10px;border-collapse:separate;overflow:hidden;">
          <tr style="background:#faf8f5;">
            <th style="text-align:left;padding:8px 12px;font-size:11px;text-transform:uppercase;color:#999;letter-spacing:0.5px;">Team</th>
            <th style="text-align:right;padding:8px 12px;font-size:11px;text-transform:uppercase;color:#999;letter-spacing:0.5px;">Timmar</th>
            <th style="text-align:right;padding:8px 12px;font-size:11px;text-transform:uppercase;color:#999;letter-spacing:0.5px;">Intäkt</th>
          </tr>
          ${
            teamBreakdown.length === 0
              ? `<tr><td colspan="3" style="padding:8px 12px;color:#999;font-style:italic;">Inga rader.</td></tr>`
              : teamBreakdown
                  .map(
                    (t) => `<tr>
                  <td style="padding:8px 12px;border-top:1px solid #f0ebe0;">${escapeHtml(t.name)}</td>
                  <td style="padding:8px 12px;border-top:1px solid #f0ebe0;text-align:right;">${fmt(t.hours)}</td>
                  <td style="padding:8px 12px;border-top:1px solid #f0ebe0;text-align:right;font-weight:600;">${fmt(t.revenue)} kr</td>
                </tr>`
                  )
                  .join('')
          }
        </table>
      </td></tr>

      <tr><td style="padding:24px 32px 32px;text-align:center;">
        <a href="${appUrl}" style="display:inline-block;padding:12px 28px;background:#1a1a2e;color:#fff;border-radius:10px;text-decoration:none;font-weight:600;font-size:13px;letter-spacing:0.5px;">Öppna HeadOf →</a>
      </td></tr>

      <tr><td style="padding:18px 32px;background:#faf8f5;border-top:1px solid #eae4d9;text-align:center;">
        <p style="margin:0;font-size:12px;color:#999;">Skickad automatiskt från HeadOf.</p>
        <p style="margin:4px 0 0;font-size:11px;color:#bbb;">© ${new Date().getFullYear()} Stodona AB</p>
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>`;
}

function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
