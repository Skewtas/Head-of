import type { VercelRequest, VercelResponse } from '@vercel/node';
import { filterAllowedEmails, debugSuppression } from '../_lib/suppressionList.js';
import { requireInternalAuth } from '../_lib/internalAuth.js';

/**
 * Central spärr-gate för ALLA system som skickar mail i Stodona-stacken.
 *
 * Marketing-appen skickar sina nyhetsbrev via sin egen Resend-integration och
 * passerar därför aldrig head-ofs deliverNewsletter(). Utan den här endpointen
 * har den ingen aning om HARD_BLOCK eller om avregistreringar som ännu inte
 * hunnit spegla sig i /api/newsletter/customers.
 *
 * POST { emails: string[] } → { allowed: string[], blocked: string[] }
 * GET  ?debug=1             → hela spärrlistan (för felsökning)
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!(await requireInternalAuth(req, res))) return;

  if (req.method === 'GET') {
    if (req.query.debug !== '1') {
      return res.status(400).json({ error: 'Använd POST { emails: [...] }, eller ?debug=1' });
    }
    return res.json(await debugSuppression());
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { emails } = (req.body || {}) as { emails?: unknown };
  if (!Array.isArray(emails)) {
    return res.status(400).json({ error: 'emails[] krävs' });
  }
  if (emails.length > 20000) {
    return res.status(413).json({ error: 'Max 20000 adresser per anrop' });
  }

  try {
    const normalized = emails.map((e) => String(e || '').toLowerCase().trim());
    const unique = [...new Set(normalized)].filter((e) => e.includes('@'));
    const allowed = await filterAllowedEmails(unique);
    const allowedSet = new Set(allowed);
    const blocked = unique.filter((e) => !allowedSet.has(e));

    return res.json({
      allowed,
      blocked,
      inputCount: emails.length,
      uniqueCount: unique.length,
      allowedCount: allowed.length,
      blockedCount: blocked.length,
    });
  } catch (err: any) {
    console.error('[suppression]', err);
    return res.status(500).json({ error: err?.message || 'Suppression-check failade' });
  }
}
