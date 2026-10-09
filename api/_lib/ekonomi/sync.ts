/**
 * Inhämtning från Fortnox till databasen — ett bolag och ett räkenskapsår
 * i taget. Varje räkenskapsår skrivs i en transaktion: antingen ersätts
 * hela årets bild, eller så ändras ingenting.
 *
 * Misslyckas något steg sparas felet på anslutningen (last_error) och
 * last_success_at lämnas orörd, så att rapporterna kan visa att bolagets
 * data inte är aktuell i stället för att visa en missvisande total.
 */
import { prisma } from '../prisma.js';
import { hashVoucher } from './checks.js';
import { fortnoxGet, fortnoxList, fortnoxSie } from './fortnox.js';
import { diffVouchers, toVouchers, toYearBalances, validateImport, type FiscalYearImport } from './importer.js';
import { parseOre } from './money.js';
import { parseSie } from './sie.js';
import { loadConfig } from './store.js';
import { COMPANIES, type CompanyId, type LedgerItem, type Voucher } from './types.js';

export type YearSelector = 'current' | 'previous' | 'all' | number;

const digits = (s: string | null | undefined) => (s ?? '').replace(/\D/g, '');
const today = () => new Date().toISOString().slice(0, 10);

async function syncFiscalYears(companyId: CompanyId) {
  const list = await fortnoxList<any>(companyId, '/financialyears', 'FinancialYears');
  for (const y of list) {
    const data = { fromDate: String(y.FromDate), toDate: String(y.ToDate) };
    await prisma.finFiscalYear.upsert({ where: { companyId_fyId: { companyId, fyId: Number(y.Id) } }, create: { companyId, fyId: Number(y.Id), ...data }, update: data });
  }
  return prisma.finFiscalYear.findMany({ where: { companyId }, orderBy: { fromDate: 'asc' } });
}

async function importFiscalYear(companyId: CompanyId, fy: { fyId: number; fromDate: string; toDate: string; importedAt: Date | null }) {
  const importedAt = new Date();
  const sie = parseSie(await fortnoxSie(companyId, 4, fy.fyId));

  // Periodsaldon (SIE typ 2) för månadsvis avstämning. Valfri: misslyckas den görs kontrollen bara inte.
  let psaldo: FiscalYearImport['psaldo'];
  try {
    const p = parseSie(await fortnoxSie(companyId, 2, fy.fyId)).psaldo;
    if (Object.keys(p).length) psaldo = p;
  } catch {
    psaldo = undefined;
  }

  // Oberoende kontrollkällor: verifikationslistan (antal + fakturareferenser) och kontolistan (saldon).
  const list = await fortnoxList<any>(companyId, '/vouchers', 'Vouchers', { financialyear: fy.fyId });
  const voucherRefs = new Map<string, { refType?: string; refNumber?: string }>();
  for (const v of list) if (v.ReferenceType) voucherRefs.set(`${v.VoucherSeries}|${v.VoucherNumber}`, { refType: String(v.ReferenceType), refNumber: v.ReferenceNumber != null ? String(v.ReferenceNumber) : undefined });
  const accountList = await fortnoxList<any>(companyId, '/accounts', 'Accounts', { financialyear: fy.fyId });
  const apiUb: Record<string, number> = {};
  for (const a of accountList) {
    const ub = parseOre(Number(a.BalanceCarriedForward ?? 0));
    if (ub !== 0) apiUb[String(a.Number)] = ub;
  }

  const imp: FiscalYearImport = { companyId, fyId: fy.fyId, from: fy.fromDate, to: fy.toDate, sie, psaldo, apiUb, voucherRefs, apiVoucherCount: list.length, importedAt: importedAt.toISOString() };
  validateImport(imp);
  const incoming = toVouchers(imp);

  const stats = await prisma.$transaction(
    async (tx) => {
      const existingRows = await tx.finVoucher.findMany({ where: { companyId, fyId: fy.fyId } });
      const existing: Voucher[] = existingRows.map((v) => ({ companyId, fyId: v.fyId, series: v.series, number: v.number, date: v.date, text: v.text, rows: v.rows as any, hash: v.hash }));
      const isInitial = !fy.importedAt;
      const changes = diffVouchers(existing, incoming, importedAt.toISOString());
      const byKey = new Map(incoming.map((v) => [`${v.series}|${v.number}`, v]));
      // Fakturareferenser kan tillkomma utan att verifikationen ändras — uppdatera dem också.
      const refChanged = existingRows.filter((e) => {
        const n = byKey.get(`${e.series}|${e.number}`);
        return n && n.hash === e.hash && ((n.refType ?? null) !== e.refType || (n.refNumber ?? null) !== e.refNumber);
      });
      const touch = [...changes.map((c) => ({ series: c.series, number: c.number })), ...refChanged.map((e) => ({ series: e.series, number: e.number }))];
      for (let i = 0; i < touch.length; i += 500) {
        await tx.finVoucher.deleteMany({ where: { companyId, fyId: fy.fyId, OR: touch.slice(i, i + 500) } });
      }
      const create = touch.map((t) => byKey.get(`${t.series}|${t.number}`)).filter((v): v is Voucher => !!v);
      for (let i = 0; i < create.length; i += 1000) {
        await tx.finVoucher.createMany({
          data: create.slice(i, i + 1000).map((v) => ({ companyId, fyId: v.fyId, series: v.series, number: v.number, date: v.date, text: v.text, rows: v.rows as any, hash: v.hash ?? hashVoucher(v), refType: v.refType ?? null, refNumber: v.refNumber ?? null })),
        });
      }
      if (!isInitial && changes.length) {
        await tx.finChange.createMany({ data: changes.map((c) => ({ companyId, fyId: c.fyId, series: c.series, number: c.number, type: c.type, date: c.date, previousDate: c.previousDate ?? null, delta: c.delta as any, detectedAt: importedAt })) });
      }
      const known = new Set((await tx.finAccount.findMany({ where: { companyId }, select: { number: true } })).map((a) => a.number));
      const names: Record<string, { name: string; sieType?: string }> = { ...sie.accounts };
      for (const v of incoming) for (const r of v.rows) names[r.account] ??= { name: '(saknas i kontoplanen)' };
      const fresh = Object.entries(names).filter(([n]) => !known.has(n));
      if (fresh.length) await tx.finAccount.createMany({ data: fresh.map(([number, a]) => ({ companyId, number, name: a.name, sieType: a.sieType ?? null, firstSeenAt: importedAt })) });
      for (const [number, a] of Object.entries(sie.accounts)) if (known.has(number)) await tx.finAccount.updateMany({ where: { companyId, number, NOT: { name: a.name } }, data: { name: a.name } });
      await tx.finFiscalYear.update({ where: { companyId_fyId: { companyId, fyId: fy.fyId } }, data: { importedAt, balances: toYearBalances(imp) as any } });
      return { fyId: fy.fyId, vouchers: incoming.length, initial: isInitial, changes: isInitial ? 0 : changes.length, newAccounts: fresh.length };
    },
    { timeout: 120_000, maxWait: 20_000 }
  );
  return stats;
}

const toOre = (v: unknown) => parseOre(typeof v === 'string' ? v : Number(v ?? 0));

async function syncLedger(companyId: CompanyId) {
  const cfg = await loadConfig();
  const internal = cfg.internalRules.filter((r) => r.active && r.companyId === companyId && r.type === 'counterparty' && r.counterpartyNumber);
  const items = new Map<string, LedgerItem>();
  const addCustomer = (i: any) =>
    items.set(`customer|${i.DocumentNumber}`, { companyId, kind: 'customer', docNumber: String(i.DocumentNumber), externalRef: String(i.DocumentNumber), counterpartyNumber: String(i.CustomerNumber ?? ''), counterpartyName: String(i.CustomerName ?? ''), invoiceDate: String(i.InvoiceDate ?? ''), dueDate: String(i.DueDate ?? ''), total: toOre(i.Total), balance: toOre(i.Balance), currency: String(i.Currency ?? 'SEK'), booked: !!i.Booked, cancelled: !!i.Cancelled, isCredit: Number(i.Total ?? 0) < 0 });
  const addSupplier = (i: any) =>
    items.set(`supplier|${i.GivenNumber}`, { companyId, kind: 'supplier', docNumber: String(i.GivenNumber), externalRef: String(i.InvoiceNumber ?? ''), counterpartyNumber: String(i.SupplierNumber ?? ''), counterpartyName: String(i.SupplierName ?? ''), invoiceDate: String(i.InvoiceDate ?? ''), dueDate: String(i.DueDate ?? ''), total: toOre(i.Total), balance: toOre(i.Balance), currency: String(i.Currency ?? 'SEK'), booked: !!i.Booked, cancelled: !!(i.Cancelled ?? i.Cancel), isCredit: !!i.Credit });

  for (const i of await fortnoxList<any>(companyId, '/invoices', 'Invoices', { filter: 'unpaid' })) addCustomer(i);
  for (const i of await fortnoxList<any>(companyId, '/supplierinvoices', 'SupplierInvoices', { filter: 'unpaid' })) addSupplier(i);
  // Alla fakturor mot systerbolaget (även betalda) behövs för att känna igen interna verifikationer.
  for (const r of internal) {
    if (r.ledger === 'customer') for (const i of await fortnoxList<any>(companyId, '/invoices', 'Invoices', { customernumber: r.counterpartyNumber })) addCustomer(i);
    if (r.ledger === 'supplier') for (const i of await fortnoxList<any>(companyId, '/supplierinvoices', 'SupplierInvoices', { suppliernumber: r.counterpartyNumber })) addSupplier(i);
  }
  const data = [...items.values()].map((i) => ({ ...i, total: BigInt(i.total), balance: BigInt(i.balance) }));
  await prisma.$transaction(
    async (tx) => {
      await tx.finLedgerItem.deleteMany({ where: { companyId } });
      for (let i = 0; i < data.length; i += 1000) await tx.finLedgerItem.createMany({ data: data.slice(i, i + 1000) });
      await tx.finConnection.update({ where: { companyId }, data: { ledgerSyncedAt: new Date() } });
    },
    { timeout: 60_000, maxWait: 20_000 }
  );
  return { ledgerItems: data.length };
}

export interface SyncResult {
  companyId: CompanyId;
  ok: boolean;
  error?: string;
  years: unknown[];
  ledger?: { ledgerItems: number };
  /** Räkenskapsår som återstår att importera (vid years = 'all' importeras ett i taget). */
  remaining: number[];
}

export async function syncCompany(companyId: CompanyId, years: YearSelector = 'current', opts: { ledger?: boolean } = {}): Promise<SyncResult> {
  const started = new Date();
  const run = await prisma.finImportRun.create({ data: { companyId, status: 'running' } });
  await prisma.finConnection.updateMany({ where: { companyId }, data: { lastAttemptAt: started } });
  const result: SyncResult = { companyId, ok: false, years: [], remaining: [] };
  try {
    // Bolagsidentitet kontrolleras vid varje körning, inte bara vid anslutning.
    const info = (await fortnoxGet(companyId, '/companyinformation')).CompanyInformation ?? {};
    if (digits(info.OrganizationNumber) !== digits(COMPANIES[companyId].orgNumber)) throw new Error(`Anslutningen pekar på fel bolag (${info.OrganizationNumber}).`);

    const fys = await syncFiscalYears(companyId);
    const now = today();
    const currentIdx = fys.findIndex((y) => y.fromDate <= now && now <= y.toDate);
    let selected = fys.filter((y) => {
      if (years === 'all') return !y.importedAt;
      if (years === 'current') return fys.indexOf(y) === currentIdx;
      if (years === 'previous') return currentIdx > 0 && fys.indexOf(y) === currentIdx - 1;
      return y.fyId === years;
    });
    if (years === 'all') {
      selected = selected.sort((a, b) => b.fromDate.localeCompare(a.fromDate));
      result.remaining = selected.slice(1).map((y) => y.fyId);
      selected = selected.slice(0, 1);
    }
    if (years === 'current' && currentIdx === -1) throw new Error(`Inget räkenskapsår i Fortnox innehåller dagens datum (${now}).`);
    for (const fy of selected) result.years.push(await importFiscalYear(companyId, fy));

    const locked = (await fortnoxGet(companyId, '/settings/lockedperiod')).LockedPeriod?.EndDate ?? null;
    if (opts.ledger !== false) result.ledger = await syncLedger(companyId);

    // "Lyckad uppdatering" sätts bara när innevarande år faktiskt hämtats i denna körning.
    const refreshedCurrent = selected.some((y) => fys.indexOf(y) === currentIdx);
    await prisma.finConnection.update({ where: { companyId }, data: { lockedUntil: locked ? String(locked) : null, lastError: null, ...(refreshedCurrent ? { lastSuccessAt: started } : {}) } });
    await prisma.finImportRun.update({ where: { id: run.id }, data: { status: 'ok', finishedAt: new Date(), stats: result as any } });
    result.ok = true;
  } catch (err: any) {
    const message = String(err?.message ?? err).slice(0, 1000);
    result.error = message;
    await prisma.finConnection.updateMany({ where: { companyId }, data: { lastError: message } });
    await prisma.finImportRun.update({ where: { id: run.id }, data: { status: 'failed', finishedAt: new Date(), error: message } });
  }
  return result;
}
