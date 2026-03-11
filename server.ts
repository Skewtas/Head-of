import express from "express";
import { createServer as createViteServer } from "vite";
import cookieParser from "cookie-parser";
import axios from "axios";
import { clerkMiddleware } from "@clerk/express";

const app = express();
const PORT = 3000;

app.use(cookieParser());
app.use(express.json());
app.use(clerkMiddleware());

// In-memory store for tokens (for prototype purposes)
// In a real app, store this securely in a database associated with a user session
const userTokens: Record<string, { accessToken: string, refreshToken?: string, expiresAt: number }> = {};

// Generate a random session ID
const generateSessionId = () => Math.random().toString(36).substring(2, 15);

app.get("/api/auth/url", (req, res) => {
  const clientId = process.env.MICROSOFT_CLIENT_ID;
  if (!clientId) {
    return res.status(500).json({ error: "MICROSOFT_CLIENT_ID is not configured" });
  }

  const redirectUri = `${process.env.APP_URL}/auth/callback`;

  const params = new URLSearchParams({
    client_id: clientId,
    response_type: "code",
    redirect_uri: redirectUri,
    response_mode: "query",
    scope: "offline_access user.read mail.read",
    state: "12345", // In production, generate a secure random state
  });

  const authUrl = `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?${params.toString()}`;
  res.json({ url: authUrl });
});

app.get(["/auth/callback", "/auth/callback/"], async (req, res) => {
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

    const tokenResponse = await axios.post(
      "https://login.microsoftonline.com/common/oauth2/v2.0/token",
      new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        code: code as string,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      }).toString(),
      {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
      }
    );

    const { access_token, refresh_token, expires_in } = tokenResponse.data;

    const sessionId = generateSessionId();
    userTokens[sessionId] = {
      accessToken: access_token,
      refreshToken: refresh_token,
      expiresAt: Date.now() + expires_in * 1000,
    };

    // Set secure cookie
    res.cookie("session_id", sessionId, {
      secure: true,
      sameSite: "none",
      httpOnly: true,
      maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
    });

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
    console.error("Token exchange error:", err.response?.data || err.message);
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
});

app.get("/api/mail/status", (req, res) => {
  const sessionId = req.cookies.session_id;
  if (sessionId && userTokens[sessionId]) {
    res.json({ connected: true });
  } else {
    res.json({ connected: false });
  }
});

app.get("/api/mail/messages", async (req, res) => {
  const sessionId = req.cookies.session_id;
  const tokenData = sessionId ? userTokens[sessionId] : null;

  if (!tokenData) {
    return res.status(401).json({ error: "Not authenticated" });
  }

  const folder = req.query.folder || 'inbox';
  let folderId = 'inbox';
  if (folder === 'sent') folderId = 'sentitems';
  if (folder === 'drafts') folderId = 'drafts';
  if (folder === 'archive') folderId = 'archive';

  try {
    const response = await axios.get(`https://graph.microsoft.com/v1.0/me/mailFolders/${folderId}/messages?$top=50&$select=id,subject,bodyPreview,body,sender,toRecipients,ccRecipients,receivedDateTime,isRead,flag&$orderby=receivedDateTime DESC`, {
      headers: { Authorization: `Bearer ${tokenData.accessToken}` },
    });
    res.json(response.data.value);
  } catch (err: any) {
    if (err.response?.status === 401) {
      delete userTokens[sessionId];
      res.clearCookie("session_id");
      return res.status(401).json({ error: "Token expired" });
    }
    res.status(500).json({ error: "Failed to fetch emails" });
  }
});

app.post("/api/mail/send", async (req, res) => {
  const sessionId = req.cookies.session_id;
  const tokenData = sessionId ? userTokens[sessionId] : null;
  if (!tokenData) return res.status(401).json({ error: "Not authenticated" });

  try {
    await axios.post(
      `https://graph.microsoft.com/v1.0/me/sendMail`,
      { message: req.body.message, saveToSentItems: true },
      { headers: { Authorization: `Bearer ${tokenData.accessToken}`, "Content-Type": "application/json" } }
    );
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: "Failed to send email" });
  }
});

app.post("/api/mail/reply", async (req, res) => {
  const sessionId = req.cookies.session_id;
  const tokenData = sessionId ? userTokens[sessionId] : null;
  if (!tokenData) return res.status(401).json({ error: "Not authenticated" });

  const { messageId, comment, action } = req.body; // action: 'reply', 'replyAll', 'forward'
  const endpoint = action === 'forward' ? 'forward' : action === 'replyAll' ? 'replyAll' : 'reply';

  try {
    await axios.post(
      `https://graph.microsoft.com/v1.0/me/messages/${messageId}/${endpoint}`,
      { comment, ...(action === 'forward' ? { toRecipients: req.body.toRecipients } : {}) },
      { headers: { Authorization: `Bearer ${tokenData.accessToken}`, "Content-Type": "application/json" } }
    );
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: `Failed to ${endpoint}` });
  }
});

app.patch("/api/mail/message/:id", async (req, res) => {
  const sessionId = req.cookies.session_id;
  const tokenData = sessionId ? userTokens[sessionId] : null;
  if (!tokenData) return res.status(401).json({ error: "Not authenticated" });

  try {
    await axios.patch(
      `https://graph.microsoft.com/v1.0/me/messages/${req.params.id}`,
      req.body,
      { headers: { Authorization: `Bearer ${tokenData.accessToken}`, "Content-Type": "application/json" } }
    );
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: "Failed to update message" });
  }
});

app.post("/api/mail/message/:id/move", async (req, res) => {
  const sessionId = req.cookies.session_id;
  const tokenData = sessionId ? userTokens[sessionId] : null;
  if (!tokenData) return res.status(401).json({ error: "Not authenticated" });

  try {
    await axios.post(
      `https://graph.microsoft.com/v1.0/me/messages/${req.params.id}/move`,
      { destinationId: req.body.destinationId }, // e.g., 'archive'
      { headers: { Authorization: `Bearer ${tokenData.accessToken}`, "Content-Type": "application/json" } }
    );
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: "Failed to move message" });
  }
});

app.delete("/api/mail/message/:id", async (req, res) => {
  const sessionId = req.cookies.session_id;
  const tokenData = sessionId ? userTokens[sessionId] : null;
  if (!tokenData) return res.status(401).json({ error: "Not authenticated" });

  try {
    await axios.delete(
      `https://graph.microsoft.com/v1.0/me/messages/${req.params.id}`,
      { headers: { Authorization: `Bearer ${tokenData.accessToken}` } }
    );
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: "Failed to delete message" });
  }
});

let timewaveAccessToken: string | null = null;
let tokenExpiresAt = 0;
let tokenPromise: Promise<string> | null = null;

app.all("/api/timewave/*", async (req, res) => {
  const apiKey = process.env.TIMEWAVE_API_KEY; // Client Secret
  const clientId = process.env.TIMEWAVE_CLIENT_ID || "879";

  if (!apiKey) {
    return res.status(500).json({ error: "TIMEWAVE_API_KEY is not configured" });
  }

  const endpoint = req.params[0];
  const timewaveBaseUrl = "https://api.timewave.se/v3";

  try {
    // 1. Fetch OAuth token if expired or not present
    if (!timewaveAccessToken || Date.now() >= tokenExpiresAt) {
      if (!tokenPromise) {
        tokenPromise = (async () => {
          const tokenBody = new FormData();
          tokenBody.append("client_id", clientId);
          tokenBody.append("client_secret", apiKey);
          tokenBody.append("grant_type", "client_credentials");

          const tokenRes = await fetch(`${timewaveBaseUrl}/oauth/token`, {
            method: "POST",
            body: tokenBody,
          });

          if (!tokenRes.ok) {
            tokenPromise = null;
            throw new Error(`Failed to authenticate with Timewave: ${await tokenRes.text()}`);
          }

          const tokenData = await tokenRes.json();
          timewaveAccessToken = tokenData.access_token;
          tokenExpiresAt = Date.now() + (tokenData.expires_in - 60) * 1000;
          console.log("Successfully fetched new Timewave access token");
          return timewaveAccessToken;
        })();
      }
      await tokenPromise;
    }
    // 2. Make actual request
    const url = new URL(`${timewaveBaseUrl}/${endpoint}`);
    const queryString = req.url.split('?')[1];
    if (queryString) {
      url.search = queryString;
    }

    const fetchConfig: RequestInit = {
      method: req.method,
      headers: {
        "Authorization": `Bearer ${timewaveAccessToken}`,
        "Content-Type": "application/json",
        "Accept": "application/json"
      }
    };

    if (req.method !== 'GET' && req.method !== 'HEAD' && req.body) {
      if (Object.keys(req.body).length > 0) {
        fetchConfig.body = JSON.stringify(req.body);
      }
    }

    const response = await fetch(url.toString(), fetchConfig);
    const textData = await response.text();
    let jsonData;
    try {
      jsonData = JSON.parse(textData);
    } catch {
      jsonData = textData;
    }

    res.status(response.status).json(jsonData);
  } catch (err: any) {
    console.log("Timewave API Fetch Error:", err);
    res.status(500).json({ error: "Failed to fetch from Timewave API using native fetch" });
  }
});

async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
