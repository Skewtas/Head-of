import { getTimewaveToken, forceRefreshTimewaveToken } from './timewaveAuth.js';

export interface TimewaveCustomer {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  city: string;
  area: string;
  clientType: string;
  postalCode: string;
  serviceTypes: string[];
  personalNumber: string | null;
  createdAt: string;
  // Kundmönster — härleds från missions (Timewave). "Återkommande" = har
  // någonsin haft en mission med type === 'reccurent'. "Engångskunder" = har
  // enbart haft engångsuppdrag. "Okänd historik" = vi hittade inga missions
  // (nyregistrerad eller ej bokad under lookback-fönstret).
  pattern?: 'Återkommande' | 'Engångskunder' | 'Okänd historik';
  totalMissions?: number;
  recurringMissions?: number;
}

/** Normalize Swedish phone to E.164 (+46...) */
function normalizePhone(raw: string | undefined | null): string | null {
  if (!raw) return null;
  const cleaned = raw.replace(/[\s\-()]/g, '');
  // Only keep mobile numbers (07x)
  if (/^07\d{8}$/.test(cleaned)) return '+46' + cleaned.substring(1);
  if (/^467\d{8}$/.test(cleaned)) return '+' + cleaned;
  if (/^\+467\d{8}$/.test(cleaned)) return cleaned;
  return null; // Not a valid Swedish mobile
}

export async function getTimewaveCustomers(): Promise<TimewaveCustomer[]> {
  let token = await getTimewaveToken();
  const timewaveBaseUrl = "https://api.timewave.se/v3";
  
  // 1. Fetch Clients
  let allClients: any[] = [];
  
  // Hämta första sidan för att få reda på totalPages
  let firstResp = await fetch(`${timewaveBaseUrl}/clients?page[size]=100&page[number]=1`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
  });
  if (firstResp.status === 403) {
    token = await forceRefreshTimewaveToken();
    firstResp = await fetch(`${timewaveBaseUrl}/clients?page[size]=100&page[number]=1`, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    });
  }
  const firstData = await firstResp.json();
  const totalPages = firstData.last_page || 1;
  allClients = allClients.concat(firstData.data || []);

  // Hämta resterande sidor Parallellt (mycket snabbare, undviker Vercel timeout!)
  if (totalPages > 1) {
    const fetchPromises = [];
    for (let p = 2; p <= totalPages; p++) {
      fetchPromises.push(
        fetch(`${timewaveBaseUrl}/clients?page[size]=100&page[number]=${p}`, {
          headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
        }).then(r => r.json())
      );
    }
    const results = await Promise.all(fetchPromises);
    results.forEach(res => {
      allClients = allClients.concat(res.data || []);
    });
  }

  // ----- Kundmönster: hämta missions för ~24 mån och räkna reccurent per client -----
  // Ratelimit-skyddat på samma sätt som api/timewave-summary/missions.ts:
  // page[size]=200 + batchar om 4 samtidigt + backoff vid 429.
  const now = new Date();
  const missionEnd = now.toISOString().slice(0, 10);
  const missionStartDate = new Date(now);
  missionStartDate.setMonth(missionStartDate.getMonth() - 24);
  const missionStart = missionStartDate.toISOString().slice(0, 10);
  const missionUrlBase = `${timewaveBaseUrl}/missions?filter[startdate]=${missionStart}&filter[enddate]=${missionEnd}&page[size]=200`;
  const fetchMissionsPage = async (p: number, retry = true): Promise<any> => {
    let r = await fetch(`${missionUrlBase}&page[number]=${p}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    });
    if (r.status === 403 && retry) {
      token = await forceRefreshTimewaveToken();
      return fetchMissionsPage(p, false);
    }
    if (r.status === 429) {
      await new Promise((res) => setTimeout(res, 1000));
      r = await fetch(`${missionUrlBase}&page[number]=${p}`, {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      });
    }
    if (!r.ok) return { data: [], last_page: 0 };
    return r.json();
  };

  const clientMissionStats: Record<string, { total: number; recurring: number }> = {};
  const recordMission = (m: any) => {
    if (m.cancelled === 1) return;
    const cid = m.client?.id;
    if (!cid) return;
    const key = String(cid);
    const stats = clientMissionStats[key] || (clientMissionStats[key] = { total: 0, recurring: 0 });
    stats.total += 1;
    if (m.type === 'reccurent') stats.recurring += 1;
  };

  try {
    const firstMissions = await fetchMissionsPage(1);
    (firstMissions.data || []).forEach(recordMission);
    const missionLastPage = firstMissions.last_page || 1;
    if (missionLastPage > 1) {
      const PAR = 4;
      for (let p = 2; p <= missionLastPage; p += PAR) {
        const batch: number[] = [];
        for (let i = 0; i < PAR && p + i <= missionLastPage; i++) batch.push(p + i);
        const results = await Promise.all(
          batch.map((pn) =>
            fetchMissionsPage(pn).catch((e) => {
              console.error('customers: missions page', pn, e.message);
              return { data: [] };
            })
          )
        );
        results.forEach((data: any) => (data.data || []).forEach(recordMission));
      }
    }
  } catch (err: any) {
    console.error('customers: mission-fetch failed, pattern falls back to Okänd historik', err.message);
  }

  const ordersResp = await fetch(`${timewaveBaseUrl}/orders?page[size]=1000`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" }
  });
  const ordersData = await ordersResp.json();
  const clientServices: Record<string, Set<string>> = {};
  
  for (const o of ordersData.data || []) {
    const cid = String(o.client_id);
    if (!clientServices[cid]) clientServices[cid] = new Set();
    for (const svc of (o.services || [])) {
      const sname = (svc.name || '').toLowerCase();
      
      if (sname.includes('hemstäd') || sname.includes('vecka') || sname.includes('månad') || sname.includes('återkommande')) {
        clientServices[cid].add('Hemstädning');
      }
      if (sname.includes('fönster')) {
        clientServices[cid].add('Fönsterputsning');
      }
      if (sname.includes('flytt')) {
        clientServices[cid].add('Flyttstädning');
      }
      if (sname.includes('bygg')) {
        clientServices[cid].add('Byggstädning');
      }
      if (sname.includes('stor') || sname.includes('grov')) {
        clientServices[cid].add('Storstädning');
      }
      if (sname.includes('enstaka') || sname.includes('engång')) {
        clientServices[cid].add('Engångsuppdrag');
      }
      if (sname.includes('kontor')) {
        clientServices[cid].add('Kontorsstädning');
      }
    }
  }

  const areaMap: Record<string, string[]> = {
    'Ekerö/Mälaröarna': ['ekerö', 'skå', 'färentuna', 'munsö', 'stenhamra'],
    'Lidingö': ['lidingö'],
    'Söderort': ['johanneshov', 'hägersten', 'älvsjö', 'bandhagen', 'enskede', 'gullmarsplan', 'farsta', 'skarpnäck', 'skärholmen', 'bredäng', 'liljeholmen', 'aspudden', 'midsommarkransen', 'telefonplan', 'fruängen'],
    'Södertörn/Nynäs': ['södertälje', 'tyresö', 'haninge', 'handen', 'tumba', 'huddinge', 'botkyrka', 'salem'],
    'Nacka/Värmdö': ['nacka', 'saltsjöbaden', 'saltsjö-duvnäs', 'boo', 'orminge', 'värmdö', 'gustavsberg'],
    'Västerort/Järfälla': ['järfälla', 'jakobsberg', 'barkarby', 'viksjö', 'bromma', 'hässelby', 'spånga', 'vällingby', 'blackeberg', 'kista', 'rinkeby', 'tensta', 'sundbyberg'],
    'Norrort/Solna': ['solna', 'sollentuna', 'täby', 'danderyd', 'stocksund', 'djursholm', 'vallentuna', 'åkersberga', 'upplands väsby', 'sigtuna', 'märsta'],
  };

  const postalMap: Record<string, string> = {
    '111': 'Norrmalm/City', '112': 'Kungsholmen/Essingeöarna', '113': 'Vasastan/Torsplan',
    '114': 'Östermalm', '115': 'Gärdet/Djurgården', '116': 'Södermalm (Katarina/Sofia)',
    '117': 'Södermalm (Maria/Högalid)', '118': 'Södermalm', '120': 'Hammarby Sjöstad',
  };

  const customers = allClients
    .filter((c: any) => !c.deleted && (
       (c.email && c.email.includes('@')) || 
       normalizePhone(c.phone || c.mobile || c.cellphone)
    ))
    .map((c: any) => {
      const addresses = c.addresses || [];
      const activeAddr = addresses.find((a: any) => !a.deleted && (a.city || a.postal_code));
      const reqCity = (activeAddr?.city || '').trim();
      const normalizedCity = reqCity.toLowerCase();
      const postalCode = (activeAddr?.postal_code || '').replace(/\s+/g, '').trim();

      let area = 'Övriga';
      let isStockholmPostal = false;
      if (postalCode.length >= 3) {
         const prefix = postalCode.substring(0, 3);
         if (postalMap[prefix] && (normalizedCity === 'stockholm' || normalizedCity === '')) {
             area = postalMap[prefix];
             isStockholmPostal = true;
         }
      }

      if (!isStockholmPostal && normalizedCity) {
         const maybeStadsdel = Object.values(postalMap).find(val => normalizedCity.includes(val.toLowerCase()));
         if (maybeStadsdel) {
           area = maybeStadsdel;
         } else {
           for (const [areaName, cities] of Object.entries(areaMap)) {
             if (cities.some(cityMatch => normalizedCity.includes(cityMatch))) {
               area = areaName;
               break;
             }
           }
         }
         if (area === 'Övriga' && normalizedCity === 'stockholm') area = 'Stockholm (Övriga)';
      }

      const clientType = c.clienttype?.name || (c.type === 'company' ? 'Företag' : 'Privat');
      const sTypes = clientServices[String(c.id)] ? Array.from(clientServices[String(c.id)]) : ['Okänd Tjänst'];

      const normPhone = normalizePhone(c.phone || c.mobile || c.cellphone);
      const parsedEmail = (c.email && c.email.includes('@'))
         ? c.email.toLowerCase().trim()
         : `${normPhone}@no-email.stodona.se`;

      const stats = clientMissionStats[String(c.id)];
      let pattern: TimewaveCustomer['pattern'] = 'Okänd historik';
      if (stats && stats.total > 0) {
        pattern = stats.recurring > 0 ? 'Återkommande' : 'Engångskunder';
      }

      return {
        id: c.id,
        name: (c.first_name && c.last_name) ? `${c.first_name} ${c.last_name}` : c.company_name || c.first_name || '',
        email: parsedEmail,
        phone: normPhone,
        city: reqCity,
        area,
        clientType,
        postalCode,
        serviceTypes: sTypes,
        personalNumber: c.personal_number || c.ssn || c.social_security_number || c.registration_number || c.national_id || c.org_number || null,
        createdAt: c.created_at || new Date().toISOString(),
        pattern,
        totalMissions: stats?.total ?? 0,
        recurringMissions: stats?.recurring ?? 0,
      };
    });

  const uniqueMap = new Map<string, any>();
  customers.forEach((c: any) => {
    if (!uniqueMap.has(c.email)) {
      uniqueMap.set(c.email, c);
    } else {
      const existing = uniqueMap.get(c.email);
      existing.serviceTypes = Array.from(new Set([...existing.serviceTypes, ...c.serviceTypes]));
      // Slå ihop missions-stats; om NÅGON av delkunderna är återkommande
      // räknas hela e-postgruppen som återkommande.
      existing.totalMissions = (existing.totalMissions ?? 0) + (c.totalMissions ?? 0);
      existing.recurringMissions = (existing.recurringMissions ?? 0) + (c.recurringMissions ?? 0);
      if (existing.totalMissions > 0) {
        existing.pattern = existing.recurringMissions > 0 ? 'Återkommande' : 'Engångskunder';
      }
    }
  });

  return Array.from(uniqueMap.values());
}
