import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getTimewaveCustomers } from '../_lib/timewaveData.js';
import { prisma } from '../_lib/prisma.js';
import { loadWebSubscribers, mergeWebSubscribers } from '../_lib/webSubscribers.js';

// Sync-vägen drar all klientlista (paginerad) + 24 mån missions för att
// klassificera pattern, plus alla återkommande uppdrag i abonnemangsfönstret.
// Med 60 s dog synken med 504 innan den hann spara - syncedAt förblev null
// och ingen kund fick abonnemangsstatus, så Marketings segment för aktiva
// kunder blev alltid tomt. 300 s är Pro-planens tak.
export const config = { maxDuration: 300 };

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // ---------------------------------------------------------------------------
    // POST: Lägg till manuella kontakter
    // ---------------------------------------------------------------------------
    if (req.method === 'POST') {
      const { contacts } = req.body as { contacts: { name: string; email: string; phone: string }[] };
      if (!contacts || !Array.isArray(contacts)) {
        return res.status(400).json({ error: 'Missing or invalid contacts array' });
      }

      const doc = await prisma.automatedTemplate.findUnique({ where: { id: 'system_contacts' } });
      const currentContacts: any[] = (doc?.blocks as any)?.customers || [];
      const currentMap = new Map(currentContacts.filter(c => c.email).map(c => [c.email.toLowerCase(), c]));

      let addedLines = 0;
      for (const item of contacts) {
        if (!item.email || !item.email.includes('@')) continue;
        const key = item.email.toLowerCase().trim();
        const existing = currentMap.get(key);
        if (existing) {
          // Uppdatera om saknas
          if (!existing.phone && item.phone) existing.phone = item.phone;
          if (!existing.name && item.name) existing.name = item.name;
        } else {
          currentMap.set(key, {
            name: item.name || 'Okänd',
            email: key,
            phone: item.phone || '',
            clientType: 'Uppladdad Manuell',
            area: 'Okänd',
            serviceTypes: [],
            source: 'manual'
          });
          addedLines++;
        }
      }

      const newContactsList = Array.from(currentMap.values());
      await prisma.automatedTemplate.upsert({
        where: { id: 'system_contacts' },
        create: { id: 'system_contacts', subject: 'SYSTEM_CONTACTS', blocks: { customers: newContactsList } as any },
        update: { blocks: { ...((doc?.blocks as any) || {}), customers: newContactsList } as any }
      });

      return res.json({ success: true, added: addedLines, total: newContactsList.length });
    }

    // ---------------------------------------------------------------------------
    // GET: Hämta (och eventuellt synka med Timewave)
    // ---------------------------------------------------------------------------
    const sync = req.query.sync === 'true';

    // Logga environment variables för att se vilka som Vercel skickar med
    console.log("ENV VARS AVAILABLE ON VERCEL:", Object.keys(process.env).join(', '));
    if (process.env.DATABASE_URL) console.log("DATABASE_URL EXISTS.");
    if (process.env.POSTGRES_URL) console.log("POSTGRES_URL EXISTS.");

    // Ladda den befintliga databasen
    const doc = await prisma.automatedTemplate.findUnique({ where: { id: 'system_contacts' } });
    let dbContacts: any[] = (doc?.blocks as any)?.customers || [];
    let syncedAt: string | null = (doc?.blocks as any)?.syncedAt || null;

    if (sync || dbContacts.length === 0) {
      // Synkronisera från Timewave
      const twCustomers = await getTimewaveCustomers();
      const dbMap = new Map(dbContacts.map(c => [c.email.toLowerCase(), c]));
      // Abonnemangsstatus sätts om från grunden vid varje synk, så att en kund
      // som tagits bort i Timewave inte ligger kvar som "Aktiv".
      dbContacts.forEach(c => { delete c.subscription; });

      // Uppdatera eller lägg till de från Timewave
      twCustomers.forEach((twContact: any) => {
        if (!twContact.email) return;
        const key = twContact.email.toLowerCase();
        const existing = dbMap.get(key);
        if (existing) {
          // Skriv över med färsk data från Timewave (men behåll source om vi vill, eller märk om)
          existing.name = twContact.name;
          if (twContact.phone) existing.phone = twContact.phone;
          existing.clientType = twContact.clientType;
          existing.area = twContact.area;
          existing.serviceTypes = twContact.serviceTypes;
          existing.pattern = twContact.pattern;
          existing.subscription = twContact.subscription;
          existing.totalMissions = twContact.totalMissions;
          existing.recurringMissions = twContact.recurringMissions;
          existing.source = 'timewave';
        } else {
          twContact.source = 'timewave';
          dbMap.set(key, twContact);
        }
      });

      dbContacts = Array.from(dbMap.values());
      syncedAt = new Date().toISOString();

      // Spara tillbaka till databasen
      await prisma.automatedTemplate.upsert({
        where: { id: 'system_contacts' },
        create: { id: 'system_contacts', subject: 'SYSTEM_CONTACTS', blocks: { customers: dbContacts, syncedAt } as any },
        update: { blocks: { customers: dbContacts, syncedAt } as any }
      });
    }

    // Hemsidans nyhetsbrevsanmälningar ligger i ett eget dokument och läggs
    // till här, efter synken – de sparas alltså aldrig in i system_contacts.
    const uniqueCustomers = mergeWebSubscribers(dbContacts, await loadWebSubscribers());
    
    // Central suppression (hard blocks + system_optouts + domän-suffix)
    const { isBlockedEmail, isBlockedPhone } = await import('../_lib/suppressionList.js');

    // Build segments summary
    const areaCounts: Record<string, number> = {};
    const typeCounts: Record<string, number> = {};
    const serviceCounts: Record<string, number> = {};
    const patternCounts: Record<string, number> = {};
    const subscriptionCounts: Record<string, number> = {};
    
    // Check for internal team members
    const internalKeywords = ['emma selenius', 'mikaela wigert', 'rani shakir', 'annika wigert', '@stodona.se'];
    let internalCount = 0;

    for (const c of uniqueCustomers as any[]) {
      areaCounts[c.area] = (areaCounts[c.area] || 0) + 1;
      typeCounts[c.clientType] = (typeCounts[c.clientType] || 0) + 1;
      c.serviceTypes.forEach((s: string) => serviceCounts[s] = (serviceCounts[s] || 0) + 1);
      const pat = c.pattern || 'Okänd historik';
      patternCounts[pat] = (patternCounts[pat] || 0) + 1;
      if (c.subscription) subscriptionCounts[c.subscription] = (subscriptionCounts[c.subscription] || 0) + 1;

      const isInternal = internalKeywords.some(kw => c.name.toLowerCase().includes(kw) || c.email.toLowerCase().includes(kw));
      if (isInternal) {
        c.clientType = 'Internt Team (Test)';
        internalCount++;
      }
      c.optedOutEmail = await isBlockedEmail(c.email);
      c.optedOutSms = c.phone ? await isBlockedPhone(c.phone) : false;
    }
    
    // Add internal team to type counts explicitly if found
    if (internalCount > 0) {
      typeCounts['Internt Team (Test)'] = internalCount;
    }

    res.json({
      customers: uniqueCustomers,
      total: uniqueCustomers.length,
      syncedAt,
      segments: {
        areas: Object.entries(areaCounts).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count),
        clientTypes: Object.entries(typeCounts).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count),
        serviceTypes: Object.entries(serviceCounts).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count),
        patterns: Object.entries(patternCounts).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count),
        subscriptions: Object.entries(subscriptionCounts).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count),
      }
    });
  } catch (err: any) {
    console.error("Newsletter customers error:", err.message, err.cause);
    res.status(500).json({ error: err.message, cause: err.cause ? String(err.cause) : undefined, stack: err.stack });
  }
}

