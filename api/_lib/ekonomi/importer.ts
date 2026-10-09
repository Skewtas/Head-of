/**
 * Import av ett räkenskapsår (ren logik, ingen databas/nätverk).
 *
 * Varje import ersätter bilden av ett helt räkenskapsår i ett bolag med
 * det Fortnox levererar just nu. Nyckeln (bolag, räkenskapsår, serie,
 * nummer) gör upprepade importer idempotenta: samma fil två gånger ger
 * exakt samma data och inga ändringsposter. Rättelser, makuleringar och
 * efterregistreringar i tidigare perioder fångas som ändringsposter.
 *
 * En import som inte klarar valideringen kastar ImportError och lämnar
 * befintlig data orörd.
 */
import { hashVoucher } from './checks.js';
import type { SieFile } from './sie.js';
import { COMPANIES, type CompanyData, type CompanyId, type Voucher, type YearBalances } from './types.js';

export class ImportError extends Error {}

export interface FiscalYearImport {
  companyId: CompanyId;
  fyId: number;
  from: string;
  to: string;
  sie: SieFile;
  /** Periodsaldon från separat SIE typ 2-uttag, om hämtat. */
  psaldo?: Record<string, Record<string, number>>;
  apiUb?: Record<string, number>;
  /** Referenser från /3/vouchers: "serie|nummer" → koppling till faktura m.m. */
  voucherRefs?: Map<string, { refType?: string; refNumber?: string }>;
  apiVoucherCount?: number;
  importedAt: string;
}

export interface VoucherChange {
  companyId: CompanyId;
  fyId: number;
  series: string;
  number: number;
  type: 'ny' | 'andrad' | 'borttagen';
  /** Verifikationsdatum efter ändringen (eller före, för borttagna). */
  date: string;
  previousDate?: string;
  /** Nettoförändring per konto i öre. */
  delta: Record<string, number>;
  detectedAt: string;
}

const digits = (s: string | null) => (s ?? '').replace(/\D/g, '');

export function validateImport(imp: FiscalYearImport): void {
  const expected = COMPANIES[imp.companyId];
  if (digits(imp.sie.orgNumber) !== digits(expected.orgNumber)) {
    throw new ImportError(`Fel bolag: filen avser org.nr ${imp.sie.orgNumber ?? '(saknas)'} men ${expected.name} har ${expected.orgNumber}. Importen avbröts.`);
  }
  const rar = imp.sie.fiscalYears[0];
  if (!rar || rar.from !== imp.from || rar.to !== imp.to) {
    throw new ImportError(`Filens räkenskapsår (${rar?.from ?? '?'}–${rar?.to ?? '?'}) stämmer inte med det begärda (${imp.from}–${imp.to}).`);
  }
  if (imp.sie.warnings.length) throw new ImportError(`Ofullständig eller trasig SIE-fil: ${imp.sie.warnings.join('; ')}`);
  const seen = new Set<string>();
  for (const v of imp.sie.vouchers) {
    const k = `${v.series}|${v.number}`;
    if (seen.has(k)) throw new ImportError(`Verifikation ${v.series}${v.number} förekommer två gånger i filen.`);
    seen.add(k);
  }
}

export function toVouchers(imp: FiscalYearImport): Voucher[] {
  return imp.sie.vouchers.map((sv) => {
    const ref = imp.voucherRefs?.get(`${sv.series}|${sv.number}`);
    const v: Voucher = { companyId: imp.companyId, fyId: imp.fyId, series: sv.series, number: sv.number, date: sv.date, text: sv.text, rows: sv.rows };
    if (ref?.refType) v.refType = ref.refType;
    if (ref?.refNumber) v.refNumber = ref.refNumber;
    v.hash = hashVoucher(v);
    return v;
  });
}

function rowTotals(v: Voucher | undefined): Record<string, number> {
  const t: Record<string, number> = {};
  for (const r of v?.rows ?? []) t[r.account] = (t[r.account] ?? 0) + r.amount;
  return t;
}

export function diffVouchers(existing: Voucher[], incoming: Voucher[], detectedAt: string): VoucherChange[] {
  const key = (v: Voucher) => `${v.series}|${v.number}`;
  const old = new Map(existing.map((v) => [key(v), v]));
  const changes: VoucherChange[] = [];
  const delta = (before: Voucher | undefined, after: Voucher | undefined) => {
    const a = rowTotals(before);
    const b = rowTotals(after);
    const d: Record<string, number> = {};
    for (const acc of new Set([...Object.keys(a), ...Object.keys(b)])) {
      const diff = (b[acc] ?? 0) - (a[acc] ?? 0);
      if (diff !== 0) d[acc] = diff;
    }
    return d;
  };
  for (const v of incoming) {
    const prev = old.get(key(v));
    old.delete(key(v));
    const base = { companyId: v.companyId, fyId: v.fyId, series: v.series, number: v.number, detectedAt };
    if (!prev) changes.push({ ...base, type: 'ny', date: v.date, delta: delta(undefined, v) });
    else if ((prev.hash ?? hashVoucher(prev)) !== v.hash) changes.push({ ...base, type: 'andrad', date: v.date, previousDate: prev.date, delta: delta(prev, v) });
  }
  for (const prev of old.values()) {
    changes.push({ companyId: prev.companyId, fyId: prev.fyId, series: prev.series, number: prev.number, type: 'borttagen', date: prev.date, delta: delta(prev, undefined), detectedAt });
  }
  return changes;
}

export function toYearBalances(imp: FiscalYearImport): YearBalances {
  const psaldo = imp.psaldo ?? (Object.keys(imp.sie.psaldo).length ? imp.sie.psaldo : undefined);
  const yb: YearBalances = { fyId: imp.fyId, ib: imp.sie.ib, ub: imp.sie.ub, res: imp.sie.res };
  if (psaldo) yb.psaldo = psaldo;
  if (imp.apiUb) yb.apiUb = imp.apiUb;
  if (imp.apiVoucherCount !== undefined) yb.apiVoucherCount = imp.apiVoucherCount;
  return yb;
}

/**
 * Applicera en import på ett bolags data i minnet. Returnerar NY data —
 * originalet ändras inte. `changes` är tom vid allra första importen av
 * ett räkenskapsår (då är allt nytt per definition).
 */
export function applyFiscalYearImport(c: CompanyData, imp: FiscalYearImport): { company: CompanyData; changes: VoucherChange[] } {
  if (c.id !== imp.companyId) throw new ImportError('Importen avser ett annat bolag.');
  validateImport(imp);
  const incoming = toVouchers(imp);
  const existing = c.vouchers.filter((v) => v.fyId === imp.fyId);
  const prevYear = c.fiscalYears.find((fy) => fy.fyId === imp.fyId);
  const isInitial = !prevYear?.importedAt;
  const changes = isInitial ? [] : diffVouchers(existing, incoming, imp.importedAt);

  const accounts = { ...c.accounts };
  for (const [number, a] of Object.entries(imp.sie.accounts)) {
    accounts[number] = { number, name: a.name, sieType: a.sieType, firstSeenAt: accounts[number]?.firstSeenAt ?? imp.importedAt };
  }
  // Konton som används i verifikationer men saknas i kontoplanen ska ändå synas.
  for (const v of incoming) for (const r of v.rows) accounts[r.account] ??= { number: r.account, name: '(saknas i kontoplanen)', firstSeenAt: imp.importedAt };

  const fiscalYears = [...c.fiscalYears.filter((fy) => fy.fyId !== imp.fyId), { fyId: imp.fyId, from: imp.from, to: imp.to, importedAt: imp.importedAt }].sort((a, b) => a.from.localeCompare(b.from));
  return {
    company: {
      ...c,
      accounts,
      fiscalYears,
      vouchers: [...c.vouchers.filter((v) => v.fyId !== imp.fyId), ...incoming],
      balances: { ...c.balances, [imp.fyId]: toYearBalances(imp) },
    },
    changes,
  };
}

export function emptyCompany(id: CompanyId): CompanyData {
  return { id, fiscalYears: [], accounts: {}, vouchers: [], balances: {}, ledger: [], sync: { lastAttemptAt: null, lastSuccessAt: null, lastError: null, lockedUntil: null } };
}
