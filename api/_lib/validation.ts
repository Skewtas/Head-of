import type { Request } from 'express';
import type { ZodSchema } from 'zod';
import { BadRequest } from './errors.js';

export function parseBody<T>(schema: ZodSchema<T>, req: Request): T {
  const result = schema.safeParse(req.body);
  if (!result.success) throw BadRequest('Invalid body', result.error.issues);
  return result.data;
}

export function parseQuery<T>(schema: ZodSchema<T>, req: Request): T {
  const result = schema.safeParse(req.query);
  if (!result.success) throw BadRequest('Invalid query', result.error.issues);
  return result.data;
}

export function parseIdParam(req: Request, name = 'id'): number {
  const raw = req.params[name];
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) throw BadRequest(`Invalid ${name}`);
  return id;
}
