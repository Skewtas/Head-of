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
  RefreshCw,
  Newspaper,
  Building2
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
import NewsletterView from './NewsletterView';

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
      {Icon && <Icon className="w-5 h-5 text-brand-accent" />}
      <h3 className="font-serif text-brand-dark tracking-tight">{title}</h3>
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

  let colorClass = "bg-brand-accent/100";
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
    if (isCurrency) return new Intl.NumberFormat('sv-SE').format(Math.round(val)) + ' kr';
    return val + (item.unit !== "st" && !isPercentage ? ' ' + item.unit : item.unit === "st" ? ' st' : '%');
  };
  const isGood = item.reverse ? item.actual <= item.goal : item.actual >= item.goal;
  const pct = Math.min(100, Math.max(0, item.reverse
    ? (item.goal > 0 ? ((item.goal - item.actual + item.goal) / (item.goal * 2)) * 100 : 0)
    : (item.goal > 0 ? (item.actual / item.goal) * 100 : 0)));

  return (
    <div className="flex items-center gap-3 py-2 border-b border-gray-50 last:border-0">
      <span className="text-sm text-brand-muted w-[200px] shrink-0 truncate">{item.metric}</span>
      <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
        <div
          className={cn("h-full rounded-full transition-all", isGood ? "bg-emerald-400" : "bg-amber-400")}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className={cn("text-sm font-semibold w-[100px] text-right shrink-0", isGood ? "text-emerald-600" : "text-amber-600")}>
        {formatValue(item.actual)}
      </span>
      <span className="text-xs text-gray-400 w-[100px] text-right shrink-0">/ {formatValue(item.goal)}</span>
    </div>
  );
};

const GoalList = ({ title, data, icon }: { title: string; data: any[]; icon: any }) => (
  <Card>
    <CardHeader title={title} icon={icon} />
    <CardContent className="px-5 py-2">
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

const fmt = (val: number) => new Intl.NumberFormat('sv-SE').format(val);

const OverviewView = () => {
  const [stats, setStats] = React.useState<{
    bookedJobsThisMonth: number;
    totalHoursThisMonth: number;
    totalRevenueExVat: number;
    totalInvoicedNet: number;
    avgPricePerHour: number;
    newBookingsThisMonth: number;
    newWorkOrdersThisMonth: number;
    followUpCount: number;
    sickLeaveThisMonth: { name: string; count: number }[];
    sickLeave3Months: { name: string; count: number }[];
    recurringPrivateClients: number;
    recurringCompanyClients: number;
    customers: number;
    employees: number;
    issues: number;
    onlineBookings: number;
    teamBreakdown: { name: string; hours: number; revenue: number }[];
    salesData: typeof salesData;
    isLoading: boolean;
  }>({
    bookedJobsThisMonth: 0,
    totalHoursThisMonth: 0,
    totalRevenueExVat: 0,
    totalInvoicedNet: 0,
    avgPricePerHour: 0,
    newBookingsThisMonth: 0,
    newWorkOrdersThisMonth: 0,
    followUpCount: 0,
    sickLeaveThisMonth: [],
    sickLeave3Months: [],
    recurringPrivateClients: 0,
    recurringCompanyClients: 0,
    customers: 0,
    employees: 0,
    issues: 0,
    onlineBookings: 0,
    teamBreakdown: [],
    salesData: salesData,
    isLoading: true
  });

  React.useEffect(() => {
    const fetchStats = async () => {
      try {
        // Get current month boundaries (use local dates, not UTC)
        const now = new Date();
        const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
        const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);
        const pad = (n: number) => String(n).padStart(2, '0');
        const toLocalDateStr = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
        const monthStartStr = toLocalDateStr(monthStart);
        const monthEndStr = toLocalDateStr(monthEnd);

        const [customersRes, employeesRes, missionsSummary, issuesRes, invoicesRes] = await Promise.all([
          timewaveService.getCustomers().catch(() => ({ data: [], total: 0 })),
          timewaveService.getEmployees().catch(() => ({ data: [], total: 0 })),
          timewaveService.getMissionsSummary(monthStartStr, monthEndStr).catch(() => ({
            totalJobs: 0, totalHours: 0, totalRevenueExVat: 0, totalInvoicedNet: 0, avgPricePerHour: 0, recurringPrivateClients: 0, recurringCompanyClients: 0, billableClients: 0, newWorkOrdersThisMonth: 0, followUpCount: 0, sickLeaveThisMonth: [], sickLeave3Months: [], onlineBookings: 0, teamBreakdown: []
          })),
          timewaveService.getIssues().catch(() => ({ data: [], total: 0 })),
          timewaveService.getSalesData().catch(() => ({ data: [], total: 0 }))
        ]);

        // Use pre-computed summary from server (all pages aggregated)
        const bookedJobsThisMonth = missionsSummary.totalJobs;
        const totalHoursThisMonth = missionsSummary.totalHours;
        const totalRevenueExVat = missionsSummary.totalRevenueExVat;
        const totalInvoicedNet = missionsSummary.totalInvoicedNet || 0;
        const avgPricePerHour = missionsSummary.avgPricePerHour || 0;
        const newBookingsThisMonth = missionsSummary.totalJobs;
        const recurringPrivateClients = missionsSummary.recurringPrivateClients;
        const recurringCompanyClients = missionsSummary.recurringCompanyClients;

        let updatedSalesData = [...salesData];
        if (invoicesRes?.data?.length > 0) {
          const monthlySales: Record<string, number> = {};
          invoicesRes.data.forEach((inv: any) => {
            const dateStr = inv.date || inv.invoice_date || inv.created_at;
            if (dateStr) {
              const d = new Date(dateStr);
              let month = d.toLocaleString('sv-SE', { month: 'short' }).replace('.', '');
              const amount = Number(inv.total_amount || inv.sum || inv.total || 0);
              monthlySales[month.toLowerCase()] = (monthlySales[month.toLowerCase()] || 0) + amount;
            }
          });
          updatedSalesData = updatedSalesData.map(item => {
            const val = monthlySales[item.name.toLowerCase()];
            return { ...item, actual: val !== undefined ? val : item.actual };
          });
        }

        setStats({
          bookedJobsThisMonth,
          totalHoursThisMonth,
          totalRevenueExVat,
          totalInvoicedNet,
          avgPricePerHour,
          newBookingsThisMonth,
          newWorkOrdersThisMonth: missionsSummary.newWorkOrdersThisMonth || 0,
          followUpCount: missionsSummary.followUpCount || 0,
          sickLeaveThisMonth: missionsSummary.sickLeaveThisMonth || [],
          sickLeave3Months: missionsSummary.sickLeave3Months || [],
          recurringPrivateClients,
          recurringCompanyClients,
          customers: missionsSummary.billableClients || 0,
          employees: employeesRes?.total || employeesRes?.data?.length || 0,
          issues: issuesRes?.total || issuesRes?.data?.length || 0,
          onlineBookings: missionsSummary.onlineBookings || 0,
          teamBreakdown: missionsSummary.teamBreakdown || [],
          salesData: updatedSalesData,
          isLoading: false
        });
      } catch (error) {
        console.error("Failed to fetch overview stats", error);
        setStats(s => ({ ...s, isLoading: false }));
      }
    };

    fetchStats();
  }, []);

  const currentMonthName = new Date().toLocaleString('sv-SE', { month: 'long' });

  return (
    <div className="space-y-8">
      {/* Logo */}
      {/* Quick links */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <a href="https://timewave.se" target="_blank" rel="noopener noreferrer" className="flex items-center justify-center h-11 bg-[#faf8f5] border border-[#eae4d9] rounded-xl text-xs font-bold text-[#5c5750] tracking-widest uppercase shadow-sm transition-all duration-300 hover:-translate-y-0.5 hover:shadow-md hover:bg-white">TIMEWAVE</a>
        <a href="https://fortnox.se" target="_blank" rel="noopener noreferrer" className="flex items-center justify-center h-11 bg-[#faf8f5] border border-[#eae4d9] rounded-xl text-xs font-bold text-[#5c5750] tracking-widest uppercase shadow-sm transition-all duration-300 hover:-translate-y-0.5 hover:shadow-md hover:bg-white">FORTNOX</a>
        <a href="https://beambop.com" target="_blank" rel="noopener noreferrer" className="flex items-center justify-center h-11 bg-[#faf8f5] border border-[#eae4d9] rounded-xl text-xs font-bold text-[#5c5750] tracking-widest uppercase shadow-sm transition-all duration-300 hover:-translate-y-0.5 hover:shadow-md hover:bg-white">BEAMBOP</a>
        <a href="https://skatteverket.se" target="_blank" rel="noopener noreferrer" className="flex items-center justify-center h-11 bg-[#faf8f5] border border-[#eae4d9] rounded-xl text-xs font-bold text-[#5c5750] tracking-widest uppercase shadow-sm transition-all duration-300 hover:-translate-y-0.5 hover:shadow-md hover:bg-white">SKATTEVERKET</a>
      </div>

      {/* Month overview heading */}
      <h3 className="text-xl font-serif text-brand-dark tracking-tight capitalize">
        Översikt — {currentMonthName} {new Date().getFullYear()}
      </h3>

      {/* Main KPIs - 5 columns */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {[
          { icon: CalendarDays, label: 'Inbokade Jobb', value: stats.bookedJobsThisMonth, color: 'text-brand-accent' },
          { icon: Clock, label: 'Timmar Totalt', value: fmt(Math.round(stats.totalHoursThisMonth)), color: 'text-brand-accent' },
          { icon: TrendingUp, label: 'Intäkter (ex. moms)', value: `${fmt(Math.round(stats.totalRevenueExVat))} kr`, color: 'text-emerald-500' },
          { icon: ClipboardList, label: 'Nya Arbetsordrar (AO)', value: stats.newWorkOrdersThisMonth, color: 'text-brand-accent' },
          { icon: Users, label: 'Återk. Privat', value: stats.recurringPrivateClients, color: 'text-brand-accent' },
          { icon: Building2, label: 'Återk. Företag', value: stats.recurringCompanyClients, color: 'text-brand-accent' },
          { icon: Users, label: 'Anställda', value: stats.employees, color: 'text-brand-accent' },
          { icon: CalendarDays, label: 'Bokningar Online', value: stats.onlineBookings, color: 'text-blue-500' },
          { icon: RefreshCw, label: 'Follow Up Cleaning', value: stats.followUpCount, color: 'text-blue-500' },
          { icon: AlertTriangle, label: 'Öppna Ärenden', value: stats.issues, color: 'text-amber-500' },
        ].map((kpi, i) => (
          <Card key={i}>
            <CardContent className="p-4 flex flex-col items-center justify-center text-center">
              <kpi.icon className={`w-5 h-5 ${kpi.color} mb-1.5`} />
              <div className="text-2xl font-light text-brand-dark mb-0.5">
                {stats.isLoading ? <RefreshCw className="w-5 h-5 animate-spin text-gray-400 mx-auto" /> : kpi.value}
              </div>
              <div className="text-[9px] text-brand-muted uppercase tracking-wider font-medium leading-tight">{kpi.label}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Månadsmål - Enkel tabell */}
      <Card>
        <CardContent className="p-5">
          <h4 className="text-sm font-semibold text-brand-dark mb-4">Månadsmål — {currentMonthName}</h4>
          <div className="space-y-3">
            {[
              { label: 'Bokad försäljning', actual: stats.totalRevenueExVat, goal: 850000, unit: 'kr' },
              { label: 'Fakturerad försäljning', actual: stats.totalInvoicedNet, goal: 850000, unit: 'kr' },
              { label: 'Snittpris', actual: stats.avgPricePerHour, goal: 550, unit: 'kr/h' },
              { label: 'Återk. kunder (privat)', actual: stats.recurringPrivateClients, goal: 250, unit: 'st' },
              { label: 'Återk. kunder (företag)', actual: stats.recurringCompanyClients, goal: 50, unit: 'st' },
              { label: 'Personal bas', actual: stats.employees, goal: 20, unit: 'st' },
            ].map((item, i) => {
              const pct = item.goal > 0 ? Math.min(100, Math.round((item.actual / item.goal) * 100)) : 0;
              const isOver = item.actual >= item.goal;
              return (
                <div key={i}>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-brand-dark font-medium">{item.label}</span>
                    <span className={isOver ? 'text-emerald-600 font-semibold' : 'text-brand-muted'}>
                      {fmt(Math.round(item.actual))} / {fmt(item.goal)} {item.unit} ({pct}%)
                    </span>
                  </div>
                  <div className="w-full bg-gray-100 rounded-full h-2">
                    <div
                      className={`h-2 rounded-full transition-all duration-500 ${isOver ? 'bg-emerald-500' : pct > 70 ? 'bg-amber-400' : 'bg-red-400'}`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Team Breakdown */}
      <Card>
        <CardContent className="p-5">
          <h4 className="text-sm font-semibold text-brand-dark mb-4 flex items-center gap-2">
            <Users className="w-4 h-4 text-brand-accent" />
            Team — {currentMonthName} {new Date().getFullYear()}
          </h4>
          {stats.isLoading ? (
            <RefreshCw className="w-6 h-6 animate-spin text-gray-400 mx-auto" />
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[10px] text-brand-muted uppercase tracking-wider border-b border-gray-200">
                  <th className="text-left pb-2">Team</th>
                  <th className="text-right pb-2">Timmar</th>
                  <th className="text-right pb-2">Intäkter (ex. moms)</th>
                </tr>
              </thead>
              <tbody>
                {stats.teamBreakdown.map((team, i) => (
                  <tr key={i} className="border-t border-gray-100 hover:bg-gray-50/50">
                    <td className="py-2.5 font-medium text-brand-dark">{team.name}</td>
                    <td className="py-2.5 text-right text-brand-muted">{fmt(team.hours)} h</td>
                    <td className="py-2.5 text-right font-medium text-brand-dark">{fmt(team.revenue)} kr</td>
                  </tr>
                ))}
                <tr className="border-t-2 border-gray-300 font-semibold">
                  <td className="py-2.5 text-brand-dark">Totalt</td>
                  <td className="py-2.5 text-right text-brand-dark">{fmt(Math.round(stats.teamBreakdown.reduce((s, t) => s + t.hours, 0)))} h</td>
                  <td className="py-2.5 text-right text-brand-dark">{fmt(Math.round(stats.teamBreakdown.reduce((s, t) => s + t.revenue, 0)))} kr</td>
                </tr>
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      {/* Sjukfrånvaro */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card>
          <CardContent className="p-5">
            <h4 className="text-sm font-semibold text-brand-dark mb-3 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-red-500" />
              Sjukfrånvaro — {currentMonthName}
            </h4>
            {stats.isLoading ? (
              <RefreshCw className="w-6 h-6 animate-spin text-gray-400 mx-auto" />
            ) : stats.sickLeaveThisMonth.length === 0 ? (
              <p className="text-sm text-brand-muted">Ingen sjukfrånvaro denna månad.</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-[10px] text-brand-muted uppercase tracking-wider">
                    <th className="text-left pb-2">Personal</th>
                    <th className="text-right pb-2">Tillfällen</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.sickLeaveThisMonth.map((emp, i) => (
                    <tr key={i} className="border-t border-gray-100">
                      <td className="py-2 text-brand-dark">{emp.name}</td>
                      <td className="py-2 text-right font-medium text-red-500">{emp.count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <h4 className="text-sm font-semibold text-brand-dark mb-3 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-500" />
              Sjukfrånvaro — Senaste 3 Månaderna
            </h4>
            {stats.isLoading ? (
              <RefreshCw className="w-6 h-6 animate-spin text-gray-400 mx-auto" />
            ) : stats.sickLeave3Months.length === 0 ? (
              <p className="text-sm text-brand-muted">Ingen sjukfrånvaro senaste 3 månaderna.</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-[10px] text-brand-muted uppercase tracking-wider">
                    <th className="text-left pb-2">Personal</th>
                    <th className="text-right pb-2">Tillfällen</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.sickLeave3Months.map((emp, i) => (
                    <tr key={i} className="border-t border-gray-100">
                      <td className="py-2 text-brand-dark">{emp.name}</td>
                      <td className="py-2 text-right font-medium text-amber-500">{emp.count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Charts */}
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
                <Bar dataKey="actual" name="Utfall" fill="#151515" radius={[4, 4, 0, 0]} />
                <Bar dataKey="goal" name="Mål" fill="#c8b6a6" radius={[4, 4, 0, 0]} />
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
                      {fb.rating === 'RED' && <Frown className="w-6 h-6 text-brand-accent" />}
                      <div>
                        <div className="font-serif text-brand-dark text-sm">{fb.customer}</div>
                        <div className="text-xs text-brand-muted">Städare: {fb.cleaner}</div>
                      </div>
                    </div>
                    <span className="text-xs font-medium text-gray-400">{fb.time}</span>
                  </div>
                  <p className="text-sm text-brand-muted mt-2 line-clamp-2">
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
  const [stats, setStats] = React.useState<{
    active: number;
    newSingle: number;
    newRecurring: number;
    incomingTickets: number;
    topClients: { name: string; revenue: number }[];
    bottomClients: { name: string; revenue: number }[];
    isLoading: boolean;
  }>({
    active: 0,
    newSingle: 0,
    newRecurring: 0,
    incomingTickets: 0,
    topClients: [],
    bottomClients: [],
    isLoading: true
  });

  React.useEffect(() => {
    const fetchCustomersAndTickets = async () => {
      try {
        const now = new Date();
        const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
        const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);
        const pad = (n: number) => String(n).padStart(2, '0');
        const toLocalDateStr = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

        const [missionsSummary, issuesRes] = await Promise.all([
          timewaveService.getMissionsSummary(toLocalDateStr(monthStart), toLocalDateStr(monthEnd)).catch(() => ({
            billableClients: 0, newSingleClients: 0, newRecurringClients: 0, topClients: [], bottomClients: []
          })),
          timewaveService.getIssues().catch(() => ({ data: [], total: 0 }))
        ]);

        setStats({
          active: missionsSummary.billableClients || 0,
          newSingle: missionsSummary.newSingleClients || 0,
          newRecurring: missionsSummary.newRecurringClients || 0,
          incomingTickets: issuesRes?.total || issuesRes?.data?.length || 0,
          topClients: missionsSummary.topClients || [],
          bottomClients: missionsSummary.bottomClients || [],
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
            <Users className="w-10 h-10 text-brand-accent mb-4" />
            <div className="text-4xl font-light text-brand-dark mb-1">
              {stats.isLoading ? <RefreshCw className="w-8 h-8 animate-spin text-gray-400 mx-auto" /> : stats.active}
            </div>
            <div className="text-sm text-brand-muted uppercase tracking-wider font-medium">Kunder att Fakturera</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-8">
            <UserCircle className="w-10 h-10 text-emerald-500 mb-4" />
            <div className="text-4xl font-light text-brand-dark mb-1">
              {stats.isLoading ? <RefreshCw className="w-8 h-8 animate-spin text-gray-400 mx-auto" /> : (
                <>{stats.newSingle} <span className="text-lg text-gray-400">/ {stats.newRecurring}</span></>
              )}
            </div>
            <div className="text-sm text-brand-muted uppercase tracking-wider font-medium text-center">
              Kunder denna månad<br /><span className="text-xs normal-case">(Enstaka / Återkommande)</span>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-8">
            <AlertCircle className="w-10 h-10 text-amber-500 mb-4" />
            <div className="text-4xl font-light text-brand-dark mb-1">
              {stats.isLoading ? <RefreshCw className="w-8 h-8 animate-spin text-gray-400 mx-auto" /> : stats.incomingTickets}
            </div>
            <div className="text-sm text-brand-muted uppercase tracking-wider font-medium text-center">
              Inkommande Ärenden<br /><span className="text-xs normal-case">(Kundportalen)</span>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader title="Topp 10 Kunder (Intäkt)" icon={TrendingUp} />
          <CardContent className="p-0">
            {stats.isLoading ? (
              <div className="p-6 text-center"><RefreshCw className="w-6 h-6 animate-spin text-gray-400 mx-auto" /></div>
            ) : (
            <table className="w-full text-sm text-left">
              <thead className="text-xs text-brand-muted uppercase bg-gray-50">
                <tr>
                  <th className="px-6 py-3">Kund</th>
                  <th className="px-6 py-3 text-right">Intäkt</th>
                </tr>
              </thead>
              <tbody>
                {stats.topClients.map((c, i) => (
                  <tr key={i} className="border-b border-gray-50 hover:bg-gray-50/50">
                    <td className="px-6 py-3 font-medium text-brand-dark">{i + 1}. {c.name}</td>
                    <td className="px-6 py-3 text-right">{new Intl.NumberFormat('sv-SE').format(c.revenue)} kr</td>
                  </tr>
                ))}
              </tbody>
            </table>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader title="Botten 10 Kunder (Intäkt)" icon={TrendingDown} />
          <CardContent className="p-0">
            {stats.isLoading ? (
              <div className="p-6 text-center"><RefreshCw className="w-6 h-6 animate-spin text-gray-400 mx-auto" /></div>
            ) : (
            <table className="w-full text-sm text-left">
              <thead className="text-xs text-brand-muted uppercase bg-gray-50">
                <tr>
                  <th className="px-6 py-3">Kund</th>
                  <th className="px-6 py-3 text-right">Intäkt</th>
                </tr>
              </thead>
              <tbody>
                {stats.bottomClients.map((c, i) => (
                  <tr key={i} className="border-b border-gray-50 hover:bg-gray-50/50">
                    <td className="px-6 py-3 font-medium text-brand-dark">{i + 1}. {c.name}</td>
                    <td className="px-6 py-3 text-right">{new Intl.NumberFormat('sv-SE').format(c.revenue)} kr</td>
                  </tr>
                ))}
              </tbody>
            </table>
            )}
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
          <div className="text-4xl font-light text-brand-dark mb-1">4.6 <span className="text-lg text-gray-400">/ 5.0</span></div>
          <div className="text-sm text-brand-muted uppercase tracking-wider font-medium">Snittbetyg Beambop</div>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-8">
          <Briefcase className="w-10 h-10 text-brand-accent mb-4" />
          <div className="text-4xl font-light text-brand-dark mb-1">8</div>
          <div className="text-sm text-brand-muted uppercase tracking-wider font-medium">Follow up cleaning</div>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-8">
          <ThumbsDown className="w-10 h-10 text-red-500 mb-4" />
          <div className="text-4xl font-light text-brand-dark mb-1">3</div>
          <div className="text-sm text-brand-muted uppercase tracking-wider font-medium text-center">
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
                    {fb.rating === 'RED' && <Frown className="w-8 h-8 text-brand-accent" />}
                    <div>
                      <div className="font-serif text-brand-dark text-sm">{fb.customer}</div>
                      <div className="text-xs text-brand-muted">Städare: {fb.cleaner}</div>
                    </div>
                  </div>
                  <span className="text-xs font-medium text-gray-400">{fb.time}</span>
                </div>
                <p className="text-sm text-brand-muted mt-3 bg-white border border-gray-100 p-3 rounded-xl shadow-sm">
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
            <thead className="text-xs text-brand-muted uppercase bg-gray-50">
              <tr>
                <th className="px-6 py-3">Personal</th>
                <th className="px-6 py-3 text-right">Betyg</th>
              </tr>
            </thead>
            <tbody>
              {staffTopBeambop.map((s, i) => (
                <tr key={i} className="border-b border-gray-50 hover:bg-gray-50/50">
                  <td className="px-6 py-3 font-medium text-brand-dark">{i + 1}. {s.name}</td>
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
  const [staffData, setStaffData] = React.useState<{
    employees: { id: number; name: string; phone: string; email: string; hours: number; revenue: number; sickDays: number; absenceDays: number; missions: number; occupancy: number }[];
    totalEmployees: number;
    totalHours: number;
    avgOccupancy: number;
  } | null>(null);
  const [isLoading, setIsLoading] = React.useState(true);

  React.useEffect(() => {
    const fetchStaff = async () => {
      try {
        const resp = await fetch('/api/timewave-summary/staff');
        if (resp.ok) {
          setStaffData(await resp.json());
        }
      } catch (err) {
        console.error('Failed to fetch staff data:', err);
      } finally {
        setIsLoading(false);
      }
    };
    fetchStaff();
  }, []);

  const currentMonthName = new Date().toLocaleString('sv-SE', { month: 'long' });

  return (
    <div className="space-y-6">
      {isLoading ? (
        <div className="flex justify-center py-12"><RefreshCw className="w-8 h-8 animate-spin text-gray-400" /></div>
      ) : staffData ? (
        <>
          {/* KPIs */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Card>
              <CardContent className="p-5 flex flex-col items-center justify-center text-center">
                <Users className="w-6 h-6 text-brand-accent mb-2" />
                <div className="text-3xl font-light text-brand-dark mb-1">{staffData.totalEmployees}</div>
                <div className="text-[10px] text-brand-muted uppercase tracking-wider font-medium">Anställda</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-5 flex flex-col items-center justify-center text-center">
                <Clock className="w-6 h-6 text-brand-accent mb-2" />
                <div className="text-3xl font-light text-brand-dark mb-1">{fmt(staffData.totalHours)} h</div>
                <div className="text-[10px] text-brand-muted uppercase tracking-wider font-medium">Totala Timmar</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-5 flex flex-col items-center justify-center text-center">
                <TrendingUp className="w-6 h-6 text-emerald-500 mb-2" />
                <div className={`text-3xl font-light mb-1 ${staffData.avgOccupancy >= 70 ? 'text-emerald-600' : staffData.avgOccupancy >= 50 ? 'text-amber-500' : 'text-red-500'}`}>
                  {staffData.avgOccupancy}%
                </div>
                <div className="text-[10px] text-brand-muted uppercase tracking-wider font-medium">Snitt Beläggning</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-5 flex flex-col items-center justify-center text-center">
                <AlertTriangle className="w-6 h-6 text-red-500 mb-2" />
                <div className="text-3xl font-light text-red-600 mb-1">
                  {staffData.employees.reduce((s, e) => s + e.sickDays, 0)}
                </div>
                <div className="text-[10px] text-brand-muted uppercase tracking-wider font-medium">Sjukdagar Totalt</div>
              </CardContent>
            </Card>
          </div>

          {/* Staff table */}
          <Card>
            <CardContent className="p-0">
              <div className="p-5 border-b border-gray-100">
                <h4 className="text-sm font-semibold text-brand-dark">All Personal — {currentMonthName}</h4>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm text-left">
                  <thead className="text-[10px] text-brand-muted uppercase bg-gray-50 tracking-wider">
                    <tr>
                      <th className="px-4 py-3">Namn</th>
                      <th className="px-4 py-3 text-right">Timmar</th>
                      <th className="px-4 py-3 text-right">Intäkter</th>
                      <th className="px-4 py-3 text-center">Uppdrag</th>
                      <th className="px-4 py-3 text-center">Sjuk</th>
                      <th className="px-4 py-3 text-center">Frånvaro</th>
                      <th className="px-4 py-3 text-right">Beläggning</th>
                    </tr>
                  </thead>
                  <tbody>
                    {staffData.employees.map((emp, i) => (
                      <tr key={emp.id} className="border-b border-gray-50 hover:bg-gray-50/50">
                        <td className="px-4 py-3">
                          <div className="font-medium text-brand-dark">{emp.name}</div>
                          {emp.phone && <div className="text-[10px] text-brand-muted">{emp.phone}</div>}
                        </td>
                        <td className="px-4 py-3 text-right text-brand-muted">{emp.hours} h</td>
                        <td className="px-4 py-3 text-right font-medium text-brand-dark">{fmt(emp.revenue)} kr</td>
                        <td className="px-4 py-3 text-center text-brand-muted">{emp.missions}</td>
                        <td className="px-4 py-3 text-center">
                          {emp.sickDays > 0 ? (
                            <span className="text-red-600 font-medium">{emp.sickDays}</span>
                          ) : (
                            <span className="text-gray-300">0</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-center">
                          {emp.absenceDays > 0 ? (
                            <span className="text-amber-600 font-medium">{emp.absenceDays}</span>
                          ) : (
                            <span className="text-gray-300">0</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${
                            emp.occupancy >= 80 ? 'bg-emerald-100 text-emerald-700' :
                            emp.occupancy >= 50 ? 'bg-amber-100 text-amber-700' :
                            emp.occupancy > 0 ? 'bg-red-100 text-red-700' :
                            'bg-gray-100 text-gray-400'
                          }`}>
                            {emp.occupancy}%
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </>
      ) : (
        <div className="text-center py-12 text-brand-muted">Kunde inte hämta personaldata.</div>
      )}
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
            <thead className="text-xs text-brand-muted uppercase bg-gray-50">
              <tr>
                <th className="px-6 py-3">Kund/Projekt</th>
                <th className="px-6 py-3">Orsak</th>
                <th className="px-6 py-3 text-right">Marginal</th>
              </tr>
            </thead>
            <tbody>
              {actionListMinusCustomers.map((c, i) => (
                <tr key={i} className="border-b border-gray-50 hover:bg-gray-50/50">
                  <td className="px-6 py-3 font-medium text-brand-dark">{c.name}</td>
                  <td className="px-6 py-3 text-brand-muted">{c.reason}</td>
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
            <thead className="text-xs text-brand-muted uppercase bg-gray-50">
              <tr>
                <th className="px-6 py-3">Personal</th>
                <th className="px-6 py-3 text-center">Tillfällen</th>
                <th className="px-6 py-3 text-right">Totalt Dagar</th>
              </tr>
            </thead>
            <tbody>
              {actionListHighSickLeave.map((s, i) => (
                <tr key={i} className="border-b border-gray-50 hover:bg-gray-50/50">
                  <td className="px-6 py-3 font-medium text-brand-dark">{s.name}</td>
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
            <thead className="text-xs text-brand-muted uppercase bg-gray-50">
              <tr>
                <th className="px-6 py-3">Personal</th>
                <th className="px-6 py-3 text-center">Antal Klagomål</th>
                <th className="px-6 py-3">Detaljer</th>
              </tr>
            </thead>
            <tbody>
              {actionListComplaints.map((s, i) => (
                <tr key={i} className="border-b border-gray-50 hover:bg-gray-50/50">
                  <td className="px-6 py-3 font-medium text-brand-dark">{s.name}</td>
                  <td className="px-6 py-3 text-center text-[#FF6B6B] font-bold">{s.complaints}</td>
                  <td className="px-6 py-3 text-brand-muted">{s.details}</td>
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
            <thead className="text-xs text-brand-muted uppercase bg-gray-50">
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
                  <td className="px-6 py-3 font-medium text-brand-dark">{inv.invoiceNo}</td>
                  <td className="px-6 py-3 text-brand-muted">{inv.customer}</td>
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

const SalesView = () => {
  const [fortnoxAuth, setFortnoxAuth] = React.useState(false);
  const [fortnoxLoading, setFortnoxLoading] = React.useState(true);
  const [fortnoxData, setFortnoxData] = React.useState<{
    overdueCount: number;
    overdueTotal: number;
    overdueInvoices: { number: string; customerName: string; total: number; balance: number; dueDate: string; daysOverdue: number }[];
    unpaidCount: number;
    unpaidTotal: number;
    paidThisMonthTotal: number;
  } | null>(null);

  React.useEffect(() => {
    const checkFortnox = async () => {
      try {
        const statusResp = await fetch('/api/fortnox/status');
        const status = await statusResp.json();
        setFortnoxAuth(status.authenticated);
        if (status.authenticated) {
          const summaryResp = await fetch('/api/fortnox/summary');
          if (summaryResp.ok) {
            setFortnoxData(await summaryResp.json());
          }
        }
      } catch (err) {
        console.error('Fortnox check failed:', err);
      } finally {
        setFortnoxLoading(false);
      }
    };
    checkFortnox();

    // Listen for auth success
    const handleMessage = (e: MessageEvent) => {
      if (e.data?.type === 'FORTNOX_AUTH_SUCCESS') {
        setFortnoxAuth(true);
        setFortnoxLoading(true);
        checkFortnox();
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  const connectFortnox = async () => {
    try {
      const resp = await fetch('/api/fortnox/auth-url');
      const { url } = await resp.json();
      window.open(url, 'fortnox_auth', 'width=600,height=700');
    } catch (err) {
      console.error('Failed to get Fortnox auth URL:', err);
    }
  };

  return (
    <div className="space-y-6">
      {/* Fortnox Connection */}
      {!fortnoxAuth && !fortnoxLoading && (
        <div className="bg-white rounded-2xl border border-gray-100 p-6 shadow-sm flex flex-col md:flex-row items-center justify-between gap-4">
          <div>
            <h3 className="text-lg font-serif text-brand-dark tracking-tight">Fortnox Integration</h3>
            <p className="text-sm text-brand-muted mt-1">Koppla ditt Fortnox-konto för att se fakturor, förfallna betalningar och reskontra.</p>
          </div>
          <button
            onClick={connectFortnox}
            className="px-6 py-3 bg-[#2B8A3E] text-white rounded-xl text-sm font-bold tracking-wider uppercase shadow-sm hover:-translate-y-0.5 transition-all duration-300"
          >
            KOPPLA FORTNOX
          </button>
        </div>
      )}

      {fortnoxLoading && (
        <div className="flex justify-center py-8">
          <RefreshCw className="w-8 h-8 animate-spin text-gray-400" />
        </div>
      )}

      {fortnoxAuth && fortnoxData && (
        <>
          {/* Fortnox KPIs */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Card>
              <CardContent className="p-5 flex flex-col items-center justify-center text-center">
                <AlertTriangle className="w-6 h-6 text-red-500 mb-2" />
                <div className="text-3xl font-light text-red-600 mb-1">{fortnoxData.overdueCount}</div>
                <div className="text-[10px] text-brand-muted uppercase tracking-wider font-medium">Förfallna Fakturor</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-5 flex flex-col items-center justify-center text-center">
                <div className="text-2xl font-light text-red-600 mb-1">{fmt(fortnoxData.overdueTotal)} kr</div>
                <div className="text-[10px] text-brand-muted uppercase tracking-wider font-medium">Förfallet Belopp</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-5 flex flex-col items-center justify-center text-center">
                <Clock className="w-6 h-6 text-amber-500 mb-2" />
                <div className="text-3xl font-light text-brand-dark mb-1">{fortnoxData.unpaidCount}</div>
                <div className="text-[10px] text-brand-muted uppercase tracking-wider font-medium">Obetalda Fakturor</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-5 flex flex-col items-center justify-center text-center">
                <div className="text-2xl font-light text-brand-dark mb-1">{fmt(fortnoxData.unpaidTotal)} kr</div>
                <div className="text-[10px] text-brand-muted uppercase tracking-wider font-medium">Obetalt Belopp</div>
              </CardContent>
            </Card>
          </div>

          {/* Overdue invoices table */}
          {fortnoxData.overdueInvoices.length > 0 && (
            <Card>
              <CardContent className="p-0">
                <div className="p-5 border-b border-gray-100">
                  <h4 className="text-sm font-semibold text-brand-dark flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 text-red-500" />
                    Förfallna Fakturor (Fortnox)
                  </h4>
                </div>
                <table className="w-full text-sm text-left">
                  <thead className="text-xs text-brand-muted uppercase bg-gray-50">
                    <tr>
                      <th className="px-5 py-3">Faktura</th>
                      <th className="px-5 py-3">Kund</th>
                      <th className="px-5 py-3 text-right">Belopp</th>
                      <th className="px-5 py-3 text-right">Kvar att betala</th>
                      <th className="px-5 py-3 text-center">Förfallodatum</th>
                      <th className="px-5 py-3 text-center">Dagar försenad</th>
                    </tr>
                  </thead>
                  <tbody>
                    {fortnoxData.overdueInvoices.map((inv, i) => (
                      <tr key={i} className="border-b border-gray-50 hover:bg-gray-50/50">
                        <td className="px-5 py-3 font-medium text-brand-dark">#{inv.number}</td>
                        <td className="px-5 py-3 text-brand-muted">{inv.customerName}</td>
                        <td className="px-5 py-3 text-right">{fmt(inv.total)} kr</td>
                        <td className="px-5 py-3 text-right font-medium text-red-600">{fmt(inv.balance)} kr</td>
                        <td className="px-5 py-3 text-center text-brand-muted">{inv.dueDate}</td>
                        <td className="px-5 py-3 text-center">
                          <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${
                            inv.daysOverdue > 30 ? 'bg-red-100 text-red-700' :
                            inv.daysOverdue > 14 ? 'bg-orange-100 text-orange-700' :
                            'bg-amber-100 text-amber-700'
                          }`}>
                            {inv.daysOverdue} dagar
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
};

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
          <h3 className="text-lg font-serif text-brand-dark tracking-tight">TimeWave Integration</h3>
          <p className="text-sm text-brand-muted mt-1">Här kopplas TimeWave ärenden in när API-nyckel är klar.</p>
        </div>
        <button className="px-4 py-2 bg-[#faf8f5] border border-[#eae4d9] rounded-xl text-xs font-bold text-[#5c5750] tracking-widest uppercase shadow-sm hover:bg-white hover:-translate-y-0.5 transition-all duration-300">
          CONNECT TIMEWAVE API (COMING SOON)
        </button>
      </div>

      <Card>
        <div className="px-6 py-4 border-b border-gray-100 flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white">
          <h3 className="font-serif text-brand-dark tracking-tight">Ärenden</h3>
          <div className="flex items-center gap-2">
            <span className="px-3 py-1.5 bg-gray-50 border border-gray-200 rounded-lg text-xs font-medium text-brand-muted cursor-pointer hover:bg-gray-100">Status</span>
            <span className="px-3 py-1.5 bg-gray-50 border border-gray-200 rounded-lg text-xs font-medium text-brand-muted cursor-pointer hover:bg-gray-100">Prioritet</span>
            <span className="px-3 py-1.5 bg-gray-50 border border-gray-200 rounded-lg text-xs font-medium text-brand-muted cursor-pointer hover:bg-gray-100">Kategori</span>
          </div>
        </div>
        <CardContent className="p-0 overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead className="text-xs text-brand-muted uppercase bg-gray-50">
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
                  <td colSpan={7} className="px-6 py-8 text-center text-sm text-brand-muted">
                    <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2 text-gray-400" />
                    Laddar ärenden...
                  </td>
                </tr>
              ) : issues.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-6 py-8 text-center text-sm text-brand-muted">
                    Inga ärenden hittades.
                  </td>
                </tr>
              ) : (
                issues.map((issue: any) => (
                  <tr key={issue.id} className="border-b border-gray-50 hover:bg-gray-50/50">
                    <td className="px-6 py-4 font-medium text-brand-dark">#{issue.number || issue.id}</td>
                    <td className="px-6 py-4">{issue.client_name || issue.client?.name || 'Okänd'}</td>
                    <td className="px-6 py-4 text-brand-muted">{issue.type_name || issue.type?.name || 'Allmänt'}</td>
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
                        issue.priority_id === 1 ? "bg-[#FF6B6B]/10 text-[#FF6B6B]" : "bg-gray-100 text-brand-muted"
                      )}>
                        {issue.priority_name || issue.priority?.name || 'Normal'}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-brand-muted">
                      {issue.created_at ? new Date(issue.created_at).toISOString().split('T')[0] : 'N/A'}
                    </td>
                    <td className="px-6 py-4 text-brand-muted">{issue.assigned_to_name || issue.assignedTo?.name || 'Ej tilldelad'}</td>
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
          <span className="text-sm font-serif text-brand-dark tracking-tight">Outlook Integration</span>
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
            <a href="#" className="flex items-center gap-3 px-3 py-2 bg-white rounded-lg text-sm font-medium text-brand-accent shadow-sm border border-gray-100">
              <Inbox className="w-4 h-4" /> Inbox
            </a>
            <a href="#" className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium text-brand-muted hover:bg-gray-50">
              <Send className="w-4 h-4" /> Sent
            </a>
            <a href="#" className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium text-brand-muted hover:bg-gray-50">
              <File className="w-4 h-4" /> Drafts
            </a>
            <a href="#" className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium text-brand-muted hover:bg-gray-50">
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
              <div className="p-4 text-center text-sm text-brand-muted">Laddar...</div>
            ) : !isConnected ? (
              <div className="p-4 text-center text-sm text-brand-muted">
                Koppla ditt Outlook-konto för att se dina mail här.
              </div>
            ) : emails.length === 0 ? (
              <div className="p-4 text-center text-sm text-brand-muted">Inga mail hittades.</div>
            ) : (
              emails.map((email) => (
                <div
                  key={email.id}
                  onClick={() => setSelectedEmail(email)}
                  className={cn(
                    "p-3 border-b border-gray-50 cursor-pointer transition-colors",
                    selectedEmail?.id === email.id ? "bg-brand-accent/10/50" : "hover:bg-gray-50/50",
                    !email.isRead && "bg-gray-50/30"
                  )}
                >
                  <div className="flex justify-between items-baseline mb-1">
                    <span className={cn("text-sm truncate pr-2", !email.isRead ? "font-serif text-brand-dark" : "font-medium text-brand-muted")}>
                      {email.sender?.emailAddress?.name || email.sender?.emailAddress?.address || 'Okänd'}
                    </span>
                    <span className={cn("text-xs shrink-0", !email.isRead ? "text-brand-accent font-medium" : "text-gray-400")}>
                      {formatDate(email.receivedDateTime)}
                    </span>
                  </div>
                  <p className={cn("text-xs mb-1 truncate", !email.isRead ? "font-serif text-brand-dark" : "text-brand-muted")}>
                    {email.subject || '(Inget ämne)'}
                  </p>
                  <p className="text-xs text-brand-muted truncate">{email.bodyPreview}</p>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Preview */}
        <div className="flex-1 hidden lg:flex flex-col bg-brand-bg">
          {selectedEmail ? (
            <>
              <div className="p-6 border-b border-gray-100 bg-white">
                <h2 className="text-xl font-serif text-brand-dark mb-4">{selectedEmail.subject || '(Inget ämne)'}</h2>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-brand-accent/20 flex items-center justify-center text-brand-accent font-bold uppercase">
                      {(selectedEmail.sender?.emailAddress?.name || selectedEmail.sender?.emailAddress?.address || '?').charAt(0)}
                    </div>
                    <div>
                      <p className="text-sm font-medium text-brand-dark">
                        {selectedEmail.sender?.emailAddress?.name || 'Okänd'} <span className="text-brand-muted font-normal">&lt;{selectedEmail.sender?.emailAddress?.address}&gt;</span>
                      </p>
                    </div>
                  </div>
                  <span className="text-sm text-brand-muted">{formatDate(selectedEmail.receivedDateTime)}</span>
                </div>
              </div>
              <div className="p-6 text-sm text-brand-muted leading-relaxed overflow-y-auto whitespace-pre-wrap">
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
    { id: 'sales', label: 'FÖRSÄLJNING', icon: TrendingUp },
    { id: 'staff', label: 'PERSONAL', icon: Briefcase },
    { id: 'actions', label: 'ACTIONLISTA', icon: AlertTriangle },
    { id: 'tickets', label: 'ÄRENDEHANTERING', icon: ClipboardList },
    { id: 'mail', label: 'MAIL', icon: Mail },
    { id: 'newsletter', label: 'NYHETSBREV', icon: Newspaper },
  ];

  return (
    <>
      <Show
        when="signed-in"
        fallback={
          <div className="min-h-screen bg-brand-bg flex items-center justify-center ">
            <div className="flex flex-col items-center">
              <img src="/logotyp1.png" alt="Städona Logo" className="h-14 w-auto mb-6" />
              <SignIn />
            </div>
          </div>
        }
      >
        <div className="min-h-screen bg-brand-bg flex flex-col md:flex-row  text-brand-dark">
          {/* Sidebar */}
          <aside className="w-full md:w-64 bg-white border-r border-gray-100 flex-shrink-0 flex flex-col">
            <div className="p-6 flex flex-col items-center text-center cursor-pointer" onClick={() => setActiveTab('overview')}>
              <img src="/logotyp1.png" alt="Städona Logo" className="h-10 w-auto mb-1" />
              <p className="text-sm text-brand-dark font-serif italic tracking-wide">Dashboard</p>
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
                        ? "bg-brand-accent/10 text-brand-accent shadow-sm"
                        : "text-brand-muted hover:bg-gray-50 hover:text-brand-dark"
                    )}
                  >
                    <Icon className={cn("w-5 h-5", isActive ? "text-brand-accent" : "text-gray-400")} />
                    {tab.label}
                  </button>
                );
              })}
            </nav>
            <div className="px-6 py-4 border-t border-gray-100 flex items-center gap-3">
              <UserButton afterSignOutUrl="/" />
              <span className="text-xs text-brand-muted">Konto</span>
            </div>
          </aside>

          {/* Main Content */}
          <main className="flex-1 overflow-auto bg-brand-bg">
            <header className="bg-white/80 backdrop-blur-md border-b border-gray-100 px-8 py-6 sticky top-0 z-10">
              <h2 className="text-2xl font-serif text-brand-dark tracking-tight">
                {tabs.find(t => t.id === activeTab)?.label}
              </h2>
            </header>
            <div className="p-8 max-w-7xl mx-auto">
              {activeTab === 'overview' && <OverviewView />}
              {activeTab === 'sales' && <><CustomersView /><div className="mt-8"><SalesView /></div></>}
              {activeTab === 'staff' && <StaffView />}
              {activeTab === 'actions' && <ActionListView />}
              {activeTab === 'tickets' && <TicketsView />}
              {activeTab === 'mail' && <MailView />}
              {activeTab === 'newsletter' && <NewsletterView />}
            </div>
          </main>
        </div>
      </Show>
    </>
  );
}
