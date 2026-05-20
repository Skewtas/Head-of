// Thin fetch wrapper that forwards Clerk session cookie automatically (same-origin).
//
// All HeadOf 2.0 paths are rewritten to "/api/hf/..." so they hit the single
// serverless catch-all on Vercel without shadowing the existing newsletter,
// mail, timewave-proxy, etc. endpoints. Local dev still routes the bare paths
// because server.ts mounts the same routers at /api/clients etc.

const HEADOF_PREFIXES = [
  '/api/clients',
  '/api/employees',
  '/api/teams',
  '/api/services',
  '/api/agreements',
  '/api/missions',
  '/api/time',
  '/api/invoices',
  '/api/payroll',
  '/api/tickets',
  '/api/jobs',
  '/api/import',
  '/api/ops',
];

function rewriteHeadofPath(p: string): string {
  // Skip if already prefixed.
  if (p.startsWith('/api/hf/') || p === '/api/hf') return p;
  for (const prefix of HEADOF_PREFIXES) {
    if (p === prefix || p.startsWith(prefix + '/') || p.startsWith(prefix + '?')) {
      return '/api/hf' + p.slice(4); // "/api/foo" -> "/api/hf/foo"
    }
  }
  return p;
}

export async function api<T = any>(
  path: string,
  init: RequestInit = {}
): Promise<T> {
  const finalPath = rewriteHeadofPath(path);
  const res = await fetch(finalPath, {
    ...init,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  });
  const text = await res.text();
  const data = text ? safeJson(text) : null;
  if (!res.ok) {
    const err: any = new Error(
      (data && (data.error || data.message)) ||
        `${res.status} ${res.statusText}`
    );
    err.status = res.status;
    err.body = data;
    throw err;
  }
  return data as T;
}

function safeJson(s: string) {
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}
