import { prisma } from './prisma.js';
import { expandRrule, combineDateTime } from './rruleGen.js';

export interface GenerateResult {
  agreementLineId: number;
  created: number;
  skipped: number;
}

/**
 * Materialize missions from an agreement_line's RRULE between [from, until].
 * Idempotent: uses unique(agreement_line_id, rrule_instance_date).
 * Skips dates that already have a mission.
 */
export async function generateMissionsForLine(
  agreementLineId: number,
  from: Date,
  until: Date
): Promise<GenerateResult> {
  const line = await prisma.agreementLine.findUnique({
    where: { id: agreementLineId },
    include: { agreement: true },
  });
  if (!line) throw new Error(`Agreement line ${agreementLineId} not found`);
  if (line.status !== 'ACTIVE') return { agreementLineId, created: 0, skipped: 0 };
  if (line.agreement.status !== 'ACTIVE') return { agreementLineId, created: 0, skipped: 0 };

  const effectiveFrom = maxDate(from, line.validFrom ?? from, line.agreement.validFrom ?? from);
  const effectiveUntil = minDate(until, line.validTo ?? until, line.agreement.validTo ?? until);
  if (effectiveFrom > effectiveUntil) return { agreementLineId, created: 0, skipped: 0 };

  const dtstart = combineDateTime(effectiveFrom, line.defaultStartTime);
  const dates = expandRrule(line.rrule, effectiveFrom, effectiveUntil, dtstart);

  let created = 0;
  let skipped = 0;

  for (const d of dates) {
    const instanceDate = toDateOnly(d);
    const plannedStart = combineDateTime(d, line.defaultStartTime);
    const plannedEnd = new Date(plannedStart.getTime() + line.defaultDurationMinutes * 60000);

    try {
      await prisma.mission.create({
        data: {
          agreementLineId: line.id,
          clientId: line.agreement.clientId,
          serviceId: line.serviceId,
          teamId: line.agreement.teamId ?? undefined,
          date: instanceDate,
          plannedStart,
          plannedEnd,
          plannedCrewSize: line.plannedCrewSize,
          plannedDurationMinutes: line.defaultDurationMinutes,
          status: 'PLANNED',
          customerInstructions: line.customerInstructions ?? undefined,
          rruleInstanceDate: instanceDate,
        },
      });
      created++;
    } catch (err: any) {
      if (err?.code === 'P2002') skipped++;
      else throw err;
    }
  }
  return { agreementLineId, created, skipped };
}

/**
 * Generate for all active agreement lines 60 days ahead.
 * Called nightly (e.g. via Vercel cron or manual trigger).
 */
export async function generateAllMissions(daysAhead = 60): Promise<GenerateResult[]> {
  const from = startOfDay(new Date());
  const until = new Date(from.getTime() + daysAhead * 24 * 3600_000);
  const lines = await prisma.agreementLine.findMany({
    where: { status: 'ACTIVE', agreement: { status: 'ACTIVE' } },
    select: { id: true },
  });
  const results: GenerateResult[] = [];
  for (const l of lines) {
    try {
      results.push(await generateMissionsForLine(l.id, from, until));
    } catch (err) {
      console.error(`[generateMissions] line ${l.id} failed:`, err);
    }
  }
  return results;
}

function toDateOnly(d: Date): Date {
  const out = new Date(d);
  out.setUTCHours(0, 0, 0, 0);
  return out;
}
function startOfDay(d: Date): Date {
  const out = new Date(d);
  out.setHours(0, 0, 0, 0);
  return out;
}
function maxDate(...ds: Date[]): Date {
  return ds.reduce((a, b) => (a > b ? a : b));
}
function minDate(...ds: Date[]): Date {
  return ds.reduce((a, b) => (a < b ? a : b));
}
