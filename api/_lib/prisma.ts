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

export function getPrisma() {
  if (!globalForPrisma.prisma) {
    // Use DATABASE_URL from process.env (already loaded by server.ts via dotenv,
    // with .env.local overriding .env). Do NOT re-read .env and override — that
    // would undo the .env.local override.
    let connectionString = process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.PRISMA_DATABASE_URL || '';
    
    // Neon serverless requires WebSocket
    neonConfig.webSocketConstructor = ws;
    
    // If the URL has prisma+postgres or prisma layer, OR points to Prisma Data Proxy, we use accelerateUrl instead of neon adapter
    let useAccelerate = false;
    let usePgAdapter = false;
    let finalConnectionString = connectionString;
    
    if ((connectionString || '').startsWith('prisma://') || (connectionString || '').startsWith('prisma+postgres://')) {
      useAccelerate = true;
    } else if ((connectionString || '').includes('db.prisma.io')) {
      usePgAdapter = true;
      if (finalConnectionString.startsWith('prisma+postgres://')) {
          finalConnectionString = finalConnectionString.replace('prisma+postgres://', 'postgres://');
      }
    }
    
    if (useAccelerate) {
      globalForPrisma.prisma = new PrismaClient({ accelerateUrl: finalConnectionString });
    } else if (usePgAdapter) {
      // Prisma Data Proxy V1 uses TCP, so we must use standard pg adapter
      const { Pool: PgPool } = require('pg');
      const { PrismaPg } = require('@prisma/adapter-pg');
      const pool = new PgPool({
        connectionString: finalConnectionString || '',
        ssl: { rejectUnauthorized: false },
      });
      const adapter = new PrismaPg(pool);
      globalForPrisma.prisma = new PrismaClient({ adapter });
    } else {
      // Standard Neon serverless WebSockets
      neonConfig.webSocketConstructor = ws;
      const pool = new Pool({ connectionString: finalConnectionString || '' });
      const adapter = new PrismaNeon(pool as any);
      globalForPrisma.prisma = new PrismaClient({ adapter });
    }
  }
  return globalForPrisma.prisma;
}

// Proxies object so backwards compatibility with `prisma.automations...` remains
export const prisma = new Proxy({} as InstanceType<typeof PrismaClient>, {
  get: (target, prop) => {
    return (getPrisma() as any)[prop];
  }
});
