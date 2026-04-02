import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getFortnoxTokens } from '../_lib/fortnoxAuth.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const tokens = await getFortnoxTokens();
    const isAuthenticated = !!(tokens && tokens.accessToken);
    
    res.json({
      authenticated: isAuthenticated,
      expiresAt: tokens?.expiresAt || 0,
    });
  } catch (error: any) {
    console.error("Fortnox status error:", error);
    res.status(500).json({ error: "Failed to check Fortnox status" });
  }
}
