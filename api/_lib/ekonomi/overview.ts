/**
 * Likviditet, kundfordringar och väntande betalningar.
 *
 * Skilj på tre saker:
 *   - Lönsamhet  = resultatrapporten (bokförda intäkter och kostnader).
 *   - Likvida medel = bokfört saldo på konto 19xx per bolag och datum.
 *   - Kassaflöde = förändringen av likvida medel under perioden.
 * Pengar i ett bolag är inte automatiskt tillgängliga för det andra;
 * därför visas alltid saldo per bolag.
 */
import { AccountMapper } from './mapping.js';
import { InternalTagger } from './intercompany.js';
import { sumOrNull } from './money.js';
import { addDays, type Period } from './periods.js';
import { balancesAt } from './report.js';
import { COMPANIES, COMPANY_IDS, type CompanyData, type CompanyId, type Dataset, type EkonomiConfig, type LedgerItem } from './types.js';

export interface CashPosition {
  companyId: CompanyId;
  /** Bokfört saldo likvida medel i öre, eller null om underlag saknas. */
  balance: number | null;
  accounts: { account: string; name: string; balance: number }[];
  /** Förändring under perioden (kassaflöde), null om ingående saldo saknas. */
  change: number | null;
}

export interface Liquidity {
  date: string;
  perCompany: CashPosition[];
  /** Enbart upplysning — summan är inte fritt disponibel mellan bolagen. */
  total: number | null;
  /** Interna överföringar tar ut varandra i summan, så detta är verksamhetens externa kassaflöde. */
  totalChange: number | null;
  notes: string[];
}

function cashAt(c: CompanyData, mapper: AccountMapper, date: string): { total: number; accounts: CashPosition['accounts'] } | null {
  const b = balancesAt(c, date);
  if (!b) return null;
  const accounts: CashPosition['accounts'] = [];
  let total = 0;
  for (const [account, raw] of Object.entries(b.balances)) {
    if (mapper.resolve(c.id, account).category !== 'LIKVIDA_MEDEL' || raw === 0) continue;
    accounts.push({ account, name: c.accounts[account]?.name ?? '', balance: raw });
    total += raw;
  }
  return { total, accounts: accounts.sort((x, y) => x.account.localeCompare(y.account)) };
}

export function buildLiquidity(ds: Dataset, cfg: EkonomiConfig, period: Period): Liquidity {
  const mapper = new AccountMapper(cfg.mappingOverrides);
  const perCompany: CashPosition[] = COMPANY_IDS.map((id) => {
    const c = ds.companies[id];
    const end = cashAt(c, mapper, period.to);
    const start = cashAt(c, mapper, addDays(period.from, -1));
    return { companyId: id, balance: end?.total ?? null, accounts: end?.accounts ?? [], change: end && start ? end.total - start.total : null };
  });
  return {
    date: period.to,
    perCompany,
    total: sumOrNull(perCompany.map((p) => p.balance)),
    totalChange: sumOrNull(perCompany.map((p) => p.change)),
    notes: [
      'Saldot är bokfört saldo på likvidkonton (19xx). Det kan avvika från bankens saldo om bankhändelser inte är bokförda.',
      'Summan är en upplysning. Medel i ett bolag är inte automatiskt tillgängliga för det andra.',
      'Förändringen i summan exkluderar interna överföringar endast om båda bolagen bokfört dem i samma period.',
    ],
  };
}

export interface AgingBucket {
  label: string;
  amount: number;
  count: number;
}

export interface LedgerSummary {
  companyId: CompanyId;
  /** null = reskontran är inte hämtad för bolaget (visas som "saknas", inte 0). */
  available: boolean;
  total: number | null;
  overdueTotal: number | null;
  buckets: AgingBucket[];
  items: (LedgerItem & { daysOverdue: number })[];
  /** Poster mot systerbolaget, redovisade separat. */
  internalTotal: number | null;
}

function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);
}

function summarize(ds: Dataset, tagger: InternalTagger, id: CompanyId, kind: 'customer' | 'supplier', today: string, ledgerLoaded: Record<CompanyId, boolean>): LedgerSummary {
  if (!ledgerLoaded[id]) return { companyId: id, available: false, total: null, overdueTotal: null, buckets: [], items: [], internalTotal: null };
  const open = ds.companies[id].ledger.filter((i) => i.kind === kind && !i.cancelled && i.balance !== 0);
  const external = open.filter((i) => !tagger.isInternalCounterparty(i));
  const internal = open.filter((i) => tagger.isInternalCounterparty(i));
  const items = external.map((i) => ({ ...i, daysOverdue: daysBetween(i.dueDate, today) })).sort((a, b) => b.daysOverdue - a.daysOverdue);
  const defs: [string, (d: number) => boolean][] =
    kind === 'customer'
      ? [['Ej förfallet', (d) => d <= 0], ['Förfallet 1–30 dagar', (d) => d >= 1 && d <= 30], ['Förfallet 31–60 dagar', (d) => d >= 31 && d <= 60], ['Förfallet 61–90 dagar', (d) => d >= 61 && d <= 90], ['Förfallet över 90 dagar', (d) => d > 90]]
      : [['Förfallet', (d) => d > 0], ['Förfaller inom 7 dagar', (d) => d <= 0 && d >= -7], ['Förfaller inom 8–30 dagar', (d) => d < -7 && d >= -30], ['Förfaller senare', (d) => d < -30]];
  const buckets = defs.map(([label, test]) => {
    const hit = items.filter((i) => test(i.daysOverdue));
    return { label, amount: hit.reduce((s, i) => s + i.balance, 0), count: hit.length };
  });
  return {
    companyId: id,
    available: true,
    total: items.reduce((s, i) => s + i.balance, 0),
    overdueTotal: items.filter((i) => i.daysOverdue > 0).reduce((s, i) => s + i.balance, 0),
    buckets,
    items,
    internalTotal: internal.reduce((s, i) => s + i.balance, 0),
  };
}

export interface BookedLiability {
  companyId: CompanyId;
  label: string;
  /** Skuld i öre (positivt = att betala), null om underlag saknas. */
  amount: number | null;
}

export interface LedgerOverview {
  asOf: string;
  receivables: LedgerSummary[];
  payables: LedgerSummary[];
  bookedLiabilities: BookedLiability[];
  notes: string[];
}

/**
 * @param today datum som förfallodagar räknas mot
 * @param ledgerLoaded om reskontran hämtats för respektive bolag
 */
export function buildLedgerOverview(ds: Dataset, cfg: EkonomiConfig, today: string, ledgerLoaded: Record<CompanyId, boolean>): LedgerOverview {
  const mapper = new AccountMapper(cfg.mappingOverrides);
  const tagger = new InternalTagger(ds, cfg.internalRules, mapper);
  const liabilities: BookedLiability[] = [];
  for (const id of COMPANY_IDS) {
    const b = balancesAt(ds.companies[id], today);
    for (const [cat, label] of [['MOMS', 'Moms (bokförd skuld)'], ['PERSONALSKATT_AVGIFTER', 'Personalskatt och arbetsgivaravgifter (bokförd skuld)'], ['SKATTESKULDER', 'Skatteskulder (bokförd skuld)']] as const) {
      let amount: number | null = null;
      if (b) {
        amount = 0;
        for (const [account, raw] of Object.entries(b.balances)) if (mapper.resolve(id, account).category === cat) amount -= raw;
      }
      liabilities.push({ companyId: id, label: `${COMPANIES[id].name}: ${label}`, amount });
    }
  }
  return {
    asOf: today,
    receivables: COMPANY_IDS.map((id) => summarize(ds, tagger, id, 'customer', today, ledgerLoaded)),
    payables: COMPANY_IDS.map((id) => summarize(ds, tagger, id, 'supplier', today, ledgerLoaded)),
    bookedLiabilities: liabilities,
    notes: [
      'Reskontran visar läget vid senaste uppdatering — den kan inte återskapas för historiska datum.',
      'Kundfordringar på RUT/ROT-fakturor kan innehålla den del som Skatteverket betalar; den delen är inte kundens skuld.',
      'Bokförda skulder till Skatteverket visar saldo enligt bokföringen. Förfallodag framgår inte av bokföringen.',
      'Kommande löner syns inte här förrän de är bokförda.',
    ],
  };
}
