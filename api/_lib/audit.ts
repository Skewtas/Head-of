import { prisma } from './prisma.js';

export async function audit(opts: {
  actorClerkId?: string | null;
  action: string;
  entityType: string;
  entityId: string | number;
  before?: unknown;
  after?: unknown;
}) {
  try {
    await prisma.auditLog.create({
      data: {
        actorClerkId: opts.actorClerkId ?? null,
        action: opts.action,
        entityType: opts.entityType,
        entityId: String(opts.entityId),
        before: opts.before as any,
        after: opts.after as any,
      },
    });
  } catch (err) {
    console.error('[audit] failed to log', err);
  }
}
