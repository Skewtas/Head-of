/**
 * PII-rensning — samlad endpoint över head-ofs system.
 *
 * Mål:
 *   - nubiafabian9@gmail.com
 *   - tobias.purkin@hotmail.com (+ telefon 707878510)
 *   - alla @kleer.se
 *
 * Systemtäckning:
 *   1. Neon Postgres (head-ofs egna tabeller)
 *   2. Timewave (employees + clients — PATCH nullar PII)
 *   3. Fortnox   (customers — PUT nullar Email/Phone)
 *   4. Resend    (alla audiences — DELETE contact)
 *
 * Bokis (Convex) hanteras separat via convex-mutationen adminData:purgePii
 * eftersom Convex-schemat inte ligger i head-of.
 *
 * Auth:
 *   - CONTRACT_SUPERADMIN_EMAILS måste innehålla inloggarens email
 *   - Query-param ?confirm=1  → SKARP körning
 *   - Utan flaggan            → DRY-RUN (visar bara vad som skulle raderas)
 *
 * Anropas via browsern som superadmin:
 *   https://head-of.vercel.app/api/admin/purge-pii             (dry)
 *   https://head-of.vercel.app/api/admin/purge-pii?confirm=1   (skarp)
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { clerkClient, verifyToken } from '@clerk/backend';
import { getPrisma } from './_lib/prisma.js';

export const config = { maxDuration: 300 };

const TARGET_EMAILS = ['nubiafabian9@gmail.com', 'tobias.purkin@hotmail.com'];
const TARGET_DOMAIN = '@kleer.se';
const TARGET_PHONE_DIGITS = '707878510';

const SUPERADMIN_EMAILS = (
  process.env.CONTRACT_SUPERADMIN_EMAILS || 'mikaela.wigert@stodona.se'
).split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);

function normalizePhone(p: string | null | undefined): string {
  return (p || '').replace(/\D+/g, '');
}
function phoneMatches(p: string | null | undefined): boolean {
  const n = normalizePhone(p);
  return n.length >= 9 && (n.endsWith(TARGET_PHONE_DIGITS) || n.includes(TARGET_PHONE_DIGITS));
}
function emailMatches(e: string | null | undefined): boolean {
  if (!e) return false;
  const el = e.toLowerCase().trim();
  if (TARGET_EMAILS.includes(el)) return true;
  if (el.endsWith(TARGET_DOMAIN)) return true;
  return false;
}

async function getUserEmail(req: VercelRequest): Promise<string | null> {
  const cookieHdr = req.headers.cookie || '';
  const sessionMatch = cookieHdr.match(/__session=([^;]+)/);
  const token = sessionMatch?.[1];
  if (!token) return null;
  const secretKey = process.env.CLERK_SECRET_KEY;
  if (!secretKey) return null;
  try {
    const payload = await verifyToken(token, { secretKey });
    const userId = (payload as any)?.sub;
    if (!userId) return null;
    const u = await clerkClient.users.getUser(userId);
    const primary = u.emailAddresses?.find((e: any) => e.id === u.primaryEmailAddressId)?.emailAddress;
    return primary?.toLowerCase() ?? null;
  } catch {
    return null;
  }
}

// ─── 1. Postgres ────────────────────────────────────────────────────────
async function purgePostgres(dry: boolean) {
  const prisma = getPrisma();
  const out: any = {};

  async function scanAndClean(
    label: string,
    fetchAll: () => Promise<any[]>,
    isMatch: (r: any) => boolean,
    clean: (ids: any[]) => Promise<number>,
  ) {
    const rows = await fetchAll();
    const matched = rows.filter(isMatch);
    out[label] = { matched: matched.length, samples: matched.slice(0, 10) };
    if (!dry && matched.length > 0) {
      out[label].cleaned = await clean(matched.map((r) => r.id));
    }
  }

  await scanAndClean(
    'Employee',
    () => prisma.employee.findMany({ select: { id: true, name: true, email: true, phone: true, timewaveId: true } }),
    (r) => emailMatches(r.email) || phoneMatches(r.phone),
    (ids) => prisma.employee.updateMany({ where: { id: { in: ids } }, data: { email: null, phone: null, personalNumber: null } }).then((r) => r.count),
  );

  await scanAndClean(
    'Client',
    () => prisma.client.findMany({ select: { id: true, name: true, email: true, phone: true, timewaveId: true } }),
    (r) => emailMatches(r.email) || phoneMatches(r.phone),
    (ids) => prisma.client.updateMany({ where: { id: { in: ids } }, data: { email: null, phone: null, personalNumber: null } }).then((r) => r.count),
  );

  await scanAndClean(
    'ContractPerson',
    () => prisma.contractPerson.findMany(),
    (r) => emailMatches(r.email) || phoneMatches(r.phone),
    (ids) => prisma.contractPerson.deleteMany({ where: { id: { in: ids } } }).then((r) => r.count),
  );

  await scanAndClean(
    'Signer',
    () => prisma.signer.findMany(),
    (r) => emailMatches(r.email),
    (ids) => prisma.signer.updateMany({ where: { id: { in: ids } }, data: { email: '[raderad]' } }).then((r) => r.count),
  );

  await scanAndClean(
    'OwnCompany',
    () => prisma.ownCompany.findMany(),
    (r) => emailMatches((r as any).signatoryEmail),
    (ids) => prisma.ownCompany.updateMany({ where: { id: { in: ids } }, data: { signatoryEmail: null } }).then((r) => r.count),
  );

  // ContractReminder — comma-separated recipient list
  const reminders = await prisma.contractReminder.findMany();
  const badReminders = reminders.filter((r: any) => {
    const list = (r.recipientEmails || '').split(',').map((e: string) => e.trim());
    return list.some((e: string) => emailMatches(e));
  });
  out.ContractReminder = { matched: badReminders.length, samples: badReminders.slice(0, 5) };
  if (!dry && badReminders.length > 0) {
    let n = 0;
    for (const r of badReminders) {
      const cleaned = ((r as any).recipientEmails || '')
        .split(',').map((e: string) => e.trim())
        .filter((e: string) => !emailMatches(e))
        .join(', ');
      await prisma.contractReminder.update({ where: { id: r.id }, data: { recipientEmails: cleaned } });
      n++;
    }
    out.ContractReminder.cleaned = n;
  }

  return out;
}

// ─── 2. Timewave ────────────────────────────────────────────────────────
async function purgeTimewave(dry: boolean) {
  const clientId = process.env.TIMEWAVE_CLIENT_ID;
  const apiKey = process.env.TIMEWAVE_API_KEY;
  if (!clientId || !apiKey) return { skipped: 'TIMEWAVE_CLIENT_ID/API_KEY saknas' };
  const base = `https://cleaning.timewaveapp.com/api/v2/${clientId}`;
  const hdr = { Authorization: `Bearer ${apiKey}`, Accept: 'application/json', 'Content-Type': 'application/json' };

  async function fetchAll(path: string) {
    const rows: any[] = [];
    let page = 1;
    while (true) {
      const r = await fetch(`${base}${path}?page[number]=${page}&page[size]=500`, { headers: hdr });
      if (!r.ok) break;
      const j = await r.json() as any;
      const chunk = j?.data || [];
      rows.push(...chunk);
      if (!j?.last_page || page >= j.last_page || chunk.length === 0) break;
      page++;
      if (page > 40) break;
    }
    return rows;
  }

  const employees = await fetchAll('/employees');
  const clients = await fetchAll('/clients');

  const empMatch = employees.filter((e) => emailMatches(e.email) || phoneMatches(e.phone) || phoneMatches(e.mobile));
  const cliMatch = clients.filter((c) => emailMatches(c.email) || phoneMatches(c.phone) || phoneMatches(c.mobile));

  const out: any = {
    employees: { matched: empMatch.length, samples: empMatch.slice(0, 5).map((e) => ({ id: e.id, name: `${e.first_name || ''} ${e.last_name || ''}`.trim(), email: e.email, phone: e.phone })) },
    clients:   { matched: cliMatch.length, samples: cliMatch.slice(0, 5).map((c) => ({ id: c.id, name: c.companyname || `${c.first_name || ''} ${c.last_name || ''}`.trim(), email: c.email, phone: c.phone })) },
  };

  if (!dry) {
    for (const kind of [
      { list: empMatch, path: '/employees', type: 'employees' },
      { list: cliMatch, path: '/clients',   type: 'clients' },
    ]) {
      let ok = 0, err = 0;
      for (const row of kind.list) {
        try {
          const r = await fetch(`${base}${kind.path}/${row.id}`, {
            method: 'PATCH',
            headers: hdr,
            body: JSON.stringify({ data: { type: kind.type, id: String(row.id), attributes: { email: '', phone: '', mobile: '' } } }),
          });
          if (r.ok) ok++; else err++;
        } catch { err++; }
      }
      out[kind.type === 'employees' ? 'employees' : 'clients'].cleaned = ok;
      out[kind.type === 'employees' ? 'employees' : 'clients'].errors = err;
    }
  }
  return out;
}

// ─── 3. Fortnox ─────────────────────────────────────────────────────────
async function purgeFortnox(dry: boolean) {
  const token = process.env.FORTNOX_ACCESS_TOKEN;
  const clientSecret = process.env.FORTNOX_CLIENT_SECRET;
  if (!token) return { skipped: 'FORTNOX_ACCESS_TOKEN saknas' };
  const hdr: any = { 'Access-Token': token, Accept: 'application/json', 'Content-Type': 'application/json' };
  if (clientSecret) hdr['Client-Secret'] = clientSecret;

  async function fxAll(path: string, listKey: string) {
    const rows: any[] = [];
    let page = 1;
    while (true) {
      const r = await fetch(`https://api.fortnox.se/3${path}?limit=500&page=${page}`, { headers: hdr });
      if (!r.ok) break;
      const j = await r.json() as any;
      const chunk = j?.[listKey] || [];
      rows.push(...chunk);
      const total = j?.MetaInformation?.['@TotalPages'] ?? 1;
      if (page >= total || chunk.length === 0) break;
      page++;
      if (page > 40) break;
    }
    return rows;
  }

  const out: any = {};

  const customers = await fxAll('/customers', 'Customers');
  const cMatch = customers.filter((c) => emailMatches(c.Email) || phoneMatches(c.Phone1) || phoneMatches(c.Phone2));
  out.customers = { matched: cMatch.length, samples: cMatch.slice(0, 5).map((c) => ({ CustomerNumber: c.CustomerNumber, Name: c.Name, Email: c.Email, Phone1: c.Phone1 })) };
  if (!dry) {
    let ok = 0, err = 0;
    for (const c of cMatch) {
      try {
        const put = await fetch(`https://api.fortnox.se/3/customers/${c.CustomerNumber}`, {
          method: 'PUT',
          headers: hdr,
          body: JSON.stringify({ Customer: { CustomerNumber: c.CustomerNumber, Email: '', EmailInvoice: '', EmailInvoiceBCC: '', EmailInvoiceCC: '', EmailOffer: '', EmailOrder: '', Phone1: '', Phone2: '' } }),
        });
        if (put.ok) ok++; else err++;
      } catch { err++; }
    }
    out.customers.cleaned = ok;
    out.customers.errors = err;
  }
  return out;
}

// ─── 4. Resend ──────────────────────────────────────────────────────────
async function purgeResend(dry: boolean) {
  const key = process.env.RESEND_API_KEY;
  if (!key) return { skipped: 'RESEND_API_KEY saknas' };
  const hdr = { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };

  const audRes = await fetch('https://api.resend.com/audiences', { headers: hdr });
  if (!audRes.ok) return { error: `GET audiences ${audRes.status}` };
  const auds = ((await audRes.json()) as any)?.data || [];
  const out: any = { audiences: {}, totalMatched: 0, totalCleaned: 0 };
  for (const a of auds) {
    const cRes = await fetch(`https://api.resend.com/audiences/${a.id}/contacts`, { headers: hdr });
    if (!cRes.ok) continue;
    const contacts = ((await cRes.json()) as any)?.data || [];
    const matched = contacts.filter((c: any) => emailMatches(c.email));
    out.audiences[a.name || a.id] = { matched: matched.length, samples: matched.slice(0, 3).map((c: any) => ({ id: c.id, email: c.email })) };
    out.totalMatched += matched.length;
    if (!dry) {
      let ok = 0;
      for (const c of matched) {
        const del = await fetch(`https://api.resend.com/audiences/${a.id}/contacts/${c.id}`, { method: 'DELETE', headers: hdr });
        if (del.ok) ok++;
      }
      out.audiences[a.name || a.id].cleaned = ok;
      out.totalCleaned += ok;
    }
  }
  return out;
}

// ─── Handler ────────────────────────────────────────────────────────────
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const email = await getUserEmail(req);
  if (!email || !SUPERADMIN_EMAILS.includes(email)) {
    return res.status(403).json({
      error: 'Endast superadmin får köra denna endpoint.',
      email: email || null,
    });
  }

  const dry = req.query.confirm !== '1';

  const started = Date.now();
  const results = {
    mode: dry ? 'DRY-RUN' : 'SKARP',
    startedAt: new Date().toISOString(),
    targetEmails: TARGET_EMAILS,
    targetDomain: TARGET_DOMAIN,
    targetPhoneDigits: TARGET_PHONE_DIGITS,
    postgres: null as any,
    timewave: null as any,
    fortnox: null as any,
    resend: null as any,
    elapsedMs: 0,
  };

  try { results.postgres = await purgePostgres(dry); } catch (e: any) { results.postgres = { error: e?.message }; }
  try { results.timewave = await purgeTimewave(dry); } catch (e: any) { results.timewave = { error: e?.message }; }
  try { results.fortnox  = await purgeFortnox(dry);  } catch (e: any) { results.fortnox  = { error: e?.message }; }
  try { results.resend   = await purgeResend(dry);   } catch (e: any) { results.resend   = { error: e?.message }; }

  results.elapsedMs = Date.now() - started;
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json(results);
}
