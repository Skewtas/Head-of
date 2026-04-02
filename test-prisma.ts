import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { PrismaClient } = require('@prisma/client');
const s = 'postgres://391776e1e8367d5c24567b8be6966b8e8a16cbedeb8c71be313306507a2a2d89:sk_50HAnZoW8sv2PEJ9jRy9s@db.prisma.io:5432/postgres?sslmode=require';
let connectionString = s;

let useAccelerate = false;
let finalConnectionString = connectionString;

if ((connectionString || '').startsWith('prisma://') || (connectionString || '').startsWith('prisma+postgres://') || (connectionString || '').includes('db.prisma.io')) {
  useAccelerate = true;
  if (finalConnectionString.startsWith('postgres://') && finalConnectionString.includes('db.prisma.io')) {
    finalConnectionString = finalConnectionString.replace('postgres://', 'prisma+postgres://');
  }
}
try {
  const u = new URL(finalConnectionString);
  if (u.password && !u.searchParams.has('api_key')) {
    u.searchParams.set('api_key', u.password);
    finalConnectionString = u.toString();
  }
} catch {}

if (useAccelerate) {
  const c = new PrismaClient({ accelerateUrl: finalConnectionString });
  c.automatedTemplate.findFirst().then(data => {
    console.log('Query result:', !!data);
    process.exit(0);
  }).catch(e => {
    console.log('Query error:', e);
    process.exit(1);
  });
}
