/**
 * Prenumeranter som anmält sig till nyhetsbrevet på stodona.se.
 *
 * De ligger i ett EGET dokument (system_web_subscribers) och inte i
 * system_contacts. Timewave-synken läser hela system_contacts, arbetar i
 * flera minuter och skriver sedan tillbaka allt – en anmälan som kom in under
 * tiden skulle skrivas över. Här rör synken ingenting, och listorna slås ihop
 * först när kundregistret läses ut (se mergeWebSubscribers).
 */
import { prisma } from './prisma.js';
import { normalizeEmail } from './suppressionList.js';

export const WEB_SUBSCRIBERS_ID = 'system_web_subscribers';
export const WEB_SUBSCRIBER_TYPE = 'Nyhetsbrev (hemsidan)';

const MAX_SUBSCRIBERS = 50000;

export interface WebSubscriber {
  email: string;
  name: string;
  phone: string;
  /** Vilket formulär på hemsidan anmälan kom från, t.ex. footer_newsletter. */
  leadSource: string;
  page: string;
  subscribedAt: string;
}

export interface SubscribeInput {
  email?: unknown;
  name?: unknown;
  phone?: unknown;
  source?: unknown;
  page?: unknown;
}

const text = (v: unknown, max: number): string =>
  typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max) : '';

/** Rensar en inkommande anmälan. Returnerar null om e-postadressen inte duger. */
export function sanitizeSubscriber(input: SubscribeInput, now = new Date()): WebSubscriber | null {
  const email = normalizeEmail(text(input?.email, 200));
  if (!/^[^\s@<>"',;]+@[^\s@<>"',;]+\.[a-z]{2,}$/.test(email)) return null;
  return {
    email,
    name: text(input.name, 120),
    phone: text(input.phone, 40),
    leadSource: text(input.source, 60) || 'stodona.se',
    page: text(input.page, 200),
    subscribedAt: now.toISOString(),
  };
}

/**
 * Lägger till en prenumerant. Samma adress läggs aldrig in två gånger – en
 * ny anmälan fyller bara i namn och telefon som saknades.
 */
export function upsertSubscriber(
  list: WebSubscriber[],
  sub: WebSubscriber,
): { list: WebSubscriber[]; added: boolean } {
  const existing = list.find((s) => normalizeEmail(s.email) === sub.email);
  if (existing) {
    if (!existing.name && sub.name) existing.name = sub.name;
    if (!existing.phone && sub.phone) existing.phone = sub.phone;
    return { list, added: false };
  }
  return { list: [...list, sub], added: true };
}

export async function loadWebSubscribers(): Promise<WebSubscriber[]> {
  const doc = await prisma.automatedTemplate.findUnique({ where: { id: WEB_SUBSCRIBERS_ID } });
  const list = (doc?.blocks as any)?.subscribers;
  return Array.isArray(list) ? list : [];
}

/** Sparar en anmälan. Raden låses så att två samtidiga anmälningar inte skriver över varandra. */
export async function saveWebSubscriber(sub: WebSubscriber): Promise<{ added: boolean; total: number }> {
  return prisma.$transaction(async (tx) => {
    await tx.automatedTemplate.upsert({
      where: { id: WEB_SUBSCRIBERS_ID },
      create: { id: WEB_SUBSCRIBERS_ID, subject: 'SYSTEM_WEB_SUBSCRIBERS', blocks: { subscribers: [] } as any },
      update: {},
    });
    await tx.$queryRaw`SELECT id FROM "AutomatedTemplate" WHERE id = ${WEB_SUBSCRIBERS_ID} FOR UPDATE`;
    const doc = await tx.automatedTemplate.findUnique({ where: { id: WEB_SUBSCRIBERS_ID } });
    const current: WebSubscriber[] = Array.isArray((doc?.blocks as any)?.subscribers)
      ? (doc!.blocks as any).subscribers
      : [];
    if (current.length >= MAX_SUBSCRIBERS) throw new Error('Prenumerantlistan är full');
    const { list, added } = upsertSubscriber(current, sub);
    await tx.automatedTemplate.update({
      where: { id: WEB_SUBSCRIBERS_ID },
      data: { blocks: { subscribers: list } as any },
    });
    return { added, total: list.length };
  });
}

/**
 * Slår ihop kundregistret med hemsidans prenumeranter. Finns adressen redan
 * i registret gäller kundposten – en kund ska inte bli "prenumerant" för att
 * hen också fyllde i formuläret.
 */
export function mergeWebSubscribers<T extends { email?: string }>(customers: T[], subscribers: WebSubscriber[]): T[] {
  const known = new Set(customers.map((c) => normalizeEmail(c.email)).filter(Boolean));
  const extra: any[] = [];
  for (const s of subscribers) {
    const email = normalizeEmail(s.email);
    if (!email || known.has(email)) continue;
    known.add(email);
    extra.push({
      name: s.name || 'Prenumerant',
      email,
      phone: s.phone || '',
      clientType: WEB_SUBSCRIBER_TYPE,
      area: 'Okänd',
      serviceTypes: [],
      source: 'stodona.se',
      leadSource: s.leadSource,
      subscribedAt: s.subscribedAt,
    });
  }
  return extra.length ? [...customers, ...extra] : customers;
}
