/**
 * Tester för ekonomiuppföljningen. All data här är TESTDATA.
 * Kör: bun test api/_lib/ekonomi
 */
// @ts-ignore — bun:test finns bara när testerna körs med bun
import { describe, expect, test } from 'bun:test';
import { buildBalanceReport, buildResultReport, balancesAt } from './report.js';
import { monthHash, reconcileCompany, verify } from './checks.js';
import { applyFiscalYearImport, emptyCompany, ImportError } from './importer.js';
import { AccountMapper } from './mapping.js';
import { parseOre } from './money.js';
import { previousYear, resolvePeriod } from './periods.js';
import { buildLedgerOverview, buildLiquidity } from './overview.js';
import { decodeCp437, parseSie } from './sie.js';
import { buildSie, buildTestDataset, importYear, type TestVoucher } from './testdata.js';
import { COMPANIES, emptyConfig, type CompanyData, type Dataset, type EkonomiConfig, type InternalRule } from './types.js';

const NOW = '2026-10-02T08:00:00.000Z';
const kr = (n: number) => n * 100;

function synced(c: CompanyData, at = NOW): CompanyData {
  return { ...c, sync: { lastAttemptAt: at, lastSuccessAt: at, lastError: null, lockedUntil: null } };
}
function dataset(ab: CompanyData, services: CompanyData): Dataset {
  return { isTestData: true, companies: { stodona_ab: ab, stodona_services: services } };
}
const row = (rep: { rows: { id: string }[] }, id: string) => rep.rows.find((r) => r.id === id) as any;

const staffingRules: InternalRule[] = [
  { id: 'r1', companyId: 'stodona_services', type: 'account', account: '3010', group: 'personal', note: '', active: true },
  { id: 'r2', companyId: 'stodona_ab', type: 'account', account: '4600', group: 'personal', note: '', active: true },
];

/** Minsta gemensamma upplägg: AB kalenderår 2026, Services maj–april. */
function baseSetup(abVouchers: TestVoucher[], svVouchersFy1: TestVoucher[], svVouchersFy2: TestVoucher[] = []) {
  const ab = synced(importYear(emptyCompany('stodona_ab'), { fyId: 1, from: '2026-01-01', to: '2026-12-31', vouchers: abVouchers, importedAt: NOW }));
  let sv = importYear(emptyCompany('stodona_services'), { fyId: 1, from: '2025-05-01', to: '2026-04-30', vouchers: svVouchersFy1, importedAt: NOW });
  sv = synced(importYear(sv, { fyId: 2, from: '2026-05-01', to: '2027-04-30', vouchers: svVouchersFy2, importedAt: NOW }));
  return dataset(ab, sv);
}

describe('belopp och perioder', () => {
  test('belopp tolkas exakt till öre', () => {
    expect(parseOre('1234.56')).toBe(123456);
    expect(parseOre('-0.05')).toBe(-5);
    expect(parseOre('100')).toBe(10000);
    expect(parseOre('7.1')).toBe(710);
    expect(parseOre(1234.56)).toBe(123456);
    expect(() => parseOre('abc')).toThrow();
  });

  test('perioder: månad, R12, kalenderår hittills och föregående år', () => {
    expect(resolvePeriod({ type: 'month', month: '2024-02' })).toMatchObject({ from: '2024-02-01', to: '2024-02-29' });
    expect(resolvePeriod({ type: 'r12', asOf: '2026-09-15' })).toMatchObject({ from: '2025-10-01', to: '2026-09-30' });
    expect(resolvePeriod({ type: 'ytd', asOf: '2026-09-15' })).toMatchObject({ from: '2026-01-01', to: '2026-09-15' });
    const feb = resolvePeriod({ type: 'month', month: '2024-02' });
    expect(previousYear(feb)).toMatchObject({ from: '2023-02-01', to: '2023-02-28' });
    expect(resolvePeriod({ type: 'fiscal', companyId: 'stodona_services', asOf: '2026-06-10' }, [{ fyId: 2, from: '2026-05-01', to: '2027-04-30', importedAt: NOW }])).toMatchObject({ from: '2026-05-01', to: '2026-06-10' });
    expect(() => resolvePeriod({ type: 'range', from: '2026-02-30', to: '2026-03-01' })).toThrow();
  });
});

describe('SIE-tolk', () => {
  test('CP437-tabellen är komplett och å/ä/ö avkodas', () => {
    const all = decodeCp437(Uint8Array.from({ length: 128 }, (_, i) => i + 128));
    expect(all.length).toBe(128);
    expect(decodeCp437(Uint8Array.from([0x86, 0x84, 0x94, 0x8f, 0x8e, 0x99]))).toBe('åäöÅÄÖ');
  });

  test('borttagna rader (#BTRANS) räknas inte och #RTRANS dubbelräknas inte', () => {
    const sie = parseSie(
      ['#SIETYP 4', '#ORGNR 559201-1059', '#RAR 0 20260101 20261231', '#KONTO 5010 "Lokalhyra \\"kontor\\""', '#VER "A" 1 20260110 "Rättad ver" 20260111', '{', '#BTRANS 5010 {} 100.00', '#RTRANS 5010 {} 150.00', '#TRANS 5010 {} 150.00', '#TRANS 1930 {1 "KS1" 6 "P7"} -150.00 20260110 "Betalning"', '}'].join('\n')
    );
    expect(sie.vouchers).toHaveLength(1);
    expect(sie.vouchers[0].rows.map((r) => r.amount)).toEqual([15000, -15000]);
    expect(sie.vouchers[0].rows[1]).toMatchObject({ costCenter: 'KS1', project: 'P7', text: 'Betalning' });
    expect(sie.accounts['5010'].name).toBe('Lokalhyra "kontor"');
  });

  test('avbruten fil ger varning och importen stoppas', () => {
    const c = emptyCompany('stodona_ab');
    const sie = parseSie('#ORGNR 559201-1059\n#RAR 0 20260101 20261231\n#VER "A" 1 20260110 "x"\n{\n#TRANS 1930 {} 1.00\n');
    expect(sie.warnings.length).toBe(1);
    expect(() => applyFiscalYearImport(c, { companyId: 'stodona_ab', fyId: 1, from: '2026-01-01', to: '2026-12-31', sie, importedAt: NOW })).toThrow(ImportError);
  });

  test('fil från fel bolag avvisas', () => {
    const sie = parseSie(buildSie({ orgNumber: COMPANIES.stodona_services.orgNumber, name: 'x', from: '2026-01-01', to: '2026-12-31', vouchers: [] }));
    expect(() => applyFiscalYearImport(emptyCompany('stodona_ab'), { companyId: 'stodona_ab', fyId: 1, from: '2026-01-01', to: '2026-12-31', sie, importedAt: NOW })).toThrow(/Fel bolag/);
  });
});

describe('acceptanskriterier', () => {
  test('1. period som passerar ett bolags bokslut blir korrekt', () => {
    // Services har bokslut 30 april. Perioden mars–juni passerar bokslutet.
    const ds = baseSetup(
      [],
      [
        { series: 'L', number: 1, date: '2026-03-25', text: 'Löner mars', rows: [['7010', kr(100)], ['1930', kr(-100)]] },
        { series: 'L', number: 2, date: '2026-04-25', text: 'Löner april', rows: [['7010', kr(110)], ['1930', kr(-110)]] },
        // Bokslutsverifikation: årets resultat förs om. Får inte påverka resultatet.
        { series: 'M', number: 1, date: '2026-04-30', text: 'Årets resultat', rows: [['8999', kr(-210)], ['2099', kr(210)]] },
      ],
      [
        { series: 'L', number: 1, date: '2026-05-25', text: 'Löner maj', rows: [['7010', kr(120)], ['1930', kr(-120)]] },
        { series: 'L', number: 2, date: '2026-06-25', text: 'Löner juni', rows: [['7010', kr(130)], ['1930', kr(-130)]] },
      ]
    );
    const rep = buildResultReport(ds, emptyConfig(), resolvePeriod({ type: 'range', from: '2026-03-01', to: '2026-06-30' }), NOW);
    expect(row(rep, 'PERSONAL').services).toBe(kr(-460));
    expect(row(rep, 'RORELSERESULTAT').services).toBe(kr(-460));
    expect(row(rep, 'PERIODENS_RESULTAT').services).toBe(kr(-460));
    expect(rep.excludedResultTransfer.stodona_services).toBe(kr(210));
    // Enbart maj (nytt räkenskapsår) innehåller inget från det gamla året.
    const maj = buildResultReport(ds, emptyConfig(), resolvePeriod({ type: 'month', month: '2026-05' }), NOW);
    expect(row(maj, 'PERSONAL').services).toBe(kr(-120));
  });

  test('2. intern faktura med påslag elimineras — påslaget blir inte vinst, externa löner ligger kvar', () => {
    const ds = baseSetup(
      [
        { series: 'A', number: 1, date: '2026-03-28', text: 'Extern försäljning', rows: [['1510', kr(1250)], ['3001', kr(-1000)], ['2611', kr(-250)]] },
        { series: 'C', number: 1, date: '2026-03-28', text: 'Internfaktura från Services', rows: [['4600', kr(550)], ['2641', kr(137.5)], ['2440', kr(-687.5)]] },
      ],
      [
        { series: 'L', number: 1, date: '2026-03-25', text: 'Löner (externa)', rows: [['7010', kr(500)], ['1930', kr(-500)]] },
        { series: 'A', number: 1, date: '2026-03-28', text: 'Internfaktura till AB, självkostnad 500 + 10 %', rows: [['1510', kr(687.5)], ['3010', kr(-550)], ['2611', kr(-137.5)]] },
      ]
    );
    const cfg = { ...emptyConfig(), internalRules: staffingRules };
    const rep = buildResultReport(ds, cfg, resolvePeriod({ type: 'month', month: '2026-03' }), NOW);
    expect(row(rep, 'NETTOOMSATTNING')).toMatchObject({ ab: kr(1000), services: kr(550), elimination: kr(-550), total: kr(1000) });
    expect(row(rep, 'DIREKTA_KOSTNADER')).toMatchObject({ ab: kr(-550), services: 0, elimination: kr(550), total: 0 });
    expect(row(rep, 'PERSONAL')).toMatchObject({ ab: 0, services: kr(-500), elimination: 0, total: kr(-500) });
    // Bolagen var för sig: AB 450, Services 50 (påslaget). Helheten: 1000 − 500 = 500.
    expect(row(rep, 'RORELSERESULTAT')).toMatchObject({ ab: kr(450), services: kr(50), elimination: 0, total: kr(500) });
    expect(row(rep, 'RORELSEMARGINAL').total).toBe(50);
    expect(rep.eliminationDifference).toBe(0);
    expect(rep.internalIssues).toHaveLength(0);
  });

  test('3. intern faktura bokförd i olika månader flaggas — och matchning tvingas inte fram', () => {
    const ds = baseSetup(
      [{ series: 'C', number: 1, date: '2026-03-28', text: 'Internfaktura', rows: [['4600', kr(550)], ['2440', kr(-550)]] }],
      [
        { series: 'A', number: 1, date: '2026-04-02', text: 'Internfaktura (bokförd i april)', rows: [['1510', kr(550)], ['3010', kr(-550)]] },
        { series: 'A', number: 2, date: '2026-03-15', text: 'Annan intern post utan motpost', rows: [['1510', kr(70)], ['3010', kr(-70)]] },
      ]
    );
    const cfg = { ...emptyConfig(), internalRules: staffingRules };
    const mars = buildResultReport(ds, cfg, resolvePeriod({ type: 'month', month: '2026-03' }), NOW);
    expect(mars.internalIssues.map((i) => i.type).sort()).toEqual(['OLIKA_MANAD', 'SAKNAR_MOTPOST']);
    expect(mars.internalIssues.find((i) => i.type === 'SAKNAR_MOTPOST')!.difference).toBe(kr(70));
    // Varje sida elimineras med sitt eget belopp i sin egen månad: totalen visar bara externa poster.
    expect(row(mars, 'NETTOOMSATTNING').total).toBe(0);
    expect(row(mars, 'DIREKTA_KOSTNADER').total).toBe(0);
    expect(mars.eliminationDifference).toBe(kr(550 - 70));
    const v = verify(ds, cfg, mars, null);
    expect(v.checks.find((c) => c.id === 'interna_poster')!.status).toBe('fel');
    // Över båda månaderna tar posterna ut varandra, förutom den omatchade.
    const q = buildResultReport(ds, cfg, resolvePeriod({ type: 'range', from: '2026-03-01', to: '2026-04-30' }), NOW);
    expect(q.eliminationDifference).toBe(kr(-70));
  });

  test('3b. beloppsskillnad på samma fakturanummer flaggas med differens', () => {
    const ds = baseSetup(
      [{ series: 'C', number: 1, date: '2026-03-28', text: 'Internfaktura 77', rows: [['4010', kr(545)], ['2440', kr(-545)]], refType: 'SUPPLIERINVOICE', refNumber: 'L1' }],
      [{ series: 'A', number: 1, date: '2026-03-28', text: 'Internfaktura 77', rows: [['1510', kr(550)], ['3001', kr(-550)]], refType: 'INVOICE', refNumber: '77' }]
    );
    ds.companies.stodona_ab.ledger = [{ companyId: 'stodona_ab', kind: 'supplier', docNumber: 'L1', externalRef: '77', counterpartyNumber: '900', counterpartyName: 'TEST', invoiceDate: '2026-03-28', dueDate: '2026-04-27', total: kr(545), balance: kr(545), currency: 'SEK', booked: true, cancelled: false, isCredit: false }];
    ds.companies.stodona_services.ledger = [{ companyId: 'stodona_services', kind: 'customer', docNumber: '77', externalRef: '77', counterpartyNumber: '1', counterpartyName: 'TEST', invoiceDate: '2026-03-28', dueDate: '2026-04-27', total: kr(550), balance: kr(550), currency: 'SEK', booked: true, cancelled: false, isCredit: false }];
    const cfg: EkonomiConfig = {
      ...emptyConfig(),
      internalRules: [
        { id: 'c1', companyId: 'stodona_ab', type: 'counterparty', ledger: 'supplier', counterpartyNumber: '900', group: 'personal', note: '', active: true },
        { id: 'c2', companyId: 'stodona_services', type: 'counterparty', ledger: 'customer', counterpartyNumber: '1', group: 'personal', note: '', active: true },
      ],
    };
    const rep = buildResultReport(ds, cfg, resolvePeriod({ type: 'month', month: '2026-03' }), NOW);
    expect(rep.internalIssues).toHaveLength(1);
    expect(rep.internalIssues[0]).toMatchObject({ type: 'BELOPPSSKILLNAD', difference: kr(5) });
    expect(row(rep, 'NETTOOMSATTNING').total).toBe(0);
    // Interna reskontraposter hålls utanför externa kundfordringar.
    const led = buildLedgerOverview(ds, cfg, '2026-05-10', { stodona_ab: true, stodona_services: true });
    expect(led.receivables[1]).toMatchObject({ total: 0, internalTotal: kr(550) });
  });

  test('4. kreditfaktura och efterregistrerad rättelse hanteras och ändringen synliggörs', () => {
    const feb: TestVoucher[] = [
      { series: 'A', number: 1, date: '2026-02-10', text: 'Faktura', rows: [['1510', kr(1000)], ['3001', kr(-1000)]] },
      { series: 'A', number: 2, date: '2026-02-20', text: 'Kreditfaktura', rows: [['1510', kr(-300)], ['3001', kr(300)]] },
    ];
    const year = { fyId: 1, from: '2026-01-01', to: '2026-12-31' };
    let ab = synced(importYear(emptyCompany('stodona_ab'), { ...year, vouchers: feb, importedAt: '2026-03-05T08:00:00.000Z' }));
    const sv = synced(emptyCompany('stodona_services'));
    const period = resolvePeriod({ type: 'month', month: '2026-02' });
    const before = buildResultReport(dataset(ab, sv), emptyConfig(), period, NOW);
    expect(row(before, 'NETTOOMSATTNING').ab).toBe(kr(700));

    // Februari märks som avstämd.
    const cfg: EkonomiConfig = { ...emptyConfig(), periodStatuses: [{ companyId: 'stodona_ab', month: '2026-02', status: 'avstamd', dataHash: monthHash(ab, '2026-02'), markedAt: '2026-03-06T08:00:00.000Z' }] };

    // I april efterregistreras en rättelse daterad i februari, och ver A1 ändras.
    const corrected: TestVoucher[] = [{ ...feb[0], rows: [['1510', kr(1100)], ['3001', kr(-1100)]] }, feb[1], { series: 'A', number: 3, date: '2026-02-27', text: 'Efterregistrerad faktura', rows: [['1510', kr(50)], ['3001', kr(-50)]] }];
    const sie = parseSie(buildSie({ orgNumber: COMPANIES.stodona_ab.orgNumber, name: 'Stodona AB', ...year, vouchers: corrected }));
    const res = applyFiscalYearImport(ab, { companyId: 'stodona_ab', ...year, sie, importedAt: '2026-04-10T08:00:00.000Z' });
    ab = synced(res.company);
    expect(res.changes.map((c) => `${c.type}:${c.series}${c.number}`).sort()).toEqual(['andrad:A1', 'ny:A3']);
    expect(res.changes.find((c) => c.type === 'andrad')!.delta).toEqual({ '1510': kr(100), '3001': kr(-100) });

    const ds = dataset(ab, sv);
    const after = buildResultReport(ds, cfg, period, NOW);
    expect(row(after, 'NETTOOMSATTNING').ab).toBe(kr(850));
    const v = verify(ds, cfg, after, null);
    expect(v.months.find((m) => m.companyId === 'stodona_ab')).toMatchObject({ status: 'avstamd', changedAfterMark: true });
    expect(v.checks.find((c) => c.id === 'andringar_i_avstamda_perioder')!.status).toBe('fel');
    expect(v.status).not.toBe('verifierad');
  });

  test('5. upprepad import ger samma resultat utan dubbletter', () => {
    const vouchers: TestVoucher[] = [
      { series: 'A', number: 1, date: '2026-02-10', text: 'Faktura', rows: [['1510', kr(1000)], ['3001', kr(-1000)]] },
      { series: 'B', number: 1, date: '2026-02-15', text: 'Betalning', rows: [['1930', kr(1000)], ['1510', kr(-1000)]] },
    ];
    const year = { fyId: 1, from: '2026-01-01', to: '2026-12-31' };
    const sie = () => parseSie(buildSie({ orgNumber: COMPANIES.stodona_ab.orgNumber, name: 'Stodona AB', ...year, vouchers }));
    const first = applyFiscalYearImport(emptyCompany('stodona_ab'), { companyId: 'stodona_ab', ...year, sie: sie(), importedAt: NOW });
    const second = applyFiscalYearImport(first.company, { companyId: 'stodona_ab', ...year, sie: sie(), importedAt: '2026-10-03T08:00:00.000Z' });
    const third = applyFiscalYearImport(second.company, { companyId: 'stodona_ab', ...year, sie: sie(), importedAt: '2026-10-04T08:00:00.000Z' });
    expect(third.company.vouchers).toHaveLength(2);
    expect(second.changes).toHaveLength(0);
    expect(third.changes).toHaveLength(0);
    expect(monthHash(third.company, '2026-02')).toBe(monthHash(first.company, '2026-02'));
    const p = resolvePeriod({ type: 'month', month: '2026-02' });
    const r1 = buildResultReport(dataset(synced(first.company), synced(emptyCompany('stodona_services'))), emptyConfig(), p, NOW);
    const r3 = buildResultReport(dataset(synced(third.company), synced(emptyCompany('stodona_services'))), emptyConfig(), p, NOW);
    expect(row(r3, 'NETTOOMSATTNING').ab).toBe(kr(1000));
    expect(r3.rows.map((r) => r.ab)).toEqual(r1.rows.map((r) => r.ab));
    // Kontots "först sett" ändras inte av en ny import.
    expect(third.company.accounts['3001'].firstSeenAt).toBe(NOW);
  });

  test('6. ett nytt konto försvinner inte ur rapporteringen', () => {
    const ds = baseSetup(
      [
        { series: 'A', number: 1, date: '2026-03-10', text: 'Försäljning', rows: [['1930', kr(1000)], ['3001', kr(-1000)]] },
        { series: 'M', number: 1, date: '2026-03-11', text: 'Konto utan regel', rows: [['8590', kr(40)], ['1930', kr(-40)]] },
        { series: 'M', number: 2, date: '2026-03-12', text: 'Konto med avvikande nummer', rows: [['X1', kr(7)], ['1930', kr(-7)]] },
      ],
      []
    );
    const cfg = emptyConfig();
    const rep = buildResultReport(ds, cfg, resolvePeriod({ type: 'month', month: '2026-03' }), NOW);
    expect(row(rep, 'OMAPPAT_RR').ab).toBe(kr(-40));
    expect(row(rep, 'RESULTAT_EFTER_FIN').ab).toBe(kr(960));
    expect(rep.accounts.find((a) => a.account === 'X1')).toMatchObject({ category: 'OMAPPAT_OKAND', amount: kr(-7) });
    const v = verify(ds, cfg, rep, null);
    const check = v.checks.find((c) => c.id === 'omappade_konton')!;
    expect(check.status).toBe('fel');
    expect(check.details).toHaveLength(2);
    // Efter uttrycklig mappning hamnar kontot i rätt kategori.
    const mapped = buildResultReport(ds, { ...cfg, mappingOverrides: [{ companyId: null, account: '8590', category: 'FIN_KOSTNADER' }] }, rep.period, NOW);
    expect(row(mapped, 'FIN_KOSTNADER').ab).toBe(kr(-40));
    // Konto som tillkommer efter att mappningen granskats flaggas som nytt.
    const later = importYear(ds.companies.stodona_ab, { fyId: 1, from: '2026-01-01', to: '2026-12-31', importedAt: '2026-11-01T08:00:00.000Z', vouchers: [{ series: 'A', number: 1, date: '2026-03-10', text: 'Försäljning nytt konto', rows: [['1930', kr(1000)], ['3055', kr(-1000)]] }] });
    const rep2 = buildResultReport(dataset(synced(later), ds.companies.stodona_services), { ...cfg, mappingReviewedAt: '2026-10-15T00:00:00.000Z' }, rep.period, NOW);
    expect(rep2.accounts.find((a) => a.account === '3055')).toMatchObject({ isNew: true, mappingStatus: 'regel', category: 'NETTOOMSATTNING' });
    expect(row(rep2, 'NETTOOMSATTNING').ab).toBe(kr(1000));
  });

  test('7. anslutningsfel i ett bolag ger ingen missvisande total', () => {
    const ds = baseSetup([{ series: 'A', number: 1, date: '2026-09-10', text: 'Försäljning', rows: [['1930', kr(1000)], ['3001', kr(-1000)]] }], []);
    // Services: senaste lyckade import var i augusti, därefter fel.
    ds.companies.stodona_services.sync = { lastAttemptAt: NOW, lastSuccessAt: '2026-08-20T08:00:00.000Z', lastError: 'Fortnox svarade 401', lockedUntil: null };
    const rep = buildResultReport(ds, emptyConfig(), resolvePeriod({ type: 'month', month: '2026-09' }), NOW);
    expect(rep.completeness.stodona_services.complete).toBe(false);
    expect(row(rep, 'NETTOOMSATTNING')).toMatchObject({ ab: kr(1000), services: null, elimination: null, total: null });
    expect(row(rep, 'RORELSERESULTAT').total).toBeNull();
    expect(row(rep, 'RORELSEMARGINAL').total).toBeNull();
    // En äldre, redan täckt period visas men med varning om det misslyckade försöket.
    const jul = buildResultReport(ds, emptyConfig(), resolvePeriod({ type: 'month', month: '2026-07' }), NOW);
    expect(jul.completeness.stodona_services).toMatchObject({ complete: true });
    expect(jul.completeness.stodona_services.warnings[0]).toMatch(/misslyckades/);
    // Bolag som aldrig anslutits: allt saknas.
    ds.companies.stodona_services = emptyCompany('stodona_services');
    const none = buildResultReport(ds, emptyConfig(), resolvePeriod({ type: 'month', month: '2026-07' }), NOW);
    expect(row(none, 'RORELSERESULTAT')).toMatchObject({ services: null, total: null });
    expect(buildLiquidity(ds, emptyConfig(), none.period).total).toBeNull();
    expect(buildLedgerOverview(ds, emptyConfig(), '2026-10-02', { stodona_ab: true, stodona_services: false }).receivables[1]).toMatchObject({ available: false, total: null });
  });

  test('8. balansrapporten har korrekta ingående balanser och saldon', () => {
    const ab = synced(
      importYear(emptyCompany('stodona_ab'), {
        fyId: 2,
        from: '2026-01-01',
        to: '2026-12-31',
        ib: { '1930': kr(5000), '2081': kr(-500), '2091': kr(-4500) },
        vouchers: [
          { series: 'A', number: 1, date: '2026-01-20', text: 'Försäljning', rows: [['1930', kr(1000)], ['3001', kr(-1000)]] },
          { series: 'A', number: 2, date: '2026-02-20', text: 'Försäljning', rows: [['1930', kr(2000)], ['3001', kr(-2000)]] },
          { series: 'M', number: 1, date: '2026-02-25', text: 'Lån från Services', rows: [['1930', kr(300)], ['2860', kr(-300)]] },
        ],
        importedAt: NOW,
      })
    );
    const sv = synced(
      importYear(emptyCompany('stodona_services'), {
        fyId: 1,
        from: '2025-05-01',
        to: '2026-04-30',
        ib: { '1930': kr(800), '2081': kr(-800) },
        vouchers: [{ series: 'M', number: 1, date: '2026-02-25', text: 'Lån till AB', rows: [['1660', kr(300)], ['1930', kr(-300)]] }],
        importedAt: NOW,
      })
    );
    const ds = dataset(ab, sv);
    const cfg: EkonomiConfig = {
      ...emptyConfig(),
      internalRules: [
        { id: 'l1', companyId: 'stodona_ab', type: 'account', account: '2860', group: 'lån', note: '', active: true },
        { id: 'l2', companyId: 'stodona_services', type: 'account', account: '1660', group: 'lån', note: '', active: true },
      ],
    };
    // Saldo = IB + rörelser t.o.m. datumet — inte summan av månadssaldon.
    expect(balancesAt(ab, '2026-01-31')!.balances['1930']).toBe(kr(6000));
    expect(balancesAt(ab, '2026-02-28')!.balances['1930']).toBe(kr(8300));
    expect(balancesAt(ab, '2025-12-31')).toBeNull(); // föregående år ej importerat → saknas, inte 0
    const bal = buildBalanceReport(ds, cfg, '2026-02-28');
    expect(row(bal, 'LIKVIDA_MEDEL')).toMatchObject({ ab: kr(8300), services: kr(500), total: kr(8800) });
    expect(row(bal, 'OVRIGA_FORDRINGAR')).toMatchObject({ services: kr(300), elimination: kr(-300), total: 0 });
    expect(row(bal, 'OVRIGA_KORTFRISTIGA_SKULDER')).toMatchObject({ ab: kr(300), elimination: kr(-300), total: 0 });
    expect(row(bal, 'BERAKNAT_RESULTAT')).toMatchObject({ ab: kr(3000), services: 0, total: null });
    expect(bal.balanceCheck).toEqual({ stodona_ab: 0, stodona_services: 0 });
    expect(bal.internalBalances).toEqual([{ group: 'lån', ab: kr(-300), services: kr(300), difference: 0 }]);
    // Likviditet: per bolag, och internt lån påverkar inte verksamhetens kassaflöde.
    const liq = buildLiquidity(ds, cfg, resolvePeriod({ type: 'month', month: '2026-02' }));
    expect(liq.perCompany.map((p) => p.change)).toEqual([kr(2300), kr(-300)]);
    expect(liq.totalChange).toBe(kr(2000));
  });
});

describe('avstämning och verifiering', () => {
  test('differens mot Fortnox saldon upptäcks och blockerar verifiering', () => {
    const vouchers: TestVoucher[] = [{ series: 'A', number: 1, date: '2026-02-10', text: 'Faktura', rows: [['1930', kr(1000)], ['3001', kr(-1000)]] }];
    // Fortnox uppger 1 200 kr på 3001 — en verifikation saknas alltså i importen.
    const ab = synced(importYear(emptyCompany('stodona_ab'), { fyId: 1, from: '2026-01-01', to: '2026-12-31', vouchers, res: { '3001': kr(-1200) }, importedAt: NOW }));
    const checks = reconcileCompany(ab, emptyConfig(), resolvePeriod({ type: 'month', month: '2026-02' }));
    const c = checks.find((x) => x.id === 'saldon_mot_fortnox:stodona_ab')!;
    expect(c.status).toBe('fel');
    expect(c.impact).toBe(kr(200));
    expect(c.details[0]).toMatch(/3001/);
  });

  test('obalanserad verifikation upptäcks', () => {
    const ab = synced(importYear(emptyCompany('stodona_ab'), { fyId: 1, from: '2026-01-01', to: '2026-12-31', vouchers: [{ series: 'A', number: 1, date: '2026-02-10', text: 'Fel', rows: [['1930', kr(1000)], ['3001', kr(-999)]] }], importedAt: NOW }));
    const checks = reconcileCompany(ab, emptyConfig(), resolvePeriod({ type: 'month', month: '2026-02' }));
    expect(checks.find((x) => x.id.startsWith('verifikationer_balanserar'))!.status).toBe('fel');
  });

  test('rapportjustering hålls åtskild och vänds när bokföringen kommer in', () => {
    const ds = baseSetup([], [], [{ series: 'L', number: 1, date: '2026-07-25', text: 'Semesterlöneskuld bokförd i juli', rows: [['7090', kr(80)], ['2920', kr(-80)]] }]);
    const cfg: EkonomiConfig = {
      ...emptyConfig(),
      adjustments: [{ id: 'j1', companyId: 'stodona_services', month: '2026-06', category: 'PERSONAL', amount: kr(-80), source: 'Lönesystemets semesterskuldlista juni', method: 'Skuldförändring enligt lista', motivation: 'Bokförs först i juli', reverseMonth: '2026-07', handling: 'Vänds i juli när posten bokförts', active: true }],
    };
    const jun = buildResultReport(ds, cfg, resolvePeriod({ type: 'month', month: '2026-06' }), NOW);
    expect(row(jun, 'PERSONAL')).toMatchObject({ services: 0, adjustment: kr(-80), total: kr(-80) });
    const jul = buildResultReport(ds, cfg, resolvePeriod({ type: 'month', month: '2026-07' }), NOW);
    expect(row(jul, 'PERSONAL')).toMatchObject({ services: kr(-80), adjustment: kr(80), total: 0 });
    const both = buildResultReport(ds, cfg, resolvePeriod({ type: 'range', from: '2026-06-01', to: '2026-07-31' }), NOW);
    expect(row(both, 'PERSONAL')).toMatchObject({ adjustment: 0, total: kr(-80) }); // ingen dubbelräkning
  });

  test('kan inte bli verifierad utan avstämda perioder och dokumenterad första avstämning', () => {
    const ab = synced(importYear(emptyCompany('stodona_ab'), { fyId: 1, from: '2026-01-01', to: '2026-12-31', vouchers: [{ series: 'A', number: 1, date: '2026-02-10', text: 'Faktura', rows: [['1930', kr(1000)], ['3001', kr(-1000)]] }], importedAt: NOW }));
    const sv = synced(importYear(emptyCompany('stodona_services'), { fyId: 1, from: '2025-05-01', to: '2026-04-30', vouchers: [], importedAt: NOW }));
    const ds: Dataset = { isTestData: false, companies: { stodona_ab: ab, stodona_services: sv } };
    const period = resolvePeriod({ type: 'month', month: '2026-02' });
    const cfg = emptyConfig();
    let v = verify(ds, cfg, buildResultReport(ds, cfg, period, NOW), buildBalanceReport(ds, cfg, period.to));
    expect(v.status).toBe('ej_verifierad');
    expect(v.blockers.join(' ')).toMatch(/preliminär/);
    expect(v.blockers.join(' ')).toMatch(/Inga regler|interna/i);
    // Med allt på plats blir den verifierad.
    cfg.internalRules = staffingRules;
    cfg.initialVerification = { done: true, month: '2026-02' };
    cfg.periodStatuses = [
      { companyId: 'stodona_ab', month: '2026-02', status: 'avstamd', dataHash: monthHash(ab, '2026-02'), markedAt: NOW },
      { companyId: 'stodona_services', month: '2026-02', status: 'avstamd', dataHash: monthHash(sv, '2026-02'), markedAt: NOW },
    ];
    v = verify(ds, cfg, buildResultReport(ds, cfg, period, NOW), buildBalanceReport(ds, cfg, period.to));
    expect(v.blockers).toEqual([]);
    expect(v.status).toBe('verifierad');
  });

  test('mappning: standardregler och gränsfall', () => {
    const m = new AccountMapper([]);
    expect(m.resolve('stodona_ab', '3001').category).toBe('NETTOOMSATTNING');
    expect(m.resolve('stodona_ab', '7699').category).toBe('PERSONAL');
    expect(m.resolve('stodona_ab', '7700').category).toBe('AVSKRIVNINGAR');
    expect(m.resolve('stodona_ab', '8999').category).toBe('ARETS_RESULTAT_OMFORING');
    expect(m.resolve('stodona_ab', '0999')).toEqual({ category: 'OMAPPAT_OKAND', status: 'omappad' });
    expect(() => new AccountMapper([{ companyId: null, account: '3001', category: 'FINNS_EJ' }])).toThrow();
  });
});

describe('testdatasetet', () => {
  const { ds, cfg, ledgerLoaded } = buildTestDataset(NOW);

  test('är märkt som testdata och går ihop', () => {
    expect(ds.isTestData).toBe(true);
    const period = resolvePeriod({ type: 'r12', asOf: '2026-09-30' });
    const rep = buildResultReport(ds, cfg, period, NOW);
    const bal = buildBalanceReport(ds, cfg, period.to);
    expect(bal.balanceCheck).toEqual({ stodona_ab: 0, stodona_services: 0 });
    expect(bal.internalBalances.find((g) => g.group === 'lån')!.difference).toBe(0);
    const v = verify(ds, cfg, rep, bal);
    expect(v.status).toBe('testdata');
    for (const c of v.checks.filter((x) => x.id.startsWith('saldon_mot_fortnox') || x.id.startsWith('verifikationer_balanserar') || x.id.startsWith('antal_verifikationer'))) expect(c.status).toBe('ok');
    // Scenarierna i testdatat ska synas som flaggor.
    expect(rep.internalIssues.map((i) => i.type).sort()).toEqual(['BELOPPSSKILLNAD', 'OLIKA_MANAD']);
    expect(row(rep, 'RORELSERESULTAT').total).not.toBeNull();
    // Extern nettoomsättning totalt = Stodona AB:s nettoomsättning (alla externa kunder finns där).
    expect(row(rep, 'NETTOOMSATTNING').total).toBe(row(rep, 'NETTOOMSATTNING').ab);
    expect(buildLedgerOverview(ds, cfg, '2026-10-02', ledgerLoaded).receivables[0].overdueTotal).toBe(kr(45_400));
  });

  test('R12 passerar bokslut i båda bolagen utan att resultatet nollas', () => {
    const rep = buildResultReport(ds, cfg, resolvePeriod({ type: 'r12', asOf: '2026-09-30' }), NOW);
    expect(rep.excludedResultTransfer.stodona_ab).not.toBe(0);
    expect(rep.excludedResultTransfer.stodona_services).not.toBe(0);
    expect(row(rep, 'PERIODENS_RESULTAT').ab).toBeGreaterThan(0);
  });
});
