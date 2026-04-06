import { prisma } from '../_lib/prisma.js';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getTimewaveCustomers } from '../_lib/timewaveData.js';

function getDaysUntilBirthday(personalNumber: string | null): number | null {
  if (!personalNumber) return null;
  // Format is usually YYYYMMDD-XXXX or YYMMDD-XXXX
  let pnr = personalNumber.replace(/[^0-9]/g, '');
  if (pnr.length !== 10 && pnr.length !== 12) return null;
  if (pnr.length === 12) pnr = pnr.substring(2); // Get YYMMDDXXXX

  const month = parseInt(pnr.substring(2, 4), 10) - 1; // 0-11
  const day = parseInt(pnr.substring(4, 6), 10);
  
  if (isNaN(month) || isNaN(day) || month < 0 || month > 11 || day < 1 || day > 31) {
    return null;
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  let nextBirthday = new Date(today.getFullYear(), month, day);
  
  // If birthday already passed this year, it's next year
  if (nextBirthday.getTime() < today.getTime()) {
    nextBirthday.setFullYear(today.getFullYear() + 1);
  }
  
  const diffTime = Math.abs(nextBirthday.getTime() - today.getTime());
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  
  return diffDays;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // 1. Verify Vercel Cron Secret for security
  if (
    process.env.NODE_ENV === 'production' &&
    req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`
  ) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const customers = await getTimewaveCustomers();
    const fromAddress = process.env.SMTP_FROM || process.env.SMTP_USER || 'info@stodona.se';
    const baseUrl = process.env.APP_URL || `https://${req.headers.host}`;

    let sentWelcome = 0;
    let sentBirthday = 0;

    // Load templates mapped by their Event triggers
    const welcomeTemplate = await prisma.automatedTemplate.findUnique({ where: { id: "welcome" } });
    const birthdayTemplate = await prisma.automatedTemplate.findUnique({ where: { id: "birthday" } });

    const now = new Date();
    
    // Process each customer individually
    for (const c of customers) {
      if (!c.email || !c.email.includes('@')) continue;

      // --- 1. BIRTHDAY AUTOMATION ---
      if (birthdayTemplate) {
        const daysToBirthday = getDaysUntilBirthday(c.personalNumber);
        
        // Target: Exactly 7 days until birthday
        if (daysToBirthday === 7) {
          // Check if already sent a birthday email THIS year
          const existingLog = await prisma.automationLog.findFirst({
            where: {
              customerId: c.id,
              templateId: 'birthday',
              sentAt: {
                gte: new Date(now.getFullYear(), 0, 1) // Since Jan 1st this year
              }
            }
          });

          if (!existingLog) {
            // Not sent this year! Let's send it.
            const subject = birthdayTemplate.subject;
            
            const html = `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f5f3ef;font-family:'Segoe UI',sans-serif;">
            <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f3ef;padding:32px 0;"><tr><td align="center">
            <table width="600" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.06);">
              <tr><td style="padding:40px 32px 0;">
                <img src="${baseUrl}/logotyp1.png" alt="Stodona" style="height:45px;width:auto;margin-bottom:24px;display:block;" />
                <h1>Hej ${c.name.split(' ')[0]}!</h1>
                <p>Vi på Stodona ser att du snart fyller år! 🎉</p>
                <p>Här är en liten present från oss.</p>
              </td></tr>
              <tr><td style="padding:24px 32px;background:#faf8f5;border-top:1px solid #eae4d9;text-align:center;">
                <p style="margin:0;font-size:12px;color:#999;">© ${new Date().getFullYear()} Stodona AB</p>
              </td></tr>
            </table></td></tr></table>
            </body></html>`;

            if (process.env.RESEND_API_KEY) {
              await fetch('https://api.resend.com/emails', {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ from: `"Stodona" <${fromAddress}>`, to: c.email, subject, html })
              });
            }

            // Log it
            await prisma.automationLog.create({
              data: { customerId: c.id, customerEmail: c.email, templateId: "birthday" }
            });
            sentBirthday++;
          }
        }
      }

      // --- 2. WELCOME EMAIL AUTOMATION ---
      if (welcomeTemplate) {
        // Customer created in the last 2 days
        const createdAtDate = new Date(c.createdAt);
        const diffMs = now.getTime() - createdAtDate.getTime();
        const diffDays = diffMs / (1000 * 60 * 60 * 24);

        if (diffDays <= 2) {
          // Check if welcome email was EVER sent to this customer
          const existingWelcome = await prisma.automationLog.findFirst({
            where: { customerId: c.id, templateId: 'welcome' }
          });

          if (!existingWelcome) {
            const subject = welcomeTemplate.subject;
            const html = `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f5f3ef;font-family:'Segoe UI',sans-serif;">
            <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f3ef;padding:32px 0;"><tr><td align="center">
            <table width="600" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.06);">
              <tr><td style="padding:40px 32px 0;">
                <img src="${baseUrl}/logotyp1.png" alt="Stodona" style="height:45px;width:auto;margin-bottom:24px;display:block;" />
                <h1>Välkommen ${c.name.split(' ')[0]}!</h1>
                <p>Vi är glada över att ha dig som kund hos Stodona.</p>
              </td></tr>
              <tr><td style="padding:24px 32px;background:#faf8f5;border-top:1px solid #eae4d9;text-align:center;">
                <p style="margin:0;font-size:12px;color:#999;">© ${new Date().getFullYear()} Stodona AB</p>
              </td></tr>
            </table></td></tr></table>
            </body></html>`;

            if (process.env.RESEND_API_KEY) {
              await fetch('https://api.resend.com/emails', {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ from: `"Stodona" <${fromAddress}>`, to: c.email, subject, html })
              });
            }

            await prisma.automationLog.create({
              data: { customerId: c.id, customerEmail: c.email, templateId: "welcome" }
            });
            sentWelcome++;
          }
        }
      }
    }

    return res.json({ 
      success: true, 
      scanned: customers.length, 
      sent: { welcome: sentWelcome, birthday: sentBirthday } 
    });

  } catch (err: any) {
    console.error("Cron Error:", err);
    return res.status(500).json({ error: "Automation failed to run" });
  }
}
