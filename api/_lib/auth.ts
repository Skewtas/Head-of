import type { Request, Response, NextFunction } from 'express';

export interface AuthedRequest extends Request {
  userId: string;
}

export function getUserId(req: Request): string | null {
  const auth = (req as any).auth;
  if (!auth) return null;
  if (typeof auth === 'function') {
    try {
      return auth().userId ?? null;
    } catch {
      return null;
    }
  }
  return auth.userId ?? null;
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const userId = getUserId(req);
  if (!userId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  (req as AuthedRequest).userId = userId;
  next();
}
