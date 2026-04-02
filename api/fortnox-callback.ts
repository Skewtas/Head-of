import type { VercelRequest, VercelResponse } from '@vercel/node';
import { saveFortnoxTokens, FortnoxTokens } from './_lib/fortnoxAuth.js';

const FORTNOX_CLIENT_ID = "EojgbHJg0L7C";
const FORTNOX_CLIENT_SECRET = "PqB4oT2hYj";
const FORTNOX_TOKEN_URL = "https://apps.fortnox.se/oauth-v1/token";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const { code, error } = req.query;

  if (error) {
    return res.send(`<html><body><p>Fortnox auth failed: ${error}</p></body></html>`);
  }
  if (!code) {
    return res.status(400).send("No code provided");
  }

  try {
    const protocol = process.env.VERCEL_ENV === 'development' || !process.env.VERCEL ? 'http' : 'https';
    const host = req.headers.host || 'localhost:3002';
    const redirectUri = `${protocol}://${host}/api/fortnox-callback`;

    const body = new URLSearchParams({
      grant_type: "authorization_code",
      code: code as string,
      redirect_uri: redirectUri,
    });

    const authHeader = Buffer.from(`${FORTNOX_CLIENT_ID}:${FORTNOX_CLIENT_SECRET}`).toString('base64');

    const tokenResp = await fetch(FORTNOX_TOKEN_URL, {
      method: "POST",
      headers: { 
        "Content-Type": "application/x-www-form-urlencoded",
        "Authorization": `Basic ${authHeader}`
      },
      body: body.toString(),
    });

    if (!tokenResp.ok) {
      const errText = await tokenResp.text();
      console.error("Token Exchange Error:", errText);
      throw new Error(`Token exchange failed: ${errText}`);
    }

    const tokenData = await tokenResp.json();
    const tokens: FortnoxTokens = {
      accessToken: tokenData.access_token,
      refreshToken: tokenData.refresh_token,
      expiresAt: Date.now() + (tokenData.expires_in - 60) * 1000,
    };

    await saveFortnoxTokens(tokens);
    console.log("Fortnox: authenticated successfully and stored in DB");

    res.send(`
      <html><body>
        <script>
          if (window.opener) {
            window.opener.postMessage({ type: 'FORTNOX_AUTH_SUCCESS' }, '*');
            window.close();
          } else {
            window.location.href = '/';
          }
        </script>
        <p>Fortnox-autentisering lyckades! Du kan stänga detta fönster.</p>
      </body></html>
    `);
  } catch (err: any) {
    console.error("Fortnox token exchange error:", err.message);
    res.status(500).send(`<html><body><p>Fortnox auth failed: ${err.message}</p></body></html>`);
  }
}
