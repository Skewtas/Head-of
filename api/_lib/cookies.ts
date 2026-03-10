// Cookie parsing utility for serverless functions
// (avoids needing cookie-parser middleware)

import type { VercelRequest } from '@vercel/node';

export function parseCookies(req: VercelRequest): Record<string, string> {
  const cookieHeader = req.headers.cookie || '';
  const cookies: Record<string, string> = {};
  cookieHeader.split(';').forEach((cookie) => {
    const [name, ...rest] = cookie.trim().split('=');
    if (name) {
      cookies[name] = decodeURIComponent(rest.join('='));
    }
  });
  return cookies;
}

export function setSessionCookie(sessionId: string): string {
  const maxAge = 30 * 24 * 60 * 60; // 30 days
  return `session_id=${sessionId}; Path=/; HttpOnly; Secure; SameSite=None; Max-Age=${maxAge}`;
}

export function clearSessionCookie(): string {
  return `session_id=; Path=/; HttpOnly; Secure; SameSite=None; Max-Age=0`;
}
