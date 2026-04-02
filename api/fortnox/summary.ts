import type { VercelRequest, VercelResponse } from '@vercel/node';
import { fortnoxFetch } from '../_lib/fortnoxAuth.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const [overdueData, unpaidData, allData] = await Promise.all([
      fortnoxFetch("/invoices?filter=unpaidoverdue").catch(() => ({ Invoices: [] })),
      fortnoxFetch("/invoices?filter=unpaid").catch(() => ({ Invoices: [] })),
      fortnoxFetch("/invoices?filter=fullypaid&fromdate=" + new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0]).catch(() => ({ Invoices: [] })),
    ]);

    const overdueInvoices = (overdueData.Invoices || []).map((inv: any) => ({
      number: inv.DocumentNumber,
      customerName: inv.CustomerName,
      total: inv.Total,
      balance: inv.Balance,
      dueDate: inv.DueDate,
      daysOverdue: Math.max(0, Math.floor((Date.now() - new Date(inv.DueDate).getTime()) / (1000 * 60 * 60 * 24))),
    }));

    const unpaidInvoices = (unpaidData.Invoices || []).map((inv: any) => ({
      number: inv.DocumentNumber,
      customerName: inv.CustomerName,
      total: inv.Total,
      balance: inv.Balance,
      dueDate: inv.DueDate,
    }));

    const totalOverdue = overdueInvoices.reduce((s: number, i: any) => s + (i.balance || 0), 0);
    const totalUnpaid = unpaidInvoices.reduce((s: number, i: any) => s + (i.balance || 0), 0);
    const paidThisMonth = (allData.Invoices || []).reduce((s: number, i: any) => s + (i.Total || 0), 0);

    res.json({
      overdueCount: overdueInvoices.length,
      overdueTotal: Math.round(totalOverdue),
      overdueInvoices: overdueInvoices.sort((a: any, b: any) => b.daysOverdue - a.daysOverdue).slice(0, 20),
      unpaidCount: unpaidInvoices.length,
      unpaidTotal: Math.round(totalUnpaid),
      paidThisMonthTotal: Math.round(paidThisMonth),
    });
  } catch (err: any) {
    console.error("Fortnox summary error:", err.message);
    res.status(500).json({ error: err.message });
  }
}
