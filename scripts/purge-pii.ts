/**
 * PII-rensning över alla system.
 *
 * Målpersoner:
 *   - nubiafabian9@gmail.com
 *   - tobias.purkin@hotmail.com   (+ telefon 0707878510)
 *   - alla @kleer.se
 *
 * Kör:
 *   bun run scripts/purge-pii.ts                → DRY-RUN (visar bara vad som skulle raderas)
 *   bun run scripts/purge-pii.ts --confirm      → SKARP körning (radera)
 *
 * System:
 *   1. Neon Postgres (head-of / Prisma)
 *   2. Convex (stodona-bokningsmodul)
 *   3. Timewave (employees + clients)
 *   4. Fortnox   (kräver FORTNOX_ACCESS_TOKEN)
 *   5. Resend    (kräver RESEND_API_KEY — audiences + contacts)
 *
 * Skickar en samlad rapport per system i slutet.
 */
import 'dotenv/config';
import { getPrisma } from '../api/_lib/prisma.js';

// ─── Konstanter ─────────────────────────────────────────────────────────
const TARGET_EMAILS = [
  'nubiafabian9@gmail.com',
  'tobias.purkin@hotmail.com',
  'charlotta.lund21@gmail.com',
].map((e) => e.toLowerCase());

const TARGET_DOMAIN = '@kleer.se';
const TARGET_PHONE_DIGITS = '707878510';

const DRY = !process.argv.includes('--confirm');

const log = (label: string, msg: any) => {
  console.log(`[${label}] ${typeof msg === 'string' ? msg : JSON.stringify(msg, null, 2)}`);
};
const banner = (title: string) => {
  console.log('\n' + '━'.repeat(60));
  console.log(title);
  console.log('━'.repeat(60));
};

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

// ═══════════════════════════════════════════════════════════════════════
// 1. NEON POSTGRES (head-of Prisma)
// ═══════════════════════════════════════════════════════════════════════
async function purgePostgres() {
  banner('NEON POSTGRES (head-of)');
  const prisma = getPrisma();
  const summary: Record<string, { matched: number; deleted?: number; error?: string; samples?: any[] }> = {};

  try {
    // ─── Employee ───
    const emps = await prisma.employee.findMany({
      where: {
        OR: [
          { email: { in: TARGET_EMAILS, mode: 'insensitive' } },
          { email: { endsWith: TARGET_DOMAIN, mode: 'insensitive' } },
        ],
      },
      select: { id: true, name: true, email: true, phone: true, timewaveId: true },
    });
    // Även telefon-matchning (fritext, kan ha bindestreck etc)
    const empsByPhone = await prisma.employee.findMany({
      where: { phone: { not: null } },
      select: { id: true, name: true, email: true, phone: true, timewaveId: true },
    });
    const empsByPhoneMatched = empsByPhone.filter((e) => phoneMatches(e.phone));
    const empAll = [...emps, ...empsByPhoneMatched.filter((p) => !emps.find((e) => e.id === p.id))];
    summary.Employee = { matched: empAll.length, samples: empAll.slice(0, 10) };
    if (!DRY && empAll.length > 0) {
      // Null-out istället för delete (Employee refereras av många FK)
      const r = await prisma.employee.updateMany({
        where: { id: { in: empAll.map((e) => e.id) } },
        data: { email: null, phone: null, personalNumber: null },
      });
      summary.Employee.deleted = r.count;
    }

    // ─── Client ───
    const clis = await prisma.client.findMany({
      where: {
        OR: [
          { email: { in: TARGET_EMAILS, mode: 'insensitive' } },
          { email: { endsWith: TARGET_DOMAIN, mode: 'insensitive' } },
        ],
      },
      select: { id: true, name: true, email: true, phone: true, timewaveId: true },
    });
    const clisByPhone = await prisma.client.findMany({
      where: { phone: { not: null } },
      select: { id: true, name: true, email: true, phone: true, timewaveId: true },
    });
    const clisByPhoneMatched = clisByPhone.filter((c) => phoneMatches(c.phone));
    const cliAll = [...clis, ...clisByPhoneMatched.filter((p) => !clis.find((c) => c.id === p.id))];
    summary.Client = { matched: cliAll.length, samples: cliAll.slice(0, 10) };
    if (!DRY && cliAll.length > 0) {
      const r = await prisma.client.updateMany({
        where: { id: { in: cliAll.map((c) => c.id) } },
        data: { email: null, phone: null, personalNumber: null },
      });
      summary.Client.deleted = r.count;
    }

    // ─── ContractPerson ───
    const cps = await prisma.contractPerson.findMany({
      where: {
        OR: [
          { email: { in: TARGET_EMAILS, mode: 'insensitive' } },
          { email: { endsWith: TARGET_DOMAIN, mode: 'insensitive' } },
        ],
      },
    });
    const cpByPhone = await prisma.contractPerson.findMany({ where: { phone: { not: null } } });
    const cpByPhoneMatched = cpByPhone.filter((c) => phoneMatches(c.phone));
    const cpAll = [...cps, ...cpByPhoneMatched.filter((p) => !cps.find((c) => c.id === p.id))];
    summary.ContractPerson = { matched: cpAll.length, samples: cpAll.slice(0, 10) };
    if (!DRY && cpAll.length > 0) {
      const r = await prisma.contractPerson.deleteMany({ where: { id: { in: cpAll.map((c) => c.id) } } });
      summary.ContractPerson.deleted = r.count;
    }

    // ─── Signer ───
    const signers = await prisma.signer.findMany({
      where: {
        OR: [
          { email: { in: TARGET_EMAILS, mode: 'insensitive' } },
          { email: { endsWith: TARGET_DOMAIN, mode: 'insensitive' } },
        ],
      },
    });
    summary.Signer = { matched: signers.length, samples: signers.slice(0, 10) };
    if (!DRY && signers.length > 0) {
      const r = await prisma.signer.updateMany({
        where: { id: { in: signers.map((s) => s.id) } },
        data: { email: '[raderad]' },
      });
      summary.Signer.deleted = r.count;
    }

    // ─── OwnCompany (signatoryEmail) ───
    const oc = await prisma.ownCompany.findMany({
      where: {
        OR: [
          { signatoryEmail: { in: TARGET_EMAILS, mode: 'insensitive' } },
          { signatoryEmail: { endsWith: TARGET_DOMAIN, mode: 'insensitive' } },
        ],
      },
    });
    summary.OwnCompany = { matched: oc.length, samples: oc.slice(0, 10) };
    if (!DRY && oc.length > 0) {
      const r = await prisma.ownCompany.updateMany({
        where: { id: { in: oc.map((o) => o.id) } },
        data: { signatoryEmail: null },
      });
      summary.OwnCompany.deleted = r.count;
    }

    // ─── ContractReminder (recipientEmails = comma-separated) ───
    const rems = await prisma.contractReminder.findMany({});
    const bad = rems.filter((r) => {
      const emails = (r.recipientEmails || '').split(',').map((e) => e.trim());
      return emails.some((e) => emailMatches(e));
    });
    summary.ContractReminder = { matched: bad.length, samples: bad.slice(0, 5) };
    if (!DRY && bad.length > 0) {
      let count = 0;
      for (const r of bad) {
        const cleaned = (r.recipientEmails || '')
          .split(',')
          .map((e) => e.trim())
          .filter((e) => !emailMatches(e))
          .join(', ');
        await prisma.contractReminder.update({
          where: { id: r.id },
          data: { recipientEmails: cleaned },
        });
        count++;
      }
      summary.ContractReminder.deleted = count;
    }

    // ─── Newsletter recipient-lists (JSON i blocks / recipientEmails) ───
    // Newsletters är utskicks-utkast; om mottagarens id refererar borttagen
    // Employee/Client är det redan hanterat via null-out ovan. Skippas här.
  } catch (e: any) {
    log('postgres-error', e?.message);
    summary._error = { matched: 0, error: e?.message };
  }

  console.table(
    Object.entries(summary).map(([table, s]) => ({
      table,
      matched: s.matched,
      [DRY ? 'would_delete' : 'deleted']: DRY ? s.matched : (s.deleted ?? 0),
      error: s.error || '',
    })),
  );
  for (const [table, s] of Object.entries(summary)) {
    if (s.samples && s.samples.length > 0) {
      console.log(`\n  ${table} samples:`);
      for (const row of s.samples) console.log('    ', JSON.stringify(row));
    }
  }
  return summary;
}

// ═══════════════════════════════════════════════════════════════════════
// 2. CONVEX (bokis)
// ═══════════════════════════════════════════════════════════════════════
async function purgeConvex() {
  banner('CONVEX (stodona-bokningsmodul)');
  const url = process.env.BOKIS_CONVEX_URL || 'https://glorious-gerbil-763.convex.cloud';
  const secret = process.env.BOKIS_CONVEX_ADMIN_SECRET || process.env.CONVEX_ADMIN_SECRET;
  if (!secret) {
    log('convex', 'HOPPAR — CONVEX_ADMIN_SECRET saknas i env');
    return { skipped: true };
  }

  const summary: Record<string, any> = {};

  // Anropa den nya purge-mutation vi (strax) lägger till i convex/adminData.ts.
  // Om den inte finns → kör tabell för tabell via HTTP-query mot listBookings/listCustomers.

  // Steg A: listBookings + listCustomers via HTTP
  async function convexQuery(path: string, args: any = {}) {
    const r = await fetch(`${url.replace(/\/$/, '')}/api/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path, args: { secret, ...args }, format: 'json' }),
    });
    if (!r.ok) throw new Error(`Convex ${path} ${r.status}`);
    const data = await r.json();
    if (data.status === 'error') throw new Error(data.errorMessage);
    return data.value || data;
  }
  async function convexMutation(path: string, args: any = {}) {
    const r = await fetch(`${url.replace(/\/$/, '')}/api/mutation`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path, args: { secret, ...args }, format: 'json' }),
    });
    if (!r.ok) throw new Error(`Convex ${path} ${r.status}`);
    const data = await r.json();
    if (data.status === 'error') throw new Error(data.errorMessage);
    return data.value || data;
  }

  try {
    // Bookings
    const bookings = await convexQuery('adminData:listBookings');
    const matchB = (Array.isArray(bookings) ? bookings : []).filter(
      (b: any) => emailMatches(b.email) || emailMatches(b.customerEmail) || phoneMatches(b.phone) || phoneMatches(b.customerPhone),
    );
    summary.bookings = { matched: matchB.length, samples: matchB.slice(0, 5).map((b: any) => ({ id: b.id, name: b.customerName, email: b.customerEmail || b.email, phone: b.customerPhone || b.phone })) };
    // Ta bort kräver ny mutation — hoppas den finns
    if (!DRY && matchB.length > 0) {
      try {
        const del = await convexMutation('adminData:purgePii', {
          emails: [...TARGET_EMAILS],
          domainSuffix: TARGET_DOMAIN,
          phoneDigits: TARGET_PHONE_DIGITS,
        });
        summary.bookings.deleted = del?.bookings ?? 0;
        Object.assign(summary, del || {});
      } catch (e: any) {
        summary.bookings.error = `purgePii-mutation saknas: ${e?.message} — kör 'convex deploy' med den nya mutation-koden först.`;
      }
    }

    // Customers
    try {
      const customers = await convexQuery('adminData:listCustomers');
      const matchC = (Array.isArray(customers) ? customers : []).filter(
        (c: any) => emailMatches(c.email) || phoneMatches(c.phone),
      );
      summary.customers = { matched: matchC.length, samples: matchC.slice(0, 5) };
    } catch (e: any) {
      summary.customers = { matched: 0, error: e?.message };
    }
  } catch (e: any) {
    summary._error = e?.message;
  }
  console.table(
    Object.entries(summary).filter(([k]) => !k.startsWith('_')).map(([table, s]: any) => ({
      table,
      matched: s.matched ?? '?',
      [DRY ? 'would_delete' : 'deleted']: DRY ? (s.matched ?? '?') : (s.deleted ?? '?'),
      error: s.error || '',
    })),
  );
  for (const [table, s] of Object.entries(summary) as any) {
    if (s?.samples?.length) {
      console.log(`\n  ${table} samples:`);
      for (const row of s.samples) console.log('    ', JSON.stringify(row));
    }
  }
  return summary;
}

// ═══════════════════════════════════════════════════════════════════════
// 3. TIMEWAVE
// ═══════════════════════════════════════════════════════════════════════
async function purgeTimewave() {
  banner('TIMEWAVE');
  const clientId = process.env.TIMEWAVE_CLIENT_ID;
  const apiKey = process.env.TIMEWAVE_API_KEY;
  if (!clientId || !apiKey) {
    log('timewave', 'HOPPAR — TIMEWAVE_CLIENT_ID/API_KEY saknas');
    return { skipped: true };
  }

  const base = `https://cleaning.timewaveapp.com/api/v2/${clientId}`;
  async function tw(path: string, opts: any = {}) {
    return fetch(`${base}${path}`, {
      ...opts,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
        ...(opts.headers || {}),
      },
    });
  }

  const summary: any = {};

  // Fetcha alla employees + clients (paginerat)
  async function fetchAll(path: string) {
    const rows: any[] = [];
    let page = 1;
    while (true) {
      const r = await tw(`${path}?page[number]=${page}&page[size]=500`);
      if (!r.ok) break;
      const j = await r.json();
      const chunk = j?.data || [];
      rows.push(...chunk);
      if (!j?.last_page || page >= j.last_page || chunk.length === 0) break;
      page++;
      if (page > 40) break; // safety
    }
    return rows;
  }

  try {
    const employees = await fetchAll('/employees');
    const clients = await fetchAll('/clients');

    const empMatch = employees.filter(
      (e: any) => emailMatches(e.email) || phoneMatches(e.phone) || phoneMatches(e.mobile),
    );
    const cliMatch = clients.filter((c: any) => {
      if (emailMatches(c.email)) return true;
      if (phoneMatches(c.phone) || phoneMatches(c.mobile)) return true;
      const contacts = c.contacts || [];
      return contacts.some((ct: any) => emailMatches(ct.email) || phoneMatches(ct.phone) || phoneMatches(ct.mobile));
    });

    summary.employees = { matched: empMatch.length, samples: empMatch.slice(0, 5).map((e: any) => ({ id: e.id, first: e.first_name, last: e.last_name, email: e.email, phone: e.phone })) };
    summary.clients = { matched: cliMatch.length, samples: cliMatch.slice(0, 5).map((c: any) => ({ id: c.id, name: c.companyname || `${c.first_name || ''} ${c.last_name || ''}`.trim(), email: c.email, phone: c.phone })) };

    if (!DRY) {
      // Timewave stödjer inte alltid DELETE — PATCH:a bort PII istället.
      let empDone = 0, cliDone = 0, empErr = 0, cliErr = 0;
      for (const e of empMatch) {
        const r = await tw(`/employees/${e.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ data: { type: 'employees', id: String(e.id), attributes: { email: '', phone: '', mobile: '' } } }),
        });
        if (r.ok) empDone++; else empErr++;
      }
      for (const c of cliMatch) {
        const r = await tw(`/clients/${c.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ data: { type: 'clients', id: String(c.id), attributes: { email: '', phone: '', mobile: '' } } }),
        });
        if (r.ok) cliDone++; else cliErr++;
      }
      summary.employees.deleted = empDone;
      summary.employees.errors = empErr;
      summary.clients.deleted = cliDone;
      summary.clients.errors = cliErr;
    }
  } catch (e: any) {
    summary._error = e?.message;
  }

  console.table(
    Object.entries(summary).filter(([k]) => !k.startsWith('_')).map(([table, s]: any) => ({
      table,
      matched: s.matched,
      [DRY ? 'would_patch' : 'patched']: DRY ? s.matched : (s.deleted ?? '?'),
      errors: s.errors || 0,
    })),
  );
  for (const [table, s] of Object.entries(summary) as any) {
    if (s?.samples?.length) {
      console.log(`\n  ${table} samples:`);
      for (const row of s.samples) console.log('    ', JSON.stringify(row));
    }
  }
  return summary;
}

// ═══════════════════════════════════════════════════════════════════════
// 4. FORTNOX
// ═══════════════════════════════════════════════════════════════════════
async function purgeFortnox() {
  banner('FORTNOX');
  const token = process.env.FORTNOX_ACCESS_TOKEN;
  const clientSecret = process.env.FORTNOX_CLIENT_SECRET;
  if (!token) {
    log('fortnox', 'HOPPAR — FORTNOX_ACCESS_TOKEN saknas lokalt. Kör detta från Vercel eller lägg till nyckeln i .env');
    return { skipped: true };
  }

  const summary: any = {};
  async function fx(path: string) {
    return fetch(`https://api.fortnox.se/3${path}`, {
      headers: {
        'Access-Token': token,
        ...(clientSecret ? { 'Client-Secret': clientSecret } : {}),
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
    });
  }

  try {
    const r = await fx('/customers?limit=500');
    if (!r.ok) throw new Error(`GET customers ${r.status}`);
    const j = await r.json();
    const customers = j?.Customers || [];
    const matched = customers.filter((c: any) => emailMatches(c.Email) || phoneMatches(c.Phone1) || phoneMatches(c.Phone2));
    summary.customers = { matched: matched.length, samples: matched.slice(0, 5).map((c: any) => ({ CustomerNumber: c.CustomerNumber, Name: c.Name, Email: c.Email, Phone1: c.Phone1 })) };
    if (!DRY && matched.length > 0) {
      let ok = 0, err = 0;
      for (const c of matched) {
        const put = await fetch(`https://api.fortnox.se/3/customers/${c.CustomerNumber}`, {
          method: 'PUT',
          headers: {
            'Access-Token': token,
            ...(clientSecret ? { 'Client-Secret': clientSecret } : {}),
            Accept: 'application/json',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ Customer: { CustomerNumber: c.CustomerNumber, Email: '', Phone1: '', Phone2: '' } }),
        });
        if (put.ok) ok++; else err++;
      }
      summary.customers.deleted = ok;
      summary.customers.errors = err;
    }
  } catch (e: any) {
    summary._error = e?.message;
  }
  console.table(
    Object.entries(summary).filter(([k]) => !k.startsWith('_')).map(([t, s]: any) => ({ table: t, matched: s.matched, [DRY ? 'would_patch' : 'patched']: DRY ? s.matched : (s.deleted ?? '?'), errors: s.errors || 0 })),
  );
  return summary;
}

// ═══════════════════════════════════════════════════════════════════════
// 5. RESEND — audiences + contacts
// ═══════════════════════════════════════════════════════════════════════
async function purgeResend() {
  banner('RESEND');
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    log('resend', 'HOPPAR — RESEND_API_KEY saknas lokalt');
    return { skipped: true };
  }

  const summary: any = { audiences: {}, contacts: [] };
  async function rs(path: string, opts: any = {}) {
    return fetch(`https://api.resend.com${path}`, {
      ...opts,
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', ...(opts.headers || {}) },
    });
  }

  try {
    const audRes = await rs('/audiences');
    if (!audRes.ok) throw new Error(`GET audiences ${audRes.status}`);
    const audJ = await audRes.json();
    const auds = audJ?.data || [];
    let totalMatched = 0;
    let totalDeleted = 0;
    for (const a of auds) {
      const cRes = await rs(`/audiences/${a.id}/contacts`);
      if (!cRes.ok) continue;
      const cJ = await cRes.json();
      const contacts = cJ?.data || [];
      const matched = contacts.filter((c: any) => emailMatches(c.email));
      summary.audiences[a.name || a.id] = { matched: matched.length, samples: matched.slice(0, 3).map((c: any) => ({ id: c.id, email: c.email })) };
      totalMatched += matched.length;
      if (!DRY && matched.length > 0) {
        for (const c of matched) {
          const del = await rs(`/audiences/${a.id}/contacts/${c.id}`, { method: 'DELETE' });
          if (del.ok) totalDeleted++;
        }
      }
    }
    summary.totalMatched = totalMatched;
    summary.totalDeleted = totalDeleted;
  } catch (e: any) {
    summary._error = e?.message;
  }
  console.log(JSON.stringify(summary, null, 2));
  return summary;
}

// ═══════════════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════════════
(async () => {
  console.log('\n██ PII PURGE ██');
  console.log(`Mål-emails: ${TARGET_EMAILS.join(', ')}`);
  console.log(`Mål-domän:  ${TARGET_DOMAIN}`);
  console.log(`Mål-telefon: ${TARGET_PHONE_DIGITS}`);
  console.log(`Läge: ${DRY ? 'DRY-RUN (visar bara, ändrar inget)' : 'SKARP KÖRNING'}`);

  const pg = await purgePostgres();
  const cv = await purgeConvex();
  const tw = await purgeTimewave();
  const fx = await purgeFortnox();
  const rs = await purgeResend();

  banner('SAMMANFATTNING');
  console.log(JSON.stringify({ postgres: pg, convex: cv, timewave: tw, fortnox: fx, resend: rs }, null, 2));
})();
