/**
 * EKONOMI — gemensamma typer för den ekonomiska uppföljningen av
 * Stodona AB och Stodona Services AB.
 *
 * Grundregler (se docs/ekonomi/README.md):
 *  - Alla belopp är heltal i ÖRE. Inga flyttal i summeringar.
 *  - Råbelopp följer bokföringens tecken: debet +, kredit −.
 *  - "Resultatpåverkan" (det som visas i resultatrapporten) = −råbelopp,
 *    dvs. intäkter +, kostnader −.
 *  - Datum är ISO-strängar (YYYY-MM-DD) och jämförs lexikalt.
 *  - null betyder "underlag saknas" och får aldrig visas som 0.
 */

export const COMPANY_IDS = ['stodona_ab', 'stodona_services'] as const;
export type CompanyId = (typeof COMPANY_IDS)[number];

export interface CompanyIdentity {
  id: CompanyId;
  name: string;
  /** Förväntat organisationsnummer — kontrolleras mot Fortnox vid anslutning. */
  orgNumber: string;
}

/** Bolagsidentiteter. Org.nr enligt own_companies (migrering 20260901). */
export const COMPANIES: Record<CompanyId, CompanyIdentity> = {
  stodona_ab: { id: 'stodona_ab', name: 'Stodona AB', orgNumber: '559201-1059' },
  stodona_services: { id: 'stodona_services', name: 'Stodona Services AB', orgNumber: '559481-1332' },
};

export function otherCompany(id: CompanyId): CompanyId {
  return id === 'stodona_ab' ? 'stodona_services' : 'stodona_ab';
}

export interface FiscalYear {
  /** Fortnox Id för räkenskapsåret (unikt per bolag). */
  fyId: number;
  from: string;
  to: string;
  /** Tidpunkt då detta år senast importerades fullständigt (ISO). null = aldrig. */
  importedAt: string | null;
}

export interface Account {
  number: string;
  name: string;
  /** SIE #KTYP om angiven: T (tillgång), S (skuld), K (kostnad), I (intäkt). */
  sieType?: string;
  /** När kontot först sågs i en import (ISO). Används för att flagga nya konton. */
  firstSeenAt?: string;
}

export interface VoucherRow {
  account: string;
  /** Öre, debet +, kredit −. */
  amount: number;
  text?: string;
  costCenter?: string;
  project?: string;
}

export interface Voucher {
  companyId: CompanyId;
  fyId: number;
  series: string;
  number: number;
  /** Verifikationsdatum — styr vilken period beloppet hör till. */
  date: string;
  text: string;
  rows: VoucherRow[];
  /** Fortnox ReferenceType (INVOICE, SUPPLIERINVOICE, …) om känd. */
  refType?: string;
  refNumber?: string;
  /** Innehållshash — används för dubblettskydd och ändringsspårning. */
  hash?: string;
}

export interface YearBalances {
  fyId: number;
  /** Ingående balans per konto enligt Fortnox (#IB). */
  ib: Record<string, number>;
  /** Utgående balans per konto enligt Fortnox vid uttaget (#UB). */
  ub: Record<string, number>;
  /** Resultatkontons saldo enligt Fortnox vid uttaget (#RES). */
  res: Record<string, number>;
  /** Periodsaldon per månad (YYYY-MM) och konto om SIE-filen innehöll #PSALDO. */
  psaldo?: Record<string, Record<string, number>>;
  /** Saldon från /3/accounts (oberoende kontrollkälla), om hämtade. */
  apiUb?: Record<string, number>;
  /** Antal verifikationer enligt /3/vouchers-listan, om hämtad. */
  apiVoucherCount?: number;
}

export type LedgerKind = 'customer' | 'supplier';

/** Kund- eller leverantörsfaktura (reskontrapost) — förklarar, men ersätter aldrig, bokföringen. */
export interface LedgerItem {
  companyId: CompanyId;
  kind: LedgerKind;
  /** Kund: DocumentNumber. Leverantör: GivenNumber. */
  docNumber: string;
  /** Kund: samma som docNumber. Leverantör: leverantörens fakturanummer (InvoiceNumber). */
  externalRef: string;
  counterpartyNumber: string;
  counterpartyName: string;
  invoiceDate: string;
  dueDate: string;
  /** Totalbelopp inkl. moms i öre (negativt för kredit). */
  total: number;
  /** Kvar att betala i öre vid synktillfället. */
  balance: number;
  currency: string;
  booked: boolean;
  cancelled: boolean;
  isCredit: boolean;
}

export interface SyncState {
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  lastError: string | null;
  /** Fortnox "låst period t.o.m." om satt. */
  lockedUntil: string | null;
}

export interface CompanyData {
  id: CompanyId;
  fiscalYears: FiscalYear[];
  accounts: Record<string, Account>;
  vouchers: Voucher[];
  balances: Record<number, YearBalances>;
  ledger: LedgerItem[];
  sync: SyncState;
}

export interface Dataset {
  /** true = tydligt märkt testdata. Får aldrig presenteras som verkliga siffror. */
  isTestData: boolean;
  companies: Record<CompanyId, CompanyData>;
}

// ── Konfiguration (regler som användaren bekräftar) ─────────────────────────

export interface MappingOverride {
  /** null = gäller båda bolagen. */
  companyId: CompanyId | null;
  account: string;
  category: string;
  confirmedBy?: string;
  confirmedAt?: string;
  note?: string;
}

export type InternalRuleType = 'account' | 'counterparty' | 'voucher';

export interface InternalRule {
  id: string;
  companyId: CompanyId;
  type: InternalRuleType;
  /** type=account: kontonummer vars rörelser är interna. */
  account?: string;
  /** type=counterparty: reskontra + kund-/leverantörsnummer för systerbolaget. */
  ledger?: LedgerKind;
  counterpartyNumber?: string;
  /** type=voucher: enskild verifikation som manuellt pekats ut. */
  voucher?: { fyId: number; series: string; number: number };
  /** Elimineringsgrupp, t.ex. "personaluthyrning", "lån", "ränta". */
  group: string;
  note: string;
  active: boolean;
}

export interface Adjustment {
  id: string;
  companyId: CompanyId;
  /** Månad justeringen avser (YYYY-MM). */
  month: string;
  category: string;
  /** Resultatpåverkan i öre (kostnad = negativt). */
  amount: number;
  source: string;
  method: string;
  motivation: string;
  /**
   * Månad då den faktiska bokföringen kommer in. Justeringen vänds då
   * automatiskt (−amount) så att samma händelse inte räknas två gånger.
   * null = ingen automatisk vändning; måste då avslutas manuellt.
   */
  reverseMonth: string | null;
  handling: string;
  active: boolean;
  createdBy?: string;
  createdAt?: string;
}

export type PeriodStatusValue = 'preliminar' | 'avstamd' | 'stangd';

export interface PeriodStatus {
  companyId: CompanyId;
  month: string;
  status: PeriodStatusValue;
  /** Hash av månadens bokföringsrader när statusen sattes. */
  dataHash: string;
  markedAt: string;
  markedBy?: string;
  note?: string;
}

export interface EkonomiConfig {
  mappingOverrides: MappingOverride[];
  internalRules: InternalRule[];
  adjustments: Adjustment[];
  periodStatuses: PeriodStatus[];
  /** Tidpunkt då kontomappningen senast granskades; konton sedda därefter flaggas som nya. */
  mappingReviewedAt: string | null;
  /** Sätts först när en verklig period stämts av mot båda bolagens redovisning. */
  initialVerification: { done: boolean; month?: string; by?: string; at?: string; note?: string };
}

export function emptyConfig(): EkonomiConfig {
  return {
    mappingOverrides: [],
    internalRules: [],
    adjustments: [],
    periodStatuses: [],
    mappingReviewedAt: null,
    initialVerification: { done: false },
  };
}

export function voucherKey(v: { companyId: CompanyId; fyId: number; series: string; number: number }): string {
  return `${v.companyId}|${v.fyId}|${v.series}|${v.number}`;
}
