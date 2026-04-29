import { prisma } from './prisma.js';

export interface PayrollGenerateOpts {
  periodStart: Date;
  periodEnd: Date;
  employeeIds?: number[];
}

export interface GeneratedPayroll {
  employeeId: number;
  linesCreated: number;
  totalMinutes: number;
  totalAmountCents: number;
}

/**
 * Aggregate approved time_entries + absences + outlays into PayrollLines per employee.
 * Classifies segments as REGULAR / OB_WEEKEND / OB_EVENING / OB_NIGHT / OVERTIME.
 */
export async function generatePayrollForPeriod(
  opts: PayrollGenerateOpts
): Promise<GeneratedPayroll[]> {
  const { periodStart, periodEnd, employeeIds } = opts;

  const employees = await prisma.employee.findMany({
    where: {
      status: 'ACTIVE',
      ...(employeeIds ? { id: { in: employeeIds } } : {}),
    },
  });

  const results: GeneratedPayroll[] = [];

  for (const emp of employees) {
    // Clear any draft payroll lines for this period that weren't sent yet
    await prisma.payrollLine.deleteMany({
      where: {
        employeeId: emp.id,
        periodStart,
        periodEnd,
        sentToFortnoxAt: null,
      },
    });

    const entries = await prisma.timeEntry.findMany({
      where: {
        employeeId: emp.id,
        adminApprovedAt: { not: null },
        mission: { date: { gte: periodStart, lte: periodEnd } },
      },
      include: { mission: true },
    });

    // Weekly aggregation to detect overtime (>40h/week)
    const weekMap = new Map<string, number>(); // isoWeek → minutes
    const linesData: any[] = [];

    for (const te of entries) {
      if (!te.checkInAt || !te.checkOutAt || !te.actualMinutes) continue;
      const segments = classifySegments(te.checkInAt, te.checkOutAt);
      for (const seg of segments) {
        const rate = Math.round(emp.baseHourlyRateCents * (seg.type === 'REGULAR' ? 1 : emp.obMultiplier));
        const amountCents = Math.round((rate * seg.minutes) / 60);
        linesData.push({
          employeeId: emp.id,
          periodStart,
          periodEnd,
          type: seg.type,
          minutes: seg.minutes,
          rateCents: rate,
          amountCents,
          sourceTimeEntryId: te.id,
          description: `${te.mission.date.toISOString().slice(0, 10)}`,
        });
        if (seg.type === 'REGULAR') {
          const wk = isoWeek(te.checkInAt);
          weekMap.set(wk, (weekMap.get(wk) ?? 0) + seg.minutes);
        }
      }
    }

    // Overtime: any regular minutes over 40h/week split off
    for (const line of linesData) {
      if (line.type !== 'REGULAR') continue;
    }
    // (Simple policy: overtime calc per week)
    for (const [wk, totalMin] of weekMap) {
      if (totalMin > 40 * 60) {
        const over = totalMin - 40 * 60;
        linesData.push({
          employeeId: emp.id,
          periodStart,
          periodEnd,
          type: 'OVERTIME',
          minutes: over,
          rateCents: Math.round(emp.baseHourlyRateCents * 1.5),
          amountCents: Math.round((emp.baseHourlyRateCents * 1.5 * over) / 60),
          description: `Övertid vecka ${wk}`,
        });
      }
    }

    // Outlays (from mission_extras type=OUTLAY attributed to this employee)
    const outlays = await prisma.missionExtra.findMany({
      where: {
        payableToEmployeeId: emp.id,
        type: 'OUTLAY',
        mission: { date: { gte: periodStart, lte: periodEnd } },
      },
    });
    for (const o of outlays) {
      linesData.push({
        employeeId: emp.id,
        periodStart,
        periodEnd,
        type: 'OUTLAY',
        minutes: 0,
        rateCents: 0,
        amountCents: o.totalCents,
        description: `Utlägg: ${o.description}`,
      });
    }

    // Absences
    const absences = await prisma.absence.findMany({
      where: {
        employeeId: emp.id,
        approved: true,
        fromDate: { lte: periodEnd },
        toDate: { gte: periodStart },
      },
    });
    for (const a of absences) {
      const fromD = a.fromDate > periodStart ? a.fromDate : periodStart;
      const toD = a.toDate < periodEnd ? a.toDate : periodEnd;
      const days = Math.floor((toD.getTime() - fromD.getTime()) / (24 * 3600_000)) + 1;
      if (days <= 0) continue;
      const type = a.type === 'SICK' ? 'ABSENCE_SICK' : a.type === 'VACATION' ? 'ABSENCE_VACATION' : null;
      if (!type) continue;
      linesData.push({
        employeeId: emp.id,
        periodStart,
        periodEnd,
        type,
        minutes: days * 8 * 60,
        rateCents: 0,
        amountCents: 0,
        description: `${a.type} ${formatDate(a.fromDate)} - ${formatDate(a.toDate)}`,
      });
    }

    if (linesData.length === 0) continue;

    await prisma.payrollLine.createMany({ data: linesData });
    const totalMinutes = linesData.reduce((s, l) => s + (l.minutes as number), 0);
    const totalAmountCents = linesData.reduce((s, l) => s + (l.amountCents as number), 0);
    results.push({
      employeeId: emp.id,
      linesCreated: linesData.length,
      totalMinutes,
      totalAmountCents,
    });
  }
  return results;
}

interface Segment {
  type: 'REGULAR' | 'OB_EVENING' | 'OB_NIGHT' | 'OB_WEEKEND';
  minutes: number;
}

/**
 * Walk through the shift minute-by-hour and bucket into REGULAR / OB types.
 * Simplified Swedish collective-agreement-ish rules:
 *  - Weekend (Sat/Sun): OB_WEEKEND
 *  - Weekday 18:00-22:00: OB_EVENING
 *  - Weekday 22:00-06:00: OB_NIGHT
 *  - Else: REGULAR
 */
function classifySegments(start: Date, end: Date): Segment[] {
  const buckets: Record<Segment['type'], number> = {
    REGULAR: 0,
    OB_EVENING: 0,
    OB_NIGHT: 0,
    OB_WEEKEND: 0,
  };
  const step = 5 * 60_000; // 5-min granularity
  for (let t = start.getTime(); t < end.getTime(); t += step) {
    const d = new Date(t);
    const dow = d.getDay(); // 0=Sun, 6=Sat
    const hour = d.getHours();
    if (dow === 0 || dow === 6) {
      buckets.OB_WEEKEND += 5;
    } else if (hour >= 22 || hour < 6) {
      buckets.OB_NIGHT += 5;
    } else if (hour >= 18) {
      buckets.OB_EVENING += 5;
    } else {
      buckets.REGULAR += 5;
    }
  }
  const out: Segment[] = [];
  for (const [type, minutes] of Object.entries(buckets)) {
    if (minutes > 0) out.push({ type: type as Segment['type'], minutes });
  }
  return out;
}

function isoWeek(d: Date): string {
  const date = new Date(d.getTime());
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() + 3 - ((date.getDay() + 6) % 7));
  const week1 = new Date(date.getFullYear(), 0, 4);
  const week = 1 + Math.round(((date.getTime() - week1.getTime()) / 86400000 - 3 + ((week1.getDay() + 6) % 7)) / 7);
  return `${date.getFullYear()}-W${String(week).padStart(2, '0')}`;
}

function formatDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
