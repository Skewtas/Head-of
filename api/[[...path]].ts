/**
 * Vercel serverless catch-all for HeadOf 2.0 API routes.
 *
 * Vercel's routing prefers more-specific files (api/newsletter/send.ts wins
 * over this), so this catches only routes that don't have a dedicated file —
 * exactly the HeadOf 2.0 routes (/api/clients, /api/agreements, etc).
 *
 * In dev, server.ts handles these directly via Express + Vite middleware.
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { buildHeadofApp } from './_lib/headofApp.js';

const app = buildHeadofApp();

export default function handler(req: VercelRequest, res: VercelResponse) {
  // Express expects standard Node req/res; Vercel's wrappers extend them.
  return app(req as any, res as any);
}
