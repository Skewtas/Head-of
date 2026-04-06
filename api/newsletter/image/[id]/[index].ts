import { prisma } from '../../../_lib/prisma.js';
import type { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const { id, index } = req.query;

  if (typeof id !== 'string' || typeof index !== 'string') {
    return res.status(400).send('Invalid request');
  }

  const idx = parseInt(index, 10);
  if (isNaN(idx)) {
    return res.status(400).send('Invalid index');
  }

  try {
    const original = await prisma.newsletter.findUnique({
      where: { id }
    });

    if (!original || (!original.htmlContent && !original.imageData)) {
      return res.status(404).send('Not found');
    }

    // Collect all data URIs
    const uris: string[] = [];
    
    // First from imageData if it exists
    if (original.imageData && original.imageData.startsWith('data:image')) {
      uris.push(original.imageData);
    }
    
    // Then from htmlContent regex
    if (original.htmlContent) {
      const regex = /src="(data:image\/[^;]+;base64,[^"]+)"/g;
      let match;
      while ((match = regex.exec(original.htmlContent)) !== null) {
        uris.push(match[1]);
      }
    }

    if (idx < 0 || idx >= uris.length) {
      return res.status(404).send('Image out of bounds');
    }

    const dataUri = uris[idx];
    const match = dataUri.match(/^data:(image\/[^;]+);base64,(.+)$/);
    if (!match) {
      return res.status(500).send('Corrupt image data');
    }

    const mimeType = match[1];
    const base64Data = match[2];
    const buffer = Buffer.from(base64Data, 'base64');

    res.setHeader('Content-Type', mimeType);
    res.setHeader('Cache-Control', 'public, max-age=31536000'); // Cache for 1 year
    res.send(buffer);
  } catch (err) {
    console.error(err);
    res.status(500).send('Server Error');
  }
}
