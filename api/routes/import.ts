import { Router } from 'express';
import { z } from 'zod';
import Papa from 'papaparse';
import { requireAuth } from '../_lib/auth.js';
import { asyncHandler, BadRequest } from '../_lib/errors.js';
import { parseBody } from '../_lib/validation.js';
import {
  importAll,
  importTeams,
  importClients,
  importEmployees,
  importServices,
  importAgreements,
  importMissions,
} from '../_lib/timewaveImport.js';
import { importRows, type ImportEntity } from '../_lib/fileImport.js';

const router = Router();
router.use(requireAuth);

// File-based import: accepts JSON body { entity, rows: [...] }
// or { entity, csv: "name,email,..\n..." } / { entity, json: "[...]" }
router.post(
  '/file',
  asyncHandler(async (req, res) => {
    const body = parseBody(
      z.object({
        entity: z.enum([
          'clients',
          'client_addresses',
          'employees',
          'services',
          'agreements',
          'agreement_lines',
          'missions',
        ]),
        rows: z.array(z.record(z.string(), z.any())).optional(),
        csv: z.string().optional(),
        json: z.string().optional(),
      }),
      req
    );

    let rows: any[] = [];
    if (body.rows) {
      rows = body.rows;
    } else if (body.csv) {
      const parsed = Papa.parse(body.csv, {
        header: true,
        skipEmptyLines: true,
        transformHeader: (h: string) => h.trim().toLowerCase().replace(/\s+/g, '_'),
      });
      if (parsed.errors.length > 0) {
        throw BadRequest('CSV parse error', parsed.errors.slice(0, 5));
      }
      rows = parsed.data as any[];
    } else if (body.json) {
      try {
        const parsed = JSON.parse(body.json);
        rows = Array.isArray(parsed) ? parsed : (parsed.data ?? parsed.rows ?? []);
      } catch (e) {
        throw BadRequest('Invalid JSON', { message: (e as Error).message });
      }
    } else {
      throw BadRequest('Provide one of: rows, csv, json');
    }

    if (!Array.isArray(rows) || rows.length === 0) {
      throw BadRequest('Empty dataset');
    }

    const result = await importRows(body.entity as ImportEntity, rows);
    res.json({ ...result, totalRows: rows.length });
  })
);

// POST /api/import/timewave/all  body: {missionFrom?, missionTo?}
router.post(
  '/timewave/all',
  asyncHandler(async (req, res) => {
    const body = parseBody(
      z.object({
        missionFrom: z.string().optional(),
        missionTo: z.string().optional(),
      }),
      req
    );
    const summaries = await importAll(body);
    res.json(summaries);
  })
);

router.post('/timewave/teams', asyncHandler(async (_req, res) => res.json(await importTeams())));
router.post('/timewave/clients', asyncHandler(async (_req, res) => res.json(await importClients())));
router.post('/timewave/employees', asyncHandler(async (_req, res) => res.json(await importEmployees())));
router.post('/timewave/services', asyncHandler(async (_req, res) => res.json(await importServices())));
router.post('/timewave/agreements', asyncHandler(async (_req, res) => res.json(await importAgreements())));

router.post(
  '/timewave/missions',
  asyncHandler(async (req, res) => {
    const body = parseBody(
      z.object({ from: z.string(), to: z.string() }),
      req
    );
    res.json(await importMissions(body.from, body.to));
  })
);

export default router;
