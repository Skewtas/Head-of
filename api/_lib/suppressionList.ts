/**
 * Central suppression-lista för att BLOCKERA utskick.
 *
 * Alla mail-/SMS-utskick (newsletter, personalbrev, kampanjer) MÅSTE
 * anropa isBlockedEmail() / isBlockedPhone() innan de skickar.
 *
 * Källor:
 *   1. HARD_BLOCK — inkodade i denna fil. Kan aldrig få utskick, oavsett
 *      vad opt-out-tabellen säger. Använd för GDPR-anmälningar, klagomål,
 *      och alla varianter av kleer.se / ihm.se (interna testadresser).
 *   2. system_optouts — DB-tabell (AutomatedTemplate) med användarnas
 *      egna avanmälningar via /api/newsletter/optout.
 *
 * Regeln är alltid: HELLRE FEL POSITIVT än att skicka till någon som
 * inte vill ha det.
 */
import { prisma } from './prisma.js';

// ─── HÅRDA BLOCK — kan aldrig får utskick ───────────────────────────────
const HARD_BLOCK_EMAILS = new Set<string>([
  'nubiafabian9@gmail.com',
  'tobias.purkin@hotmail.com',
  'charlotta.lund21@gmail.com',
  'malin.andersson120@hotmail.com',
  'elisabet.ek@ihm.se',
].map((e) => e.toLowerCase()));

const HARD_BLOCK_EMAIL_DOMAINS = ['@kleer.se', '@ihm.se'];

const HARD_BLOCK_PHONE_DIGITS = ['707878510']; // Tobias Purkin

// ─── Normalisering ──────────────────────────────────────────────────────
export function normalizeEmail(e: string | null | undefined): string {
  return (e || '').toLowerCase().trim();
}

export function normalizePhone(p: string | null | undefined): string {
  return (p || '').replace(/\D+/g, '');
}

// ─── Cache (per serverless-instans) ─────────────────────────────────────
let cache: { at: number; emails: Set<string>; phones: Set<string> } | null = null;
const CACHE_MS = 60 * 1000; // 1 min — snabb spegling av avanmälningar

async function loadOptOuts(): Promise<{ emails: Set<string>; phones: Set<string> }> {
  if (cache && Date.now() - cache.at < CACHE_MS) {
    return { emails: cache.emails, phones: cache.phones };
  }
  const doc = await prisma.automatedTemplate.findUnique({ where: { id: 'system_optouts' } });
  const data: any = (doc?.blocks as any) ?? {};
  const emails = new Set<string>((data.emails || []).map((e: string) => normalizeEmail(e)));
  const phones = new Set<string>((data.phones || []).map((p: string) => normalizePhone(p)).filter(Boolean));
  cache = { at: Date.now(), emails, phones };
  return { emails, phones };
}

// ─── Publikt API ────────────────────────────────────────────────────────
export async function isBlockedEmail(email: string | null | undefined): Promise<boolean> {
  const e = normalizeEmail(email);
  if (!e || !e.includes('@')) return false;
  if (HARD_BLOCK_EMAILS.has(e)) return true;
  if (HARD_BLOCK_EMAIL_DOMAINS.some((d) => e.endsWith(d))) return true;
  const opt = await loadOptOuts();
  return opt.emails.has(e);
}

export async function isBlockedPhone(phone: string | null | undefined): Promise<boolean> {
  const n = normalizePhone(phone);
  if (!n || n.length < 8) return false;
  if (HARD_BLOCK_PHONE_DIGITS.some((d) => n.endsWith(d) || n.includes(d))) return true;
  const opt = await loadOptOuts();
  return opt.phones.has(n) || opt.phones.has(phone || '');
}

/**
 * Filtrera en lista av emails och behåll endast tillåtna. Snabbare än
 * att kalla isBlockedEmail() N gånger eftersom vi bara läser opt-out
 * doc en enda gång.
 */
export async function filterAllowedEmails(emails: (string | null | undefined)[]): Promise<string[]> {
  const opt = await loadOptOuts();
  return emails
    .map((e) => normalizeEmail(e))
    .filter((e) => {
      if (!e || !e.includes('@')) return false;
      if (HARD_BLOCK_EMAILS.has(e)) return false;
      if (HARD_BLOCK_EMAIL_DOMAINS.some((d) => e.endsWith(d))) return false;
      if (opt.emails.has(e)) return false;
      return true;
    });
}

export async function filterAllowedPhones<T extends { phone: string }>(
  items: T[],
): Promise<{ allowed: T[]; blocked: T[] }> {
  const opt = await loadOptOuts();
  const allowed: T[] = [];
  const blocked: T[] = [];
  for (const it of items) {
    const n = normalizePhone(it.phone);
    if (!n || n.length < 8) { blocked.push(it); continue; }
    if (HARD_BLOCK_PHONE_DIGITS.some((d) => n.endsWith(d) || n.includes(d))) { blocked.push(it); continue; }
    if (opt.phones.has(n) || opt.phones.has(it.phone)) { blocked.push(it); continue; }
    allowed.push(it);
  }
  return { allowed, blocked };
}

/** För diagnostik: visa vad som är blockat just nu. */
export async function debugSuppression() {
  const opt = await loadOptOuts();
  return {
    hardBlockEmails: [...HARD_BLOCK_EMAILS],
    hardBlockDomains: HARD_BLOCK_EMAIL_DOMAINS,
    hardBlockPhoneDigits: HARD_BLOCK_PHONE_DIGITS,
    optOutEmails: [...opt.emails],
    optOutPhones: [...opt.phones],
  };
}
