import type { VercelRequest, VercelResponse } from '@vercel/node';
import { timingSafeEqual } from 'node:crypto';
import { isBlockedEmail } from '../_lib/suppressionList.js';
import { sanitizeSubscriber, saveWebSubscriber } from '../_lib/webSubscribers.js';

/**
 * Tar emot nyhetsbrevsanmälningar från stodona.se.
 *
 * POST { email, name?, phone?, source?, page? }
 * Authorization: Bearer <NEWSLETTER_INGEST_TOKEN>
 *
 * Anmälan sparas i system_web_subscribers och följer sedan med i
 * /api/newsletter/customers – samma lista som både head-ofs och Marketings
 * utskick läser. Det behövs alltså ingen separat mottagare i Marketing.
 *
 * Utan NEWSLETTER_INGEST_TOKEN i miljön är mottagaren avstängd (503): den
 * får aldrig stå öppen, eftersom vem som helst då kunde fylla listan.
 * En adress på spärrlistan läggs aldrig in igen, men svaret avslöjar inte det.
 */
function tokenMatches(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const expected = process.env.NEWSLETTER_INGEST_TOKEN;
  if (!expected) {
    return res.status(503).json({ error: 'NEWSLETTER_INGEST_TOKEN saknas i miljön' });
  }
  const provided = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!tokenMatches(provided, expected)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const sub = sanitizeSubscriber((req.body || {}) as Record<string, unknown>);
  if (!sub) {
    return res.status(400).json({ error: 'Giltig e-postadress krävs' });
  }

  try {
    if (await isBlockedEmail(sub.email)) {
      return res.json({ success: true });
    }
    const { added } = await saveWebSubscriber(sub);
    return res.json({ success: true, added });
  } catch (err: any) {
    console.error('[newsletter/subscribe]', err?.message);
    return res.status(500).json({ error: 'Kunde inte spara anmälan' });
  }
}
