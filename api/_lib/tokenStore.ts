// In-memory store for Microsoft OAuth tokens (per serverless instance)
// In production, use a database for persistence across instances

export const userTokens: Record<string, {
  accessToken: string;
  refreshToken?: string;
  expiresAt: number;
}> = {};

export const generateSessionId = () =>
  Math.random().toString(36).substring(2, 15);
