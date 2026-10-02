/**
 * Beloppshantering i heltal öre. Flyttal används aldrig i summeringar.
 */

/** Tolka ett decimalbelopp som text ("-1234.50", "1 234,5") till öre. Kastar vid ogiltigt värde. */
export function parseOre(input: string | number): number {
  if (typeof input === 'number') {
    if (!Number.isFinite(input)) throw new Error(`Ogiltigt belopp: ${input}`);
    // Fortnox JSON levererar belopp som tal med högst två decimaler.
    return Math.round(input * 100);
  }
  const s = input.replace(/[\s ]/g, '').replace(',', '.');
  const m = /^([+-]?)(\d*)(?:\.(\d*))?$/.exec(s);
  if (!m || (m[2] === '' && (m[3] ?? '') === '')) throw new Error(`Ogiltigt belopp: "${input}"`);
  const sign = m[1] === '-' ? -1 : 1;
  const whole = m[2] === '' ? 0 : Number(m[2]);
  const frac = (m[3] ?? '').padEnd(3, '0');
  let ore = whole * 100 + Number(frac.slice(0, 2));
  if (Number(frac[2]) >= 5) ore += 1; // tredje decimalen avrundas (förekommer normalt inte)
  return sign * ore;
}

export function sum(values: number[]): number {
  let t = 0;
  for (const v of values) t += v;
  return t;
}

/** Summera utan att dölja saknat underlag: om något värde är null blir summan null. */
export function sumOrNull(values: (number | null)[]): number | null {
  let t = 0;
  for (const v of values) {
    if (v === null) return null;
    t += v;
  }
  return t;
}

/** Kvot i procent med en decimal, eller null om nämnaren saknas eller är 0. */
export function ratioPct(numerator: number | null, denominator: number | null): number | null {
  if (numerator === null || denominator === null || denominator === 0) return null;
  return Math.round((numerator / denominator) * 1000) / 10;
}
