/**
 * Fortnox-anslutning för ekonomiuppföljningen — en separat anslutning per bolag.
 *
 * SKRIVSKYDD: Fortnox scopes ger alltid både läs- och skrivrätt (det finns
 * inga rena läs-scopes). Skrivskyddet upprätthålls därför här: modulen
 * exponerar ENDAST GET-anrop mot api.fortnox.se. Det finns ingen funktion
 * som kan skapa verifikationer, ändra bokföring eller göra betalningar.
 *
 * Verifierat mot Fortnox officiella dokumentation 2026-10-02:
 *  - OAuth2 authorization code: apps.fortnox.se/oauth-v1/{auth,token}
 *  - Anropsgräns: 25 anrop per 5 sekunder per klient-id och bolag (HTTP 429)
 *  - Scope bookkeeping: konton, räkenskapsår, SIE, verifikationer
 *  - Scope settings: låst period. Scope companyinformation: org.nr.
 */
import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { prisma } from '../prisma.js';
import { COMPANIES, type CompanyId } from './types.js';

const AUTH_URL = 'https://apps.fortnox.se/oauth-v1/auth';
const TOKEN_URL = 'https://apps.fortnox.se/oauth-v1/token';
const API_BASE = 'https://api.fortnox.se/3';

/** Scopes som begärs. Löne- och tidsdata (salary, timereporting) begärs INTE — se docs/ekonomi/README.md. */
export const SCOPES = ['bookkeeping', 'companyinformation', 'invoice', 'supplierinvoice', 'settings'];

export class FortnoxError extends Error {
  constructor(message: string, public status?: number) {
    super(message);
  }
}

export function envStatus() {
  return {
    clientId: !!process.env.FORTNOX_EKONOMI_CLIENT_ID,
    clientSecret: !!process.env.FORTNOX_EKONOMI_CLIENT_SECRET,
    tokenKey: !!process.env.EKONOMI_TOKEN_KEY,
    appUrl: !!process.env.APP_URL,
  };
}

function credentials() {
  const id = process.env.FORTNOX_EKONOMI_CLIENT_ID;
  const secret = process.env.FORTNOX_EKONOMI_CLIENT_SECRET;
  if (!id || !secret) throw new FortnoxError('FORTNOX_EKONOMI_CLIENT_ID / FORTNOX_EKONOMI_CLIENT_SECRET saknas i miljön.');
  return { id, secret };
}

function key(): Buffer {
  const raw = process.env.EKONOMI_TOKEN_KEY;
  if (!raw) throw new FortnoxError('EKONOMI_TOKEN_KEY saknas i miljön (32 byte, base64).');
  const buf = Buffer.from(raw, 'base64');
  if (buf.length !== 32) throw new FortnoxError('EKONOMI_TOKEN_KEY måste vara 32 byte base64-kodat.');
  return buf;
}

interface Tokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

function encrypt(tokens: Tokens): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const data = Buffer.concat([cipher.update(JSON.stringify(tokens), 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), data].map((b) => b.toString('base64')).join('.');
}

function decrypt(enc: string): Tokens {
  const [iv, tag, data] = enc.split('.').map((s) => Buffer.from(s, 'base64'));
  const decipher = createDecipheriv('aes-256-gcm', key(), iv);
  decipher.setAuthTag(tag);
  return JSON.parse(Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8'));
}

// ── OAuth ───────────────────────────────────────────────────────────────────

function redirectUri(): string {
  const base = process.env.APP_URL;
  if (!base) throw new FortnoxError('APP_URL saknas i miljön.');
  return `${base.replace(/\/$/, '')}/api/ekonomi/fortnox/callback`;
}

/** Signerat state: binder svaret till ett visst bolag och en viss användare, giltigt i 10 minuter. */
export function signState(companyId: CompanyId, userId: string): string {
  const payload = Buffer.from(JSON.stringify({ c: companyId, u: userId, e: Date.now() + 600_000, n: randomBytes(8).toString('hex') })).toString('base64url');
  return `${payload}.${createHmac('sha256', key()).update(payload).digest('base64url')}`;
}

export function verifyState(state: string, userId: string): CompanyId {
  const [payload, sig] = state.split('.');
  const expected = createHmac('sha256', key()).update(payload ?? '').digest();
  const given = Buffer.from(sig ?? '', 'base64url');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) throw new FortnoxError('Ogiltigt state.');
  const p = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  if (p.e < Date.now()) throw new FortnoxError('Anslutningsförsöket har gått ut. Försök igen.');
  if (p.u !== userId) throw new FortnoxError('Anslutningen påbörjades av en annan användare.');
  if (!(p.c in COMPANIES)) throw new FortnoxError('Okänt bolag.');
  return p.c;
}

export function authUrl(companyId: CompanyId, userId: string): string {
  const params = new URLSearchParams({
    client_id: credentials().id,
    redirect_uri: redirectUri(),
    scope: SCOPES.join(' '),
    state: signState(companyId, userId),
    access_type: 'offline',
    response_type: 'code',
  });
  // Servicekonto (rekommenderas av Fortnox för integrationer) kräver att det är aktiverat för appen.
  if (process.env.FORTNOX_EKONOMI_ACCOUNT_TYPE === 'service') params.set('account_type', 'service');
  return `${AUTH_URL}?${params}`;
}

async function tokenRequest(body: Record<string, string>): Promise<Tokens> {
  const { id, secret } = credentials();
  const resp = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}` },
    body: new URLSearchParams(body).toString(),
    signal: AbortSignal.timeout(30_000),
  });
  if (!resp.ok) throw new FortnoxError(`Fortnox nekade token (${resp.status}). Anslutningen kan behöva göras om.`, resp.status);
  const d: any = await resp.json();
  return { accessToken: d.access_token, refreshToken: d.refresh_token, expiresAt: Date.now() + (d.expires_in - 120) * 1000 };
}

async function rawGet(accessToken: string, path: string): Promise<Response> {
  return fetch(`${API_BASE}${path}`, { method: 'GET', headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' }, signal: AbortSignal.timeout(45_000) });
}

const digits = (s: string | null | undefined) => (s ?? '').replace(/\D/g, '');

/**
 * Slutför anslutningen. Kontrollerar att det Fortnox-bolag användaren valde
 * verkligen har det organisationsnummer vi förväntar oss — annars sparas
 * ingenting. Det hindrar att bolagen förväxlas.
 */
export async function completeConnection(companyId: CompanyId, code: string, userId: string) {
  const tokens = await tokenRequest({ grant_type: 'authorization_code', code, redirect_uri: redirectUri() });
  const resp = await rawGet(tokens.accessToken, '/companyinformation');
  if (!resp.ok) throw new FortnoxError(`Kunde inte läsa företagsuppgifter från Fortnox (${resp.status}).`, resp.status);
  const info = ((await resp.json()) as any).CompanyInformation ?? {};
  const expected = COMPANIES[companyId];
  if (digits(info.OrganizationNumber) !== digits(expected.orgNumber)) {
    throw new FortnoxError(`Fel bolag valt i Fortnox: "${info.CompanyName}" (${info.OrganizationNumber}) — förväntade ${expected.name} (${expected.orgNumber}). Ingenting sparades.`);
  }
  const data = { tokenEnc: encrypt(tokens), scopes: SCOPES.join(' '), fortnoxName: String(info.CompanyName ?? ''), fortnoxOrgNumber: String(info.OrganizationNumber ?? ''), connectedAt: new Date(), connectedBy: userId, lastError: null };
  await prisma.finConnection.upsert({ where: { companyId }, create: { companyId, ...data }, update: data });
  return { companyName: data.fortnoxName, orgNumber: data.fortnoxOrgNumber };
}

export async function disconnect(companyId: CompanyId) {
  await prisma.finConnection.updateMany({ where: { companyId }, data: { tokenEnc: null } });
}

/**
 * Hämta giltig access token. Fortnox refresh tokens är engångs och byts vid
 * varje förnyelse, så förnyelsen görs under radlås — två samtidiga körningar
 * kan annars göra varandras token ogiltiga.
 */
async function accessToken(companyId: CompanyId, forceRefresh = false): Promise<string> {
  return prisma.$transaction(
    async (tx) => {
      const rows = await tx.$queryRaw<{ token_enc: string | null }[]>`SELECT token_enc FROM fin_connections WHERE company_id = ${companyId} FOR UPDATE`;
      const enc = rows[0]?.token_enc;
      if (!enc) throw new FortnoxError(`${COMPANIES[companyId].name} är inte anslutet till Fortnox.`);
      const tokens = decrypt(enc);
      if (!forceRefresh && Date.now() < tokens.expiresAt) return tokens.accessToken;
      const fresh = await tokenRequest({ grant_type: 'refresh_token', refresh_token: tokens.refreshToken });
      await tx.finConnection.update({ where: { companyId }, data: { tokenEnc: encrypt(fresh) } });
      return fresh.accessToken;
    },
    { timeout: 40_000, maxWait: 20_000 }
  );
}

// ── Läsande anrop ───────────────────────────────────────────────────────────

const lastCall: Record<string, number> = {};
const MIN_SPACING_MS = 220; // ≈ 4,5 anrop/s — under Fortnox gräns på 25 anrop per 5 s
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function request(companyId: CompanyId, path: string): Promise<Response> {
  let token = await accessToken(companyId);
  let refreshed = false;
  for (let attempt = 1; ; attempt++) {
    const wait = (lastCall[companyId] ?? 0) + MIN_SPACING_MS - Date.now();
    if (wait > 0) await sleep(wait);
    lastCall[companyId] = Date.now();
    let resp: Response;
    try {
      resp = await rawGet(token, path);
    } catch (err: any) {
      if (attempt >= 4) throw new FortnoxError(`Nätverksfel mot Fortnox: ${err?.message ?? err}`);
      await sleep(1000 * 2 ** attempt);
      continue;
    }
    if (resp.ok) return resp;
    if (resp.status === 401 && !refreshed) {
      refreshed = true;
      token = await accessToken(companyId, true);
      continue;
    }
    if ((resp.status === 429 || resp.status >= 500) && attempt < 5) {
      const retryAfter = Number(resp.headers.get('retry-after'));
      await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 1000 * 2 ** attempt);
      continue;
    }
    const body = (await resp.text()).slice(0, 300);
    const hint = resp.status === 403 ? ' (saknad behörighet/scope eller licens i Fortnox)' : '';
    throw new FortnoxError(`Fortnox svarade ${resp.status}${hint} på ${path.split('?')[0]}: ${body}`, resp.status);
  }
}

function withQuery(path: string, query: Record<string, string | number | undefined>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) if (v !== undefined) q.set(k, String(v));
  const s = q.toString();
  return s ? `${path}?${s}` : path;
}

export async function fortnoxGet(companyId: CompanyId, path: string, query: Record<string, string | number | undefined> = {}): Promise<any> {
  return (await request(companyId, withQuery(path, query))).json();
}

/**
 * Hämta en hel lista med paginering. Kontrollerar att antalet hämtade
 * poster stämmer med vad Fortnox uppger — annars kastas fel hellre än att
 * en ofullständig lista används.
 */
export async function fortnoxList<T = any>(companyId: CompanyId, path: string, listKey: string, query: Record<string, string | number | undefined> = {}): Promise<T[]> {
  const out: T[] = [];
  let total: number | null = null;
  for (let page = 1; ; page++) {
    const data = await fortnoxGet(companyId, path, { ...query, limit: 500, page });
    const items: T[] = data?.[listKey] ?? [];
    out.push(...items);
    const meta = data?.MetaInformation ?? {};
    total = Number(meta['@TotalResources'] ?? out.length);
    const pages = Number(meta['@TotalPages'] ?? 1);
    if (page >= pages || items.length === 0) break;
    if (page > 2000) throw new FortnoxError(`Orimligt många sidor från ${path}.`);
  }
  if (total !== null && out.length !== total) throw new FortnoxError(`Ofullständig lista från ${path}: ${out.length} av ${total} poster. Listan ändrades troligen under hämtningen — försök igen.`);
  return out;
}

/** Hämta SIE-fil (typ 4 = verifikationer, typ 2 = periodsaldon) för ett räkenskapsår. */
export async function fortnoxSie(companyId: CompanyId, type: 2 | 4, fyId: number): Promise<Uint8Array> {
  const resp = await request(companyId, withQuery(`/sie/${type}`, { financialyear: fyId, financialYear: fyId }));
  return new Uint8Array(await resp.arrayBuffer());
}
