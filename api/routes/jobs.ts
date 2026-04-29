import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../_lib/auth.js';
import { asyncHandler } from '../_lib/errors.js';
import { parseBody } from '../_lib/validation.js';
import { generateAllMissions } from '../_lib/missionGenerator.js';

const router = Router();
router.use(requireAuth);

// Nightly / on-demand: materialize missions for all active agreement lines.
router.post(
  '/generate-missions',
  asyncHandler(async (req, res) => {
    const body = parseBody(z.object({ daysAhead: z.number().int().min(1).max(365).default(60) }), req);
    const results = await generateAllMissions(body.daysAhead);
    const totalCreated = results.reduce((s, r) => s + r.created, 0);
    const totalSkipped = results.reduce((s, r) => s + r.skipped, 0);
    res.json({ lines: results.length, created: totalCreated, skipped: totalSkipped });
  })
);

export default router;
