import * as dotenv from "dotenv";
import * as path from "path";

// Load .env first, then .env.local overrides
dotenv.config({ path: path.resolve(process.cwd(), '.env') });
dotenv.config({ path: path.resolve(process.cwd(), '.env.local'), override: true });

import express from "express";
import { createServer as createViteServer } from "vite";
import cookieParser from "cookie-parser";
import axios from "axios";
import { clerkMiddleware } from "@clerk/express";
import nodemailer from "nodemailer";
import clientsRouter from "./api/routes/clients.js";
import employeesRouter from "./api/routes/employees.js";
import teamsRouter from "./api/routes/teams.js";
import servicesRouter from "./api/routes/services.js";
import agreementsRouter from "./api/routes/agreements.js";
import missionsRouter from "./api/routes/missions.js";
import timeEntriesRouter from "./api/routes/timeEntries.js";
import invoicesRouter from "./api/routes/invoices.js";
import payrollRouter from "./api/routes/payroll.js";
import ticketsRouter from "./api/routes/tickets.js";
import notesRouter from "./api/routes/notes.js";
import jobsRouter from "./api/routes/jobs.js";
import importRouter from "./api/routes/import.js";
import { errorMiddleware } from "./api/_lib/errors.js";

const app = express();
const INITIAL_PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

app.use(cookieParser());
app.use(express.json({ limit: '10mb' }));
app.use(clerkMiddleware());

// HeadOf 2.0 API routes
app.use("/api/clients", clientsRouter);
app.use("/api/employees", employeesRouter);
app.use("/api/teams", teamsRouter);
app.use("/api/services", servicesRouter);
app.use("/api/agreements", agreementsRouter);
app.use("/api/missions", missionsRouter);
app.use("/api/time", timeEntriesRouter);
app.use("/api/invoices", invoicesRouter);
app.use("/api/payroll", payrollRouter);
app.use("/api/tickets", ticketsRouter);
app.use("/api/notes", notesRouter);
app.use("/api/jobs", jobsRouter);
app.use("/api/import", importRouter);

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

// --- IN-MEMORY CACHE ---
const apiCache = new Map<string, { expiresAt: number, data: any }>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes cache

function getCachedData(key: string) {
  const cached = apiCache.get(key);
  if (cached && Date.now() < cached.expiresAt) return cached.data;
  return null;
}

function setCachedData(key: string, data: any) {
  apiCache.set(key, { expiresAt: Date.now() + CACHE_TTL_MS, data });
}
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
      const tokenBody = new URLSearchParams();
      tokenBody.append("client_id", clientId);
      tokenBody.append("client_secret", apiKey);
      tokenBody.append("grant_type", "client_credentials");
      const tokenRes = await fetch(`${timewaveBaseUrl}/oauth/token`, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: tokenBody.toString(),
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
  const cacheKey = "staff_summary";
  const cached = getCachedData(cacheKey);
  if (cached) return res.json(cached);

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

    const result = {
      employees: staffList,
      totalEmployees: staffList.length,
      totalHours: Math.round(staffList.reduce((s: number, e: any) => s + e.hours, 0)),
      avgOccupancy: staffList.length > 0 ? Math.round(staffList.reduce((s: number, e: any) => s + e.occupancy, 0) / staffList.length) : 0,
    };
    
    setCachedData(cacheKey, result);
    res.json(result);
  } catch (err: any) {
    console.error("Staff summary error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// Dedicated endpoint: fetch ALL mission pages for a date range and return summary
app.get("/api/timewave-summary/missions", async (req, res) => {
  const startDate = req.query.startDate as string;
  const endDate = req.query.endDate as string;
  
  if (!startDate || !endDate) {
    return res.status(400).json({ error: "startDate and endDate are required" });
  }

  const cacheKey = "missions_summary_" + startDate + "_" + endDate;
  const cached = getCachedData(cacheKey);
  if (cached) return res.json(cached);

  if (!process.env.TIMEWAVE_API_KEY) {
    return res.status(500).json({ error: "TIMEWAVE_API_KEY is not configured" });
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
    allMissions = await fetchAllMissionsChunked(startDate, endDate, 100);

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
        const missions3m = await fetchAllMissionsChunked(threeMonthStart, startDate, 100);
        for (const m of missions3m) {
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

    setCachedData(cacheKey, responseData);
    res.json(responseData);
  } catch (err: any) {
    console.error("Timewave summary error:", err.message);
    res.status(500).json({ error: "Failed to compute mission summary" });
  }
});

app.all("/api/timewave/*", async (req, res) => {
  if (req.method === 'GET') {
    const cacheKey = "twproxy_" + req.originalUrl;
    const cached = getCachedData(cacheKey);
    if (cached) return res.json(cached);
  }

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
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
        "Accept": "application/json"
      }
    };

    if (req.method !== 'GET' && req.method !== 'HEAD' && req.body && Object.keys(req.body).length > 0) {
      (fetchConfig.headers as any)["Content-Type"] = "application/json";
      fetchConfig.body = JSON.stringify(req.body);
    }

    console.log(`\n\n[PROXY FIRE] Method: ${req.method} URL: ${url.toString()}\nToken Prefix: ${token.substring(0,6)}... \nIs Browser? ${!!req.headers['sec-ch-ua'] || !!req.headers['user-agent']?.includes('Mozilla')}`);
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

    if (req.method === 'GET' && response.ok) {
      const cacheKey = "twproxy_" + req.originalUrl;
      setCachedData(cacheKey, jsonData);
    } else if (req.method !== 'GET' && response.ok) {
      for (const key of apiCache.keys()) {
        if (key.startsWith("twproxy_") || key.startsWith("missions_summary_")) {
          apiCache.delete(key);
        }
      }
    }

    res.status(response.status).json(jsonData);
  } catch (err: any) {
    console.log("Timewave API Error:", err.message);
    res.status(500).json({ error: "Failed to fetch from Timewave API" });
  }
});

import { prisma } from './api/_lib/prisma';
// --- Newsletter DB Integration (Prisma) ---
// (In-memory array is removed in favor of Vercel Postgres via Prisma)

// We mount the extracted Vercel Serverless functions locally so `bun run dev` works identically to production!
import trackHandler from './api/newsletter/track/[id]/[emailBase64]';
import clickHandler from './api/newsletter/click/[id]/[emailBase64]';
import historyHandler from './api/newsletter/history';
import customersHandler from './api/newsletter/customers';
import sendHandler from './api/newsletter/send';
import smsHandler from './api/newsletter/sms';
import resendHandler from './api/newsletter/[id]/resend';
import templatesHandler from './api/automations/templates';

app.get("/api/newsletter/track/:id/:emailBase64", (req, res) => trackHandler(req as any, res as any));
app.get("/api/newsletter/click/:id/:emailBase64", (req, res) => clickHandler(req as any, res as any));
app.get("/api/newsletter/history", (req, res) => historyHandler(req as any, res as any));
app.get("/api/newsletter/customers", (req, res) => customersHandler(req as any, res as any));
app.post("/api/newsletter/send", (req, res) => sendHandler(req as any, res as any));
app.post("/api/newsletter/sms", (req, res) => smsHandler(req as any, res as any));
app.post("/api/newsletter/:id/resend", (req, res) => resendHandler(req as any, res as any));
app.all("/api/automations/templates", (req, res) => templatesHandler(req as any, res as any));

// API error handler (must be registered after all /api routes)
app.use("/api", errorMiddleware);

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
