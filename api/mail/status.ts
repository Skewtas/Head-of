import type { VercelRequest, VercelResponse } from '@vercel/node';
import { userTokens } from '../_lib/tokenStore';
import { parseCookies } from '../_lib/cookies';

export default function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const cookies = parseCookies(req);
  const sessionId = cookies.session_id;

  if (sessionId && userTokens[sessionId]) {
    res.json({ connected: true });
  } else {
    res.json({ connected: false });
  }
}
