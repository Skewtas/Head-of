/**
 * Rapportperioder. Alla jämförelser mellan bolagen görs på exakt samma
 * kalenderperiod, oavsett bolagens räkenskapsår.
 */
import type { CompanyId, FiscalYear } from './types.js';

export interface Period {
  from: string;
  to: string;
  label: string;
}

export type PeriodSpec =
  | { type: 'month'; month: string }
  | { type: 'range'; from: string; to: string }
  | { type: 'ytd'; asOf: string }
  | { type: 'r12'; asOf: string }
  | { type: 'fiscal'; companyId: CompanyId; asOf: string };

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_MONTH = /^\d{4}-\d{2}$/;

export function isIsoDate(s: string): boolean {
  if (!ISO_DATE.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  return m >= 1 && m <= 12 && d >= 1 && d <= daysInMonth(y, m);
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function monthOf(date: string): string {
  return date.slice(0, 7);
}

export function monthStart(month: string): string {
  return `${month}-01`;
}

export function monthEnd(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return `${month}-${String(daysInMonth(y, m)).padStart(2, '0')}`;
}

export function addMonths(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number);
  const idx = y * 12 + (m - 1) + delta;
  return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, '0')}`;
}

export function addDays(date: string, delta: number): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + delta)).toISOString().slice(0, 10);
}

/** Alla månader (YYYY-MM) som berörs av perioden. */
export function monthsInPeriod(p: { from: string; to: string }): string[] {
  const out: string[] = [];
  for (let m = monthOf(p.from); m <= monthOf(p.to); m = addMonths(m, 1)) out.push(m);
  return out;
}

function isMonthEnd(date: string): boolean {
  return date === monthEnd(monthOf(date));
}

/** Flytta ett datum ett år bakåt. Månadsslut förblir månadsslut (29 feb → 28 feb). */
export function shiftYear(date: string, deltaYears: number): string {
  const month = addMonths(monthOf(date), deltaYears * 12);
  if (isMonthEnd(date)) return monthEnd(month);
  const [y, m] = month.split('-').map(Number);
  const d = Math.min(Number(date.slice(8, 10)), daysInMonth(y, m));
  return `${month}-${String(d).padStart(2, '0')}`;
}

/** Samma period föregående år. */
export function previousYear(p: Period): Period {
  return { from: shiftYear(p.from, -1), to: shiftYear(p.to, -1), label: `${p.label} (föregående år)` };
}

export function fiscalYearContaining(years: FiscalYear[], date: string): FiscalYear | null {
  return years.find((y) => y.from <= date && date <= y.to) ?? null;
}

export function resolvePeriod(spec: PeriodSpec, fiscalYears?: FiscalYear[]): Period {
  switch (spec.type) {
    case 'month': {
      if (!ISO_MONTH.test(spec.month)) throw new Error(`Ogiltig månad: ${spec.month}`);
      return { from: monthStart(spec.month), to: monthEnd(spec.month), label: spec.month };
    }
    case 'range': {
      if (!isIsoDate(spec.from) || !isIsoDate(spec.to)) throw new Error('Ogiltigt datumintervall');
      if (spec.from > spec.to) throw new Error('Från-datum ligger efter till-datum');
      return { from: spec.from, to: spec.to, label: `${spec.from} – ${spec.to}` };
    }
    case 'ytd': {
      if (!isIsoDate(spec.asOf)) throw new Error(`Ogiltigt datum: ${spec.asOf}`);
      return { from: `${spec.asOf.slice(0, 4)}-01-01`, to: spec.asOf, label: `Kalenderår ${spec.asOf.slice(0, 4)} t.o.m. ${spec.asOf}` };
    }
    case 'r12': {
      if (!isIsoDate(spec.asOf)) throw new Error(`Ogiltigt datum: ${spec.asOf}`);
      // Rullande tolv hela månader som slutar med asOf:s månad.
      const endMonth = monthOf(spec.asOf);
      const from = monthStart(addMonths(endMonth, -11));
      return { from, to: monthEnd(endMonth), label: `Rullande 12 mån t.o.m. ${endMonth}` };
    }
    case 'fiscal': {
      if (!isIsoDate(spec.asOf)) throw new Error(`Ogiltigt datum: ${spec.asOf}`);
      const fy = fiscalYearContaining(fiscalYears ?? [], spec.asOf);
      if (!fy) throw new Error(`Inget importerat räkenskapsår innehåller ${spec.asOf}`);
      return { from: fy.from, to: spec.asOf < fy.to ? spec.asOf : fy.to, label: `Räkenskapsår ${fy.from} – ${fy.to} (t.o.m. ${spec.asOf < fy.to ? spec.asOf : fy.to})` };
    }
  }
}
