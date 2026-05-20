/**
 * Express app factory for HeadOf 2.0 routes.
 *
 * Used in two contexts:
 *  - server.ts (local dev) — mounted alongside Vite middleware on port 3002.
 *  - api/[[...path]].ts (Vercel serverless) — wrapped by @vercel/node.
 *
 * Only HeadOf 2.0 routes are mounted here. Legacy routes (newsletter, mail,
 * fortnox, timewave proxy, automations) live as individual Vercel functions
 * under api/ and continue to work unchanged.
 */
import express, { type Express } from 'express';
import cookieParser from 'cookie-parser';
import { clerkMiddleware } from '@clerk/express';
import clientsRouter from '../routes/clients.js';
import employeesRouter from '../routes/employees.js';
import teamsRouter from '../routes/teams.js';
import servicesRouter from '../routes/services.js';
import agreementsRouter from '../routes/agreements.js';
import missionsRouter from '../routes/missions.js';
import timeEntriesRouter from '../routes/timeEntries.js';
import invoicesRouter from '../routes/invoices.js';
import payrollRouter from '../routes/payroll.js';
import ticketsRouter from '../routes/tickets.js';
import notesRouter from '../routes/notes.js';
import jobsRouter from '../routes/jobs.js';
import importRouter from '../routes/import.js';
import opsRouter from '../routes/ops.js';
import { errorMiddleware } from './errors.js';

export function buildHeadofApp(): Express {
  const app = express();
  app.use(cookieParser());
  app.use(express.json({ limit: '10mb' }));
  app.use(clerkMiddleware());

  app.use('/api/clients', clientsRouter);
  app.use('/api/employees', employeesRouter);
  app.use('/api/teams', teamsRouter);
  app.use('/api/services', servicesRouter);
  app.use('/api/agreements', agreementsRouter);
  app.use('/api/missions', missionsRouter);
  app.use('/api/time', timeEntriesRouter);
  app.use('/api/invoices', invoicesRouter);
  app.use('/api/payroll', payrollRouter);
  app.use('/api/tickets', ticketsRouter);
  app.use('/api/notes', notesRouter);
  app.use('/api/jobs', jobsRouter);
  app.use('/api/import', importRouter);
  app.use('/api/ops', opsRouter);

  app.use('/api', errorMiddleware);
  return app;
}
