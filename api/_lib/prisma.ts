import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';
import pkg from '@prisma/client';
const { PrismaClient } = pkg;

// Use global pattern to survive hot-reloading in dev
const globalForPrisma = global as unknown as { prisma: InstanceType<typeof PrismaClient> };

export const prisma =
  globalForPrisma.prisma ||
  new PrismaClient();

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;
