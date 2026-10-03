/**
 * Mailar förlängda-pass-rapporten till info@stodona.se + mikaela.
 *
 * Mikaela 2026-10-03: 'Detta måste vi ta action på! Maila detta till mig'.
 *
 * GET /api/dashboard/forlangda-pass-email?secret=<CRON_SECRET>
 *   &dry=1  → bygg HTML men skicka inte (visa i browser)
 *
 * Hämtar data från samma logik som forlangda-pass.ts och skickar till
 * RECIPIENTS via Resend.
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { prisma } from '../_lib/prisma.js';

export const config = { maxDuration: 60 };

const RECIPIENTS = (
  process.env.FORLANGDA_PASS_EMAIL_TO ||
  'info@stodona.se,mikaela.wigert@stodona.se'
).split(',').map((s) => s.trim()).filter(Boolean);

function escapeH(s: string): string { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function nf(n: number): string { return new Intl.NumberFormat('sv-SE').format(Math.round(n)); }

interface ForlangdPass {
  arbetsorder: number;
  klientNamn: string;
  tjanst: string;
  stadare: string[];
  refPass: number;
  refSnittTim: number;
  aktuellPass: number;
  aktuellSnittTim: number;
  diffTim: number;
  diffProc: number;
  extraTimPerManad: number;
  snittPris: number;
  snittKrPerTim: number;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const secret = process.env.CRON_SECRET;
  const authHdr = req.headers.authorization || '';
  const isCron = secret && authHdr === `Bearer ${secret}`;
  const isQuery = secret && req.query.secret === secret;
  if (!secret || (!isCron && !isQuery)) return res.status(401).json({ error: 'Unauthorized' });

  const dryRun = req.query.dry === '1';

  try {
    // Hämta data från vår egen endpoint (den har 10 min cache)
    const baseUrl = process.env.APP_URL || `https://${req.headers.host}`;
    const r = await fetch(`${baseUrl}/api/dashboard/forlangda-pass`);
    if (!r.ok) throw new Error(`forlangda-pass endpoint ${r.status}`);
    const data = await r.json() as {
      aktuellPeriod: string;
      refPeriod: string;
      antalForlangda: number;
      totalExtraTimPerManad: number;
      totalForloradInkomst: number;
      forlangda: ForlangdPass[];
    };

    const html = buildHtml(data);
    const subject = data.antalForlangda > 0
      ? `⏰ ${data.antalForlangda} pass har förlängts — ${nf(data.totalExtraTimPerManad)} h extra/mån (${nf(data.totalForloradInkomst)} kr)`
      : `✅ Inga pass har förlängts senaste månaden`;

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

    res.json({ ok: failed.length === 0, subject, sent, failed, antalForlangda: data.antalForlangda });
  } catch (err: any) {
    console.error('[forlangda-pass-email]', err?.message);
    res.status(500).json({ error: err?.message || 'failed' });
  }
}

function buildHtml(d: {
  aktuellPeriod: string;
  refPeriod: string;
  antalForlangda: number;
  totalExtraTimPerManad: number;
  totalForloradInkomst: number;
  forlangda: ForlangdPass[];
}): string {
  if (d.antalForlangda === 0) {
    return `
<div style="font-family:-apple-system,sans-serif;max-width:720px;margin:0 auto;padding:24px;color:#1a1a2e;background:#faf8f5">
  <h1 style="font-family:Georgia,serif;font-size:24px;margin:0 0 4px">✅ Inga pass har förlängts</h1>
  <p style="color:#666;font-size:13px;margin:0 0 24px">Senaste 30 dagarna jämfört med föregående 30 dagar</p>
  <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:12px;padding:16px">
    <p style="margin:0;color:#166534;font-size:14px">Alla återkommande arbetsordrar har samma eller lägre snitt-timmar jämfört med föregående månad. Bra jobbat!</p>
  </div>
</div>`;
  }

  const rader = d.forlangda.map((f, i) => `
    <tr style="${i === 0 ? 'background:#fff7ed' : ''}">
      <td style="padding:10px 12px;border-bottom:1px solid #eee;vertical-align:top">
        <strong>${i + 1}. ${escapeH(f.klientNamn)}</strong><br>
        <span style="font-size:11px;color:#666">AO#${f.arbetsorder} · ${escapeH(f.tjanst)}</span>
        ${f.stadare.length > 0 ? `<br><span style="font-size:11px;color:#999">Städare: ${escapeH(f.stadare.slice(0, 3).join(', '))}</span>` : ''}
      </td>
      <td style="padding:10px 12px;border-bottom:1px solid #eee;text-align:center;font-size:13px;color:#666">
        ${f.refSnittTim} h<br><span style="font-size:10px">× ${f.refPass} pass</span>
      </td>
      <td style="padding:10px 12px;border-bottom:1px solid #eee;text-align:center;font-size:13px;font-weight:600;color:#1a1a2e">
        ${f.aktuellSnittTim} h<br><span style="font-size:10px;font-weight:400;color:#666">× ${f.aktuellPass} pass</span>
      </td>
      <td style="padding:10px 12px;border-bottom:1px solid #eee;text-align:right;font-weight:600;color:#c2410c">
        +${f.diffTim} h<br><span style="font-size:11px">(${f.diffProc}%)</span>
      </td>
      <td style="padding:10px 12px;border-bottom:1px solid #eee;text-align:right;font-weight:700;color:#b91c1c">
        +${f.extraTimPerManad} h
      </td>
    </tr>`).join('');

  const topKund = d.forlangda[0];
  const topKundAndel = Math.round((topKund.extraTimPerManad / d.totalExtraTimPerManad) * 100);

  return `
<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;max-width:720px;margin:0 auto;padding:24px;color:#1a1a2e;background:#faf8f5">
  <h1 style="font-family:Georgia,serif;font-size:24px;margin:0 0 4px">⏰ Pass som har förlängts</h1>
  <p style="color:#666;font-size:13px;margin:0 0 24px">
    Aktuell period: ${d.aktuellPeriod} vs Referens: ${d.refPeriod}
  </p>

  <table style="width:100%;background:white;border:1px solid #eae4d9;border-radius:12px;padding:20px;margin-bottom:20px;border-collapse:separate;border-spacing:0">
    <tr>
      <td style="padding:4px 0;color:#666;font-size:12px;text-transform:uppercase;letter-spacing:.08em">Antal arbetsordrar som förlängts</td>
      <td style="padding:4px 0;text-align:right;font-size:28px;font-weight:600;color:#c2410c">${d.antalForlangda}</td>
    </tr>
    <tr>
      <td style="padding:4px 0;color:#666;font-size:12px">Extra timmar / månad</td>
      <td style="padding:4px 0;text-align:right;font-size:16px;color:#b91c1c;font-weight:600">+${nf(d.totalExtraTimPerManad)} h</td>
    </tr>
    <tr>
      <td style="padding:4px 0;color:#666;font-size:12px">Förlorad inkomst (mot 550 kr/h)</td>
      <td style="padding:4px 0;text-align:right;font-size:16px;color:#b91c1c;font-weight:600">-${nf(d.totalForloradInkomst)} kr/mån</td>
    </tr>
  </table>

  <div style="background:#fff7ed;border:1px solid #fed7aa;border-radius:12px;padding:16px;margin-bottom:20px">
    <p style="margin:0;color:#9a3412;font-size:14px"><strong>Störst förlängning:</strong> ${escapeH(topKund.klientNamn)} (AO#${topKund.arbetsorder})<br>
    Från ${topKund.refSnittTim}h till ${topKund.aktuellSnittTim}h per pass = +${topKund.extraTimPerManad}h extra/mån = <strong>${topKundAndel}%</strong> av hela problemet.</p>
  </div>

  <h2 style="font-family:Georgia,serif;font-size:18px;margin:28px 0 8px">📋 Lista — sorterad på största förlängning</h2>
  <table style="width:100%;background:white;border:1px solid #eae4d9;border-radius:12px;overflow:hidden;border-collapse:collapse;margin-bottom:20px">
    <thead>
      <tr style="background:#faf8f5;color:#666;font-size:10px;text-transform:uppercase;letter-spacing:.1em">
        <th style="padding:10px 12px;text-align:left">Kund / Arbetsorder</th>
        <th style="padding:10px 12px;text-align:center">Referens</th>
        <th style="padding:10px 12px;text-align:center">Nu</th>
        <th style="padding:10px 12px;text-align:right">Diff/pass</th>
        <th style="padding:10px 12px;text-align:right">Extra/mån</th>
      </tr>
    </thead>
    <tbody>${rader}</tbody>
  </table>

  <h2 style="font-family:Georgia,serif;font-size:18px;margin:28px 0 8px">🎯 Nästa steg</h2>
  <ol style="color:#1a1a2e;font-size:13px;line-height:1.6">
    <li><strong>Ring ${escapeH(topKund.klientNamn)}</strong> — kolla om omfattningen vuxit. Höj priset eller strama åt tiden.</li>
    <li>Prata med städarna som är med på top-3 — har kunden faktiskt mer att städa, eller har det blivit vana att dra ut på tiden?</li>
    <li>Hemstäd-kunder med stora ökningar (Dennis/Cecilia Adali +45%, Robert Vallbom +47%) — snabbt samtal om extra arbete → kort prisjustering.</li>
  </ol>

  <p style="color:#999;font-size:11px;margin-top:32px;text-align:center">
    Rapport från Head Office · alla priser ex moms<br>
    Datakälla: Timewave missions senaste 60 dagarna, grupperat per arbetsorder
  </p>
</div>`;
}
