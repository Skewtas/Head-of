import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';
import pkg from '@prisma/client';
const { PrismaClient } = pkg;

// Read the prisma+postgres:// URL directly from .env file
// (.env.local overrides DATABASE_URL with a plain postgres:// URL, 
//  but PrismaClient accelerateUrl requires prisma+postgres:// protocol)
function getAccelerateUrl(): string | undefined {
  // First: try reading from .env file directly (has prisma+postgres:// URL)
  try {
    const envPath = path.resolve(process.cwd(), '.env');
    const envContent = fs.readFileSync(envPath, 'utf-8');
    const parsed = dotenv.parse(envContent);
    const url = parsed.DATABASE_URL;
    if (url && (url.startsWith('prisma://') || url.startsWith('prisma+postgres://'))) {
      return url;
    }
  } catch {}
  // Fallback: check process.env (works on Vercel where DATABASE_URL is set correctly)
  const envUrl = process.env.DATABASE_URL;
  if (envUrl && (envUrl.startsWith('prisma://') || envUrl.startsWith('prisma+postgres://'))) {
    return envUrl;
  }
  return undefined;
}

const globalForPrisma = global as unknown as { prisma: InstanceType<typeof PrismaClient> };

export const prisma =
  globalForPrisma.prisma ||
  new PrismaClient({
    accelerateUrl: getAccelerateUrl(),
  });

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;
