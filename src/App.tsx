/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { Show, SignIn, UserButton } from '@clerk/react';
import {
  LayoutDashboard,
  Users,
  Star,
  UserCircle,
  AlertTriangle,
  TrendingUp,
  TrendingDown,
  Clock,
  Calendar,
  DollarSign,
  Briefcase,
  ThumbsDown,
  AlertCircle,
  ClipboardList,
  Mail,
  Search,
  Inbox,
  Send,
  File,
  Archive,
  CalendarDays,
  Smile,
  Meh,
  Frown,
  Image as ImageIcon,
  RefreshCw
} from 'lucide-react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer
} from 'recharts';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { timewaveService } from './services/timewaveService';
import DispatchBoard from './DispatchBoard';

// Utility for Tailwind classes
function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// --- MOCK DATA ---
const yearGoals = [
  { metric: "Fakturerad försäljning", goal: 10000000, actual: 8500000, unit: "kr" },
  { metric: "Bokningar online", goal: 500, actual: 420, unit: "st" },
  { metric: "Snittpris", goal: 550, actual: 520, unit: "kr/h" },
  { metric: "Återkommande priv kunder", goal: 300, actual: 280, unit: "st" },
  { metric: "Återkommande ftg kunder", goal: 50, actual: 45, unit: "st" },
  { metric: "Personalbas", goal: 20, actual: 18, unit: "st" },
  { metric: "Churn", goal: 5, actual: 6, unit: "%", reverse: true },
  { metric: "Beläggningsgrad", goal: 85, actual: 82, unit: "%" },
];

const monthGoals = [
  { metric: "Fakturerad försäljning", goal: 850000, actual: 800000, unit: "kr" },
  { metric: "Bokningar online", goal: 50, actual: 45, unit: "st" },
  { metric: "Snittpris", goal: 550, actual: 530, unit: "kr/h" },
  { metric: "Återkommande kunder", goal: 350, actual: 325, unit: "st" },
  { metric: "Personal bas", goal: 20, actual: 18, unit: "st" },
  { metric: "Beambop", goal: 4.5, actual: 4.6, unit: "⭐" },
  { metric: "Churn", goal: 5, actual: 4, unit: "%", reverse: true },
  { metric: "Beläggningsgrad", goal: 85, actual: 80, unit: "%" },
];

const weekGoals = [
  { metric: "Fakturerad försäljning", goal: 200000, actual: 195000, unit: "kr" },
  { metric: "Bokningar online", goal: 12, actual: 15, unit: "st" },
  { metric: "Snittpris", goal: 550, actual: 540, unit: "kr/h" },
  { metric: "Återkommande kunder", goal: 350, actual: 325, unit: "st" },
  { metric: "Personal bas", goal: 20, actual: 18, unit: "st" },
  { metric: "Beambop", goal: 4.5, actual: 4.7, unit: "⭐" },
  { metric: "Churn", goal: 100, actual: 100, unit: "%", reverse: true },
  { metric: "Beläggningsgrad", goal: 85, actual: 82, unit: "%" },
];

const customers = {
  active: 450,
  newSingle: 15,
  newRecurring: 8,
  incomingTickets: 12
};

const topCustomers = [
  { name: "Företag AB", revenue: 150000 },
  { name: "Bostadsrättsförening Solen", revenue: 120000 },
  { name: "Kontorshotell City", revenue: 95000 },
  { name: "Bygg & Fix AB", revenue: 80000 },
  { name: "Restaurang Matglädje", revenue: 65000 },
  { name: "Familjen Andersson", revenue: 45000 },
  { name: "Svensson IT", revenue: 40000 },
  { name: "Klinik Hälsan", revenue: 35000 },
  { name: "Bageri Bullen", revenue: 30000 },
  { name: "Familjen Lind", revenue: 25000 },
];

const bottomCustomers = [
  { name: "Studentkorridor 1", revenue: 500 },
  { name: "Kalle K", revenue: 600 },
  { name: "Lilla Kiosken", revenue: 800 },
  { name: "Anna S", revenue: 900 },
  { name: "Pelle P", revenue: 1000 },
  { name: "Förening X", revenue: 1100 },
  { name: "Gymmet", revenue: 1200 },
  { name: "Lisa L", revenue: 1300 },
  { name: "Micke M", revenue: 1400 },
  { name: "Sara S", revenue: 1500 },
];

const staffUnderOccupancy = [
  { name: "Erik Eriksson", occupancy: 65, goal: 85 },
  { name: "Maria Nilsson", occupancy: 70, goal: 85 },
  { name: "Johan Persson", occupancy: 75, goal: 85 },
];

const staffTopBeambop = [
  { name: "Anna Andersson", rating: 4.9 },
  { name: "Lars Larsson", rating: 4.8 },
  { name: "Karin Karlsson", rating: 4.8 },
  { name: "Sven Svensson", rating: 4.7 },
  { name: "Eva Evasson", rating: 4.7 },
];

const sickLeaveList = [
  { name: "Per Persson", days: 3, period: "Januari" },
  { name: "Mia Miasson", days: 2, period: "Januari" },
];

const actionListMinusCustomers = [
  { name: "Projekt X", margin: "-5000 kr", reason: "För många timmar lagda" },
  { name: "Städ AB", margin: "-1200 kr", reason: "Felprissatt" },
];

const actionListHighSickLeave = [
  { name: "Olle Olsson", occasions: 4, totalDays: 12 },
  { name: "Stina Stinasson", occasions: 3, totalDays: 8 },
];

const actionListComplaints = [
  { name: "Erik Eriksson", complaints: 2, details: "Missade fönster, sen ankomst" },
];

const actionListOverdueInvoices = [
  { invoiceNo: "INV-2024-001", customer: "Slarv AB", amount: "15000 kr", daysOverdue: 45 },
  { invoiceNo: "INV-2024-042", customer: "Kalle K", amount: "2500 kr", daysOverdue: 12 },
  { invoiceNo: "INV-2024-055", customer: "Förening X", amount: "8000 kr", daysOverdue: 5 },
];

const salesData = [
  { name: 'Jan', actual: 800000, goal: 850000 },
  { name: 'Feb', actual: 820000, goal: 850000 },
  { name: 'Mar', actual: 880000, goal: 850000 },
  { name: 'Apr', actual: 850000, goal: 850000 },
  { name: 'Maj', actual: 900000, goal: 850000 },
  { name: 'Jun', actual: 950000, goal: 850000 },
];

// --- COMPONENTS ---

const Card = ({ children, className }: { children: React.ReactNode; className?: string }) => (
  <div className={cn("bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden", className)}>
    {children}
  </div>
);

const CardHeader = ({ title, icon: Icon, action }: { title: string; icon?: any; action?: React.ReactNode }) => (
  <div className="px-6 py-5 border-b border-gray-100 flex items-center justify-between bg-white">
    <div className="flex items-center gap-2.5">
      {Icon && <Icon className="w-5 h-5 text-rose-400" />}
      <h3 className="font-semibold text-gray-800 tracking-tight">{title}</h3>
    </div>
    {action && <div>{action}</div>}
  </div>
);

const CardContent = ({ children, className }: { children: React.ReactNode; className?: string }) => (
  <div className={cn("p-6", className)}>
    {children}
  </div>
);

const ProgressBar = ({ value, max, reverse = false }: { value: number; max: number; reverse?: boolean }) => {
  const percentage = Math.min(100, Math.max(0, (value / max) * 100));

  let colorClass = "bg-rose-500";
  if (reverse) {
    if (percentage > 100) colorClass = "bg-[#FF6B6B]";
    else if (percentage > 80) colorClass = "bg-[#FF6B6B]";
    else colorClass = "bg-[#A8E6CF]";
  } else {
    if (percentage >= 100) colorClass = "bg-[#A8E6CF]";
    else if (percentage >= 80) colorClass = "bg-[#FF6B6B]";
    else colorClass = "bg-[#FF6B6B]";
  }

  return (
    <div className="h-2 w-full bg-gray-100 rounded-full overflow-hidden">
      <div
        className={cn("h-full transition-all duration-500", colorClass)}
        style={{ width: `${percentage}%` }}
      />
    </div>
  );
};

const GoalRow = ({ item }: { item: any; key?: React.Key }) => {
  const isPercentage = item.unit === "%";
  const isCurrency = item.unit === "kr";

  const formatValue = (val: number) => {
    if (isCurrency) return new Intl.NumberFormat('sv-SE').format(val) + ' ' + item.unit;
    return val + (item.unit !== "st" && !isPercentage ? ' ' + item.unit : item.unit === "st" ? ' st' : '%');
  };

  const isGood = item.reverse ? item.actual <= item.goal : item.actual >= item.goal;
  const diff = item.actual - item.goal;
  const diffFormatted = (diff > 0 ? '+' : '') + formatValue(diff);

  return (
    <div className="flex flex-col py-4 border-b border-gray-50 last:border-0">
      <div className="flex justify-between items-start mb-2">
        <div>
          <span className="text-sm font-medium text-gray-700 block">{item.metric}</span>
          <span className="text-[10px] text-gray-400 font-medium uppercase tracking-wider mt-0.5 block">
            BOKAD FÖRSÄLJNING: {new Intl.NumberFormat('sv-SE').format(item.bookedSales || 125000)} kr
          </span>
        </div>
        <div className="flex items-center gap-3 mt-0.5">
          <span className="text-xs text-gray-400 font-medium">Mål: {formatValue(item.goal)}</span>
          <span className={cn("text-sm font-bold", isGood ? "text-[#A8E6CF]" : "text-[#FF6B6B]")}>
            {formatValue(item.actual)}
          </span>
        </div>
      </div>
      <div className="flex items-center gap-4">
        <div className="flex-1">
          <ProgressBar value={item.actual} max={item.goal} reverse={item.reverse} />
        </div>
        <span className="text-xs font-medium text-gray-500 w-16 text-right">
          {diffFormatted}
        </span>
      </div>
    </div>
  );
};

const GoalList = ({ title, data, icon }: { title: string; data: any[]; icon: any }) => (
  <Card>
    <CardHeader title={title} icon={icon} />
    <CardContent className="p-0 px-6 py-2">
      {data.map((item, idx) => (
        <GoalRow key={idx} item={item} />
      ))}
    </CardContent>
  </Card>
);

const recentFeedback = [
  { id: 1, customer: 'Kund 12 AB', cleaner: 'Luisa', rating: 'GREEN', comment: 'Fantastiskt jobb, väldigt nöjd! Doftade ljuvligt när vi kom hem.', images: [], time: 'Idag 14:30' },
  { id: 2, customer: 'Kund 8 AB', cleaner: 'Johan', rating: 'YELLOW', comment: 'Bra, men missade lite damm på listen i hallen.', images: ['/placeholder'], time: 'Igår 16:15' },
  { id: 3, customer: 'Kund 3 AB', cleaner: 'Anna', rating: 'RED', comment: 'Golvet var fortfarande fläckigt i köket och soporna var inte tömda.', images: ['/placeholder', '/placeholder'], time: 'Igår 09:00' },
  { id: 4, customer: 'Kund 19 AB', cleaner: 'Erik', rating: 'ORANGE', comment: 'Sen ankomst och slarvigt i badrummet. Förväntade mig mer.', images: [], time: '2 dagar sen' },
  { id: 5, customer: 'Kund 5 AB', cleaner: 'Elvedina', rating: 'GREEN', comment: 'Alltid lika skinande rent! Tack!', images: [], time: '2 dagar sen' },
];

// --- VIEWS ---

const OverviewView = () => {
  const [stats, setStats] = React.useState({
    customers: 0,
    employees: 0,
    missions: 0,
    issues: 0,
    salesData: salesData,
    isLoading: true
  });

  React.useEffect(() => {
    const fetchStats = async () => {
      try {
        const [customersRes, employeesRes, missionsRes, issuesRes, invoicesRes] = await Promise.all([
          timewaveService.getCustomers().catch(() => ({ data: [], total: 0 })),
          timewaveService.getEmployees().catch(() => ({ data: [], total: 0 })),
          timewaveService.getSchedule(
            new Date().toISOString().split('T')[0],
            new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
          ).catch(() => ({ data: [], total: 0 })),
          timewaveService.getIssues().catch(() => ({ data: [], total: 0 })),
          timewaveService.getSalesData().catch(() => ({ data: [], total: 0 }))
        ]);

        let updatedSalesData = [...salesData];
        if (invoicesRes?.data?.length > 0) {
          const monthlySales: Record<string, number> = {};
          invoicesRes.data.forEach((inv: any) => {
            const dateStr = inv.date || inv.invoice_date || inv.created_at;
            if (dateStr) {
              const d = new Date(dateStr);
              // Ensure Swedish locale short month (e.g., 'jan', 'feb') to match mock data
              let month = d.toLocaleString('sv-SE', { month: 'short' }).replace('.', '');
              const amount = Number(inv.total_amount || inv.sum || inv.total || 0);
              monthlySales[month.toLowerCase()] = (monthlySales[month.toLowerCase()] || 0) + amount;
            }
          });

          updatedSalesData = updatedSalesData.map(item => {
            const val = monthlySales[item.name.toLowerCase()];
            return {
              ...item,
              actual: val !== undefined ? val : item.actual
            };
          });
        }

        setStats({
          customers: customersRes?.total || customersRes?.data?.length || 0,
          employees: employeesRes?.total || employeesRes?.data?.length || 0,
          missions: missionsRes?.total || missionsRes?.data?.length || 0,
          issues: issuesRes?.total || issuesRes?.data?.length || 0,
          salesData: updatedSalesData,
          isLoading: false
        });
      } catch (error) {
        console.error("Failed to fetch overview stats", error);
        setStats(s => ({ ...s, ...{ isLoading: false } }));
      }
    };

    fetchStats();
  }, []);

  return (
    <div className="space-y-6">
      <div className="flex justify-center py-[40px]">
        <img src="/logotyp1.png" alt="Städona Logo" className="w-full max-w-[180px] h-auto" />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
        <a href="https://timewave.se" target="_blank" rel="noopener noreferrer" className="flex items-center justify-center h-14 bg-[#faf8f5] border border-[#eae4d9] rounded-2xl text-sm font-bold text-[#5c5750] tracking-widest uppercase shadow-sm transition-all duration-300 hover:-translate-y-0.5 hover:shadow-md hover:bg-white hover:border-[#d6cebf] hover:text-[#3d3935]">
          TIMEWAVE
        </a>
        <a href="https://fortnox.se" target="_blank" rel="noopener noreferrer" className="flex items-center justify-center h-14 bg-[#faf8f5] border border-[#eae4d9] rounded-2xl text-sm font-bold text-[#5c5750] tracking-widest uppercase shadow-sm transition-all duration-300 hover:-translate-y-0.5 hover:shadow-md hover:bg-white hover:border-[#d6cebf] hover:text-[#3d3935]">
          FORTNOX
        </a>
        <a href="https://beambop.com" target="_blank" rel="noopener noreferrer" className="flex items-center justify-center h-14 bg-[#faf8f5] border border-[#eae4d9] rounded-2xl text-sm font-bold text-[#5c5750] tracking-widest uppercase shadow-sm transition-all duration-300 hover:-translate-y-0.5 hover:shadow-md hover:bg-white hover:border-[#d6cebf] hover:text-[#3d3935]">
          BEAMBOP
        </a>
        <a href="https://skatteverket.se" target="_blank" rel="noopener noreferrer" className="flex items-center justify-center h-14 bg-[#faf8f5] border border-[#eae4d9] rounded-2xl text-sm font-bold text-[#5c5750] tracking-widest uppercase shadow-sm transition-all duration-300 hover:-translate-y-0.5 hover:shadow-md hover:bg-white hover:border-[#d6cebf] hover:text-[#3d3935]">
          SKATTEVERKET
        </a>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4 flex flex-col items-center justify-center text-center">
            <div className="text-2xl font-light text-gray-900 mb-1">
              {stats.isLoading ? <RefreshCw className="w-6 h-6 animate-spin text-gray-400 mx-auto" /> : stats.customers || '1.2M'}
            </div>
            <div className="text-[10px] text-gray-500 uppercase tracking-wider font-medium">Aktiva Kunder</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex flex-col items-center justify-center text-center">
            <div className="text-2xl font-light text-gray-900 mb-1">
              {stats.isLoading ? <RefreshCw className="w-6 h-6 animate-spin text-gray-400 mx-auto" /> : stats.employees || '4.6'}
            </div>
            <div className="text-[10px] text-gray-500 uppercase tracking-wider font-medium">Anställda</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex flex-col items-center justify-center text-center">
            <div className="text-2xl font-light text-gray-900 mb-1 text-rose-500">
              {stats.isLoading ? <RefreshCw className="w-6 h-6 animate-spin text-gray-400 mx-auto" /> : stats.missions || '3'}
            </div>
            <div className="text-[10px] text-gray-500 uppercase tracking-wider font-medium">Jobb Denna Vecka</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex flex-col items-center justify-center text-center">
            <div className="text-2xl font-light text-gray-900 mb-1 text-amber-500">
              {stats.isLoading ? <RefreshCw className="w-6 h-6 animate-spin text-gray-400 mx-auto" /> : stats.issues || '12'}
            </div>
            <div className="text-[10px] text-gray-500 uppercase tracking-wider font-medium">Öppna Ärenden</div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader title="Fakturerad försäljning vs Mål" icon={TrendingUp} />
          <CardContent className="h-80">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={stats.salesData} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f0f0f0" />
                <XAxis dataKey="name" axisLine={false} tickLine={false} />
                <YAxis axisLine={false} tickLine={false} tickFormatter={(value) => `${value / 1000}k`} />
                <Tooltip
                  formatter={(value: number) => new Intl.NumberFormat('sv-SE').format(value) + ' kr'}
                  cursor={{ fill: '#f9fafb' }}
                />
                <Bar dataKey="actual" name="Utfall" fill="#e11d48" radius={[4, 4, 0, 0]} />
                <Bar dataKey="goal" name="Mål" fill="#e5e7eb" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader title="Senaste Kundfeedback" icon={Star} />
          <CardContent className="p-0">
            <div className="divide-y divide-gray-100">
              {recentFeedback.slice(0, 3).map((fb) => (
                <div key={fb.id} className="p-5 hover:bg-gray-50/50 transition-colors">
                  <div className="flex justify-between items-start mb-2">
                    <div className="flex items-center gap-3">
                      {fb.rating === 'GREEN' && <Smile className="w-6 h-6 text-emerald-500" />}
                      {fb.rating === 'YELLOW' && <Smile className="w-6 h-6 text-yellow-400" />}
                      {fb.rating === 'ORANGE' && <Meh className="w-6 h-6 text-orange-500" />}
                      {fb.rating === 'RED' && <Frown className="w-6 h-6 text-rose-500" />}
                      <div>
                        <div className="font-bold text-gray-900 text-sm">{fb.customer}</div>
                        <div className="text-xs text-gray-500">Städare: {fb.cleaner}</div>
                      </div>
                    </div>
                    <span className="text-xs font-medium text-gray-400">{fb.time}</span>
                  </div>
                  <p className="text-sm text-gray-700 mt-2 line-clamp-2">
                    "{fb.comment}"
                  </p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

const CustomersView = () => {
  const [stats, setStats] = React.useState({
    active: 0,
    newSingle: 15,
    newRecurring: 8,
    incomingTickets: 0,
    isLoading: true
  });

  React.useEffect(() => {
    const fetchCustomersAndTickets = async () => {
      try {
        const [customersRes, issuesRes] = await Promise.all([
          timewaveService.getCustomers().catch(() => ({ data: [], total: 0 })),
          timewaveService.getIssues().catch(() => ({ data: [], total: 0 }))
        ]);

        setStats({
          active: customersRes?.total || customersRes?.data?.length || 0,
          newSingle: 15, // Mock data kept for now
          newRecurring: 8, // Mock data kept for now
          incomingTickets: issuesRes?.total || issuesRes?.data?.length || 0,
          isLoading: false
        });
      } catch (error) {
        console.error("Failed to fetch customer stats", error);
        setStats(s => ({ ...s, isLoading: false }));
      }
    };
    fetchCustomersAndTickets();
  }, []);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-8">
            <Users className="w-10 h-10 text-rose-500 mb-4" />
            <div className="text-4xl font-light text-gray-900 mb-1">
              {stats.isLoading ? <RefreshCw className="w-8 h-8 animate-spin text-gray-400 mx-auto" /> : stats.active}
            </div>
            <div className="text-sm text-gray-500 uppercase tracking-wider font-medium">Aktiva Kunder</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-8">
            <UserCircle className="w-10 h-10 text-emerald-500 mb-4" />
            <div className="text-4xl font-light text-gray-900 mb-1">
              {stats.newSingle} <span className="text-lg text-gray-400">/ {stats.newRecurring}</span>
            </div>
            <div className="text-sm text-gray-500 uppercase tracking-wider font-medium text-center">
              Nya Kunder<br /><span className="text-xs normal-case">(Enstaka / Återkommande)</span>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-8">
            <AlertCircle className="w-10 h-10 text-amber-500 mb-4" />
            <div className="text-4xl font-light text-gray-900 mb-1">
              {stats.isLoading ? <RefreshCw className="w-8 h-8 animate-spin text-gray-400 mx-auto" /> : stats.incomingTickets}
            </div>
            <div className="text-sm text-gray-500 uppercase tracking-wider font-medium text-center">
              Inkommande Ärenden<br /><span className="text-xs normal-case">(Kundportalen)</span>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader title="Topp 10 Kunder (Intäkt)" icon={TrendingUp} />
          <CardContent className="p-0">
            <table className="w-full text-sm text-left">
              <thead className="text-xs text-gray-500 uppercase bg-gray-50">
                <tr>
                  <th className="px-6 py-3">Kund</th>
                  <th className="px-6 py-3 text-right">Intäkt</th>
                </tr>
              </thead>
              <tbody>
                {topCustomers.map((c, i) => (
                  <tr key={i} className="border-b border-gray-50 hover:bg-gray-50/50">
                    <td className="px-6 py-3 font-medium text-gray-900">{i + 1}. {c.name}</td>
                    <td className="px-6 py-3 text-right">{new Intl.NumberFormat('sv-SE').format(c.revenue)} kr</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
        <Card>
          <CardHeader title="Botten 10 Kunder (Intäkt)" icon={TrendingDown} />
          <CardContent className="p-0">
            <table className="w-full text-sm text-left">
              <thead className="text-xs text-gray-500 uppercase bg-gray-50">
                <tr>
                  <th className="px-6 py-3">Kund</th>
                  <th className="px-6 py-3 text-right">Intäkt</th>
                </tr>
              </thead>
              <tbody>
                {bottomCustomers.map((c, i) => (
                  <tr key={i} className="border-b border-gray-50 hover:bg-gray-50/50">
                    <td className="px-6 py-3 font-medium text-gray-900">{i + 1}. {c.name}</td>
                    <td className="px-6 py-3 text-right">{new Intl.NumberFormat('sv-SE').format(c.revenue)} kr</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

const QualityView = () => (
  <div className="space-y-6">
    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-8">
          <Star className="w-10 h-10 text-amber-400 mb-4 fill-amber-400" />
          <div className="text-4xl font-light text-gray-900 mb-1">4.6 <span className="text-lg text-gray-400">/ 5.0</span></div>
          <div className="text-sm text-gray-500 uppercase tracking-wider font-medium">Snittbetyg Beambop</div>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-8">
          <Briefcase className="w-10 h-10 text-rose-500 mb-4" />
          <div className="text-4xl font-light text-gray-900 mb-1">8</div>
          <div className="text-sm text-gray-500 uppercase tracking-wider font-medium">Follow up cleaning</div>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-8">
          <ThumbsDown className="w-10 h-10 text-red-500 mb-4" />
          <div className="text-4xl font-light text-gray-900 mb-1">3</div>
          <div className="text-sm text-gray-500 uppercase tracking-wider font-medium text-center">
            Röda/Orange Kunder<br /><span className="text-xs normal-case">(Missnöjda - Beambop)</span>
          </div>
        </CardContent>
      </Card>
    </div>

    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <Card>
        <CardHeader title="Senaste Kundfeedback (Beambop)" icon={Star} />
        <CardContent className="p-0">
          <div className="divide-y divide-gray-100">
            {recentFeedback.map((fb) => (
              <div key={fb.id} className="p-5 hover:bg-gray-50/50 transition-colors">
                <div className="flex justify-between items-start mb-2">
                  <div className="flex items-center gap-3">
                    {fb.rating === 'GREEN' && <Smile className="w-8 h-8 text-emerald-500" />}
                    {fb.rating === 'YELLOW' && <Smile className="w-8 h-8 text-yellow-400" />}
                    {fb.rating === 'ORANGE' && <Meh className="w-8 h-8 text-orange-500" />}
                    {fb.rating === 'RED' && <Frown className="w-8 h-8 text-rose-500" />}
                    <div>
                      <div className="font-bold text-gray-900 text-sm">{fb.customer}</div>
                      <div className="text-xs text-gray-500">Städare: {fb.cleaner}</div>
                    </div>
                  </div>
                  <span className="text-xs font-medium text-gray-400">{fb.time}</span>
                </div>
                <p className="text-sm text-gray-700 mt-3 bg-white border border-gray-100 p-3 rounded-xl shadow-sm">
                  "{fb.comment}"
                </p>
                {fb.images.length > 0 && (
                  <div className="flex gap-2 mt-3">
                    {fb.images.map((img, idx) => (
                      <div key={idx} className="w-16 h-16 rounded-lg bg-gray-100 border border-gray-200 flex items-center justify-center text-gray-400">
                        <ImageIcon className="w-6 h-6 opacity-50" />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader title="Topplista Beambop (Topp 10 Personal)" icon={Star} />
        <CardContent className="p-0">
          <table className="w-full text-sm text-left">
            <thead className="text-xs text-gray-500 uppercase bg-gray-50">
              <tr>
                <th className="px-6 py-3">Personal</th>
                <th className="px-6 py-3 text-right">Betyg</th>
              </tr>
            </thead>
            <tbody>
              {staffTopBeambop.map((s, i) => (
                <tr key={i} className="border-b border-gray-50 hover:bg-gray-50/50">
                  <td className="px-6 py-3 font-medium text-gray-900">{i + 1}. {s.name}</td>
                  <td className="px-6 py-3 text-right flex items-center justify-end gap-1">
                    {s.rating} <Star className="w-4 h-4 text-amber-400 fill-amber-400" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  </div>
);

const StaffView = () => {
  const [stats, setStats] = React.useState({
    totalStaff: 0,
    incomingTickets: 0,
    isLoading: true
  });

  React.useEffect(() => {
    const fetchStaffStats = async () => {
      try {
        const [employeesRes, issuesRes, customersRes] = await Promise.all([
          timewaveService.getEmployees().catch(() => ({ data: [], total: 0 })),
          timewaveService.getIssues().catch(() => ({ data: [], total: 0 })),
          timewaveService.getCustomers().catch(() => ({ data: [], total: 0 }))
        ]);

        const activeEmployees = employeesRes?.total || employeesRes?.data?.length || 0;
        const activeCustomers = customersRes?.total || customersRes?.data?.length || 0;

        let avgCustomersPerStaff = 0;
        if (activeEmployees > 0) {
          avgCustomersPerStaff = Math.round(activeCustomers / activeEmployees);
        }

        setStats({
          totalStaff: activeEmployees,
          avgCustomersPerStaff: avgCustomersPerStaff || 18, // Fallback if 0
          incomingTickets: issuesRes?.total || issuesRes?.data?.length || 0,
          isLoading: false
        });
      } catch (error) {
        console.error("Failed to fetch staff stats", error);
        setStats(s => ({ ...s, isLoading: false }));
      }
    };
    fetchStaffStats();
  }, []);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card>
          <CardHeader title="Låg Beläggningsgrad" icon={AlertTriangle} />
          <CardContent className="p-0">
            <table className="w-full text-sm text-left">
              <thead className="text-xs text-gray-500 uppercase bg-gray-50">
                <tr>
                  <th className="px-6 py-3">Personal</th>
                  <th className="px-6 py-3 text-right">Beläggning (Mål: 85%)</th>
                </tr>
              </thead>
              <tbody>
                {staffUnderOccupancy.map((s, i) => (
                  <tr key={i} className="border-b border-gray-50 hover:bg-gray-50/50">
                    <td className="px-6 py-3 font-medium text-gray-900">{s.name}</td>
                    <td className="px-6 py-3 text-right text-[#FF6B6B] font-medium">{s.occupancy}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader title="Sjukfrånvaro" icon={AlertCircle} />
          <CardContent className="p-0">
            <table className="w-full text-sm text-left">
              <thead className="text-xs text-gray-500 uppercase bg-gray-50">
                <tr>
                  <th className="px-6 py-3">Personal</th>
                  <th className="px-6 py-3">Period</th>
                  <th className="px-6 py-3 text-right">Dagar</th>
                </tr>
              </thead>
              <tbody>
                {sickLeaveList.map((s, i) => (
                  <tr key={i} className="border-b border-gray-50 hover:bg-gray-50/50">
                    <td className="px-6 py-3 font-medium text-gray-900">{s.name}</td>
                    <td className="px-6 py-3 text-gray-500">{s.period}</td>
                    <td className="px-6 py-3 text-right">{s.days}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-8">
            <Users className="w-10 h-10 text-rose-500 mb-4" />
            <div className="text-4xl font-light text-gray-900 mb-1">
              {stats.isLoading ? <RefreshCw className="w-8 h-8 animate-spin text-gray-400 mx-auto" /> : stats.avgCustomersPerStaff}
            </div>
            <div className="text-sm text-gray-500 uppercase tracking-wider font-medium">Snitt kunder per personal</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-8">
            <AlertCircle className="w-10 h-10 text-amber-500 mb-4" />
            <div className="text-4xl font-light text-gray-900 mb-1">
              {stats.isLoading ? <RefreshCw className="w-8 h-8 animate-spin text-gray-400 mx-auto" /> : stats.incomingTickets}
            </div>
            <div className="text-sm text-gray-500 uppercase tracking-wider font-medium text-center">
              Inkommande Ärenden<br /><span className="text-xs normal-case">(Från personal via appen)</span>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

const ActionListView = () => (
  <div className="space-y-6">
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <Card>
        <CardHeader title="Kunder som går minus" icon={TrendingDown} />
        <CardContent className="p-0">
          <table className="w-full text-sm text-left">
            <thead className="text-xs text-gray-500 uppercase bg-gray-50">
              <tr>
                <th className="px-6 py-3">Kund/Projekt</th>
                <th className="px-6 py-3">Orsak</th>
                <th className="px-6 py-3 text-right">Marginal</th>
              </tr>
            </thead>
            <tbody>
              {actionListMinusCustomers.map((c, i) => (
                <tr key={i} className="border-b border-gray-50 hover:bg-gray-50/50">
                  <td className="px-6 py-3 font-medium text-gray-900">{c.name}</td>
                  <td className="px-6 py-3 text-gray-500">{c.reason}</td>
                  <td className="px-6 py-3 text-right text-[#FF6B6B] font-medium">{c.margin}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader title="Hög sjukfrånvaro (senaste 4 mån)" icon={AlertCircle} />
        <CardContent className="p-0">
          <table className="w-full text-sm text-left">
            <thead className="text-xs text-gray-500 uppercase bg-gray-50">
              <tr>
                <th className="px-6 py-3">Personal</th>
                <th className="px-6 py-3 text-center">Tillfällen</th>
                <th className="px-6 py-3 text-right">Totalt Dagar</th>
              </tr>
            </thead>
            <tbody>
              {actionListHighSickLeave.map((s, i) => (
                <tr key={i} className="border-b border-gray-50 hover:bg-gray-50/50">
                  <td className="px-6 py-3 font-medium text-gray-900">{s.name}</td>
                  <td className="px-6 py-3 text-center">{s.occasions}</td>
                  <td className="px-6 py-3 text-right">{s.totalDays}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader title="Personal med klagomål (Beambop)" icon={ThumbsDown} />
        <CardContent className="p-0">
          <table className="w-full text-sm text-left">
            <thead className="text-xs text-gray-500 uppercase bg-gray-50">
              <tr>
                <th className="px-6 py-3">Personal</th>
                <th className="px-6 py-3 text-center">Antal Klagomål</th>
                <th className="px-6 py-3">Detaljer</th>
              </tr>
            </thead>
            <tbody>
              {actionListComplaints.map((s, i) => (
                <tr key={i} className="border-b border-gray-50 hover:bg-gray-50/50">
                  <td className="px-6 py-3 font-medium text-gray-900">{s.name}</td>
                  <td className="px-6 py-3 text-center text-[#FF6B6B] font-bold">{s.complaints}</td>
                  <td className="px-6 py-3 text-gray-500">{s.details}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader
          title="Förfallna fakturor (Fortnox)"
          icon={DollarSign}
          action={<span className="bg-[#FF6B6B]/10 text-[#FF6B6B] text-xs font-bold px-2.5 py-0.5 rounded-full">{actionListOverdueInvoices.length} st</span>}
        />
        <CardContent className="p-0">
          <table className="w-full text-sm text-left">
            <thead className="text-xs text-gray-500 uppercase bg-gray-50">
              <tr>
                <th className="px-6 py-3">Faktura</th>
                <th className="px-6 py-3">Kund</th>
                <th className="px-6 py-3 text-center">Dagar Försenad</th>
                <th className="px-6 py-3 text-right">Belopp</th>
              </tr>
            </thead>
            <tbody>
              {actionListOverdueInvoices.map((inv, i) => (
                <tr key={i} className="border-b border-gray-50 hover:bg-gray-50/50">
                  <td className="px-6 py-3 font-medium text-gray-900">{inv.invoiceNo}</td>
                  <td className="px-6 py-3 text-gray-500">{inv.customer}</td>
                  <td className="px-6 py-3 text-center text-[#FF6B6B] font-medium">{inv.daysOverdue}</td>
                  <td className="px-6 py-3 text-right">{inv.amount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  </div>
);

const SalesView = () => (
  <div className="space-y-6">
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <GoalList title="Årsmål (1 apr - 31 mar)" data={yearGoals} icon={Calendar} />
      <GoalList title="Månadsmål (Januari)" data={monthGoals} icon={Calendar} />
      <GoalList title="Veckomål" data={weekGoals} icon={Clock} />
    </div>

    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
      <Card>
        <CardContent className="p-4 flex flex-col items-center justify-center text-center">
          <div className="text-2xl font-light text-gray-900 mb-1">1.2M</div>
          <div className="text-[10px] text-gray-500 uppercase tracking-wider font-medium">Bokad försäljning</div>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="p-4 flex flex-col items-center justify-center text-center">
          <div className="text-2xl font-light text-gray-900 mb-1">450k</div>
          <div className="text-[10px] text-gray-500 uppercase tracking-wider font-medium">Nyförsäljning</div>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="p-4 flex flex-col items-center justify-center text-center">
          <div className="text-2xl font-light text-gray-900 mb-1">124</div>
          <div className="text-[10px] text-gray-500 uppercase tracking-wider font-medium">Antal leads</div>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="p-4 flex flex-col items-center justify-center text-center">
          <div className="text-2xl font-light text-gray-900 mb-1">24%</div>
          <div className="text-[10px] text-gray-500 uppercase tracking-wider font-medium">Konvertering</div>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="p-4 flex flex-col items-center justify-center text-center">
          <div className="text-2xl font-light text-gray-900 mb-1">8.5k</div>
          <div className="text-[10px] text-gray-500 uppercase tracking-wider font-medium">Snittorder</div>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="p-4 flex flex-col items-center justify-center text-center">
          <div className="text-2xl font-light text-gray-900 mb-1">2.1%</div>
          <div className="text-[10px] text-gray-500 uppercase tracking-wider font-medium">Churn/Avslut</div>
        </CardContent>
      </Card>
    </div>

    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <Card>
        <CardHeader title="Mål & Progress" icon={TrendingUp} />
        <CardContent className="space-y-6">
          <div>
            <div className="flex justify-between text-sm mb-2">
              <span className="font-medium text-gray-700">Månadsmål (Nyförsäljning)</span>
              <span className="text-gray-500">450k / 500k</span>
            </div>
            <ProgressBar value={450000} max={500000} />
          </div>
          <div>
            <div className="flex justify-between text-sm mb-2">
              <span className="font-medium text-gray-700">Veckomål (Leads)</span>
              <span className="text-gray-500">24 / 30</span>
            </div>
            <ProgressBar value={24} max={30} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader title="Aktiviteter" icon={Clock} />
        <CardContent className="p-0">
          <ul className="divide-y divide-gray-50">
            <li className="p-4 flex justify-between items-center hover:bg-gray-50/50">
              <div>
                <p className="text-sm font-medium text-gray-900">Ring upp Brf Solen</p>
                <p className="text-xs text-gray-500 mt-0.5">Idag 14:00 • Uppföljning offert</p>
              </div>
              <span className="px-2.5 py-1 bg-[#FF6B6B]/10 text-[#FF6B6B] text-[10px] rounded-md font-bold uppercase tracking-wider">Hög prio</span>
            </li>
            <li className="p-4 flex justify-between items-center hover:bg-gray-50/50">
              <div>
                <p className="text-sm font-medium text-gray-900">Skicka avtal till Företag AB</p>
                <p className="text-xs text-gray-500 mt-0.5">Idag 16:00 • Nytt avtal</p>
              </div>
            </li>
          </ul>
        </CardContent>
      </Card>
    </div>

    <Card>
      <CardHeader title="Pipeline" icon={Briefcase} />
      <CardContent className="p-0 overflow-x-auto">
        <table className="w-full text-sm text-left">
          <thead className="text-xs text-gray-500 uppercase bg-gray-50">
            <tr>
              <th className="px-6 py-3">Kund</th>
              <th className="px-6 py-3">Värde</th>
              <th className="px-6 py-3">Status</th>
              <th className="px-6 py-3">Senaste aktivitet</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-b border-gray-50 hover:bg-gray-50/50">
              <td className="px-6 py-4 font-medium text-gray-900">Brf Solen</td>
              <td className="px-6 py-4">120 000 kr</td>
              <td className="px-6 py-4"><span className="px-2 py-1 bg-blue-50 text-blue-700 rounded-md text-xs font-medium">Offert skickad</span></td>
              <td className="px-6 py-4 text-gray-500">Igår</td>
            </tr>
            <tr className="border-b border-gray-50 hover:bg-gray-50/50">
              <td className="px-6 py-4 font-medium text-gray-900">Restaurang Matglädje</td>
              <td className="px-6 py-4">45 000 kr</td>
              <td className="px-6 py-4"><span className="px-2 py-1 bg-amber-50 text-amber-700 rounded-md text-xs font-medium">Kontaktad</span></td>
              <td className="px-6 py-4 text-gray-500">2 dagar sedan</td>
            </tr>
            <tr className="border-b border-gray-50 hover:bg-gray-50/50">
              <td className="px-6 py-4 font-medium text-gray-900">Svensson IT</td>
              <td className="px-6 py-4">80 000 kr</td>
              <td className="px-6 py-4"><span className="px-2 py-1 bg-[#A8E6CF]/30 text-emerald-800 rounded-md text-xs font-medium">Vunnen</span></td>
              <td className="px-6 py-4 text-gray-500">Idag</td>
            </tr>
          </tbody>
        </table>
      </CardContent>
    </Card>
  </div>
);

const TicketsView = () => {
  const [issues, setIssues] = React.useState<any[]>([]);
  const [isLoading, setIsLoading] = React.useState(true);

  React.useEffect(() => {
    const fetchIssues = async () => {
      try {
        const issuesRes = await timewaveService.getIssues();
        setIssues(issuesRes?.data || []);
      } catch (error) {
        console.error("Failed to fetch issues", error);
      } finally {
        setIsLoading(false);
      }
    };
    fetchIssues();
  }, []);

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-2xl border border-gray-100 p-6 shadow-sm flex flex-col md:flex-row items-center justify-between gap-4">
        <div>
          <h3 className="text-lg font-semibold text-gray-900 tracking-tight">TimeWave Integration</h3>
          <p className="text-sm text-gray-500 mt-1">Här kopplas TimeWave ärenden in när API-nyckel är klar.</p>
        </div>
        <button className="px-4 py-2 bg-[#faf8f5] border border-[#eae4d9] rounded-xl text-xs font-bold text-[#5c5750] tracking-widest uppercase shadow-sm hover:bg-white hover:-translate-y-0.5 transition-all duration-300">
          CONNECT TIMEWAVE API (COMING SOON)
        </button>
      </div>

      <Card>
        <div className="px-6 py-4 border-b border-gray-100 flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white">
          <h3 className="font-semibold text-gray-800 tracking-tight">Ärenden</h3>
          <div className="flex items-center gap-2">
            <span className="px-3 py-1.5 bg-gray-50 border border-gray-200 rounded-lg text-xs font-medium text-gray-600 cursor-pointer hover:bg-gray-100">Status</span>
            <span className="px-3 py-1.5 bg-gray-50 border border-gray-200 rounded-lg text-xs font-medium text-gray-600 cursor-pointer hover:bg-gray-100">Prioritet</span>
            <span className="px-3 py-1.5 bg-gray-50 border border-gray-200 rounded-lg text-xs font-medium text-gray-600 cursor-pointer hover:bg-gray-100">Kategori</span>
          </div>
        </div>
        <CardContent className="p-0 overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead className="text-xs text-gray-500 uppercase bg-gray-50">
              <tr>
                <th className="px-6 py-3">Ärende-ID</th>
                <th className="px-6 py-3">Kund</th>
                <th className="px-6 py-3">Kategori</th>
                <th className="px-6 py-3">Status</th>
                <th className="px-6 py-3">Prioritet</th>
                <th className="px-6 py-3">Skapad datum</th>
                <th className="px-6 py-3">Ansvarig</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td colSpan={7} className="px-6 py-8 text-center text-sm text-gray-500">
                    <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2 text-gray-400" />
                    Laddar ärenden...
                  </td>
                </tr>
              ) : issues.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-6 py-8 text-center text-sm text-gray-500">
                    Inga ärenden hittades.
                  </td>
                </tr>
              ) : (
                issues.map((issue: any) => (
                  <tr key={issue.id} className="border-b border-gray-50 hover:bg-gray-50/50">
                    <td className="px-6 py-4 font-medium text-gray-900">#{issue.number || issue.id}</td>
                    <td className="px-6 py-4">{issue.client_name || issue.client?.name || 'Okänd'}</td>
                    <td className="px-6 py-4 text-gray-500">{issue.type_name || issue.type?.name || 'Allmänt'}</td>
                    <td className="px-6 py-4">
                      <span className={cn(
                        "px-2 py-1 rounded-md text-xs font-medium",
                        issue.status_id === 1 ? "bg-amber-50 text-amber-700" :
                          issue.status_id === 2 ? "bg-green-50 text-green-700" :
                            "bg-blue-50 text-blue-700"
                      )}>
                        {issue.status_name || issue.status?.name || 'Öppen'}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <span className={cn(
                        "px-2 py-1 rounded-md text-xs font-medium",
                        issue.priority_id === 1 ? "bg-[#FF6B6B]/10 text-[#FF6B6B]" : "bg-gray-100 text-gray-700"
                      )}>
                        {issue.priority_name || issue.priority?.name || 'Normal'}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-gray-500">
                      {issue.created_at ? new Date(issue.created_at).toISOString().split('T')[0] : 'N/A'}
                    </td>
                    <td className="px-6 py-4 text-gray-500">{issue.assigned_to_name || issue.assignedTo?.name || 'Ej tilldelad'}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
};

const MailView = () => {
  const [isConnected, setIsConnected] = React.useState(false);
  const [isLoading, setIsLoading] = React.useState(true);
  const [emails, setEmails] = React.useState<any[]>([]);
  const [selectedEmail, setSelectedEmail] = React.useState<any>(null);

  React.useEffect(() => {
    checkConnection();

    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === 'OAUTH_AUTH_SUCCESS') {
        checkConnection();
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  const checkConnection = async () => {
    try {
      const res = await fetch('/api/mail/status');
      const data = await res.json();
      setIsConnected(data.connected);
      if (data.connected) {
        fetchEmails();
      } else {
        setIsLoading(false);
      }
    } catch (err) {
      console.error("Failed to check connection", err);
      setIsLoading(false);
    }
  };

  const fetchEmails = async () => {
    setIsLoading(true);
    try {
      const res = await fetch('/api/mail/messages');
      if (res.ok) {
        const data = await res.json();
        setEmails(data);
        if (data.length > 0) setSelectedEmail(data[0]);
      } else if (res.status === 401) {
        setIsConnected(false);
      }
    } catch (err) {
      console.error("Failed to fetch emails", err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleConnect = async () => {
    try {
      const res = await fetch('/api/auth/url');
      const data = await res.json();
      if (data.url) {
        window.open(data.url, 'oauth_popup', 'width=600,height=700');
      }
    } catch (err) {
      console.error("Failed to get auth URL", err);
    }
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return new Intl.DateTimeFormat('sv-SE', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    }).format(date);
  };

  return (
    <div className="h-[calc(100vh-12rem)] min-h-[600px] flex flex-col space-y-4">
      <div className="bg-white rounded-2xl border border-gray-100 p-4 shadow-sm flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <Mail className="w-5 h-5 text-gray-400" />
          <span className="text-sm font-semibold text-gray-800 tracking-tight">Outlook Integration</span>
        </div>
        {!isConnected && (
          <button
            onClick={handleConnect}
            className="px-4 py-2 bg-[#faf8f5] border border-[#eae4d9] rounded-xl text-xs font-bold text-[#5c5750] tracking-widest uppercase shadow-sm hover:bg-white hover:-translate-y-0.5 transition-all duration-300"
          >
            CONNECT OUTLOOK
          </button>
        )}
        {isConnected && (
          <span className="px-3 py-1 bg-[#A8E6CF]/20 text-emerald-700 rounded-lg text-xs font-bold uppercase tracking-wider">
            Connected
          </span>
        )}
      </div>

      <div className="flex-1 bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden flex">
        {/* Folders */}
        <div className="w-48 border-r border-gray-100 bg-gray-50/30 p-4 hidden md:block">
          <nav className="space-y-1">
            <a href="#" className="flex items-center gap-3 px-3 py-2 bg-white rounded-lg text-sm font-medium text-rose-600 shadow-sm border border-gray-100">
              <Inbox className="w-4 h-4" /> Inbox
            </a>
            <a href="#" className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium text-gray-600 hover:bg-gray-50">
              <Send className="w-4 h-4" /> Sent
            </a>
            <a href="#" className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium text-gray-600 hover:bg-gray-50">
              <File className="w-4 h-4" /> Drafts
            </a>
            <a href="#" className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium text-gray-600 hover:bg-gray-50">
              <Archive className="w-4 h-4" /> Archive
            </a>
          </nav>
        </div>

        {/* List */}
        <div className="w-full md:w-80 border-r border-gray-100 flex flex-col">
          <div className="p-3 border-b border-gray-100">
            <div className="relative">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input type="text" placeholder="Sök mail..." className="w-full pl-9 pr-3 py-1.5 bg-gray-50 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-rose-500/20 focus:border-rose-500" />
            </div>
          </div>
          <div className="flex-1 overflow-y-auto">
            {isLoading ? (
              <div className="p-4 text-center text-sm text-gray-500">Laddar...</div>
            ) : !isConnected ? (
              <div className="p-4 text-center text-sm text-gray-500">
                Koppla ditt Outlook-konto för att se dina mail här.
              </div>
            ) : emails.length === 0 ? (
              <div className="p-4 text-center text-sm text-gray-500">Inga mail hittades.</div>
            ) : (
              emails.map((email) => (
                <div
                  key={email.id}
                  onClick={() => setSelectedEmail(email)}
                  className={cn(
                    "p-3 border-b border-gray-50 cursor-pointer transition-colors",
                    selectedEmail?.id === email.id ? "bg-rose-50/50" : "hover:bg-gray-50/50",
                    !email.isRead && "bg-gray-50/30"
                  )}
                >
                  <div className="flex justify-between items-baseline mb-1">
                    <span className={cn("text-sm truncate pr-2", !email.isRead ? "font-bold text-gray-900" : "font-medium text-gray-700")}>
                      {email.sender?.emailAddress?.name || email.sender?.emailAddress?.address || 'Okänd'}
                    </span>
                    <span className={cn("text-xs shrink-0", !email.isRead ? "text-rose-600 font-medium" : "text-gray-400")}>
                      {formatDate(email.receivedDateTime)}
                    </span>
                  </div>
                  <p className={cn("text-xs mb-1 truncate", !email.isRead ? "font-bold text-gray-800" : "text-gray-700")}>
                    {email.subject || '(Inget ämne)'}
                  </p>
                  <p className="text-xs text-gray-500 truncate">{email.bodyPreview}</p>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Preview */}
        <div className="flex-1 hidden lg:flex flex-col bg-[#faf9f9]">
          {selectedEmail ? (
            <>
              <div className="p-6 border-b border-gray-100 bg-white">
                <h2 className="text-xl font-semibold text-gray-900 mb-4">{selectedEmail.subject || '(Inget ämne)'}</h2>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-rose-100 flex items-center justify-center text-rose-600 font-bold uppercase">
                      {(selectedEmail.sender?.emailAddress?.name || selectedEmail.sender?.emailAddress?.address || '?').charAt(0)}
                    </div>
                    <div>
                      <p className="text-sm font-medium text-gray-900">
                        {selectedEmail.sender?.emailAddress?.name || 'Okänd'} <span className="text-gray-500 font-normal">&lt;{selectedEmail.sender?.emailAddress?.address}&gt;</span>
                      </p>
                    </div>
                  </div>
                  <span className="text-sm text-gray-500">{formatDate(selectedEmail.receivedDateTime)}</span>
                </div>
              </div>
              <div className="p-6 text-sm text-gray-700 leading-relaxed overflow-y-auto whitespace-pre-wrap">
                {selectedEmail.bodyPreview}
                {/* In a real app, you'd render the full HTML body here if available, safely sanitized */}
              </div>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center text-gray-400 text-sm">
              Välj ett mail för att läsa
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

const ScheduleView = () => (
  <div className="h-[calc(100vh-12rem)] -m-8">
    <DispatchBoard />
  </div>
);

// --- MAIN APP ---

export default function App() {
  const [activeTab, setActiveTab] = useState('overview');

  const tabs = [
    { id: 'overview', label: 'ÖVERSIKT', icon: LayoutDashboard },
    { id: 'customers', label: 'KUNDER', icon: Users },
    { id: 'sales', label: 'FÖRSÄLJNING', icon: TrendingUp },
    { id: 'quality', label: 'KVALITET & NÖJDHET', icon: Star },
    { id: 'staff', label: 'PERSONAL', icon: Briefcase },
    { id: 'schedule', label: 'SCHEMA', icon: CalendarDays },
    { id: 'actions', label: 'ACTIONLISTA', icon: AlertTriangle },
    { id: 'tickets', label: 'ÄRENDEHANTERING', icon: ClipboardList },
    { id: 'mail', label: 'MAIL', icon: Mail },
  ];

  return (
    <>
      <Show
        when="signed-in"
        fallback={
          <div className="min-h-screen bg-[#faf9f9] flex items-center justify-center font-sans">
            <div className="flex flex-col items-center">
              <img src="/logotyp1.png" alt="Städona Logo" className="h-14 w-auto mb-6" />
              <SignIn />
            </div>
          </div>
        }
      >
        <div className="min-h-screen bg-[#faf9f9] flex flex-col md:flex-row font-sans text-gray-900">
          {/* Sidebar */}
          <aside className="w-full md:w-64 bg-white border-r border-gray-100 flex-shrink-0 flex flex-col">
            <div className="p-6 flex flex-col items-center text-center">
              <img src="/logotyp1.png" alt="Städona Logo" className="h-10 w-auto mb-1" />
              <p className="text-sm text-gray-800 font-serif italic tracking-wide">Dashboard</p>
            </div>
            <nav className="px-4 pb-6 space-y-1.5 flex-1">
              {tabs.map((tab) => {
                const Icon = tab.icon;
                const isActive = activeTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id)}
                    className={cn(
                      "w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-all duration-200",
                      isActive
                        ? "bg-rose-50 text-rose-700 shadow-sm"
                        : "text-gray-500 hover:bg-gray-50 hover:text-gray-900"
                    )}
                  >
                    <Icon className={cn("w-5 h-5", isActive ? "text-rose-600" : "text-gray-400")} />
                    {tab.label}
                  </button>
                );
              })}
            </nav>
            <div className="px-6 py-4 border-t border-gray-100 flex items-center gap-3">
              <UserButton afterSignOutUrl="/" />
              <span className="text-xs text-gray-500">Konto</span>
            </div>
          </aside>

          {/* Main Content */}
          <main className="flex-1 overflow-auto bg-[#faf9f9]">
            <header className="bg-white/80 backdrop-blur-md border-b border-gray-100 px-8 py-6 sticky top-0 z-10">
              <h2 className="text-2xl font-bold text-gray-800 tracking-tight">
                {tabs.find(t => t.id === activeTab)?.label}
              </h2>
            </header>
            <div className="p-8 max-w-7xl mx-auto">
              {activeTab === 'overview' && <OverviewView />}
              {activeTab === 'customers' && <CustomersView />}
              {activeTab === 'sales' && <SalesView />}
              {activeTab === 'quality' && <QualityView />}
              {activeTab === 'staff' && <StaffView />}
              {activeTab === 'schedule' && <ScheduleView />}
              {activeTab === 'actions' && <ActionListView />}
              {activeTab === 'tickets' && <TicketsView />}
              {activeTab === 'mail' && <MailView />}
            </div>
          </main>
        </div>
      </Show>
    </>
  );
}
