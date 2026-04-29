import type { Request, Response, NextFunction, RequestHandler } from 'express';

export class HttpError extends Error {
  constructor(public status: number, message: string, public details?: unknown) {
    super(message);
  }
}

export const BadRequest = (msg: string, details?: unknown) => new HttpError(400, msg, details);
export const Unauthorized = (msg = 'Unauthorized') => new HttpError(401, msg);
export const Forbidden = (msg = 'Forbidden') => new HttpError(403, msg);
export const NotFound = (msg = 'Not found') => new HttpError(404, msg);
export const Conflict = (msg: string, details?: unknown) => new HttpError(409, msg, details);
export const Unprocessable = (msg: string, details?: unknown) => new HttpError(422, msg, details);

export function asyncHandler(fn: (req: Request, res: Response, next: NextFunction) => Promise<any>): RequestHandler {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

export function errorMiddleware(err: any, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof HttpError) {
    return res.status(err.status).json({ error: err.message, details: err.details ?? null });
  }
  if (err?.code === 'P2002') {
    return res.status(409).json({ error: 'Unique constraint violation', details: err.meta });
  }
  if (err?.code === 'P2025') {
    return res.status(404).json({ error: 'Not found' });
  }
  console.error('[api error]', err);
  return res.status(500).json({ error: 'Internal server error', message: err?.message });
}
