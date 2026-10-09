/**
 * SIE 4-tolk (läser Fortnox SIE-export).
 *
 * Varför SIE: en export per räkenskapsår innehåller kontoplan, ingående
 * balanser (#IB), Fortnox egna saldon vid uttaget (#UB, #RES) och samtliga
 * verifikationer med rader. Det ger både datat och facit för avstämning
 * från samma uttagstidpunkt.
 *
 * Hantering av ändrade verifikationer (SIE 4B):
 *  - #TRANS  = gällande rad → räknas.
 *  - #BTRANS = borttagen rad → räknas INTE.
 *  - #RTRANS = tillagd rad. Enligt SIE-standarden följs den av en likadan
 *    #TRANS för bakåtkompatibilitet. Vi räknar därför #RTRANS endast om
 *    nästa rad INTE är en identisk #TRANS.
 * Om detta antagande inte stämmer för en fil fångas det av avstämningen
 * mot #UB/#RES (se checks.ts) — rapporten blir då inte "verifierad".
 */
import { parseOre } from './money.js';

export interface SieVoucher {
  series: string;
  number: number;
  date: string;
  text: string;
  rows: { account: string; amount: number; text?: string; costCenter?: string; project?: string }[];
}

export interface SieFile {
  sieType: string | null;
  companyName: string | null;
  orgNumber: string | null;
  generatedAt: string | null;
  /** #RAR: index 0 = filens räkenskapsår, −1 = föregående. */
  fiscalYears: Record<number, { from: string; to: string }>;
  accounts: Record<string, { name: string; sieType?: string }>;
  ib: Record<string, number>;
  ub: Record<string, number>;
  res: Record<string, number>;
  psaldo: Record<string, Record<string, number>>;
  vouchers: SieVoucher[];
  warnings: string[];
}

// CP437 (IBM PC 8-bitars ASCII) — teckenuppsättningen som SIE föreskriver (#FORMAT PC8).
const CP437_HIGH =
  'ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜ¢£¥₧ƒáíóúñÑªº¿⌐¬½¼¡«»░▒▓│┤╡╢╖╕╣║╗╝╜╛┐└┴┬├─┼╞╟╚╔╩╦╠═╬╧╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀αßΓπΣσµτΦΘΩδ∞φε∩≡±≥≤⌠⌡÷≈°∙·√ⁿ²■ ';

export function decodeCp437(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i];
    out += b < 128 ? String.fromCharCode(b) : CP437_HIGH[b - 128];
  }
  return out;
}

/** Dela en SIE-rad i fält. Citattecken och {objektlistor} hålls ihop. */
export function tokenizeSieLine(line: string): string[] {
  const tokens: string[] = [];
  let i = 0;
  const n = line.length;
  while (i < n) {
    const c = line[i];
    if (c === ' ' || c === '\t') {
      i++;
    } else if (c === '"') {
      let s = '';
      i++;
      while (i < n && line[i] !== '"') {
        if (line[i] === '\\' && i + 1 < n) i++;
        s += line[i++];
      }
      i++;
      tokens.push(s);
    } else if (c === '{') {
      const end = line.indexOf('}', i);
      const stop = end === -1 ? n : end;
      tokens.push(`{${line.slice(i + 1, stop)}}`);
      i = stop + 1;
    } else {
      let s = '';
      while (i < n && line[i] !== ' ' && line[i] !== '\t') s += line[i++];
      tokens.push(s);
    }
  }
  return tokens;
}

function sieDate(s: string): string {
  if (!/^\d{8}$/.test(s)) throw new Error(`Ogiltigt SIE-datum: "${s}"`);
  return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
}

/** Objektlista "{1 "KS1" 6 "P2"}" → kostnadsställe (dim 1) och projekt (dim 6). */
function parseObjects(tok: string | undefined): { costCenter?: string; project?: string } {
  if (!tok || !tok.startsWith('{')) return {};
  const parts = tokenizeSieLine(tok.slice(1, -1));
  const out: { costCenter?: string; project?: string } = {};
  for (let i = 0; i + 1 < parts.length; i += 2) {
    if (parts[i] === '1') out.costCenter = parts[i + 1];
    if (parts[i] === '6') out.project = parts[i + 1];
  }
  return out;
}

export function parseSie(content: string | Uint8Array): SieFile {
  const text = typeof content === 'string' ? content : decodeCp437(content);
  const lines = text.split(/\r?\n/);
  const file: SieFile = {
    sieType: null,
    companyName: null,
    orgNumber: null,
    generatedAt: null,
    fiscalYears: {},
    accounts: {},
    ib: {},
    ub: {},
    res: {},
    psaldo: {},
    vouchers: [],
    warnings: [],
  };
  let current: SieVoucher | null = null;
  let inBlock = false;

  for (let li = 0; li < lines.length; li++) {
    const raw = lines[li].trim();
    if (!raw) continue;
    if (raw === '{') {
      inBlock = true;
      continue;
    }
    if (raw === '}') {
      if (current) file.vouchers.push(current);
      current = null;
      inBlock = false;
      continue;
    }
    const t = tokenizeSieLine(raw);
    const tag = t[0];
    if (inBlock && current) {
      if (tag === '#TRANS' || tag === '#RTRANS') {
        if (tag === '#RTRANS') {
          const next = (lines[li + 1] ?? '').trim();
          if (next === raw.replace('#RTRANS', '#TRANS')) continue; // dubbleras av efterföljande #TRANS
        }
        const account = t[1];
        const amount = parseOre(t[3]);
        const row: SieVoucher['rows'][number] = { account, amount, ...parseObjects(t[2]) };
        if (t[5]) row.text = t[5];
        current.rows.push(row);
      }
      // #BTRANS (borttagen rad) ignoreras medvetet.
      continue;
    }
    switch (tag) {
      case '#SIETYP':
        file.sieType = t[1] ?? null;
        break;
      case '#FNAMN':
        file.companyName = t[1] ?? null;
        break;
      case '#ORGNR':
        file.orgNumber = t[1] ?? null;
        break;
      case '#GEN':
        file.generatedAt = t[1] ? sieDate(t[1]) : null;
        break;
      case '#RAR':
        file.fiscalYears[Number(t[1])] = { from: sieDate(t[2]), to: sieDate(t[3]) };
        break;
      case '#KONTO':
        file.accounts[t[1]] = { ...(file.accounts[t[1]] ?? {}), name: t[2] ?? '' };
        break;
      case '#KTYP':
        file.accounts[t[1]] = { name: file.accounts[t[1]]?.name ?? '', sieType: t[2] };
        break;
      case '#IB':
        if (t[1] === '0') file.ib[t[2]] = parseOre(t[3]);
        break;
      case '#UB':
        if (t[1] === '0') file.ub[t[2]] = parseOre(t[3]);
        break;
      case '#RES':
        if (t[1] === '0') file.res[t[2]] = parseOre(t[3]);
        break;
      case '#PSALDO': {
        // #PSALDO årsnr period konto {objekt} saldo — endast totalsaldon (tom objektlista) och år 0.
        if (t[1] === '0' && t[4] === '{}') {
          const month = `${t[2].slice(0, 4)}-${t[2].slice(4, 6)}`;
          (file.psaldo[month] ??= {})[t[3]] = parseOre(t[5]);
        }
        break;
      }
      case '#VER': {
        const number = Number(t[2]);
        if (!Number.isInteger(number)) {
          file.warnings.push(`Rad ${li + 1}: verifikation utan giltigt nummer`);
        }
        current = { series: t[1] ?? '', number, date: sieDate(t[3]), text: t[4] ?? '', rows: [] };
        break;
      }
      default:
        break;
    }
  }
  if (current) file.warnings.push('Filen slutar mitt i en verifikation — importen kan vara ofullständig');
  return file;
}
