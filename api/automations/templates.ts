import { prisma } from '../_lib/prisma';
import type { VercelRequest, VercelResponse } from '@vercel/node';

// In-memory fallback for local development when Prisma Postgres isn't running
const memoryStore = new Map<string, { id: string; subject: string; blocks: any }>();

async function getTemplates() {
  try {
    return await prisma.automatedTemplate.findMany();
  } catch {
    // Fallback to in-memory store
    return Array.from(memoryStore.values());
  }
}

async function upsertTemplate(id: string, subject: string, blocks: any) {
  try {
    return await prisma.automatedTemplate.upsert({
      where: { id },
      update: { subject, blocks },
      create: { id, subject, blocks }
    });
  } catch {
    // Fallback to in-memory store
    const template = { id, subject, blocks };
    memoryStore.set(id, template);
    return template;
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'GET') {
    const templates = await getTemplates();
    return res.json(templates);
  }

  if (req.method === 'POST') {
    const { id, subject, blocks } = req.body;
    
    if (!id || !subject) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const template = await upsertTemplate(id, subject, blocks);
    return res.json({ success: true, message: 'Mall sparades', template });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
