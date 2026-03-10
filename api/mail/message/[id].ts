import type { VercelRequest, VercelResponse } from '@vercel/node';
import { userTokens } from '../../_lib/tokenStore';
import { parseCookies } from '../../_lib/cookies';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const cookies = parseCookies(req);
  const sessionId = cookies.session_id;
  const tokenData = sessionId ? userTokens[sessionId] : null;

  if (!tokenData) {
    return res.status(401).json({ error: "Not authenticated" });
  }

  const { id } = req.query;

  if (req.method === 'PATCH') {
    try {
      const response = await fetch(
        `https://graph.microsoft.com/v1.0/me/messages/${id}`,
        {
          method: "PATCH",
          headers: {
            Authorization: `Bearer ${tokenData.accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(req.body),
        }
      );

      if (!response.ok) {
        throw new Error(`Failed to update: ${response.status}`);
      }

      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: "Failed to update message" });
    }
  } else if (req.method === 'DELETE') {
    try {
      const response = await fetch(
        `https://graph.microsoft.com/v1.0/me/messages/${id}`,
        {
          method: "DELETE",
          headers: { Authorization: `Bearer ${tokenData.accessToken}` },
        }
      );

      if (!response.ok) {
        throw new Error(`Failed to delete: ${response.status}`);
      }

      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: "Failed to delete message" });
    }
  } else {
    res.status(405).json({ error: 'Method not allowed' });
  }
}
