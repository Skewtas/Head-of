/**
 * One-off migration för avtalshanteringsmodulen.
 *
 * Kör: GET /api/admin-migrate-contracts?secret=<CRON_SECRET>
 * Idempotent — kan köras om säkert. Läser SQL-filen från
 * prisma/migrations/20260827_contracts_module/migration.sql.
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { prisma } from './_lib/prisma.js';

export const config = { maxDuration: 60 };

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const secret = process.env.CRON_SECRET;
  const provided = String(req.query.secret || '');
  if (secret && provided !== secret) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const migrations = [
      '20260827_contracts_module',
      '20260827_contracts_files',
      '20260827_contracts_templates_seed',
      '20260827_stodona_services_seed',
    ];
    const applied: string[] = [];
    for (const m of migrations) {
      const sqlPath = join(process.cwd(), `prisma/migrations/${m}/migration.sql`);
      const sql = readFileSync(sqlPath, 'utf-8');
      await prisma.$executeRawUnsafe(sql);
      applied.push(m);
    }

    // Verifiera att tabellerna finns
    const tables: Array<{ tablename: string }> = await prisma.$queryRawUnsafe(
      `SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename IN (
        'own_companies','contract_persons','contracts','contract_versions',
        'contract_templates','contract_permissions','contract_signers',
        'contract_reminders','contract_attachments','contract_files'
      ) ORDER BY tablename`
    );

    res.json({
      ok: true,
      applied,
      tablesFound: tables.map((t) => t.tablename),
      note: 'Kan köras om säkert — idempotent.',
    });
  } catch (err: any) {
    console.error('[admin-migrate-contracts]', err.message, err.stack);
    res.status(500).json({ error: err.message });
  }
}
