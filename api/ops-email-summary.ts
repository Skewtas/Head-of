/**
 * Sends a snapshot of VECKOUPPFÖLJNING (Goals + Pipeline + Actions +
 * Personliga tasks) as an HTML email. Triggered manually or by Vercel Cron.
 *
 * Recipients: env OPS_SUMMARY_EMAILS (comma-separated). Defaults below.
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { prisma } from './_lib/prisma.js';
import { signTaskDone } from './ops-task-done.js';

const DEFAULT_RECIPIENTS = [
  'mikaela.wigert@stodona.se',
  'info@stodona.se',
  'tenita@stodona.se',
  'elvedina@stodona.se',
];

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).send('Method Not Allowed');
  }

  // ?to=<email> tillåter test-send till en enskild whitelistad adress
  // utan CRON_SECRET (så man kan trycka på URL:en från en browser).
  // Cron-body-utan-?to kräver alltid secret.
  const toOverride = typeof req.query.to === 'string' ? req.query.to.trim().toLowerCase() : null;
  const allowedTestRecipients = new Set(DEFAULT_RECIPIENTS.map((r) => r.toLowerCase()));
  const isWhitelistedTest = toOverride && allowedTestRecipients.has(toOverride);

  if (process.env.CRON_SECRET && !isWhitelistedTest) {
    const auth = req.headers.authorization || '';
    if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
  }

  const recipients = toOverride
    ? [toOverride]
    : (process.env.OPS_SUMMARY_EMAILS || DEFAULT_RECIPIENTS.join(','))
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);

  const [goals, tasks] = await Promise.all([
    prisma.opsGoal.findMany({
      orderBy: [{ periodType: 'asc' }, { periodStart: 'desc' }, { sortOrder: 'asc' }],
    }),
    prisma.opsTask.findMany({
      where: { deletedAt: null },
      orderBy: [{ section: 'asc' }, { status: 'asc' }, { createdAt: 'desc' }],
    }),
  ]);

  const fromAddress = process.env.SMTP_FROM || process.env.SMTP_USER || 'info@stodona.se';
  const subject = `HeadOf — Veckouppföljning ${new Date().toLocaleDateString('sv-SE', {
    weekday: 'short',
    day: 'numeric',
    month: 'long',
  })}`;
  const html = buildHtml(goals as any[], tasks as any[]);

  // ?preview=1 returnerar HTML:en direkt så man kan inspektera mailet
  // i browsern utan att trigga något utskick.
  if (req.query.preview === '1') {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.send(html);
  }

  if (!process.env.RESEND_API_KEY) {
    return res.json({
      ok: true,
      dryRun: true,
      message: 'RESEND_API_KEY saknas — inga mail skickades.',
      recipients,
      subject,
      goalsCount: goals.length,
      tasksCount: tasks.length,
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

  res.json({ ok: failed.length === 0, subject, sent, failed, goalsCount: goals.length, tasksCount: tasks.length });
}

function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function fmtNum(v: number): string {
  return new Intl.NumberFormat('sv-SE').format(Math.round(v));
}

function buildHtml(goals: any[], tasks: any[]): string {
  const appUrl = process.env.APP_URL || 'https://head-of.vercel.app';
  const now = new Date();
  const isStale = (t: any) => {
    if (!t.deadline) return false;
    const days = (Date.now() - new Date(t.deadline).getTime()) / 86_400_000;
    return days > 30;
  };
  const isActive = (t: any) => t.status !== 'DONE' && t.status !== 'CANCELLED' && !isStale(t);

  const monthGoals = goals.filter((g) => {
    if (g.periodType !== 'MONTH') return false;
    const ps = new Date(g.periodStart);
    const pe = new Date(g.periodEnd);
    return ps <= now && now <= pe;
  });
  const weekGoals = goals.filter((g) => {
    if (g.periodType !== 'WEEK') return false;
    const ps = new Date(g.periodStart);
    const pe = new Date(g.periodEnd);
    return ps <= now && now <= pe;
  });
  const pipeline = tasks.filter((t) => t.section === 'PIPELINE' && isActive(t));
  const actions = tasks.filter((t) => t.section === 'ACTION' && isActive(t));
  const personal = tasks.filter((t) => t.section === 'PERSONAL' && isActive(t));

  // Goal-panel — matchar mockupen (progressbar + Kvar-hint)
  const goalPanel = (items: any[], title: string): string => {
    if (items.length === 0) return '';
    const rows = items
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((g) => {
        const actual = g.actualOverride ?? 0;
        const target = g.targetValue || 1;
        const pct = Math.min(100, Math.round((actual / target) * 100));
        const remaining = Math.max(0, target - actual);
        const unit = g.unit || '';
        const hasActual = g.actualOverride != null;
        return `
        <tr><td style="padding:12px 16px;border-top:1px solid #f2ede2;">
          <table width="100%" cellpadding="0" cellspacing="0"><tr>
            <td valign="top" style="padding-right:12px;">
              <div style="font-size:13.5px;font-weight:500;color:#1a1a2e;line-height:1.35;">${escapeHtml(g.metricLabel)}</div>
              <div style="height:6px;background:#f2ede2;border-radius:4px;overflow:hidden;margin-top:8px;">
                <div style="height:6px;width:${pct}%;background:#c9a96e;border-radius:4px;"></div>
              </div>
            </td>
            <td valign="top" align="right" style="white-space:nowrap;font-size:13.5px;">
              ${hasActual
                ? `<span style="font-weight:600;color:#1a1a2e;">${fmtNum(actual)}</span><span style="color:#cec7b8;margin:0 4px;">/</span><span style="color:#8b8578;">${fmtNum(target)}</span><span style="color:#8b8578;font-size:12px;margin-left:3px;">${escapeHtml(unit)}</span>
                   <div style="font-size:10.5px;color:#b45309;margin-top:3px;">Kvar: ${fmtNum(remaining)} ${escapeHtml(unit)}</div>`
                : `<span style="color:#cec7b8;font-style:italic;">utfall…</span><span style="color:#8b8578;margin:0 4px;">/</span><span style="color:#8b8578;">${fmtNum(target)}</span><span style="color:#8b8578;font-size:12px;margin-left:3px;">${escapeHtml(unit)}</span>`
              }
            </td>
          </tr></table>
        </td></tr>`;
      })
      .join('');
    return `
      <table width="100%" cellpadding="0" cellspacing="0" style="background:#fff;border:1px solid #eae4d9;border-radius:14px;margin-bottom:14px;">
        <tr><td style="padding:12px 16px;font-size:11px;text-transform:uppercase;letter-spacing:0.1em;color:#8b8578;font-weight:600;background:#faf8f3;border-bottom:1px solid #eae4d9;border-top-left-radius:14px;border-top-right-radius:14px;">${escapeHtml(title)}</td></tr>
        ${rows}
      </table>`;
  };

  // Task-row — checkbox som klar-länk + ägare-chip + färg-kodad deadline
  const taskRow = (t: any, showOwner: boolean): string => {
    const doneUrl = `${appUrl}/api/ops-task-done?id=${t.id}&token=${signTaskDone(t.id)}`;
    const dl = t.deadline ? new Date(t.deadline) : null;
    const dlLabel = dl ? formatDeadline(dl) : '';
    const dlColor = dl ? deadlineColor(dl) : '#8b8578';
    const dlWeight = dl && (dl.getTime() < now.getTime() || isSoon(dl)) ? 500 : 400;
    return `
      <tr><td style="padding:12px 16px;border-top:1px solid #f2ede2;">
        <table width="100%" cellpadding="0" cellspacing="0"><tr>
          <td width="24" valign="middle" style="padding-right:10px;">
            <a href="${doneUrl}" style="display:inline-block;width:18px;height:18px;border:1.5px solid #cec7b8;border-radius:5px;background:#fff;text-decoration:none;line-height:1;" title="Markera som klar">&nbsp;</a>
          </td>
          <td valign="middle">
            <div style="font-size:13.5px;color:#1a1a2e;line-height:1.35;">
              ${escapeHtml(t.title)}
              ${t.relatedTo ? `<span style="color:#a8a196;font-weight:400;margin-left:6px;font-size:12.5px;">· ${escapeHtml(t.relatedTo)}</span>` : ''}
            </div>
            ${t.nextStep ? `<div style="font-size:11.5px;color:#8b8578;margin-top:3px;">${escapeHtml(t.nextStep)}</div>` : ''}
          </td>
          <td valign="middle" align="right" style="white-space:nowrap;padding-left:12px;">
            ${showOwner && t.owner
              ? `<span style="display:inline-block;padding:2px 8px;background:#f5efdd;color:#4b4a55;border-radius:4px;font-size:11px;font-weight:500;margin-right:10px;">${escapeHtml(t.owner)}</span>`
              : ''}
            <span style="font-size:11.5px;color:${dlColor};font-weight:${dlWeight};font-variant-numeric:tabular-nums;">${dlLabel}</span>
          </td>
        </tr></table>
      </td></tr>`;
  };

  const taskCard = (items: any[], title: string, showOwner: boolean, groupByOwner = false): string => {
    if (items.length === 0) {
      return `
        <h2 style="margin:0 0 12px;font-family:'Playfair Display',Georgia,serif;font-size:20px;font-weight:400;color:#1a1a2e;">${escapeHtml(title)}</h2>
        <table width="100%" cellpadding="0" cellspacing="0" style="background:#fff;border:1px solid #eae4d9;border-radius:14px;margin-bottom:24px;">
          <tr><td style="padding:20px 16px;font-size:13px;color:#8b8578;font-style:italic;text-align:center;">Inget att visa.</td></tr>
        </table>`;
    }

    let body = '';
    if (groupByOwner) {
      const groups = new Map<string, any[]>();
      for (const t of items) {
        const k = t.owner || 'Övriga';
        if (!groups.has(k)) groups.set(k, []);
        groups.get(k)!.push(t);
      }
      body = Array.from(groups.entries()).map(([owner, list]) => `
        <tr><td style="padding:14px 16px 4px;font-size:11px;text-transform:uppercase;letter-spacing:0.1em;color:#8b8578;font-weight:600;border-top:1px solid #f2ede2;background:#faf8f3;">${escapeHtml(owner)}</td></tr>
        ${list.map((t) => taskRow(t, false)).join('')}
      `).join('');
    } else {
      body = items.map((t) => taskRow(t, showOwner)).join('');
    }

    return `
      <h2 style="margin:0 0 12px;font-family:'Playfair Display',Georgia,serif;font-size:20px;font-weight:400;color:#1a1a2e;">${escapeHtml(title)}</h2>
      <table width="100%" cellpadding="0" cellspacing="0" style="background:#fff;border:1px solid #eae4d9;border-radius:14px;margin-bottom:24px;">
        ${body}
      </table>`;
  };

  const monthLabel = now.toLocaleDateString('sv-SE', { month: 'long', year: 'numeric' });
  const weekNo = getIsoWeek(now);

  return `<!DOCTYPE html><html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width"/></head>
<body style="margin:0;padding:0;background:#f5f3ef;font-family:'Inter','Helvetica Neue',Arial,sans-serif;color:#1a1a2e;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f3ef;padding:28px 16px 48px;">
  <tr><td align="center">
    <table width="700" cellpadding="0" cellspacing="0" style="max-width:700px;">
      <!-- Header -->
      <tr><td style="padding:0 0 24px;">
        <img src="${appUrl}/logotyp1.png" alt="Stodona" style="height:38px;width:auto;display:block;margin-bottom:12px;" />
        <h1 style="margin:0;font-family:'Playfair Display',Georgia,serif;font-size:28px;font-weight:400;color:#1a1a2e;letter-spacing:-0.01em;">Veckouppföljning</h1>
        <p style="margin:4px 0 0;color:#8b8578;font-size:13px;">${escapeHtml(now.toLocaleDateString('sv-SE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }))} · vecka ${weekNo}</p>
      </td></tr>

      <!-- Mål -->
      <tr><td style="padding-bottom:24px;">
        <h2 style="margin:0 0 12px;font-family:'Playfair Display',Georgia,serif;font-size:20px;font-weight:400;color:#1a1a2e;">Mål</h2>
        ${goalPanel(monthGoals, `Den här månaden — ${monthLabel}`)}
        ${goalPanel(weekGoals, `Denna vecka — v. ${weekNo}`) || (monthGoals.length === 0 ? `<div style="padding:14px 16px;background:#fff;border:1px dashed #eae4d9;border-radius:10px;color:#8b8578;font-size:13px;font-style:italic;text-align:center;">Inga mål satta för perioden.</div>` : '')}
      </td></tr>

      <!-- Pipeline -->
      <tr><td>${taskCard(pipeline, 'Pipeline', true, false)}</td></tr>
      <!-- Actionlista -->
      <tr><td>${taskCard(actions, 'Actionlista', true, false)}</td></tr>
      <!-- Personliga tasks -->
      <tr><td>${taskCard(personal, 'Personliga tasks', false, true)}</td></tr>

      <!-- Footer -->
      <tr><td style="padding:8px 0 0;text-align:center;">
        <a href="${appUrl}/#ops" style="display:inline-block;padding:12px 24px;background:#1a1a2e;color:#f5f3ef;text-decoration:none;border-radius:10px;font-size:13px;font-weight:600;">Öppna Veckouppföljningen →</a>
        <p style="margin:20px 0 0;color:#8b8578;font-size:11.5px;line-height:1.5;">
          Klicka på rutan bredvid en uppgift för att markera den som klar direkt från mailet.<br>
          Skickas automatiskt måndagar 06:00. Klara + gamla (>30 dgr sen deadline) döljs.
        </p>
        <p style="margin:12px 0 0;color:#a8a196;font-size:11px;">© ${now.getFullYear()} Stodona AB</p>
      </td></tr>
    </table>
  </td></tr>
</table></body></html>`;
}

function getIsoWeek(d: Date): number {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  date.setUTCDate(date.getUTCDate() + 4 - (date.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  return Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}

function formatDeadline(d: Date): string {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(d);
  target.setHours(0, 0, 0, 0);
  const diff = Math.round((target.getTime() - today.getTime()) / 86_400_000);
  if (diff === 0) return 'idag';
  if (diff === 1) return 'imorgon';
  if (diff === -1) return 'igår';
  return d.toLocaleDateString('sv-SE', { day: 'numeric', month: 'short' });
}

function deadlineColor(d: Date): string {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(d);
  target.setHours(0, 0, 0, 0);
  const diff = Math.round((target.getTime() - today.getTime()) / 86_400_000);
  if (diff < 0) return '#a8321d'; // overdue
  if (diff <= 2) return '#a56e10'; // soon
  return '#8b8578'; // normal
}

function isSoon(d: Date): boolean {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(d);
  target.setHours(0, 0, 0, 0);
  const diff = Math.round((target.getTime() - today.getTime()) / 86_400_000);
  return diff <= 2;
}
