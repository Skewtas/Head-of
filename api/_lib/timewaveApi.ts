import { getTimewaveToken, forceRefreshTimewaveToken } from './timewaveAuth.js';

const BASE = 'https://api.timewave.se/v3';

async function twFetch(path: string, retry = true): Promise<any> {
  const ac = new AbortController();
  const timeout = setTimeout(() => ac.abort(), 30_000);
  try {
    let token = await getTimewaveToken();
    let res = await fetch(`${BASE}${path}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      signal: ac.signal,
    });
    if (res.status === 403 && retry) {
      token = await forceRefreshTimewaveToken();
      res = await fetch(`${BASE}${path}`, {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
        signal: ac.signal,
      });
    }
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Timewave ${path} → ${res.status} ${body}`);
    }
    return res.json();
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Fetch all pages of a paginated Timewave resource.
 * Most v3 endpoints use ?page[size]= & ?page[number]=, with `last_page` in response.
 */
export async function twFetchAll(path: string, pageSize = 100): Promise<any[]> {
  const sep = path.includes('?') ? '&' : '?';
  const first = await twFetch(`${path}${sep}page[size]=${pageSize}&page[number]=1`);
  const totalPages = first.last_page || 1;
  let rows: any[] = first.data || [];
  if (totalPages <= 1) return rows;
  const parallel: Promise<any>[] = [];
  for (let p = 2; p <= totalPages; p++) {
    parallel.push(twFetch(`${path}${sep}page[size]=${pageSize}&page[number]=${p}`));
  }
  const results = await Promise.all(parallel);
  for (const r of results) rows = rows.concat(r.data || []);
  return rows;
}

// Convenience wrappers
export const tw = {
  clients: () => twFetchAll('/clients'),
  clientAddresses: () => twFetchAll('/clientaddresses'),
  clientTypes: () => twFetchAll('/clienttypes'),
  employees: () => twFetchAll('/employees'),
  services: () => twFetchAll('/services'),
  workareas: () => twFetchAll('/workareas'),
  workareaGroups: () => twFetchAll('/workareagroups'),
  workorders: () => twFetchAll('/workorders'),
  workorderlines: () => twFetchAll('/workorderlines'),
  issues: () => twFetchAll('/issues'),
  missions: (fromDate: string, toDate: string) =>
    twFetchAll(`/missions?filter[startdate]=${fromDate}&filter[enddate]=${toDate}`),
  raw: twFetch,
};
