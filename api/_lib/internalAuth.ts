/**
 * Auth för de fristående nyhetsbrevs-/automations-endpointsen under api/.
 *
 * De ligger utanför Express-appen (headofApp.ts) och får därför inte
 * clerkMiddleware. Två sätt att komma in:
 *
 *  1. Server-till-server (Marketing-appen):
 *       Authorization: Bearer <HEAD_OF_INTERNAL_SECRET>
 *  2. Head ofs egen frontend: Clerk-sessionen i __session-cookien
 *     (samma kontroll som contract-send-for-signing.ts).
 *
 * Utrullning i två steg, styrt av HEAD_OF_INTERNAL_AUTH_ENFORCE:
 *  - inte satt  → OBSERVE: anrop utan giltig auth släpps igenom men loggas
 *                 som "[internal-auth] OBSERVE would deny ...". Används tills
 *                 Marketing skickar hemligheten och loggen är tyst.
 *  - "1"        → ENFORCE: 401 utan giltig auth, 503 om hemligheten inte är
 *                 konfigurerad (fail closed).
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import crypto from 'node:crypto';

function safeEqual(a: string, b: string): boolean {
  // Hasha först så att timingSafeEqual får lika långa buffrar och längden
  // på hemligheten inte läcker.
  const ha = crypto.createHash('sha256').update(a).digest();
  const hb = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(ha, hb);
}

function getBearer(req: VercelRequest): string | null {
  const hdr = req.headers.authorization;
  const m = typeof hdr === 'string' ? hdr.match(/^Bearer\s+(.+)$/i) : null;
  return m ? m[1].trim() : null;
}

async function hasClerkSession(req: VercelRequest): Promise<boolean> {
  const cookieHdr = req.headers.cookie || '';
  const token = cookieHdr.match(/(?:^|;\s*)__session=([^;]+)/)?.[1];
  if (!token) return false;
  const secretKey = process.env.CLERK_SECRET_KEY;
  if (!secretKey) return false;
  try {
    const { verifyToken } = await import('@clerk/backend');
    const payload = await verifyToken(token, { secretKey });
    return !!(payload as any)?.sub;
  } catch {
    return false;
  }
}

/**
 * Returnerar true om anropet får fortsätta. Vid false har svaret redan
 * skickats (401/503) och handlern ska bara returnera.
 */
export async function requireInternalAuth(req: VercelRequest, res: VercelResponse): Promise<boolean> {
  const secret = (process.env.HEAD_OF_INTERNAL_SECRET || '').trim();
  const enforce = process.env.HEAD_OF_INTERNAL_AUTH_ENFORCE === '1';
  const bearer = getBearer(req);

  if (secret && bearer && safeEqual(bearer, secret)) return true;
  if (await hasClerkSession(req)) return true;

  const reason = !secret ? 'secret-not-configured' : bearer ? 'bad-secret' : 'no-credentials';

  if (!enforce) {
    const path = String(req.url || '').split('?')[0];
    console.warn(`[internal-auth] OBSERVE would deny ${req.method} ${path} (${reason})`);
    return true;
  }

  if (!secret) {
    res.status(503).json({ error: 'HEAD_OF_INTERNAL_SECRET är inte konfigurerad' });
    return false;
  }
  res.status(401).json({ error: 'Unauthorized' });
  return false;
}
