/**
 * FÖREBYGGANDE veckoprognos — visar schemalagda pass nästa 7 dagar så
 * man kan agera INNAN städningen istället för efter.
 *
 * Mikaela 2026-10-05: 'vi ska förekomma. Skicka ut redan nu med info om
 * snittpris för kommande vecka, vart de ligger lågt etc'.
 *
 * Innehåll:
 *   - Snitt kr/h kommande 7 dagar
 *   - Per dag: antal missioner, total intäkt, snitt kr/h
 *   - ALLA pass < 400 kr/h sorterade på LÄGST (akuta att åtgärda)
 *   - Top 5 kunder med lägst snitt denna vecka (prisjustering)
 *
 * GET /api/dashboard/kommande-vecka-email?secret=<CRON_SECRET>
 *   &dry=1 → bygg HTML utan att skicka
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getTimewaveToken } from '../_lib/timewaveAuth.js';

export const config = { maxDuration: 60 };

const RECIPIENTS = (
  process.env.KOMMANDE_VECKA_EMAIL_TO ||
  process.env.SNITTPRIS_EMAIL_TO ||
  'info@stodona.se,mikaela.wigert@stodona.se'
).split(',').map((s) => s.trim()).filter(Boolean);

const nonBillableServiceIds = new Set([3, 7, 401]);
const TARGET_KR_PER_H = 550;
const WARN_THRESHOLD = 400;

function ymd(d: Date): string { return d.toISOString().slice(0, 10); }
function escapeH(s: string): string { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function nf(n: number): string { return new Intl.NumberFormat('sv-SE').format(Math.round(n)); }
function dayLabel(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00');
  return new Intl.DateTimeFormat('sv-SE', { weekday: 'long', day: 'numeric', month: 'short', timeZone: 'Europe/Stockholm' }).format(d);
}

async function hamta(start: string, end: string, token: string): Promise<any[]> {
  const base = 'https://api.timewave.se/v3';
  const out: any[] = [];
  let page = 1;
  while (true) {
    const url = `${base}/missions?filter[startdate]=${start}&filter[enddate]=${end}&page[size]=200&page[number]=${page}`;
    const r = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } });
    if (!r.ok) {
      if (r.status === 429 && page === 1) { await new Promise((res) => setTimeout(res, 2000)); continue; }
      break;
    }
    const j = await r.json() as any;
    const chunk = j?.data || [];
    out.push(...chunk);
    const last = j?.last_page ?? 1;
    if (page >= last || chunk.length === 0) break;
    page++;
    if (page > 50) break;
  }
  return out;
}

interface Pass { missionId: number; datum: string | null; kund: string; tjanst: string; stadare: string[]; antalStadare: number; timmar: number; revenue: number; krPerH: number; fattas: number; }

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const secret = process.env.CRON_SECRET;
  const authHdr = req.headers.authorization || '';
  const isCron = secret && authHdr === `Bearer ${secret}`;
  const isQuery = secret && req.query.secret === secret;
  if (!secret || (!isCron && !isQuery)) return res.status(401).json({ error: 'Unauthorized' });

  const dryRun = req.query.dry === '1';

  try {
    const now = new Date();
    const endDate = new Date(now.getTime() + 7 * 24 * 3600 * 1000);
    const startStr = ymd(now);
    const endStr = ymd(endDate);

    const token = await getTimewaveToken();
    const missioner = await hamta(startStr, endStr, token);

    const pass: Pass[] = [];
    let totalRev = 0;
    let totalTim = 0;

    for (const m of missioner) {
      // Revenue
      let revenue = 0;
      const tjansterLista: string[] = [];
      for (const svc of (m.services || [])) {
        if (nonBillableServiceIds.has(svc.id)) continue;
        const qty = Number(svc.quantity || 0);
        const price = Number(svc.price || 0);
        const discount = Number(svc.discount || 0);
        revenue += qty * price * (1 - discount / 100);
        tjansterLista.push((svc.name || svc.title || `#${svc.id}`).trim());
      }
      if (revenue === 0) continue;

      // Timmar + städare
      let timmar = 0;
      let antalStadare = 0;
      const stadareNamn: string[] = [];
      for (const e of (m.employees || [])) {
        if (e.cancelled || !e.starttime || !e.endtime) continue;
        const [sh, sm] = String(e.starttime).split(':').map(Number);
        const [eh, em] = String(e.endtime).split(':').map(Number);
        const h = Math.max(0, ((eh * 60 + em) - (sh * 60 + sm)) / 60);
        if (h > 0) {
          timmar += h; antalStadare++;
          const namn = `${e.first_name || ''} ${e.last_name || ''}`.trim() || e.full_name || e.name || '';
          if (namn) stadareNamn.push(namn);
        }
      }
      if (timmar === 0) continue;

      const krPerH = revenue / timmar;
      pass.push({
        missionId: m.id,
        datum: (m.startdate || m.date || null)?.slice(0, 10) || null,
        kund: m.client?.companyname ||
          `${m.client?.first_name || ''} ${m.client?.last_name || ''}`.trim() ||
          `Kund #${m.client?.id ?? '?'}`,
        tjanst: tjansterLista.join(' + '),
        stadare: stadareNamn,
        antalStadare,
        timmar: Math.round(timmar * 10) / 10,
        revenue: Math.round(revenue),
        krPerH: Math.round(krPerH),
        fattas: Math.round(timmar * TARGET_KR_PER_H - revenue),
      });

      totalRev += revenue;
      totalTim += timmar;
    }

    const totalSnitt = totalTim > 0 ? Math.round(totalRev / totalTim) : 0;

    // Per dag
    const perDag = new Map<string, { rev: number; tim: number; antal: number }>();
    for (const p of pass) {
      if (!p.datum) continue;
      if (!perDag.has(p.datum)) perDag.set(p.datum, { rev: 0, tim: 0, antal: 0 });
      const d = perDag.get(p.datum)!;
      d.rev += p.revenue; d.tim += p.timmar; d.antal++;
    }
    const dagar = [...perDag.entries()]
      .map(([datum, d]) => ({
        datum,
        antal: d.antal,
        rev: Math.round(d.rev),
        tim: Math.round(d.tim * 10) / 10,
        snitt: d.tim > 0 ? Math.round(d.rev / d.tim) : 0,
      }))
      .sort((a, b) => a.datum.localeCompare(b.datum));

    // Pass under tröskel
    const lagaPass = pass
      .filter((p) => p.krPerH < WARN_THRESHOLD)
      .sort((a, b) => a.krPerH - b.krPerH);
    const varningarTotal = lagaPass.reduce((n, p) => n + p.fattas, 0);

    // Per kund denna vecka (med flera pass eller stort belopp)
    const perKund = new Map<string, { kund: string; antal: number; rev: number; tim: number; worstPris: number }>();
    for (const p of pass) {
      if (!perKund.has(p.kund)) perKund.set(p.kund, { kund: p.kund, antal: 0, rev: 0, tim: 0, worstPris: Infinity });
      const k = perKund.get(p.kund)!;
      k.antal++; k.rev += p.revenue; k.tim += p.timmar;
      if (p.krPerH < k.worstPris) k.worstPris = p.krPerH;
    }
    const kundLista = [...perKund.values()]
      .filter((k) => k.tim > 0.1 && k.antal >= 1)
      .map((k) => ({
        kund: k.kund,
        antal: k.antal,
        rev: Math.round(k.rev),
        tim: Math.round(k.tim * 10) / 10,
        snitt: Math.round(k.rev / k.tim),
      }))
      .filter((k) => k.snitt < WARN_THRESHOLD)
      .sort((a, b) => a.snitt - b.snitt)
      .slice(0, 10);

    const html = buildHtml({
      startStr, endStr,
      antalMissioner: pass.length,
      totalRev: Math.round(totalRev),
      totalTim: Math.round(totalTim * 10) / 10,
      totalSnitt,
      dagar,
      lagaPass,
      varningarTotal,
      kundLista,
    });

    const subject = pass.length === 0
      ? `📅 Kommande vecka: inga schemalagda pass`
      : lagaPass.length === 0
      ? `✅ Kommande vecka: snitt ${nf(totalSnitt)} kr/h — allt över tröskel`
      : `⏰ Kommande vecka: ${lagaPass.length} pass under ${WARN_THRESHOLD} kr/h — åtgärda nu`;

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
        const r = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ from: `"Stodona HeadOf" <${fromAddress}>`, to, subject, html }),
        });
        if (!r.ok) throw new Error(`${r.status}: ${(await r.text()).substring(0, 200)}`);
        sent.push(to);
      } catch (e: any) {
        failed.push({ to, error: e?.message });
      }
    }

    res.json({ ok: failed.length === 0, subject, sent, failed, antalMissioner: pass.length, antalVarningar: lagaPass.length });
  } catch (err: any) {
    console.error('[kommande-vecka-email]', err?.message);
    res.status(500).json({ error: err?.message || 'failed' });
  }
}

function pris(snitt: number): string {
  if (snitt >= TARGET_KR_PER_H) return `<span style="color:#059669;font-weight:600">${nf(snitt)} kr/h</span>`;
  if (snitt >= WARN_THRESHOLD + 50) return `<span style="color:#a16207;font-weight:600">${nf(snitt)} kr/h</span>`;
  if (snitt >= WARN_THRESHOLD) return `<span style="color:#c2410c;font-weight:600">${nf(snitt)} kr/h</span>`;
  return `<span style="color:#b91c1c;font-weight:700">${nf(snitt)} kr/h</span>`;
}

function buildHtml(d: {
  startStr: string; endStr: string;
  antalMissioner: number; totalRev: number; totalTim: number; totalSnitt: number;
  dagar: Array<{ datum: string; antal: number; rev: number; tim: number; snitt: number }>;
  lagaPass: Array<{ datum: string | null; kund: string; tjanst: string; stadare: string[]; antalStadare: number; timmar: number; revenue: number; krPerH: number; fattas: number }>;
  varningarTotal: number;
  kundLista: Array<{ kund: string; antal: number; rev: number; tim: number; snitt: number }>;
}): string {
  const dagRader = d.dagar.map((x) => `
    <tr>
      <td style="padding:8px 12px;border-bottom:1px solid #eee">${escapeH(dayLabel(x.datum))}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #eee;text-align:right;color:#666;font-size:12px">${x.antal} pass · ${x.tim} h</td>
      <td style="padding:8px 12px;border-bottom:1px solid #eee;text-align:right">${nf(x.rev)} kr</td>
      <td style="padding:8px 12px;border-bottom:1px solid #eee;text-align:right">${pris(x.snitt)}</td>
    </tr>`).join('');

  const passRader = d.lagaPass.slice(0, 25).map((p) => `
    <tr>
      <td style="padding:6px 10px;border-bottom:1px solid #fecaca;font-size:12px;color:#7f1d1d">${p.datum ? escapeH(dayLabel(p.datum)) : '—'}</td>
      <td style="padding:6px 10px;border-bottom:1px solid #fecaca">
        <strong>${escapeH(p.kund)}</strong><br>
        <span style="font-size:11px;color:#991b1b">${escapeH(p.tjanst)}</span>
        ${p.stadare.length > 0 ? `<br><span style="font-size:10px;color:#991b1b">👤 ${escapeH(p.stadare.slice(0, 3).join(', '))}</span>` : ''}
      </td>
      <td style="padding:6px 10px;border-bottom:1px solid #fecaca;text-align:right;font-size:12px">${p.antalStadare} × ${p.timmar} h</td>
      <td style="padding:6px 10px;border-bottom:1px solid #fecaca;text-align:right;font-size:12px">${nf(p.revenue)} kr</td>
      <td style="padding:6px 10px;border-bottom:1px solid #fecaca;text-align:right;color:#b91c1c;font-weight:600">${nf(p.krPerH)} kr/h</td>
      <td style="padding:6px 10px;border-bottom:1px solid #fecaca;text-align:right;color:#b91c1c">−${nf(p.fattas)} kr</td>
    </tr>`).join('');

  const kundRader = d.kundLista.map((k, i) => `
    <tr>
      <td style="padding:8px 12px;border-bottom:1px solid #eee"><strong>${i + 1}.</strong> ${escapeH(k.kund)}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #eee;text-align:right;color:#666;font-size:12px">${k.antal} pass · ${k.tim} h</td>
      <td style="padding:8px 12px;border-bottom:1px solid #eee;text-align:right">${pris(k.snitt)}</td>
    </tr>`).join('');

  return `
<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;max-width:720px;margin:0 auto;padding:24px;color:#1a1a2e;background:#faf8f5">
  <h1 style="font-family:Georgia,serif;font-size:24px;margin:0 0 4px">📅 Snittpris kommande vecka</h1>
  <p style="color:#666;font-size:13px;margin:0 0 24px">${d.startStr} → ${d.endStr} · alla priser ex moms · förebyggande rapport</p>

  <table style="width:100%;background:white;border:1px solid #eae4d9;border-radius:12px;padding:20px;margin-bottom:20px;border-collapse:separate;border-spacing:0">
    <tr>
      <td style="padding:4px 0;color:#666;font-size:12px;text-transform:uppercase;letter-spacing:.08em">Schemalagda pass</td>
      <td style="padding:4px 0;text-align:right;font-size:28px;font-weight:600">${d.antalMissioner} st</td>
    </tr>
    <tr>
      <td style="padding:4px 0;color:#666;font-size:12px">Prognosintäkt</td>
      <td style="padding:4px 0;text-align:right;font-size:16px">${nf(d.totalRev)} kr</td>
    </tr>
    <tr>
      <td style="padding:4px 0;color:#666;font-size:12px">Snitt kr/h</td>
      <td style="padding:4px 0;text-align:right">${pris(d.totalSnitt)}</td>
    </tr>
    <tr>
      <td style="padding:4px 0;color:#666;font-size:12px">Mål</td>
      <td style="padding:4px 0;text-align:right;font-size:13px;color:#666">${TARGET_KR_PER_H} kr/h</td>
    </tr>
  </table>

  ${d.dagar.length > 0 ? `
  <h2 style="font-family:Georgia,serif;font-size:18px;margin:28px 0 8px">📊 Per dag</h2>
  <table style="width:100%;background:white;border:1px solid #eae4d9;border-radius:12px;overflow:hidden;border-collapse:collapse;margin-bottom:20px">
    ${dagRader}
  </table>` : ''}

  ${d.lagaPass.length > 0 ? `
  <h2 style="font-family:Georgia,serif;font-size:18px;margin:28px 0 8px">⏰ Pass under ${WARN_THRESHOLD} kr/h (åtgärda före städning)</h2>
  <p style="color:#666;font-size:13px;margin:0 0 10px">
    <strong>${d.lagaPass.length} pass</strong> har effektivt pris under ${WARN_THRESHOLD} kr/h.
    Totalt fattas <strong>${nf(d.varningarTotal)} kr</strong> jämfört med målet ${TARGET_KR_PER_H} kr/h.
    Rätta i Timewave: ta bort städare, korta pass eller höj priset på avtalet.
  </p>
  <table style="width:100%;background:#fef2f2;border:1px solid #fecaca;border-radius:12px;overflow:hidden;border-collapse:collapse;margin-bottom:20px">
    <thead>
      <tr style="background:#fee2e2;color:#991b1b;font-size:10px;text-transform:uppercase;letter-spacing:.1em">
        <th style="padding:8px 10px;text-align:left">Dag</th>
        <th style="padding:8px 10px;text-align:left">Kund / tjänst / städare</th>
        <th style="padding:8px 10px;text-align:right">Städare × tim</th>
        <th style="padding:8px 10px;text-align:right">Pris</th>
        <th style="padding:8px 10px;text-align:right">kr/h</th>
        <th style="padding:8px 10px;text-align:right">Fattas</th>
      </tr>
    </thead>
    <tbody>${passRader}</tbody>
  </table>
  ${d.lagaPass.length > 25 ? `<p style="color:#666;font-size:12px;font-style:italic">Visar 25 första — totalt ${d.lagaPass.length} pass under tröskel.</p>` : ''}
  ` : `
  <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:12px;padding:16px;margin:20px 0">
    <p style="margin:0;color:#166534;font-size:14px">✅ Alla schemalagda pass kommande vecka ligger över ${WARN_THRESHOLD} kr/h — bra!</p>
  </div>`}

  ${d.kundLista.length > 0 ? `
  <h2 style="font-family:Georgia,serif;font-size:18px;margin:28px 0 8px">🔻 Kunder att prisjustera (lägst snitt denna vecka)</h2>
  <table style="width:100%;background:white;border:1px solid #eae4d9;border-radius:12px;overflow:hidden;border-collapse:collapse;margin-bottom:20px">
    ${kundRader}
  </table>` : ''}

  <h2 style="font-family:Georgia,serif;font-size:18px;margin:28px 0 8px">🎯 Nästa steg</h2>
  <ol style="color:#1a1a2e;font-size:13px;line-height:1.7">
    <li><strong>Gå igenom listan ovan NU</strong> och justera eller ring kunden innan passet körs.</li>
    <li>Pass med 2+ städare och lågt pris → överväg att ta bort en städare (värt det?).</li>
    <li>Hemstäd &lt; 350 kr/h = troligen gammalt avtal → initiera prisjustering.</li>
    <li>Byggstäd &lt; 350 kr/h = fel kalibrerat → höj grundtaxan.</li>
  </ol>

  <p style="color:#999;font-size:11px;margin-top:32px;text-align:center">
    Förebyggande rapport från Head Office · alla priser ex moms<br>
    Datakälla: Timewave missions nästa 7 dagar
  </p>
</div>`;
}
