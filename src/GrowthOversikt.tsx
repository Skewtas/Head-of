/**
 * GrowthOversikt — bokningstratten på boka.stodona.se, på Översikten.
 *
 * Visar hur många som besöker bokningssidan, påbörjar en bokning och bokar,
 * och var på vägen flest faller bort. Siffrorna kommer färdigräknade från
 * Bokis mätning via /api/dashboard/growth och gäller bara det publika
 * formuläret — bokningar som admin eller säljare lägger in räknas inte.
 *
 * Inga belopp visas här: Bokis räknar på kundens pris efter RUT. Hela Growth
 * Dashboard med intäkter, källor och tjänster finns i Bokis admin.
 */
import { useEffect, useState } from 'react';
import { ExternalLink, Loader, TrendingUp } from 'lucide-react';
import { api } from './lib/api';

interface Steg { key: string; attempts: number; continuedPercent: number | null; droppedPercent: number | null; lost: number | null }
interface Period {
  sinceMs: number; untilMs: number;
  visits: number; started: number; completed: number; quotes: number; abandoned: number;
  conversionPercent: number | null; subscriptions: number; subscriptionSharePercent: number | null;
  biggestDrop: { from: string; to: string; lost: number; droppedPercent: number } | null;
  steps: Steg[];
}
interface GrowthData { days: number; current: Period; previous: Period }

const STEG: Record<string, string> = {
  booking_page_view: 'Besökte bokningssidan',
  booking_started: 'Påbörjade bokning',
  service_selected: 'Valde tjänst',
  property_details_completed: 'Fyllde i bostad och adress',
  price_displayed: 'Såg pris',
  frequency_selected: 'Gick vidare med frekvens',
  availability_viewed: 'Såg lediga tider',
  date_selected: 'Valde dag',
  timeslot_selected: 'Valde tid',
  contact_step_started: 'Började med kontaktuppgifter',
  contact_step_completed: 'Skickade bokningen',
  booking_completed: 'Bokning bekräftad',
};

const procent = (n: number | null) => (n == null ? '–' : `${n.toLocaleString('sv-SE')} %`);

/** Förändring mot förra perioden. Utan underlag visas ingen siffra. */
function andring(nu: number | null, fore: number | null, enhet: 'procent' | 'enheter'): string {
  if (nu == null || fore == null || (enhet === 'procent' && fore === 0)) return 'Ingen jämförelse än';
  const diff = enhet === 'enheter' ? nu - fore : ((nu - fore) / fore) * 100;
  const r = Math.round(diff * 10) / 10;
  const pil = r > 0 ? '▲' : r < 0 ? '▼' : '●';
  return `${pil} ${Math.abs(r).toLocaleString('sv-SE')} ${enhet === 'enheter' ? 'procentenheter' : '%'} mot perioden före`;
}

export default function GrowthOversikt() {
  const [data, setData] = useState<GrowthData | null>(null);
  const [loading, setLoading] = useState(true);
  const [dagar, setDagar] = useState(30);

  useEffect(() => {
    let avbruten = false;
    setLoading(true);
    api<GrowthData>(`/api/dashboard/growth?days=${dagar}`)
      .then((r) => { if (!avbruten) setData(r); })
      .catch((e) => { console.error('growth', e); if (!avbruten) setData(null); })
      .finally(() => { if (!avbruten) setLoading(false); });
    return () => { avbruten = true; };
  }, [dagar]);

  const nu = data?.current;
  const fore = data?.previous;
  const topp = Math.max(nu?.steps[0]?.attempts ?? 0, 1);

  return (
    <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-100 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-full bg-blue-50 text-blue-600 flex items-center justify-center">
            <TrendingUp className="w-4 h-4" />
          </div>
          <div>
            <div className="text-sm font-semibold text-brand-dark">Growth · bokningstratten</div>
            <div className="text-[11px] text-brand-muted">Från Bokis mätning · senaste {dagar} dagarna</div>
          </div>
        </div>
        <div className="flex items-center gap-1 text-xs">
          {[7, 30, 90].map((d) => (
            <button
              key={d}
              onClick={() => setDagar(d)}
              className={`px-2 py-1 rounded ${
                dagar === d ? 'bg-brand-dark text-white' : 'bg-white border border-gray-200 text-brand-muted hover:bg-gray-50'
              }`}
            >
              {d} dgr
            </button>
          ))}
          <a
            href="https://boka.stodona.se/admin"
            target="_blank"
            rel="noopener noreferrer"
            className="ml-2 inline-flex items-center gap-1 text-brand-muted hover:text-brand-dark"
          >
            Hela dashboarden <ExternalLink className="w-3 h-3" />
          </a>
        </div>
      </div>

      {loading && !data ? (
        <div className="px-4 py-8 text-center text-brand-muted">
          <Loader className="animate-spin mx-auto" size={18} />
          <div className="mt-2 text-xs">Hämtar från Bokis…</div>
        </div>
      ) : !nu || !fore ? (
        <div className="px-4 py-8 text-center text-brand-muted text-sm">Kunde inte hämta mätdata just nu.</div>
      ) : nu.visits === 0 ? (
        <div className="px-4 py-8 text-center text-brand-muted text-sm">
          Mätning saknas för perioden. Inga besök på bokningssidan har registrerats än.
        </div>
      ) : (
        <div className="p-4 space-y-5">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
            <Ruta label="Besök" value={String(nu.visits)} under={andring(nu.visits, fore.visits, 'procent')} />
            <Ruta label="Påbörjade bokningar" value={String(nu.started)} under={andring(nu.started, fore.started, 'procent')} />
            <Ruta label="Genomförda bokningar" value={String(nu.completed)} under={andring(nu.completed, fore.completed, 'procent')} />
            <Ruta
              label="Konvertering"
              value={procent(nu.conversionPercent)}
              under={andring(nu.conversionPercent, fore.conversionPercent, 'enheter')}
              highlight
            />
            <Ruta label="Nya abonnemang" value={String(nu.subscriptions)} under={`${procent(nu.subscriptionSharePercent)} av bokningarna`} />
            <Ruta label="Offertförfrågningar" value={String(nu.quotes)} under={andring(nu.quotes, fore.quotes, 'procent')} />
            <Ruta label="Avbrutna försök" value={String(nu.abandoned)} under="Tysta i mer än 30 minuter" />
            <Ruta
              label="Största avhoppet"
              value={nu.biggestDrop ? procent(nu.biggestDrop.droppedPercent) : '–'}
              under={nu.biggestDrop ? `Efter "${STEG[nu.biggestDrop.from] ?? nu.biggestDrop.from}"` : 'Inget avhopp mätt än'}
            />
          </div>

          <ol className="space-y-2">
            {nu.steps.map((s, i) => (
              <li key={s.key} className="grid grid-cols-[minmax(0,13rem)_minmax(0,1fr)_3rem] items-center gap-3 text-xs">
                <span className="truncate text-brand-dark" title={STEG[s.key] ?? s.key}>{i + 1}. {STEG[s.key] ?? s.key}</span>
                <span
                  className="h-2 rounded-full bg-gray-100"
                  title={s.lost != null ? `${s.attempts} försök · ${procent(s.droppedPercent)} (${s.lost}) når inte nästa steg` : `${s.attempts} försök`}
                >
                  <span
                    className="block h-2 rounded-full bg-brand-dark"
                    style={{ width: `${Math.max((s.attempts / topp) * 100, s.attempts ? 1 : 0)}%` }}
                  />
                </span>
                <span className="text-right font-semibold tabular-nums text-brand-dark">{s.attempts}</span>
              </li>
            ))}
          </ol>
          <p className="text-[10px] text-brand-muted italic">
            Gäller det publika bokningsformuläret. Konvertering = bekräftade bokningar av påbörjade försök.
          </p>
        </div>
      )}
    </div>
  );
}

function Ruta({ label, value, under, highlight = false }: { label: string; value: string; under: string; highlight?: boolean }) {
  return (
    <div className={`p-2.5 rounded-lg ${highlight ? 'bg-blue-50' : 'bg-brand-bg'}`}>
      <div className="text-[10px] uppercase tracking-wider text-brand-muted mb-0.5">{label}</div>
      <div className={`text-xl font-semibold tabular-nums ${highlight ? 'text-blue-700' : 'text-brand-dark'}`}>{value}</div>
      <div className="text-[10px] text-brand-muted mt-0.5">{under}</div>
    </div>
  );
}
