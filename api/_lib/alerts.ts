import { prisma } from './prisma.js';

export interface AlertWithAckStatus {
  id: number;
  severity: 'INFO' | 'WARNING' | 'BLOCKER';
  category: string;
  title: string;
  body: string;
  createdAt: Date;
  requiresAck: boolean;
}

/**
 * Returns all active alerts for a client, with per-user acknowledgement status.
 * BLOCKER-alerts that haven't been ack'd by this user → requiresAck=true.
 * UI should show a modal and block further interaction until ack.
 */
export async function getClientAlertsForUser(
  clientId: number,
  userClerkId: string
): Promise<AlertWithAckStatus[]> {
  const alerts = await prisma.clientAlert.findMany({
    where: { clientId, active: true },
    orderBy: [{ severity: 'desc' }, { createdAt: 'desc' }],
    include: {
      acknowledgements: { where: { userClerkId } },
    },
  });
  return alerts.map((a) => ({
    id: a.id,
    severity: a.severity as any,
    category: a.category,
    title: a.title,
    body: a.body,
    createdAt: a.createdAt,
    requiresAck: a.severity === 'BLOCKER' && a.acknowledgements.length === 0,
  }));
}

/**
 * Returns true if the client has at least one active BLOCKER-alert (regardless of ack).
 * Used to flag client rows in list views.
 */
export async function clientHasBlockerAlert(clientId: number): Promise<boolean> {
  const count = await prisma.clientAlert.count({
    where: { clientId, active: true, severity: 'BLOCKER' },
  });
  return count > 0;
}

/**
 * Batch: map clientId → hasBlockerAlert for a list view.
 */
export async function clientsWithBlockerAlerts(clientIds: number[]): Promise<Set<number>> {
  if (clientIds.length === 0) return new Set();
  const rows = await prisma.clientAlert.findMany({
    where: { clientId: { in: clientIds }, active: true, severity: 'BLOCKER' },
    select: { clientId: true },
    distinct: ['clientId'],
  });
  return new Set(rows.map((r) => r.clientId));
}
