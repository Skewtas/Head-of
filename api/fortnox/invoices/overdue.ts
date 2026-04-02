import type { VercelRequest, VercelResponse } from '@vercel/node';
import { fortnoxFetch } from '../../_lib/fortnoxAuth.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const data = await fortnoxFetch("/invoices?filter=unpaidoverdue");
    const invoices = (data.Invoices || []).map((inv: any) => ({
      number: inv.DocumentNumber,
      customerName: inv.CustomerName,
      customerNumber: inv.CustomerNumber,
      total: inv.Total,
      balance: inv.Balance,
      dueDate: inv.DueDate,
      invoiceDate: inv.InvoiceDate,
      daysOverdue: Math.max(0, Math.floor((Date.now() - new Date(inv.DueDate).getTime()) / (1000 * 60 * 60 * 24))),
      ocr: inv.OCR,
      booked: inv.Booked,
      cancelled: inv.Cancelled,
      sent: inv.Sent,
    }));
    res.json({ invoices, count: invoices.length });
  } catch (err: any) {
    console.error("Fortnox overdue invoices error:", err.message);
    res.status(500).json({ error: err.message });
  }
}
