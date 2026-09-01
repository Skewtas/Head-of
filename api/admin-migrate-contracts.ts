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
      '20260828_contract_person_timewave_id',
      '20260828_stodona_standard_avtal',
      '20260828_stodona_services_address',
      '20260828_stodona_standard_v4',
      '20260828_stodona_standard_v8',
      '20260828_stodona_standard_v9',
      '20260828_sick_leave_cases',
      '20260901_ops_task_completion',
      '20260901_stodona_standard_v10',
      '20260901_restore_ops_tasks',
      '20260901_doma_services_seed_and_sanitize',
      '20260901_revert_to_stodona_services',
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
