import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getTimewaveToken, forceRefreshTimewaveToken } from '../_lib/timewaveAuth.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const startDate = req.query.startDate as string;
  const endDate = req.query.endDate as string;
  
  if (!startDate || !endDate) {
    return res.status(400).json({ error: "startDate and endDate are required" });
  }

  const timewaveBaseUrl = "https://api.timewave.se/v3";

  try {
    let token = await getTimewaveToken();
    let allMissions: any[] = [];
    let page = 1;
    let lastPage = 1;

    // Build employee name lookup (only ~33 employees, single page)
    const employeeNames = new Map<number, string>();
    try {
      const empResp = await fetch(`${timewaveBaseUrl}/employees?page[size]=100`, {
        headers: { "Authorization": `Bearer ${token}`, "Accept": "application/json" }
      });
      if (empResp.ok) {
        const empData = await empResp.json();
        for (const e of (empData.data || [])) {
          const name = `${e.first_name || ''} ${e.last_name || ''}`.trim();
          if (e.id && name) employeeNames.set(e.id, name);
        }
      }
    } catch { /* ignore */ }

    // Fetch all pages
    while (page <= lastPage) {
      const url = `${timewaveBaseUrl}/missions?filter[startdate]=${startDate}&filter[enddate]=${endDate}&page[number]=${page}`;
      let response = await fetch(url, {
        headers: { "Authorization": `Bearer ${token}`, "Accept": "application/json" }
      });

      // Retry on 403
      if (response.status === 403) {
        token = await forceRefreshTimewaveToken();
        response = await fetch(url, {
          headers: { "Authorization": `Bearer ${token}`, "Accept": "application/json" }
        });
      }

      if (!response.ok) {
        throw new Error(`Timewave API error ${response.status}: ${await response.text()}`);
      }

      const data = await response.json();
      lastPage = data.last_page || 1;
      allMissions = allMissions.concat(data.data || []);
      console.log(`Timewave missions: fetched page ${page}/${lastPage} (${data.data?.length || 0} items)`);
      page++;
    }

    // Compute summary
    let totalHours = 0;
    let totalRevenueExVat = 0;

    let avgCalcHours = 0;
    let avgCalcRevenue = 0;

    const recurringPrivateClients = new Set<number>();
    const recurringCompanyClients = new Set<number>();
    const billableClientIds = new Set<number>();
    const uniqueWorkorderIds = new Set<number>();

    const absenceServiceIds = new Set([3, 7]);
    const nonBillableServiceIds = new Set([3, 7, 401]);
    const excludeFromAvgServiceIds = new Set([104, 108, 128, 276, 336, 423]);
    const followUpServiceId = 128;
    let followUpCount = 0;

    const sickLeaveByEmployee = new Map<number, { name: string; count: number }>();
    const revenueByClient = new Map<number, { name: string; revenue: number; type: string }>();

    const cityToTeam: Record<string, string> = {
      'ekerö': 'Team Ekerö',
      'stockholm': 'Team Sthlm City/Solna/Sundbyberg',
      'solna': 'Team Sthlm City/Solna/Sundbyberg',
      'sundbyberg': 'Team Sthlm City/Solna/Sundbyberg',
      'lidingö': 'Team Lidingö',
      'södertälje': 'Team Södertälje',
      'nacka': 'Team Nacka',
      'saltsjöbaden': 'Team Nacka',
      'saltsjö-boo': 'Team Nacka',
      'järfälla': 'Team Järfälla',
      'viksjö': 'Team Järfälla',
      'barkarby': 'Team Järfälla',
      'jakobsberg': 'Team Järfälla',
      'bromma': 'Team Sthlm City/Solna/Sundbyberg',
      'spånga': 'Team Järfälla',
      'hägersten': 'Team Sthlm City/Solna/Sundbyberg',
      'älvsjö': 'Team Sthlm City/Solna/Sundbyberg',
      'enskede': 'Team Sthlm City/Solna/Sundbyberg',
      'farsta': 'Team Nacka',
      'tyresö': 'Team Nacka',
      'huddinge': 'Team Södertälje',
      'tumba': 'Team Södertälje',
      'botkyrka': 'Team Södertälje',
      'haninge': 'Team Södertälje',
      'jordbro': 'Team Södertälje',
      'handen': 'Team Södertälje',
      'täby': 'Team Lidingö',
      'danderyd': 'Team Lidingö',
      'djursholm': 'Team Lidingö',
      'vallentuna': 'Team Lidingö',
      'upplands väsby': 'Team Järfälla',
      'kista': 'Team Järfälla',
      'sollentuna': 'Team Järfälla',
      'märsta': 'Team Järfälla',
    };
    const teamData = new Map<string, { hours: number; revenue: number }>();
    ['Team Ekerö', 'Team Sthlm City/Solna/Sundbyberg', 'Team Lidingö', 'Team Södertälje', 'Team Nacka', 'Team Järfälla'].forEach(t => {
      teamData.set(t, { hours: 0, revenue: 0 });
    });
    let onlineBookings = 0;

    allMissions.forEach((m: any) => {
      const services = m.services || [];
      const isAbsenceMission = services.length > 0 && services.every((svc: any) => absenceServiceIds.has(svc.id));
      const isExcludedFromAvg = services.length > 0 && services.every((svc: any) => excludeFromAvgServiceIds.has(svc.id));

      let missionRevenue = 0;
      services.forEach((svc: any) => {
        if (!nonBillableServiceIds.has(svc.id)) {
          const qty = Number(svc.quantity || 0);
          const price = Number(svc.price || 0);
          const discount = Number(svc.discount || 0);
          missionRevenue += qty * price * (1 - discount / 100);
        }
      });

      if (!isAbsenceMission) {
        let missionHours = 0;
        (m.employees || []).forEach((emp: any) => {
          if (emp.starttime && emp.endtime && !emp.cancelled) {
            const [sh, sm] = emp.starttime.split(':').map(Number);
            const [eh, em] = emp.endtime.split(':').map(Number);
            missionHours += Math.max(0, ((eh * 60 + em) - (sh * 60 + sm)) / 60);
          }
        });
        totalHours += missionHours;

        if (!isExcludedFromAvg && missionRevenue > 0) {
          avgCalcHours += missionHours;
          avgCalcRevenue += missionRevenue;
        }
      }

      totalRevenueExVat += missionRevenue;

      if (services.some((svc: any) => svc.id === followUpServiceId)) {
        followUpCount++;
      }

      if (services.some((svc: any) => svc.id === 3)) {
        (m.employees || []).forEach((emp: any) => {
          if (emp.id) {
            const name = employeeNames.get(emp.id) || `${emp.first_name || ''} ${emp.last_name || ''}`.trim() || `Anställd #${emp.id}`;
            const existing = sickLeaveByEmployee.get(emp.id);
            if (existing) {
              existing.count++;
            } else {
              sickLeaveByEmployee.set(emp.id, { name, count: 1 });
            }
          }
        });
      }

      if (m.type === 'reccurent' && m.client?.id) {
        if (m.client.type === 1 || (!m.client.companyname && m.client.type !== 2)) {
          recurringPrivateClients.add(m.client.id);
        } else {
          recurringCompanyClients.add(m.client.id);
        }
      }

      if (m.client?.id) {
        billableClientIds.add(m.client.id);
        const clientName = m.client.companyname
          ? m.client.companyname
          : `${m.client.first_name || ''} ${m.client.last_name || ''}`.trim() || `Kund #${m.client.id}`;
        const existing = revenueByClient.get(m.client.id);
        if (existing) {
          existing.revenue += missionRevenue;
        } else {
          revenueByClient.set(m.client.id, {
            name: clientName,
            revenue: missionRevenue,
            type: m.type || 'single'
          });
        }
      }

      if (m.workorder?.id) {
        uniqueWorkorderIds.add(m.workorder.id);
      }

      const clientCity = (m.client?.city || '').toLowerCase().trim();
      const teamName = cityToTeam[clientCity] || 'Övrigt';
      if (!isAbsenceMission) {
        let missionHoursForTeam = 0;
        (m.employees || []).forEach((emp: any) => {
          if (emp.starttime && emp.endtime && !emp.cancelled) {
            const [sh2, sm2] = emp.starttime.split(':').map(Number);
            const [eh2, em2] = emp.endtime.split(':').map(Number);
            missionHoursForTeam += Math.max(0, ((eh2 * 60 + em2) - (sh2 * 60 + sm2)) / 60);
          }
        });
        const teamEntry = teamData.get(teamName);
        if (teamEntry) {
          teamEntry.hours += missionHoursForTeam;
          teamEntry.revenue += missionRevenue;
        } else {
          const ovrigtEntry = teamData.get('Övrigt') || { hours: 0, revenue: 0 };
          ovrigtEntry.hours += missionHoursForTeam;
          ovrigtEntry.revenue += missionRevenue;
          teamData.set('Övrigt', ovrigtEntry);
        }
      }

      if (m.type !== 'reccurent' && m.client?.id) {
        onlineBookings++;
      }
    });

    const avgPricePerHour = avgCalcHours > 0 ? avgCalcRevenue / avgCalcHours : 0;

    // Fetch invoices for the target month
    let totalInvoicedNet = 0;
    try {
      const firstUrl = `${timewaveBaseUrl}/invoices?page[number]=1`;
      const firstResp = await fetch(firstUrl, {
        headers: { "Authorization": `Bearer ${token}`, "Accept": "application/json" }
      });
      const firstData = await firstResp.json();
      let invPage = firstData.last_page || 1;
      let foundMonth = false;

      while (invPage > 0) {
        const invUrl = `${timewaveBaseUrl}/invoices?page[number]=${invPage}`;
        const invResp = await fetch(invUrl, {
          headers: { "Authorization": `Bearer ${token}`, "Accept": "application/json" }
        });
        const invData = await invResp.json();
        const invoices = invData.data || [];

        let pageHasTargetMonth = false;
        for (const inv of invoices) {
          const invDate = inv.invoice_date || '';
          if (invDate >= startDate && invDate <= endDate && !inv.deleted && !inv.credited) {
            totalInvoicedNet += Number(inv.net_amount || 0);
            pageHasTargetMonth = true;
            foundMonth = true;
          }
        }

        if (foundMonth && !pageHasTargetMonth) break;
        if (invoices.length > 0 && invoices[0].invoice_date < startDate && !pageHasTargetMonth) break;

        invPage--;
        if (invPage <= 0) break;
      }
    } catch (err: any) {
      console.error("Error fetching invoices:", err.message);
    }

    let newWorkOrdersThisMonth = 0;
    try {
      const woIds = Array.from(uniqueWorkorderIds);
      const batchSize = 10;
      for (let i = 0; i < woIds.length; i += batchSize) {
        const batch = woIds.slice(i, i + batchSize);
        const results = await Promise.all(
          batch.map(async (woId) => {
            try {
              const woResp = await fetch(`${timewaveBaseUrl}/workorders/${woId}`, {
                headers: { "Authorization": `Bearer ${token}`, "Accept": "application/json" }
              });
              if (!woResp.ok) return null;
              const woData = await woResp.json();
              return woData?.data?.create_date || null;
            } catch { return null; }
          })
        );
        for (const createDate of results) {
          if (createDate && createDate >= startDate && createDate <= endDate) {
            newWorkOrdersThisMonth++;
          }
        }
      }
    } catch (err: any) {
      console.error("Error fetching workorders:", err.message);
    }

    const responseData: any = {
      totalJobs: allMissions.length,
      totalHours: Math.round(totalHours * 10) / 10,
      totalRevenueExVat: Math.round(totalRevenueExVat),
      totalInvoicedNet: Math.round(totalInvoicedNet),
      avgPricePerHour: Math.round(avgPricePerHour),
      recurringPrivateClients: recurringPrivateClients.size,
      recurringCompanyClients: recurringCompanyClients.size,
      billableClients: billableClientIds.size,
      newWorkOrdersThisMonth,
      followUpCount,
      sickLeaveThisMonth: Array.from(sickLeaveByEmployee.values())
        .sort((a, b) => b.count - a.count)
        .slice(0, 10),
      sickLeave3Months: [] as { name: string; count: number }[],
      topClients: Array.from(revenueByClient.values())
        .filter(c => c.revenue > 0)
        .sort((a, b) => b.revenue - a.revenue)
        .slice(0, 10)
        .map(c => ({ name: c.name, revenue: Math.round(c.revenue) })),
      bottomClients: Array.from(revenueByClient.values())
        .filter(c => c.revenue > 0)
        .sort((a, b) => a.revenue - b.revenue)
        .slice(0, 10)
        .map(c => ({ name: c.name, revenue: Math.round(c.revenue) })),
      newSingleClients: Array.from(revenueByClient.values()).filter(c => c.type !== 'reccurent').length,
      newRecurringClients: Array.from(revenueByClient.values()).filter(c => c.type === 'reccurent').length,
      onlineBookings,
      teamBreakdown: Array.from(teamData.entries()).map(([name, data]) => ({
        name,
        hours: Math.round(data.hours * 10) / 10,
        revenue: Math.round(data.revenue),
      })),
    };

    // 3-month sick leave
    try {
      const now = new Date(startDate);
      const pad = (n: number) => String(n).padStart(2, '0');
      const threeMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 2, 1);
      const threeMonthStart = `${threeMonthsAgo.getFullYear()}-${pad(threeMonthsAgo.getMonth() + 1)}-01`;

      if (threeMonthStart < startDate) {
        const sickLeave3m = new Map<number, { name: string; count: number }>();
        sickLeaveByEmployee.forEach((v, k) => sickLeave3m.set(k, { ...v }));

        let page3m = 1;
        let lastPage3m = 1;
        while (page3m <= lastPage3m) {
          const url3m = `${timewaveBaseUrl}/missions?filter[startdate]=${threeMonthStart}&filter[enddate]=${startDate}&page[number]=${page3m}`;
          const resp3m = await fetch(url3m, {
            headers: { "Authorization": `Bearer ${token}`, "Accept": "application/json" }
          });
          if (!resp3m.ok) break;
          const data3m = await resp3m.json();
          lastPage3m = data3m.last_page || 1;

          for (const m of (data3m.data || [])) {
            const svcs = m.services || [];
            if (svcs.some((s: any) => s.id === 3)) {
              for (const emp of (m.employees || [])) {
                if (emp.id) {
                  const name = employeeNames.get(emp.id) || `${emp.first_name || ''} ${emp.last_name || ''}`.trim() || `Anställd #${emp.id}`;
                  const existing = sickLeave3m.get(emp.id);
                  if (existing) {
                    existing.count++;
                  } else {
                    sickLeave3m.set(emp.id, { name, count: 1 });
                  }
                }
              }
            }
          }
          page3m++;
        }
        responseData.sickLeave3Months = Array.from(sickLeave3m.values())
          .sort((a, b) => b.count - a.count)
          .slice(0, 10);
      } else {
        responseData.sickLeave3Months = responseData.sickLeaveThisMonth;
      }
    } catch (err: any) {
      console.error("Error fetching 3-month sick leave:", err.message);
    }

    res.json(responseData);
  } catch (err: any) {
    console.error("Timewave summary error:", err.message);
    res.status(500).json({ error: "Failed to compute mission summary" });
  }
}
