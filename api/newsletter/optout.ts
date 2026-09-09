/**
 * Avregistrering från nyhetsbrev / marknads-SMS.
 *
 *   GET  /api/newsletter/optout?id=<b64>&type=EMAIL|SMS
 *        → visar bekräftelsesida (ett steg innan avanmälan sker)
 *
 *   POST /api/newsletter/optout   { id, type, reason? }
 *        → utför avanmälan skarpt (formulär postar hit)
 *
 *   POST /api/newsletter/optout  med header List-Unsubscribe-Post:
 *        List-Unsubscribe=One-Click
 *        → avanmäl direkt utan bekräftelse (RFC 8058, kräver av Gmail m.fl.)
 *
 * Regel: EU-lag kräver 'enkel' avanmälan. Bekräftelsesteget är ok, men
 *        RFC 8058-headern MÅSTE gå igenom direkt utan friktion — annars
 *        klassar Gmail/Outlook det som spam.
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { prisma } from '../_lib/prisma.js';

export const config = { maxDuration: 15 };

function esc(s: string): string {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

async function performOptOut(identifier: string, isSms: boolean, reason?: string) {
  const doc = await prisma.automatedTemplate.findUnique({ where: { id: 'system_optouts' } });
  const data: any = (doc?.blocks as any) ?? {};
  if (!Array.isArray(data.emails)) data.emails = [];
  if (!Array.isArray(data.phones)) data.phones = [];
  if (!Array.isArray(data.reasons)) data.reasons = [];

  const idLower = identifier.toLowerCase().trim();
  if (isSms) {
    if (!data.phones.includes(identifier)) data.phones.push(identifier);
  } else {
    if (!data.emails.includes(idLower)) data.emails.push(idLower);
  }
  data.reasons.push({
    id: idLower,
    type: isSms ? 'SMS' : 'EMAIL',
    reason: reason || null,
    at: new Date().toISOString(),
  });

  await prisma.automatedTemplate.upsert({
    where: { id: 'system_optouts' },
    update: { blocks: data as any },
    create: { id: 'system_optouts', subject: 'SYSTEM_OPTOUTS', blocks: data as any },
  });
}

function renderPage(opts: { title: string; body: string; ok?: boolean }) {
  const { title, body, ok } = opts;
  return `<!DOCTYPE html>
<html lang="sv">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(title)}</title>
  <link href="https://fonts.googleapis.com/css2?family=Fraunces:wght@400;500&family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg: #f5f1ea;
      --surface: #ffffff;
      --ink: #1a1a2e;
      --muted: #6b6b7c;
      --line: #eae4d9;
      --accent: #c9a96e;
      --danger: #b91c1c;
      --danger-bg: #fef2f2;
      --danger-line: #fecaca;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0; min-height: 100vh; background: var(--bg); color: var(--ink);
      font-family: 'Inter', -apple-system, sans-serif; line-height: 1.55;
      display: flex; align-items: center; justify-content: center; padding: 24px;
    }
    .card {
      background: var(--surface); border-radius: 16px; padding: 36px 34px;
      max-width: 460px; width: 100%; box-shadow: 0 6px 30px rgba(0,0,0,0.05);
    }
    h1 {
      font-family: 'Fraunces', Georgia, serif; font-weight: 500; font-size: 26px;
      margin: 0 0 8px; text-wrap: balance; letter-spacing: -0.01em;
    }
    p { color: var(--muted); font-size: 14.5px; margin: 0 0 16px; }
    .highlight { background: #faf8f5; padding: 12px 14px; border-radius: 8px; font-size: 13px; font-family: 'JetBrains Mono', ui-monospace, monospace; color: var(--ink); border: 1px solid var(--line); margin-bottom: 20px; word-break: break-all; }
    label { display: block; font-size: 12px; text-transform: uppercase; letter-spacing: 0.1em; color: var(--muted); margin-bottom: 6px; font-weight: 600; }
    select, textarea {
      width: 100%; padding: 10px 12px; font-family: inherit; font-size: 14px;
      border: 1px solid var(--line); border-radius: 8px; background: white;
      color: var(--ink); margin-bottom: 18px;
    }
    textarea { resize: vertical; min-height: 60px; }
    .actions { display: flex; gap: 10px; margin-top: 8px; flex-wrap: wrap; }
    button, .btn {
      flex: 1; min-width: 140px; padding: 12px 18px; border: none; border-radius: 10px;
      font-family: inherit; font-size: 14px; font-weight: 600; cursor: pointer;
      text-align: center; text-decoration: none; display: inline-flex;
      align-items: center; justify-content: center;
    }
    .btn-primary { background: var(--ink); color: white; }
    .btn-primary:hover { background: #333349; }
    .btn-secondary { background: white; color: var(--ink); border: 1px solid var(--line); }
    .btn-secondary:hover { background: #faf8f5; }
    .btn-danger { background: var(--danger-bg); color: var(--danger); border: 1px solid var(--danger-line); }
    .btn-danger:hover { background: #fee2e2; }
    .icon-wrap {
      width: 56px; height: 56px; border-radius: 50%; background: #faf3e3;
      color: var(--accent); display: flex; align-items: center; justify-content: center;
      margin-bottom: 20px; font-size: 24px;
    }
    ${ok ? '.icon-wrap { background: #ecfdf5; color: #059669; }' : ''}
    .footer { margin-top: 28px; padding-top: 18px; border-top: 1px solid var(--line); font-size: 12px; color: var(--muted); text-align: center; }
    .footer a { color: var(--accent); text-decoration: none; }
    .hint { font-size: 12px; color: var(--muted); margin: -10px 0 18px; }
  </style>
</head>
<body>
  <div class="card">
    ${body}
    <div class="footer">
      Stodona AB · Vill du kontakta oss? <a href="mailto:info@stodona.se">info@stodona.se</a>
    </div>
  </div>
</body>
</html>`;
}

function showConfirmationForm(identifier: string, type: 'EMAIL' | 'SMS') {
  const label = type === 'SMS' ? 'SMS-utskick' : 'nyhetsbrev';
  return renderPage({
    title: 'Bekräfta avanmälan',
    body: `
      <div class="icon-wrap">?</div>
      <h1>Är du säker på att du vill avanmäla dig?</h1>
      <p>Vi är ledsna att se dig gå. Nedanstående kommer att sluta ta emot ${esc(label)} från Stodona:</p>
      <div class="highlight">${esc(identifier)}</div>
      <p style="margin-top:-8px;">Om du bara vill pausa: hör av dig till oss så löser vi det istället.</p>

      <form method="POST" action="/api/newsletter/optout">
        <input type="hidden" name="id" value="${esc(identifier)}">
        <input type="hidden" name="type" value="${type}">

        <label for="reason">Varför avanmäler du dig? (frivilligt)</label>
        <select name="reason" id="reason">
          <option value="">— Välj ett alternativ (valfritt) —</option>
          <option value="too_frequent">Får för många utskick</option>
          <option value="not_relevant">Innehållet är inte relevant för mig</option>
          <option value="never_signed_up">Jag har aldrig anmält mig</option>
          <option value="no_longer_customer">Är inte längre kund</option>
          <option value="privacy">Vill inte att ni har mina uppgifter</option>
          <option value="other">Annat</option>
        </select>
        <p class="hint">Din anledning hjälper oss förbättra våra utskick. Vi läser varje svar.</p>

        <div class="actions">
          <button type="submit" class="btn btn-danger">Ja, avanmäl mig</button>
          <a href="https://stodona.se" class="btn btn-secondary">Nej, behåll prenumerationen</a>
        </div>
      </form>
    `,
  });
}

function showSuccessPage(identifier: string, type: 'EMAIL' | 'SMS') {
  const label = type === 'SMS' ? 'SMS-utskick' : 'nyhetsbrev';
  return renderPage({
    ok: true,
    title: 'Avanmälan bekräftad',
    body: `
      <div class="icon-wrap">✓</div>
      <h1>Avanmälan klar</h1>
      <p><strong>${esc(identifier)}</strong> kommer inte längre att ta emot ${esc(label)} från Stodona.</p>
      <p>Om du ändrar dig, hör av dig till oss på <a href="mailto:info@stodona.se">info@stodona.se</a> så registrerar vi dig igen.</p>
      <div class="actions">
        <a href="https://stodona.se" class="btn btn-primary">Till stodona.se</a>
      </div>
    `,
  });
}

function showError(msg: string) {
  return renderPage({
    title: 'Ogiltig länk',
    body: `
      <div class="icon-wrap" style="background:#fee2e2;color:#b91c1c;">!</div>
      <h1>Länken fungerar inte</h1>
      <p>${esc(msg)}</p>
      <p>Kontakta <a href="mailto:info@stodona.se">info@stodona.se</a> så hjälper vi dig manuellt.</p>
    `,
  });
}

async function parseBody(req: VercelRequest): Promise<Record<string, string>> {
  if (req.body && typeof req.body === 'object' && !(req.body instanceof Buffer)) {
    return req.body as Record<string, string>;
  }
  const raw: Buffer =
    Buffer.isBuffer(req.body) ? req.body :
    typeof req.body === 'string' ? Buffer.from(req.body) :
    await new Promise((resolve) => {
      const chunks: Buffer[] = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => resolve(Buffer.concat(chunks)));
    });
  const ct = String(req.headers['content-type'] || '');
  if (ct.includes('application/json')) {
    try { return JSON.parse(raw.toString('utf-8')); } catch { return {}; }
  }
  // application/x-www-form-urlencoded
  const out: Record<string, string> = {};
  const s = raw.toString('utf-8');
  for (const pair of s.split('&')) {
    if (!pair) continue;
    const [k, v] = pair.split('=');
    out[decodeURIComponent(k)] = decodeURIComponent((v || '').replace(/\+/g, ' '));
  }
  return out;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    // ───────────── GET: visa bekräftelseformulär ─────────────
    if (req.method === 'GET') {
      const { id, type } = req.query;
      if (!id || typeof id !== 'string' || !type || typeof type !== 'string') {
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        return res.status(400).send(showError('Länken saknar nödvändig information.'));
      }
      let identifier = '';
      try { identifier = Buffer.from(id, 'base64').toString('utf-8'); }
      catch { }
      if (!identifier) {
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        return res.status(400).send(showError('Länken är skadad. Prova att öppna den från mailet igen.'));
      }
      const t = (type as string).toUpperCase() === 'SMS' ? 'SMS' : 'EMAIL';
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store');
      return res.status(200).send(showConfirmationForm(identifier, t as 'EMAIL' | 'SMS'));
    }

    // ───────────── POST: utför opt-out ─────────────
    if (req.method === 'POST') {
      const body = await parseBody(req);
      const idRaw = body.id;
      const type = String(body.type || 'EMAIL').toUpperCase();
      const reason = body.reason || null;

      // Stöd både b64-inkodad id (via länken) och plain (om formuläret postar plain)
      let identifier = idRaw;
      if (idRaw && !idRaw.includes('@') && !idRaw.startsWith('+') && !/^0\d{8,}$/.test(idRaw)) {
        try {
          const dec = Buffer.from(idRaw, 'base64').toString('utf-8');
          if (dec) identifier = dec;
        } catch { /* keep raw */ }
      }
      if (!identifier) {
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        return res.status(400).send(showError('Kunde inte identifiera vilken adress som ska avanmälas.'));
      }
      const isSms = type === 'SMS';

      await performOptOut(identifier, isSms, reason ? String(reason) : undefined);

      // RFC 8058 one-click: när Gmail postar hit ska vi returnera 200 utan HTML
      const oneClickHeader = String(req.headers['list-unsubscribe-post'] || '').toLowerCase();
      if (oneClickHeader.includes('one-click')) {
        return res.status(200).json({ ok: true });
      }

      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store');
      return res.status(200).send(showSuccessPage(identifier, isSms ? 'SMS' : 'EMAIL'));
    }

    return res.status(405).send('Method not allowed');
  } catch (err: any) {
    console.error('[optout]', err?.message);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(500).send(showError('Ett tekniskt fel uppstod. Vi tar hand om det manuellt om du hör av dig.'));
  }
}
