import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getTimewaveToken } from '../_lib/timewaveAuth.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const apiKey = process.env.TIMEWAVE_API_KEY;

  if (!apiKey) {
    return res.status(500).json({ error: "TIMEWAVE_API_KEY is not configured" });
  }

  // Extract the catch-all path segments
  const { path } = req.query;
  const endpoint = Array.isArray(path) ? path.join('/') : path || '';
  const timewaveBaseUrl = "https://api.timewave.se/v3";

  try {
    const accessToken = await getTimewaveToken();

    // Reconstruct query string (excluding the 'path' param used for routing)
    const url = new URL(`${timewaveBaseUrl}/${endpoint}`);
    const queryString = req.url?.split('?')[1];
    if (queryString) {
      // Parse and re-add query params, excluding internal 'path' param
      const params = new URLSearchParams(queryString);
      params.forEach((value, key) => {
        if (key !== 'path') {
          url.searchParams.append(key, value);
        }
      });
    }

    const fetchConfig: RequestInit = {
      method: req.method,
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        "Accept": "application/json",
      },
    };

    if (req.method !== 'GET' && req.method !== 'HEAD' && req.body) {
      if (typeof req.body === 'object' && Object.keys(req.body).length > 0) {
        fetchConfig.body = JSON.stringify(req.body);
      }
    }

    const response = await fetch(url.toString(), fetchConfig);
    const textData = await response.text();

    let jsonData;
    try {
      jsonData = JSON.parse(textData);
    } catch {
      jsonData = textData;
    }

    res.status(response.status).json(jsonData);
  } catch (err: any) {
    console.error("Timewave API Fetch Error:", err?.message, err?.stack);
    res.status(500).json({ error: "Failed to fetch from Timewave API", details: err?.message });
  }
}
