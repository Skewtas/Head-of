/**
 * Flexible file-based importer (CSV / JSON).
 *
 * Accepts arrays of objects from any source (Timewave export, manual, etc.) and
 * writes them into HeadOf 2.0 tables using the same idempotency rules as the
 * Timewave-API importer.
 *
 * Field name aliases — we accept multiple common names so users don't need to
 * rename CSV columns. See FIELD_ALIASES below.
 */
import { prisma } from './prisma.js';
import type { ImportSummary } from './timewaveImport.js';

type Row = Record<string, any>;

// Helper: read a field value from a row trying several aliases
function pick(row: Row, ...keys: string[]): any {
  for (const k of keys) {
    const v = row[k] ?? row[k.toLowerCase()] ?? row[k.toUpperCase()];
    if (v !== undefined && v !== null && v !== '') return v;
  }
  return undefined;
}

function asInt(v: any, def: number | null = null): number | null {
  if (v === undefined || v === null || v === '') return def;
  const n = parseInt(String(v), 10);
  return Number.isFinite(n) ? n : def;
}
function asNumber(v: any, def: number | null = null): number | null {
  if (v === undefined || v === null || v === '') return def;
  const n = Number(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : def;
}
function asBool(v: any, def = false): boolean {
  if (v === undefined || v === null || v === '') return def;
  const s = String(v).toLowerCase().trim();
  return s === 'true' || s === '1' || s === 'yes' || s === 'ja' || s === 'y';
}
function asDate(v: any): Date | null {
  if (!v) return null;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
}
function asEmail(v: any): string | null {
  if (!v) return null;
  const s = String(v).trim().toLowerCase();
  return s.includes('@') ? s : null;
}

// ─────────────────────────────────────────────────────────────
// Clients
// ─────────────────────────────────────────────────────────────
export async function importClientsFromRows(rows: Row[]): Promise<ImportSummary> {
  let created = 0, updated = 0, skipped = 0, errors = 0;

  for (const row of rows) {
    try {
      const externalId = String(pick(row, 'id', 'tw_id', 'timewave_id', 'kund_id', 'client_id') ?? '');
      const explicitNumber = pick(row, 'client_number', 'kund_nummer', 'kundnummer');
      const clientNumber = explicitNumber ?? (externalId ? `TW-${externalId}` : null);
      if (!clientNumber) { skipped++; continue; }

      const firstName = pick(row, 'first_name', 'fornamn', 'förnamn');
      const lastName = pick(row, 'last_name', 'efternamn');
      const companyName = pick(row, 'company_name', 'foretag', 'företag', 'company');
      const name = pick(row, 'name', 'namn') ??
        (firstName || lastName ? [firstName, lastName].filter(Boolean).join(' ').trim() : companyName) ??
        `Kund ${clientNumber}`;

      const isCompany = !!(companyName || pick(row, 'org_number', 'orgnr', 'organisationsnummer')) ||
        String(pick(row, 'type', 'typ', 'kund_typ') ?? '').toLowerCase().includes('företag') ||
        String(pick(row, 'type', 'typ') ?? '').toLowerCase() === 'company';

      const data: any = {
        name,
        type: isCompany ? 'COMPANY' : 'PRIVATE',
        orgNumber: pick(row, 'org_number', 'orgnr', 'organisationsnummer') ?? null,
        personalNumber: pick(row, 'personal_number', 'personnummer', 'ssn') ?? null,
        phone: pick(row, 'phone', 'telefon', 'mobile', 'mobil', 'cellphone') ?? null,
        email: asEmail(pick(row, 'email', 'epost', 'e-post', 'mail')),
        rutEligible: asBool(pick(row, 'rut_eligible', 'rut'), !isCompany),
        status: ['paused', 'pausad', '0', 'inactive'].includes(
          String(pick(row, 'status') ?? 'active').toLowerCase()
        ) ? 'PAUSED' : 'ACTIVE',
        priceModel: 'HOURLY',
        invoiceMethod: 'EMAIL',
        paymentTermsDays: asInt(pick(row, 'payment_terms_days', 'kredittid'), 30) ?? 30,
      };

      const existing = await prisma.client.findUnique({ where: { clientNumber } });
      let clientRow;
      if (existing) {
        clientRow = await prisma.client.update({ where: { id: existing.id }, data });
        updated++;
      } else {
        clientRow = await prisma.client.create({ data: { clientNumber, ...data } });
        created++;
      }

      // Inline address (if columns are present in the same row)
      const street = pick(row, 'street', 'adress', 'address');
      const zip = pick(row, 'zip', 'postnummer', 'postal_code');
      const city = pick(row, 'city', 'ort', 'stad');
      if (street || zip || city) {
        const addrType = String(pick(row, 'address_type') ?? 'SERVICE').toUpperCase().includes('INVOICE') ? 'INVOICE' : 'SERVICE';
        const existingAddr = await prisma.clientAddress.findFirst({
          where: { clientId: clientRow.id, type: addrType, street: street ?? '', zip: (zip ?? '').replace(/\s+/g, '') },
        });
        const adata = {
          clientId: clientRow.id,
          type: addrType as 'INVOICE' | 'SERVICE',
          street: street ?? '',
          zip: (zip ?? '').replace(/\s+/g, ''),
          city: city ?? '',
          doorCode: pick(row, 'door_code', 'portkod') ?? null,
          parkingInfo: pick(row, 'parking_info', 'parkering') ?? null,
          isDefault: true,
        };
        if (existingAddr) {
          await prisma.clientAddress.update({ where: { id: existingAddr.id }, data: adata });
        } else {
          await prisma.clientAddress.create({ data: adata });
        }
      }
    } catch (e) {
      console.error('[importClientsFromRows]', row, e);
      errors++;
    }
  }
  return { entity: 'clients', created, updated, skipped, errors };
}

// ─────────────────────────────────────────────────────────────
// Client addresses (separate file)
// ─────────────────────────────────────────────────────────────
export async function importClientAddressesFromRows(rows: Row[]): Promise<ImportSummary> {
  let created = 0, updated = 0, skipped = 0, errors = 0;
  // Map external client id → internal id
  const allClients = await prisma.client.findMany({ select: { id: true, clientNumber: true } });
  const byClientNumber = new Map(allClients.map((c) => [c.clientNumber, c.id]));

  for (const row of rows) {
    try {
      const extId = String(pick(row, 'client_id', 'kund_id') ?? '');
      const clientNumber = pick(row, 'client_number', 'kundnummer') ?? (extId ? `TW-${extId}` : null);
      if (!clientNumber) { skipped++; continue; }
      const clientId = byClientNumber.get(clientNumber);
      if (!clientId) { skipped++; continue; }

      const type = String(pick(row, 'address_type', 'type', 'typ') ?? 'SERVICE')
        .toUpperCase().includes('INVOICE') ? 'INVOICE' : 'SERVICE';
      const street = pick(row, 'street', 'adress', 'address') ?? '';
      const zip = (pick(row, 'zip', 'postnummer', 'postal_code') ?? '').replace(/\s+/g, '');
      const city = pick(row, 'city', 'ort', 'stad') ?? '';
      const data = {
        clientId,
        type: type as 'INVOICE' | 'SERVICE',
        street,
        zip,
        city,
        doorCode: pick(row, 'door_code', 'portkod') ?? null,
        parkingInfo: pick(row, 'parking_info', 'parkering') ?? null,
        isDefault: asBool(pick(row, 'is_default', 'default'), false),
      };
      const existing = await prisma.clientAddress.findFirst({
        where: { clientId, type: data.type, street, zip },
      });
      if (existing) {
        await prisma.clientAddress.update({ where: { id: existing.id }, data });
        updated++;
      } else {
        await prisma.clientAddress.create({ data });
        created++;
      }
    } catch (e) {
      console.error('[importClientAddressesFromRows]', row, e);
      errors++;
    }
  }
  return { entity: 'client_addresses', created, updated, skipped, errors };
}

// ─────────────────────────────────────────────────────────────
// Employees
// ─────────────────────────────────────────────────────────────
export async function importEmployeesFromRows(rows: Row[]): Promise<ImportSummary> {
  let created = 0, updated = 0, skipped = 0, errors = 0;
  for (const row of rows) {
    try {
      const firstName = pick(row, 'first_name', 'fornamn', 'förnamn') ?? '';
      const lastName = pick(row, 'last_name', 'efternamn') ?? '';
      const email = asEmail(pick(row, 'email', 'epost', 'mail'));
      const phone = pick(row, 'phone', 'telefon', 'mobile') ?? null;
      const status = ['inactive', '0', 'inaktiv'].includes(
        String(pick(row, 'status') ?? 'active').toLowerCase()
      ) ? 'INACTIVE' : 'ACTIVE';
      const data = {
        firstName: firstName || `Emp${pick(row, 'id') ?? ''}`,
        lastName,
        email,
        phone,
        personalNumber: pick(row, 'personal_number', 'personnummer') ?? null,
        status: status as 'ACTIVE' | 'INACTIVE',
        employmentType: 'HOURLY' as const,
        baseHourlyRateCents: Math.round((asNumber(pick(row, 'hourly_rate', 'timlon', 'timlön', 'salary'), 0) ?? 0) * 100),
      };
      let existing = email ? await prisma.employee.findUnique({ where: { email } }) : null;
      if (!existing && phone) {
        existing = await prisma.employee.findFirst({ where: { phone, firstName: data.firstName, lastName: data.lastName } });
      }
      if (existing) {
        await prisma.employee.update({ where: { id: existing.id }, data });
        updated++;
      } else {
        await prisma.employee.create({ data });
        created++;
      }
    } catch (e) {
      console.error('[importEmployeesFromRows]', row, e);
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

export async function importServicesFromRows(rows: Row[]): Promise<ImportSummary> {
  let created = 0, updated = 0, skipped = 0, errors = 0;
  for (const row of rows) {
    try {
      const name = String(pick(row, 'name', 'namn', 'service_name') ?? '').trim();
      if (!name) { skipped++; continue; }
      const data = {
        description: pick(row, 'description', 'beskrivning') ?? null,
        defaultMinutes: asInt(pick(row, 'default_minutes', 'minuter', 'duration_minutes'), 60) ?? 60,
        defaultHourlyRateCents: Math.round((asNumber(pick(row, 'price', 'pris', 'hourly_rate', 'timpris'), 0) ?? 0) * 100),
        category: pick(row, 'category', 'kategori') ?? null,
        rutCategory: guessRutCategory(name),
        isBillable: true,
        isPayable: true,
        active: !asBool(pick(row, 'deleted', 'deleted_at'), false),
      };
      const existing = await prisma.service.findUnique({ where: { name } });
      if (existing) {
        await prisma.service.update({ where: { id: existing.id }, data });
        updated++;
      } else {
        await prisma.service.create({ data: { name, ...data } });
        created++;
      }
    } catch (e) {
      console.error('[importServicesFromRows]', row, e);
      errors++;
    }
  }
  return { entity: 'services', created, updated, skipped, errors };
}

// ─────────────────────────────────────────────────────────────
// Agreements (one row per agreement = one workorder)
// ─────────────────────────────────────────────────────────────
function mapWorkorderStatus(raw: any): 'DRAFT' | 'QUOTED' | 'ACTIVE' | 'PAUSED' | 'TERMINATED' | 'ARCHIVED' {
  const s = String(raw ?? '').toLowerCase().trim();
  const n = parseInt(s, 10);
  if (!isNaN(n)) {
    switch (n) {
      case 1: return 'ACTIVE';
      case 2: return 'QUOTED';
      case 3: return 'ACTIVE';
      case 4: return 'TERMINATED';
      case 5: return 'PAUSED';
      case 6: return 'ARCHIVED';
    }
  }
  if (s.includes('aktiv') || s.includes('under') || s.includes('beställd')) return 'ACTIVE';
  if (s.includes('offert') || s.includes('quote')) return 'QUOTED';
  if (s.includes('uppehåll') || s.includes('paus')) return 'PAUSED';
  if (s.includes('stängd') || s.includes('terminated') || s.includes('closed')) return 'TERMINATED';
  if (s.includes('borttag') || s.includes('archived')) return 'ARCHIVED';
  return 'DRAFT';
}

export async function importAgreementsFromRows(rows: Row[]): Promise<ImportSummary> {
  const allClients = await prisma.client.findMany({ select: { id: true, clientNumber: true } });
  const clientByNumber = new Map(allClients.map((c) => [c.clientNumber, c.id]));

  let created = 0, updated = 0, skipped = 0, errors = 0;
  for (const row of rows) {
    try {
      const externalId = String(pick(row, 'id', 'workorder_id', 'wo_id') ?? '');
      const explicitNumber = pick(row, 'agreement_number', 'avtalsnummer', 'workorder_number');
      const agreementNumber = explicitNumber ?? (externalId ? `TW-${externalId}` : null);
      if (!agreementNumber) { skipped++; continue; }

      const clientExtId = String(pick(row, 'client_id', 'kund_id') ?? '');
      const clientNumber = pick(row, 'client_number', 'kundnummer') ?? (clientExtId ? `TW-${clientExtId}` : null);
      const clientId = clientNumber ? clientByNumber.get(clientNumber) : null;
      if (!clientId) { skipped++; continue; }

      const data = {
        clientId,
        status: mapWorkorderStatus(pick(row, 'status')),
        validFrom: asDate(pick(row, 'valid_from', 'startdate', 'start_date', 'startdatum')),
        validTo: asDate(pick(row, 'valid_to', 'enddate', 'end_date', 'slutdatum')),
        internalNotes: pick(row, 'description', 'notes', 'beskrivning') ?? null,
        paymentTermsDays: asInt(pick(row, 'payment_terms_days', 'kredittid'), null),
      };

      const existing = await prisma.agreement.findUnique({ where: { agreementNumber } });
      if (existing) {
        await prisma.agreement.update({ where: { id: existing.id }, data });
        updated++;
      } else {
        await prisma.agreement.create({ data: { agreementNumber, ...data } });
        created++;
      }
    } catch (e) {
      console.error('[importAgreementsFromRows]', row, e);
      errors++;
    }
  }
  return { entity: 'agreements', created, updated, skipped, errors };
}

// ─────────────────────────────────────────────────────────────
// Agreement lines (workorderlines)
// ─────────────────────────────────────────────────────────────
function detectRrule(row: Row): string {
  const explicit = pick(row, 'rrule');
  if (explicit) return String(explicit);
  const intervalName = String(pick(row, 'recurrence', 'recurrence_interval', 'interval', 'frekvens') ?? '').toLowerCase();
  if (intervalName.includes('varannan')) return 'FREQ=WEEKLY;INTERVAL=2';
  if (intervalName.includes('var fjärde') || intervalName.includes('var 4')) return 'FREQ=WEEKLY;INTERVAL=4';
  if (intervalName.includes('vecka')) return 'FREQ=WEEKLY';
  if (intervalName.includes('månad')) return 'FREQ=MONTHLY';
  if (intervalName.includes('engång') || intervalName.includes('once')) return 'FREQ=DAILY;COUNT=1';
  return 'FREQ=WEEKLY';
}

export async function importAgreementLinesFromRows(rows: Row[]): Promise<ImportSummary> {
  const [agreements, services] = await Promise.all([
    prisma.agreement.findMany({ select: { id: true, agreementNumber: true } }),
    prisma.service.findMany({ select: { id: true, name: true } }),
  ]);
  const agByNumber = new Map(agreements.map((a) => [a.agreementNumber, a.id]));
  const svcByName = new Map(services.map((s) => [s.name.toLowerCase(), s.id]));

  let created = 0, updated = 0, skipped = 0, errors = 0;
  for (const row of rows) {
    try {
      const woId = String(pick(row, 'workorder_id', 'agreement_id') ?? '');
      const agreementNumber = pick(row, 'agreement_number', 'workorder_number') ?? (woId ? `TW-${woId}` : null);
      const agreementId = agreementNumber ? agByNumber.get(agreementNumber) : null;
      if (!agreementId) { skipped++; continue; }

      const serviceName = String(pick(row, 'service_name', 'service', 'tjanst', 'tjänst') ?? '').toLowerCase().trim();
      const serviceId = svcByName.get(serviceName);
      if (!serviceId) { skipped++; continue; }

      const lineExtId = String(pick(row, 'id', 'workorderline_id') ?? '');
      const tag = lineExtId ? `[TW-WOL-${lineExtId}]` : '';
      const startTime = String(pick(row, 'start_time', 'starttime', 'starttid') ?? '08:00').slice(0, 5);
      const endTime = String(pick(row, 'end_time', 'endtime', 'sluttid') ?? '10:00').slice(0, 5);
      const [sh, sm] = startTime.split(':').map(Number);
      const [eh, em] = endTime.split(':').map(Number);
      const durationMin = Math.max(60, (eh * 60 + em) - (sh * 60 + sm));

      const data = {
        agreementId,
        serviceId,
        rrule: detectRrule(row),
        defaultStartTime: startTime,
        defaultDurationMinutes: durationMin,
        plannedCrewSize: asInt(pick(row, 'crew_size', 'quantity', 'antal'), 1) ?? 1,
        priceRule: 'HOURLY' as const,
        hourlyRateCents: Math.round((asNumber(pick(row, 'price', 'pris', 'hourly_rate'), 0) ?? 0) * 100),
        status: 'ACTIVE' as const,
        validFrom: asDate(pick(row, 'startdate', 'valid_from')),
        validTo: asDate(pick(row, 'enddate', 'valid_to')),
        customerInstructions:
          (pick(row, 'description', 'beskrivning', 'instructions') ?? '') +
          (tag ? `\n\n${tag}` : ''),
      };

      const existing = tag
        ? await prisma.agreementLine.findFirst({ where: { agreementId, customerInstructions: { contains: tag } } })
        : null;
      if (existing) {
        await prisma.agreementLine.update({ where: { id: existing.id }, data });
        updated++;
      } else {
        await prisma.agreementLine.create({ data });
        created++;
      }
    } catch (e) {
      console.error('[importAgreementLinesFromRows]', row, e);
      errors++;
    }
  }
  return { entity: 'agreement_lines', created, updated, skipped, errors };
}

// ─────────────────────────────────────────────────────────────
// Missions (one row per scheduled instance)
// ─────────────────────────────────────────────────────────────
export async function importMissionsFromRows(rows: Row[]): Promise<ImportSummary> {
  const [clients, services] = await Promise.all([
    prisma.client.findMany({ select: { id: true, clientNumber: true } }),
    prisma.service.findMany({ select: { id: true, name: true } }),
  ]);
  const clientByNumber = new Map(clients.map((c) => [c.clientNumber, c.id]));
  const svcByName = new Map(services.map((s) => [s.name.toLowerCase(), s.id]));
  const employees = await prisma.employee.findMany({ select: { id: true, email: true, phone: true } });
  const empByEmail = new Map(employees.filter((e) => e.email).map((e) => [e.email!.toLowerCase(), e.id]));

  let created = 0, updated = 0, skipped = 0, errors = 0;
  for (const row of rows) {
    try {
      const clientExtId = String(pick(row, 'client_id', 'kund_id') ?? '');
      const clientNumber = pick(row, 'client_number', 'kundnummer') ?? (clientExtId ? `TW-${clientExtId}` : null);
      const clientId = clientNumber ? clientByNumber.get(clientNumber) : null;
      if (!clientId) { skipped++; continue; }

      const serviceName = String(pick(row, 'service_name', 'service', 'tjanst', 'tjänst') ?? '').toLowerCase().trim();
      const serviceId = svcByName.get(serviceName);
      if (!serviceId) { skipped++; continue; }

      const dateRaw = pick(row, 'date', 'datum', 'startdate');
      const date = asDate(dateRaw);
      if (!date) { skipped++; continue; }
      const startTime = String(pick(row, 'start_time', 'starttime', 'starttid') ?? '08:00').slice(0, 5);
      const endTime = String(pick(row, 'end_time', 'endtime', 'sluttid') ?? '10:00').slice(0, 5);
      const plannedStart = new Date(`${dateRaw}T${startTime}:00`);
      const plannedEnd = new Date(`${dateRaw}T${endTime}:00`);
      const plannedDurationMinutes = Math.max(
        60,
        Math.round((plannedEnd.getTime() - plannedStart.getTime()) / 60000)
      );
      const cancelledRaw = String(pick(row, 'cancelled', 'avbokad', 'status') ?? '').toLowerCase();
      const cancelled = cancelledRaw === '1' || cancelledRaw === 'true' || cancelledRaw.includes('avbok') || cancelledRaw.includes('cancel');

      const lineExtId = String(pick(row, 'bookingline_id', 'booking_line_id', 'id') ?? '');
      const tag = lineExtId ? `[TW-BL-${lineExtId}]` : '';

      const data: any = {
        clientId,
        serviceId,
        date,
        plannedStart,
        plannedEnd,
        plannedCrewSize: asInt(pick(row, 'crew_size', 'quantity', 'antal'), 1) ?? 1,
        plannedDurationMinutes,
        status: cancelled ? 'CANCELLED' : 'PLANNED',
        customerInstructions: pick(row, 'instructions', 'kundinstruktioner') ?? null,
        internalNotes: tag + (pick(row, 'notes', 'anteckningar') ? `\n${pick(row, 'notes', 'anteckningar')}` : ''),
        rruleInstanceDate: date,
      };

      const existing = tag
        ? await prisma.mission.findFirst({ where: { internalNotes: { contains: tag } } })
        : null;
      let missionRow;
      if (existing) {
        missionRow = await prisma.mission.update({ where: { id: existing.id }, data });
        updated++;
      } else {
        missionRow = await prisma.mission.create({ data });
        created++;
      }

      // Optional: assigned employees
      const empEmail = asEmail(pick(row, 'employee_email', 'anstalld_epost'));
      if (empEmail) {
        const empId = empByEmail.get(empEmail);
        if (empId) {
          await prisma.missionAssignment.upsert({
            where: { missionId_employeeId: { missionId: missionRow.id, employeeId: empId } },
            create: { missionId: missionRow.id, employeeId: empId, role: 'MEMBER', plannedStart, plannedEnd },
            update: {},
          });
        }
      }
    } catch (e) {
      console.error('[importMissionsFromRows]', row, e);
      errors++;
    }
  }
  return { entity: 'missions', created, updated, skipped, errors };
}

// ─────────────────────────────────────────────────────────────
// Dispatcher
// ─────────────────────────────────────────────────────────────
export type ImportEntity =
  | 'clients'
  | 'client_addresses'
  | 'employees'
  | 'services'
  | 'agreements'
  | 'agreement_lines'
  | 'missions';

export async function importRows(entity: ImportEntity, rows: Row[]): Promise<ImportSummary> {
  switch (entity) {
    case 'clients': return importClientsFromRows(rows);
    case 'client_addresses': return importClientAddressesFromRows(rows);
    case 'employees': return importEmployeesFromRows(rows);
    case 'services': return importServicesFromRows(rows);
    case 'agreements': return importAgreementsFromRows(rows);
    case 'agreement_lines': return importAgreementLinesFromRows(rows);
    case 'missions': return importMissionsFromRows(rows);
    default: throw new Error(`Unknown entity: ${entity}`);
  }
}
