/**
 * Sökbara chatt-dialoger från stodona.se — de senaste 7 dagarna.
 *
 * GET /api/chatt/dialoger?q=<söktext>&dagar=1|3|7
 *   Utan q: senaste dialogerna, nyast först
 *   Med q:  ILIKE-sökning i hela dialogen (både kund och bot)
 *
 * GET /api/chatt/dialoger?id=<samtalsId>
 *   Full dialog för ett specifikt samtal (för expandering i UI)
 *
 * Kräver Clerk-session — GDPR-känsligt innehåll.
 *
 * LIVE (Mikaela 2026-09-24): dagens samtal hämtas direkt från stodona.se
 * (/api/chat-dialog) varje gång listan eller en dialog visas – högst en gång
 * per 20 sekunder per instans. Nattjobbet api/chatt/import-daily ligger kvar
 * som säkerhetsnät för gårdagen och statistiken.
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { verifyToken } from '@clerk/backend';
import { prisma } from '../_lib/prisma.js';

export const config = { maxDuration: 30 };

async function inloggad(req: VercelRequest): Promise<string | null> {
  const secretKey = process.env.CLERK_SECRET_KEY;
  if (!secretKey) return null;
  const franCookie = (req.headers.cookie || '').match(/__session=([^;]+)/)?.[1];
  const franHeader = (req.headers.authorization || '').match(/^Bearer (.+)$/)?.[1];
  const token = franCookie || franHeader;
  if (!token) return null;
  try {
    const payload = await verifyToken(token, { secretKey });
    return (payload as any)?.sub ?? null;
  } catch {
    return null;
  }
}

function ymdSthlm(d: Date): string {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Stockholm', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

type LiveDialog = { id: string; meddelanden: Array<{ role: string; content: string }> };

/** Sparar dialoger på samma sätt som nattjobbet (upsert på samtalsId). */
async function sparaDialoger(dag: string, dialoger: LiveDialog[]): Promise<void> {
  const datum = new Date(`${dag}T00:00:00.000Z`);
  for (const dial of dialoger) {
    if (!dial.id || !Array.isArray(dial.meddelanden) || dial.meddelanden.length === 0) continue;
    const sokText = dial.meddelanden.map((m) => m.content || '').join(' \n ').slice(0, 50_000);
    await prisma.chatDialog.upsert({
      where: { samtalsId: dial.id },
      create: { samtalsId: dial.id, date: datum, meddelanden: dial.meddelanden as any, antalMeddelanden: dial.meddelanden.length, sokText },
      update: { meddelanden: dial.meddelanden as any, antalMeddelanden: dial.meddelanden.length, sokText, importedAt: new Date() },
    });
  }
}

async function hamtaLive(query: string): Promise<LiveDialog[] | null> {
  const hemlighet = process.env.CHAT_STATS_SECRET;
  if (!hemlighet) return null;
  const bas = (process.env.STODONA_SITE_URL || 'https://stodona.se').replace(/\/$/, '');
  const svar = await fetch(`${bas}/api/chat-dialog?${query}`, {
    headers: { Authorization: `Bearer ${hemlighet}` },
    signal: AbortSignal.timeout(8000),
  });
  if (!svar.ok) return null;
  const data = (await svar.json()) as { dialoger?: LiveDialog[] };
  return data.dialoger ?? [];
}

let senasteSynk = 0;
/** Dagens samtal från stodona.se – högst var 20:e sekund. Ett fel stoppar aldrig listan. */
async function synkaIdag(): Promise<void> {
  if (Date.now() - senasteSynk < 20_000) return;
  senasteSynk = Date.now();
  try {
    const dag = ymdSthlm(new Date());
    const dialoger = await hamtaLive(`dag=${dag}`);
    if (dialoger?.length) await sparaDialoger(dag, dialoger);
  } catch (e: any) {
    console.error('[chatt/dialoger] live-synk', e?.message);
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  // Auth: Clerk-session ELLER ?secret=<CRON_SECRET> (för felsökning från
  // URL utan att behöva vara inloggad i browsern)
  const cronSecret = process.env.CRON_SECRET;
  const providedSecret = String(req.query.secret || '');
  const isSecretOk = !!cronSecret && providedSecret === cronSecret;
  if (!isSecretOk && !(await inloggad(req))) return res.status(401).json({ error: 'Unauthorized' });

  const enId = typeof req.query.id === 'string' ? req.query.id : null;

  // Enskild dialog för expandering – hämtas färsk från stodona.se om den finns kvar där.
  if (enId) {
    try {
      const live = await hamtaLive(`id=${encodeURIComponent(enId)}`);
      const befintlig = await prisma.chatDialog.findUnique({ where: { samtalsId: enId }, select: { date: true } });
      if (live?.length) await sparaDialoger(befintlig ? befintlig.date.toISOString().slice(0, 10) : ymdSthlm(new Date()), live);
    } catch (e: any) {
      console.error('[chatt/dialoger] live-dialog', e?.message);
    }
    const d = await prisma.chatDialog.findUnique({ where: { samtalsId: enId } });
    if (!d) return res.status(404).json({ error: 'Dialogen finns inte (kan ha rensats efter 7 dagar)' });
    res.setHeader('Cache-Control', 'private, no-store');
    return res.json({
      samtalsId: d.samtalsId,
      date: d.date.toISOString().slice(0, 10),
      antalMeddelanden: d.antalMeddelanden,
      meddelanden: d.meddelanden,
    });
  }

  await synkaIdag();

  const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  const dagar = [1, 3, 7].includes(Number(req.query.dagar)) ? Number(req.query.dagar) : 7;
  const fran = new Date(`${new Date(Date.now() - (dagar - 1) * 24 * 3600 * 1000).toISOString().slice(0, 10)}T00:00:00.000Z`);

  try {
    const where: any = { date: { gte: fran } };
    if (q) {
      // ILIKE-sökning i hela dialogens sammanlagda text
      where.sokText = { contains: q, mode: 'insensitive' };
    }

    const dialoger = await prisma.chatDialog.findMany({
      where,
      orderBy: { importedAt: 'desc' },
      take: q ? 100 : 50,
      select: {
        samtalsId: true,
        date: true,
        antalMeddelanden: true,
        importedAt: true,
        // Vi returnerar första + sista användarmeddelande som förhandsvisning
        meddelanden: true,
      },
    });

    res.setHeader('Cache-Control', 'private, no-store');
    return res.json({
      sokterm: q || null,
      antal: dialoger.length,
      dialoger: dialoger.map((d) => {
        const msgs = Array.isArray(d.meddelanden) ? (d.meddelanden as any[]) : [];
        const forsta = msgs.find((m) => m.role === 'user')?.content?.slice(0, 200) ?? '';
        const sista = [...msgs].reverse().find((m) => m.role === 'user')?.content?.slice(0, 200) ?? '';
        return {
          samtalsId: d.samtalsId,
          date: d.date.toISOString().slice(0, 10),
          importedAt: d.importedAt.toISOString(),
          antalMeddelanden: d.antalMeddelanden,
          forstaFraga: forsta,
          sistaFraga: forsta !== sista ? sista : null,
        };
      }),
    });
  } catch (e: any) {
    console.error('[chatt/dialoger]', e?.message);
    return res.status(500).json({ error: 'Kunde inte söka i dialogerna' });
  }
}
