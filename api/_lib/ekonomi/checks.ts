/**
 * Kontroller och verifieringsstatus.
 *
 * En rapport får märkas "verifierad" först när ALLA blockerande kontroller
 * är gröna, perioden är avstämd/stängd i båda bolagen och en första verklig
 * avstämning mot båda bolagens redovisning är dokumenterad.
 *
 * Avrundning: alla kontroller görs på öret (tolerans 0 öre). Avrundning till
 * hela kronor sker enbart vid visning.
 */
import { createHash } from 'node:crypto';
import { AccountMapper, CATEGORY_BY_ID } from './mapping.js';
import { monthEnd, monthOf, monthsInPeriod, type Period } from './periods.js';
import type { BalanceReport, ResultReport } from './report.js';
import { COMPANIES, COMPANY_IDS, type CompanyData, type CompanyId, type Dataset, type EkonomiConfig, type PeriodStatusValue, type Voucher } from './types.js';

export const TOLERANCE_ORE = 0;

export interface CheckResult {
  id: string;
  label: string;
  status: 'ok' | 'varning' | 'fel' | 'ej_utford';
  /** Blockerar kontrollen märkningen "verifierad"? */
  blocking: boolean;
  details: string[];
  /** Påverkan i öre där det går att beräkna. */
  impact?: number;
}

export function hashVoucher(v: Pick<Voucher, 'date' | 'text' | 'rows'>): string {
  const h = createHash('sha256');
  h.update(`${v.date}\n${v.text}\n`);
  for (const r of v.rows) h.update(`${r.account}|${r.amount}|${r.text ?? ''}|${r.costCenter ?? ''}|${r.project ?? ''}\n`);
  return h.digest('hex');
}

/** Hash av en månads bokföring i ett bolag. Ändras om någon verifikation i månaden läggs till, ändras eller tas bort. */
export function monthHash(c: CompanyData, month: string): string {
  const parts = c.vouchers
    .filter((v) => monthOf(v.date) === month)
    .map((v) => `${v.fyId}|${v.series}|${v.number}|${v.hash ?? hashVoucher(v)}`)
    .sort();
  return createHash('sha256').update(parts.join('\n')).digest('hex');
}

export interface MonthStatus {
  companyId: CompanyId;
  month: string;
  status: PeriodStatusValue;
  /** true om bokföringen ändrats efter att månaden märktes avstämd/stängd. */
  changedAfterMark: boolean;
  /** Fortnox har låst perioden (bokföringen kan inte ändras där). */
  lockedInFortnox: boolean;
  markedAt?: string;
  markedBy?: string;
}

export const STATUS_MEANING: Record<PeriodStatusValue, string> = {
  preliminar: 'Preliminär: bokföringen kan vara ofullständig. Siffrorna kan ändras.',
  avstamd: 'Avstämd: du har intygat att månaden är färdigbokförd och avstämd. Systemet bevakar att bokföringen inte ändras därefter.',
  stangd: 'Stängd: avstämd och perioden är dessutom låst i Fortnox. Ändringar ska inte kunna ske; upptäcks de ändå flaggas de.',
};

export function monthStatuses(ds: Dataset, cfg: EkonomiConfig, period: Period): MonthStatus[] {
  const out: MonthStatus[] = [];
  for (const id of COMPANY_IDS) {
    const c = ds.companies[id];
    for (const month of monthsInPeriod(period)) {
      const mark = cfg.periodStatuses.find((p) => p.companyId === id && p.month === month);
      out.push({
        companyId: id,
        month,
        status: mark?.status ?? 'preliminar',
        changedAfterMark: !!mark && mark.status !== 'preliminar' && mark.dataHash !== monthHash(c, month),
        lockedInFortnox: !!c.sync.lockedUntil && c.sync.lockedUntil >= monthEnd(month),
        markedAt: mark?.markedAt,
        markedBy: mark?.markedBy,
      });
    }
  }
  return out;
}

const kr = (ore: number) => (ore / 100).toLocaleString('sv-SE', { minimumFractionDigits: 2 });

/**
 * Stäm av importerade verifikationer mot Fortnox egna saldon från samma uttag:
 *  - varje verifikation balanserar (debet = kredit)
 *  - IB + rörelser = #UB för varje balanskonto
 *  - rörelser = #RES för varje resultatkonto
 *  - månadssaldon = #PSALDO där sådana finns
 *  - saldon = /3/accounts (oberoende källa) där sådana hämtats
 */
export function reconcileCompany(c: CompanyData, cfg: EkonomiConfig, period: Period): CheckResult[] {
  const mapper = new AccountMapper(cfg.mappingOverrides);
  const name = COMPANIES[c.id].name;
  const years = c.fiscalYears.filter((fy) => fy.importedAt && fy.from <= period.to && fy.to >= period.from);
  const unbalanced: string[] = [];
  const saldo: string[] = [];
  const psaldo: string[] = [];
  const api: string[] = [];
  const counts: string[] = [];
  let impact = 0;
  let apiDone = false;
  let psaldoDone = false;

  for (const fy of years) {
    const yb = c.balances[fy.fyId];
    if (!yb) {
      saldo.push(`${name} räkenskapsår ${fy.from}–${fy.to}: saldon från Fortnox saknas.`);
      continue;
    }
    const move: Record<string, number> = {};
    const moveByMonth: Record<string, Record<string, number>> = {};
    let n = 0;
    for (const v of c.vouchers) {
      if (v.fyId !== fy.fyId) continue;
      n++;
      let s = 0;
      for (const r of v.rows) {
        s += r.amount;
        move[r.account] = (move[r.account] ?? 0) + r.amount;
        const m = monthOf(v.date);
        (moveByMonth[m] ??= {})[r.account] = (moveByMonth[m][r.account] ?? 0) + r.amount;
      }
      if (Math.abs(s) > TOLERANCE_ORE) unbalanced.push(`${name} ${v.series}${v.number} (${v.date}): debet och kredit skiljer ${kr(s)} kr.`);
      if (v.date < fy.from || v.date > fy.to) unbalanced.push(`${name} ${v.series}${v.number}: datum ${v.date} ligger utanför räkenskapsåret ${fy.from}–${fy.to}.`);
    }
    const all = new Set([...Object.keys(move), ...Object.keys(yb.ib), ...Object.keys(yb.ub), ...Object.keys(yb.res)]);
    for (const account of all) {
      const st = mapper.statement(c.id, account);
      const isBalance = st === 'BR' || (st === 'OKAND' && account in yb.ub);
      const computed = isBalance ? (yb.ib[account] ?? 0) + (move[account] ?? 0) : move[account] ?? 0;
      const fortnox = isBalance ? yb.ub[account] ?? 0 : yb.res[account] ?? 0;
      if (Math.abs(computed - fortnox) > TOLERANCE_ORE) {
        impact += Math.abs(computed - fortnox);
        saldo.push(`${name} konto ${account} (${fy.from}–${fy.to}): beräknat ${kr(computed)} kr, Fortnox ${kr(fortnox)} kr, differens ${kr(computed - fortnox)} kr.`);
      }
      if (yb.apiUb) {
        apiDone = true;
        // /3/accounts ger utgående saldo för både balans- och resultatkonton.
        const viaApi = yb.apiUb[account] ?? 0;
        const own = isBalance ? computed : move[account] ?? 0;
        if (Math.abs(own - viaApi) > TOLERANCE_ORE) api.push(`${name} konto ${account} (${fy.from}–${fy.to}): beräknat ${kr(own)} kr, kontolistan i Fortnox ${kr(viaApi)} kr.`);
      }
    }
    if (yb.psaldo) {
      for (const [month, perAccount] of Object.entries(yb.psaldo)) {
        psaldoDone = true;
        const accounts = new Set([...Object.keys(perAccount), ...Object.keys(moveByMonth[month] ?? {})]);
        for (const account of accounts) {
          const computed = moveByMonth[month]?.[account] ?? 0;
          const fortnox = perAccount[account] ?? 0;
          if (Math.abs(computed - fortnox) > TOLERANCE_ORE) psaldo.push(`${name} ${month} konto ${account}: beräknad rörelse ${kr(computed)} kr, Fortnox periodsaldo ${kr(fortnox)} kr.`);
        }
      }
    }
    if (yb.apiVoucherCount !== undefined && yb.apiVoucherCount !== n) {
      counts.push(`${name} räkenskapsår ${fy.from}–${fy.to}: ${n} verifikationer importerade via SIE, ${yb.apiVoucherCount} enligt verifikationslistan.`);
    }
  }
  const noYears = years.length === 0;
  const mk = (id: string, label: string, details: string[], done = true, blocking = true): CheckResult => ({
    id: `${id}:${c.id}`,
    label: `${label} — ${name}`,
    status: noYears || !done ? 'ej_utford' : details.length ? 'fel' : 'ok',
    blocking,
    details: details.slice(0, 50),
  });
  const res = [
    mk('verifikationer_balanserar', 'Verifikationer balanserar och ligger i rätt räkenskapsår', unbalanced),
    { ...mk('saldon_mot_fortnox', 'Saldon stämmer mot Fortnox (#UB/#RES från samma uttag)', saldo), impact },
    mk('manadssaldon_mot_fortnox', 'Månadsrörelser stämmer mot Fortnox periodsaldon', psaldo, psaldoDone, false),
    mk('saldon_mot_kontolista', 'Saldon stämmer mot Fortnox kontolista (oberoende hämtning)', api, apiDone, false),
    mk('antal_verifikationer', 'Antal verifikationer stämmer mot verifikationslistan', counts, years.some((fy) => c.balances[fy.fyId]?.apiVoucherCount !== undefined), true),
  ];
  return res;
}

export interface Verification {
  isTestData: boolean;
  status: 'verifierad' | 'ej_verifierad' | 'testdata';
  label: string;
  /** Skäl till att rapporten inte är verifierad. */
  blockers: string[];
  checks: CheckResult[];
  months: MonthStatus[];
  /** Lägsta status över alla månader och båda bolagen. */
  periodStatus: PeriodStatusValue;
}

export function verify(ds: Dataset, cfg: EkonomiConfig, report: ResultReport, balance: BalanceReport | null): Verification {
  const checks: CheckResult[] = [];
  for (const id of COMPANY_IDS) checks.push(...reconcileCompany(ds.companies[id], cfg, report.period));

  // Fullständighet
  const incomplete = COMPANY_IDS.flatMap((id) => report.completeness[id].reasons);
  const warn = COMPANY_IDS.flatMap((id) => report.completeness[id].warnings);
  checks.push({ id: 'fullstandighet', label: 'Fullständig import för hela perioden i båda bolagen', status: incomplete.length ? 'fel' : warn.length ? 'varning' : 'ok', blocking: true, details: [...incomplete, ...warn] });

  // Aktualitet mellan bolagen
  const [a, b] = COMPANY_IDS.map((id) => ds.companies[id].sync.lastSuccessAt);
  const gapH = a && b ? Math.abs(Date.parse(a) - Date.parse(b)) / 3_600_000 : null;
  checks.push({
    id: 'aktualitet',
    label: 'Bolagens data är hämtad vid ungefär samma tidpunkt',
    status: gapH === null ? 'ej_utford' : gapH > 24 ? 'varning' : 'ok',
    blocking: false,
    details: gapH !== null && gapH > 24 ? [`Senaste lyckade uppdatering skiljer ${Math.round(gapH)} timmar mellan bolagen (${a} respektive ${b}).`] : [],
  });

  // Mappning
  const unmapped = report.accounts.filter((l) => l.mappingStatus === 'omappad');
  const fresh = report.accounts.filter((l) => l.isNew && l.mappingStatus !== 'bekraftad');
  checks.push({
    id: 'omappade_konton',
    label: 'Alla konton med rörelse i perioden är mappade',
    status: unmapped.length ? 'fel' : fresh.length ? 'varning' : 'ok',
    blocking: true,
    impact: unmapped.reduce((s, l) => s + Math.abs(l.amount), 0),
    details: [
      ...unmapped.map((l) => `${COMPANIES[l.companyId].name} konto ${l.account} ${l.name}: omappat, ${kr(l.amount)} kr i perioden.`),
      ...fresh.map((l) => `${COMPANIES[l.companyId].name} konto ${l.account} ${l.name}: nytt konto sedan mappningen senast granskades (placerat i "${CATEGORY_BY_ID[l.category].label}" enligt standardregel).`),
    ],
  });
  checks.push({ id: 'tecken', label: 'Kontonas tecken stämmer med rapportkategorin', status: report.signWarnings.length ? 'varning' : 'ok', blocking: false, details: report.signWarnings });

  // Interna poster
  const hasRules = cfg.internalRules.some((r) => r.active);
  checks.push({
    id: 'interna_poster',
    label: 'Interna poster matchar mellan bolagen',
    status: !hasRules ? 'ej_utford' : report.internalIssues.length ? 'fel' : 'ok',
    blocking: true,
    impact: report.eliminationDifference === null ? undefined : Math.abs(report.eliminationDifference),
    details: !hasRules
      ? ['Inga regler för interna affärer är dokumenterade ännu. Utan dem elimineras ingenting och totalen kan dubbelräkna intern fakturering.']
      : report.internalIssues.map((i) => i.message),
  });
  if (balance) {
    const diffs = balance.internalBalances.filter((g) => g.difference !== 0);
    checks.push({
      id: 'interna_mellanhavanden',
      label: `Interna fordringar och skulder matchar per ${balance.date}`,
      status: !hasRules ? 'ej_utford' : diffs.length ? 'fel' : 'ok',
      blocking: true,
      impact: diffs.reduce((s, g) => s + Math.abs(g.difference), 0),
      details: diffs.map((g) => `Grupp "${g.group}": Stodona AB ${kr(g.ab)} kr, Stodona Services AB ${kr(g.services)} kr, differens ${kr(g.difference)} kr.`),
    });
    const off = COMPANY_IDS.filter((id) => balance.balanceCheck[id] !== null && balance.balanceCheck[id] !== 0);
    checks.push({
      id: 'balans_gar_ihop',
      label: 'Balansräkningen går ihop (tillgångar = eget kapital + skulder + resultat)',
      status: balance.reasons.length ? 'ej_utford' : off.length ? 'fel' : 'ok',
      blocking: true,
      details: [...balance.reasons, ...off.map((id) => `${COMPANIES[id].name}: differens ${kr(balance.balanceCheck[id]!)} kr.`)],
    });
  }

  // Periodstatus och sena ändringar
  const months = monthStatuses(ds, cfg, report.period);
  const changed = months.filter((m) => m.changedAfterMark);
  checks.push({
    id: 'andringar_i_avstamda_perioder',
    label: 'Inga ändringar i tidigare avstämda perioder',
    status: changed.length ? 'fel' : 'ok',
    blocking: true,
    details: changed.map((m) => `${COMPANIES[m.companyId].name} ${m.month}: bokföringen har ändrats efter att månaden märktes som ${m.status === 'stangd' ? 'stängd' : 'avstämd'} (${m.markedAt ?? 'okänt datum'}).`),
  });
  const rank: Record<PeriodStatusValue, number> = { preliminar: 0, avstamd: 1, stangd: 2 };
  const periodStatus = months.reduce<PeriodStatusValue>((min, m) => (rank[m.status] < rank[min] ? m.status : min), 'stangd');

  const blockers: string[] = [];
  for (const c of checks) {
    if (!c.blocking) continue;
    if (c.status === 'fel') blockers.push(`${c.label}: ${c.details[0] ?? 'differens finns'}${c.details.length > 1 ? ` (+${c.details.length - 1} till)` : ''}`);
    if (c.status === 'ej_utford') blockers.push(`${c.label}: kontrollen har inte kunnat utföras.`);
  }
  if (periodStatus === 'preliminar') blockers.push('Minst en månad i perioden är preliminär i något av bolagen.');
  if (!cfg.initialVerification.done) blockers.push('Ingen verklig period har ännu stämts av mot båda bolagens redovisning och interna mellanhavanden.');
  if (report.adjustments.some((a) => !a.adjustment.reverseMonth)) blockers.push('Det finns rapportjusteringar utan angiven vändningsmånad — risk för dubbelräkning när bokföringen kommer in.');

  if (ds.isTestData) {
    return { isTestData: true, status: 'testdata', label: 'TESTDATA — inte bolagens verkliga siffror', blockers, checks, months, periodStatus };
  }
  const ok = blockers.length === 0;
  return { isTestData: false, status: ok ? 'verifierad' : 'ej_verifierad', label: ok ? 'Verifierad' : 'Ej verifierad', blockers, checks, months, periodStatus };
}
