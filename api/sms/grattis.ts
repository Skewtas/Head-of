import type { VercelRequest, VercelResponse } from '@vercel/node';
import { timingSafeEqual } from 'node:crypto';
import { prisma } from '../_lib/prisma.js';
import { normalizePhone, sendSms } from '../_lib/smsSender.js';

/**
 * Födelsedags- och namnsdags-SMS från Marketing (2026-09).
 *
 *   POST /api/sms/grattis
 *   Authorization: Bearer <MARKETING_SMS_SECRET>
 *   { "rubrik": "Grattis-SMS 2026-09-29",
 *     "meddelanden": [{ "id": "…", "namn": "Anna Svensson", "telefon": "+4670…", "text": "…" }] }   max 50
 *
 *   → { resultat: [{ id, status: "skickat" | "avregistrerad" | "misslyckades", fel? }] }
 *
 * Varje meddelande är personligt (egen rabattkod), så de skickas ett och ett
 * genom sendSms — som kollar spärrlistan och lägger till avregistreringslänken,
 * precis som alla andra marknadsförings-SMS. Endpointen är smal med avsikt:
 * den kan bara skicka det Marketing redan har godkänt och den kräver nyckel.
 * Nyhetsbrev skickar aldrig SMS den här vägen.
 */

const MAX_PER_ANROP = 50;
const MAX_TECKEN = 306 - 80; // två SMS-delar, minus avregistreringsraden

function behorig(req: VercelRequest): boolean {
  const hemlig = process.env.MARKETING_SMS_SECRET ?? '';
  const header = String(req.headers.authorization ?? '');
  if (hemlig.length < 16 || !header.startsWith('Bearer ')) return false;
  const a = Buffer.from(header.slice(7));
  const b = Buffer.from(hemlig);
  return a.length === b.length && timingSafeEqual(a, b);
}

type Meddelande = { id: string; namn: string; telefon: string; text: string };

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!behorig(req)) return res.status(401).json({ error: 'Unauthorized' });

  const rubrik = typeof req.body?.rubrik === 'string' ? req.body.rubrik.slice(0, 80) : 'Grattis-SMS';
  const raw: unknown[] = Array.isArray(req.body?.meddelanden) ? req.body.meddelanden : [];
  if (!raw.length) return res.status(400).json({ error: 'meddelanden saknas' });
  if (raw.length > MAX_PER_ANROP) return res.status(400).json({ error: `Max ${MAX_PER_ANROP} per anrop` });

  const meddelanden: Meddelande[] = [];
  for (const m of raw as any[]) {
    if (typeof m?.id !== 'string' || typeof m?.telefon !== 'string' || typeof m?.text !== 'string') {
      return res.status(400).json({ error: 'Varje meddelande behöver id, telefon och text' });
    }
    if (m.text.length > MAX_TECKEN) {
      return res.status(400).json({ error: `För lång text för ${m.id} (${m.text.length}/${MAX_TECKEN})` });
    }
    meddelanden.push({ id: m.id, namn: String(m.namn ?? ''), telefon: m.telefon, text: m.text });
  }

  // Samma nummer två gånger i samma anrop skickas bara en gång.
  const settaNummer = new Set<string>();
  const resultat: Array<{ id: string; status: 'skickat' | 'avregistrerad' | 'misslyckades'; fel?: string }> = [];
  let skickade = 0;
  let misslyckade = 0;

  for (const m of meddelanden) {
    const telefon = normalizePhone(m.telefon);
    if (!telefon || !/^\+467\d{8}$/.test(telefon)) {
      resultat.push({ id: m.id, status: 'misslyckades', fel: 'Inget giltigt mobilnummer' });
      misslyckade++;
      continue;
    }
    if (settaNummer.has(telefon)) {
      resultat.push({ id: m.id, status: 'misslyckades', fel: 'Numret fanns redan i utskicket' });
      misslyckade++;
      continue;
    }
    settaNummer.add(telefon);
    try {
      const r = await sendSms({
        message: m.text,
        recipients: [{ name: m.namn, phone: telefon }],
        sender: 'Stodona',
        includeOptOutLink: true,
      });
      if (r.sent === 1) { resultat.push({ id: m.id, status: 'skickat' }); skickade++; }
      else if (r.optedOut === 1) resultat.push({ id: m.id, status: 'avregistrerad' });
      else {
        resultat.push({ id: m.id, status: 'misslyckades', fel: r.failedRecipients[0]?.error ?? 'okänt fel' });
        misslyckade++;
      }
    } catch (e: any) {
      resultat.push({ id: m.id, status: 'misslyckades', fel: e?.message ?? String(e) });
      misslyckade++;
    }
  }

  // Syns i head-ofs utskickshistorik som övriga SMS.
  try {
    await prisma.newsletter.create({
      data: {
        subject: `[SMS] ${rubrik}`,
        category: 'SMS',
        introText: `${meddelanden.length} personliga grattis-SMS från Marketing`,
        recipients: meddelanden.map((m) => m.telefon),
        status: misslyckade === 0 ? 'sent' : skickade > 0 ? 'partial' : 'failed',
        successCount: skickade,
        failedCount: misslyckade,
        failedRecipients: resultat.filter((r) => r.status === 'misslyckades') as any,
      },
    });
  } catch (e) {
    console.error('[sms/grattis] kunde inte logga utskicket', e);
  }

  return res.json({ resultat });
}
