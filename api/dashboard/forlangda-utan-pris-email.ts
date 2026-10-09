/**
 * Mailar jobb där passen har förlängts UTAN att priset justerats.
 *
 * Mikaela 2026-10-07: 'ge oss ett mail på jobb där vi förlängt passen utan
 * att göra något åt priset, alla förlängningar av pass måste godkännas av kunden'.
 *
 * GET /api/dashboard/forlangda-utan-pris-email?secret=<CRON_SECRET>
 *   &dry=1  → bygg HTML men skicka inte (visa i browser)
 *
 * Listar enskilda pass de senaste 30 dagarna som blev längre än jobbets vanliga
 * tid (se beraknaEnskildaForlangdaPass i forlangda-pass.ts) utan att priset ändrats.
 *
 * Jämförelsen "snitt senaste 30 dagar mot föregående 30" används INTE här: den
 * pekade ut jobb vars referensperiod råkat ha korta pass (falska träffar).
 *
 * Körs av Vercel Cron varje måndag (se vercel.json).
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getTimewaveToken } from '../_lib/timewaveAuth.js';
import { beraknaEnskildaForlangdaPass, hamta, type EnskiltForlangtPass } from './forlangda-pass.js';

export const config = { maxDuration: 60 };

const RECIPIENTS = (
  process.env.FORLANGDA_PASS_EMAIL_TO ||
  'info@stodona.se,mikaela.wigert@stodona.se'
).split(',').map((s) => s.trim()).filter(Boolean);

function escapeH(s: string): string { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function nf(n: number): string { return new Intl.NumberFormat('sv-SE').format(Math.round(n)); }
// En decimal med svenskt decimalkomma (timmar)
function tim(n: number): string { return (Math.round(n * 10) / 10).toLocaleString('sv-SE'); }

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const secret = process.env.CRON_SECRET;
  const authHdr = req.headers.authorization || '';
  const isCron = secret && authHdr === `Bearer ${secret}`;
  const isQuery = secret && req.query.secret === secret;
  if (!secret || (!isCron && !isQuery)) return res.status(401).json({ error: 'Unauthorized' });

  const dryRun = req.query.dry === '1';

  try {
    // Strikt hämtning: misslyckas en sida avbryts mejlet hellre än att skicka en ofullständig rapport.
    // Fyra 30-dagarsperioder bakåt: [0] = aktuell, [1..3] = baslinje för jobbets vanliga tid
    const token = await getTimewaveToken();
    const now = new Date();
    const ymd = (d: Date) => d.toISOString().slice(0, 10);
    const dag = (n: number) => ymd(new Date(now.getTime() - n * 24 * 3600 * 1000));
    const perioder = await Promise.all([0, 1, 2, 3].map((k) => hamta(dag((k + 1) * 30), dag(k * 30), token, true)));

    const enskilda = beraknaEnskildaForlangdaPass(perioder[0], [...perioder[1], ...perioder[2], ...perioder[3]], now);
    const html = buildHtml(enskilda, `${dag(30)} → ${dag(0)}`);
    const antalNya = enskilda.filter((p) => p.nytt).length;
    const subject = enskilda.length > 0
      ? `⚠️ ${enskilda.length} pass har förlängts utan prisjustering${antalNya > 0 ? ` (${antalNya} nya i veckan)` : ''}`
      : `✅ Inga pass har förlängts utan prisjustering`;

    if (dryRun) {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.send(html);
    }

    if (!process.env.RESEND_API_KEY) {
      return res.status(500).json({ error: 'RESEND_API_KEY saknas' });
    }

    const fromAddress = process.env.SMTP_FROM || 'info@stodona.se';
    const sent: string[] = [];
    const failed: any[] = [];
    for (const to of RECIPIENTS) {
      try {
        const resp = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ from: `"Stodona HeadOf" <${fromAddress}>`, to, subject, html }),
        });
        if (!resp.ok) throw new Error(`${resp.status}: ${(await resp.text()).substring(0, 200)}`);
        sent.push(to);
      } catch (e: any) {
        failed.push({ to, error: e?.message });
      }
    }

    res.json({ ok: failed.length === 0, subject, sent, failed, antalPass: enskilda.length });
  } catch (err: any) {
    console.error('[forlangda-utan-pris-email]', err?.message);
    res.status(500).json({ error: err?.message || 'failed' });
  }
}

function datumKort(ymdStr: string): string {
  return new Intl.DateTimeFormat('sv-SE', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${ymdStr}T12:00:00Z`));
}

function buildEnskilda(enskilda: EnskiltForlangtPass[]): string {
  const rader = enskilda.map((p) => `
    <tr style="${p.nytt ? 'background:#fff7ed' : ''}">
      <td style="padding:10px 12px;border-bottom:1px solid #eee;vertical-align:top;font-size:13px;white-space:nowrap">
        ${escapeH(datumKort(p.datum))}${p.nytt ? '<br><span style="font-size:10px;font-weight:700;color:#c2410c">NY</span>' : ''}
      </td>
      <td style="padding:10px 12px;border-bottom:1px solid #eee;vertical-align:top">
        <strong>${escapeH(p.klientNamn)}</strong><br>
        <span style="font-size:11px;color:#666">AO#${p.arbetsorder} · ${escapeH(p.tjanst)}</span>
        ${p.stadare.length > 0 ? `<br><span style="font-size:11px;color:#999">Städare: ${escapeH(p.stadare.slice(0, 3).join(', '))}</span>` : ''}
        ${p.kommentarer.map((k) => `<br><span style="font-size:11px;color:#1a1a2e;font-style:italic">”${escapeH(k)}”</span>`).join('')}
      </td>
      <td style="padding:10px 12px;border-bottom:1px solid #eee;text-align:center;font-size:13px;white-space:nowrap">
        ${tim(p.vanligTim)} h → <strong>${tim(p.passTim)} h</strong><br>
        <span style="font-size:11px;color:#c2410c;font-weight:600">+${tim(p.extraTim)} h</span>
      </td>
      <td style="padding:10px 12px;border-bottom:1px solid #eee;text-align:right;font-size:13px;white-space:nowrap">
        ${nf(p.passPris)} kr<br>
        <span style="font-size:11px;color:#666">${p.passPris === p.vanligtPris ? 'oförändrat' : `vanligt ${nf(p.vanligtPris)} kr`}</span>
      </td>
    </tr>`).join('');
  return `
  <table style="width:100%;background:white;border:1px solid #eae4d9;border-radius:12px;overflow:hidden;border-collapse:collapse;margin-bottom:20px">
    <thead>
      <tr style="background:#faf8f5;color:#666;font-size:10px;text-transform:uppercase;letter-spacing:.1em">
        <th style="padding:10px 12px;text-align:left">Datum</th>
        <th style="padding:10px 12px;text-align:left">Kund / Arbetsorder</th>
        <th style="padding:10px 12px;text-align:center">Vanlig tid → passet</th>
        <th style="padding:10px 12px;text-align:right">Pris</th>
      </tr>
    </thead>
    <tbody>${rader}</tbody>
  </table>`;
}

function buildHtml(enskilda: EnskiltForlangtPass[], period: string): string {
  if (enskilda.length === 0) {
    return `
<div style="font-family:-apple-system,sans-serif;max-width:720px;margin:0 auto;padding:24px;color:#1a1a2e;background:#faf8f5">
  <h1 style="font-family:Georgia,serif;font-size:24px;margin:0 0 4px">✅ Inga pass har förlängts utan prisjustering</h1>
  <p style="color:#666;font-size:13px;margin:0 0 24px">Senaste 30 dagarna (${period})</p>
  <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:12px;padding:16px">
    <p style="margin:0;color:#166534;font-size:14px">Inget pass har varit längre än jobbets vanliga tid utan att priset följt med.</p>
  </div>
</div>`;
  }

  const extra = enskilda.reduce((n, p) => n + p.extraTim, 0);
  const antalNya = enskilda.filter((p) => p.nytt).length;

  return `
<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;max-width:720px;margin:0 auto;padding:24px;color:#1a1a2e;background:#faf8f5">
  <h1 style="font-family:Georgia,serif;font-size:24px;margin:0 0 4px">⚠️ Förlängda pass utan prisjustering</h1>
  <p style="color:#666;font-size:13px;margin:0 0 24px">Senaste 30 dagarna (${period})</p>

  <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:12px;padding:16px;margin-bottom:20px">
    <p style="margin:0;color:#991b1b;font-size:14px"><strong>Alla förlängningar av pass måste godkännas av kunden.</strong><br>
    Passen nedan blev längre än jobbets vanliga tid utan att något extra lades in. Kontakta kunden och lägg in extratiden på passet, eller håll passet till den avtalade tiden.</p>
  </div>

  <table style="width:100%;background:white;border:1px solid #eae4d9;border-radius:12px;padding:20px;margin-bottom:20px;border-collapse:separate;border-spacing:0">
    <tr>
      <td style="padding:4px 0;color:#666;font-size:12px;text-transform:uppercase;letter-spacing:.08em">Pass förlängda utan prisjustering</td>
      <td style="padding:4px 0;text-align:right;font-size:28px;font-weight:600;color:#b91c1c">${enskilda.length}</td>
    </tr>
    <tr>
      <td style="padding:4px 0;color:#666;font-size:12px">Extra timmar utan betalning</td>
      <td style="padding:4px 0;text-align:right;font-size:16px;color:#b91c1c;font-weight:600">+${tim(extra)} h</td>
    </tr>
    <tr>
      <td style="padding:4px 0;color:#666;font-size:12px">Nya sedan förra veckan</td>
      <td style="padding:4px 0;text-align:right;font-size:16px;color:#c2410c;font-weight:600">${antalNya}</td>
    </tr>
  </table>
  ${buildEnskilda(enskilda)}

  <p style="color:#999;font-size:11px;margin-top:32px;text-align:center">
    Rapport från Head Office · skickas varje måndag<br>
    Datakälla: schemalagd tid och pris i Timewave. Ett pass räknas som förlängt när det är minst 15 % eller 30 min längre än jobbets vanliga tid<br>
    och priset är högst 2 % över det vanliga. Jobb behöver minst 2 tidigare pass för att kunna jämföras.
  </p>
</div>`;
}
