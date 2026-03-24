import express from "express";
import { createServer as createViteServer } from "vite";
import cookieParser from "cookie-parser";
import axios from "axios";
import { clerkMiddleware } from "@clerk/express";
import nodemailer from "nodemailer";

const app = express();
const INITIAL_PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

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


const getTimewaveToken = async (): Promise<string> => {
  const apiKey = process.env.TIMEWAVE_API_KEY!;
  const clientId = process.env.TIMEWAVE_CLIENT_ID || "879";
  const timewaveBaseUrl = "https://api.timewave.se/v3";
  
  // If we have a valid token, return it
  if (timewaveAccessToken && Date.now() < tokenExpiresAt) {
    return timewaveAccessToken;
  }
  
  // If a refresh is already in progress, wait for it
  if (tokenPromise) {
    return tokenPromise;
  }
  
  // Start a new refresh
  tokenPromise = (async () => {
    try {
      const tokenBody = new FormData();
      tokenBody.append("client_id", clientId);
      tokenBody.append("client_secret", apiKey);
      tokenBody.append("grant_type", "client_credentials");
      const tokenRes = await fetch(`${timewaveBaseUrl}/oauth/token`, {
        method: "POST",
        body: tokenBody,
      });
      if (!tokenRes.ok) {
        throw new Error(`Timewave auth failed: ${await tokenRes.text()}`);
      }
      const tokenData = await tokenRes.json();
      timewaveAccessToken = tokenData.access_token;
      tokenExpiresAt = Date.now() + (tokenData.expires_in - 60) * 1000;
      console.log("Timewave: got fresh access token");
      return timewaveAccessToken!;
    } finally {
      tokenPromise = null;
    }
  })();
  
  return tokenPromise;
};

const forceRefreshTimewaveToken = async (): Promise<string> => {
  timewaveAccessToken = null;
  tokenExpiresAt = 0;
  tokenPromise = null;
  return getTimewaveToken();
};

// ==================== FORTNOX API INTEGRATION ====================

const FORTNOX_CLIENT_ID = "EojgbHJg0L7C";
const FORTNOX_CLIENT_SECRET = "rV7VR7Klt2MrlwFKxuzf2rYUE0oCRB5F";
const FORTNOX_AUTH_URL = "https://apps.fortnox.se/oauth-v1/auth";
const FORTNOX_TOKEN_URL = "https://apps.fortnox.se/oauth-v1/token";
const FORTNOX_API_BASE = "https://api.fortnox.se/3";

// In-memory Fortnox token store
let fortnoxTokens: {
  accessToken: string | null;
  refreshToken: string | null;
  expiresAt: number;
} = { accessToken: null, refreshToken: null, expiresAt: 0 };

const getFortnoxHeaders = () => ({
  "Authorization": `Bearer ${fortnoxTokens.accessToken}`,
  "Content-Type": "application/json",
  "Accept": "application/json",
});

const refreshFortnoxToken = async (): Promise<string> => {
  if (!fortnoxTokens.refreshToken) {
    throw new Error("No Fortnox refresh token available. Please authenticate first.");
  }
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: fortnoxTokens.refreshToken,
    client_id: FORTNOX_CLIENT_ID,
    client_secret: FORTNOX_CLIENT_SECRET,
  });
  const resp = await fetch(FORTNOX_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  if (!resp.ok) {
    const errText = await resp.text();
    console.error("Fortnox token refresh failed:", errText);
    throw new Error(`Fortnox token refresh failed: ${errText}`);
  }
  const data = await resp.json();
  fortnoxTokens.accessToken = data.access_token;
  fortnoxTokens.refreshToken = data.refresh_token || fortnoxTokens.refreshToken;
  fortnoxTokens.expiresAt = Date.now() + (data.expires_in - 60) * 1000;
  console.log("Fortnox: refreshed access token");
  return fortnoxTokens.accessToken!;
};

const getFortnoxToken = async (): Promise<string> => {
  if (fortnoxTokens.accessToken && Date.now() < fortnoxTokens.expiresAt) {
    return fortnoxTokens.accessToken;
  }
  return refreshFortnoxToken();
};

const fortnoxFetch = async (path: string): Promise<any> => {
  await getFortnoxToken();
  let resp = await fetch(`${FORTNOX_API_BASE}${path}`, { headers: getFortnoxHeaders() });
  if (resp.status === 401) {
    await refreshFortnoxToken();
    resp = await fetch(`${FORTNOX_API_BASE}${path}`, { headers: getFortnoxHeaders() });
  }
  if (!resp.ok) {
    throw new Error(`Fortnox API ${resp.status}: ${await resp.text()}`);
  }
  return resp.json();
};

// Fortnox OAuth: Step 1 - Get auth URL
app.get("/api/fortnox/auth-url", (req, res) => {
  const redirectUri = `http://localhost:3002/api/fortnox-callback`;
  const params = new URLSearchParams({
    client_id: FORTNOX_CLIENT_ID,
    redirect_uri: redirectUri,
    scope: "invoice",
    state: "fortnox_auth",
    access_type: "offline",
    response_type: "code",
  });
  res.json({ url: `${FORTNOX_AUTH_URL}?${params.toString()}` });
});

// Fortnox OAuth: Step 2 - Callback
app.get("/api/fortnox-callback", async (req, res) => {
  const { code, error } = req.query;
  if (error) {
    return res.send(`<html><body><p>Fortnox auth failed: ${error}</p></body></html>`);
  }
  if (!code) {
    return res.status(400).send("No code provided");
  }

  try {
    const redirectUri = `http://localhost:3002/api/fortnox-callback`;
    const body = new URLSearchParams({
      grant_type: "authorization_code",
      code: code as string,
      client_id: FORTNOX_CLIENT_ID,
      client_secret: FORTNOX_CLIENT_SECRET,
      redirect_uri: redirectUri,
    });

    const tokenResp = await fetch(FORTNOX_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
    if (!tokenResp.ok) {
      const errText = await tokenResp.text();
      throw new Error(`Token exchange failed: ${errText}`);
    }
    const tokenData = await tokenResp.json();
    fortnoxTokens = {
      accessToken: tokenData.access_token,
      refreshToken: tokenData.refresh_token,
      expiresAt: Date.now() + (tokenData.expires_in - 60) * 1000,
    };
    console.log("Fortnox: authenticated successfully");

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
});

// Fortnox: Check if authenticated
app.get("/api/fortnox/status", (req, res) => {
  res.json({
    authenticated: !!fortnoxTokens.accessToken,
    expiresAt: fortnoxTokens.expiresAt,
  });
});

// Fortnox: Get overdue invoices
app.get("/api/fortnox/invoices/overdue", async (req, res) => {
  try {
    const data = await fortnoxFetch("/invoices?filter=unpaidoverdue");
    const invoices = (data.Invoices || []).map((inv: any) => ({
      number: inv.DocumentNumber,
      customerName: inv.CustomerName,
      customerNumber: inv.CustomerNumber,
      total: inv.Total,
      balance: inv.Balance,
      dueDate: inv.DueDate,
      invoiceDate: inv.InvoiceDate,
      daysOverdue: Math.max(0, Math.floor((Date.now() - new Date(inv.DueDate).getTime()) / (1000 * 60 * 60 * 24))),
      ocr: inv.OCR,
      booked: inv.Booked,
      cancelled: inv.Cancelled,
      sent: inv.Sent,
    }));
    res.json({ invoices, count: invoices.length });
  } catch (err: any) {
    console.error("Fortnox overdue invoices error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// Fortnox: Get unpaid invoices
app.get("/api/fortnox/invoices/unpaid", async (req, res) => {
  try {
    const data = await fortnoxFetch("/invoices?filter=unpaid");
    const invoices = (data.Invoices || []).map((inv: any) => ({
      number: inv.DocumentNumber,
      customerName: inv.CustomerName,
      total: inv.Total,
      balance: inv.Balance,
      dueDate: inv.DueDate,
      invoiceDate: inv.InvoiceDate,
      sent: inv.Sent,
    }));
    res.json({ invoices, count: invoices.length });
  } catch (err: any) {
    console.error("Fortnox unpaid invoices error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// Fortnox: Get full invoice summary (overdue + unpaid + totals)
app.get("/api/fortnox/summary", async (req, res) => {
  try {
    const [overdueData, unpaidData, allData] = await Promise.all([
      fortnoxFetch("/invoices?filter=unpaidoverdue").catch(() => ({ Invoices: [] })),
      fortnoxFetch("/invoices?filter=unpaid").catch(() => ({ Invoices: [] })),
      fortnoxFetch("/invoices?filter=fullypaid&fromdate=" + new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0]).catch(() => ({ Invoices: [] })),
    ]);

    const overdueInvoices = (overdueData.Invoices || []).map((inv: any) => ({
      number: inv.DocumentNumber,
      customerName: inv.CustomerName,
      total: inv.Total,
      balance: inv.Balance,
      dueDate: inv.DueDate,
      daysOverdue: Math.max(0, Math.floor((Date.now() - new Date(inv.DueDate).getTime()) / (1000 * 60 * 60 * 24))),
    }));

    const unpaidInvoices = (unpaidData.Invoices || []).map((inv: any) => ({
      number: inv.DocumentNumber,
      customerName: inv.CustomerName,
      total: inv.Total,
      balance: inv.Balance,
      dueDate: inv.DueDate,
    }));

    const totalOverdue = overdueInvoices.reduce((s: number, i: any) => s + (i.balance || 0), 0);
    const totalUnpaid = unpaidInvoices.reduce((s: number, i: any) => s + (i.balance || 0), 0);
    const paidThisMonth = (allData.Invoices || []).reduce((s: number, i: any) => s + (i.Total || 0), 0);

    res.json({
      overdueCount: overdueInvoices.length,
      overdueTotal: Math.round(totalOverdue),
      overdueInvoices: overdueInvoices.sort((a: any, b: any) => b.daysOverdue - a.daysOverdue).slice(0, 20),
      unpaidCount: unpaidInvoices.length,
      unpaidTotal: Math.round(totalUnpaid),
      paidThisMonthTotal: Math.round(paidThisMonth),
    });
  } catch (err: any) {
    console.error("Fortnox summary error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// Staff summary: per-employee stats (hours, revenue, absence, occupancy)
app.get("/api/timewave-summary/staff", async (req, res) => {
  try {
    let token = await getTimewaveToken();
    const timewaveBaseUrl = "https://api.timewave.se/v3";

    // Get all employees
    const empResp = await fetch(`${timewaveBaseUrl}/employees?page[size]=100`, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    });
    const empData = await empResp.json();
    const employees = empData.data || [];

    // Get current month missions
    const now = new Date();
    const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
    const monthEnd = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()}`;

    // Absence service IDs
    const absenceServiceIds = new Set([3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 26, 27, 28, 29, 30, 31, 34, 37, 39, 41, 42, 43, 44]);
    const sickServiceId = 3;

    // Per-employee tracking
    const empStats = new Map<number, { hours: number; revenue: number; sickDays: number; absenceDays: number; missions: number }>();
    employees.forEach((e: any) => empStats.set(e.id, { hours: 0, revenue: 0, sickDays: 0, absenceDays: 0, missions: 0 }));

    // Fetch all missions for month
    let page = 1;
    let totalPages = 1;
    while (page <= totalPages) {
      try {
        const url = `${timewaveBaseUrl}/missions?filter[startdate]=${monthStart}&filter[enddate]=${monthEnd}&page[size]=30&page[number]=${page}`;
        const resp = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } });
        if (resp.status === 403) {
          token = await forceRefreshTimewaveToken();
          page = 1;
          continue;
        }
        const data = await resp.json();
        totalPages = data.last_page || 1;

        for (const m of (data.data || [])) {
          const services = m.services || [];
          const serviceIds = services.map((s: any) => s.service_id || s.id);
          const isAbsence = serviceIds.length > 0 && serviceIds.every((id: number) => absenceServiceIds.has(id));
          const isSick = serviceIds.includes(sickServiceId);

          const missionRevenue = services.reduce((sum: number, s: any) => sum + (parseFloat(s.price) || 0), 0);

          for (const emp of (m.employees || [])) {
            const empId = emp.employee_id || emp.id;
            const stat = empStats.get(empId);
            if (!stat) continue;

            stat.missions++;
            if (isAbsence) {
              stat.absenceDays++;
              if (isSick) stat.sickDays++;
            } else {
              // Calculate hours
              if (emp.starttime && emp.endtime && !emp.cancelled) {
                const [sh, sm] = emp.starttime.split(':').map(Number);
                const [eh, em] = emp.endtime.split(':').map(Number);
                stat.hours += Math.max(0, ((eh * 60 + em) - (sh * 60 + sm)) / 60);
              }
              // Split revenue evenly among employees
              const empCount = (m.employees || []).filter((e: any) => !e.cancelled).length;
              stat.revenue += empCount > 0 ? missionRevenue / empCount : 0;
            }
          }
        }
        page++;
      } catch (err) {
        console.error(`Staff summary: error fetching page ${page}:`, err);
        break;
      }
    }

    // Calculate occupancy (assuming 160h work month)
    const workHoursPerMonth = 160;
    const staffList = employees
      .filter((e: any) => !e.deleted)
      .map((e: any) => {
        const stat = empStats.get(e.id) || { hours: 0, revenue: 0, sickDays: 0, absenceDays: 0, missions: 0 };
        return {
          id: e.id,
          name: `${e.first_name || ''} ${e.last_name || ''}`.trim(),
          phone: e.mobile || e.phone || '',
          email: e.email || '',
          status: e.status,
          startDate: e.employee_startdate,
          hours: Math.round(stat.hours * 10) / 10,
          revenue: Math.round(stat.revenue),
          sickDays: stat.sickDays,
          absenceDays: stat.absenceDays,
          missions: stat.missions,
          occupancy: Math.round((stat.hours / workHoursPerMonth) * 100),
        };
      })
      .sort((a: any, b: any) => b.hours - a.hours);

    res.json({
      employees: staffList,
      totalEmployees: staffList.length,
      totalHours: Math.round(staffList.reduce((s: number, e: any) => s + e.hours, 0)),
      avgOccupancy: staffList.length > 0 ? Math.round(staffList.reduce((s: number, e: any) => s + e.occupancy, 0) / staffList.length) : 0,
    });
  } catch (err: any) {
    console.error("Staff summary error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// Dedicated endpoint: fetch ALL mission pages for a date range and return summary
app.get("/api/timewave-summary/missions", async (req, res) => {
  if (!process.env.TIMEWAVE_API_KEY) {
    return res.status(500).json({ error: "TIMEWAVE_API_KEY is not configured" });
  }

  const startDate = req.query.startDate as string;
  const endDate = req.query.endDate as string;
  if (!startDate || !endDate) {
    return res.status(400).json({ error: "startDate and endDate are required" });
  }

  const timewaveBaseUrl = "https://api.timewave.se/v3";

  try {
    let token = await getTimewaveToken();
    let allMissions: any[] = [];
    let page = 1;
    let lastPage = 1;

    // Build employee name lookup (only ~33 employees, single page)
    const employeeNames = new Map<number, string>();
    try {
      const empResp = await fetch(`${timewaveBaseUrl}/employees?page[size]=100`, {
        headers: { "Authorization": `Bearer ${token}`, "Accept": "application/json" }
      });
      if (empResp.ok) {
        const empData = await empResp.json();
        for (const e of (empData.data || [])) {
          const name = `${e.first_name || ''} ${e.last_name || ''}`.trim();
          if (e.id && name) employeeNames.set(e.id, name);
        }
      }
    } catch { /* ignore */ }

    // Fetch all pages
    while (page <= lastPage) {
      const url = `${timewaveBaseUrl}/missions?filter[startdate]=${startDate}&filter[enddate]=${endDate}&page[number]=${page}`;
      let response = await fetch(url, {
        headers: { "Authorization": `Bearer ${token}`, "Accept": "application/json" }
      });

      // Retry on 403
      if (response.status === 403) {
        token = await forceRefreshTimewaveToken();
        response = await fetch(url, {
          headers: { "Authorization": `Bearer ${token}`, "Accept": "application/json" }
        });
      }

      if (!response.ok) {
        throw new Error(`Timewave API error ${response.status}: ${await response.text()}`);
      }

      const data = await response.json();
      lastPage = data.last_page || 1;
      allMissions = allMissions.concat(data.data || []);
      console.log(`Timewave missions: fetched page ${page}/${lastPage} (${data.data?.length || 0} items)`);
      page++;
    }

    // Compute summary
    let totalHours = 0;
    let totalRevenueExVat = 0;

    // Separate tracking for average price calculation (excludes certain services)
    let avgCalcHours = 0;
    let avgCalcRevenue = 0;

    const recurringPrivateClients = new Set<number>();
    const recurringCompanyClients = new Set<number>();
    const billableClientIds = new Set<number>();
    const uniqueWorkorderIds = new Set<number>();

    // Service IDs that are absence/non-billable (not payroll-related work)
    const absenceServiceIds = new Set([3, 7]); // 3=Sjukdom, 7=Ej tillgänglig (timanställd)
    const nonBillableServiceIds = new Set([3, 7, 401]); // Also 401=Kvalitetskontroll

    // Services to exclude from average price calculation:
    // Samarbete Hemstädning (104, 276), Samarbete flyttstädning (108),
    // Follow up cleaning (128), Samarbete storstädning (336), Samarbete fönsterputs (423)
    const excludeFromAvgServiceIds = new Set([104, 108, 128, 276, 336, 423]);
    const followUpServiceId = 128; // Follow up cleaning
    let followUpCount = 0;

    // Track sick leave per employee (service id=3 = Sjukdom)
    const sickLeaveByEmployee = new Map<number, { name: string; count: number }>();

    // Track revenue per client
    const revenueByClient = new Map<number, { name: string; revenue: number; type: string }>();

    // Team mapping: city -> team name
    const cityToTeam: Record<string, string> = {
      'ekerö': 'Team Ekerö',
      'stockholm': 'Team Sthlm City/Solna/Sundbyberg',
      'solna': 'Team Sthlm City/Solna/Sundbyberg',
      'sundbyberg': 'Team Sthlm City/Solna/Sundbyberg',
      'lidingö': 'Team Lidingö',
      'södertälje': 'Team Södertälje',
      'nacka': 'Team Nacka',
      'saltsjöbaden': 'Team Nacka',
      'saltsjö-boo': 'Team Nacka',
      'järfälla': 'Team Järfälla',
      'viksjö': 'Team Järfälla',
      'barkarby': 'Team Järfälla',
      'jakobsberg': 'Team Järfälla',
      // Map surrounding areas to closest team
      'bromma': 'Team Sthlm City/Solna/Sundbyberg',
      'spånga': 'Team Järfälla',
      'hägersten': 'Team Sthlm City/Solna/Sundbyberg',
      'älvsjö': 'Team Sthlm City/Solna/Sundbyberg',
      'enskede': 'Team Sthlm City/Solna/Sundbyberg',
      'farsta': 'Team Nacka',
      'tyresö': 'Team Nacka',
      'huddinge': 'Team Södertälje',
      'tumba': 'Team Södertälje',
      'botkyrka': 'Team Södertälje',
      'haninge': 'Team Södertälje',
      'jordbro': 'Team Södertälje',
      'handen': 'Team Södertälje',
      'täby': 'Team Lidingö',
      'danderyd': 'Team Lidingö',
      'djursholm': 'Team Lidingö',
      'vallentuna': 'Team Lidingö',
      'upplands väsby': 'Team Järfälla',
      'kista': 'Team Järfälla',
      'sollentuna': 'Team Järfälla',
      'märsta': 'Team Järfälla',
    };
    const teamData = new Map<string, { hours: number; revenue: number }>();
    // Initialize all teams
    ['Team Ekerö', 'Team Sthlm City/Solna/Sundbyberg', 'Team Lidingö', 'Team Södertälje', 'Team Nacka', 'Team Järfälla'].forEach(t => {
      teamData.set(t, { hours: 0, revenue: 0 });
    });
    let onlineBookings = 0;

    allMissions.forEach((m: any) => {
      const services = m.services || [];
      // Check if this mission is purely absence (all services are absence types)
      const isAbsenceMission = services.length > 0 && services.every((svc: any) => absenceServiceIds.has(svc.id));

      // Check if this mission is a collaboration/followup (all services are excluded types)
      const isExcludedFromAvg = services.length > 0 && services.every((svc: any) => excludeFromAvgServiceIds.has(svc.id));

      // Check if this mission has zero total revenue (nollade uppdrag)
      let missionRevenue = 0;
      services.forEach((svc: any) => {
        if (!nonBillableServiceIds.has(svc.id)) {
          const qty = Number(svc.quantity || 0);
          const price = Number(svc.price || 0);
          const discount = Number(svc.discount || 0);
          missionRevenue += qty * price * (1 - discount / 100);
        }
      });

      // Only count hours from actual work missions (not absence)
      if (!isAbsenceMission) {
        let missionHours = 0;
        (m.employees || []).forEach((emp: any) => {
          if (emp.starttime && emp.endtime && !emp.cancelled) {
            const [sh, sm] = emp.starttime.split(':').map(Number);
            const [eh, em] = emp.endtime.split(':').map(Number);
            missionHours += Math.max(0, ((eh * 60 + em) - (sh * 60 + sm)) / 60);
          }
        });
        totalHours += missionHours;

        // For avg price: exclude collaboration, followup, and zero-revenue missions
        if (!isExcludedFromAvg && missionRevenue > 0) {
          avgCalcHours += missionHours;
          avgCalcRevenue += missionRevenue;
        }
      }

      // Total revenue from billable services (includes all for total, not avg)
      totalRevenueExVat += missionRevenue;

      // Count follow-up cleaning missions
      if (services.some((svc: any) => svc.id === followUpServiceId)) {
        followUpCount++;
      }

      // Track sick leave per employee
      if (services.some((svc: any) => svc.id === 3)) {
        (m.employees || []).forEach((emp: any) => {
          if (emp.id) {
            const name = employeeNames.get(emp.id) || `${emp.first_name || ''} ${emp.last_name || ''}`.trim() || `Anställd #${emp.id}`;
            const existing = sickLeaveByEmployee.get(emp.id);
            if (existing) {
              existing.count++;
            } else {
              sickLeaveByEmployee.set(emp.id, { name, count: 1 });
            }
          }
        });
      }

      // Count unique recurring clients by type
      if (m.type === 'reccurent' && m.client?.id) {
        if (m.client.type === 1 || (!m.client.companyname && m.client.type !== 2)) {
          recurringPrivateClients.add(m.client.id);
        } else {
          recurringCompanyClients.add(m.client.id);
        }
      }

      // Track all clients that have booked missions (billable clients)
      if (m.client?.id) {
        billableClientIds.add(m.client.id);

        // Track revenue per client
        const clientName = m.client.companyname
          ? m.client.companyname
          : `${m.client.first_name || ''} ${m.client.last_name || ''}`.trim() || `Kund #${m.client.id}`;
        const existing = revenueByClient.get(m.client.id);
        if (existing) {
          existing.revenue += missionRevenue;
        } else {
          revenueByClient.set(m.client.id, {
            name: clientName,
            revenue: missionRevenue,
            type: m.type || 'single'
          });
        }
      }

      // Collect unique workorder IDs
      if (m.workorder?.id) {
        uniqueWorkorderIds.add(m.workorder.id);
      }

      // Map mission to team via client city
      const clientCity = (m.client?.city || '').toLowerCase().trim();
      const teamName = cityToTeam[clientCity] || 'Övrigt';
      if (!isAbsenceMission) {
        let missionHoursForTeam = 0;
        (m.employees || []).forEach((emp: any) => {
          if (emp.starttime && emp.endtime && !emp.cancelled) {
            const [sh2, sm2] = emp.starttime.split(':').map(Number);
            const [eh2, em2] = emp.endtime.split(':').map(Number);
            missionHoursForTeam += Math.max(0, ((eh2 * 60 + em2) - (sh2 * 60 + sm2)) / 60);
          }
        });
        const teamEntry = teamData.get(teamName);
        if (teamEntry) {
          teamEntry.hours += missionHoursForTeam;
          teamEntry.revenue += missionRevenue;
        } else {
          const ovrigtEntry = teamData.get('Övrigt') || { hours: 0, revenue: 0 };
          ovrigtEntry.hours += missionHoursForTeam;
          ovrigtEntry.revenue += missionRevenue;
          teamData.set('Övrigt', ovrigtEntry);
        }
      }

      // Count online bookings (non-recurring = single bookings)
      if (m.type !== 'reccurent' && m.client?.id) {
        onlineBookings++;
      }
    });

    // Calculate average price per hour (excluding collaboration, followup, zeroed missions)
    const avgPricePerHour = avgCalcHours > 0 ? avgCalcRevenue / avgCalcHours : 0;

    // Fetch invoices for the target month (paginate from last page backwards)
    let totalInvoicedNet = 0;
    let invoiceCount = 0;
    try {
      // First, get last page to find where to start
      const firstUrl = `${timewaveBaseUrl}/invoices?page[number]=1`;
      const firstResp = await fetch(firstUrl, {
        headers: { "Authorization": `Bearer ${token}`, "Accept": "application/json" }
      });
      const firstData = await firstResp.json();
      let invPage = firstData.last_page || 1;
      let foundMonth = false;

      while (invPage > 0) {
        const invUrl = `${timewaveBaseUrl}/invoices?page[number]=${invPage}`;
        const invResp = await fetch(invUrl, {
          headers: { "Authorization": `Bearer ${token}`, "Accept": "application/json" }
        });
        const invData = await invResp.json();
        const invoices = invData.data || [];

        let pageHasTargetMonth = false;
        for (const inv of invoices) {
          const invDate = inv.invoice_date || '';
          if (invDate >= startDate && invDate <= endDate && !inv.deleted && !inv.credited) {
            totalInvoicedNet += Number(inv.net_amount || 0);
            invoiceCount++;
            pageHasTargetMonth = true;
            foundMonth = true;
          }
        }

        // If we already found target month invoices but this page has none, stop
        if (foundMonth && !pageHasTargetMonth) break;
        // If invoices on this page are before our target month, stop
        if (invoices.length > 0 && invoices[0].invoice_date < startDate && !pageHasTargetMonth) break;

        invPage--;
        if (invPage <= 0) break;
      }
      console.log(`Timewave invoices: found ${invoiceCount} for ${startDate} to ${endDate}, net total: ${totalInvoicedNet}`);
    } catch (err: any) {
      console.error("Error fetching invoices:", err.message);
    }

    // Fetch workorder details to find newly created ones this month
    let newWorkOrdersThisMonth = 0;
    try {
      const woIds = Array.from(uniqueWorkorderIds);
      console.log(`Timewave: checking ${woIds.length} unique workorders for create_date in ${startDate} to ${endDate}`);
      // Batch fetch workorder details (10 concurrent at a time)
      const batchSize = 10;
      for (let i = 0; i < woIds.length; i += batchSize) {
        const batch = woIds.slice(i, i + batchSize);
        const results = await Promise.all(
          batch.map(async (woId) => {
            try {
              const woResp = await fetch(`${timewaveBaseUrl}/workorders/${woId}`, {
                headers: { "Authorization": `Bearer ${token}`, "Accept": "application/json" }
              });
              if (!woResp.ok) return null;
              const woData = await woResp.json();
              return woData?.data?.create_date || null;
            } catch { return null; }
          })
        );
        for (const createDate of results) {
          if (createDate && createDate >= startDate && createDate <= endDate) {
            newWorkOrdersThisMonth++;
          }
        }
      }
      console.log(`Timewave: found ${newWorkOrdersThisMonth} new workorders created in ${startDate} to ${endDate}`);
    } catch (err: any) {
      console.error("Error fetching workorders:", err.message);
    }

    const responseData: any = {
      totalJobs: allMissions.length,
      totalHours: Math.round(totalHours * 10) / 10,
      totalRevenueExVat: Math.round(totalRevenueExVat),
      totalInvoicedNet: Math.round(totalInvoicedNet),
      avgPricePerHour: Math.round(avgPricePerHour),
      recurringPrivateClients: recurringPrivateClients.size,
      recurringCompanyClients: recurringCompanyClients.size,
      billableClients: billableClientIds.size,
      newWorkOrdersThisMonth,
      followUpCount,
      sickLeaveThisMonth: Array.from(sickLeaveByEmployee.values())
        .sort((a, b) => b.count - a.count)
        .slice(0, 10),
      sickLeave3Months: [] as { name: string; count: number }[],
      topClients: Array.from(revenueByClient.values())
        .filter(c => c.revenue > 0)
        .sort((a, b) => b.revenue - a.revenue)
        .slice(0, 10)
        .map(c => ({ name: c.name, revenue: Math.round(c.revenue) })),
      bottomClients: Array.from(revenueByClient.values())
        .filter(c => c.revenue > 0)
        .sort((a, b) => a.revenue - b.revenue)
        .slice(0, 10)
        .map(c => ({ name: c.name, revenue: Math.round(c.revenue) })),
      newSingleClients: Array.from(revenueByClient.values()).filter(c => c.type !== 'reccurent').length,
      newRecurringClients: Array.from(revenueByClient.values()).filter(c => c.type === 'reccurent').length,
      onlineBookings,
      teamBreakdown: Array.from(teamData.entries()).map(([name, data]) => ({
        name,
        hours: Math.round(data.hours * 10) / 10,
        revenue: Math.round(data.revenue),
      })),
    };

    // Fetch 3-month sick leave data (previous 2 months + current)
    try {
      const now = new Date(startDate);
      const threeMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 2, 1);
      const pad = (n: number) => String(n).padStart(2, '0');
      const threeMonthStart = `${threeMonthsAgo.getFullYear()}-${pad(threeMonthsAgo.getMonth() + 1)}-01`;

      // Only fetch extra months if they differ from current month
      if (threeMonthStart < startDate) {
        const sickLeave3m = new Map<number, { name: string; count: number }>();

        // Copy current month data first
        sickLeaveByEmployee.forEach((v, k) => sickLeave3m.set(k, { ...v }));

        // Fetch previous months
        let page3m = 1;
        let lastPage3m = 1;
        while (page3m <= lastPage3m) {
          const url3m = `${timewaveBaseUrl}/missions?filter[startdate]=${threeMonthStart}&filter[enddate]=${startDate}&page[number]=${page3m}`;
          const resp3m = await fetch(url3m, {
            headers: { "Authorization": `Bearer ${token}`, "Accept": "application/json" }
          });
          if (!resp3m.ok) break;
          const data3m = await resp3m.json();
          lastPage3m = data3m.last_page || 1;

          for (const m of (data3m.data || [])) {
            const svcs = m.services || [];
            if (svcs.some((s: any) => s.id === 3)) {
              for (const emp of (m.employees || [])) {
                if (emp.id) {
                  const name = employeeNames.get(emp.id) || `${emp.first_name || ''} ${emp.last_name || ''}`.trim() || `Anställd #${emp.id}`;
                  const existing = sickLeave3m.get(emp.id);
                  if (existing) {
                    existing.count++;
                  } else {
                    sickLeave3m.set(emp.id, { name, count: 1 });
                  }
                }
              }
            }
          }
          page3m++;
        }
        console.log(`Timewave: found ${sickLeave3m.size} employees with sick leave in 3 months (${threeMonthStart} to ${endDate})`);
        responseData.sickLeave3Months = Array.from(sickLeave3m.values())
          .sort((a, b) => b.count - a.count)
          .slice(0, 10);
      } else {
        responseData.sickLeave3Months = responseData.sickLeaveThisMonth;
      }
    } catch (err: any) {
      console.error("Error fetching 3-month sick leave:", err.message);
    }

    res.json(responseData);
  } catch (err: any) {
    console.error("Timewave summary error:", err.message);
    res.status(500).json({ error: "Failed to compute mission summary" });
  }
});

app.all("/api/timewave/*", async (req, res) => {
  if (!process.env.TIMEWAVE_API_KEY) {
    return res.status(500).json({ error: "TIMEWAVE_API_KEY is not configured" });
  }

  const endpoint = req.params[0];
  const timewaveBaseUrl = "https://api.timewave.se/v3";

  const doFetch = async (token: string) => {
    const url = new URL(`${timewaveBaseUrl}/${endpoint}`);
    const queryString = req.url.split('?')[1];
    if (queryString) {
      url.search = queryString;
    }

    const fetchConfig: RequestInit = {
      method: req.method,
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json",
        "Accept": "application/json"
      }
    };

    if (req.method !== 'GET' && req.method !== 'HEAD' && req.body && Object.keys(req.body).length > 0) {
      fetchConfig.body = JSON.stringify(req.body);
    }

    console.log(`Timewave: ${req.method} ${url.toString()}`);
    return fetch(url.toString(), fetchConfig);
  };

  try {
    let token = await getTimewaveToken();
    let response = await doFetch(token);

    // If 403, force refresh token and retry once
    if (response.status === 403) {
      const body = await response.text();
      console.log(`Timewave 403 on /${endpoint}:`, body);
      token = await forceRefreshTimewaveToken();
      response = await doFetch(token);
    }

    const textData = await response.text();
    let jsonData;
    try {
      jsonData = JSON.parse(textData);
    } catch {
      jsonData = textData;
    }

    res.status(response.status).json(jsonData);
  } catch (err: any) {
    console.log("Timewave API Error:", err.message);
    res.status(500).json({ error: "Failed to fetch from Timewave API" });
  }
});

// --- Newsletter Memory Store & Tracking ---
interface SentNewsletter {
  id: string;
  subject: string;
  introText: string;
  imageData: string | null;
  embedUrl: string | null;
  recipients: string[];
  openedBy: string[];
  clickedBy: string[];
  sentAt: string;
  status: 'sent' | 'partial' | 'failed';
  category: string;
  failedRecipients: string[];
  successCount: number;
}
const newsletters: SentNewsletter[] = [];

// 1x1 transparent GIF base64
const TRACKING_PIXEL = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');

// Create SMTP transporter
const createSmtpTransport = () => {
  const host = process.env.SMTP_HOST || 'smtp.office365.com';
  const port = parseInt(process.env.SMTP_PORT || '587');
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (!user || !pass) return null;
  return nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
  });
};

// Build newsletter HTML email
const buildNewsletterHtml = (opts: {
  introText: string;
  imageData: string | null;
  embedUrl: string | null;
  trackingPixelUrl: string;
}) => {
  const { introText, imageData, embedUrl, trackingPixelUrl } = opts;
  const intro = introText ? `<p style="font-size:16px;line-height:1.6;color:#333;margin:0 0 24px;">${introText.replace(/\n/g, '<br/>')}</p>` : '';
  let content = '';
  if (imageData) {
    content = `<img src="${imageData}" alt="Newsletter" style="width:100%;max-width:600px;height:auto;border-radius:12px;" />`;
  } else if (embedUrl) {
    content = `<a href="${embedUrl}" target="_blank" style="display:inline-block;padding:16px 32px;background:#1a1a2e;color:#fff;border-radius:10px;text-decoration:none;font-weight:bold;font-size:14px;">Visa nyhetsbrevet →</a>`;
  }
  return `<!DOCTYPE html><html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width"/></head>
<body style="margin:0;padding:0;background:#f5f3ef;font-family:'Segoe UI',sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f3ef;padding:32px 0;">
  <tr><td align="center">
    <table width="600" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.06);">
      <tr><td style="padding:40px 32px 0;">
        <h1 style="margin:0 0 8px;font-size:28px;color:#1a1a2e;font-weight:300;">Stodona</h1>
        <div style="height:3px;width:40px;background:#c9a96e;margin-bottom:24px;"></div>
        ${intro}
      </td></tr>
      <tr><td style="padding:0 32px 32px;" align="center">
        ${content}
      </td></tr>
      <tr><td style="padding:24px 32px;background:#faf8f5;border-top:1px solid #eae4d9;text-align:center;">
        <p style="margin:0;font-size:12px;color:#999;">© ${new Date().getFullYear()} Stodona AB</p>
        <p style="margin:4px 0 0;font-size:11px;color:#bbb;">Du får detta mail som kund hos Stodona.</p>
      </td></tr>
    </table>
  </td></tr>
</table>
<img src="${trackingPixelUrl}" width="1" height="1" alt="" style="display:none;" />
</body></html>`;
};

// Tracking pixel
app.get("/api/newsletter/track/:id/:emailBase64", (req, res) => {
  const { id, emailBase64 } = req.params;
  try {
    const email = Buffer.from(emailBase64, 'base64').toString('utf-8');
    const newsletter = newsletters.find(n => n.id === id);
    if (newsletter && newsletter.recipients.includes(email) && !newsletter.openedBy.includes(email)) {
      newsletter.openedBy.push(email);
      console.log(`[TRACKING] Newsletter ${id} opened by ${email}`);
    }
  } catch (err) {}
  res.writeHead(200, { 'Content-Type': 'image/gif', 'Content-Length': TRACKING_PIXEL.length, 'Cache-Control': 'no-store, no-cache, must-revalidate, private' });
  res.end(TRACKING_PIXEL);
});

// Click tracking & redirect
app.get("/api/newsletter/click/:id/:emailBase64", (req, res) => {
  const { id, emailBase64 } = req.params;
  const { url } = req.query;

  if (!url || typeof url !== 'string') {
    return res.status(400).send("Invalid link");
  }

  try {
    const email = Buffer.from(emailBase64, 'base64').toString('utf-8');
    const newsletter = newsletters.find(n => n.id === id);
    if (newsletter) {
      if (!newsletter.clickedBy) newsletter.clickedBy = [];
      if (!newsletter.clickedBy.includes(email)) {
        newsletter.clickedBy.push(email);
        console.log(`[TRACKING] Newsletter ${id} LINK CLICKED by ${email} -> ${url}`);
      }
    }
    res.redirect(url);
  } catch (err) {
    res.redirect(url);
  }
});

// Newsletter history
app.get("/api/newsletter/history", (req, res) => {
  const historyList = newsletters.map(n => ({
    id: n.id, subject: n.subject, recipients: n.recipients, openedBy: n.openedBy,
    clickedBy: n.clickedBy || [],
    sentAt: n.sentAt, status: n.status, category: n.category,
    successCount: n.successCount, failedCount: n.failedRecipients.length,
  })).reverse();
  res.json(historyList);
});

// Import customer emails from Timewave with segmentation
app.get("/api/newsletter/customers", async (req, res) => {
  try {
    let token = await getTimewaveToken();
    const timewaveBaseUrl = "https://api.timewave.se/v3";
    
    // 1. Fetch Clients
    let allClients: any[] = [];
    let page = 1;
    let totalPages = 1;
    while (page <= totalPages) {
      const resp = await fetch(`${timewaveBaseUrl}/clients?page[size]=100&page[number]=${page}`, {
        headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      });
      if (resp.status === 403) {
        token = await forceRefreshTimewaveToken();
        page = 1; continue;
      }
      const data = await resp.json();
      totalPages = data.last_page || 1;
      allClients = allClients.concat(data.data || []);
      page++;
    }

    // 2. Fetch Orders for service segmentation (last 1000 to catch active customers)
    const ordersResp = await fetch(`${timewaveBaseUrl}/orders?page[size]=1000`, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" }
    });
    const ordersData = await ordersResp.json();
    const clientServices: Record<string, Set<string>> = {};
    
    for (const o of ordersData.data || []) {
      const cid = String(o.client_id);
      if (!clientServices[cid]) clientServices[cid] = new Set();
      for (const svc of (o.services || [])) {
        const sname = (svc.name || '').toLowerCase();
        if (sname.includes('fönster')) clientServices[cid].add('Fönsterputs');
        else if (sname.includes('stor') || sname.includes('flytt') || sname.includes('visning') || sname.includes('enstaka') || sname.includes('bygg')) clientServices[cid].add('Enstaka Städning');
        else if (sname.includes('vecka') || sname.includes('månad') || sname.includes('återkommande') || sname.includes('kontor')) clientServices[cid].add('Återkommande Städning');
        else clientServices[cid].add('Övriga Tjänster');
      }
    }

    // City area mapping for segments
    const areaMap: Record<string, string[]> = {
      'Ekerö/Mälaröarna': ['ekerö', 'skå', 'färentuna', 'munsö', 'stenhamra'],
      'Lidingö': ['lidingö'],
      'Söderort': ['johanneshov', 'hägersten', 'älvsjö', 'bandhagen', 'enskede', 'gullmarsplan', 'farsta', 'skarpnäck', 'skärholmen', 'bredäng', 'liljeholmen', 'aspudden', 'midsommarkransen', 'telefonplan', 'fruängen'],
      'Södertörn/Nynäs': ['södertälje', 'tyresö', 'haninge', 'handen', 'tumba', 'huddinge', 'botkyrka', 'salem'],
      'Nacka/Värmdö': ['nacka', 'saltsjöbaden', 'saltsjö-duvnäs', 'boo', 'orminge', 'värmdö', 'gustavsberg'],
      'Västerort/Järfälla': ['järfälla', 'jakobsberg', 'barkarby', 'viksjö', 'bromma', 'hässelby', 'spånga', 'vällingby', 'blackeberg', 'kista', 'rinkeby', 'tensta', 'sundbyberg'],
      'Norrort/Solna': ['solna', 'sollentuna', 'täby', 'danderyd', 'stocksund', 'djursholm', 'vallentuna', 'åkersberga', 'upplands väsby', 'sigtuna', 'märsta'],
    };

    // Sub-segmentation for Stockholm city based on postal code prefixes (111-120)
    const postalMap: Record<string, string> = {
      '111': 'Norrmalm/City',
      '112': 'Kungsholmen/Essingeöarna',
      '113': 'Vasastan/Torsplan',
      '114': 'Östermalm',
      '115': 'Gärdet/Djurgården',
      '116': 'Södermalm (Katarina/Sofia)',
      '117': 'Södermalm (Maria/Högalid)',
      '118': 'Södermalm',
      '120': 'Hammarby Sjöstad',
    };

    const customers = allClients
      .filter((c: any) => c.email && c.email.includes('@') && !c.deleted)
      .map((c: any) => {
        // Extract city from addresses array
        const addresses = c.addresses || [];
        const activeAddr = addresses.find((a: any) => !a.deleted && (a.city || a.postal_code));
        const reqCity = (activeAddr?.city || '').trim();
        const normalizedCity = reqCity.toLowerCase();
        const postalCode = (activeAddr?.postal_code || '').replace(/\s+/g, '').trim();

        // Determine area segment
        let area = 'Övriga';
        
        let isStockholmPostal = false;
        if (postalCode.length >= 3) {
           const prefix = postalCode.substring(0, 3);
           if (postalMap[prefix] && (normalizedCity === 'stockholm' || normalizedCity === '')) {
               area = postalMap[prefix];
               isStockholmPostal = true;
           }
        }

        if (!isStockholmPostal && normalizedCity) {
           const maybeStadsdel = Object.values(postalMap).find(val => normalizedCity.includes(val.toLowerCase()));
           if (maybeStadsdel) {
             area = maybeStadsdel;
           } else {
             for (const [areaName, cities] of Object.entries(areaMap)) {
               if (cities.some(cityMatch => normalizedCity.includes(cityMatch))) {
                 area = areaName;
                 break;
               }
             }
           }
           if (area === 'Övriga' && normalizedCity === 'stockholm') area = 'Stockholm (Övriga)';
        }

        const clientType = c.clienttype?.name || (c.type === 'company' ? 'Företag' : 'Privat');
        const sTypes = clientServices[String(c.id)] ? Array.from(clientServices[String(c.id)]) : ['Okänd Tjänst'];

        return {
          id: c.id,
          name: (c.first_name && c.last_name) ? `${c.first_name} ${c.last_name}` : c.company_name || c.first_name || '',
          email: c.email.toLowerCase().trim(),
          city: reqCity,
          area,
          clientType,
          postalCode,
          serviceTypes: sTypes
        };
      });

    // Deduplicate by email
    const uniqueMap = new Map<string, any>();
    customers.forEach((c: any) => { 
      if (!uniqueMap.has(c.email)) {
        uniqueMap.set(c.email, c); 
      } else {
        // Merge services for duplicates
        const existing = uniqueMap.get(c.email);
        existing.serviceTypes = Array.from(new Set([...existing.serviceTypes, ...c.serviceTypes]));
      }
    });
    const uniqueCustomers = Array.from(uniqueMap.values());

    // Build segments summary
    const areaCounts: Record<string, number> = {};
    const typeCounts: Record<string, number> = {};
    const serviceCounts: Record<string, number> = {};
    
    // Check for internal team members
    const internalKeywords = ['emma selenius', 'mikaela wigert', 'rani shakir', 'annika wigert', '@stodona.se'];
    let internalCount = 0;

    uniqueCustomers.forEach((c: any) => {
      areaCounts[c.area] = (areaCounts[c.area] || 0) + 1;
      typeCounts[c.clientType] = (typeCounts[c.clientType] || 0) + 1;
      c.serviceTypes.forEach((s: string) => serviceCounts[s] = (serviceCounts[s] || 0) + 1);
      
      const isInternal = internalKeywords.some(kw => c.name.toLowerCase().includes(kw) || c.email.toLowerCase().includes(kw));
      if (isInternal) {
        c.clientType = 'Internt Team (Test)';
        internalCount++;
      }
    });
    
    // Add internal team to type counts explicitly if found
    if (internalCount > 0) {
      typeCounts['Internt Team (Test)'] = internalCount;
    }

    res.json({
      customers: uniqueCustomers,
      total: uniqueCustomers.length,
      segments: {
        areas: Object.entries(areaCounts).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count),
        clientTypes: Object.entries(typeCounts).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count),
        serviceTypes: Object.entries(serviceCounts).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count),
      }
    });
  } catch (err: any) {
    console.error("Newsletter customers error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// Newsletter Send with real SMTP
app.post("/api/newsletter/send", async (req, res) => {
  const { subject, introText, imageData, embedUrl, htmlContent, recipients, category } = req.body;
  if (!subject || !recipients || recipients.length === 0) {
    return res.status(400).json({ error: "Subject and at least one recipient are required." });
  }
  if (!imageData && !embedUrl && !htmlContent) {
    return res.status(400).json({ error: "Nyhetsbrevet behöver innehåll." });
  }

  const newsletterId = Date.now().toString();
  const baseUrl = process.env.APP_URL || `http://localhost:${process.env.PORT || 3002}`;
  const transporter = createSmtpTransport();
  const fromAddress = process.env.SMTP_FROM || process.env.SMTP_USER || 'info@stodona.se';

  let successCount = 0;
  const failedRecipients: string[] = [];

  console.log(`--- NEWSLETTER SEND: ${subject} ---`);
  console.log(`Recipients: ${recipients.length}, Category: ${category || 'none'}`);

  for (const email of recipients) {
    const b64 = Buffer.from(email).toString('base64');
    const trackingPixelUrl = `${baseUrl}/api/newsletter/track/${newsletterId}/${b64}`;

    // Build HTML: use htmlContent from block editor, or fallback to old method
    let html: string;
    if (htmlContent) {
      // Setup HTML with zero-padding container for Edge-to-Edge Canva blocks
      let processedContent = htmlContent;

      // Wrap all links with click tracking
      processedContent = processedContent.replace(/<a([^>]+)href="([^"]+)"([^>]*)>/gi, (match: string, before: string, linkUrl: string, after: string) => {
        if (linkUrl.startsWith('mailto:') || linkUrl.startsWith('tel:')) return match;
        const encodedLink = encodeURIComponent(linkUrl);
        const trackingClickUrl = `${baseUrl}/api/newsletter/click/${newsletterId}/${b64}?url=${encodedLink}`;
        return `<a${before}href="${trackingClickUrl}"${after}>`;
      });

      html = `<!DOCTYPE html><html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width"/></head>
<body style="margin:0;padding:0;background:#f5f3ef;font-family:'Segoe UI',sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f3ef;padding:32px 0;">
  <tr><td align="center">
    <table width="600" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.06);">
      <tr><td style="padding:40px 32px 0;">
        <h1 style="margin:0 0 8px;font-size:28px;color:#1a1a2e;font-weight:300;">Stodona</h1>
        <div style="height:3px;width:40px;background:#c9a96e;margin-bottom:24px;"></div>
      </td></tr>
      <tr><td style="padding:0; padding-bottom:32px;">${processedContent}</td></tr>
      <tr><td style="padding:24px 32px;background:#faf8f5;border-top:1px solid #eae4d9;text-align:center;">
        <p style="margin:0;font-size:12px;color:#999;">© ${new Date().getFullYear()} Stodona AB</p>
        <p style="margin:4px 0 0;font-size:11px;color:#bbb;">Du får detta mail som kund hos Stodona.</p>
      </td></tr>
    </table>
  </td></tr>
</table>
<img src="${trackingPixelUrl}" width="1" height="1" alt="" style="display:none;" />
</body></html>`;
    } else {
      html = buildNewsletterHtml({ introText: introText || '', imageData, embedUrl, trackingPixelUrl });
    }

    if (transporter) {
      try {
        await transporter.sendMail({
          from: `"Stodona" <${fromAddress}>`,
          to: email,
          subject,
          html,
        });
        successCount++;
        console.log(`  ✓ Sent to ${email}`);
      } catch (err: any) {
        console.error(`  ✗ Failed for ${email}:`, err.message);
        failedRecipients.push(email);
      }
    } else {
      // No SMTP — log only
      successCount++;
      console.log(`  [DRY] ${email} (no SMTP configured)`);
    }
  }

  const status = failedRecipients.length === 0 ? 'sent' : (successCount > 0 ? 'partial' : 'failed');

  newsletters.push({
    id: newsletterId,
    subject,
    introText: introText || '',
    imageData: imageData || null,
    embedUrl: embedUrl || null,
    recipients,
    openedBy: [],
    clickedBy: [],
    sentAt: new Date().toLocaleString('sv-SE'),
    status,
    category: category || 'Allmänt',
    failedRecipients,
    successCount,
  });

  const msg = transporter
    ? `Skickat till ${successCount}/${recipients.length} mottagare${failedRecipients.length > 0 ? ` (${failedRecipients.length} misslyckades)` : ''}.`
    : `Nyhetsbrev sparat (SMTP ej konfigurerat — inga mail skickades). Ange SMTP_HOST, SMTP_USER, SMTP_PASS i .env.`;

  res.json({ success: true, message: msg, sent: successCount, failed: failedRecipients.length });
});

// Newsletter Resend to Unopened
app.post("/api/newsletter/:id/resend", async (req, res) => {
  const { id } = req.params;
  const { newSubject } = req.body;
  const original = newsletters.find(n => n.id === id);
  if (!original) return res.status(404).json({ error: "Newsletter not found." });
  const unopenedRecipients = original.recipients.filter(r => !original.openedBy.includes(r));
  if (unopenedRecipients.length === 0) {
    return res.status(400).json({ error: "Alla mottagare har redan öppnat nyhetsbrevet." });
  }

  const newId = Date.now().toString();
  const subject = newSubject || `Påminnelse: ${original.subject}`;
  const baseUrl = process.env.APP_URL || `http://localhost:${process.env.PORT || 3002}`;
  const transporter = createSmtpTransport();
  const fromAddress = process.env.SMTP_FROM || process.env.SMTP_USER || 'info@stodona.se';

  let successCount = 0;
  const failedRecipients: string[] = [];

  for (const email of unopenedRecipients) {
    const b64 = Buffer.from(email).toString('base64');
    const trackingPixelUrl = `${baseUrl}/api/newsletter/track/${newId}/${b64}`;
    const html = buildNewsletterHtml({ introText: original.introText, imageData: original.imageData, embedUrl: original.embedUrl, trackingPixelUrl });

    if (transporter) {
      try {
        await transporter.sendMail({ from: `"Stodona" <${fromAddress}>`, to: email, subject, html });
        successCount++;
      } catch (err: any) {
        failedRecipients.push(email);
      }
    } else {
      successCount++;
    }
  }

  newsletters.push({
    id: newId, subject, introText: original.introText, imageData: original.imageData,
    embedUrl: original.embedUrl, recipients: unopenedRecipients, openedBy: [], clickedBy: [],
    sentAt: new Date().toLocaleString('sv-SE'),
    status: failedRecipients.length === 0 ? 'sent' : 'partial',
    category: original.category, failedRecipients, successCount,
  });

  res.json({ success: true, message: `Påminnelse skickad till ${successCount}/${unopenedRecipients.length} mottagare.` });
});

async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    // Use vite middleware for everything else
    app.use(vite.middlewares);

    // Add SPA fallback for React Router
    app.use('*', async (req, res, next) => {
      try {
        const url = req.originalUrl;
        let template = await require('fs').promises.readFile(
          require('path').resolve(__dirname, 'index.html'),
          'utf-8'
        );
        template = await vite.transformIndexHtml(url, template);
        res.status(200).set({ 'Content-Type': 'text/html' }).end(template);
      } catch (e) {
        vite.ssrFixStacktrace(e as Error);
        next(e);
      }
    });
  } else {
    // Production setup (assuming dist/ exits)
    app.use(express.static('dist/client'));
    app.use('*', (req, res) => {
      res.sendFile(require('path').resolve(__dirname, 'dist/client/index.html'));
    });
  }

  const listen = (port: number) => {
    const server = app.listen(port, "0.0.0.0", () => {
      console.log(`Server running on http://localhost:${port}`);
    });

    server.on('error', (err: any) => {
      if (err.code === 'EADDRINUSE') {
        console.log(`Port ${port} is in use, trying ${port + 1}...`);
        listen(port + 1);
      } else {
        console.error('Server error:', err);
      }
    });
  };

  listen(INITIAL_PORT);
}

startServer();
