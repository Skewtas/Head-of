/**
 * OnlineBookingsTrend — visar antal online-bokningar från Bokis/Timewave
 * uppdelat i tre nivåer:
 *   - Dagligt (senaste 30 dagar) med bars + siffra för idag
 *   - Vecka-för-vecka (senaste 12 veckor)
 *   - Månad-för-månad (senaste 12 månader)
 *
 * Används i både Översikten (activeTab='overview') och Veckouppföljningen
 * (OpsView). Delad datasource: /api/dashboard/online-bookings-trend.
 */
import { useEffect, useState } from 'react';
import { CalendarDays, Loader, TrendingUp } from 'lucide-react';
import { api } from './lib/api';

interface TrendData {
  daily: Array<{ date: string; count: number }>;
  weekly: Array<{ weekStart: string; label: string; count: number }>;
  monthly: Array<{ month: string; label: string; count: number }>;
  totals: { today: number; thisWeek: number; thisMonth: number; last30d: number };
  computedAt: string;
  cached?: boolean;
  ageMinutes?: number;
}

type Granularity = 'DAY' | 'WEEK' | 'MONTH';

export default function OnlineBookingsTrend({
  compact = false,
}: { compact?: boolean }) {
  const [data, setData] = useState<TrendData | null>(null);
  const [loading, setLoading] = useState(true);
  const [gran, setGran] = useState<Granularity>('WEEK');

  useEffect(() => {
    (async () => {
      try {
        const r = await api<TrendData>('/api/dashboard/online-bookings-trend');
        setData(r);
      } catch (e) {
        console.error('online-bookings-trend', e);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  return (
    <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-full bg-blue-50 text-blue-600 flex items-center justify-center">
            <CalendarDays className="w-4 h-4" />
          </div>
          <div>
            <div className="text-sm font-semibold text-brand-dark">Bokningar online</div>
            <div className="text-[11px] text-brand-muted">Från Bokis · uppdateras var 30 min</div>
          </div>
        </div>
        <div className="flex items-center gap-1 text-xs">
          {(['DAY', 'WEEK', 'MONTH'] as Granularity[]).map((g) => (
            <button
              key={g}
              onClick={() => setGran(g)}
              className={`px-2 py-1 rounded ${
                gran === g
                  ? 'bg-brand-dark text-white'
                  : 'bg-white border border-gray-200 text-brand-muted hover:bg-gray-50'
              }`}
            >
              {g === 'DAY' ? 'Dag' : g === 'WEEK' ? 'Vecka' : 'Månad'}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="px-4 py-8 text-center text-brand-muted">
          <Loader className="animate-spin mx-auto" size={18} />
          <div className="mt-2 text-xs">Hämtar från Bokis…</div>
        </div>
      ) : !data ? (
        <div className="px-4 py-8 text-center text-brand-muted text-sm">
          Kunde inte hämta data just nu.
        </div>
      ) : (
        <div className="p-4">
          {/* Big-number-strip */}
          {!compact && (
            <div className="grid grid-cols-4 gap-2 mb-4">
              <StatBox label="Idag" value={data.totals.today} />
              <StatBox label="Denna vecka" value={data.totals.thisWeek} />
              <StatBox label="Denna månad" value={data.totals.thisMonth} highlight />
              <StatBox label="Senaste 30 dgr" value={data.totals.last30d} />
            </div>
          )}
          {compact && (
            <div className="flex items-baseline gap-3 mb-3">
              <div className="text-3xl font-semibold text-brand-dark tabular-nums">
                {gran === 'DAY' ? data.totals.today : gran === 'WEEK' ? data.totals.thisWeek : data.totals.thisMonth}
              </div>
              <div className="text-xs text-brand-muted">
                {gran === 'DAY' ? 'idag' : gran === 'WEEK' ? 'denna vecka' : 'denna månad'}
              </div>
            </div>
          )}
          <BarChart
            items={
              gran === 'DAY'
                ? data.daily.map((d) => ({ label: shortDay(d.date), value: d.count, full: d.date }))
                : gran === 'WEEK'
                  ? data.weekly.map((w) => ({ label: w.label, value: w.count, full: w.weekStart }))
                  : data.monthly.map((m) => ({ label: m.label, value: m.count, full: m.month }))
            }
            emphasizeLast
          />
          {data.cached && data.ageMinutes != null && (
            <div className="mt-2 text-[10px] text-brand-muted text-right italic">
              Data {data.ageMinutes} min gammal
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function StatBox({ label, value, highlight = false }: { label: string; value: number; highlight?: boolean }) {
  return (
    <div className={`p-2.5 rounded-lg ${highlight ? 'bg-blue-50' : 'bg-brand-bg'}`}>
      <div className="text-[10px] uppercase tracking-wider text-brand-muted mb-0.5">{label}</div>
      <div className={`text-xl font-semibold tabular-nums ${highlight ? 'text-blue-700' : 'text-brand-dark'}`}>{value}</div>
    </div>
  );
}

function BarChart({
  items, emphasizeLast = false,
}: { items: Array<{ label: string; value: number; full: string }>; emphasizeLast?: boolean }) {
  const max = Math.max(1, ...items.map((i) => i.value));
  return (
    <div>
      <div className="flex items-end gap-1 h-24">
        {items.map((it, idx) => {
          const isLast = idx === items.length - 1;
          const pct = (it.value / max) * 100;
          return (
            <div key={idx} className="flex-1 flex flex-col items-center justify-end group relative">
              <div
                className={`w-full rounded-t transition-all ${
                  emphasizeLast && isLast
                    ? 'bg-brand-dark'
                    : it.value === 0
                      ? 'bg-gray-100'
                      : 'bg-blue-300 group-hover:bg-blue-400'
                }`}
                style={{ height: `${Math.max(2, pct)}%` }}
                title={`${it.full}: ${it.value}`}
              />
              <div className="absolute -top-4 opacity-0 group-hover:opacity-100 text-[10px] font-semibold text-brand-dark bg-white shadow px-1 rounded">
                {it.value}
              </div>
            </div>
          );
        })}
      </div>
      <div className="flex items-center gap-1 mt-1.5">
        {items.map((it, idx) => (
          <div
            key={idx}
            className={`flex-1 text-center text-[9px] truncate ${
              idx === items.length - 1 ? 'text-brand-dark font-semibold' : 'text-brand-muted'
            }`}
            title={it.full}
          >
            {it.label}
          </div>
        ))}
      </div>
    </div>
  );
}

function shortDay(iso: string): string {
  const d = new Date(iso + 'T00:00:00');
  const dow = ['sö', 'må', 'ti', 'on', 'to', 'fr', 'lö'];
  return `${dow[d.getDay()]}${d.getDate()}`;
}
