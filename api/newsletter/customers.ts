import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getTimewaveCustomers } from '../_lib/timewaveData.js';
import { prisma } from '../_lib/prisma.js';

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
        update: { blocks: { customers: newContactsList } as any }
      });

      return res.json({ success: true, added: addedLines, total: newContactsList.length });
    }

    // ---------------------------------------------------------------------------
    // GET: Hämta (och eventuellt synka med Timewave)
    // ---------------------------------------------------------------------------
    const sync = req.query.sync === 'true';

    // Ladda den befintliga databasen
    const doc = await prisma.automatedTemplate.findUnique({ where: { id: 'system_contacts' } });
    let dbContacts: any[] = (doc?.blocks as any)?.customers || [];

    if (sync || dbContacts.length === 0) {
      // Synkronisera från Timewave
      const twCustomers = await getTimewaveCustomers();
      const dbMap = new Map(dbContacts.map(c => [c.email.toLowerCase(), c]));

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
          existing.source = 'timewave';
        } else {
          twContact.source = 'timewave';
          dbMap.set(key, twContact);
        }
      });

      dbContacts = Array.from(dbMap.values());

      // Spara tillbaka till databasen
      await prisma.automatedTemplate.upsert({
        where: { id: 'system_contacts' },
        create: { id: 'system_contacts', subject: 'SYSTEM_CONTACTS', blocks: { customers: dbContacts } as any },
        update: { blocks: { customers: dbContacts } as any }
      });
    }

    const uniqueCustomers = dbContacts;
    
    // Fetch opt-outs from system_optouts document
    const optOutDoc = await prisma.automatedTemplate.findUnique({
      where: { id: 'system_optouts' }
    });
    
    let optOutData: { emails: string[], phones: string[] } = { emails: [], phones: [] };
    if (optOutDoc && optOutDoc.blocks && typeof optOutDoc.blocks === 'object') {
      optOutData = optOutDoc.blocks as any;
    }
    
    const optedOutEmails = new Set(optOutData.emails || []);
    const optedOutPhones = new Set(optOutData.phones || []);

    // Build segments summary
    const areaCounts: Record<string, number> = {};
    const typeCounts: Record<string, number> = {};
    const serviceCounts: Record<string, number> = {};
    
    // Check for internal team members
    const internalKeywords = ['emma selenius', 'mikaela wigert', 'rani shakir', 'annika wigert', '@stodona.se'];
    let internalCount = 0;

    uniqueCustomers.forEach((c: any) => {
      areaCounts[c.area] = (areaCounts[c.area] || 0) + 1;
      typeCounts[c.clientType] = (typeCounts[c.clientType] || 0) + 1;
      c.serviceTypes.forEach((s: string) => serviceCounts[s] = (serviceCounts[s] || 0) + 1);
      
      const isInternal = internalKeywords.some(kw => c.name.toLowerCase().includes(kw) || c.email.toLowerCase().includes(kw));
      if (isInternal) {
        c.clientType = 'Internt Team (Test)';
        internalCount++;
      }
      c.optedOutEmail = optedOutEmails.has(c.email);
      c.optedOutSms = c.phone ? optedOutPhones.has(c.phone) : false;
    });
    
    // Add internal team to type counts explicitly if found
    if (internalCount > 0) {
      typeCounts['Internt Team (Test)'] = internalCount;
    }

    res.json({
      customers: uniqueCustomers,
      total: uniqueCustomers.length,
      segments: {
        areas: Object.entries(areaCounts).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count),
        clientTypes: Object.entries(typeCounts).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count),
        serviceTypes: Object.entries(serviceCounts).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count),
      }
    });
  } catch (err: any) {
    console.error("Newsletter customers error:", err.message);
    res.status(500).json({ error: err.message });
  }
}

