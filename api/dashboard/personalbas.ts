/**
 * Aktuell personalbas i Timewave.
 * Räknar bara ANSTÄLLDA som är aktiva just nu — INTE deleted, INTE inaktiverade.
 *
 * Anledningen till att vi behöver en dedikerad endpoint istället för att lita
 * på /api/timewave/employees.total: den siffran räknar samtliga rader inklusive
 * historiska/borttagna anställda, vilket ger en missvisande personalbas.
 *
 * GET /api/dashboard/personalbas
 * Cachar 5 min per instans (samma mönster som resten av dashboarden).
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getTimewaveToken } from '../_lib/timewaveAuth.js';
import { prisma } from '../_lib/prisma.js';

export const config = { maxDuration: 30 };

const KEY = 'personalbas_v1';
const STALE_SECONDS = 5 * 60;

interface Payload {
  antalAktiva: number;
  antalDeleted: number;
  antalInaktiva: number;
  antalSystempost: number;
  totalt: number;
  computedAt: string;
  namn?: Array<{ id: number; firstName: string; lastName: string; email: string | null }>;
}

async function beraknaPersonalbas(): Promise<Payload> {
  const token = await getTimewaveToken();
  const base = 'https://api.timewave.se/v3';

  // Hämta alla anställda (paginerat)
  const alla: any[] = [];
  let page = 1;
  while (true) {
    const url = `${base}/employees?page[size]=200&page[number]=${page}`;
    const r = await fetch(url, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    });
    if (!r.ok) break;
    const j = await r.json() as any;
    const chunk = j?.data || [];
    alla.push(...chunk);
    const last = j?.last_page ?? 1;
    if (page >= last || chunk.length === 0) break;
    page++;
    if (page > 10) break; // safety
  }

  let antalAktiva = 0;
  let antalDeleted = 0;
  let antalInaktiva = 0;
  let antalSystempost = 0;
  const aktivaLista: Payload['namn'] = [];

  // Timewave-databasen innehåller några dummy-poster som räknas som
  // "anställd" fast de aldrig städar (avbokningsposten m.fl.). Samma filter
  // som TimewaveScheduleGrid använder för schemat, så personalbasen matchar
  // vad man faktiskt ser i schemat.
  const blockedNamePatterns = ['avbok', 'aa -', 'aa-', 'ebenazer', 'ebenezer', 'test'];

  for (const e of alla) {
    if (e.deleted) { antalDeleted++; continue; }
    if (e.status && e.status !== 'active') { antalInaktiva++; continue; }
    const fullName = `${e.first_name || ''} ${e.last_name || ''}`.toLowerCase().trim();
    const isSystem =
      fullName === 'aa' ||
      e.first_name?.toLowerCase().trim() === 'aa' ||
      e.last_name?.toLowerCase().trim() === 'aa' ||
      blockedNamePatterns.some((p) => fullName.includes(p));
    if (isSystem) { antalSystempost++; continue; }
    antalAktiva++;
    aktivaLista!.push({
      id: e.id,
      firstName: e.first_name || '',
      lastName: e.last_name || '',
      email: e.email || null,
    });
  }

  aktivaLista!.sort((a, b) =>
    (a.firstName + a.lastName).localeCompare(b.firstName + b.lastName, 'sv'),
  );

  return {
    antalAktiva,
    antalDeleted,
    antalInaktiva,
    antalSystempost,
    totalt: alla.length,
    computedAt: new Date().toISOString(),
    namn: aktivaLista,
  };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const force = req.query.refresh === '1';

  if (!force) {
    const snap = await prisma.dashboardSnapshot.findUnique({ where: { key: KEY } });
    if (snap && snap.data) {
      const ageMs = Date.now() - snap.computedAt.getTime();
      if (ageMs < STALE_SECONDS * 1000) {
        return res.json({ ...(snap.data as any), cached: true, ageSeconds: Math.round(ageMs / 1000) });
      }
    }
  }

  try {
    const payload = await beraknaPersonalbas();
    await prisma.dashboardSnapshot.upsert({
      where: { key: KEY },
      create: { key: KEY, data: payload as any, computedAt: new Date() },
      update: { data: payload as any, computedAt: new Date() },
    });
    res.json(payload);
  } catch (err: any) {
    console.error('[personalbas]', err?.message);
    // Fallback till stale cache
    const snap = await prisma.dashboardSnapshot.findUnique({ where: { key: KEY } });
    if (snap && snap.data) {
      return res.json({ ...(snap.data as any), stale: true, error: err?.message });
    }
    res.status(500).json({ error: err?.message || 'personalbas failed' });
  }
}
