/**
 * SJUKFRÅNVARO-TEST — helt ny flik som visar sjukfrånvaro-datan från
 * den delade sickLeaveService. Byggd för att verifiera att servicen
 * fungerar utan cache-krångel från gamla HR-vyn.
 */
import { useEffect, useState } from 'react';
import { Loader, Activity } from 'lucide-react';
import { api } from './lib/api';

interface ScanResult {
  ok: boolean;
  windowStart: string;
  windowEnd: string;
  months: string[];
  monthlyTotals: Record<string, { totalDays: number; employees: number }>;
  totalMissions: number;
  sickMissionsFound: number;
  employeesWithSickness: number;
  elapsedMs: number;
  sickServiceIdUsed: number;
  summary: Array<{
    timewaveEmployeeId: number;
    name: string;
    email: string | null;
    episodes: number;
    days: number;
    latest: string;
    byMonth: Record<string, number>;
    triggeredThreshold: 'STRONG' | 'WARNING' | 'DAYS' | null;
  }>;
}

export default function SjukfranvaroTestView() {
  const [data, setData] = useState<ScanResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [raw, setRaw] = useState<any>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await api<any>('/api/hr/sick-leave/scan', { method: 'POST', body: '{}' });
      setData(r);
      setRaw(r);
    } catch (e: any) {
      setError(e?.body?.error || e?.message || 'okänt fel');
      setRaw(e?.body || { error: e?.message });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  return (
    <div className="p-8 bg-brand-bg min-h-[calc(100vh-64px)] max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-serif text-brand-dark flex items-center gap-2">
            <Activity className="w-5 h-5 text-rose-500" />
            SJUKFRÅNVARO (ny test-vy)
          </h1>
          <p className="text-sm text-brand-muted mt-1">
            Direkt från Timewave via delad sickLeaveService — samma källa som Översikten.
          </p>
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="px-4 py-2 bg-brand-dark text-white rounded-lg text-sm font-medium disabled:opacity-50"
        >
          {loading ? 'Hämtar…' : 'Uppdatera'}
        </button>
      </div>

      {loading && (
        <div className="py-16 text-center text-brand-muted">
          <Loader className="animate-spin mx-auto" size={24} />
          <div className="mt-2 text-sm">Hämtar från Timewave (~10-20 sek första gången)…</div>
        </div>
      )}

      {error && (
        <div className="p-4 bg-rose-50 border border-rose-200 rounded-lg mb-4">
          <div className="font-semibold text-rose-900">❌ Fel från servern</div>
          <pre className="mt-2 text-xs text-rose-800 whitespace-pre-wrap">{error}</pre>
          <pre className="mt-2 text-[10px] text-rose-700/70 whitespace-pre-wrap overflow-auto max-h-40">
            {JSON.stringify(raw, null, 2)}
          </pre>
        </div>
      )}

      {data && (
        <>
          {/* Debug-info längst upp så vi ser vad servern rapporterar */}
          <div className="mb-4 p-3 bg-white border border-gray-200 rounded-lg text-xs text-brand-muted flex flex-wrap gap-4">
            <span>Fönster: <strong className="text-brand-dark">{data.windowStart} → {data.windowEnd}</strong></span>
            <span>Totalt missions: <strong>{data.totalMissions}</strong></span>
            <span>Sjuk-missions hittade: <strong className="text-rose-700">{data.sickMissionsFound}</strong></span>
            <span>Anställda med sjukfrånvaro: <strong className="text-rose-700">{data.employeesWithSickness}</strong></span>
            <span>Service-ID: <strong>{data.sickServiceIdUsed}</strong></span>
            <span>Tid: <strong>{data.elapsedMs} ms</strong></span>
          </div>

          {/* Månadsöversikt */}
          {data.months && data.months.length > 0 && (
            <div className="bg-white border border-gray-200 rounded-lg mb-4 overflow-hidden">
              <div className="px-4 py-2 bg-gray-50 border-b border-gray-100 text-xs font-semibold text-brand-muted uppercase tracking-wide">
                Sjukfrånvaro månad för månad
              </div>
              <div className="grid" style={{ gridTemplateColumns: `repeat(${data.months.length}, minmax(0, 1fr))` }}>
                {data.months.map((m) => {
                  const label = new Intl.DateTimeFormat('sv-SE', { month: 'long', year: 'numeric', timeZone: 'Europe/Stockholm' }).format(new Date(m + '-01'));
                  const t = data.monthlyTotals[m] || { totalDays: 0, employees: 0 };
                  return (
                    <div key={m} className="p-4 border-r border-gray-100 last:border-r-0">
                      <div className="text-[10px] text-brand-muted uppercase tracking-wide capitalize">{label}</div>
                      <div className="text-2xl font-semibold text-brand-dark tabular-nums mt-1">{t.totalDays}</div>
                      <div className="text-[11px] text-brand-muted">tillfällen · {t.employees} pers</div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Anställda */}
          {data.summary && data.summary.length > 0 ? (
            <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-xs uppercase tracking-wide text-brand-muted">
                  <tr>
                    <th className="px-4 py-3 text-left">Anställd</th>
                    <th className="px-3 py-3 text-center">Tillfällen totalt</th>
                    {data.months.map((m) => (
                      <th key={m} className="px-2 py-3 text-center text-[10px]">
                        {new Intl.DateTimeFormat('sv-SE', { month: 'short', timeZone: 'Europe/Stockholm' }).format(new Date(m + '-01'))}
                      </th>
                    ))}
                    <th className="px-3 py-3 text-left">Trigger</th>
                  </tr>
                </thead>
                <tbody>
                  {data.summary.map((s) => (
                    <tr key={s.timewaveEmployeeId} className="border-t border-gray-100 hover:bg-gray-50/50">
                      <td className="px-4 py-3 font-medium text-brand-dark">{s.name}</td>
                      <td className="px-3 py-3 text-center tabular-nums font-semibold">{s.days}</td>
                      {data.months.map((m) => {
                        const d = s.byMonth?.[m] ?? 0;
                        return (
                          <td key={m} className={`px-2 py-3 text-center text-xs tabular-nums ${d === 0 ? 'text-gray-300' : 'text-brand-dark'}`}>
                            {d || '·'}
                          </td>
                        );
                      })}
                      <td className="px-3 py-3">
                        {s.triggeredThreshold === 'STRONG' && <span className="text-xs px-2 py-0.5 rounded bg-rose-600 text-white">≥6 tillfällen</span>}
                        {s.triggeredThreshold === 'WARNING' && <span className="text-xs px-2 py-0.5 rounded bg-amber-500 text-white">4-5 tillfällen</span>}
                        {s.triggeredThreshold === 'DAYS' && <span className="text-xs px-2 py-0.5 rounded bg-orange-500 text-white">≥21 dagar</span>}
                        {!s.triggeredThreshold && <span className="text-xs text-brand-muted">ok</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="py-12 text-center bg-white border border-dashed border-gray-300 rounded-lg">
              <div className="text-sm text-brand-muted">Ingen sjukfrånvaro hittades senaste 3 månaderna.</div>
              <details className="mt-4 text-xs text-brand-muted text-left max-w-xl mx-auto">
                <summary className="cursor-pointer">Visa rå-svar från servern</summary>
                <pre className="mt-2 whitespace-pre-wrap">{JSON.stringify(data, null, 2)}</pre>
              </details>
            </div>
          )}
        </>
      )}
    </div>
  );
}
