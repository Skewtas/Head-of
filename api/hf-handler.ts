export { default } from './_lib/headofHandler.js';

// Vercel serverless config: höjd maxDuration till 60s eftersom send-for-signing
// gör flera Prisma-queries + Resend-anrop och kan träffa default 10s-taket.
export const config = { maxDuration: 60 };
