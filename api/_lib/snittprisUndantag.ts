/**
 * Kunder som inte ska räknas med i snittpris-uträkningarna (kr/h).
 * Deras pass hoppas över helt — de syns varken i listor, varningar eller totalsnitt.
 * Matchas på Timewave-kund-id (namnet står bara som kommentar).
 */
const UNDANTAGNA_KUND_IDS = new Set<number>([
  3832, // Annika Wigert
  7306, // Diana Ibrahim
  4172, // Samir Badran / Julia Sundquist Badran
  9076, // Martina Masso
]);

export function arUndantagenFranSnittpris(mission: any): boolean {
  const id = Number(mission?.client?.id);
  return UNDANTAGNA_KUND_IDS.has(id);
}
