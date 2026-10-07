import type { VercelRequest, VercelResponse } from '@vercel/node';

// Fortnox OAuth-uppgifter läses från miljövariabler (aldrig hårdkodade)
const requireFortnoxEnv = (name: 'FORTNOX_CLIENT_ID' | 'FORTNOX_CLIENT_SECRET'): string => {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Miljövariabeln ${name} saknas. Lägg till den i .env lokalt och i Vercel.`);
  }
  return value;
};
const FORTNOX_AUTH_URL = "https://apps.fortnox.se/oauth-v1/auth";

export default function handler(req: VercelRequest, res: VercelResponse) {
  // Use HTTPS for production callbacks, HTTP for local dev
  const protocol = process.env.VERCEL_ENV === 'development' || !process.env.VERCEL ? 'http' : 'https';
  const host = req.headers.host || 'localhost:3002';
  const redirectUri = `${protocol}://${host}/api/fortnox-callback`;

  let clientId: string;
  try {
    clientId = requireFortnoxEnv('FORTNOX_CLIENT_ID');
  } catch (err: any) {
    console.error(err.message);
    return res.status(500).json({ error: err.message });
  }

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: "invoice",
    state: "fortnox_auth",
    access_type: "offline",
    response_type: "code",
  });

  res.json({ url: `${FORTNOX_AUTH_URL}?${params.toString()}` });
}
