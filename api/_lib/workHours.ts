/**
 * Faktiska arbetstimmar per månad (svenska kalendern).
 *
 * Räknar mån-fre minus svenska helgdagar (fasta + rörliga runt påsk),
 * multiplicerat med 8 h.
 *
 * Exempel:
 *   sep 2026 → 22 arbetsdagar → 176 h
 *   aug 2026 → 21 arbetsdagar → 168 h
 *   dec 2026 → påverkas av jul- och nyårshelgdagar
 */

/**
 * Beräkna påskdagen (söndagen) för ett givet år (Butcher/Meeus algoritm).
 * Ger gregorianska påskdagen som Date.
 */
function easterSunday(year: number): Date {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31); // 3 = mars, 4 = april
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(year, month - 1, day);
}

/** Returnerar YYYY-MM-DD-set av svenska helgdagar för ett år. */
export function swedishHolidays(year: number): Set<string> {
  const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const s = new Set<string>();

  // Fasta röda dagar
  s.add(`${year}-01-01`); // Nyårsdagen
  s.add(`${year}-01-06`); // Trettondedag jul
  s.add(`${year}-05-01`); // Första maj
  s.add(`${year}-06-06`); // Nationaldagen
  s.add(`${year}-12-24`); // Julafton (arbetsfri i praktiken för de flesta)
  s.add(`${year}-12-25`); // Juldagen
  s.add(`${year}-12-26`); // Annandag jul
  s.add(`${year}-12-31`); // Nyårsafton (arbetsfri i praktiken)

  // Rörliga påskdagar
  const easter = easterSunday(year);
  const addDays = (d: Date, n: number) => {
    const x = new Date(d); x.setDate(x.getDate() + n); return x;
  };
  s.add(iso(addDays(easter, -2))); // Långfredagen
  s.add(iso(addDays(easter, 0)));  // Påskdagen
  s.add(iso(addDays(easter, 1)));  // Annandag påsk
  s.add(iso(addDays(easter, 39))); // Kristi himmelsfärds dag (torsdag 6 v efter påsk)
  s.add(iso(addDays(easter, 49))); // Pingstdagen

  // Midsommarafton = fredagen 19–25 juni; Midsommardagen = lördag 20–26 juni
  for (let day = 19; day <= 25; day++) {
    const d = new Date(year, 5, day); // juni = index 5
    if (d.getDay() === 5) { // fredag
      s.add(iso(d));                          // Midsommarafton
      s.add(iso(addDays(d, 1)));              // Midsommardagen
      break;
    }
  }

  // Alla helgons dag = lördag mellan 31 okt och 6 nov
  for (let day = 31; day <= 6 + 31; day++) {
    const date = new Date(year, 9, day); // 9 = okt (day=32 → 1 nov via rollover)
    if (date.getDay() === 6) {
      s.add(iso(date));
      break;
    }
  }

  return s;
}

/**
 * Antal arbetsdagar (mån-fre minus svenska helgdagar) för en månad.
 * `year` = fullt år, `month` = 0-baserat (0 = januari).
 */
export function workingDaysInMonth(year: number, month: number): number {
  const holidays = swedishHolidays(year);
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  let count = 0;
  for (let day = 1; day <= daysInMonth; day++) {
    const d = new Date(year, month, day);
    const dow = d.getDay(); // 0 = sö, 6 = lö
    if (dow === 0 || dow === 6) continue;
    const key = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    if (holidays.has(key)) continue;
    count++;
  }
  return count;
}

/**
 * Arbetstimmar för en månad — vardagar minus helgdagar × 8 h.
 * Standardvärde för 100 % anställning i den månaden.
 */
export function workHoursInMonth(year: number, month: number): number {
  return workingDaysInMonth(year, month) * 8;
}
