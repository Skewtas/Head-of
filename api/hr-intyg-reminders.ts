/**
 * Omprövningspåminnelse för aktiva förstadagsintyg.
 * Cron: 07:00 varje dag.
 *
 * Flagga när intygEndDate är:
 *   - 14 dagar bort → första förvarning (påminnelse att planera omprövning)
 *   - 3 dagar bort  → skarp påminnelse
 *   - passerat      → BESLUT UTGÅTT-notis (behöver antingen förlängas eller stängas)
 *
 * Skickas till HR (info@stodona.se + CONTRACT_SUPERADMIN_EMAILS).
 * Kräver Bearer CRON_SECRET för att köra (eller superadmin-inlogg).
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { prisma } from '../_lib/prisma.js';

export const config = { maxDuration: 60 };

const HR_NOTIFICATION_EMAILS = (
  process.env.HR_NOTIFICATION_EMAILS ||
  'info@stodona.se,mikaela.wigert@stodona.se'
)
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

function daysBetween(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / (24 * 60 * 60 * 1000));
}

function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const secret = process.env.CRON_SECRET;
  const authHdr = req.headers.authorization || '';
  const isCron = secret && authHdr === `Bearer ${secret}`;
  const isQuerySecret = secret && req.query.secret === secret;
  if (secret && !isCron && !isQuerySecret) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const now = new Date();

    // Hämta alla aktiva förstadagsintyg (EMAIL2_SENT + intygEndDate satt)
    const active = await prisma.sickLeaveCase.findMany({
      where: {
        status: 'EMAIL2_SENT',
        intygEndDate: { not: null },
      },
      orderBy: { intygEndDate: 'asc' },
      take: 200,
    });

    const buckets = {
      expired: [] as typeof active,
      urgent: [] as typeof active, // ≤3 dagar kvar
      upcoming: [] as typeof active, // 4-14 dagar kvar
    };

    for (const c of active) {
      const d = daysBetween(now, c.intygEndDate!);
      if (d < 0) buckets.expired.push(c);
      else if (d <= 3) buckets.urgent.push(c);
      else if (d <= 14) buckets.upcoming.push(c);
    }

    const anythingToReport =
      buckets.expired.length + buckets.urgent.length + buckets.upcoming.length > 0;

    if (!anythingToReport) {
      return res.json({ ok: true, sent: false, reason: 'inga påminnelser idag' });
    }

    if (!process.env.RESEND_API_KEY) {
      return res
        .status(500)
        .json({ error: 'RESEND_API_KEY saknas i env — kan inte skicka påminnelse' });
    }

    const fromAddress = process.env.SMTP_FROM || process.env.SMTP_USER || 'info@stodona.se';
    const rows = (list: typeof active, tone: string) =>
      list
        .map((c) => {
          const days = daysBetween(now, c.intygEndDate!);
          const dateStr = c.intygEndDate!.toISOString().split('T')[0];
          const daysLabel =
            days < 0
              ? `<span style="color:#b91c1c">utgick för ${Math.abs(days)} dag(ar) sedan</span>`
              : days === 0
              ? `<span style="color:#b91c1c">utgår idag</span>`
              : `${days} dag(ar) kvar`;
          return `<tr>
            <td style="padding:6px 12px;border-bottom:1px solid #eee">${escapeHtml(c.employeeName)}</td>
            <td style="padding:6px 12px;border-bottom:1px solid #eee">${dateStr}</td>
            <td style="padding:6px 12px;border-bottom:1px solid #eee;color:${tone}">${daysLabel}</td>
            <td style="padding:6px 12px;border-bottom:1px solid #eee;text-align:right"><a href="https://head-of.vercel.app/">Öppna ärende #${c.id}</a></td>
          </tr>`;
        })
        .join('');

    const sections: string[] = [];
    if (buckets.expired.length > 0) {
      sections.push(`
        <h3 style="color:#b91c1c;margin:24px 0 8px">🚨 Utgångna beslut (${buckets.expired.length})</h3>
        <p style="margin:0 0 8px;color:#555">Fatta beslut: förläng, avsluta eller omvärdera. Sjuklön får inte betalas ut mot ogiltigt intyg.</p>
        <table style="width:100%;border-collapse:collapse;font-size:14px">${rows(buckets.expired, '#b91c1c')}</table>
      `);
    }
    if (buckets.urgent.length > 0) {
      sections.push(`
        <h3 style="color:#c2410c;margin:24px 0 8px">⚠️ Snart utgår (${buckets.urgent.length})</h3>
        <p style="margin:0 0 8px;color:#555">≤3 dagar kvar. Boka omprövning nu.</p>
        <table style="width:100%;border-collapse:collapse;font-size:14px">${rows(buckets.urgent, '#c2410c')}</table>
      `);
    }
    if (buckets.upcoming.length > 0) {
      sections.push(`
        <h3 style="color:#a16207;margin:24px 0 8px">📅 Kommande omprövningar (${buckets.upcoming.length})</h3>
        <p style="margin:0 0 8px;color:#555">4-14 dagar kvar. Planera in samtal.</p>
        <table style="width:100%;border-collapse:collapse;font-size:14px">${rows(buckets.upcoming, '#a16207')}</table>
      `);
    }

    const html = `
      <div style="font-family:-apple-system,sans-serif;max-width:720px;margin:0 auto;padding:24px">
        <h2 style="margin:0 0 4px">Förstadagsintyg — omprövning</h2>
        <p style="margin:0;color:#666;font-size:13px">Daglig påminnelse · ${now.toLocaleDateString('sv-SE')}</p>
        ${sections.join('')}
        <p style="margin-top:32px;font-size:12px;color:#999">
          Skickas automatiskt varje morgon kl 07:00. Handlägg i Head Office → HR.
        </p>
      </div>
    `;

    const subject = `Förstadagsintyg — ${buckets.expired.length > 0 ? `${buckets.expired.length} utgångna` : `${buckets.urgent.length + buckets.upcoming.length} behöver omprövas`}`;

    const sent: string[] = [];
    const failed: any[] = [];
    for (const to of HR_NOTIFICATION_EMAILS) {
      try {
        const r = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            from: `"Stodona HR" <${fromAddress}>`,
            to,
            subject,
            html,
          }),
        });
        if (!r.ok) {
          const err = await r.json().catch(() => ({}));
          throw new Error((err as any).message || r.statusText);
        }
        sent.push(to);
      } catch (e: any) {
        failed.push({ email: to, error: e?.message ?? String(e) });
      }
    }

    res.json({
      ok: failed.length === 0,
      sent,
      failed,
      counts: {
        expired: buckets.expired.length,
        urgent: buckets.urgent.length,
        upcoming: buckets.upcoming.length,
      },
    });
  } catch (err: any) {
    console.error('[intyg-reminders]', err?.message);
    res.status(500).json({ error: err?.message || 'reminder failed' });
  }
}
