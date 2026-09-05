/**
 * Delad sjukfrånvaro-service. En enda källa som räknar sjukfrånvaro
 * från Timewave-missions. Används av både:
 *   - api/timewave-summary/missions.ts (Översiktens sickLeaveThisMonth)
 *   - api/routes/hr.ts (HR-sidan)
 *
 * DEFINITION AV SJUKFRÅNVARO
 * En "sjukfrånvaro-instans" = en mission med service_id = 3 ("Sjukdom"
 * i Timewave), räknat per anställd (emp.id). Samma logik som redan finns
 * i Översikten sedan innan.
 */
import { getTimewaveToken, forceRefreshTimewaveToken } from './timewaveAuth.js';

export const SICK_SERVICE_ID = 3;
const TW_BASE = 'https://api.timewave.se/v3';

export interface SickLeaveEntry {
  employeeId: number;
  name: string;
  count: number;
}

export interface SickLeaveByMonth {
  windowStart: string;
  windowEnd: string;
  months: string[];                                          // ['2026-07', '2026-08', '2026-09']
  perMonth: Record<string, SickLeaveEntry[]>;                // 'YYYY-MM' → [{emp, name, count}]
  total: SickLeaveEntry[];                                   // summa över alla månader
  totalMissions: number;
  sickMissionsFound: number;
}

function pad(n: number): string { return String(n).padStart(2, '0'); }

async function fetchMissionsForRange(token: string, fromISO: string, toISO: string): Promise<{ missions: any[]; freshToken: string }> {
  let currentToken = token;
  const fetchPage = async (p: number, retry = true): Promise<any> => {
    const url = `${TW_BASE}/missions?filter[startdate]=${fromISO}&filter[enddate]=${toISO}&page[size]=200&page[number]=${p}`;
    const r = await fetch(url, {
      headers: { Authorization: `Bearer ${currentToken}`, Accept: 'application/json' },
    });
    if (r.status === 403 && retry) {
      currentToken = await forceRefreshTimewaveToken();
      return fetchPage(p, false);
    }
    if (!r.ok) throw new Error(`Timewave missions ${fromISO}..${toISO} p${p} → ${r.status}`);
    return r.json();
  };

  const first = await fetchPage(1);
  const totalPages = first.last_page || 1;
  let all: any[] = first.data || [];

  if (totalPages > 1) {
    const PAR = 4;
    for (let p = 2; p <= totalPages; p += PAR) {
      const batch: number[] = [];
      for (let i = 0; i < PAR && p + i <= totalPages; i++) batch.push(p + i);
      const results = await Promise.all(batch.map((pn) => fetchPage(pn).catch(() => ({ data: [] }))));
      for (const r of results) all = all.concat(r.data || []);
    }
  }
  return { missions: all, freshToken: currentToken };
}

/**
 * Räknar sjukfrånvaro månad för månad. Hämtar per-månad-fönster så att
 * gruppering per månad är exakt (Timewave list-endpoint saknar datum-fält
 * per mission — vi vet bara vilken månad vi filtrerade på).
 *
 * `employeeNames` = ext-map för att fylla i namn där mission inte har det.
 */
export async function computeSickLeaveByMonth(
  startDate: Date,
  endDate: Date,
  employeeNames: Map<number, string>,
): Promise<SickLeaveByMonth> {
  let token = await getTimewaveToken();

  const monthKeys: string[] = [];
  const monthRanges: Array<{ key: string; from: string; to: string }> = [];
  {
    const cur = new Date(startDate.getFullYear(), startDate.getMonth(), 1);
    while (cur <= endDate) {
      const y = cur.getFullYear();
      const m = cur.getMonth();
      const key = `${y}-${pad(m + 1)}`;
      const mStart = `${y}-${pad(m + 1)}-01`;
      const mEnd = `${y}-${pad(m + 1)}-${pad(new Date(y, m + 1, 0).getDate())}`;
      monthKeys.push(key);
      monthRanges.push({ key, from: mStart, to: mEnd });
      cur.setMonth(cur.getMonth() + 1);
    }
  }

  const perMonth: Record<string, Map<number, SickLeaveEntry>> = {};
  for (const k of monthKeys) perMonth[k] = new Map();
  const totalMap = new Map<number, SickLeaveEntry>();

  let totalMissions = 0;
  let sickMissionsFound = 0;

  for (const { key: mk, from, to } of monthRanges) {
    const { missions, freshToken } = await fetchMissionsForRange(token, from, to);
    token = freshToken;
    totalMissions += missions.length;

    for (const m of missions) {
      const services = m.services || [];
      const isSick = services.some((s: any) => (s.service_id || s.id) === SICK_SERVICE_ID);
      if (!isSick) continue;
      sickMissionsFound++;
      for (const emp of (m.employees || [])) {
        const empId = emp.employee_id || emp.id;
        if (!empId) continue;
        const name =
          employeeNames.get(empId) ||
          [emp.first_name, emp.last_name].filter(Boolean).join(' ').trim() ||
          emp.full_name || emp.name || emp.display_name || emp.username ||
          `Anställd #${empId}`;
        if (name && !name.startsWith('Anställd #')) employeeNames.set(empId, name);

        const monthEntry = perMonth[mk].get(empId);
        if (monthEntry) monthEntry.count++;
        else perMonth[mk].set(empId, { employeeId: empId, name, count: 1 });

        const totalEntry = totalMap.get(empId);
        if (totalEntry) totalEntry.count++;
        else totalMap.set(empId, { employeeId: empId, name, count: 1 });
      }
    }
  }

  const perMonthArr: Record<string, SickLeaveEntry[]> = {};
  for (const k of monthKeys) {
    perMonthArr[k] = Array.from(perMonth[k].values()).sort((a, b) => b.count - a.count);
  }

  return {
    windowStart: `${monthRanges[0]?.from || ''}`,
    windowEnd: `${monthRanges[monthRanges.length - 1]?.to || ''}`,
    months: monthKeys,
    perMonth: perMonthArr,
    total: Array.from(totalMap.values()).sort((a, b) => b.count - a.count),
    totalMissions,
    sickMissionsFound,
  };
}
