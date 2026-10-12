/**
 * Timewave-priser → ex moms, före RUT.
 *
 * Interna siffror ska alltid visas ex moms och före RUT. Timewaves pris på en
 * tjänsterad är däremot olika saker beroende på kundtyp:
 *   - Företag:    redan ex moms.
 *   - Privatkund: det kunden betalar, dvs inkl moms och EFTER RUT
 *                 (344 kr/h i Timewave = 688 inkl moms = 550 kr/h ex moms).
 * Framkörning ger ingen RUT och räknas därför bara om för moms.
 * Samma princip som prisExMomsForeRut i bokis.ts.
 */
const MOMS = 1.25;
const RUT_FAKTOR = 0.5;

export function arPrivatkund(mission: any): boolean {
  const c = mission?.client;
  return !!c && !c.companyname && Number(c.type) === 1;
}

/** Radens belopp (antal × pris − rabatt) omräknat till ex moms före RUT. */
export function radExMomsForeRut(mission: any, svc: any): number {
  const belopp = Number(svc?.quantity || 0) * Number(svc?.price || 0) * (1 - Number(svc?.discount || 0) / 100);
  if (!arPrivatkund(mission)) return belopp;
  const utanRut = /framkörning/i.test(String(svc?.name || svc?.title || ''));
  return belopp / MOMS / (utanRut ? 1 : RUT_FAKTOR);
}
