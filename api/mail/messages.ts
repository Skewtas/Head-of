import type { VercelRequest, VercelResponse } from '@vercel/node';
import { userTokens } from '../_lib/tokenStore';
import { parseCookies, clearSessionCookie } from '../_lib/cookies';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const cookies = parseCookies(req);
  const sessionId = cookies.session_id;
  const tokenData = sessionId ? userTokens[sessionId] : null;

  if (!tokenData) {
    return res.status(401).json({ error: "Not authenticated" });
  }

  const folder = (req.query.folder as string) || 'inbox';
  let folderId = 'inbox';
  if (folder === 'sent') folderId = 'sentitems';
  if (folder === 'drafts') folderId = 'drafts';
  if (folder === 'archive') folderId = 'archive';

  try {
    const response = await fetch(
      `https://graph.microsoft.com/v1.0/me/mailFolders/${folderId}/messages?$top=50&$select=id,subject,bodyPreview,body,sender,toRecipients,ccRecipients,receivedDateTime,isRead,flag&$orderby=receivedDateTime DESC`,
      {
        headers: { Authorization: `Bearer ${tokenData.accessToken}` },
      }
    );

    if (response.status === 401) {
      delete userTokens[sessionId];
      res.setHeader('Set-Cookie', clearSessionCookie());
      return res.status(401).json({ error: "Token expired" });
    }

    const data = await response.json();
    res.json(data.value);
  } catch (err: any) {
    res.status(500).json({ error: "Failed to fetch emails" });
  }
}
