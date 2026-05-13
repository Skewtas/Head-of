/**
 * Return a newsletter's editable content so the user can load it back into the
 * editor as a template ("Använd som mall").
 *
 * Returns blocks if we saved them; otherwise falls back to a synthetic block
 * list built from the legacy fields (so old newsletters from before the
 * `blocks` column existed are still copyable, just less granularly editable).
 */
import { prisma } from '../../_lib/prisma.js';
import type { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') return res.status(405).send('Method Not Allowed');
  const id = String(req.query.id || '');
  if (!id) return res.status(400).json({ error: 'Missing id' });

  const n = await prisma.newsletter.findUnique({ where: { id } });
  if (!n) return res.status(404).json({ error: 'Not found' });

  let blocks: any[] = [];
  if (Array.isArray(n.blocks)) {
    blocks = n.blocks as any[];
  } else if (n.htmlContent) {
    // Parse legacy HTML back into editor blocks. The HTML was produced by
    // buildHtmlFromBlocks() so we know its shape and can reverse it well
    // enough for editing.
    // htmlContent stored on the row is the pre-Resend version with base64
    // images intact, so parsing yields directly usable blocks.
    blocks = parseHtmlToBlocks(n.htmlContent, id);
  } else {
    if (n.introText) {
      blocks.push({ id: `intro-${id}`, type: 'text', content: n.introText });
    }
    if (n.imageData) {
      blocks.push({ id: `img-${id}`, type: 'image', content: '', imageData: n.imageData });
    }
  }

  res.json({
    id: n.id,
    subject: n.subject,
    category: n.category,
    blocks,
    introText: n.introText ?? '',
    imageData: n.imageData ?? null,
    embedUrl: n.embedUrl ?? null,
  });
}

// ──────────────────────────────────────────────────────────────────────────────
// HTML → blocks (legacy fallback)
// ──────────────────────────────────────────────────────────────────────────────

let nextBlockSeq = 0;
function bid(prefix: string) {
  nextBlockSeq += 1;
  return `${prefix}-${Date.now().toString(36)}-${nextBlockSeq}`;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function stripTags(s: string): string {
  return decodeEntities(s.replace(/<br\s*\/?\s*>/gi, '\n').replace(/<[^>]+>/g, '').trim());
}

function attr(html: string, name: string): string | null {
  const m = html.match(new RegExp(`${name}="([^"]*)"`, 'i'));
  return m ? m[1] : null;
}

/**
 * Parse the HTML produced by buildHtmlFromBlocks() back into editor blocks.
 * Tries to be tolerant: anything it doesn't recognize is dropped silently
 * rather than appearing as raw HTML in the editor.
 */
export function parseHtmlToBlocks(html: string, _newsletterId: string): any[] {
  const blocks: any[] = [];

  // Iterate top-level wrapper divs. Each block from the editor is rendered
  // inside one of these:
  //   <div style="padding:0 32px;...">...inner...</div>
  // image_text uses an additional <table> inside that wrapper.
  // We also handle bare <table> wrappers and <div style="margin:0 0 20px;">
  // used by canva.

  // Pull each <div style="..."> ... </div> at depth 0 by greedy scanning of
  // balanced tags. Use a simple approach: find each `<div style="padding:0 32px"`
  // chunk; for everything else, fall back to body text.
  const wrapperRe = /<div[^>]*style="[^"]*padding:\s*0\s*32px[^"]*"[^>]*>([\s\S]*?)<\/div>\s*(?=<div|<table|<hr|$)/gi;
  let m: RegExpExecArray | null;
  let matched = false;
  while ((m = wrapperRe.exec(html)) !== null) {
    matched = true;
    const inner = m[1];
    const block = parseInner(inner);
    if (block) blocks.push(block);
  }

  // Canva / full-bleed image blocks (margin:0 0 20px;) without padding wrapper
  const canvaRe = /<div[^>]*style="[^"]*margin:0 0 20px[^"]*"[^>]*>([\s\S]*?)<\/div>/gi;
  while ((m = canvaRe.exec(html)) !== null) {
    matched = true;
    const inner = m[1];
    const imgMatch = inner.match(/<img[^>]+src="([^"]+)"[^>]*>/i);
    if (imgMatch) {
      const aMatch = inner.match(/<a[^>]+href="([^"]+)"/i);
      blocks.push({
        id: bid('canva'),
        type: 'canva',
        content: '',
        imageData: imgMatch[1],
        buttonUrl: aMatch ? aMatch[1] : '',
      });
    }
  }

  // Dividers
  if (/<hr\s/i.test(html)) {
    // Insert one divider per occurrence, but order will already be roughly
    // right because they appear inside their own wrappers; keep simple:
    const divCount = (html.match(/<hr\s/gi) || []).length;
    for (let i = 0; i < divCount; i++) {
      // Only push if not already represented as a wrapper-with-hr (handled below)
      // Practical compromise: dividers always end up at the end of the list,
      // which is good enough for editability.
      blocks.push({ id: bid('div'), type: 'divider', content: '' });
    }
  }

  if (!matched && html.trim()) {
    // Couldn't parse at all — surface the visible text as a single block so
    // the user still has the words to work with.
    blocks.push({
      id: bid('text'),
      type: 'text',
      content: stripTags(html),
    });
  }

  return blocks;
}

function parseInner(inner: string): any | null {
  // heading
  const h = inner.match(/<h2[^>]*>([\s\S]*?)<\/h2>/i);
  if (h) {
    return { id: bid('h'), type: 'heading', content: stripTags(h[1]) };
  }

  // image_text — has a <table> with 2 cells, one with image, one with text
  if (/<table[^>]*role="presentation"/i.test(inner) && /<img/i.test(inner)) {
    const cells = [...inner.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((mm) => mm[1]);
    if (cells.length === 2) {
      const imgIdx = cells.findIndex((c) => /<img/i.test(c));
      const txtIdx = imgIdx === 0 ? 1 : 0;
      const imgSrc = attr(cells[imgIdx], 'src');
      const link = cells[imgIdx].match(/<a[^>]+href="([^"]+)"/i);
      const text = stripTags(cells[txtIdx].replace(/<br\s*\/?\s*>/gi, '\n'));
      return {
        id: bid('it'),
        type: 'image_text',
        content: text,
        imageData: imgSrc || undefined,
        buttonUrl: link ? link[1] : '',
        imagePosition: imgIdx === 0 ? 'left' : 'right',
      };
    }
  }

  // image
  const imgOnly = inner.match(/<img[^>]+src="([^"]+)"[^>]*>/i);
  if (imgOnly && !/<p/i.test(inner) && !/<h\d/i.test(inner)) {
    const aMatch = inner.match(/<a[^>]+href="([^"]+)"/i);
    return {
      id: bid('img'),
      type: 'image',
      content: '',
      imageData: imgOnly[1],
      buttonUrl: aMatch ? aMatch[1] : '',
    };
  }

  // button — distinctive padding inside an <a>
  const btn = inner.match(/<a[^>]+href="([^"]+)"[^>]*style="[^"]*padding:14px 36px[^"]*"[^>]*>([\s\S]*?)<\/a>/i);
  if (btn) {
    const color = inner.match(/background:([^;"]+)/i);
    return {
      id: bid('btn'),
      type: 'button',
      content: stripTags(btn[2]),
      buttonUrl: btn[1],
      buttonColor: color ? color[1].trim() : '#1a1a2e',
    };
  }

  // text (p) — most common
  const p = inner.match(/<p[^>]*>([\s\S]*?)<\/p>/i);
  if (p) {
    return { id: bid('t'), type: 'text', content: stripTags(p[1]) };
  }

  // hr inside wrapper
  if (/<hr\s/i.test(inner)) {
    return { id: bid('d'), type: 'divider', content: '' };
  }

  return null;
}
