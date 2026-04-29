import axios, { AxiosInstance, AxiosRequestConfig, AxiosError } from 'axios';
import { prisma } from './prisma.js';

const FORTNOX_BASE_URL = process.env.FORTNOX_BASE_URL || 'https://api.fortnox.se/3';

export interface FortnoxRequest {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  path: string;
  body?: unknown;
  entityType: string;
  entityId: string | number;
}

export class FortnoxError extends Error {
  constructor(public status: number, message: string, public body?: unknown) {
    super(message);
  }
}

/**
 * Make a request to Fortnox with retry + logging.
 * Access token must be obtained via existing fortnox/auth flow and passed in.
 */
export async function fortnoxRequest(
  accessToken: string,
  req: FortnoxRequest,
  opts: { maxAttempts?: number } = {}
): Promise<any> {
  const maxAttempts = opts.maxAttempts ?? 5;
  const backoffMs = [1000, 4000, 15000, 60000, 300000];
  const client: AxiosInstance = axios.create({
    baseURL: FORTNOX_BASE_URL,
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    timeout: 30000,
  });

  let attempt = 0;
  let lastErr: any;
  while (attempt < maxAttempts) {
    attempt++;
    const config: AxiosRequestConfig = {
      method: req.method,
      url: req.path,
      data: req.body,
    };
    try {
      const response = await client.request(config);
      await prisma.fortnoxSyncLog.create({
        data: {
          entityType: req.entityType,
          entityId: String(req.entityId),
          direction: 'OUT',
          attempt,
          httpStatus: response.status,
          payload: (req.body ?? {}) as any,
          response: (response.data ?? {}) as any,
        },
      });
      return response.data;
    } catch (err) {
      lastErr = err;
      const ax = err as AxiosError;
      const status = ax.response?.status ?? 0;
      const data = ax.response?.data;
      await prisma.fortnoxSyncLog.create({
        data: {
          entityType: req.entityType,
          entityId: String(req.entityId),
          direction: 'OUT',
          attempt,
          httpStatus: status || null,
          payload: (req.body ?? {}) as any,
          response: (data ?? null) as any,
          error: ax.message,
        },
      });
      const transient = status === 429 || (status >= 500 && status < 600);
      if (!transient) {
        throw new FortnoxError(status, ax.message, data);
      }
      if (attempt >= maxAttempts) break;
      await new Promise((r) => setTimeout(r, backoffMs[attempt - 1] ?? 300000));
    }
  }
  throw new FortnoxError(
    (lastErr as AxiosError)?.response?.status ?? 0,
    'Max retries exceeded',
    (lastErr as AxiosError)?.response?.data
  );
}
