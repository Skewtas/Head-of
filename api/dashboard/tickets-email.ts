/**
 * Dagligt mail till Ella + Mikaela med obesvarade kundserviceärenden.
 *
 * Cron: 0 7 * * * (varje morgon 07:00)
 * Använder Microsoft Graph via lagrat refresh_token (graphTokenStore).
 * Mailas via Resend. Om inkorgen är tom skickas inget mail — tyst är bra.
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getStoredGraphAccessToken } from '../_lib/graphTokenStore.js';

export const config = { maxDuration: 60 };

const LOOKBACK_DAYS = 14;
const INTERNAL_DOMAIN = '@stodona.se';
const RECIPIENTS = ['info@stodona.se', 'mikaela.wigert@stodona.se'];

type Category = 'Bokningsförfrågan' | 'Klagomål' | 'Faktura' | 'Avbokning' | 'Feedback' | 'Allmän fråga';

const CATEGORY_RULES: { cat: Category; sla_hours: number; keywords: RegExp; suggest: string }[] = [
  { cat: 'Avbokning',        sla_hours: 4,  keywords: /\b(avbok|avboka|avbokn|ombok|omboka|flytta bokning|cancel)/i,           suggest: 'Bekräfta avbokning, kolla eventuell avgift enligt policy.' },
  { cat: 'Klagomål',         sla_hours: 8,  keywords: /\b(missn(ö|o)jd|klagom|reklam|dåligt utf|inte nöjd|fel utf|complaint|besvikn)/i, suggest: 'Ring kunden inom dagen. Erbjud omstädning eller prisjustering.' },
  { cat: 'Bokningsförfrågan', sla_hours: 24, keywords: /\b(offert|boka|bokning|st(ä|a)da|st(ä|a)dning|prisf(ö|o)rslag|f(ö|o)rfr(å|a)gan|inquiry|quote)/i, suggest: 'Svara med offert eller boka första besök inom 24h.' },
  { cat: 'Faktura',          sla_hours: 48, keywords: /\b(faktura|betaln|kvitto|swish|kreditera|invoice|payment|påminnelse)/i, suggest: 'Hänvisa till info@stodona.se + ta upp med ekonomi.' },
  { cat: 'Feedback',         sla_hours: 72, keywords: /\b(tack|nöjd|toppen|underbart|fantastisk|thank|thanks|great)/i,          suggest: 'Kort tacksvar. Fråga om vi får använda som recension.' },
];

const IGNORE_SENDER_PATTERNS = [
  /noreply@/i, /no-reply@/i, /mailer-daemon/i, /postmaster@/i,
  /notifications?@/i, /notification-noreply@/i, /support@microsoft/i,
  /@bokadirekt/i, /@resend/i, /@vercel/i, /@github/i, /@linkedin/i,
];

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).send('Method Not Allowed');
  if (process.env.CRON_SECRET) {
    const auth = req.headers.authorization || '';
    if (auth !== `Bearer ${process.env.CRON_SECRET}` && req.query.secret !== process.env.CRON_SECRET) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
  }

  const dryRun = req.query.dryRun === '1' || !process.env.RESEND_API_KEY;
  const fromAddress = process.env.SMTP_FROM || 'info@stodona.se';

  try {
    const accessToken = await getStoredGraphAccessToken();
    const since = new Date(Date.now() - LOOKBACK_DAYS * 86400_000).toISOString();
    const headers = { Authorization: `Bearer ${accessToken}` };

    const inboxUrl = `https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages?$top=200&$filter=receivedDateTime ge ${since}&$select=id,subject,bodyPreview,sender,receivedDateTime,conversationId&$orderby=receivedDateTime DESC`;
    const inboxResp = await fetch(inboxUrl, { headers });
    if (!inboxResp.ok) throw new Error(`Graph inbox ${inboxResp.status}: ${await inboxResp.text()}`);
    const inbox: any[] = (await inboxResp.json()).value || [];

    const sentUrl = `https://graph.microsoft.com/v1.0/me/mailFolders/sentitems/messages?$top=200&$filter=sentDateTime ge ${since}&$select=id,conversationId,sentDateTime`;
    const sentResp = await fetch(sentUrl, { headers });
    const sent: any[] = (await sentResp.json()).value || [];

    const lastSentByConv = new Map<string, string>();
    for (const s of sent) {
      const prev = lastSentByConv.get(s.conversationId);
      if (!prev || s.sentDateTime > prev) lastSentByConv.set(s.conversationId, s.sentDateTime);
    }

    const latestByConv = new Map<string, any>();
    for (const m of inbox) {
      const prev = latestByConv.get(m.conversationId);
      if (!prev || m.receivedDateTime > prev.receivedDateTime) latestByConv.set(m.conversationId, m);
    }

    const now = Date.now();
    const unanswered: any[] = [];
    for (const m of latestByConv.values()) {
      const senderEmail: string = (m.sender?.emailAddress?.address || '').toLowerCase();
      const senderName: string = m.sender?.emailAddress?.name || senderEmail || 'Okänd avsändare';
      if (senderEmail.endsWith(INTERNAL_DOMAIN)) continue;
      if (IGNORE_SENDER_PATTERNS.some((r) => r.test(senderEmail))) continue;
      const lastSent = lastSentByConv.get(m.conversationId);
      if (lastSent && lastSent >= m.receivedDateTime) continue;

      const subject: string = m.subject || '(inget ämne)';
      const preview: string = (m.bodyPreview || '').slice(0, 400);
      const rule = CATEGORY_RULES.find((r) => r.keywords.test(`${subject}\n${preview}`));
      const category: Category = rule?.cat || 'Allmän fråga';
      const suggest = rule?.suggest || 'Läs igenom och svara inom 48h — ev. hänvisa till rätt avdelning.';
      const sla_hours = rule?.sla_hours ?? 48;
      const waitingHours = Math.max(0, Math.round((now - new Date(m.receivedDateTime).getTime()) / 3600_000));
      const overdue = waitingHours > sla_hours;
      unanswered.push({ subject, preview: preview.slice(0, 200), senderName, senderEmail, receivedAt: m.receivedDateTime, waitingHours, category, sla_hours, overdue, suggest });
    }

    unanswered.sort((a, b) => {
      if (a.overdue !== b.overdue) return a.overdue ? -1 : 1;
      return b.waitingHours - a.waitingHours;
    });

    // Tyst dagar när inkorgen är i mål
    if (unanswered.length === 0) {
      return res.json({ ok: true, silent: true, reason: 'Inga obesvarade ärenden — inget mail skickat.' });
    }

    const html = buildHtml(unanswered);
    const overdueCount = unanswered.filter((t) => t.overdue).length;
    const subject = overdueCount > 0
      ? `Kundservice — ${overdueCount} över SLA, ${unanswered.length} obesvarade totalt`
      : `Kundservice — ${unanswered.length} obesvarade ärenden`;

    if (dryRun) {
      return res.json({ ok: true, dryRun: true, subject, recipients: RECIPIENTS, count: unanswered.length, overdueCount, htmlLength: html.length });
    }

    const sent2: string[] = [];
    const failed: { email: string; error: string }[] = [];
    for (const to of RECIPIENTS) {
      try {
        const r = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ from: `"Stodona HeadOf" <${fromAddress}>`, to, subject, html }),
        });
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).message || r.statusText);
        sent2.push(to);
      } catch (e: any) {
        failed.push({ email: to, error: e?.message ?? String(e) });
      }
    }
    res.json({ ok: failed.length === 0, subject, sent: sent2, failed, count: unanswered.length, overdueCount });
  } catch (err: any) {
    console.error('[tickets-email] failed:', err.message);
    res.status(500).json({ error: err.message });
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

function buildHtml(tickets: any[]): string {
  const overdue = tickets.filter((t) => t.overdue).length;
  const dateLabel = new Date().toLocaleDateString('sv-SE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

  const rows = tickets.map((t) => {
    const days = Math.floor(t.waitingHours / 24);
    const waitLabel = days > 0 ? `${days}d ${t.waitingHours % 24}h` : `${t.waitingHours}h`;
    const rail = t.overdue ? '#a8321d' : '#c98a6f';
    const bg = t.overdue ? '#fdf5f2' : '#fff';
    return `
    <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #eae4d9;border-left:4px solid ${rail};border-radius:10px;margin-bottom:12px;background:${bg};">
      <tr><td style="padding:14px 16px;">
        <table width="100%" cellpadding="0" cellspacing="0"><tr>
          <td>
            <span style="display:inline-block;padding:2px 8px;border-radius:999px;font-size:10px;font-weight:700;background:${t.overdue ? '#f6ebe6' : '#f0ebe0'};color:${t.overdue ? '#a8321d' : '#4b4a55'};text-transform:uppercase;letter-spacing:0.06em;">${escapeHtml(t.category)}</span>
            <span style="font-size:11px;color:${t.overdue ? '#a8321d' : '#8b8578'};font-weight:${t.overdue ? '600' : '400'};margin-left:8px;">väntar ${waitLabel}</span>
            ${t.overdue ? `<span style="font-size:10px;font-weight:700;color:#a8321d;margin-left:8px;">ÖVER SLA (${t.sla_hours}h)</span>` : ''}
          </td>
        </tr></table>
        <div style="font-size:15px;font-weight:600;color:#1a1a2e;margin-top:8px;">${escapeHtml(t.subject)}</div>
        <div style="font-size:12px;color:#8b8578;margin-top:2px;">Från: ${escapeHtml(t.senderName)} &lt;${escapeHtml(t.senderEmail)}&gt;</div>
        <div style="font-size:13px;color:#4b4a55;margin-top:8px;line-height:1.4;">${escapeHtml(t.preview)}</div>
        <div style="margin-top:10px;padding-top:10px;border-top:1px dashed #eae4d9;font-size:13px;color:#4b4a55;">
          <span style="font-size:10px;text-transform:uppercase;letter-spacing:0.1em;color:#a8321d;font-weight:700;margin-right:8px;">gör</span>
          ${escapeHtml(t.suggest)}
        </div>
      </td></tr>
    </table>`;
  }).join('');

  return `<!DOCTYPE html><html><head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#ebe6dc;font-family:'Inter',-apple-system,'Helvetica Neue',Arial,sans-serif;color:#1a1a2e;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#ebe6dc;padding:40px 20px 60px;">
<tr><td align="center">
<table width="640" cellpadding="0" cellspacing="0" style="background:#fff;border:1px solid #eae4d9;border-radius:18px;overflow:hidden;">
  <tr><td style="padding:30px 36px 22px;background:linear-gradient(180deg,#fbf9f4 0%,#fff 100%);border-bottom:1px solid #eae4d9;">
    <div style="font-size:11px;letter-spacing:0.14em;text-transform:uppercase;color:#8b8578;font-weight:600;">Kundservice · dagens obesvarade</div>
    <h1 style="margin:10px 0 10px;font-size:26px;font-weight:500;letter-spacing:-0.015em;line-height:1.15;">
      ${tickets.length} obesvarade · <span style="color:#a8321d;font-weight:600;">${overdue} över SLA</span>
    </h1>
    <p style="margin:0;color:#4b4a55;font-size:14px;line-height:1.5;">
      ${escapeHtml(dateLabel)}. Ärenden i info-inkorgen från de senaste 14 dagarna som inte fått något svar från oss ännu. Sorterade med SLA-överskridande överst.
    </p>
  </td></tr>
  <tr><td style="padding:22px 24px 8px;">${rows}</td></tr>
  <tr><td style="padding:20px 36px 26px;background:#faf8f3;border-top:1px solid #eae4d9;">
    <a href="https://head-of.vercel.app/#mail" style="display:inline-block;padding:11px 18px;background:#1a1a2e;color:#f5f3ef;text-decoration:none;border-radius:10px;font-size:13px;font-weight:600;">Öppna Mail i Head-of</a>
    <p style="color:#8b8578;font-size:11.5px;margin:12px 0 0;line-height:1.5;">
      Skickas varje morgon 07:00 när det finns obesvarade kundmail. Tyst när inkorgen är i mål. Kategorisering är regelbaserad — svar behöver alltid granskas manuellt.
    </p>
  </td></tr>
</table></td></tr></table></body></html>`;
}
