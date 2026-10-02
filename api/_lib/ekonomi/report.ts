/**
 * Gemensam resultat- och balansrapport.
 *
 * Fyra kolumner: Stodona AB | Stodona Services AB | Elimineringar och
 * rapportjusteringar | Verksamheten totalt.
 *
 *  - Bolagskolumnerna är respektive bolags bokföring, oförändrad, och ska
 *    gå att stämma av mot Fortnox resultatrapport för samma period.
 *  - Resultat = rörelser (verifikationsrader) daterade inom perioden.
 *  - Balans = ingående balans för räkenskapsåret som innehåller datumet
 *    + rörelser från årets början t.o.m. datumet.
 *  - Saknas underlag för ett bolag blir bolagets kolumn OCH totalen null.
 */
import { AccountMapper, CATEGORIES, CATEGORY_BY_ID, type MappingStatus } from './mapping.js';
import { ratioPct, sumOrNull } from './money.js';
import { addDays, fiscalYearContaining, monthOf, monthStart, monthEnd, addMonths, type Period } from './periods.js';
import { InternalTagger, collectInternalDocs, matchInternalDocs, MAX_MONTH_DISTANCE, type InternalIssue } from './intercompany.js';
import { COMPANIES, COMPANY_IDS, type Adjustment, type CompanyData, type CompanyId, type Dataset, type EkonomiConfig } from './types.js';

export interface Completeness {
  complete: boolean;
  reasons: string[];
  warnings: string[];
}

/** Hur gammal senaste lyckade uppdatering får vara för att en pågående period ska räknas som aktuell. */
export const FRESHNESS_HOURS = 36;

/** Finns fullständigt underlag för bolaget under hela perioden? */
export function completenessFor(c: CompanyData, period: { from: string; to: string }, now: string): Completeness {
  const reasons: string[] = [];
  const warnings: string[] = [];
  const name = COMPANIES[c.id].name;
  if (!c.sync.lastSuccessAt) {
    reasons.push(`${name}: ingen lyckad import från Fortnox finns.`);
    return { complete: false, reasons, warnings };
  }
  // Täcker importerade räkenskapsår hela perioden utan glapp?
  let cursor = period.from;
  while (cursor <= period.to) {
    const fy = fiscalYearContaining(c.fiscalYears, cursor);
    if (!fy || !fy.importedAt) {
      reasons.push(`${name}: räkenskapsåret som innehåller ${cursor} är inte importerat.`);
      break;
    }
    cursor = addDays(fy.to, 1);
  }
  const lastDate = c.sync.lastSuccessAt.slice(0, 10);
  const ageHours = (Date.parse(now) - Date.parse(c.sync.lastSuccessAt)) / 3_600_000;
  if (lastDate < period.to && ageHours > FRESHNESS_HOURS) {
    reasons.push(`${name}: senaste lyckade uppdatering (${lastDate}) är äldre än periodens slut (${period.to}).`);
  } else if (now.slice(0, 10) <= period.to) {
    warnings.push(`${name}: perioden pågår fortfarande — siffrorna är ofullständiga per definition.`);
  }
  if (c.sync.lastError) {
    warnings.push(`${name}: senaste uppdateringsförsök misslyckades (${c.sync.lastError}). Visade siffror är från ${c.sync.lastSuccessAt}.`);
  }
  return { complete: reasons.length === 0, reasons, warnings };
}

export interface AccountLine {
  companyId: CompanyId;
  account: string;
  name: string;
  category: string;
  mappingStatus: MappingStatus;
  isNew: boolean;
  /** Resultatpåverkan (RR) eller råsaldo (BR) i öre. */
  amount: number;
  /** Varav internt (elimineras). */
  internal: number;
}

export interface ReportRow {
  id: string;
  label: string;
  kind: 'kategori' | 'summa' | 'nyckeltal' | 'info';
  unit: 'ore' | 'procent';
  definition: string;
  ab: number | null;
  services: number | null;
  elimination: number | null;
  adjustment: number | null;
  total: number | null;
  note?: string;
}

export interface AppliedAdjustment {
  adjustment: Adjustment;
  /** Belopp som påverkar perioden (inkl. ev. vändning). */
  effectInPeriod: number;
  parts: { month: string; amount: number; kind: 'justering' | 'vändning' }[];
}

export interface ResultReport {
  isTestData: boolean;
  period: Period;
  rows: ReportRow[];
  completeness: Record<CompanyId, Completeness>;
  accounts: AccountLine[];
  /** Belopp på 8990–8999 som lämnats utanför resultatet, per bolag. */
  excludedResultTransfer: Record<CompanyId, number>;
  internalIssues: InternalIssue[];
  /** Summa elimineringar i perioden. ≠ 0 betyder att bolagens interna bokningar inte tar ut varandra. */
  eliminationDifference: number | null;
  adjustments: AppliedAdjustment[];
  signWarnings: string[];
}

function isNewAccount(c: CompanyData, account: string, reviewedAt: string | null): boolean {
  const seen = c.accounts[account]?.firstSeenAt;
  return !!reviewedAt && !!seen && seen > reviewedAt;
}

const RR_ORDER = ['NETTOOMSATTNING', 'OVRIGA_INTAKTER', 'DIREKTA_KOSTNADER', 'OVRIGA_EXTERNA', 'PERSONAL', 'AVSKRIVNINGAR', 'OVRIGA_RORELSEKOSTNADER', 'FIN_INTAKTER', 'FIN_KOSTNADER', 'OMAPPAT_RR', 'BOKSLUTSDISPOSITIONER', 'SKATT'];
const OPERATING = ['NETTOOMSATTNING', 'OVRIGA_INTAKTER', 'DIREKTA_KOSTNADER', 'OVRIGA_EXTERNA', 'PERSONAL', 'AVSKRIVNINGAR', 'OVRIGA_RORELSEKOSTNADER'];

export function buildResultReport(ds: Dataset, cfg: EkonomiConfig, period: Period, now: string): ResultReport {
  const mapper = new AccountMapper(cfg.mappingOverrides);
  const tagger = new InternalTagger(ds, cfg.internalRules, mapper);
  const completeness = {} as Record<CompanyId, Completeness>;
  const perCompany = {} as Record<CompanyId, Record<string, number>>;
  const elim: Record<string, number> = {};
  const excluded = {} as Record<CompanyId, number>;
  const lines = new Map<string, AccountLine>();

  for (const id of COMPANY_IDS) {
    const c = ds.companies[id];
    completeness[id] = completenessFor(c, period, now);
    perCompany[id] = {};
    excluded[id] = 0;
    for (const v of c.vouchers) {
      if (v.date < period.from || v.date > period.to) continue;
      for (const row of v.rows) {
        const m = mapper.resolve(id, row.account);
        const cat = CATEGORY_BY_ID[m.category];
        if (cat.statement === 'BR') continue;
        const effect = -row.amount;
        if (cat.statement === 'EXKL') excluded[id] += effect;
        else if (cat.statement === 'RR') perCompany[id][cat.id] = (perCompany[id][cat.id] ?? 0) + effect;
        const key = `${id}|${row.account}`;
        let line = lines.get(key);
        if (!line) {
          line = { companyId: id, account: row.account, name: c.accounts[row.account]?.name ?? '(kontonamn saknas)', category: cat.id, mappingStatus: m.status, isNew: isNewAccount(c, row.account, cfg.mappingReviewedAt), amount: 0, internal: 0 };
          lines.set(key, line);
        }
        line.amount += effect;
        if (cat.statement === 'RR' && tagger.tag(v, row)) {
          line.internal += effect;
          elim[cat.id] = (elim[cat.id] ?? 0) - effect;
        }
      }
    }
  }

  // Rapportjusteringar: hålls åtskilda från bokförda siffror.
  const adj: Record<string, number> = {};
  const applied: AppliedAdjustment[] = [];
  const inPeriod = (month: string) => monthStart(month) >= period.from && monthEnd(month) <= period.to;
  for (const a of cfg.adjustments) {
    if (!a.active) continue;
    const parts: AppliedAdjustment['parts'] = [];
    if (inPeriod(a.month)) parts.push({ month: a.month, amount: a.amount, kind: 'justering' });
    if (a.reverseMonth && inPeriod(a.reverseMonth)) parts.push({ month: a.reverseMonth, amount: -a.amount, kind: 'vändning' });
    if (!parts.length) continue;
    const effectInPeriod = parts.reduce((s, p) => s + p.amount, 0);
    adj[a.category] = (adj[a.category] ?? 0) + effectInPeriod;
    applied.push({ adjustment: a, effectInPeriod, parts });
  }

  const bothComplete = COMPANY_IDS.every((id) => completeness[id].complete);
  const val = (id: CompanyId, cats: string[]): number | null =>
    completeness[id].complete ? cats.reduce((s, c) => s + (perCompany[id][c] ?? 0), 0) : null;
  const elimVal = (cats: string[]): number | null => (bothComplete ? cats.reduce((s, c) => s + (elim[c] ?? 0), 0) : null);
  const adjVal = (cats: string[]): number => cats.reduce((s, c) => s + (adj[c] ?? 0), 0);

  const rows: ReportRow[] = [];
  const moneyRow = (id: string, label: string, kind: ReportRow['kind'], cats: string[], definition: string, opts: { perCompanyOnly?: string } = {}): ReportRow => {
    const ab = val('stodona_ab', cats);
    const services = val('stodona_services', cats);
    const elimination = opts.perCompanyOnly ? null : elimVal(cats);
    const adjustment = opts.perCompanyOnly ? null : adjVal(cats);
    const total = opts.perCompanyOnly ? null : sumOrNull([ab, services, elimination, adjustment]);
    const row: ReportRow = { id, label, kind, unit: 'ore', definition, ab, services, elimination, adjustment, total };
    if (opts.perCompanyOnly) row.note = opts.perCompanyOnly;
    rows.push(row);
    return row;
  };
  const cat = (id: string, opts: { perCompanyOnly?: string } = {}) => moneyRow(id, CATEGORY_BY_ID[id].label, 'kategori', [id], CATEGORY_BY_ID[id].definition, opts);

  const hasUnmapped = COMPANY_IDS.some((id) => (perCompany[id]['OMAPPAT_RR'] ?? 0) !== 0) || [...lines.values()].some((l) => l.category === 'OMAPPAT_RR');

  const netto = cat('NETTOOMSATTNING');
  cat('OVRIGA_INTAKTER');
  moneyRow('SUMMA_INTAKTER', 'Summa rörelseintäkter', 'summa', ['NETTOOMSATTNING', 'OVRIGA_INTAKTER'], 'Nettoomsättning + övriga rörelseintäkter. Kolumnen "Verksamheten totalt" visar intäkter från externa kunder, eftersom interna intäkter är eliminerade.');
  cat('DIREKTA_KOSTNADER');
  cat('OVRIGA_EXTERNA');
  cat('PERSONAL');
  cat('AVSKRIVNINGAR');
  cat('OVRIGA_RORELSEKOSTNADER');
  const ebit = moneyRow('RORELSERESULTAT', 'Rörelseresultat', 'summa', OPERATING, 'Summa rörelseintäkter minus rörelsekostnader (konto 3000–7999), före finansiella poster, bokslutsdispositioner och skatt.');
  const marginOf = (k: 'ab' | 'services' | 'total') => ratioPct(ebit[k], netto[k]);
  rows.push({
    id: 'RORELSEMARGINAL',
    label: 'Rörelsemarginal',
    kind: 'nyckeltal',
    unit: 'procent',
    definition: 'Rörelseresultat ÷ nettoomsättning. För verksamheten totalt används extern nettoomsättning. Bolagens egna marginaler påverkas av internfaktureringen och säger lite om lönsamheten var för sig.',
    ab: marginOf('ab'),
    services: marginOf('services'),
    elimination: null,
    adjustment: null,
    total: marginOf('total'),
  });
  cat('FIN_INTAKTER');
  cat('FIN_KOSTNADER');
  if (hasUnmapped) cat('OMAPPAT_RR');
  moneyRow('RESULTAT_EFTER_FIN', 'Resultat efter finansiella poster', 'summa', [...OPERATING, 'FIN_INTAKTER', 'FIN_KOSTNADER', 'OMAPPAT_RR'], 'Rörelseresultat + finansiella intäkter − finansiella kostnader (+ ev. omappade resultatkonton).');
  const perBolag = 'Redovisas per bolag. Ingen gemensam summa — bolagen beskattas var för sig.';
  cat('BOKSLUTSDISPOSITIONER', { perCompanyOnly: perBolag });
  cat('SKATT', { perCompanyOnly: perBolag });
  moneyRow('PERIODENS_RESULTAT', 'Bokfört resultat i perioden', 'summa', RR_ORDER, 'Samtliga resultatkonton 3000–8989 enligt bokföringen. Bokförd skatt ingår endast om den är bokförd i perioden.', { perCompanyOnly: perBolag });

  // Interna poster: kontroll (påverkar inte beloppen ovan).
  const windowFrom = monthStart(addMonths(monthOf(period.from), -MAX_MONTH_DISTANCE));
  const windowTo = monthEnd(addMonths(monthOf(period.to), MAX_MONTH_DISTANCE));
  const docs = collectInternalDocs(ds, tagger, mapper, windowFrom, windowTo);
  const { issues } = matchInternalDocs(docs);
  const internalIssues = issues.filter((i) => i.docs.some((d) => d.date >= period.from && d.date <= period.to));

  // Teckenkontroll per konto.
  const signWarnings: string[] = [];
  for (const l of lines.values()) {
    const exp = CATEGORY_BY_ID[l.category].expectedSign;
    if (exp !== 0 && l.amount !== 0 && Math.sign(l.amount) !== exp) {
      signWarnings.push(`${COMPANIES[l.companyId].name} konto ${l.account} ${l.name}: nettot i perioden har oväntat tecken för kategorin "${CATEGORY_BY_ID[l.category].label}". Kontrollera mappning eller bokning.`);
    }
  }

  return {
    isTestData: ds.isTestData,
    period,
    rows,
    completeness,
    accounts: [...lines.values()].sort((a, b) => a.account.localeCompare(b.account) || a.companyId.localeCompare(b.companyId)),
    excludedResultTransfer: excluded,
    internalIssues,
    eliminationDifference: bothComplete ? Object.values(elim).reduce((s, v) => s + v, 0) : null,
    adjustments: applied,
    signWarnings,
  };
}

// ── Balans ──────────────────────────────────────────────────────────────────

/** Råsaldo (debet +) per konto på ett datum, eller null om räkenskapsåret inte är importerat. */
export function balancesAt(c: CompanyData, date: string): { balances: Record<string, number>; fyFrom: string } | null {
  const fy = fiscalYearContaining(c.fiscalYears, date);
  if (!fy || !fy.importedAt) return null;
  const yb = c.balances[fy.fyId];
  if (!yb) return null;
  const balances: Record<string, number> = { ...yb.ib };
  for (const v of c.vouchers) {
    if (v.fyId !== fy.fyId || v.date > date) continue;
    for (const row of v.rows) balances[row.account] = (balances[row.account] ?? 0) + row.amount;
  }
  return { balances, fyFrom: fy.from };
}

export interface BalanceRow {
  id: string;
  label: string;
  kind: 'kategori' | 'summa' | 'info';
  definition: string;
  ab: number | null;
  services: number | null;
  elimination: number | null;
  total: number | null;
}

export interface InternalBalanceCheck {
  group: string;
  ab: number;
  services: number;
  /** Ska vara 0: fordran i ett bolag = skuld i det andra. */
  difference: number;
}

export interface BalanceReport {
  isTestData: boolean;
  date: string;
  rows: BalanceRow[];
  complete: Record<CompanyId, boolean>;
  reasons: string[];
  accounts: AccountLine[];
  /** Tillgångar − (eget kapital + skulder + beräknat resultat). Ska vara 0 per bolag. */
  balanceCheck: Record<CompanyId, number | null>;
  internalBalances: InternalBalanceCheck[];
}

const ASSETS = ['ANLAGGNINGSTILLGANGAR', 'LAGER', 'KUNDFORDRINGAR', 'OVRIGA_FORDRINGAR', 'FORUTBETALDA', 'KORTFRISTIGA_PLACERINGAR', 'LIKVIDA_MEDEL'];
const EQUITY_LIAB = ['EGET_KAPITAL', 'OBESKATTADE_RESERVER', 'AVSATTNINGAR', 'LANGFRISTIGA_SKULDER', 'LEVERANTORSSKULDER', 'SKATTESKULDER', 'MOMS', 'PERSONALSKATT_AVGIFTER', 'OVRIGA_KORTFRISTIGA_SKULDER', 'UPPLUPNA'];

export function buildBalanceReport(ds: Dataset, cfg: EkonomiConfig, date: string): BalanceReport {
  const mapper = new AccountMapper(cfg.mappingOverrides);
  const tagger = new InternalTagger(ds, cfg.internalRules, mapper);
  const perCompany = {} as Record<CompanyId, Record<string, number> | null>;
  const result = {} as Record<CompanyId, number | null>;
  const unknown = {} as Record<CompanyId, number>;
  const elim: Record<string, number> = {};
  const complete = {} as Record<CompanyId, boolean>;
  const reasons: string[] = [];
  const accounts: AccountLine[] = [];
  const groupTotals = new Map<string, InternalBalanceCheck>();

  for (const id of COMPANY_IDS) {
    const c = ds.companies[id];
    const b = balancesAt(c, date);
    complete[id] = !!b;
    unknown[id] = 0;
    if (!b) {
      perCompany[id] = null;
      result[id] = null;
      reasons.push(`${COMPANIES[id].name}: räkenskapsåret som innehåller ${date} är inte importerat — ingående balanser saknas.`);
      continue;
    }
    const internalAccounts = new Map(tagger.internalBalanceAccounts(id).map((a) => [a.account, a.group]));
    const sums: Record<string, number> = {};
    let res = 0;
    for (const [account, raw] of Object.entries(b.balances)) {
      const m = mapper.resolve(id, account);
      const cat = CATEGORY_BY_ID[m.category];
      if (cat.statement === 'RR' || cat.statement === 'EXKL') {
        res += -raw; // årets resultat hittills (0 efter att 8999 bokförts)
        continue;
      }
      if (cat.statement === 'OKAND') unknown[id] += raw;
      if (raw === 0) continue;
      sums[cat.id] = (sums[cat.id] ?? 0) + raw;
      const group = internalAccounts.get(account);
      if (group) {
        elim[cat.id] = (elim[cat.id] ?? 0) - raw;
        const g = groupTotals.get(group) ?? { group, ab: 0, services: 0, difference: 0 };
        if (id === 'stodona_ab') g.ab += raw;
        else g.services += raw;
        g.difference = g.ab + g.services;
        groupTotals.set(group, g);
      }
      accounts.push({ companyId: id, account, name: c.accounts[account]?.name ?? '(kontonamn saknas)', category: cat.id, mappingStatus: m.status, isNew: isNewAccount(c, account, cfg.mappingReviewedAt), amount: raw, internal: group ? raw : 0 });
    }
    perCompany[id] = sums;
    result[id] = res;
  }

  const both = COMPANY_IDS.every((id) => complete[id]);
  const rows: BalanceRow[] = [];
  // Visat tecken: tillgångar som de är, eget kapital och skulder med omvänt tecken (positivt = skuld).
  const add = (id: string, label: string, kind: BalanceRow['kind'], cats: string[], sign: 1 | -1, definition: string) => {
    const v = (cid: CompanyId) => (perCompany[cid] ? sign * cats.reduce((s, c) => s + (perCompany[cid]![c] ?? 0), 0) : null);
    const ab = v('stodona_ab');
    const services = v('stodona_services');
    const elimination = both ? sign * cats.reduce((s, c) => s + (elim[c] ?? 0), 0) : null;
    rows.push({ id, label, kind, definition, ab, services, elimination, total: sumOrNull([ab, services, elimination]) });
  };
  for (const c of ASSETS) add(c, CATEGORY_BY_ID[c].label, 'kategori', [c], 1, CATEGORY_BY_ID[c].definition);
  if (accounts.some((a) => a.category === 'OMAPPAT_BR')) add('OMAPPAT_BR', CATEGORY_BY_ID.OMAPPAT_BR.label, 'kategori', ['OMAPPAT_BR'], 1, CATEGORY_BY_ID.OMAPPAT_BR.definition);
  add('SUMMA_TILLGANGAR', 'Summa tillgångar', 'summa', [...ASSETS, 'OMAPPAT_BR'], 1, 'Konto 1000–1999 (samt ev. omappade balanskonton).');
  for (const c of EQUITY_LIAB) add(c, CATEGORY_BY_ID[c].label, 'kategori', [c], -1, CATEGORY_BY_ID[c].definition);
  rows.push({
    id: 'BERAKNAT_RESULTAT',
    label: 'Beräknat resultat innevarande räkenskapsår',
    kind: 'info',
    definition: 'Summan av resultatkontona från respektive bolags räkenskapsårs början t.o.m. rapportdatumet. Avser olika perioder för bolagen eftersom räkenskapsåren skiljer sig — summeras därför inte.',
    ab: result.stodona_ab,
    services: result.stodona_services,
    elimination: null,
    total: null,
  });
  add('SUMMA_EK_SKULDER', 'Summa eget kapital och skulder (exkl. beräknat resultat)', 'summa', EQUITY_LIAB, -1, 'Konto 2000–2999.');

  const balanceCheck = {} as Record<CompanyId, number | null>;
  for (const id of COMPANY_IDS) {
    const s = perCompany[id];
    balanceCheck[id] = s ? Object.values(s).reduce((t, v) => t + v, 0) - (result[id] ?? 0) : null;
  }

  return { isTestData: ds.isTestData, date, rows, complete, reasons, accounts: accounts.sort((a, b) => a.account.localeCompare(b.account)), balanceCheck, internalBalances: [...groupTotals.values()] };
}
