import { prisma } from '../_lib/prisma';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getTimewaveCustomers } from '../_lib/timewaveData';
import nodemailer from 'nodemailer';

const createSmtpTransport = () => {
  const host = process.env.SMTP_HOST || 'smtp.office365.com';
  const port = parseInt(process.env.SMTP_PORT || '587');
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (!user || !pass) return null;
  return nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
  });
};

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
    const transporter = createSmtpTransport();
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
            
            // Reconstruct HTML from blocks...
            // Note: Since Automations UI isn't built yet, we fallback to a simple render
            // In the future this will use the same html render engine as campaigns
            const html = `<!DOCTYPE html><html><body>
              <h1>Hej ${c.name.split(' ')[0]}!</h1>
              <p>Vi på Stodona ser att du snart fyller år! 🎉</p>
              <p>Här är en liten present från oss.</p>
            </body></html>`;

            if (transporter) {
              await transporter.sendMail({ from: `"Stodona" <${fromAddress}>`, to: c.email, subject, html });
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
            const html = `<!DOCTYPE html><html><body>
              <h1>Välkommen ${c.name.split(' ')[0]}!</h1>
              <p>Vi är glada över att ha dig som kund hos Stodona.</p>
            </body></html>`;

            if (transporter) {
              await transporter.sendMail({ from: `"Stodona" <${fromAddress}>`, to: c.email, subject, html });
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
