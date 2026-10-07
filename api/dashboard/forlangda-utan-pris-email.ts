/**
 * Mailar jobb där passen har förlängts UTAN att priset justerats.
 *
 * Mikaela 2026-10-07: 'ge oss ett mail på jobb där vi förlängt passen utan
 * att göra något åt priset, alla förlängningar av pass måste godkännas av kunden'.
 *
 * GET /api/dashboard/forlangda-utan-pris-email?secret=<CRON_SECRET>
 *   &dry=1  → bygg HTML men skicka inte (visa i browser)
 *
 * Två listor, båda från forlangda-pass.ts:
 *   1. Jobb där passen blivit längre över tid (senaste 30 dagar mot föregående 30)
 *      och priset per pass är oförändrat.
 *   2. Enskilda pass som blev längre än jobbets vanliga tid (median av passen
 *      30–120 dagar bakåt) utan att priset ändrats.
 *
 * Körs av Vercel Cron varje måndag (se vercel.json).
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getTimewaveToken } from '../_lib/timewaveAuth.js';
import { beraknaForlangdaPass, beraknaEnskildaForlangdaPass, hamta, type EnskiltForlangtPass } from './forlangda-pass.js';

export const config = { maxDuration: 60 };

const RECIPIENTS = (
  process.env.FORLANGDA_PASS_EMAIL_TO ||
  'info@stodona.se,mikaela.wigert@stodona.se'
).split(',').map((s) => s.trim()).filter(Boolean);

function escapeH(s: string): string { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function nf(n: number): string { return new Intl.NumberFormat('sv-SE').format(Math.round(n)); }

type Data = Awaited<ReturnType<typeof beraknaForlangdaPass>>;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const secret = process.env.CRON_SECRET;
  const authHdr = req.headers.authorization || '';
  const isCron = secret && authHdr === `Bearer ${secret}`;
  const isQuery = secret && req.query.secret === secret;
  if (!secret || (!isCron && !isQuery)) return res.status(401).json({ error: 'Unauthorized' });

  const dryRun = req.query.dry === '1';

  try {
    // Fyra 30-dagarsperioder bakåt: [0] = aktuell, [1] = referens, [1..3] = baslinje för enskilda pass
    const token = await getTimewaveToken();
    const now = new Date();
    const ymd = (d: Date) => d.toISOString().slice(0, 10);
    const dag = (n: number) => ymd(new Date(now.getTime() - n * 24 * 3600 * 1000));
    const perioder = await Promise.all([0, 1, 2, 3].map((k) => hamta(dag((k + 1) * 30), dag(k * 30), token)));

    const data = await beraknaForlangdaPass({ aktuella: perioder[0], referens: perioder[1] });
    const enskilda = beraknaEnskildaForlangdaPass(perioder[0], [...perioder[1], ...perioder[2], ...perioder[3]], now);
    const html = buildHtml(data, enskilda);
    const antalNya = enskilda.filter((p) => p.nytt).length;
    const subject = data.antalUtanPrisjustering > 0 || enskilda.length > 0
      ? `⚠️ Förlängda pass utan prisjustering: ${data.antalUtanPrisjustering} jobb, ${enskilda.length} enskilda pass${antalNya > 0 ? ` (${antalNya} nya i veckan)` : ''}`
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

    res.json({ ok: failed.length === 0, subject, sent, failed, antalUtanPrisjustering: data.antalUtanPrisjustering, antalEnskildaPass: enskilda.length });
  } catch (err: any) {
    console.error('[forlangda-utan-pris-email]', err?.message);
    res.status(500).json({ error: err?.message || 'failed' });
  }
}

function datumKort(ymdStr: string): string {
  return new Intl.DateTimeFormat('sv-SE', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${ymdStr}T12:00:00Z`));
}

function buildEnskilda(enskilda: EnskiltForlangtPass[]): string {
  if (enskilda.length === 0) return '';
  const extra = enskilda.reduce((n, p) => n + p.extraTim, 0);
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
        ${p.vanligTim} h → <strong>${p.passTim} h</strong><br>
        <span style="font-size:11px;color:#c2410c;font-weight:600">+${p.extraTim} h</span>
      </td>
      <td style="padding:10px 12px;border-bottom:1px solid #eee;text-align:right;font-size:13px;white-space:nowrap">
        ${nf(p.passPris)} kr<br>
        <span style="font-size:11px;color:#666">${p.passPris === p.vanligtPris ? 'oförändrat' : `vanligt ${nf(p.vanligtPris)} kr`}</span>
      </td>
    </tr>`).join('');
  return `
  <h2 style="font-family:Georgia,serif;font-size:18px;margin:28px 0 4px">📌 Enskilda pass som blev längre än vanligt</h2>
  <p style="color:#666;font-size:13px;margin:0 0 12px">${enskilda.length} pass de senaste 30 dagarna, sammanlagt +${(Math.round(extra * 10) / 10).toLocaleString('sv-SE')} h, där priset inte ändrats. Jämfört med jobbets vanliga tid per pass.</p>
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

function buildHtml(d: Data, enskilda: EnskiltForlangtPass[]): string {
  const period = `Senaste 30 dagarna (${d.aktuellPeriod}) jämfört med föregående 30 (${d.refPeriod})`;

  if (d.antalUtanPrisjustering === 0 && enskilda.length === 0) {
    return `
<div style="font-family:-apple-system,sans-serif;max-width:720px;margin:0 auto;padding:24px;color:#1a1a2e;background:#faf8f5">
  <h1 style="font-family:Georgia,serif;font-size:24px;margin:0 0 4px">✅ Inga pass har förlängts utan prisjustering</h1>
  <p style="color:#666;font-size:13px;margin:0 0 24px">${period}</p>
  <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:12px;padding:16px">
    <p style="margin:0;color:#166534;font-size:14px">${d.antalForlangda} arbetsordrar har fått längre pass, och på alla har priset per pass höjts.</p>
  </div>
</div>`;
  }

  const rader = d.utanPrisjustering.map((f, i) => `
    <tr>
      <td style="padding:10px 12px;border-bottom:1px solid #eee;vertical-align:top">
        <strong>${i + 1}. ${escapeH(f.klientNamn)}</strong><br>
        <span style="font-size:11px;color:#666">AO#${f.arbetsorder} · ${escapeH(f.tjanst)}</span>
        ${f.stadare.length > 0 ? `<br><span style="font-size:11px;color:#999">Städare: ${escapeH(f.stadare.slice(0, 3).join(', '))}</span>` : ''}
      </td>
      <td style="padding:10px 12px;border-bottom:1px solid #eee;text-align:center;font-size:13px;color:#1a1a2e;white-space:nowrap">
        ${f.refSnittTim} h → <strong>${f.aktuellSnittTim} h</strong><br>
        <span style="font-size:11px;color:#c2410c;font-weight:600">+${f.diffTim} h (${f.diffProc}%)</span>
      </td>
      <td style="padding:10px 12px;border-bottom:1px solid #eee;text-align:center;font-size:13px;color:#1a1a2e;white-space:nowrap">
        ${nf(f.refSnittPris)} kr → <strong>${nf(f.snittPris)} kr</strong><br>
        <span style="font-size:11px;color:#666">${f.prisDiffKr === 0 ? 'oförändrat' : `${f.prisDiffKr > 0 ? '+' : ''}${nf(f.prisDiffKr)} kr`}</span>
      </td>
      <td style="padding:10px 12px;border-bottom:1px solid #eee;text-align:right;font-size:13px;color:#b91c1c;font-weight:600;white-space:nowrap">
        ${nf(f.snittKrPerTim)} kr/h
      </td>
      <td style="padding:10px 12px;border-bottom:1px solid #eee;text-align:right;font-weight:700;color:#b91c1c;white-space:nowrap">
        +${f.extraTimPerManad} h
      </td>
    </tr>`).join('');

  const antalJusterade = d.antalForlangda - d.antalUtanPrisjustering;

  return `
<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;max-width:720px;margin:0 auto;padding:24px;color:#1a1a2e;background:#faf8f5">
  <h1 style="font-family:Georgia,serif;font-size:24px;margin:0 0 4px">⚠️ Förlängda pass utan prisjustering</h1>
  <p style="color:#666;font-size:13px;margin:0 0 24px">${period}</p>

  <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:12px;padding:16px;margin-bottom:20px">
    <p style="margin:0;color:#991b1b;font-size:14px"><strong>Alla förlängningar av pass måste godkännas av kunden.</strong><br>
    På jobben nedan har den schemalagda tiden ökat medan priset per pass är detsamma. Kontakta kunden och få förlängningen godkänd med nytt pris, eller korta passet till den avtalade tiden.</p>
  </div>

  <table style="width:100%;background:white;border:1px solid #eae4d9;border-radius:12px;padding:20px;margin-bottom:20px;border-collapse:separate;border-spacing:0">
    <tr>
      <td style="padding:4px 0;color:#666;font-size:12px;text-transform:uppercase;letter-spacing:.08em">Jobb förlängda utan prisjustering</td>
      <td style="padding:4px 0;text-align:right;font-size:28px;font-weight:600;color:#b91c1c">${d.antalUtanPrisjustering}</td>
    </tr>
    <tr>
      <td style="padding:4px 0;color:#666;font-size:12px">Extra timmar / månad utan betalning</td>
      <td style="padding:4px 0;text-align:right;font-size:16px;color:#b91c1c;font-weight:600">+${nf(d.extraTimUtanPrisjustering)} h</td>
    </tr>
    <tr>
      <td style="padding:4px 0;color:#666;font-size:12px">Enskilda pass längre än vanligt, samma pris</td>
      <td style="padding:4px 0;text-align:right;font-size:16px;color:#b91c1c;font-weight:600">${enskilda.length}</td>
    </tr>
    <tr>
      <td style="padding:4px 0;color:#666;font-size:12px">Förlängda jobb där priset har höjts</td>
      <td style="padding:4px 0;text-align:right;font-size:16px;color:#166534;font-weight:600">${antalJusterade}</td>
    </tr>
  </table>

  <h2 style="font-family:Georgia,serif;font-size:18px;margin:28px 0 4px">📈 Jobb där passen blivit längre över tid</h2>
  <p style="color:#666;font-size:13px;margin:0 0 12px">Snitt per pass de senaste 30 dagarna jämfört med de 30 dagarna innan.</p>
  ${d.antalUtanPrisjustering === 0 ? '<p style="font-size:13px;color:#166534">Inga sådana jobb just nu.</p>' : `<table style="width:100%;background:white;border:1px solid #eae4d9;border-radius:12px;overflow:hidden;border-collapse:collapse;margin-bottom:20px">
    <thead>
      <tr style="background:#faf8f5;color:#666;font-size:10px;text-transform:uppercase;letter-spacing:.1em">
        <th style="padding:10px 12px;text-align:left">Kund / Arbetsorder</th>
        <th style="padding:10px 12px;text-align:center">Tid per pass</th>
        <th style="padding:10px 12px;text-align:center">Pris per pass</th>
        <th style="padding:10px 12px;text-align:right">Snitt nu</th>
        <th style="padding:10px 12px;text-align:right">Extra/mån</th>
      </tr>
    </thead>
    <tbody>${rader}</tbody>
  </table>`}
  ${buildEnskilda(enskilda)}

  <p style="color:#999;font-size:11px;margin-top:32px;text-align:center">
    Rapport från Head Office · skickas varje måndag<br>
    Datakälla: schemalagd tid och pris i Timewave. Ett jobb eller pass räknas som förlängt vid minst 15 % eller 30 min längre tid,<br>
    och som utan prisjustering om priset per pass ökat mindre än 2 %. Jobb behöver minst 2 tidigare pass för att kunna jämföras.
  </p>
</div>`;
}
