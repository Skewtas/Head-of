/**
 * Timewave → HeadOf 2.0 importer.
 *
 * Matching strategy (idempotent):
 *  - Client.clientNumber = "TW-{tw.id}"
 *  - Team.name = workarea.name (unique per tenant)
 *  - Employee: match on email first, else `TW-{tw.id}` stored in fortnoxEmployeeId* as external mark.
 *    (no dedicated externalId field — we use email; employees without email are keyed by tw id in internal notes)
 *  - Service.name = tw.service.name (unique)
 *  - Agreement.agreementNumber = "TW-{tw.workorder.id}"
 *  - AgreementLine: match (agreement_id, tw.workorderline.id via internalNotes marker)  — simpler: recreate if missing
 *  - Mission: match on (agreement_line_id, date) OR internalNotes "TW-BL-{id}"
 *
 * Runs in a way that re-running updates changed fields but doesn't duplicate.
 */
import { prisma } from './prisma.js';
import { tw } from './timewaveApi.js';

export interface ImportSummary {
  entity: string;
  created: number;
  updated: number;
  skipped: number;
  errors: number;
  details?: any[];
}

// ─────────────────────────────────────────────────────────────
// Teams (from Timewave workareas)
// ─────────────────────────────────────────────────────────────
export async function importTeams(): Promise<ImportSummary> {
  const rows = await tw.workareas();
  let created = 0, updated = 0, errors = 0;
  for (const w of rows) {
    try {
      const existing = await prisma.team.findFirst({ where: { name: w.name } });
      if (existing) {
        if (w.region_code && existing.regionCode !== w.region_code) {
          await prisma.team.update({ where: { id: existing.id }, data: { regionCode: w.region_code } });
          updated++;
        }
      } else {
        await prisma.team.create({
          data: {
            name: w.name ?? `Workarea ${w.id}`,
            regionCode: w.region_code ?? null,
            status: 'ACTIVE',
          },
        });
        created++;
      }
    } catch (e) {
      console.error('[import teams]', w?.id, e);
      errors++;
    }
  }
  return { entity: 'teams', created, updated, skipped: 0, errors };
}

// ─────────────────────────────────────────────────────────────
// Clients (+ addresses)
// ─────────────────────────────────────────────────────────────
export async function importClients(): Promise<ImportSummary> {
  const [clients, addresses, clientTypes] = await Promise.all([
    tw.clients(),
    tw.clientAddresses(),
    tw.clientTypes().catch(() => []),
  ]);
  const typeMap = new Map<any, any>(clientTypes.map((t: any) => [t.id, t]));

  // Group addresses by client
  const addrByClient = new Map<string, any[]>();
  for (const a of addresses) {
    if (a.deleted) continue;
    const cid = String(a.client_id);
    if (!addrByClient.has(cid)) addrByClient.set(cid, []);
    addrByClient.get(cid)!.push(a);
  }

  let created = 0, updated = 0, skipped = 0, errors = 0;

  for (const c of clients) {
    if (c.deleted) { skipped++; continue; }
    const clientNumber = `TW-${c.id}`;
    const t = c.clienttype_id ? typeMap.get(c.clienttype_id) : null;
    const isCompany = t?.is_company === true || c.type === 'company';
    const name = (c.first_name || c.last_name)
      ? [c.first_name, c.last_name].filter(Boolean).join(' ').trim()
      : (c.company_name || c.name || `Kund ${c.id}`);

    const data = {
      name,
      type: isCompany ? 'COMPANY' as const : 'PRIVATE' as const,
      orgNumber: c.org_number ?? c.organisation_number ?? null,
      personalNumber: c.personal_number ?? c.ssn ?? null,
      phone: c.phone ?? c.mobile ?? c.cellphone ?? null,
      email: c.email && c.email.includes('@') ? c.email.toLowerCase().trim() : null,
      rutEligible: !isCompany,
      status: c.status === 0 ? 'PAUSED' as const : 'ACTIVE' as const,
      priceModel: 'HOURLY' as const,
      invoiceMethod: 'EMAIL' as const,
      paymentTermsDays: 30,
    };

    try {
      const existing = await prisma.client.findUnique({ where: { clientNumber } });
      let clientRow;
      if (existing) {
        clientRow = await prisma.client.update({ where: { id: existing.id }, data });
        updated++;
      } else {
        clientRow = await prisma.client.create({ data: { clientNumber, ...data } });
        created++;
      }

      // Addresses
      const addrs = addrByClient.get(String(c.id)) ?? [];
      for (const a of addrs) {
        const type = (a.address_type === 'invoice' || a.address_type === 'INVOICE')
          ? 'INVOICE' as const
          : 'SERVICE' as const;
        const existingAddr = await prisma.clientAddress.findFirst({
          where: {
            clientId: clientRow.id,
            type,
            street: a.address ?? a.street ?? '',
            zip: (a.postal_code ?? a.zip ?? '').replace(/\s+/g, ''),
          },
        });
        const adata = {
          clientId: clientRow.id,
          type,
          street: a.address ?? a.street ?? '',
          zip: (a.postal_code ?? a.zip ?? '').replace(/\s+/g, ''),
          city: a.city ?? '',
          doorCode: a.door_code ?? null,
          parkingInfo: a.parking_info ?? null,
          isDefault: a.is_default === true || a.default === true,
        };
        if (existingAddr) {
          await prisma.clientAddress.update({ where: { id: existingAddr.id }, data: adata });
        } else {
          await prisma.clientAddress.create({ data: adata });
        }
      }
    } catch (e) {
      console.error('[import client]', c?.id, e);
      errors++;
    }
  }
  return { entity: 'clients', created, updated, skipped, errors };
}

// ─────────────────────────────────────────────────────────────
// Employees
// ─────────────────────────────────────────────────────────────
export async function importEmployees(): Promise<ImportSummary> {
  const rows = await tw.employees();
  let created = 0, updated = 0, skipped = 0, errors = 0;

  for (const e of rows) {
    if (e.deleted) { skipped++; continue; }
    const email = e.email && e.email.includes('@') ? e.email.toLowerCase().trim() : null;
    const data = {
      firstName: e.first_name ?? e.name ?? `Emp${e.id}`,
      lastName: e.last_name ?? '',
      email,
      phone: e.phone ?? e.mobile ?? null,
      personalNumber: e.personal_number ?? null,
      status: (e.status === 1 || e.status === '1' || e.status === 'active') ? 'ACTIVE' as const : 'INACTIVE' as const,
      employmentType: 'HOURLY' as const,
      baseHourlyRateCents: Math.round((e.salary_hourlyrate ?? 0) * 100),
    };
    try {
      let existing = null as any;
      if (email) existing = await prisma.employee.findUnique({ where: { email } });
      if (!existing) {
        // Fallback: phone + name match
        existing = await prisma.employee.findFirst({
          where: {
            firstName: data.firstName,
            lastName: data.lastName,
            phone: data.phone ?? undefined,
          },
        });
      }
      if (existing) {
        await prisma.employee.update({ where: { id: existing.id }, data });
        updated++;
      } else {
        await prisma.employee.create({ data });
        created++;
      }
    } catch (err) {
      console.error('[import employee]', e?.id, err);
      errors++;
    }
  }
  return { entity: 'employees', created, updated, skipped, errors };
}

// ─────────────────────────────────────────────────────────────
// Services
// ─────────────────────────────────────────────────────────────
function guessRutCategory(name: string): 'NONE' | 'HOUSEHOLD' | 'WINDOW' | 'MOVING' | 'GARDENING' {
  const n = name.toLowerCase();
  if (n.includes('fönster')) return 'WINDOW';
  if (n.includes('flytt')) return 'MOVING';
  if (n.includes('trädgård')) return 'GARDENING';
  if (n.includes('städ') || n.includes('hem') || n.includes('kontor')) return 'HOUSEHOLD';
  return 'NONE';
}

export async function importServices(): Promise<ImportSummary> {
  const rows = await tw.services();
  let created = 0, updated = 0, skipped = 0, errors = 0;

  for (const s of rows) {
    const name = (s.name ?? '').trim();
    if (!name) { skipped++; continue; }
    const data = {
      description: s.description ?? null,
      defaultMinutes: Math.round(((s.duration ?? s.default_duration ?? 1) * 60)),
      defaultHourlyRateCents: Math.round((s.price ?? s.hourly_rate ?? 0) * 100),
      category: s.category?.name ?? null,
      rutCategory: guessRutCategory(name),
      isBillable: true,
      isPayable: true,
      active: !s.deleted,
    };
    try {
      const existing = await prisma.service.findUnique({ where: { name } });
      if (existing) {
        await prisma.service.update({ where: { id: existing.id }, data });
        updated++;
      } else {
        await prisma.service.create({ data: { name, ...data } });
        created++;
      }
    } catch (err) {
      console.error('[import service]', s?.id, err);
      errors++;
    }
  }
  return { entity: 'services', created, updated, skipped, errors };
}

// ─────────────────────────────────────────────────────────────
// Agreements + lines (from workorders + workorderlines)
// ─────────────────────────────────────────────────────────────
function mapWorkorderStatus(n: number): 'DRAFT' | 'QUOTED' | 'ACTIVE' | 'PAUSED' | 'TERMINATED' | 'ARCHIVED' {
  // 1=under arbete, 2=offert, 3=beställd, 4=stängd, 5=uppehåll, 6=borttagen
  switch (n) {
    case 1: return 'ACTIVE';
    case 2: return 'QUOTED';
    case 3: return 'ACTIVE';
    case 4: return 'TERMINATED';
    case 5: return 'PAUSED';
    case 6: return 'ARCHIVED';
    default: return 'DRAFT';
  }
}

function detectRrule(line: any): string {
  // Timewave exposes recurrence_interval_id + freq. We fall back to weekly on same weekday.
  const interval = line.recurrence_interval ?? line.recurrence ?? null;
  if (interval?.rrule) return interval.rrule as string;
  if (interval?.name) {
    const n = String(interval.name).toLowerCase();
    if (n.includes('vecka')) return 'FREQ=WEEKLY';
    if (n.includes('varannan')) return 'FREQ=WEEKLY;INTERVAL=2';
    if (n.includes('månad')) return 'FREQ=MONTHLY';
    if (n.includes('var 4')) return 'FREQ=WEEKLY;INTERVAL=4';
  }
  return 'FREQ=WEEKLY'; // safe default; can be corrected later in UI
}

export async function importAgreements(): Promise<ImportSummary> {
  const [workorders, workorderlines, services] = await Promise.all([
    tw.workorders(),
    tw.workorderlines(),
    prisma.service.findMany({ select: { id: true, name: true } }),
  ]);
  const serviceByName = new Map(services.map((s) => [s.name.toLowerCase(), s.id]));

  // Fetch all clients once
  const clients = await prisma.client.findMany({ select: { id: true, clientNumber: true } });
  const clientByTwId = new Map<string, number>();
  for (const c of clients) {
    if (c.clientNumber.startsWith('TW-')) {
      clientByTwId.set(c.clientNumber.slice(3), c.id);
    }
  }

  // Group lines by workorder_id
  const linesByWo = new Map<string, any[]>();
  for (const l of workorderlines) {
    const wid = String(l.workorder_id);
    if (!linesByWo.has(wid)) linesByWo.set(wid, []);
    linesByWo.get(wid)!.push(l);
  }

  let created = 0, updated = 0, skipped = 0, errors = 0;

  for (const wo of workorders) {
    if (wo.deleted) { skipped++; continue; }
    const agreementNumber = `TW-${wo.id}`;
    const clientId = clientByTwId.get(String(wo.client_id));
    if (!clientId) { skipped++; continue; }

    const data = {
      clientId,
      status: mapWorkorderStatus(wo.status ?? 1),
      validFrom: wo.startdate ? new Date(wo.startdate) : null,
      validTo: wo.enddate ? new Date(wo.enddate) : null,
      internalNotes: wo.description ?? wo.notes ?? null,
      paymentTermsDays: wo.payment_terms ?? null,
    };

    try {
      let ag = await prisma.agreement.findUnique({ where: { agreementNumber } });
      if (ag) {
        ag = await prisma.agreement.update({ where: { id: ag.id }, data });
        updated++;
      } else {
        ag = await prisma.agreement.create({ data: { agreementNumber, ...data } });
        created++;
      }

      const lines = linesByWo.get(String(wo.id)) ?? [];
      for (const l of lines) {
        if (l.deleted) continue;
        const serviceId = serviceByName.get(((l.service?.name ?? l.service_name ?? '') as string).toLowerCase());
        if (!serviceId) continue;
        const tag = `TW-WOL-${l.id}`;
        const existingLine = await prisma.agreementLine.findFirst({
          where: { agreementId: ag.id, customerInstructions: { contains: tag } },
        });
        const startTime = (l.starttime ?? '08:00').slice(0, 5);
        const endTime = (l.endtime ?? '10:00').slice(0, 5);
        const durationMin = minutesBetween(startTime, endTime);
        const lineData = {
          agreementId: ag.id,
          serviceId,
          rrule: detectRrule(l),
          defaultStartTime: startTime,
          defaultDurationMinutes: durationMin,
          plannedCrewSize: l.quantity ?? 1,
          priceRule: 'HOURLY' as const,
          hourlyRateCents: Math.round((l.price ?? 0) * 100),
          status: 'ACTIVE' as const,
          validFrom: l.startdate ? new Date(l.startdate) : null,
          validTo: l.enddate ? new Date(l.enddate) : null,
          customerInstructions:
            (l.description ? l.description + '\n\n' : '') + `[${tag}]`,
        };
        if (existingLine) {
          await prisma.agreementLine.update({ where: { id: existingLine.id }, data: lineData });
        } else {
          await prisma.agreementLine.create({ data: lineData });
        }
      }
    } catch (err) {
      console.error('[import agreement]', wo?.id, err);
      errors++;
    }
  }
  return { entity: 'agreements', created, updated, skipped, errors };
}

function minutesBetween(hhmmStart: string, hhmmEnd: string): number {
  const [sh, sm] = hhmmStart.split(':').map(Number);
  const [eh, em] = hhmmEnd.split(':').map(Number);
  const diff = eh * 60 + em - (sh * 60 + sm);
  return diff > 0 ? diff : 60;
}

// ─────────────────────────────────────────────────────────────
// Missions (bookinglines) in date range
// ─────────────────────────────────────────────────────────────
export async function importMissions(fromDate: string, toDate: string): Promise<ImportSummary> {
  const rows = await tw.missions(fromDate, toDate);
  const clients = await prisma.client.findMany({ select: { id: true, clientNumber: true } });
  const clientByTwId = new Map<string, number>();
  for (const c of clients) {
    if (c.clientNumber.startsWith('TW-')) clientByTwId.set(c.clientNumber.slice(3), c.id);
  }
  const services = await prisma.service.findMany({ select: { id: true, name: true } });
  const serviceByName = new Map(services.map((s) => [s.name.toLowerCase(), s.id]));
  const employees = await prisma.employee.findMany({ select: { id: true, email: true, firstName: true, lastName: true } });
  const empByEmail = new Map(employees.filter((e) => e.email).map((e) => [e.email!.toLowerCase(), e.id]));

  let created = 0, updated = 0, skipped = 0, errors = 0;

  for (const m of rows) {
    if (m.cancelled === 1 && !m.bookingline_id) { skipped++; continue; }
    const clientId = clientByTwId.get(String(m.client_id));
    if (!clientId) { skipped++; continue; }
    const serviceId = serviceByName.get(((m.service?.name ?? m.service_name ?? '') as string).toLowerCase());
    if (!serviceId) { skipped++; continue; }

    const date = new Date(m.startdate ?? m.date);
    date.setHours(0, 0, 0, 0);
    const plannedStart = new Date(`${m.startdate ?? m.date}T${(m.starttime ?? '08:00')}`);
    const plannedEnd = new Date(`${m.enddate ?? m.startdate ?? m.date}T${(m.endtime ?? '10:00')}`);
    const plannedDurationMinutes = Math.max(
      60,
      Math.round((plannedEnd.getTime() - plannedStart.getTime()) / 60000)
    );

    const tag = `TW-BL-${m.bookingline_id ?? m.id}`;
    try {
      const existing = await prisma.mission.findFirst({
        where: { internalNotes: { contains: tag } },
      });
      const data: any = {
        clientId,
        serviceId,
        date,
        plannedStart,
        plannedEnd,
        plannedCrewSize: m.quantity ?? 1,
        plannedDurationMinutes,
        status: m.cancelled === 1 ? 'CANCELLED' as const : 'PLANNED' as const,
        customerInstructions: m.customer_instructions ?? null,
        internalNotes: `[${tag}]` + (m.notes ? `\n${m.notes}` : ''),
        rruleInstanceDate: date,
      };
      let missionRow;
      if (existing) {
        missionRow = await prisma.mission.update({ where: { id: existing.id }, data });
        updated++;
      } else {
        missionRow = await prisma.mission.create({ data });
        created++;
      }

      // Assign employees if possible
      const empRefs = m.employees ?? m.assignments ?? [];
      for (const er of empRefs) {
        const empEmail = (er.email ?? '').toLowerCase();
        const empId = empByEmail.get(empEmail);
        if (!empId) continue;
        try {
          await prisma.missionAssignment.upsert({
            where: { missionId_employeeId: { missionId: missionRow.id, employeeId: empId } },
            create: {
              missionId: missionRow.id,
              employeeId: empId,
              role: 'MEMBER',
              plannedStart,
              plannedEnd,
            },
            update: {},
          });
        } catch {}
      }
    } catch (err) {
      console.error('[import mission]', m?.id, err);
      errors++;
    }
  }
  return { entity: 'missions', created, updated, skipped, errors };
}

// ─────────────────────────────────────────────────────────────
// Orchestrator
// ─────────────────────────────────────────────────────────────
export async function importAll(opts?: { missionFrom?: string; missionTo?: string }): Promise<ImportSummary[]> {
  const summary: ImportSummary[] = [];
  summary.push(await importTeams());
  summary.push(await importClients());
  summary.push(await importEmployees());
  summary.push(await importServices());
  summary.push(await importAgreements());
  if (opts?.missionFrom && opts?.missionTo) {
    summary.push(await importMissions(opts.missionFrom, opts.missionTo));
  }
  return summary;
}
