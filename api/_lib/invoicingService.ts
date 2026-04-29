import { prisma } from './prisma.js';

export interface GenerateOptions {
  periodStart: Date;
  periodEnd: Date;
  clientIds?: number[];
}

export interface GeneratedInvoice {
  invoiceId: number;
  clientId: number;
  totalCents: number;
  rutCents: number;
  linesCount: number;
}

/**
 * Generate DRAFT invoices for all clients with approved time entries in the period.
 * Idempotent per client + period (skips if a non-PAID invoice exists).
 * Only looks at admin_approved time entries — never planned.
 */
export async function generateInvoicesForPeriod(
  opts: GenerateOptions
): Promise<GeneratedInvoice[]> {
  const { periodStart, periodEnd, clientIds } = opts;

  const timeEntries = await prisma.timeEntry.findMany({
    where: {
      adminApprovedAt: { not: null },
      mission: {
        date: { gte: periodStart, lte: periodEnd },
        status: 'COMPLETED',
        ...(clientIds ? { clientId: { in: clientIds } } : {}),
      },
    },
    include: {
      mission: {
        include: {
          client: true,
          service: true,
          agreementLine: { include: { agreement: true } },
          extras: true,
        },
      },
    },
  });

  // Group by clientId + agreementId (null if ad-hoc)
  const groups = new Map<string, typeof timeEntries>();
  for (const te of timeEntries) {
    const key = `${te.mission.clientId}:${te.mission.agreementLine?.agreementId ?? 'adhoc'}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(te);
  }

  const results: GeneratedInvoice[] = [];

  for (const [key, entries] of groups) {
    const [clientIdStr, agreementStr] = key.split(':');
    const clientId = Number(clientIdStr);
    const agreementId = agreementStr === 'adhoc' ? null : Number(agreementStr);
    const client = entries[0].mission.client;

    // Skip if already invoiced for this period
    const existing = await prisma.invoice.findFirst({
      where: {
        clientId,
        agreementId: agreementId ?? undefined,
        periodStart,
        periodEnd,
        status: { not: 'FAILED' },
      },
    });
    if (existing) continue;

    const lines: any[] = [];
    const seenExtras = new Set<number>();

    // Group entries by missionId to aggregate mission lines
    const missionMap = new Map<number, typeof entries>();
    for (const te of entries) {
      if (!missionMap.has(te.missionId)) missionMap.set(te.missionId, []);
      missionMap.get(te.missionId)!.push(te);
    }

    for (const [missionId, teList] of missionMap) {
      const mission = teList[0].mission;
      const line = teList[0].mission.agreementLine;
      const totalMinutes = teList.reduce((sum, te) => sum + (te.actualMinutes ?? 0), 0);

      let lineQty = 0;
      let unit = 'HOUR';
      let unitPriceCents = 0;
      let priceRule = line?.priceRule ?? 'HOURLY';

      if (priceRule === 'FIXED_PER_VISIT' && line?.fixedPriceCents) {
        lineQty = 1;
        unit = 'PIECE';
        unitPriceCents = line.fixedPriceCents;
      } else if (priceRule === 'INCLUDED_IN_MONTHLY') {
        // Do not bill per visit; the monthly fee is billed separately (subscription line)
        continue;
      } else {
        const rate = line?.hourlyRateCents ?? mission.service.defaultHourlyRateCents;
        lineQty = totalMinutes / 60;
        unit = 'HOUR';
        unitPriceCents = rate;
      }
      const lineTotalCents = Math.round(unitPriceCents * lineQty);
      const rutEligible =
        client.rutEligible && mission.service.rutCategory !== 'NONE';
      const rutAmountCents = rutEligible ? Math.round(lineTotalCents * 0.5) : 0;

      lines.push({
        sourceType: 'MISSION',
        missionId,
        description: `${mission.service.name} ${formatDate(mission.date)}`,
        quantity: lineQty,
        unit,
        unitPriceCents,
        lineTotalCents,
        rutEligible,
        rutAmountCents,
        vatRate: 25,
        fortnoxArticleId: mission.service.fortnoxArticleId ?? null,
      });

      // Mission extras (on-site additions)
      for (const extra of mission.extras) {
        if (seenExtras.has(extra.id) || !extra.billable) continue;
        seenExtras.add(extra.id);
        lines.push({
          sourceType: 'EXTRA',
          missionId,
          missionExtraId: extra.id,
          description: extra.description,
          quantity: extra.quantity,
          unit: 'PIECE',
          unitPriceCents: extra.unitPriceCents,
          lineTotalCents: extra.totalCents,
          rutEligible: false,
          rutAmountCents: 0,
          vatRate: 25,
        });
      }
    }

    // Cancellation fees
    const cancelledBillable = await prisma.mission.findMany({
      where: {
        clientId,
        date: { gte: periodStart, lte: periodEnd },
        status: 'CANCELLED',
        billableCancellation: true,
        ...(agreementId ? { agreementLine: { agreementId } } : {}),
      },
      include: { service: true, agreementLine: true },
    });
    for (const m of cancelledBillable) {
      const agreement = m.agreementLine
        ? await prisma.agreement.findUnique({ where: { id: m.agreementLine.agreementId } })
        : null;
      const feePct = agreement?.cancellationFeePercent ?? 50;
      const baseCents = m.agreementLine?.fixedPriceCents
        ?? Math.round((m.agreementLine?.hourlyRateCents ?? m.service.defaultHourlyRateCents) * m.plannedDurationMinutes / 60);
      const feeCents = Math.round((baseCents * feePct) / 100);
      lines.push({
        sourceType: 'CANCELLATION_FEE',
        missionId: m.id,
        description: `Avbokningsavgift ${formatDate(m.date)} (${feePct}%)`,
        quantity: 1,
        unit: 'PIECE',
        unitPriceCents: feeCents,
        lineTotalCents: feeCents,
        rutEligible: false,
        rutAmountCents: 0,
        vatRate: 25,
      });
    }

    if (lines.length === 0) continue;

    const subtotalCents = lines.reduce((s, l) => s + l.lineTotalCents, 0);
    const rutCents = lines.reduce((s, l) => s + (l.rutAmountCents || 0), 0);
    const vatCents = Math.round(lines.reduce((s, l) => s + l.lineTotalCents * (l.vatRate / 100), 0));
    const totalCents = subtotalCents + vatCents - rutCents;

    const invoice = await prisma.invoice.create({
      data: {
        clientId,
        agreementId: agreementId ?? undefined,
        periodStart,
        periodEnd,
        status: 'DRAFT',
        subtotalCents,
        rutCents,
        vatCents,
        totalCents,
        invoiceMethod: client.invoiceMethod,
        lines: { create: lines },
      },
      include: { lines: true },
    });

    results.push({
      invoiceId: invoice.id,
      clientId,
      totalCents,
      rutCents,
      linesCount: lines.length,
    });
  }

  return results;
}

function formatDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
