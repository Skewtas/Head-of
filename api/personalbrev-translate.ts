/**
 * Auto-översättning via Anthropic API för personalbrev.
 * POST body: { text: string, targetLanguage: 'en'|'uk'|'es'|'sq'|'pl'|'ar'|'ru'|'ro' }
 * Returns: { translated: string }
 *
 * Kräver ANTHROPIC_API_KEY env-var i Vercel.
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';

export const config = { maxDuration: 30 };

const LANGUAGE_NAMES: Record<string, string> = {
  en: 'English',
  uk: 'Ukrainian',
  es: 'Spanish',
  sq: 'Albanian',
  pl: 'Polish',
  ar: 'Arabic',
  ru: 'Russian',
  ro: 'Romanian',
  de: 'German',
  fi: 'Finnish',
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({
      error: 'ANTHROPIC_API_KEY saknas i Vercel-env. Lägg till nyckeln i Settings → Environment Variables + redeploy.',
    });
  }

  const body = (req.body || {}) as { text?: string; targetLanguage?: string };
  const text = String(body.text || '').trim();
  const langCode = String(body.targetLanguage || '').trim();
  const langName = LANGUAGE_NAMES[langCode];

  if (!text) return res.status(400).json({ error: 'text saknas' });
  if (!langName) return res.status(400).json({ error: `targetLanguage okänt (${langCode}). Använd: ${Object.keys(LANGUAGE_NAMES).join(', ')}` });

  try {
    const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 4096,
        messages: [{
          role: 'user',
          content: `Translate the following Swedish text to ${langName}. Output ONLY the translation — no preamble, no explanation, no quotes. Preserve line breaks and formatting exactly. Keep {{placeholders}} unchanged.\n\n---\n${text}`,
        }],
      }),
    });

    if (!anthropicRes.ok) {
      const errText = await anthropicRes.text();
      return res.status(500).json({
        error: `Anthropic API error ${anthropicRes.status}`,
        details: errText.substring(0, 500),
      });
    }

    const data = await anthropicRes.json();
    const translated = data?.content?.[0]?.text?.trim() || '';
    if (!translated) return res.status(500).json({ error: 'Tom översättning från AI.' });

    res.json({
      translated,
      targetLanguage: langCode,
      targetLanguageName: langName,
      inputChars: text.length,
      outputChars: translated.length,
      model: 'claude-haiku-4-5',
    });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'translate failed' });
  }
}
