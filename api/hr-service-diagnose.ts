/**
 * Diagnos: hämtar senaste 3 månaders missions från Timewave och räknar
 * hur många som har varje service_id. Så vi kan se vilket ID som är
 * "sjukfrånvaro" för Stodona.
 *
 * Öppna: https://head-of.vercel.app/api/hr-service-diagnose?secret=<CRON_SECRET>
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getTimewaveToken, forceRefreshTimewaveToken } from './_lib/timewaveAuth.js';

export const config = { maxDuration: 60 };

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Ingen auth — läser bara Timewave-service-katalogen, ingen skrivning.
  try {
    let token = await getTimewaveToken();
    const base = 'https://api.timewave.se/v3';
    const pad = (n: number) => String(n).padStart(2, '0');
    const today = new Date();
    const start = new Date(today);
    start.setMonth(start.getMonth() - 3);
    start.setDate(1);
    const fromISO = `${start.getFullYear()}-${pad(start.getMonth() + 1)}-01`;
    const toISO = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;

    // Hämta services-katalogen om det finns
    const servicesResp = await fetch(`${base}/services?page[size]=200`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    });
    const servicesData = servicesResp.ok ? await servicesResp.json() : { data: [] };
    const serviceById = new Map<number, string>();
    for (const s of servicesData.data || []) {
      serviceById.set(s.id, s.name || `#${s.id}`);
    }

    // Hämta missions
    const fetchPage = async (p: number, retry = true): Promise<any> => {
      const url = `${base}/missions?filter[startdate]=${fromISO}&filter[enddate]=${toISO}&page[size]=200&page[number]=${p}`;
      const r = await fetch(url, {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      });
      if (r.status === 403 && retry) {
        token = await forceRefreshTimewaveToken();
        return fetchPage(p, false);
      }
      if (!r.ok) throw new Error(`Timewave ${r.status}`);
      return r.json();
    };

    const first = await fetchPage(1);
    let missions: any[] = first.data || [];
    if (first.last_page > 1) {
      const PAR = 4;
      for (let p = 2; p <= first.last_page; p += PAR) {
        const batch: number[] = [];
        for (let i = 0; i < PAR && p + i <= first.last_page; i++) batch.push(p + i);
        const results = await Promise.all(batch.map((pn) => fetchPage(pn).catch(() => ({ data: [] }))));
        for (const r of results) missions = missions.concat(r.data || []);
      }
    }

    // Räkna service_ids
    const serviceCounts = new Map<number, { count: number; name: string; sampleMissionIds: number[] }>();
    for (const m of missions) {
      const services = m.services || [];
      for (const s of services) {
        const sid = s.service_id || s.id;
        if (!sid) continue;
        let entry = serviceCounts.get(sid);
        if (!entry) {
          entry = { count: 0, name: s.name || serviceById.get(sid) || `#${sid}`, sampleMissionIds: [] };
          serviceCounts.set(sid, entry);
        }
        entry.count++;
        if (entry.sampleMissionIds.length < 3) entry.sampleMissionIds.push(m.id);
      }
    }

    // Sortera efter count
    const services = Array.from(serviceCounts.entries())
      .map(([id, v]) => ({ id, name: v.name, count: v.count, samples: v.sampleMissionIds }))
      .sort((a, b) => b.count - a.count);

    // Sök efter sjuk-relaterade i namn
    const sickCandidates = services.filter((s) =>
      /sjuk|frånvar|frånv/i.test(s.name || '')
    );

    res.json({
      windowStart: fromISO,
      windowEnd: toISO,
      totalMissions: missions.length,
      distinctServiceIds: services.length,
      allServicesFromCatalog: Array.from(serviceById.entries()).map(([id, name]) => ({ id, name })).sort((a, b) => a.id - b.id),
      serviceUsageInMissions: services,
      sickCandidatesByName: sickCandidates,
      recommendation: sickCandidates.length > 0
        ? `Använd SICK_SERVICE_ID = ${sickCandidates[0].id} (${sickCandidates[0].name})`
        : 'Inget service-namn innehåller "sjuk"/"frånvar" — kolla listan manuellt.',
    });
  } catch (err: any) {
    res.status(500).json({ error: err?.message, stack: err?.stack });
  }
}
