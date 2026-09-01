/**
 * SMS-sändning via SureSMS. Extraherad från api/newsletter/sms.ts så att
 * både nyhetsbrev-SMS och personalbrev-SMS kan använda samma leverans-loop.
 *
 * Ansvar: normalisera nummer, filtrera opt-out, skicka via SureSMS, returnera
 * resultat. Skapar/uppdaterar INGEN databas-rad — det gör kallaren.
 */
import { prisma } from './prisma.js';

export interface SmsRecipient {
  name: string;
  phone: string;
  email?: string | null;
}

export interface SendSmsOpts {
  message: string;
  recipients: SmsRecipient[];
  sender?: string;
  includeOptOutLink?: boolean;
}

export interface SendSmsResult {
  sent: number;
  failed: number;
  failedRecipients: Array<{ phone: string; error: string }>;
  optedOut: number;
}

const SURESMS_ENDPOINT = 'https://api.suresms.com/Script/SendSMS.aspx';
const MAX_SMS_CHARS = 918; // 6 SMS-delar

export function normalizePhone(raw: string | undefined | null): string | null {
  if (!raw) return null;
  const cleaned = raw.replace(/[\s\-()]/g, '');
  if (/^07\d{8}$/.test(cleaned)) return '+46' + cleaned.substring(1);
  if (/^467\d{8}$/.test(cleaned)) return '+' + cleaned;
  if (/^\+467\d{8}$/.test(cleaned)) return cleaned;
  return cleaned;
}

export async function sendSms(opts: SendSmsOpts): Promise<SendSmsResult> {
  const { message, recipients, sender, includeOptOutLink } = opts;
  const apiKey = process.env.SURESMS_API_KEY;
  if (!apiKey) throw new Error('SURESMS_API_KEY saknas i miljön.');
  if (!message || !recipients?.length) {
    return { sent: 0, failed: 0, failedRecipients: [], optedOut: 0 };
  }
  if (message.length > MAX_SMS_CHARS) {
    throw new Error(`SMS-meddelandet är för långt (${message.length}/${MAX_SMS_CHARS} tecken).`);
  }

  // Hämta opt-outs
  const optOutDoc = await prisma.automatedTemplate.findUnique({ where: { id: 'system_optouts' } });
  const optOutData = (optOutDoc?.blocks as any) ?? { phones: [] };
  const optOutSet = new Set<string>(optOutData.phones || []);

  const fromName = sender || 'Stodona.se';
  let sent = 0;
  let optedOut = 0;
  const failed: Array<{ phone: string; error: string }> = [];

  for (const r of recipients) {
    const phone = normalizePhone(r.phone);
    if (!phone) {
      failed.push({ phone: '(saknas)', error: 'Inget telefonnummer' });
      continue;
    }
    if (optOutSet.has(phone)) { optedOut++; continue; }

    let text = message.replace(/\{\{name\}\}/gi, (r.name || '').split(' ')[0] || '');
    if (includeOptOutLink && r.email) {
      const b64 = Buffer.from(phone).toString('base64');
      text += `\n\nAvanmäl: app.stodona.se/api/newsletter/optout?id=${b64}&type=SMS`;
    }

    const params = new URLSearchParams({
      login: 'apikey', password: apiKey, to: phone, text, from: fromName,
    });
    try {
      const res = await fetch(`${SURESMS_ENDPOINT}?${params.toString()}`);
      const body = await res.text();
      if (res.ok && !body.toLowerCase().includes('error')) {
        sent++;
      } else {
        failed.push({ phone, error: body.substring(0, 100) });
      }
    } catch (err: any) {
      failed.push({ phone, error: err?.message || 'network error' });
    }
  }

  return { sent, failed: failed.length, failedRecipients: failed, optedOut };
}
