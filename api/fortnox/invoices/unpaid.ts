import type { VercelRequest, VercelResponse } from '@vercel/node';
import { fortnoxFetch } from '../../_lib/fortnoxAuth.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const data = await fortnoxFetch("/invoices?filter=unpaid");
    const invoices = (data.Invoices || []).map((inv: any) => ({
      number: inv.DocumentNumber,
      customerName: inv.CustomerName,
      total: inv.Total,
      balance: inv.Balance,
      dueDate: inv.DueDate,
      invoiceDate: inv.InvoiceDate,
      sent: inv.Sent,
    }));
    res.json({ invoices, count: invoices.length });
  } catch (err: any) {
    console.error("Fortnox unpaid invoices error:", err.message);
    res.status(500).json({ error: err.message });
  }
}
