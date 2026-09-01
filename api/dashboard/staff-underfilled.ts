/**
 * Fredagsmail till Ella & Mikaela — beläggningsvarning.
 *
 * Kollar alla 50/75/100 %-anställda i Timewave och listar:
 *   1) vem som ligger under kontrakterat mål (månad-hittills)
 *   2) vardagar bakåt 30 dgr som saknar både bokning OCH frånvaro
 *
 * Exkluderar personer som slutat (Tenita, Laila, Erik, Luisa) och Mikaela
 * själv. Övertids-verifiering ingår inte — kan inte automatiseras utan att
 * bli brus.
 *
 * Trigger: Vercel-cron tis+tors kl. 06:00 (vercel.json).
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getTimewaveToken, forceRefreshTimewaveToken } from '../_lib/timewaveAuth.js';
import { workHoursInMonth } from '../_lib/workHours.js';

export const config = { maxDuration: 60 };

const RECIPIENTS = ['info@stodona.se', 'mikaela.wigert@stodona.se'];
const CONTRACT_BUCKETS = new Set([50, 75, 100]);
const EXCLUDE_NAME_SUBSTRINGS = ['tenita', 'laila', 'erik näf', 'luisa fernanda', 'mikaela wigert'];
const ABSENCE_SERVICE_IDS = new Set([3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 26, 27, 28, 29, 30, 31, 34, 37, 39, 41, 42, 43, 44]);
const UNDER_THRESHOLD_PCT = 90;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).send('Method Not Allowed');
  if (process.env.CRON_SECRET) {
    const auth = req.headers.authorization || '';
    if (auth !== `Bearer ${process.env.CRON_SECRET}`) return res.status(401).json({ error: 'Unauthorized' });
  }

  const dryRun = req.query.dryRun === '1' || !process.env.RESEND_API_KEY;
  const fromAddress = process.env.SMTP_FROM || 'info@stodona.se';

  try {
    let token = await getTimewaveToken();
    const timewaveBaseUrl = 'https://api.timewave.se/v3';

    // ── Anställda ─────────────────────────────────────────────────────
    let empResp = await fetch(`${timewaveBaseUrl}/employees?page[size]=200`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    });
    if (empResp.status === 403) {
      token = await forceRefreshTimewaveToken();
      empResp = await fetch(`${timewaveBaseUrl}/employees?page[size]=200`, {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      });
    }
    const empJson = await empResp.json();
    const allEmps: any[] = empJson.data || [];

    const tracked = allEmps
      .filter((e) => !e.deleted && e.status === 'active')
      .map((e) => {
        const occupation = e.base_contract?.occupation ?? null;
        return {
          id: e.id as number,
          name: `${e.first_name || ''} ${e.last_name || ''}`.trim(),
          occupation,
        };
      })
      .filter((e) => e.occupation && CONTRACT_BUCKETS.has(e.occupation))
      .filter((e) => !EXCLUDE_NAME_SUBSTRINGS.some((s) => e.name.toLowerCase().includes(s)));

    // ── Perioder ──────────────────────────────────────────────────────
    const now = new Date();
    // Faktiska arbetstimmar för aktuell månad (vardagar minus helgdagar × 8h).
    const workHoursPerMonth = workHoursInMonth(now.getFullYear(), now.getMonth());
    const pad = (n: number) => String(n).padStart(2, '0');
    const monthStart = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-01`;
    const monthEndDate = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    const monthEnd = `${monthEndDate.getFullYear()}-${pad(monthEndDate.getMonth() + 1)}-${pad(monthEndDate.getDate())}`;
    const historyStartDate = new Date(now);
    historyStartDate.setDate(historyStartDate.getDate() - 30);
    const historyStart = `${historyStartDate.getFullYear()}-${pad(historyStartDate.getMonth() + 1)}-${pad(historyStartDate.getDate())}`;
    const todayStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;

    // Fetcha missions för hela unionen (30 dgr bakåt → månadsslut) — täcker
    // både beläggning och öppna-dagar med en enda paginering.
    const fetchStart = historyStart < monthStart ? historyStart : monthStart;
    const missions = await fetchAllMissions(fetchStart, monthEnd, token);

    // ── Aggregera per anställd ────────────────────────────────────────
    type Stats = { hours: number; workDates: Set<string>; absenceDates: Set<string> };
    const stats = new Map<number, Stats>();
    for (const e of tracked) stats.set(e.id, { hours: 0, workDates: new Set(), absenceDates: new Set() });

    for (const m of missions) {
      const services: any[] = m.services || [];
      const serviceIds = services.map((s: any) => s.service_id || s.id);
      const isAbsence = serviceIds.length > 0 && serviceIds.every((id: number) => ABSENCE_SERVICE_IDS.has(id));

      for (const emp of (m.employees || [])) {
        const empId = emp.employee_id || emp.id;
        const s = stats.get(empId);
        if (!s) continue;
        // Timewave lägger datumet PÅ skiftet (emp.startdate), inte på
        // mission-objektet. Fallback till m.startdate om det någon gång dyker upp.
        const dateRaw: string = emp.startdate || m.startdate || '';
        const date = dateRaw.split(' ')[0].split('T')[0];
        if (!date) continue;
        if (isAbsence) {
          s.absenceDates.add(date);
        } else if (!emp.cancelled) {
          s.workDates.add(date);
          if (emp.starttime && emp.endtime && date >= monthStart && date <= monthEnd) {
            const [sh, sm] = emp.starttime.split(':').map(Number);
            const [eh, em] = emp.endtime.split(':').map(Number);
            s.hours += Math.max(0, ((eh * 60 + em) - (sh * 60 + sm)) / 60);
          }
        }
      }
    }

    // ── Bygg data för mailet ──────────────────────────────────────────
    const under: {
      id: number; name: string; occupation: number; hours: number; target: number; missing: number; pct: number;
    }[] = [];
    for (const e of tracked) {
      const s = stats.get(e.id)!;
      const target = (e.occupation / 100) * workHoursPerMonth;
      const pct = Math.round((s.hours / target) * 100);
      const missing = Math.round(target - s.hours);
      if (pct < UNDER_THRESHOLD_PCT && missing > 5) {
        under.push({ id: e.id, name: e.name, occupation: e.occupation, hours: Math.round(s.hours), target, missing, pct });
      }
    }
    under.sort((a, b) => b.missing - a.missing);

    // Öppna vardagar (mån–fre) bakåt 30 dgr som saknar bokning OCH frånvaro
    const businessDays: string[] = [];
    for (let d = new Date(historyStartDate); d <= now; d.setDate(d.getDate() + 1)) {
      if (d.toISOString().slice(0, 10) >= todayStr) break;
      const dow = d.getDay();
      if (dow === 0 || dow === 6) continue;
      businessDays.push(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`);
    }

    const openDays: { id: number; name: string; occupation: number; dates: string[] }[] = [];
    for (const e of tracked) {
      const s = stats.get(e.id)!;
      const dates = businessDays.filter((d) => !s.workDates.has(d) && !s.absenceDates.has(d));
      if (dates.length > 0) openDays.push({ id: e.id, name: e.name, occupation: e.occupation, dates });
    }
    openDays.sort((a, b) => b.dates.length - a.dates.length);

    const totalMissing = under.reduce((sum, u) => sum + u.missing, 0);
    const monthLabel = now.toLocaleDateString('sv-SE', { month: 'long' });
    const week = getIsoWeek(now);
    const dateLabel = now.toLocaleDateString('sv-SE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

    const html = buildHtml({ under, openDays, totalMissing, week, dateLabel, monthLabel });
    const subject = `Beläggning · vecka ${week} — ${under.length} personer att åtgärda`;

    if (dryRun) {
      return res.json({
        ok: true, dryRun: true, subject, recipients: RECIPIENTS,
        underCount: under.length, totalMissing, openDaysCount: openDays.length,
        htmlLength: html.length,
        tracked: tracked.map((e) => ({ name: e.name, occupation: e.occupation, hours: Math.round(stats.get(e.id)!.hours), target: (e.occupation / 100) * workHoursPerMonth })),
        under: under.map(({ name, occupation, hours, target, missing, pct }) => ({ name, occupation, hours, target, missing, pct })),
        openDays: openDays.map((o) => ({ name: o.name, occupation: o.occupation, days: o.dates.length })),
        period: { monthStart, monthEnd, historyStart },
      });
    }

    const sent: string[] = [];
    const failed: { email: string; error: string }[] = [];
    for (const to of RECIPIENTS) {
      try {
        const r = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ from: `"Stodona HeadOf" <${fromAddress}>`, to, subject, html }),
        });
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).message || r.statusText);
        sent.push(to);
      } catch (e: any) {
        failed.push({ email: to, error: e?.message ?? String(e) });
      }
    }
    res.json({ ok: failed.length === 0, subject, sent, failed, underCount: under.length, totalMissing });
  } catch (err: any) {
    console.error('[staff-underfilled] failed:', err.message);
    res.status(500).json({ error: err.message });
  }
}

async function fetchAllMissions(startDate: string, endDate: string, initialToken: string): Promise<any[]> {
  const timewaveBaseUrl = 'https://api.timewave.se/v3';
  let token = initialToken;
  const urlBase = `${timewaveBaseUrl}/missions?filter[startdate]=${startDate}&filter[enddate]=${endDate}&page[size]=200`;
  const fetchPage = async (p: number, retry = true): Promise<any> => {
    let r = await fetch(`${urlBase}&page[number]=${p}`, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } });
    if (r.status === 403 && retry) { token = await forceRefreshTimewaveToken(); return fetchPage(p, false); }
    if (r.status === 429) { await new Promise((res) => setTimeout(res, 1000)); r = await fetch(`${urlBase}&page[number]=${p}`, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } }); }
    if (!r.ok) return { data: [], last_page: 0 };
    return r.json();
  };
  const first = await fetchPage(1);
  const all: any[] = [...(first.data || [])];
  const lastPage = first.last_page || 1;
  if (lastPage > 1) {
    const PAR = 4;
    for (let p = 2; p <= lastPage; p += PAR) {
      const batch: number[] = [];
      for (let i = 0; i < PAR && p + i <= lastPage; i++) batch.push(p + i);
      const results = await Promise.all(batch.map((pn) => fetchPage(pn).catch(() => ({ data: [] }))));
      results.forEach((data: any) => all.push(...(data.data || [])));
    }
  }
  return all;
}

function getIsoWeek(d: Date): number {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  date.setUTCDate(date.getUTCDate() + 4 - (date.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  return Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

function fmtSvDate(d: string): string {
  const [_, m, day] = d.split('-');
  const dow = ['sön','mån','tis','ons','tor','fre','lör'][new Date(d + 'T12:00:00').getDay()];
  return `${dow} ${parseInt(day)}/${parseInt(m)}`;
}

function actionText(u: { name: string; occupation: number; missing: number; pct: number }): string {
  if (u.pct >= 80) return `Nästan i mål — bara <b>${u.missing}h</b> kvar. Kolla om ledig dag saknas i frånvaron.`;
  if (u.missing >= 60) return `Stor lucka — <b>boka ${u.missing}h</b> eller lägg in frånvaro för perioden.`;
  return `Fyll på <b>${u.missing}h</b> eller lägg in frånvaro.`;
}

function buildHtml(opts: {
  under: { name: string; occupation: number; hours: number; target: number; missing: number; pct: number }[];
  openDays: { name: string; occupation: number; dates: string[] }[];
  totalMissing: number;
  week: number;
  dateLabel: string;
  monthLabel: string;
}): string {
  const { under, openDays, totalMissing, week, dateLabel, monthLabel } = opts;

  const personCards = under.map((u) => {
    const level = u.missing >= 40 ? 'crit' : 'less';
    const barColor = level === 'crit' ? '#a8321d' : '#c98a6f';
    const barPct = Math.min(100, Math.max(0, u.pct));
    return `
    <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #eae4d9;border-left:4px solid ${barColor};border-radius:12px;margin-bottom:14px;background:#fff;">
      <tr><td style="padding:16px 18px;">
        <table width="100%" cellpadding="0" cellspacing="0"><tr>
          <td style="font-size:16px;font-weight:600;color:#1a1a2e;">${escapeHtml(u.name)}
            <span style="display:inline-block;padding:2px 8px;border-radius:999px;font-size:11px;font-weight:600;background:#f0ebe0;color:#4b4a55;margin-left:6px;">${u.occupation} %</span>
          </td>
          <td align="right" style="font-size:14px;color:#a8321d;font-weight:600;"><span style="font-size:18px;font-weight:700;margin-right:3px;">−${u.missing}h</span>saknas</td>
        </tr></table>
        <div style="margin-top:12px;">
          <div style="display:flex;justify-content:space-between;font-size:11px;color:#8b8578;margin-bottom:4px;">
            <span>${u.hours}h bokat</span><span style="color:#4b4a55;font-weight:600;">mål ${u.target}h</span>
          </div>
          <div style="height:6px;background:#f2ede2;border-radius:4px;overflow:hidden;">
            <div style="height:100%;width:${barPct}%;background:${barColor};"></div>
          </div>
        </div>
        <div style="margin-top:12px;padding-top:12px;border-top:1px dashed #eae4d9;font-size:13.5px;color:#4b4a55;line-height:1.4;">
          <span style="font-size:10px;text-transform:uppercase;letter-spacing:0.1em;color:#a8321d;font-weight:700;margin-right:8px;">gör</span>
          ${actionText(u)}
        </div>
      </td></tr>
    </table>`;
  }).join('');

  const daysRows = openDays.map((o) => {
    const chips = o.dates.map((d) => {
      const isOld = d < new Date(Date.now() - 14 * 86400000).toISOString().slice(0, 10);
      const style = isOld
        ? 'background:#f6ebe6;border:1px solid #e8c9c1;color:#a8321d;'
        : 'background:#fbf7ee;border:1px solid #d8cfbc;color:#1a1a2e;';
      return `<span style="display:inline-block;padding:2px 7px;border-radius:6px;font-size:11.5px;margin-right:5px;margin-bottom:4px;${style}">${fmtSvDate(d)}</span>`;
    }).join('');
    return `
      <tr><td style="padding:10px 0;border-top:1px solid #f2ede2;">
        <table width="100%" cellpadding="0" cellspacing="0"><tr>
          <td width="150" valign="top" style="font-size:13px;font-weight:500;color:#1a1a2e;">
            ${escapeHtml(o.name)}<br><span style="color:#8b8578;font-size:11px;font-weight:500;">${o.occupation} %</span>
          </td>
          <td valign="top" style="font-size:12px;">${chips}</td>
          <td align="right" valign="top" style="font-size:12px;color:#8b8578;white-space:nowrap;">${o.dates.length} dgr</td>
        </tr></table>
      </td></tr>`;
  }).join('');

  return `<!DOCTYPE html><html><head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#ebe6dc;font-family:'Inter',-apple-system,'Helvetica Neue',Arial,sans-serif;color:#1a1a2e;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#ebe6dc;padding:40px 20px 60px;">
<tr><td align="center">
<table width="640" cellpadding="0" cellspacing="0" style="background:#fff;border:1px solid #eae4d9;border-radius:18px;overflow:hidden;">

  <tr><td style="padding:30px 36px 22px;background:linear-gradient(180deg,#fbf9f4 0%,#ffffff 100%);border-bottom:1px solid #eae4d9;">
    <div style="font-size:11px;letter-spacing:0.14em;text-transform:uppercase;color:#8b8578;font-weight:600;">Beläggning · vecka ${week}</div>
    <h1 style="margin:10px 0 10px;font-size:28px;font-weight:500;letter-spacing:-0.015em;line-height:1.1;">
      Hej Ella — <span style="color:#a8321d;font-weight:600;">${under.length} personer</span> behöver åtgärdas i schemat
    </h1>
    <p style="margin:0;color:#4b4a55;font-size:14px;line-height:1.5;">
      ${escapeHtml(dateLabel)}. Följande personer med 50, 75 eller 100 %-anställning ligger under sitt mål för ${monthLabel}. För var och en: antingen fyll på bokningar eller lägg in frånvaro så statistiken stämmer.
    </p>
  </td></tr>

  ${under.length === 0 ? '' : `
  <tr><td style="background:#f6ebe6;border-top:1px solid #eae4d9;border-bottom:1px solid #eae4d9;">
    <table width="100%" cellpadding="0" cellspacing="0"><tr>
      <td width="140" align="center" valign="middle" style="padding:20px 20px;border-right:1px solid #e8c9c1;">
        <div style="font-size:44px;font-weight:500;color:#a8321d;line-height:1;letter-spacing:-0.03em;">${totalMissing}h</div>
        <div style="font-size:11px;color:#a8321d;letter-spacing:0.08em;text-transform:uppercase;font-weight:600;margin-top:6px;opacity:0.75;">totalt saknas</div>
      </td>
      <td valign="middle" style="padding:18px 24px;font-size:14px;color:#1a1a2e;line-height:1.5;">
        <strong style="display:block;margin-bottom:4px;font-weight:600;font-size:15px;">Så här läser du listan nedan</strong>
        <span style="color:#4b4a55;">Varje person visar hur mycket som är bokat + mål enligt kontraktet. Rödare vänsterkant = större lucka. Under varje kort står vad du konkret ska göra.</span>
      </td>
    </tr></table>
  </td></tr>`}

  <tr><td style="padding:26px 24px 8px;">
    ${personCards || '<div style="padding:24px;text-align:center;color:#8b8578;font-style:italic;">Ingen ligger under mål just nu — allt bra!</div>'}
  </td></tr>

  ${openDays.length === 0 ? '' : `
  <tr><td style="padding:8px 24px 0;">
    <div style="padding:18px 22px;background:#faf8f3;border:1px solid #eae4d9;border-radius:12px;">
      <h3 style="margin:0 0 4px;font-size:14px;font-weight:600;">Vardagar helt utan bokning eller frånvaro <span style="color:#8b8578;font-weight:400;font-size:12px;">· 30 dgr bakåt</span></h3>
      <p style="margin:0 0 14px;color:#8b8578;font-size:12.5px;">Vardagar där personen varken har ett skift eller en frånvaropost. Retroaktiv rättning behövs — annars räknar löne- och beläggningsstatistiken fel.</p>
      <table width="100%" cellpadding="0" cellspacing="0">${daysRows}</table>
    </div>
  </td></tr>`}

  <tr><td style="padding:24px 36px 26px;background:#faf8f3;border-top:1px solid #eae4d9;margin-top:26px;">
    <a href="https://head-of.vercel.app/#overview" style="display:inline-block;padding:12px 20px;background:#1a1a2e;color:#f5f3ef;text-decoration:none;border-radius:10px;font-size:13px;font-weight:600;">Öppna Personal-vyn</a>
    <a href="https://app.timewave.se" style="display:inline-block;padding:12px 20px;background:transparent;color:#1a1a2e;text-decoration:none;border:1px solid #d8cfbc;border-radius:10px;font-size:13px;font-weight:600;margin-left:10px;">Gå till Timewave</a>
    <p style="color:#8b8578;font-size:11.5px;margin:14px 0 0;line-height:1.5;">
      Skickas tisdagar och torsdagar 06:00 när minst en person med 50, 75 eller 100 %-anställning ligger under mål eller har öppna dagar. Tenita, Laila, Erik, Luisa (slutade) och Mikaela är exkluderade.
    </p>
  </td></tr>

  <tr><td style="padding:16px 36px 22px;color:#8b8578;font-size:11.5px;text-align:center;">
    Head-of · Stodona · <b style="color:#4b4a55;font-weight:600;">info@stodona.se</b>
  </td></tr>

</table></td></tr></table></body></html>`;
}
