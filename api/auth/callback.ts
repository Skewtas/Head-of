import type { VercelRequest, VercelResponse } from '@vercel/node';
import { userTokens, generateSessionId } from '../_lib/tokenStore.js';
import { setSessionCookie } from '../_lib/cookies.js';
import { saveGraphRefreshToken } from '../_lib/graphTokenStore.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const { code, error } = req.query;

  if (error) {
    return res.send(`
      <html><body>
        <script>
          if (window.opener) {
            window.opener.postMessage({ type: 'OAUTH_AUTH_ERROR', error: '${error}' }, '*');
            window.close();
          }
        </script>
        <p>Authentication failed: ${error}</p>
      </body></html>
    `);
  }

  if (!code) {
    return res.status(400).send("No code provided");
  }

  try {
    const clientId = process.env.MICROSOFT_CLIENT_ID;
    const clientSecret = process.env.MICROSOFT_CLIENT_SECRET;
    const redirectUri = `${process.env.APP_URL}/auth/callback`;

    if (!clientId || !clientSecret) {
      throw new Error("Missing Microsoft OAuth credentials");
    }

    const tokenResponse = await fetch(
      "https://login.microsoftonline.com/common/oauth2/v2.0/token",
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: clientId,
          client_secret: clientSecret,
          code: code as string,
          redirect_uri: redirectUri,
          grant_type: "authorization_code",
        }).toString(),
      }
    );

    if (!tokenResponse.ok) {
      throw new Error(`Token exchange failed: ${await tokenResponse.text()}`);
    }

    const tokenData = await tokenResponse.json();
    const { access_token, refresh_token, expires_in } = tokenData;

    const sessionId = generateSessionId();
    userTokens[sessionId] = {
      accessToken: access_token,
      refreshToken: refresh_token,
      expiresAt: Date.now() + expires_in * 1000,
    };

    // Persistera refresh_token i DB så cronjobb (obesvarade-ärenden-mail
    // etc.) kan använda den utan att någon behöver vara inloggad.
    if (refresh_token) {
      try {
        // Hämta vem det är för trevlig loggning
        let userEmail: string | undefined;
        try {
          const meResp = await fetch('https://graph.microsoft.com/v1.0/me?$select=mail,userPrincipalName', {
            headers: { Authorization: `Bearer ${access_token}` },
          });
          if (meResp.ok) {
            const me = await meResp.json();
            userEmail = me.mail || me.userPrincipalName;
          }
        } catch { /* ignore */ }
        await saveGraphRefreshToken(refresh_token, userEmail);
      } catch (e: any) {
        console.error('[auth/callback] Kunde inte spara graph refresh_token:', e?.message);
        // Sväljs — sessionen fungerar fortfarande
      }
    }

    res.setHeader('Set-Cookie', setSessionCookie(sessionId));

    res.send(`
      <html>
        <body>
          <script>
            if (window.opener) {
              window.opener.postMessage({ type: 'OAUTH_AUTH_SUCCESS' }, '*');
              window.close();
            } else {
              window.location.href = '/';
            }
          </script>
          <p>Authentication successful. This window should close automatically.</p>
        </body>
      </html>
    `);
  } catch (err: any) {
    console.error("Token exchange error:", err.message);
    res.send(`
      <html><body>
        <script>
          if (window.opener) {
            window.opener.postMessage({ type: 'OAUTH_AUTH_ERROR', error: 'Token exchange failed' }, '*');
            window.close();
          }
        </script>
        <p>Authentication failed during token exchange.</p>
      </body></html>
    `);
  }
}
