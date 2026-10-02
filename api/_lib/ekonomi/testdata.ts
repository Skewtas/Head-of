/**
 * TESTDATA — påhittade siffror för att visa och testa uppföljningen.
 *
 * Inget här kommer från bolagens bokföring. Räkenskapsår, konton, belopp,
 * kund- och leverantörsnummer är ANTAGANDEN för test. Datasetet märks med
 * isTestData = true och får aldrig presenteras som verkliga siffror.
 *
 * Datat skapas som SIE-text och går genom samma tolk och import som
 * verklig data, så att hela kedjan testas.
 */
import { applyFiscalYearImport, emptyCompany, type FiscalYearImport } from './importer.js';
import { addMonths, monthEnd, monthOf, monthStart } from './periods.js';
import { parseSie } from './sie.js';
import { COMPANIES, emptyConfig, type CompanyData, type CompanyId, type Dataset, type EkonomiConfig, type LedgerItem } from './types.js';

export interface TestVoucher {
  series: string;
  number: number;
  date: string;
  text: string;
  /** [konto, belopp i öre (debet +)] */
  rows: [string, number][];
  refType?: string;
  refNumber?: string;
}

const fmt = (ore: number) => `${ore < 0 ? '-' : ''}${Math.floor(Math.abs(ore) / 100)}.${String(Math.abs(ore) % 100).padStart(2, '0')}`;
const d8 = (iso: string) => iso.replace(/-/g, '');

/** Bygg en SIE 4-fil. #UB och #RES räknas fram ur IB + verifikationer om de inte anges. */
export function buildSie(opts: {
  orgNumber: string;
  name: string;
  from: string;
  to: string;
  accounts?: Record<string, string>;
  ib?: Record<string, number>;
  vouchers: TestVoucher[];
  ub?: Record<string, number>;
  res?: Record<string, number>;
}): string {
  const lines = ['#FLAGGA 0', '#FORMAT PC8', '#SIETYP 4', '#PROGRAM "TESTDATA" 1.0', `#GEN ${d8(opts.to)}`, `#FNAMN "${opts.name}"`, `#ORGNR ${opts.orgNumber}`, `#RAR 0 ${d8(opts.from)} ${d8(opts.to)}`];
  const used = new Set<string>(Object.keys(opts.ib ?? {}));
  for (const v of opts.vouchers) for (const [a] of v.rows) used.add(a);
  for (const a of [...used].sort()) lines.push(`#KONTO ${a} "${opts.accounts?.[a] ?? TEST_ACCOUNT_NAMES[a] ?? `Testkonto ${a}`}"`);
  const ub: Record<string, number> = {};
  const res: Record<string, number> = {};
  for (const [a, v] of Object.entries(opts.ib ?? {})) {
    lines.push(`#IB 0 ${a} ${fmt(v)}`);
    ub[a] = v;
  }
  for (const v of opts.vouchers) {
    for (const [a, amount] of v.rows) {
      if (Number(a) < 3000) ub[a] = (ub[a] ?? 0) + amount;
      else res[a] = (res[a] ?? 0) + amount;
    }
  }
  for (const [a, v] of Object.entries(opts.ub ?? ub)) lines.push(`#UB 0 ${a} ${fmt(v)}`);
  for (const [a, v] of Object.entries(opts.res ?? res)) lines.push(`#RES 0 ${a} ${fmt(v)}`);
  for (const v of opts.vouchers) {
    lines.push(`#VER "${v.series}" ${v.number} ${d8(v.date)} "${v.text}" ${d8(v.date)}`, '{');
    for (const [a, amount] of v.rows) lines.push(`   #TRANS ${a} {} ${fmt(amount)}`);
    lines.push('}');
  }
  return lines.join('\r\n') + '\r\n';
}

export const TEST_ACCOUNT_NAMES: Record<string, string> = {
  '1510': 'Kundfordringar',
  '1660': 'Kortfristiga fordringar hos närstående bolag',
  '1930': 'Företagskonto',
  '2081': 'Aktiekapital',
  '2091': 'Balanserad vinst eller förlust',
  '2099': 'Årets resultat',
  '2440': 'Leverantörsskulder',
  '2611': 'Utgående moms 25 %',
  '2641': 'Debiterad ingående moms',
  '2710': 'Personalskatt',
  '2731': 'Avräkning lagstadgade sociala avgifter',
  '2860': 'Kortfristiga skulder till närstående bolag',
  '2920': 'Upplupna semesterlöner',
  '3001': 'Försäljning tjänster 25 % moms',
  '3010': 'Fakturerad personal, närstående bolag',
  '4600': 'Köpta tjänster, närstående bolag',
  '5010': 'Lokalhyra',
  '6540': 'IT-tjänster',
  '7010': 'Löner',
  '7090': 'Förändring av semesterlöneskuld',
  '7510': 'Arbetsgivaravgifter',
  '7832': 'Avskrivningar inventarier',
  '8310': 'Ränteintäkter från närstående bolag',
  '8410': 'Räntekostnader till närstående bolag',
  '8999': 'Årets resultat',
};

/** Hjälpare: importera en uppsättning verifikationer som ett räkenskapsår. */
export function importYear(
  c: CompanyData,
  y: { fyId: number; from: string; to: string; ib?: Record<string, number>; vouchers: TestVoucher[]; importedAt: string; ub?: Record<string, number>; res?: Record<string, number>; accounts?: Record<string, string> }
): CompanyData {
  const sie = parseSie(buildSie({ orgNumber: COMPANIES[c.id].orgNumber, name: COMPANIES[c.id].name, ...y }));
  const refs = new Map(y.vouchers.filter((v) => v.refType).map((v) => [`${v.series}|${v.number}`, { refType: v.refType, refNumber: v.refNumber }]));
  const imp: FiscalYearImport = { companyId: c.id, fyId: y.fyId, from: y.from, to: y.to, sie, voucherRefs: refs, apiVoucherCount: y.vouchers.length, importedAt: y.importedAt };
  return applyFiscalYearImport(c, imp).company;
}

const K = 100_00; // en hundralapp i öre, för läsbarhet nedan (1 K = 100 kr)

interface Year {
  fyId: number;
  from: string;
  to: string;
}

function yearsFor(startMonth: string, endDate: string): Year[] {
  const out: Year[] = [];
  let from = startMonth;
  for (let id = 1; monthStart(from) <= endDate; id++) {
    const to = addMonths(from, 11);
    out.push({ fyId: id, from: monthStart(from), to: monthEnd(to) });
    from = addMonths(from, 12);
  }
  return out;
}

/**
 * Bygg testdataset fram till `now`. Stodona AB antas ha kalenderår och
 * Stodona Services AB brutet räkenskapsår maj–april (ANTAGANDE för test).
 */
export function buildTestDataset(now: string): { ds: Dataset; cfg: EkonomiConfig; ledgerLoaded: Record<CompanyId, boolean> } {
  const today = now.slice(0, 10);
  const firstMonth = '2025-01';
  const lastMonth = monthOf(today);
  const perCompany: Record<CompanyId, TestVoucher[]> = { stodona_ab: [], stodona_services: [] };
  const ledger: Record<CompanyId, LedgerItem[]> = { stodona_ab: [], stodona_services: [] };
  let n = 0;
  const add = (id: CompanyId, v: Omit<TestVoucher, 'number'>) => perCompany[id].push({ ...v, number: perCompany[id].filter((x) => x.series === v.series).length + 1 });

  // Startkapital bokas som första verifikation i respektive bolag.
  add('stodona_ab', { series: 'M', date: '2025-01-02', text: 'TEST Insatt kapital', rows: [['1930', 5000 * K], ['2081', -5000 * K]] });
  add('stodona_services', { series: 'M', date: '2025-01-02', text: 'TEST Insatt kapital', rows: [['1930', 3000 * K], ['2081', -3000 * K]] });
  // Internt lån: Services lånar ut 2 000 K till AB.
  add('stodona_services', { series: 'M', date: '2025-02-10', text: 'TEST Lån till Stodona AB', rows: [['1660', 2000 * K], ['1930', -2000 * K]] });
  add('stodona_ab', { series: 'M', date: '2025-02-10', text: 'TEST Lån från Stodona Services AB', rows: [['1930', 2000 * K], ['2860', -2000 * K]] });

  for (let m = firstMonth; m <= lastMonth; m = addMonths(m, 1)) {
    n++;
    const d = (day: number) => {
      const date = `${m}-${String(day).padStart(2, '0')}`;
      return date > today ? today : date;
    };
    if (monthStart(m) > today) break;
    const season = [0, 2, 4, 6, 8, 6, -4, 2, 6, 8, 6, 4][Number(m.slice(5)) - 1];
    const sales = (9000 + n * 60 + season * 100) * K; // extern försäljning exkl. moms
    const staffAb = Math.round(sales * 0.16);
    const staffSv = Math.round(sales * 0.38);
    const feeAb = Math.round(staffAb * 0.3142);
    const feeSv = Math.round(staffSv * 0.3142);
    const internal = Math.round((staffSv + feeSv) * 1.1); // självkostnad + 10 % påslag
    const vat = (x: number) => Math.round(x * 0.25);

    // Stodona AB: extern försäljning
    add('stodona_ab', { series: 'A', date: d(28), text: `TEST Kundfakturor ${m}`, rows: [['1510', sales + vat(sales)], ['3001', -sales], ['2611', -vat(sales)]] });
    add('stodona_ab', { series: 'B', date: d(27), text: `TEST Inbetalningar kunder ${m}`, rows: [['1930', Math.round((sales + vat(sales)) * 0.96)], ['1510', -Math.round((sales + vat(sales)) * 0.96)]] });
    add('stodona_ab', { series: 'L', date: d(25), text: `TEST Löner ${m}`, rows: [['7010', staffAb], ['7510', feeAb], ['2710', -Math.round(staffAb * 0.3)], ['2731', -feeAb], ['1930', -(staffAb - Math.round(staffAb * 0.3))]] });
    add('stodona_ab', { series: 'C', date: d(5), text: `TEST Hyra och IT ${m}`, rows: [['5010', 450 * K], ['6540', 180 * K], ['2641', vat(630 * K)], ['1930', -(630 * K + vat(630 * K))]] });
    add('stodona_ab', { series: 'M', date: d(28), text: `TEST Avskrivning ${m}`, rows: [['7832', 60 * K], ['1930', -60 * K]] });
    add('stodona_ab', { series: 'M', date: d(12), text: `TEST Betald skatt och moms ${m}`, rows: [['2710', Math.round(staffAb * 0.3)], ['2731', feeAb], ['2611', vat(sales)], ['2641', -vat(630 * K) - vat(internal)], ['1930', -(Math.round(staffAb * 0.3) + feeAb + vat(sales) - vat(630 * K) - vat(internal))]] });

    // Stodona Services AB: löner + intern fakturering av personal till AB
    add('stodona_services', { series: 'L', date: d(25), text: `TEST Löner ${m}`, rows: [['7010', staffSv], ['7510', feeSv], ['2710', -Math.round(staffSv * 0.3)], ['2731', -feeSv], ['1930', -(staffSv - Math.round(staffSv * 0.3))]] });
    add('stodona_services', { series: 'M', date: d(12), text: `TEST Betald skatt och moms ${m}`, rows: [['2710', Math.round(staffSv * 0.3)], ['2731', feeSv], ['2611', vat(internal)], ['1930', -(Math.round(staffSv * 0.3) + feeSv + vat(internal))]] });

    const invNo = String(1000 + n);
    // Scenario: fakturan för 2026-06 bokförs av Services först i juli (olika bokföringsmånad).
    const svDate = m === '2026-06' && addMonths(m, 1) <= lastMonth ? `${addMonths(m, 1)}-02` : d(28);
    add('stodona_services', { series: 'A', date: svDate, text: `TEST Internfaktura ${invNo} personal ${m}`, rows: [['1510', internal + vat(internal)], ['3010', -internal], ['2611', -vat(internal)]], refType: 'INVOICE', refNumber: invNo });
    // Scenario: 2026-03 bokför AB fakturan 500 kr för lågt (beloppsskillnad).
    const abCost = m === '2026-03' ? internal - 5 * K : internal;
    add('stodona_ab', { series: 'C', date: d(28), text: `TEST Leverantörsfaktura ${invNo} Stodona Services ${m}`, rows: [['4600', abCost], ['2641', vat(internal)], ['2440', -(abCost + vat(internal))]], refType: 'SUPPLIERINVOICE', refNumber: `L${invNo}` });
    const paid = addMonths(m, 1) <= lastMonth;
    if (paid) {
      add('stodona_ab', { series: 'M', date: d(28), text: `TEST Betalning internfaktura ${invNo}`, rows: [['2440', abCost + vat(internal)], ['1930', -(abCost + vat(internal))]] });
      add('stodona_services', { series: 'B', date: d(28), text: `TEST Inbetalning internfaktura ${invNo}`, rows: [['1930', abCost + vat(internal)], ['1510', -(abCost + vat(internal))]] });
    }
    ledger.stodona_services.push({ companyId: 'stodona_services', kind: 'customer', docNumber: invNo, externalRef: invNo, counterpartyNumber: '1', counterpartyName: 'TEST Stodona AB', invoiceDate: svDate, dueDate: svDate, total: internal + vat(internal), balance: paid ? internal - abCost : internal + vat(internal), currency: 'SEK', booked: true, cancelled: false, isCredit: false });
    ledger.stodona_ab.push({ companyId: 'stodona_ab', kind: 'supplier', docNumber: `L${invNo}`, externalRef: invNo, counterpartyNumber: '900', counterpartyName: 'TEST Stodona Services AB', invoiceDate: d(28), dueDate: d(28), total: abCost + vat(internal), balance: paid ? 0 : abCost + vat(internal), currency: 'SEK', booked: true, cancelled: false, isCredit: false });
  }

  // Scenario: kreditfaktura till extern kund.
  if ('2026-05-15' <= today) add('stodona_ab', { series: 'A', date: '2026-05-15', text: 'TEST Kreditfaktura extern kund', rows: [['1510', -250 * K], ['3001', 200 * K], ['2611', 50 * K]] });
  // Scenario: nytt, omappat konto dyker upp.
  if ('2026-08-20' <= today) add('stodona_services', { series: 'M', date: '2026-08-20', text: 'TEST Bokning på nytt konto', rows: [['8590', 12 * K], ['1930', -12 * K]] });

  // Externa reskontraposter (TEST)
  const ext = (i: number, daysAgo: number, total: number): LedgerItem => {
    const due = new Date(Date.parse(today) - daysAgo * 86_400_000).toISOString().slice(0, 10);
    return { companyId: 'stodona_ab', kind: 'customer', docNumber: String(5000 + i), externalRef: String(5000 + i), counterpartyNumber: String(200 + i), counterpartyName: `TESTKUND ${i}`, invoiceDate: due, dueDate: due, total, balance: total, currency: 'SEK', booked: true, cancelled: false, isCredit: false };
  };
  ledger.stodona_ab.push(ext(1, 95, 42 * K), ext(2, 40, 118 * K), ext(3, 12, 64 * K), ext(4, 3, 230 * K), ext(5, -10, 1450 * K), ext(6, -20, 2210 * K));
  const sup = (id: CompanyId, i: number, daysAhead: number, total: number): LedgerItem => {
    const due = new Date(Date.parse(today) + daysAhead * 86_400_000).toISOString().slice(0, 10);
    return { companyId: id, kind: 'supplier', docNumber: `L${7000 + i}`, externalRef: `F${i}`, counterpartyNumber: String(300 + i), counterpartyName: `TESTLEVERANTÖR ${i}`, invoiceDate: today, dueDate: due, total, balance: total, currency: 'SEK', booked: true, cancelled: false, isCredit: false };
  };
  ledger.stodona_ab.push(sup('stodona_ab', 1, -4, 85 * K), sup('stodona_ab', 2, 5, 787 * K), sup('stodona_ab', 3, 21, 240 * K));
  ledger.stodona_services.push(sup('stodona_services', 4, 9, 36 * K));

  // Dela upp per räkenskapsår och importera via SIE-tolken.
  const fy: Record<CompanyId, Year[]> = { stodona_ab: yearsFor('2025-01', today), stodona_services: [{ fyId: 1, from: '2024-05-01', to: '2025-04-30' }, ...yearsFor('2025-05', today).map((y) => ({ ...y, fyId: y.fyId + 1 }))] };
  const companies = {} as Record<CompanyId, CompanyData>;
  for (const id of ['stodona_ab', 'stodona_services'] as CompanyId[]) {
    let c = emptyCompany(id);
    let ib: Record<string, number> = {};
    for (const y of fy[id]) {
      const vouchers = perCompany[id].filter((v) => v.date >= y.from && v.date <= y.to);
      // Bokslut för avslutade år: årets resultat förs till eget kapital (8999 / 2099).
      if (y.to < today) {
        const result = vouchers.reduce((s, v) => s + v.rows.filter(([a]) => Number(a) >= 3000).reduce((t, [, amt]) => t + amt, 0), 0);
        vouchers.push({ series: 'M', number: 9000 + y.fyId, date: y.to, text: 'TEST Bokslut: årets resultat', rows: [['8999', -result], ['2099', result]] });
      }
      c = importYear(c, { ...y, ib, vouchers, importedAt: now });
      const next: Record<string, number> = { ...ib };
      for (const v of vouchers) for (const [a, amt] of v.rows) if (Number(a) < 3000) next[a] = (next[a] ?? 0) + amt;
      // Vid årsskiftet flyttas årets resultat (2099) till balanserat resultat (2091).
      if (next['2099']) {
        next['2091'] = (next['2091'] ?? 0) + next['2099'];
        delete next['2099'];
      }
      ib = next;
    }
    c.ledger = ledger[id];
    c.sync = { lastAttemptAt: now, lastSuccessAt: now, lastError: null, lockedUntil: null };
    companies[id] = c;
  }

  const cfg = emptyConfig();
  cfg.internalRules = [
    { id: 'test-1', companyId: 'stodona_services', type: 'counterparty', ledger: 'customer', counterpartyNumber: '1', group: 'personaluthyrning', note: 'TEST: kundnummer 1 = Stodona AB', active: true },
    { id: 'test-2', companyId: 'stodona_ab', type: 'counterparty', ledger: 'supplier', counterpartyNumber: '900', group: 'personaluthyrning', note: 'TEST: leverantörsnummer 900 = Stodona Services AB', active: true },
    { id: 'test-3', companyId: 'stodona_services', type: 'account', account: '1660', group: 'lån', note: 'TEST: fordran på Stodona AB', active: true },
    { id: 'test-4', companyId: 'stodona_ab', type: 'account', account: '2860', group: 'lån', note: 'TEST: skuld till Stodona Services AB', active: true },
  ];
  cfg.mappingReviewedAt = null;
  return { ds: { isTestData: true, companies }, cfg, ledgerLoaded: { stodona_ab: true, stodona_services: true } };
}
