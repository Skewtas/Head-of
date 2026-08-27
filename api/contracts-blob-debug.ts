/**
 * Diagnostik: kollar om BLOB_READ_WRITE_TOKEN är satt i env och hur den ser ut.
 * Öppen — visar inga hemligheter.
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(_req: VercelRequest, res: VercelResponse) {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  res.json({
    tokenExists: !!token,
    tokenLength: token ? token.length : 0,
    tokenPrefix: token ? token.slice(0, 20) + '…' : null,
    envKeysWithBlob: Object.keys(process.env).filter((k) => k.toLowerCase().includes('blob')),
    nodeEnv: process.env.NODE_ENV,
    vercelEnv: process.env.VERCEL_ENV,
  });
}
