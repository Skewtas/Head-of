/**
 * EllaBokningar — Ellas aktivitet på bokningarna hon själv lagt in i Bokis.
 * Visas i Veckouppföljningen bredvid Översikten. Datakälla:
 * /api/dashboard/ella-bokningar (samma urval som hennes egen säljvy i Bokis).
 */
import { useEffect, useState } from 'react';
import { CalendarCheck, Loader } from 'lucide-react';
import { api } from './lib/api';

interface EllaData {
  namn: string;
  malVecka: number | null;
  malManad: number | null;
  idag: number;
  dennaVecka: number;
  forraVecka: number;
  dennaManad: number;
  totalt: number;
  perDag: Array<{ namn: string; datum: string; antal: number; idag: boolean; framtid: boolean }>;
  senaste: Array<{
    id: string;
    createdAt: string;
    customerName: string;
    service: string | null;
    frequency: string | null;
    date: string | null;
    status: string | null;
    prisExMoms: number | null;
  }>;
}

const AVBOKAD = new Set(['Avbokad', 'Avbruten', 'Makulerad', 'cancelled']);

export default function EllaBokningar() {
  const [data, setData] = useState<EllaData | null>(null);
  const [loading, setLoading] = useState(true);
  const [fel, setFel] = useState<string | null>(null);

  useEffect(() => {
    let aktiv = true;
    const hamta = async () => {
      try {
        const r = await api<EllaData>('/api/dashboard/ella-bokningar');
        if (aktiv) { setData(r); setFel(null); }
      } catch (e) {
        if (aktiv) setFel((e as Error).message);
      } finally {
        if (aktiv) setLoading(false);
      }
    };
    hamta();
    const t = setInterval(hamta, 60_000);
    return () => { aktiv = false; clearInterval(t); };
  }, []);

  const fornamn = data?.namn.split(' ')[0] || 'Ella';
  const maxPerDag = Math.max(1, ...(data?.perDag.map((d) => d.antal) ?? []));

  return (
    <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-2">
        <div className="w-8 h-8 rounded-full bg-violet-50 text-violet-600 flex items-center justify-center">
          <CalendarCheck className="w-4 h-4" />
        </div>
        <div>
          <div className="text-sm font-semibold text-brand-dark">{fornamn}s bokningar</div>
          <div className="text-[11px] text-brand-muted">Bokningar kopplade till henne i Bokis · uppdateras varje minut</div>
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
          {fel && <div className="mt-1 text-[11px]">{fel}</div>}
        </div>
      ) : (
        <div className="p-4 space-y-4">
          <div className="grid grid-cols-4 gap-2">
            <Ruta etikett="Idag" varde={data.idag} />
            <Ruta etikett="Veckan" varde={data.dennaVecka} mal={data.malVecka} framhavd />
            <Ruta etikett="Förra v." varde={data.forraVecka} />
            <Ruta etikett="Månaden" varde={data.dennaManad} mal={data.malManad} />
          </div>

          {data.malVecka != null && data.malVecka > 0 && (
            <div>
              <div className="flex justify-between text-[11px] text-brand-muted mb-1">
                <span>Veckomål</span>
                <span className="tabular-nums">
                  {data.dennaVecka >= data.malVecka
                    ? 'Målet uppnått'
                    : `${data.malVecka - data.dennaVecka} kvar`}
                </span>
              </div>
              <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${data.dennaVecka >= data.malVecka ? 'bg-emerald-500' : 'bg-violet-500'}`}
                  style={{ width: `${Math.min(100, Math.round((data.dennaVecka / data.malVecka) * 100))}%` }}
                />
              </div>
            </div>
          )}

          {/* Veckan dag för dag */}
          <div className="flex items-end gap-1.5 h-20">
            {data.perDag.map((d) => (
              <div key={d.datum} className="flex-1 flex flex-col items-center justify-end h-full" title={`${d.datum}: ${d.antal} st`}>
                <div className={`text-[10px] tabular-nums ${d.antal > 0 ? 'text-brand-dark font-semibold' : 'text-gray-300'}`}>
                  {d.framtid ? '' : d.antal}
                </div>
                <div
                  className={`w-full rounded-t ${d.framtid ? 'bg-gray-50' : d.idag ? 'bg-violet-500' : 'bg-violet-200'}`}
                  style={{ height: `${d.framtid ? 4 : Math.max(4, (d.antal / maxPerDag) * 48)}px` }}
                />
                <div className={`mt-1 text-[10px] ${d.idag ? 'text-brand-dark font-semibold' : 'text-brand-muted'}`}>{d.namn}</div>
              </div>
            ))}
          </div>

          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wide text-brand-muted mb-1.5">Senaste bokningarna</div>
            {data.senaste.length === 0 ? (
              <div className="text-xs text-gray-400 italic">Inga bokningar ännu.</div>
            ) : (
              <ul className="divide-y divide-gray-100">
                {data.senaste.map((b) => {
                  const avbokad = !!b.status && AVBOKAD.has(b.status);
                  return (
                    <li key={b.id} className={`py-1.5 flex items-baseline justify-between gap-3 text-xs ${avbokad ? 'opacity-50' : ''}`}>
                      <div className="min-w-0">
                        <div className={`text-brand-dark font-medium truncate ${avbokad ? 'line-through' : ''}`}>{b.customerName}</div>
                        <div className="text-[11px] text-brand-muted truncate">
                          {[b.service, b.frequency, avbokad ? 'avbokad' : null].filter(Boolean).join(' · ')}
                        </div>
                      </div>
                      <div className="text-right whitespace-nowrap">
                        <div className="text-brand-muted">{narBokad(b.createdAt)}</div>
                        {b.prisExMoms != null && (
                          <div className="text-[11px] text-brand-muted tabular-nums">
                            {new Intl.NumberFormat('sv-SE').format(b.prisExMoms)} kr ex. moms
                          </div>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function Ruta({ etikett, varde, mal, framhavd = false }: {
  etikett: string; varde: number; mal?: number | null; framhavd?: boolean;
}) {
  return (
    <div className={`rounded-lg px-2 py-2 text-center ${framhavd ? 'bg-violet-50' : 'bg-gray-50'}`}>
      <div className="text-lg font-semibold text-brand-dark tabular-nums leading-tight">
        {varde}
        {mal != null && mal > 0 && <span className="text-xs font-normal text-brand-muted"> / {mal}</span>}
      </div>
      <div className="text-[10px] text-brand-muted">{etikett}</div>
    </div>
  );
}

/** "idag 09:14", "igår 16:02" eller "3 okt". */
function narBokad(isoTid: string): string {
  const d = new Date(isoTid);
  const dag = (x: Date) => x.toLocaleDateString('sv-SE', { timeZone: 'Europe/Stockholm' });
  const kl = d.toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Stockholm' });
  const nu = new Date();
  if (dag(d) === dag(nu)) return `idag ${kl}`;
  if (dag(d) === dag(new Date(nu.getTime() - 86400000))) return `igår ${kl}`;
  return d.toLocaleDateString('sv-SE', { day: 'numeric', month: 'short', timeZone: 'Europe/Stockholm' });
}
