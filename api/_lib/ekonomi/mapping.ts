/**
 * Kontomappning → gemensamma rapportkategorier.
 *
 * Standardregeln bygger på BAS-kontoplanens kontoklasser och är ett
 * UTGÅNGSLÄGE, inte ett bekräftat faktum om bolagens bokföring. Varje konto
 * får status:
 *   - "bekraftad"  : uttrycklig mappning sparad av användaren
 *   - "regel"      : träffar standardregeln men är inte bekräftad
 *   - "omappad"    : träffar ingen regel → egen rad "Omappade konton"
 * Ett omappat konto försvinner aldrig: det summeras på egen rad och
 * hindrar att rapporten märks som verifierad.
 */
import type { CompanyId, MappingOverride } from './types.js';

export type Statement = 'RR' | 'BR' | 'EXKL' | 'OKAND';

export interface Category {
  id: string;
  label: string;
  statement: Statement;
  /** Förväntat tecken på resultatpåverkan (RR) / visat saldo (BR). Används bara för varningar. */
  expectedSign: 1 | -1 | 0;
  definition: string;
}

export const CATEGORIES: Category[] = [
  // ── Resultaträkning ──
  { id: 'NETTOOMSATTNING', label: 'Nettoomsättning', statement: 'RR', expectedSign: 1, definition: 'Konto 3000–3799. Försäljning exkl. moms. Efter eliminering = försäljning till externa kunder.' },
  { id: 'OVRIGA_INTAKTER', label: 'Övriga rörelseintäkter', statement: 'RR', expectedSign: 1, definition: 'Konto 3800–3999. Aktiverat arbete, bidrag, öresavrundning m.m.' },
  { id: 'DIREKTA_KOSTNADER', label: 'Material och köpta tjänster', statement: 'RR', expectedSign: -1, definition: 'Konto 4000–4999. Varor, material, underentreprenörer.' },
  { id: 'OVRIGA_EXTERNA', label: 'Övriga externa kostnader', statement: 'RR', expectedSign: -1, definition: 'Konto 5000–6999. Lokal, fordon, förbrukning, inhyrd personal, konsulter m.m.' },
  { id: 'PERSONAL', label: 'Personalkostnader', statement: 'RR', expectedSign: -1, definition: 'Konto 7000–7699. Löner, semesterlön, arbetsgivaravgifter, pensioner, övriga personalkostnader.' },
  { id: 'AVSKRIVNINGAR', label: 'Av- och nedskrivningar', statement: 'RR', expectedSign: -1, definition: 'Konto 7700–7899.' },
  { id: 'OVRIGA_RORELSEKOSTNADER', label: 'Övriga rörelsekostnader', statement: 'RR', expectedSign: -1, definition: 'Konto 7900–7999.' },
  { id: 'FIN_INTAKTER', label: 'Finansiella intäkter', statement: 'RR', expectedSign: 1, definition: 'Konto 8000–8399. Resultat från andelar, ränteintäkter.' },
  { id: 'FIN_KOSTNADER', label: 'Finansiella kostnader', statement: 'RR', expectedSign: -1, definition: 'Konto 8400–8499. Räntekostnader m.m.' },
  { id: 'BOKSLUTSDISPOSITIONER', label: 'Bokslutsdispositioner', statement: 'RR', expectedSign: 0, definition: 'Konto 8800–8899. Koncernbidrag, periodiseringsfond, överavskrivningar.' },
  { id: 'SKATT', label: 'Skatt på årets resultat', statement: 'RR', expectedSign: -1, definition: 'Konto 8900–8989. Redovisas per bolag — ingen skatt beräknas på det gemensamma resultatet.' },
  { id: 'ARETS_RESULTAT_OMFORING', label: 'Omföring av årets resultat (8990–8999)', statement: 'EXKL', expectedSign: 0, definition: 'Bokslutsverifikationen som för årets resultat till eget kapital. Ingår inte i resultatet — annars skulle resultatet nollas vid bokslut.' },
  { id: 'OMAPPAT_RR', label: 'Omappade konton (resultat)', statement: 'RR', expectedSign: 0, definition: 'Resultatkonton som saknar mappning. Måste mappas innan rapporten kan verifieras.' },
  // ── Balansräkning ──
  { id: 'ANLAGGNINGSTILLGANGAR', label: 'Anläggningstillgångar', statement: 'BR', expectedSign: 1, definition: 'Konto 1000–1399.' },
  { id: 'LAGER', label: 'Varulager och pågående arbeten', statement: 'BR', expectedSign: 1, definition: 'Konto 1400–1499.' },
  { id: 'KUNDFORDRINGAR', label: 'Kundfordringar', statement: 'BR', expectedSign: 1, definition: 'Konto 1500–1599.' },
  { id: 'OVRIGA_FORDRINGAR', label: 'Övriga fordringar', statement: 'BR', expectedSign: 1, definition: 'Konto 1600–1699. Inkl. skattekonto och fordringar på närstående bolag.' },
  { id: 'FORUTBETALDA', label: 'Förutbetalda kostnader och upplupna intäkter', statement: 'BR', expectedSign: 1, definition: 'Konto 1700–1799.' },
  { id: 'KORTFRISTIGA_PLACERINGAR', label: 'Kortfristiga placeringar', statement: 'BR', expectedSign: 1, definition: 'Konto 1800–1899.' },
  { id: 'LIKVIDA_MEDEL', label: 'Kassa och bank', statement: 'BR', expectedSign: 1, definition: 'Konto 1900–1999. Bokfört saldo — kan avvika från bankens saldo tills banken är avstämd.' },
  { id: 'EGET_KAPITAL', label: 'Eget kapital', statement: 'BR', expectedSign: -1, definition: 'Konto 2000–2099.' },
  { id: 'OBESKATTADE_RESERVER', label: 'Obeskattade reserver', statement: 'BR', expectedSign: -1, definition: 'Konto 2100–2199.' },
  { id: 'AVSATTNINGAR', label: 'Avsättningar', statement: 'BR', expectedSign: -1, definition: 'Konto 2200–2299.' },
  { id: 'LANGFRISTIGA_SKULDER', label: 'Långfristiga skulder', statement: 'BR', expectedSign: -1, definition: 'Konto 2300–2399.' },
  { id: 'LEVERANTORSSKULDER', label: 'Leverantörsskulder och kortfristiga lån', statement: 'BR', expectedSign: -1, definition: 'Konto 2400–2499.' },
  { id: 'SKATTESKULDER', label: 'Skatteskulder', statement: 'BR', expectedSign: -1, definition: 'Konto 2500–2599.' },
  { id: 'MOMS', label: 'Moms', statement: 'BR', expectedSign: -1, definition: 'Konto 2600–2699.' },
  { id: 'PERSONALSKATT_AVGIFTER', label: 'Personalens skatter och avgifter', statement: 'BR', expectedSign: -1, definition: 'Konto 2700–2799.' },
  { id: 'OVRIGA_KORTFRISTIGA_SKULDER', label: 'Övriga kortfristiga skulder', statement: 'BR', expectedSign: -1, definition: 'Konto 2800–2899. Inkl. skulder till närstående bolag.' },
  { id: 'UPPLUPNA', label: 'Upplupna kostnader och förutbetalda intäkter', statement: 'BR', expectedSign: -1, definition: 'Konto 2900–2999. Inkl. semesterlöneskuld och upplupna sociala avgifter.' },
  { id: 'OMAPPAT_BR', label: 'Omappade konton (balans)', statement: 'BR', expectedSign: 0, definition: 'Balanskonton som saknar mappning.' },
  { id: 'OMAPPAT_OKAND', label: 'Omappade konton (okänd typ)', statement: 'OKAND', expectedSign: 0, definition: 'Konton som varken kan hänföras till resultat- eller balansräkning. Summeras inte i någon rapportrad men visas och blockerar verifiering.' },
];

export const CATEGORY_BY_ID: Record<string, Category> = Object.fromEntries(CATEGORIES.map((c) => [c.id, c]));

/** Standardregler: [från, till, kategori] på fyrsiffrigt kontonummer. */
export const DEFAULT_RANGES: [number, number, string][] = [
  [1000, 1399, 'ANLAGGNINGSTILLGANGAR'],
  [1400, 1499, 'LAGER'],
  [1500, 1599, 'KUNDFORDRINGAR'],
  [1600, 1699, 'OVRIGA_FORDRINGAR'],
  [1700, 1799, 'FORUTBETALDA'],
  [1800, 1899, 'KORTFRISTIGA_PLACERINGAR'],
  [1900, 1999, 'LIKVIDA_MEDEL'],
  [2000, 2099, 'EGET_KAPITAL'],
  [2100, 2199, 'OBESKATTADE_RESERVER'],
  [2200, 2299, 'AVSATTNINGAR'],
  [2300, 2399, 'LANGFRISTIGA_SKULDER'],
  [2400, 2499, 'LEVERANTORSSKULDER'],
  [2500, 2599, 'SKATTESKULDER'],
  [2600, 2699, 'MOMS'],
  [2700, 2799, 'PERSONALSKATT_AVGIFTER'],
  [2800, 2899, 'OVRIGA_KORTFRISTIGA_SKULDER'],
  [2900, 2999, 'UPPLUPNA'],
  [3000, 3799, 'NETTOOMSATTNING'],
  [3800, 3999, 'OVRIGA_INTAKTER'],
  [4000, 4999, 'DIREKTA_KOSTNADER'],
  [5000, 6999, 'OVRIGA_EXTERNA'],
  [7000, 7699, 'PERSONAL'],
  [7700, 7899, 'AVSKRIVNINGAR'],
  [7900, 7999, 'OVRIGA_RORELSEKOSTNADER'],
  [8000, 8399, 'FIN_INTAKTER'],
  [8400, 8499, 'FIN_KOSTNADER'],
  [8800, 8899, 'BOKSLUTSDISPOSITIONER'],
  [8900, 8989, 'SKATT'],
  [8990, 8999, 'ARETS_RESULTAT_OMFORING'],
];

export type MappingStatus = 'bekraftad' | 'regel' | 'omappad';

export interface ResolvedMapping {
  category: string;
  status: MappingStatus;
}

export class AccountMapper {
  private overrides = new Map<string, MappingOverride>();

  constructor(overrides: MappingOverride[]) {
    for (const o of overrides) {
      if (!CATEGORY_BY_ID[o.category]) throw new Error(`Okänd rapportkategori i mappning: ${o.category}`);
      this.overrides.set(`${o.companyId ?? '*'}|${o.account}`, o);
    }
  }

  resolve(companyId: CompanyId, account: string): ResolvedMapping {
    const o = this.overrides.get(`${companyId}|${account}`) ?? this.overrides.get(`*|${account}`);
    if (o) return { category: o.category, status: 'bekraftad' };
    if (/^\d{4}$/.test(account)) {
      const n = Number(account);
      for (const [from, to, category] of DEFAULT_RANGES) {
        if (n >= from && n <= to) return { category, status: 'regel' };
      }
      // Fyrsiffrigt konto utan regel: kontoklassen avgör om det är resultat eller balans.
      if (n >= 1000 && n <= 2999) return { category: 'OMAPPAT_BR', status: 'omappad' };
      if (n >= 3000 && n <= 8999) return { category: 'OMAPPAT_RR', status: 'omappad' };
    }
    return { category: 'OMAPPAT_OKAND', status: 'omappad' };
  }

  statement(companyId: CompanyId, account: string): Statement {
    return CATEGORY_BY_ID[this.resolve(companyId, account).category].statement;
  }
}
