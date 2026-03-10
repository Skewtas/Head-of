import type { VercelRequest, VercelResponse } from '@vercel/node';
import { userTokens } from '../_lib/tokenStore';
import { parseCookies } from '../_lib/cookies';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const cookies = parseCookies(req);
  const sessionId = cookies.session_id;
  const tokenData = sessionId ? userTokens[sessionId] : null;

  if (!tokenData) {
    return res.status(401).json({ error: "Not authenticated" });
  }

  const { messageId, comment, action } = req.body;
  const endpoint = action === 'forward' ? 'forward' : action === 'replyAll' ? 'replyAll' : 'reply';

  try {
    const body: any = { comment };
    if (action === 'forward') {
      body.toRecipients = req.body.toRecipients;
    }

    const response = await fetch(
      `https://graph.microsoft.com/v1.0/me/messages/${messageId}/${endpoint}`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${tokenData.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      }
    );

    if (!response.ok) {
      throw new Error(`Failed to ${endpoint}: ${response.status}`);
    }

    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: `Failed to ${endpoint}` });
  }
}
