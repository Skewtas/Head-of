/**
 * Klick från mailet: markera task som DONE utan inloggning.
 *
 * Skyddas av HMAC-token — utan giltig token förkastas requesten så länkarna
 * i mailet inte kan gissas fram. Secret = OPS_ACTION_SECRET (fallback:
 * CRON_SECRET), som redan är satt i Vercel.
 *
 * Returnerar en enkel bekräftelsesida i Stodona-stil.
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import crypto from 'crypto';
import { prisma } from './_lib/prisma.js';

export function signTaskDone(taskId: number): string {
  const secret = process.env.OPS_ACTION_SECRET || process.env.CRON_SECRET || '';
  return crypto.createHmac('sha256', secret).update(`${taskId}:done`).digest('hex').slice(0, 16);
}

function verifyToken(taskId: number, token: string): boolean {
  const expected = signTaskDone(taskId);
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(token));
  } catch {
    return false;
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const rawId = req.query.id;
  const rawToken = req.query.token;
  const id = Number(Array.isArray(rawId) ? rawId[0] : rawId);
  const token = String(Array.isArray(rawToken) ? rawToken[0] : rawToken || '');

  if (!id || Number.isNaN(id) || !token || !verifyToken(id, token)) {
    return res.status(400).send(page('Ogiltig länk', 'Länken har manipulerats eller är för gammal.', false));
  }

  try {
    const existing = await prisma.opsTask.findUnique({ where: { id } });
    if (!existing || existing.deletedAt) {
      return res.status(404).send(page('Uppgiften finns inte', 'Den kanske togs bort från Head-of.', false));
    }
    const already = existing.status === 'DONE' || existing.status === 'CANCELLED';
    if (!already) {
      await prisma.opsTask.update({ where: { id }, data: { status: 'DONE' } });
    }
    return res.status(200).send(
      page(
        already ? 'Redan avbockad' : 'Klart!',
        `<b>${escapeHtml(existing.title)}</b> är nu markerad som klar i Head-of.`,
        true
      )
    );
  } catch (err: any) {
    console.error('[ops-task-done]', err.message);
    return res.status(500).send(page('Något gick fel', err.message, false));
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

function page(title: string, body: string, ok: boolean): string {
  const accent = ok ? '#2c9c5c' : '#a8321d';
  return `<!DOCTYPE html><html><head><meta charset="utf-8"/><title>${title} · Stodona</title>
<style>body{margin:0;padding:60px 20px;background:#f5f3ef;font-family:'Inter','Helvetica Neue',Arial,sans-serif;color:#1a1a2e;text-align:center;line-height:1.5;}
.card{max-width:400px;margin:0 auto;background:#fff;border:1px solid #eae4d9;border-radius:18px;padding:36px 32px;box-shadow:0 4px 16px rgba(0,0,0,0.04);}
.mark{width:56px;height:56px;border-radius:50%;background:${accent}20;color:${accent};font-size:32px;line-height:56px;margin:0 auto 18px;}
h1{margin:0 0 12px;font-size:24px;font-weight:500;letter-spacing:-0.01em;}
p{margin:0;color:#4b4a55;font-size:14px;}
a{display:inline-block;margin-top:24px;padding:11px 20px;background:#1a1a2e;color:#f5f3ef;text-decoration:none;border-radius:10px;font-size:13px;font-weight:600;}
</style></head><body>
<div class="card">
  <div class="mark">${ok ? '&#10003;' : '!'}</div>
  <h1>${escapeHtml(title)}</h1>
  <p>${body}</p>
  <a href="https://head-of.vercel.app/#ops">Öppna Head-of →</a>
</div></body></html>`;
}
