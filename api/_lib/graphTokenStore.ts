/**
 * Persist Microsoft Graph OAuth refresh_token i DB så bakgrundsjobb
 * (cron) kan hämta ett färskt access_token utan användarsession.
 *
 * Modell: en enda "system-token" per tenant. Varje ny OAuth-login skriver
 * över med sin refresh_token (last-write-wins). För Stodona som har ett
 * team på 2 personer räcker det — den som senast loggade in är den
 * "cron-authad" användaren, och båda ser samma inkorg (info@stodona.se).
 *
 * Lagring: JSON-blob i automatedTemplate-doc:et system_graph_token för
 * att slippa Prisma-migration. Passar väl in i det etablerade mönstret
 * (system_contacts, system_optouts).
 */
import { prisma } from './prisma.js';

const DOC_ID = 'system_graph_token';

type StoredToken = {
  refreshToken: string;
  savedAt: string;
  savedByEmail?: string;
};

export async function saveGraphRefreshToken(refreshToken: string, savedByEmail?: string): Promise<void> {
  const record: StoredToken = { refreshToken, savedAt: new Date().toISOString(), savedByEmail };
  await prisma.automatedTemplate.upsert({
    where: { id: DOC_ID },
    create: { id: DOC_ID, subject: 'SYSTEM_GRAPH_TOKEN', blocks: record as any },
    update: { blocks: record as any },
  });
}

/** Returnerar ett färskt access_token via refresh-flow. Kastar om inget finns. */
export async function getStoredGraphAccessToken(): Promise<string> {
  const doc = await prisma.automatedTemplate.findUnique({ where: { id: DOC_ID } });
  const record = (doc?.blocks as any) as StoredToken | undefined;
  if (!record?.refreshToken) {
    throw new Error('Ingen Microsoft-refresh_token sparad. Någon måste logga in i MAIL-tabben först.');
  }

  const clientId = process.env.MICROSOFT_CLIENT_ID;
  const clientSecret = process.env.MICROSOFT_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error('MICROSOFT_CLIENT_ID/SECRET saknas i env');

  const resp = await fetch('https://login.microsoftonline.com/common/oauth2/v2.0/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: record.refreshToken,
      grant_type: 'refresh_token',
    }).toString(),
  });
  if (!resp.ok) {
    const errText = await resp.text().catch(() => '');
    throw new Error(`Microsoft refresh-flow failed: ${resp.status} ${errText}`);
  }
  const data = await resp.json();
  // Rotera refresh_token om Microsoft ger oss en ny
  if (data.refresh_token && data.refresh_token !== record.refreshToken) {
    await saveGraphRefreshToken(data.refresh_token, record.savedByEmail);
  }
  return data.access_token as string;
}
