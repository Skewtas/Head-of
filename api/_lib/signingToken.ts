/**
 * HMAC-baserade signeringstokens för anställningsavtal.
 * Format: base64url(payload).base64url(hmac)
 * Payload: {c: contractId, s: signerId, e: expiresUnix}
 * Secret: SIGNING_SECRET (env), fallback CRON_SECRET.
 *
 * Ingen tokens sparas i DB — allt bevis ligger i själva HMAC:en.
 * Utgår efter 30 dagar som default.
 */
import crypto from 'node:crypto';

const DEFAULT_EXPIRY_DAYS = 30;

function getSecret(): string {
  const s = process.env.SIGNING_SECRET || process.env.CRON_SECRET;
  if (!s) throw new Error('SIGNING_SECRET (eller CRON_SECRET) saknas i miljön.');
  return s;
}

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlDecode(s: string): Buffer {
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

export interface SigningTokenPayload {
  c: number;   // contractId
  s: number;   // signerId
  e: number;   // expires (unix ms)
}

export function issueSigningToken(contractId: number, signerId: number, expiryDays: number = DEFAULT_EXPIRY_DAYS): string {
  const payload: SigningTokenPayload = {
    c: contractId,
    s: signerId,
    e: Date.now() + expiryDays * 86_400_000,
  };
  const p = b64url(JSON.stringify(payload));
  const sig = b64url(crypto.createHmac('sha256', getSecret()).update(p).digest());
  return `${p}.${sig}`;
}

export interface VerifiedToken {
  contractId: number;
  signerId: number;
  expiresAt: Date;
}

export function verifySigningToken(token: string): VerifiedToken | null {
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [p, sig] = parts;
  try {
    const expected = b64url(crypto.createHmac('sha256', getSecret()).update(p).digest());
    // Konstant-tids-jämförelse för att undvika timing-attacker
    if (sig.length !== expected.length) return null;
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
    const payload = JSON.parse(b64urlDecode(p).toString('utf-8')) as SigningTokenPayload;
    if (typeof payload.c !== 'number' || typeof payload.s !== 'number' || typeof payload.e !== 'number') return null;
    if (payload.e < Date.now()) return null; // utgången
    return {
      contractId: payload.c,
      signerId: payload.s,
      expiresAt: new Date(payload.e),
    };
  } catch {
    return null;
  }
}

/** SHA-256 hash av contract-innehållet — bevis att versionen inte ändrats. */
export function contentHash(content: string): string {
  return crypto.createHash('sha256').update(content, 'utf-8').digest('hex');
}
