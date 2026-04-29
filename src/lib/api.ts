// Thin fetch wrapper that forwards Clerk session cookie automatically (same-origin).
export async function api<T = any>(
  path: string,
  init: RequestInit = {}
): Promise<T> {
  const res = await fetch(path, {
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
