/**
 * Interna affärer mellan Stodona AB och Stodona Services AB.
 *
 * Principer:
 *  1. En rad är intern ENDAST om en dokumenterad regel pekar ut den
 *     (konto, motpart i reskontran eller enskild verifikation).
 *  2. Båda sidor elimineras var för sig, med sitt bokförda belopp i sin
 *     bokförda månad. Totalen för verksamheten består då enbart av externa
 *     poster — ett internt påslag kan aldrig bli vinst för helheten, och
 *     externa lönekostnader elimineras aldrig.
 *  3. Matchningen mellan bolagen är en KONTROLL. Den påverkar inte
 *     elimineringsbeloppen och tvingas aldrig fram. Skillnader flaggas.
 */
import type { AccountMapper } from './mapping.js';
import { monthOf } from './periods.js';
import type { CompanyId, Dataset, InternalRule, LedgerItem, Voucher, VoucherRow } from './types.js';
import { COMPANY_IDS, voucherKey } from './types.js';

export interface InternalTag {
  ruleId: string;
  group: string;
  /** Referens för matchning mot motparten (fakturanummer) om känd. */
  ref: string | null;
}

export class InternalTagger {
  private accountRules = new Map<string, InternalRule>();
  private voucherRules = new Map<string, InternalRule>();
  private counterpartyRules: InternalRule[] = [];
  private ledgerIndex = new Map<string, LedgerItem>();

  constructor(ds: Dataset, rules: InternalRule[], private mapper: AccountMapper) {
    for (const r of rules) {
      if (!r.active) continue;
      if (r.type === 'account' && r.account) this.accountRules.set(`${r.companyId}|${r.account}`, r);
      else if (r.type === 'voucher' && r.voucher) this.voucherRules.set(voucherKey({ companyId: r.companyId, ...r.voucher }), r);
      else if (r.type === 'counterparty' && r.ledger && r.counterpartyNumber) this.counterpartyRules.push(r);
    }
    for (const id of COMPANY_IDS) {
      for (const item of ds.companies[id].ledger) this.ledgerIndex.set(`${id}|${item.kind}|${item.docNumber}`, item);
    }
  }

  /** Reskontrapost som verifikationen hör till, om Fortnox angett en referens. */
  ledgerItemFor(v: Voucher): LedgerItem | null {
    if (!v.refNumber) return null;
    const kind = v.refType === 'INVOICE' ? 'customer' : v.refType === 'SUPPLIERINVOICE' ? 'supplier' : null;
    if (!kind) return null;
    return this.ledgerIndex.get(`${v.companyId}|${kind}|${v.refNumber}`) ?? null;
  }

  isInternalCounterparty(item: LedgerItem): InternalRule | null {
    return (
      this.counterpartyRules.find(
        (r) => r.companyId === item.companyId && r.ledger === item.kind && r.counterpartyNumber === item.counterpartyNumber
      ) ?? null
    );
  }

  tag(v: Voucher, row: VoucherRow): InternalTag | null {
    const item = this.ledgerItemFor(v);
    const ref = item ? item.externalRef : null;
    const vr = this.voucherRules.get(voucherKey(v));
    if (vr) return { ruleId: vr.id, group: vr.group, ref };
    const ar = this.accountRules.get(`${v.companyId}|${row.account}`);
    if (ar) return { ruleId: ar.id, group: ar.group, ref };
    if (item) {
      const cr = this.isInternalCounterparty(item);
      // Motpartsregeln gäller fakturaverifikationens resultatrader. Balansrader
      // (kundfordran/leverantörsskuld/moms) kräver kontoregel, se dokumentationen.
      if (cr && this.mapper.statement(v.companyId, row.account) === 'RR') return { ruleId: cr.id, group: cr.group, ref };
    }
    return null;
  }

  internalBalanceAccounts(companyId: CompanyId): { account: string; group: string; ruleId: string }[] {
    const out: { account: string; group: string; ruleId: string }[] = [];
    for (const r of this.accountRules.values()) {
      if (r.companyId === companyId && r.account && this.mapper.statement(companyId, r.account) === 'BR') {
        out.push({ account: r.account, group: r.group, ruleId: r.id });
      }
    }
    return out;
  }
}

/** Ett internt underlag = en verifikations samlade interna resultatpåverkan inom en elimineringsgrupp. */
export interface InternalDoc {
  companyId: CompanyId;
  fyId: number;
  series: string;
  number: number;
  date: string;
  text: string;
  group: string;
  ref: string | null;
  /** Resultatpåverkan i öre (intäkt +, kostnad −). */
  effect: number;
}

export type InternalIssueType = 'BELOPPSSKILLNAD' | 'OLIKA_MANAD' | 'SAKNAR_MOTPOST';

export interface InternalIssue {
  type: InternalIssueType;
  group: string;
  message: string;
  /** Skillnad i öre mellan bolagens belopp (0 om endast månad skiljer). */
  difference: number;
  docs: InternalDoc[];
}

export interface InternalPair {
  a: InternalDoc;
  b: InternalDoc;
  matchedBy: 'referens' | 'belopp';
}

export function collectInternalDocs(ds: Dataset, tagger: InternalTagger, mapper: AccountMapper, from: string, to: string): InternalDoc[] {
  const docs: InternalDoc[] = [];
  for (const id of COMPANY_IDS) {
    for (const v of ds.companies[id].vouchers) {
      if (v.date < from || v.date > to) continue;
      const perGroup = new Map<string, InternalDoc>();
      for (const row of v.rows) {
        if (mapper.statement(id, row.account) !== 'RR') continue;
        const tag = tagger.tag(v, row);
        if (!tag) continue;
        let d = perGroup.get(tag.group);
        if (!d) {
          d = { companyId: id, fyId: v.fyId, series: v.series, number: v.number, date: v.date, text: v.text, group: tag.group, ref: tag.ref, effect: 0 };
          perGroup.set(tag.group, d);
        }
        d.effect -= row.amount;
      }
      for (const d of perGroup.values()) if (d.effect !== 0) docs.push(d);
    }
  }
  return docs;
}

function monthDistance(a: string, b: string): number {
  const [ya, ma] = monthOf(a).split('-').map(Number);
  const [yb, mb] = monthOf(b).split('-').map(Number);
  return Math.abs(ya * 12 + ma - (yb * 12 + mb));
}

function dayDistance(a: string, b: string): number {
  return Math.abs(Date.parse(a) - Date.parse(b)) / 86_400_000;
}

/** Högsta antal månader mellan två bokningar för att de ska paras ihop på enbart belopp. */
export const MAX_MONTH_DISTANCE = 3;

const kr = (ore: number) => (ore / 100).toLocaleString('sv-SE', { minimumFractionDigits: 2 });
const docName = (d: InternalDoc) => `${d.companyId === 'stodona_ab' ? 'Stodona AB' : 'Stodona Services AB'} ${d.series}${d.number} (${d.date})`;

/**
 * Para ihop interna underlag mellan bolagen. Ordning:
 *   1. samma referens (fakturanummer)
 *   2. exakt motsatt belopp, samma månad
 *   3. exakt motsatt belopp, högst MAX_MONTH_DISTANCE månader isär
 * Allt övrigt lämnas omatchat och flaggas.
 */
export function matchInternalDocs(docs: InternalDoc[]): { pairs: InternalPair[]; issues: InternalIssue[] } {
  const pairs: InternalPair[] = [];
  const issues: InternalIssue[] = [];
  const groups = new Set(docs.map((d) => d.group));
  for (const group of groups) {
    const as = docs.filter((d) => d.group === group && d.companyId === 'stodona_ab');
    const bs = docs.filter((d) => d.group === group && d.companyId === 'stodona_services');
    const usedB = new Set<InternalDoc>();
    const openA: InternalDoc[] = [];

    for (const a of as) {
      const b = a.ref ? bs.find((x) => !usedB.has(x) && x.ref === a.ref) : undefined;
      if (b) {
        usedB.add(b);
        pairs.push({ a, b, matchedBy: 'referens' });
      } else openA.push(a);
    }
    const stillOpenA: InternalDoc[] = [];
    for (const pass of [0, MAX_MONTH_DISTANCE]) {
      const list = pass === 0 ? openA : stillOpenA.splice(0);
      for (const a of list) {
        const candidates = bs
          .filter((x) => !usedB.has(x) && x.effect === -a.effect && monthDistance(x.date, a.date) <= pass)
          .sort((x, y) => dayDistance(x.date, a.date) - dayDistance(y.date, a.date));
        if (candidates[0]) {
          usedB.add(candidates[0]);
          pairs.push({ a, b: candidates[0], matchedBy: 'belopp' });
        } else stillOpenA.push(a);
      }
    }
    for (const d of [...stillOpenA, ...bs.filter((x) => !usedB.has(x))]) {
      issues.push({
        type: 'SAKNAR_MOTPOST',
        group,
        difference: d.effect,
        docs: [d],
        message: `${docName(d)}: intern post ${kr(d.effect)} kr saknar motpost i det andra bolaget.`,
      });
    }
  }
  for (const p of pairs) {
    const diff = p.a.effect + p.b.effect;
    if (diff !== 0) {
      issues.push({
        type: 'BELOPPSSKILLNAD',
        group: p.a.group,
        difference: diff,
        docs: [p.a, p.b],
        message: `${docName(p.a)} och ${docName(p.b)}: beloppen skiljer ${kr(Math.abs(diff))} kr (${kr(p.a.effect)} mot ${kr(p.b.effect)}).`,
      });
    }
    if (monthOf(p.a.date) !== monthOf(p.b.date)) {
      issues.push({
        type: 'OLIKA_MANAD',
        group: p.a.group,
        difference: 0,
        docs: [p.a, p.b],
        message: `${docName(p.a)} och ${docName(p.b)}: samma interna affär är bokförd i olika månader (${monthOf(p.a.date)} och ${monthOf(p.b.date)}).`,
      });
    }
  }
  return { pairs, issues };
}
