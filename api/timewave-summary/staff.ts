import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getTimewaveToken, forceRefreshTimewaveToken } from '../_lib/timewaveAuth.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    let token = await getTimewaveToken();
    const timewaveBaseUrl = "https://api.timewave.se/v3";

    // Get all employees
    const empResp = await fetch(`${timewaveBaseUrl}/employees?page[size]=100`, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    });
    const empData = await empResp.json();
    const employees = empData.data || [];

    // Get current month missions
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const monthStart = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-01`;
    const monthEnd = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()}`;

    // Absence service IDs
    const absenceServiceIds = new Set([3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 26, 27, 28, 29, 30, 31, 34, 37, 39, 41, 42, 43, 44]);
    const sickServiceId = 3;

    // Per-employee tracking
    const empStats = new Map<number, { hours: number; revenue: number; sickDays: number; absenceDays: number; missions: number }>();
    employees.forEach((e: any) => empStats.set(e.id, { hours: 0, revenue: 0, sickDays: 0, absenceDays: 0, missions: 0 }));

    // Fetch all missions for month
    let page = 1;
    let totalPages = 1;
    while (page <= totalPages) {
      try {
        const url = `${timewaveBaseUrl}/missions?filter[startdate]=${monthStart}&filter[enddate]=${monthEnd}&page[size]=30&page[number]=${page}`;
        const resp = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } });
        if (resp.status === 403) {
          token = await forceRefreshTimewaveToken();
          page = 1;
          continue;
        }
        const data = await resp.json();
        totalPages = data.last_page || 1;

        for (const m of (data.data || [])) {
          const services = m.services || [];
          const serviceIds = services.map((s: any) => s.service_id || s.id);
          const isAbsence = serviceIds.length > 0 && serviceIds.every((id: number) => absenceServiceIds.has(id));
          const isSick = serviceIds.includes(sickServiceId);

          const missionRevenue = services.reduce((sum: number, s: any) => sum + (parseFloat(s.price) || 0), 0);

          for (const emp of (m.employees || [])) {
            const empId = emp.employee_id || emp.id;
            const stat = empStats.get(empId);
            if (!stat) continue;

            stat.missions++;
            if (isAbsence) {
              stat.absenceDays++;
              if (isSick) stat.sickDays++;
            } else {
              // Calculate hours
              if (emp.starttime && emp.endtime && !emp.cancelled) {
                const [sh, sm] = emp.starttime.split(':').map(Number);
                const [eh, em] = emp.endtime.split(':').map(Number);
                stat.hours += Math.max(0, ((eh * 60 + em) - (sh * 60 + sm)) / 60);
              }
              // Split revenue evenly among employees
              const empCount = (m.employees || []).filter((e: any) => !e.cancelled).length;
              stat.revenue += empCount > 0 ? missionRevenue / empCount : 0;
            }
          }
        }
        page++;
      } catch (err) {
        console.error(`Staff summary: error fetching page ${page}:`, err);
        break;
      }
    }

    // Calculate occupancy (assuming 160h work month)
    const workHoursPerMonth = 160;
    const staffList = employees
      .filter((e: any) => !e.deleted)
      .map((e: any) => {
        const stat = empStats.get(e.id) || { hours: 0, revenue: 0, sickDays: 0, absenceDays: 0, missions: 0 };
        return {
          id: e.id,
          name: `${e.first_name || ''} ${e.last_name || ''}`.trim(),
          phone: e.mobile || e.phone || '',
          email: e.email || '',
          status: e.status,
          startDate: e.employee_startdate,
          hours: Math.round(stat.hours * 10) / 10,
          revenue: Math.round(stat.revenue),
          sickDays: stat.sickDays,
          absenceDays: stat.absenceDays,
          missions: stat.missions,
          occupancy: Math.round((stat.hours / workHoursPerMonth) * 100),
        };
      })
      .sort((a: any, b: any) => b.hours - a.hours);

    res.json({
      employees: staffList,
      totalEmployees: staffList.length,
      totalHours: Math.round(staffList.reduce((s: number, e: any) => s + e.hours, 0)),
      avgOccupancy: staffList.length > 0 ? Math.round(staffList.reduce((s: number, e: any) => s + e.occupancy, 0) / staffList.length) : 0,
    });
  } catch (err: any) {
    console.error("Staff summary error:", err.message);
    res.status(500).json({ error: err.message });
  }
}
