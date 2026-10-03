/**
 * Veckovis snittpris-rapport till info@stodona.se.
 *
 * Mikaela 2026-10-02: Nivå 1-planen. Måndag kl 07:00 — innehåller:
 *   - Snitt kr/h förra veckan vs 4-veckors-snitt + mål
 *   - Top 3 pris-justerings-kandidater (abonnemang med lägst snitt)
 *   - Tim-varningar nästa 7 dagar (missioner < 400 kr/h)
 *   - Prognos: om allt åtgärdas → nytt snitt
 *
 * Cron: 0 7 * * 1  (måndag kl 07:00 Sthlm, 06:00 UTC på vintern)
 * Auth: Bearer CRON_SECRET
 * Mail: Resend → RECIPIENTS (default info@stodona.se + mikaela.wigert@stodona.se)
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getTimewaveToken } from '../_lib/timewaveAuth.js';

export const config = { maxDuration: 60 };

const RECIPIENTS = (
  process.env.SNITTPRIS_EMAIL_TO ||
  'info@stodona.se,mikaela.wigert@stodona.se'
).split(',').map((s) => s.trim()).filter(Boolean);

const nonBillableServiceIds = new Set([3, 7, 401]);
const TARGET_KR_PER_H = 550;
// Varning triggar när snitt < 300 kr/h (räknat per manna-timme — dvs 2 städare × 2h = 4h).
// 400 kr/h gav 135 varningar vilket blev brus. 300 kr/h fångar bara de riktigt
// låga där nästan säkert något är fel (fel schemaläggning eller mycket gammalt avtal).
const WARN_THRESHOLD = 300;

function ymd(d: Date): string { return d.toISOString().slice(0, 10); }
function escapeH(s: string): string { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function nf(n: number): string { return new Intl.NumberFormat('sv-SE').format(Math.round(n)); }

async function hamtaMissioner(start: string, end: string, token: string): Promise<any[]> {
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

interface MissionData { revenue: number; timmar: number; antalStadare: number; clientId: number | null; clientName: string; tjanst: string; dagar: string | null; missionId: number; }

function parseMission(m: any): MissionData {
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
  let timmar = 0;
  let antalStadare = 0;
  for (const e of (m.employees || [])) {
    if (e.cancelled || !e.starttime || !e.endtime) continue;
    const [sh, sm] = String(e.starttime).split(':').map(Number);
    const [eh, em] = String(e.endtime).split(':').map(Number);
    const h = Math.max(0, ((eh * 60 + em) - (sh * 60 + sm)) / 60);
    if (h > 0) { timmar += h; antalStadare++; }
  }
  return {
    missionId: m.id,
    revenue,
    timmar,
    antalStadare,
    clientId: m.client?.id ?? null,
    clientName: m.client?.companyname ||
      `${m.client?.first_name || ''} ${m.client?.last_name || ''}`.trim() ||
      `Kund #${m.client?.id ?? '?'}`,
    tjanst: tjansterLista.join(' + '),
    dagar: (m.startdate || m.date || null)?.slice(0, 10) || null,
  };
}

function snittPerVecka(missions: MissionData[], weekStart: Date, weekEnd: Date): { rev: number; tim: number; snitt: number } {
  const s = ymd(weekStart);
  const e = ymd(weekEnd);
  let rev = 0, tim = 0;
  for (const m of missions) {
    if (!m.dagar) continue;
    if (m.dagar >= s && m.dagar <= e && m.timmar > 0) {
      rev += m.revenue;
      tim += m.timmar;
    }
  }
  return { rev, tim, snitt: tim > 0 ? rev / tim : 0 };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const secret = process.env.CRON_SECRET;
  const authHdr = req.headers.authorization || '';
  const isCron = secret && authHdr === `Bearer ${secret}`;
  const isQuery = secret && req.query.secret === secret;
  if (!secret || (!isCron && !isQuery)) return res.status(401).json({ error: 'Unauthorized' });

  const dryRun = req.query.dry === '1';

  try {
    const token = await getTimewaveToken();

    // Datum-fönster
    const now = new Date();
    const lastWeekEnd = new Date(now); lastWeekEnd.setDate(lastWeekEnd.getDate() - 1);
    const lastWeekStart = new Date(lastWeekEnd); lastWeekStart.setDate(lastWeekStart.getDate() - 6);
    const fourWeeksStart = new Date(lastWeekEnd); fourWeeksStart.setDate(fourWeeksStart.getDate() - 27);
    const next7End = new Date(now); next7End.setDate(next7End.getDate() + 7);
    // Månadens kund-aggregering (abonnemang): använd senaste 30 dagar
    const kundAggStart = new Date(now); kundAggStart.setDate(kundAggStart.getDate() - 30);

    // Timewave missions-list ger inte startdate på top-level → vi kan inte
    // filtrera i kod. Lösning: separata API-anrop per period (URL:en filtrerar).
    const [veckoMissions, fyraVMissions, framatMissions] = await Promise.all([
      hamtaMissioner(ymd(lastWeekStart), ymd(lastWeekEnd), token),
      hamtaMissioner(ymd(fourWeeksStart), ymd(lastWeekEnd), token),
      hamtaMissioner(ymd(now), ymd(next7End), token),
    ]);
    const veckoParsed = veckoMissions.map(parseMission);
    const bakat = fyraVMissions.map(parseMission);
    const framat = framatMissions.map(parseMission);

    const forraVeckan = { rev: 0, tim: 0, snitt: 0 };
    for (const m of veckoParsed) {
      if (m.timmar > 0) { forraVeckan.rev += m.revenue; forraVeckan.tim += m.timmar; }
    }
    forraVeckan.snitt = forraVeckan.tim > 0 ? forraVeckan.rev / forraVeckan.tim : 0;

    const fyraVeckor = { rev: 0, tim: 0, snitt: 0 };
    for (const m of bakat) {
      if (m.timmar > 0) { fyraVeckor.rev += m.revenue; fyraVeckor.tim += m.timmar; }
    }
    fyraVeckor.snitt = fyraVeckor.tim > 0 ? fyraVeckor.rev / fyraVeckor.tim : 0;

    // Kundaggregering (senaste 30 dagar, >= 2 missioner, sortera på lägst snitt)
    const perKund = new Map<number, { id: number; namn: string; missioner: number; rev: number; tim: number; tjanst: Map<string, number> }>();
    for (const m of bakat) {
      if (!m.clientId || !m.dagar) continue;
      if (m.dagar < ymd(kundAggStart)) continue;
      if (m.timmar === 0 || m.revenue === 0) continue;
      if (!perKund.has(m.clientId)) perKund.set(m.clientId, { id: m.clientId, namn: m.clientName, missioner: 0, rev: 0, tim: 0, tjanst: new Map() });
      const k = perKund.get(m.clientId)!;
      k.missioner++;
      k.rev += m.revenue;
      k.tim += m.timmar;
      if (m.tjanst) k.tjanst.set(m.tjanst, (k.tjanst.get(m.tjanst) || 0) + 1);
    }
    const kundLista = [...perKund.values()]
      .filter((k) => k.missioner >= 2 && k.tim > 0.1)
      .map((k) => ({
        namn: k.namn,
        missioner: k.missioner,
        rev: Math.round(k.rev),
        tim: Math.round(k.tim * 10) / 10,
        snitt: Math.round(k.rev / k.tim),
        tjanst: [...k.tjanst.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || '',
      }))
      .sort((a, b) => a.snitt - b.snitt);
    const bottom3 = kundLista.slice(0, 3);

    // Potential: om bottom-3 (eller de 10 lägsta med fler än X missioner) kunde nå 400 kr/h
    const bottomForPotential = kundLista.slice(0, 10);
    const potentialKrPerMan = bottomForPotential.reduce((n, k) => n + Math.max(0, k.tim * 400 - k.rev), 0);

    // Tim-varningar nästa 7 dagar
    const timVarningar = framat
      .filter((m) => m.timmar > 0 && m.revenue > 0 && (m.revenue / m.timmar) < WARN_THRESHOLD)
      .map((m) => ({
        datum: m.dagar,
        kund: m.clientName,
        tjanst: m.tjanst,
        antalStadare: m.antalStadare,
        timmar: Math.round(m.timmar * 10) / 10,
        revenue: Math.round(m.revenue),
        krPerH: Math.round(m.revenue / m.timmar),
        fattas: Math.round(m.timmar * WARN_THRESHOLD - m.revenue),
      }))
      .sort((a, b) => a.krPerH - b.krPerH);
    const varningarTotal = timVarningar.reduce((n, v) => n + v.fattas, 0);

    // Bygg HTML
    const html = buildHtml({
      forraVeckan,
      fyraVeckor,
      bottom3,
      potentialKrPerMan,
      timVarningar: timVarningar.slice(0, 15),
      varningarTotal,
      antalVarningarTotal: timVarningar.length,
      prognosLyft: fyraVeckor.tim > 0
        ? Math.round(((fyraVeckor.rev + potentialKrPerMan) / fyraVeckor.tim))
        : 0,
    });

    const subject = `📊 Snittpris-rapport v.${isoWeek(lastWeekEnd)} — ${nf(forraVeckan.snitt)} kr/h (mål ${TARGET_KR_PER_H})`;

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
        if (!r.ok) {
          const errBody = await r.text();
          throw new Error(`${r.status}: ${errBody.substring(0, 200)}`);
        }
        sent.push(to);
      } catch (e: any) {
        failed.push({ to, error: e?.message });
      }
    }

    res.json({ ok: failed.length === 0, subject, sent, failed, antalKunder: kundLista.length, antalVarningar: timVarningar.length });
  } catch (err: any) {
    console.error('[snittpris-weekly-email]', err?.message);
    res.status(500).json({ error: err?.message || 'failed' });
  }
}

function isoWeek(d: Date): number {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  date.setUTCDate(date.getUTCDate() + 4 - (date.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  return Math.ceil((((date.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
}

function pris(snitt: number): string {
  if (snitt >= TARGET_KR_PER_H) return `<span style="color:#059669;font-weight:600">${nf(snitt)} kr/h</span>`;
  if (snitt >= WARN_THRESHOLD + 50) return `<span style="color:#a16207;font-weight:600">${nf(snitt)} kr/h</span>`;
  return `<span style="color:#b91c1c;font-weight:600">${nf(snitt)} kr/h</span>`;
}

function buildHtml(d: {
  forraVeckan: { rev: number; tim: number; snitt: number };
  fyraVeckor: { rev: number; tim: number; snitt: number };
  bottom3: Array<{ namn: string; missioner: number; rev: number; tim: number; snitt: number; tjanst: string }>;
  potentialKrPerMan: number;
  timVarningar: Array<{ datum: string | null; kund: string; tjanst: string; antalStadare: number; timmar: number; revenue: number; krPerH: number; fattas: number }>;
  varningarTotal: number;
  antalVarningarTotal: number;
  prognosLyft: number;
}): string {
  const bottomRader = d.bottom3.map((k, i) => `
    <tr>
      <td style="padding:8px 12px;border-bottom:1px solid #eee"><strong>${i + 1}.</strong> ${escapeH(k.namn)}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #eee;color:#666;font-size:12px">${escapeH(k.tjanst)}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #eee;text-align:right">${k.missioner} st · ${k.tim} h</td>
      <td style="padding:8px 12px;border-bottom:1px solid #eee;text-align:right">${pris(k.snitt)}</td>
    </tr>
  `).join('');

  const varningRader = d.timVarningar.map((v) => `
    <tr>
      <td style="padding:6px 10px;border-bottom:1px solid #fecaca;font-size:12px;color:#7f1d1d">${v.datum || '—'}</td>
      <td style="padding:6px 10px;border-bottom:1px solid #fecaca"><strong>${escapeH(v.kund)}</strong><br><span style="font-size:11px;color:#991b1b">${escapeH(v.tjanst)}</span></td>
      <td style="padding:6px 10px;border-bottom:1px solid #fecaca;text-align:right;font-size:12px">${v.antalStadare} × ${v.timmar} h</td>
      <td style="padding:6px 10px;border-bottom:1px solid #fecaca;text-align:right;font-size:12px">${nf(v.revenue)} kr</td>
      <td style="padding:6px 10px;border-bottom:1px solid #fecaca;text-align:right;color:#b91c1c;font-weight:600">${nf(v.krPerH)} kr/h</td>
      <td style="padding:6px 10px;border-bottom:1px solid #fecaca;text-align:right;color:#b91c1c">−${nf(v.fattas)} kr</td>
    </tr>
  `).join('');

  return `
<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;max-width:720px;margin:0 auto;padding:24px;color:#1a1a2e;background:#faf8f5">
  <h1 style="font-family:Georgia,serif;font-size:24px;margin:0 0 4px;color:#1a1a2e">📊 Snittpris-rapport</h1>
  <p style="color:#666;font-size:13px;margin:0 0 24px">Veckan som gick · alla priser ex moms</p>

  <table style="width:100%;background:white;border:1px solid #eae4d9;border-radius:12px;padding:20px;margin-bottom:20px;border-collapse:separate;border-spacing:0">
    <tr>
      <td style="padding:4px 0;color:#666;font-size:12px;text-transform:uppercase;letter-spacing:.08em">Förra veckan</td>
      <td style="padding:4px 0;text-align:right;font-size:28px;font-weight:600">${pris(d.forraVeckan.snitt)}</td>
    </tr>
    <tr>
      <td style="padding:4px 0;color:#666;font-size:12px">Snitt senaste 4 v</td>
      <td style="padding:4px 0;text-align:right">${pris(d.fyraVeckor.snitt)}</td>
    </tr>
    <tr>
      <td style="padding:4px 0;color:#666;font-size:12px">Mål</td>
      <td style="padding:4px 0;text-align:right;font-size:14px">${nf(TARGET_KR_PER_H)} kr/h</td>
    </tr>
    <tr>
      <td colspan="2" style="padding:12px 0 0;color:#666;font-size:12px">${nf(d.forraVeckan.rev)} kr på ${d.forraVeckan.tim.toFixed(1)} timmar (förra veckan)</td>
    </tr>
  </table>

  <h2 style="font-family:Georgia,serif;font-size:18px;margin:28px 0 8px">🔻 Prisjustering — bottom 3 abonnemang</h2>
  <p style="color:#666;font-size:13px;margin:0 0 10px">Potential om de 10 lägsta höjs till 400 kr/h: <strong>+${nf(d.potentialKrPerMan)} kr/mån</strong></p>
  ${d.bottom3.length > 0 ? `
  <table style="width:100%;background:white;border:1px solid #eae4d9;border-radius:12px;overflow:hidden;border-collapse:collapse;margin-bottom:20px">
    ${bottomRader}
  </table>` : `<p style="color:#059669;font-weight:500">Alla abonnemang ligger över 400 kr/h — bra!</p>`}

  <h2 style="font-family:Georgia,serif;font-size:18px;margin:28px 0 8px">⏰ Timmar-varningar nästa 7 dagar</h2>
  ${d.antalVarningarTotal === 0 ? `<p style="color:#059669;font-weight:500">Alla schemalagda pass nästa vecka ligger över ${WARN_THRESHOLD} kr/h — bra!</p>` : `
  <p style="color:#666;font-size:13px;margin:0 0 10px">
    <strong>${d.antalVarningarTotal} missioner</strong> med effektivt pris &lt; ${WARN_THRESHOLD} kr/h.
    Totalt &quot;fattas&quot; <strong>${nf(d.varningarTotal)} kr</strong> jämfört med målnivå.
    Rätta i Timewave — ta bort städare, korta pass eller höj avtalspriset.
  </p>
  <table style="width:100%;background:#fef2f2;border:1px solid #fecaca;border-radius:12px;overflow:hidden;border-collapse:collapse;margin-bottom:20px">
    <thead>
      <tr style="background:#fee2e2;color:#991b1b;font-size:10px;text-transform:uppercase;letter-spacing:.1em">
        <th style="padding:8px 10px;text-align:left">Datum</th>
        <th style="padding:8px 10px;text-align:left">Kund / tjänst</th>
        <th style="padding:8px 10px;text-align:right">Städare × tim</th>
        <th style="padding:8px 10px;text-align:right">Pris</th>
        <th style="padding:8px 10px;text-align:right">kr/h</th>
        <th style="padding:8px 10px;text-align:right">Fattas</th>
      </tr>
    </thead>
    <tbody>${varningRader}</tbody>
  </table>`}

  <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:12px;padding:16px;margin-top:28px">
    <p style="margin:0;color:#166534;font-size:14px"><strong>📈 Prognos:</strong> Om bottom-10-avtalen höjs till 400 kr/h skulle 4-veckors-snittet lyftas från ${nf(d.fyraVeckor.snitt)} kr/h till <strong>${nf(d.prognosLyft)} kr/h</strong>.</p>
  </div>

  <p style="color:#999;font-size:11px;margin-top:32px;text-align:center">
    Automatisk rapport från Head Office · måndagar kl 07:00<br>
    Byt mottagare: ändra <code>SNITTPRIS_EMAIL_TO</code> i Vercel-env
  </p>
</div>
  `;
}
