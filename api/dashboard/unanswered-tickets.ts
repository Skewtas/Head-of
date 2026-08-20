/**
 * Sammanställer obesvarade kundserviceärenden ur Outlook-inkorgen.
 *
 * Definition "obesvarat":
 *  - Meddelande i inbox från extern avsändare (inte @stodona.se)
 *  - Ingen efterföljande utgående mail i samma conversationId
 *  - Nyare än LOOKBACK_DAYS
 *  - Är inte auto-notifikation/bounce/newsletter
 *
 * Kategorisering är regelbaserad på nyckelord i ämne + första 400 tecken av
 * brödtext — snabb, gratis, transparent. Kategorierna avgör tempot i
 * åtgärdsförslaget (t.ex. bokningsförfrågan = svara idag).
 *
 * Auth: samma cookie-baserade Outlook OAuth som MailView (kräver att
 * användaren är inloggad). Kan inte köras av cron förrän vi persistat
 * OAuth-tokens till DB.
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { userTokens } from '../_lib/tokenStore.js';
import { parseCookies } from '../_lib/cookies.js';

export const config = { maxDuration: 30 };

const LOOKBACK_DAYS = 14;
const INTERNAL_DOMAIN = '@stodona.se';

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
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const cookies = parseCookies(req);
  const sessionId = cookies.session_id;
  const tokenData = sessionId ? userTokens[sessionId] : null;
  if (!tokenData) return res.status(401).json({ error: 'Not authenticated', notConnected: true });

  const since = new Date(Date.now() - LOOKBACK_DAYS * 86400_000).toISOString();
  const headers = { Authorization: `Bearer ${tokenData.accessToken}` };

  try {
    // Inbox — de vi kan svara på
    const inboxUrl = `https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages?$top=200&$filter=receivedDateTime ge ${since}&$select=id,subject,bodyPreview,sender,receivedDateTime,conversationId&$orderby=receivedDateTime DESC`;
    const inboxResp = await fetch(inboxUrl, { headers });
    if (inboxResp.status === 401) return res.status(401).json({ error: 'Token expired' });
    const inboxData = await inboxResp.json();
    const inbox: any[] = inboxData.value || [];

    // Sent — så vi kan detektera vilka conversationIds vi redan besvarat
    const sentUrl = `https://graph.microsoft.com/v1.0/me/mailFolders/sentitems/messages?$top=200&$filter=sentDateTime ge ${since}&$select=id,conversationId,sentDateTime`;
    const sentResp = await fetch(sentUrl, { headers });
    const sentData = await sentResp.json();
    const sent: any[] = sentData.value || [];

    // Bygg map: conversationId → senaste sent-datum
    const lastSentByConv = new Map<string, string>();
    for (const s of sent) {
      const prev = lastSentByConv.get(s.conversationId);
      if (!prev || s.sentDateTime > prev) lastSentByConv.set(s.conversationId, s.sentDateTime);
    }

    // Behåll bara SENASTE inkommande per conversationId
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

      // Skippa interna (våra egna mail)
      if (senderEmail.endsWith(INTERNAL_DOMAIN)) continue;
      // Skippa systemavsändare
      if (IGNORE_SENDER_PATTERNS.some((r) => r.test(senderEmail))) continue;
      // Skippa om vi redan svarat efter mottagandet
      const lastSent = lastSentByConv.get(m.conversationId);
      if (lastSent && lastSent >= m.receivedDateTime) continue;

      const subject: string = m.subject || '(inget ämne)';
      const preview: string = (m.bodyPreview || '').slice(0, 400);
      const scanText = `${subject}\n${preview}`;
      const rule = CATEGORY_RULES.find((r) => r.keywords.test(scanText));
      const category: Category = rule?.cat || 'Allmän fråga';
      const suggest = rule?.suggest || 'Läs igenom och svara inom 48h — ev. hänvisa till rätt avdelning.';
      const sla_hours = rule?.sla_hours ?? 48;

      const receivedAt = new Date(m.receivedDateTime).getTime();
      const waitingHours = Math.max(0, Math.round((now - receivedAt) / 3600_000));
      const overdue = waitingHours > sla_hours;

      unanswered.push({
        id: m.id,
        conversationId: m.conversationId,
        subject,
        preview: preview.slice(0, 180),
        senderName,
        senderEmail,
        receivedAt: m.receivedDateTime,
        waitingHours,
        category,
        sla_hours,
        overdue,
        suggest,
      });
    }

    unanswered.sort((a, b) => {
      // Överdue först (mest överdue överst), sedan äldst först
      if (a.overdue !== b.overdue) return a.overdue ? -1 : 1;
      return b.waitingHours - a.waitingHours;
    });

    // Kategori-räknare för dashboard-badge
    const countsByCategory: Record<string, number> = {};
    for (const t of unanswered) countsByCategory[t.category] = (countsByCategory[t.category] || 0) + 1;

    res.json({
      total: unanswered.length,
      overdueCount: unanswered.filter((t) => t.overdue).length,
      tickets: unanswered.slice(0, 30),
      countsByCategory,
      lookbackDays: LOOKBACK_DAYS,
      generatedAt: new Date().toISOString(),
    });
  } catch (err: any) {
    console.error('[unanswered-tickets]', err.message);
    res.status(500).json({ error: err.message });
  }
}
