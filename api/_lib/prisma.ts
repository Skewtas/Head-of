import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';
import { createRequire } from 'module';
import { Pool, neonConfig } from '@neondatabase/serverless';
import { PrismaNeon } from '@prisma/adapter-neon';
import ws from 'ws';

const require = createRequire(import.meta.url);
const { PrismaClient } = require('@prisma/client');

// Use global pattern to survive hot-reloading in dev
const globalForPrisma = global as unknown as { prisma: InstanceType<typeof PrismaClient> };

if (!globalForPrisma.prisma) {
  // Always use standard postgres URL, let the Neon adapter handle the WebSocket/HTTP connection
  let envUrl = process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.PRISMA_DATABASE_URL;
  let connectionString = envUrl || '';
  if (process.env.NODE_ENV !== 'production') {
    try {
      const envPath = path.resolve(process.cwd(), '.env');
      if (fs.existsSync(envPath)) {
        const parsed = dotenv.parse(fs.readFileSync(envPath, 'utf-8'));
        if (parsed.DATABASE_URL) connectionString = parsed.DATABASE_URL;
      }
    } catch {}
  }
  
  // Neon serverless requires WebSocket
  neonConfig.webSocketConstructor = ws;
  
  // If the URL has prisma+postgres or prisma layer, we use accelerateUrl instead of neon adapter
  let useAccelerate = false;
  if ((connectionString || '').startsWith('prisma://') || (connectionString || '').startsWith('prisma+postgres://')) {
    useAccelerate = true;
  }
  
  if (useAccelerate) {
    globalForPrisma.prisma = new PrismaClient({ accelerateUrl: connectionString });
  } else {
    // Neon serverless requires WebSocket
    neonConfig.webSocketConstructor = ws;
    const pool = new Pool({ connectionString: connectionString || '' });
    const adapter = new PrismaNeon(pool as any);
    globalForPrisma.prisma = new PrismaClient({ adapter });
  }
}

export const prisma = globalForPrisma.prisma;
