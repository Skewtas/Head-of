import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const FORTNOX_CLIENT_ID = "EojgbHJg0L7C";
const FORTNOX_CLIENT_SECRET = "PqB4oT2hYj";
const FORTNOX_TOKEN_URL = "https://apps.fortnox.se/oauth-v1/token";
const FORTNOX_API_BASE = "https://api.fortnox.se/3";

export interface FortnoxTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

/**
 * Hämta Fortnox tokens från databasen (eller null om de inte finns)
 */
export async function getFortnoxTokens(): Promise<FortnoxTokens | null> {
  try {
    const record = await prisma.automatedTemplate.findUnique({
      where: { id: 'system_fortnox_tokens' }
    });
    
    if (record && record.blocks) {
      // @ts-ignore
      return record.blocks as FortnoxTokens;
    }
  } catch (error) {
    console.error("Failed to read Fortnox tokens from database:", error);
  }
  return null;
}

/**
 * Spara Fortnox tokens i databasen
 */
export async function saveFortnoxTokens(tokens: FortnoxTokens): Promise<void> {
  try {
    await prisma.automatedTemplate.upsert({
      where: { id: 'system_fortnox_tokens' },
      update: {
        subject: 'Internal System Data',
        blocks: tokens as any
      },
      create: {
        id: 'system_fortnox_tokens',
        subject: 'Internal System Data',
        blocks: tokens as any
      }
    });
  } catch (error) {
    console.error("Failed to save Fortnox tokens to database:", error);
  }
}

/**
 * Uppdatera (Refresh) Fortnox token med refreshToken om det har gått ut
 */
export async function refreshFortnoxToken(tokens: FortnoxTokens): Promise<FortnoxTokens> {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: tokens.refreshToken,
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
    throw new Error(`Failed to refresh Fortnox token: ${errText}`);
  }

  const tokenData = await tokenResp.json();
  const newTokens: FortnoxTokens = {
    accessToken: tokenData.access_token,
    refreshToken: tokenData.refresh_token,
    expiresAt: Date.now() + (tokenData.expires_in - 60) * 1000,
  };

  // Spara de nya nycklarna i DB
  await saveFortnoxTokens(newTokens);
  return newTokens;
}

/**
 * Gör ett anrop till Fortnox API med automatisk token-uppdatering
 */
export async function fortnoxFetch(path: string, options: RequestInit = {}): Promise<any> {
  let tokens = await getFortnoxTokens();
  
  if (!tokens || !tokens.accessToken) {
    throw new Error("NOT_AUTHENTICATED: Fortnox is not connected.");
  }

  // Refresh om det löpt ut
  if (Date.now() > tokens.expiresAt) {
    tokens = await refreshFortnoxToken(tokens);
  }

  let resp = await fetch(`${FORTNOX_API_BASE}${path}`, { 
    ...options,
    headers: {
      ...options.headers,
      "Authorization": `Bearer ${tokens.accessToken}`,
      "Content-Type": "application/json",
      "Accept": "application/json"
    } 
  });

  // Om 401, prova refresha en gång till för säkerhets skull
  if (resp.status === 401) {
    tokens = await refreshFortnoxToken(tokens);
    resp = await fetch(`${FORTNOX_API_BASE}${path}`, { 
      ...options,
      headers: {
        ...options.headers,
        "Authorization": `Bearer ${tokens.accessToken}`,
        "Content-Type": "application/json",
        "Accept": "application/json"
      } 
    });
  }

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`Fortnox API ${resp.status}: ${errText}`);
  }

  return resp.json();
}
