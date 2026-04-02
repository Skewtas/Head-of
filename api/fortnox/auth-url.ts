import type { VercelRequest, VercelResponse } from '@vercel/node';

const FORTNOX_CLIENT_ID = "EojgbHJg0L7C";
const FORTNOX_AUTH_URL = "https://apps.fortnox.se/oauth-v1/auth";

export default function handler(req: VercelRequest, res: VercelResponse) {
  // Use HTTPS for production callbacks, HTTP for local dev
  const protocol = process.env.VERCEL_ENV === 'development' || !process.env.VERCEL ? 'http' : 'https';
  const host = req.headers.host || 'localhost:3002';
  const redirectUri = `${protocol}://${host}/api/fortnox-callback`;

  const params = new URLSearchParams({
    client_id: FORTNOX_CLIENT_ID,
    redirect_uri: redirectUri,
    scope: "invoice",
    state: "fortnox_auth",
    access_type: "offline",
    response_type: "code",
  });

  res.json({ url: `${FORTNOX_AUTH_URL}?${params.toString()}` });
}
