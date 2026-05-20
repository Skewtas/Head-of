import { Pool, neonConfig } from '@neondatabase/serverless';
import { PrismaNeon } from '@prisma/adapter-neon';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { Pool as PgPool } from 'pg';
import ws from 'ws';

// Use global pattern to survive hot-reloading in dev + reuse across serverless
// invocations on the same lambda instance.
const globalForPrisma = global as unknown as { prisma: PrismaClient | undefined };

export function getPrisma(): PrismaClient {
  if (globalForPrisma.prisma) return globalForPrisma.prisma;

  const connectionString =
    process.env.DATABASE_URL ||
    process.env.POSTGRES_URL ||
    process.env.PRISMA_DATABASE_URL ||
    '';

  neonConfig.webSocketConstructor = ws;

  let useAccelerate = false;
  let usePgAdapter = false;
  let finalConnectionString = connectionString;

  if (
    connectionString.startsWith('prisma://') ||
    connectionString.startsWith('prisma+postgres://')
  ) {
    useAccelerate = true;
  } else if (connectionString.includes('db.prisma.io')) {
    usePgAdapter = true;
    if (finalConnectionString.startsWith('prisma+postgres://')) {
      finalConnectionString = finalConnectionString.replace(
        'prisma+postgres://',
        'postgres://'
      );
    }
  }

  if (useAccelerate) {
    globalForPrisma.prisma = new PrismaClient({ accelerateUrl: finalConnectionString } as any);
  } else if (usePgAdapter) {
    const pool = new PgPool({
      connectionString: finalConnectionString || '',
      ssl: { rejectUnauthorized: false },
    });
    const adapter = new PrismaPg(pool as any);
    globalForPrisma.prisma = new PrismaClient({ adapter } as any);
  } else {
    const pool = new Pool({ connectionString: finalConnectionString || '' });
    const adapter = new PrismaNeon(pool as any);
    globalForPrisma.prisma = new PrismaClient({ adapter } as any);
  }

  return globalForPrisma.prisma!;
}

// Proxy so legacy `prisma.foo` accesses still work without explicitly calling
// getPrisma() everywhere. Lazy-initialized on first property access.
export const prisma = new Proxy({} as PrismaClient, {
  get: (_target, prop) => (getPrisma() as any)[prop],
});
