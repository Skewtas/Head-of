/**
 * Databaslager för ekonomiuppföljningen: läser tabellerna fin_* till ett
 * Dataset i minnet och sparar regler/beslut (fin_config).
 */
import { prisma } from '../prisma.js';
import { emptyCompany } from './importer.js';
import { COMPANY_IDS, emptyConfig, type CompanyData, type CompanyId, type Dataset, type EkonomiConfig, type YearBalances } from './types.js';

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

/**
 * Ladda bolagens data. Verifikationer laddas för de räkenskapsår som
 * överlappar [from, to]; kontoplan, räkenskapsår och reskontra alltid.
 */
export async function loadDataset(range: { from: string; to: string }): Promise<{ ds: Dataset; ledgerLoaded: Record<CompanyId, boolean>; connected: Record<CompanyId, boolean> }> {
  const [conns, years, accounts, ledger] = await Promise.all([
    prisma.finConnection.findMany(),
    prisma.finFiscalYear.findMany(),
    prisma.finAccount.findMany(),
    prisma.finLedgerItem.findMany(),
  ]);
  const companies = {} as Record<CompanyId, CompanyData>;
  const ledgerLoaded = {} as Record<CompanyId, boolean>;
  const connected = {} as Record<CompanyId, boolean>;
  for (const id of COMPANY_IDS) {
    const c = emptyCompany(id);
    const conn = conns.find((x) => x.companyId === id);
    connected[id] = !!conn?.tokenEnc;
    ledgerLoaded[id] = !!conn?.ledgerSyncedAt;
    c.sync = { lastAttemptAt: iso(conn?.lastAttemptAt), lastSuccessAt: iso(conn?.lastSuccessAt), lastError: conn?.lastError ?? null, lockedUntil: conn?.lockedUntil ?? null };
    const fys = years.filter((y) => y.companyId === id).sort((a, b) => a.fromDate.localeCompare(b.fromDate));
    c.fiscalYears = fys.map((y) => ({ fyId: y.fyId, from: y.fromDate, to: y.toDate, importedAt: iso(y.importedAt) }));
    for (const y of fys) if (y.balances) c.balances[y.fyId] = y.balances as unknown as YearBalances;
    for (const a of accounts) if (a.companyId === id) c.accounts[a.number] = { number: a.number, name: a.name, sieType: a.sieType ?? undefined, firstSeenAt: a.firstSeenAt.toISOString() };
    c.ledger = ledger
      .filter((l) => l.companyId === id)
      .map((l) => ({ companyId: id, kind: l.kind as 'customer' | 'supplier', docNumber: l.docNumber, externalRef: l.externalRef, counterpartyNumber: l.counterpartyNumber, counterpartyName: l.counterpartyName, invoiceDate: l.invoiceDate, dueDate: l.dueDate, total: Number(l.total), balance: Number(l.balance), currency: l.currency, booked: l.booked, cancelled: l.cancelled, isCredit: l.isCredit }));
    const fyIds = fys.filter((y) => y.importedAt && y.fromDate <= range.to && y.toDate >= range.from).map((y) => y.fyId);
    if (fyIds.length) {
      const vs = await prisma.finVoucher.findMany({ where: { companyId: id, fyId: { in: fyIds } } });
      c.vouchers = vs.map((v) => ({ companyId: id, fyId: v.fyId, series: v.series, number: v.number, date: v.date, text: v.text, rows: v.rows as any, hash: v.hash, refType: v.refType ?? undefined, refNumber: v.refNumber ?? undefined }));
    }
    companies[id] = c;
  }
  return { ds: { isTestData: false, companies }, ledgerLoaded, connected };
}

const CONFIG_KEY = 'config';
const FACTS_KEY = 'kartlaggning';

export async function loadConfig(): Promise<EkonomiConfig> {
  const row = await prisma.finConfig.findUnique({ where: { key: CONFIG_KEY } });
  return { ...emptyConfig(), ...((row?.value as any) ?? {}) };
}

export async function saveConfig(cfg: EkonomiConfig, userId: string): Promise<void> {
  await prisma.finConfig.upsert({ where: { key: CONFIG_KEY }, create: { key: CONFIG_KEY, value: cfg as any, updatedBy: userId }, update: { value: cfg as any, updatedBy: userId } });
}

/** Kartläggningen: svar på förutsättningsfrågorna, med status bekräftat / preliminärt / obesvarat. */
export interface Fact {
  id: string;
  status: 'bekraftat' | 'preliminart' | 'obesvarat';
  answer: string;
  updatedAt?: string;
  updatedBy?: string;
}

export async function loadFacts(): Promise<Record<string, Fact>> {
  const row = await prisma.finConfig.findUnique({ where: { key: FACTS_KEY } });
  return ((row?.value as any) ?? {}) as Record<string, Fact>;
}

export async function saveFacts(facts: Record<string, Fact>, userId: string): Promise<void> {
  await prisma.finConfig.upsert({ where: { key: FACTS_KEY }, create: { key: FACTS_KEY, value: facts as any, updatedBy: userId }, update: { value: facts as any, updatedBy: userId } });
}
