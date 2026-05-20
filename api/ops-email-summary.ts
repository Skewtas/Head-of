/**
 * Sends a snapshot of VECKOUPPFÖLJNING (Goals + Pipeline + Actions +
 * Personliga tasks) as an HTML email. Triggered manually or by Vercel Cron.
 *
 * Recipients: env OPS_SUMMARY_EMAILS (comma-separated). Defaults below.
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { prisma } from './_lib/prisma.js';

const DEFAULT_RECIPIENTS = ['mikaela.wigert@stodona.se'];

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).send('Method Not Allowed');
  }
  if (process.env.CRON_SECRET) {
    const auth = req.headers.authorization || '';
    if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
  }

  const recipients = (process.env.OPS_SUMMARY_EMAILS || DEFAULT_RECIPIENTS.join(','))
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
  // Only include monthly goals whose period covers TODAY, plus all weekly goals.
  const now = new Date();
  const monthGoals = goals.filter((g) => {
    if (g.periodType !== 'MONTH') return false;
    const ps = new Date(g.periodStart);
    const pe = new Date(g.periodEnd);
    return ps <= now && now <= pe;
  });
  const weekGoals = goals.filter((g) => g.periodType === 'WEEK');

  const pipeline = tasks.filter((t) => t.section === 'PIPELINE');
  const actions = tasks.filter((t) => t.section === 'ACTION');
  const personal = tasks.filter((t) => t.section === 'PERSONAL');

  const personalByOwner = new Map<string, any[]>();
  for (const t of personal) {
    const k = t.owner || 'Övriga';
    if (!personalByOwner.has(k)) personalByOwner.set(k, []);
    personalByOwner.get(k)!.push(t);
  }

  const goalTable = (items: any[], title: string): string => {
    if (items.length === 0) return '';
    const grouped = new Map<string, any[]>();
    for (const g of items) {
      const k = String(g.periodStart).slice(0, 10);
      if (!grouped.has(k)) grouped.set(k, []);
      grouped.get(k)!.push(g);
    }
    const sections = Array.from(grouped.entries())
      .sort(([a], [b]) => (a < b ? 1 : -1))
      .map(([periodStart, list]) => {
        const periodLabel = new Date(periodStart).toLocaleDateString('sv-SE', {
          month: 'long',
          year: 'numeric',
        });
        const rows = list
          .sort((a, b) => a.sortOrder - b.sortOrder)
          .map((g) => {
            const actual = g.actualOverride;
            const target = g.targetValue;
            const remaining = actual != null ? Math.max(0, target - actual) : null;
            const unit = g.unit || '';
            return `
              <tr>
                <td style="padding:8px 12px;border-top:1px solid #f0ebe0;color:#1a1a2e;">${escapeHtml(g.metricLabel)}</td>
                <td style="padding:8px 12px;border-top:1px solid #f0ebe0;text-align:right;color:#1a1a2e;font-weight:600;">${fmtNum(target)} ${escapeHtml(unit)}</td>
                <td style="padding:8px 12px;border-top:1px solid #f0ebe0;text-align:right;color:#666;">${actual != null ? `${fmtNum(actual)} ${escapeHtml(unit)}` : '—'}</td>
                <td style="padding:8px 12px;border-top:1px solid #f0ebe0;text-align:right;color:#c97c46;font-weight:600;">${remaining != null ? `${fmtNum(remaining)} ${escapeHtml(unit)}` : '—'}</td>
              </tr>`;
          })
          .join('');
        return `
          <div style="margin-top:12px;">
            <div style="font-size:13px;color:#666;margin-bottom:6px;">${escapeHtml(periodLabel)}</div>
            <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #eae4d9;border-radius:10px;border-collapse:separate;overflow:hidden;">
              <tr style="background:#faf8f5;">
                <th style="text-align:left;padding:8px 12px;font-size:11px;text-transform:uppercase;color:#999;letter-spacing:0.5px;">Mål</th>
                <th style="text-align:right;padding:8px 12px;font-size:11px;text-transform:uppercase;color:#999;letter-spacing:0.5px;">Mål-värde</th>
                <th style="text-align:right;padding:8px 12px;font-size:11px;text-transform:uppercase;color:#999;letter-spacing:0.5px;">Utfall</th>
                <th style="text-align:right;padding:8px 12px;font-size:11px;text-transform:uppercase;color:#999;letter-spacing:0.5px;">Kvar</th>
              </tr>
              ${rows}
            </table>
          </div>`;
      })
      .join('');
    return `<h2 style="margin:24px 0 8px;font-size:18px;color:#1a1a2e;">${escapeHtml(title)}</h2>${sections}`;
  };

  const taskTable = (items: any[], title: string, showOwner: boolean): string => {
    if (items.length === 0) {
      return `<h2 style="margin:24px 0 8px;font-size:18px;color:#1a1a2e;">${escapeHtml(title)}</h2><p style="color:#999;font-style:italic;font-size:13px;">Inget att rapportera.</p>`;
    }
    const rows = items
      .map((t) => {
        const statusColor: Record<string, string> = {
          OPEN: '#666',
          IN_PROGRESS: '#1e6fb3',
          WAITING: '#b37b1e',
          DONE: '#1d8a3e',
          CANCELLED: '#999',
        };
        return `
          <tr>
            ${showOwner ? `<td style="padding:8px 12px;border-top:1px solid #f0ebe0;color:#666;font-size:12px;">${escapeHtml(t.owner || '')}</td>` : ''}
            <td style="padding:8px 12px;border-top:1px solid #f0ebe0;color:#1a1a2e;">
              <div style="font-weight:600;">${escapeHtml(t.title)}</div>
              ${t.relatedTo ? `<div style="font-size:11px;color:#999;">↳ ${escapeHtml(t.relatedTo)}</div>` : ''}
              ${t.nextStep ? `<div style="font-size:12px;color:#555;margin-top:4px;">${escapeHtml(t.nextStep)}</div>` : ''}
            </td>
            <td style="padding:8px 12px;border-top:1px solid #f0ebe0;text-align:right;color:${statusColor[t.status] || '#666'};font-size:11px;text-transform:uppercase;letter-spacing:0.5px;">${escapeHtml(t.status)}</td>
            <td style="padding:8px 12px;border-top:1px solid #f0ebe0;text-align:right;color:#666;font-size:12px;white-space:nowrap;">${
              t.deadline
                ? new Date(t.deadline).toLocaleDateString('sv-SE', { day: 'numeric', month: 'short' })
                : '—'
            }</td>
          </tr>`;
      })
      .join('');
    return `
      <h2 style="margin:24px 0 8px;font-size:18px;color:#1a1a2e;">${escapeHtml(title)}</h2>
      <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #eae4d9;border-radius:10px;border-collapse:separate;overflow:hidden;">
        <tr style="background:#faf8f5;">
          ${showOwner ? '<th style="text-align:left;padding:8px 12px;font-size:11px;text-transform:uppercase;color:#999;letter-spacing:0.5px;">Person</th>' : ''}
          <th style="text-align:left;padding:8px 12px;font-size:11px;text-transform:uppercase;color:#999;letter-spacing:0.5px;">Uppgift</th>
          <th style="text-align:right;padding:8px 12px;font-size:11px;text-transform:uppercase;color:#999;letter-spacing:0.5px;">Status</th>
          <th style="text-align:right;padding:8px 12px;font-size:11px;text-transform:uppercase;color:#999;letter-spacing:0.5px;">Deadline</th>
        </tr>
        ${rows}
      </table>`;
  };

  return `<!DOCTYPE html><html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width"/>
<link rel="preconnect" href="https://fonts.googleapis.com"/>
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin/>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=Playfair+Display:ital,wght@0,400..900;1,400..900&display=swap" rel="stylesheet"/>
<style>
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=Playfair+Display:ital,wght@0,400..900;1,400..900&display=swap');
body, p, a, span, td, li, th { font-family: 'Inter', 'Helvetica Neue', Arial, sans-serif !important; }
h1, h2, h3 { font-family: 'Playfair Display', Georgia, serif !important; }
</style></head>
<body style="margin:0;padding:0;background:#f5f3ef;font-family:'Inter','Helvetica Neue',Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f3ef;padding:24px 0;">
  <tr><td align="center">
    <table width="700" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.06);">
      <tr><td style="padding:32px 32px 0;text-align:center;">
        <img src="${process.env.APP_URL || 'https://head-of.vercel.app'}/logotyp1.png" alt="Stodona" style="height:42px;width:auto;display:inline-block;margin-bottom:18px;" />
        <h1 style="margin:0;font-size:26px;font-weight:400;color:#1a1a2e;">Veckouppföljning</h1>
        <p style="margin:6px 0 0;color:#999;font-size:13px;">Snapshot från HeadOf — ${escapeHtml(new Date().toLocaleString('sv-SE'))}</p>
      </td></tr>
      <tr><td style="padding:8px 32px 32px;">
        ${goalTable(monthGoals, 'Månadsmål — ' + new Date().toLocaleDateString('sv-SE', { month: 'long', year: 'numeric' }))}
        ${goalTable(weekGoals, 'Veckomål')}
        ${taskTable(pipeline, 'Pipeline — kunder & anställda', false)}
        ${taskTable(actions, 'Actionlista', false)}
        ${taskTable(personal, 'Personliga tasks', true)}
        <p style="margin:32px 0 0;text-align:center;">
          <a href="${process.env.APP_URL || 'https://head-of.vercel.app'}" style="display:inline-block;padding:12px 28px;background:#1a1a2e;color:#fff;border-radius:10px;text-decoration:none;font-weight:600;font-size:13px;letter-spacing:0.5px;">Öppna HeadOf →</a>
        </p>
      </td></tr>
      <tr><td style="padding:18px 32px;background:#faf8f5;border-top:1px solid #eae4d9;text-align:center;">
        <p style="margin:0;font-size:12px;color:#999;">Skickad automatiskt från HeadOf.</p>
        <p style="margin:4px 0 0;font-size:11px;color:#bbb;">© ${new Date().getFullYear()} Stodona AB</p>
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>`;
}
