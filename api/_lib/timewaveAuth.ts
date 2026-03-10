// Shared Timewave OAuth2 client credentials token management
// Caches access token in module scope (per serverless instance)

let timewaveAccessToken: string | null = null;
let tokenExpiresAt = 0;
let tokenPromise: Promise<string> | null = null;

export async function getTimewaveToken(): Promise<string> {
  const apiKey = process.env.TIMEWAVE_API_KEY;
  const clientId = process.env.TIMEWAVE_CLIENT_ID || "879";
  const timewaveBaseUrl = "https://api.timewave.se/v3";

  if (!apiKey) {
    throw new Error("TIMEWAVE_API_KEY is not configured");
  }

  if (timewaveAccessToken && Date.now() < tokenExpiresAt) {
    return timewaveAccessToken;
  }

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
        throw new Error(
          `Failed to authenticate with Timewave: ${await tokenRes.text()}`
        );
      }

      const tokenData = await tokenRes.json();
      timewaveAccessToken = tokenData.access_token;
      tokenExpiresAt = Date.now() + (tokenData.expires_in - 60) * 1000;
      tokenPromise = null;
      console.log("Successfully fetched new Timewave access token");
      return timewaveAccessToken as string;
    })();
  }

  return tokenPromise;
}
