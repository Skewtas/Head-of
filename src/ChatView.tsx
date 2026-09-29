/**
 * CHATT — vad kunderna frågar Camilla om på stodona.se.
 *
 * Data: /api/chatt/oversikt (inloggad), som läser chat_daily_stats och
 * chat_questions. De fylls varje natt av api/chatt/import-daily.
 *
 * Frågorna är anonymiserade redan på stodona.se (telefon, e-post, personnummer,
 * adress och namn bortrensade) och raderas efter 90 dagar.
 */
import { useEffect, useMemo, useState } from 'react';
import { Loader, MessageCircle, HelpCircle, TrendingUp, Search, ChevronDown, ChevronUp, User, Bot } from 'lucide-react';
import { api } from './lib/api';

interface Oversikt {
  dagar: Array<{ date: string; antalSamtal: number; antalFragor: number }>;
  amnen: Array<{ namn: string; antal: number }>;
  utfall: Array<{ namn: string; antal: number }>;
  totalt: { samtal: number; fragor: number };
  fragor: Array<{ tid: string; text: string; amnen: string[]; utfall: string }>;
  trafik?: { dagar: Array<{ date: string; besok: number }>; totalt: number; sidor: Array<{ sida: string; besok: number }> };
  senastUppdaterad: string | null;
}

const PERIODER = [7, 30, 90] as const;

const UTFALL_TEXT: Record<string, string> = {
  bokningsutkast: 'Fick bokningen förberedd',
  'överlämnat': 'Lämnades över till kundservice',
  lead: 'Ville bli kontaktade',
  tider: 'Tittade på lediga tider',
  pris: 'Fick ett pris',
  'bara frågor': 'Ställde bara frågor',
};

function Stapellista({ rader, text }: { rader: Array<{ namn: string; antal: number }>; text?: Record<string, string> }) {
  const max = Math.max(1, ...rader.map((r) => r.antal));
  if (!rader.length) return <div className="text-sm text-brand-muted">Inga samtal under perioden.</div>;
  return (
    <div className="space-y-2">
      {rader.map((r) => (
        <div key={r.namn}>
          <div className="flex justify-between text-sm">
            <span className="text-brand-dark">{text?.[r.namn] ?? r.namn}</span>
            <span className="tabular-nums font-medium text-brand-dark">{r.antal}</span>
          </div>
          <div className="h-1.5 bg-gray-100 rounded-full mt-1">
            <div className="h-1.5 bg-brand-dark rounded-full" style={{ width: `${(r.antal / max) * 100}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}

export default function ChatView() {
  const [period, setPeriod] = useState<(typeof PERIODER)[number]>(30);
  const [data, setData] = useState<Oversikt | null>(null);
  const [laddar, setLaddar] = useState(true);
  const [fel, setFel] = useState<string | null>(null);
  const [amnesfilter, setAmnesfilter] = useState<string | null>(null);

  useEffect(() => {
    setLaddar(true);
    setFel(null);
    api<Oversikt>(`/api/chatt/oversikt?dagar=${period}`)
      .then(setData)
      .catch((e) => setFel(e?.message ?? 'Kunde inte hämta chattstatistiken'))
      .finally(() => setLaddar(false));
  }, [period]);

  const fragor = useMemo(
    () => (data?.fragor ?? []).filter((f) => !amnesfilter || f.amnen.includes(amnesfilter)),
    [data, amnesfilter]
  );
  const maxDag = Math.max(1, ...(data?.dagar ?? []).map((d) => d.antalSamtal));
  const andel = (namn: string) => {
    const antal = data?.utfall.find((u) => u.namn === namn)?.antal ?? 0;
    return data?.totalt.samtal ? Math.round((antal / data.totalt.samtal) * 100) : 0;
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm text-brand-muted">Vad kunderna frågar Camilla om på stodona.se</p>
          <p className="text-[11px] text-brand-muted">
            Uppdateras varje natt · frågorna är anonymiserade och raderas efter 90 dagar
            {data?.senastUppdaterad ? ` · senast ${new Date(data.senastUppdaterad).toLocaleString('sv-SE')}` : ''}
          </p>
        </div>
        <div className="flex items-center gap-1 text-xs">
          {PERIODER.map((p) => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={`px-3 py-1.5 rounded ${
                period === p ? 'bg-brand-dark text-white' : 'bg-white border border-gray-200 text-brand-muted hover:bg-gray-50'
              }`}
            >
              {p} dagar
            </button>
          ))}
        </div>
      </div>

      {laddar && (
        <div className="flex items-center gap-2 text-brand-muted text-sm">
          <Loader className="w-4 h-4 animate-spin" /> Hämtar chattstatistik…
        </div>
      )}
      {fel && <div className="bg-amber-50 text-amber-800 border border-amber-200 rounded-xl p-4 text-sm">{fel}</div>}

      {data && !laddar && (
        <>
          {data.trafik && data.trafik.dagar.length > 0 && (
            <div className="bg-white border border-gray-200 rounded-xl p-4">
              <div className="flex items-center justify-between gap-3 mb-3">
                <div>
                  <div className="text-sm font-semibold text-brand-dark">Besök på stodona.se</div>
                  <div className="text-[11px] text-brand-muted">
                    Räknas av sajten själv, utan cookies – till skillnad från Google Analytics som bara räknar dem som klickat "Acceptera".
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <div className="text-2xl font-semibold tabular-nums text-brand-dark">{data.trafik.totalt}</div>
                  <div className="text-[11px] text-brand-muted">sidvisningar</div>
                </div>
              </div>
              <div className="flex items-end gap-1 h-20">
                {data.trafik.dagar.map((d) => {
                  const max = Math.max(1, ...data.trafik!.dagar.map((x) => x.besok));
                  return (
                    <div key={d.date} className="flex-1 flex flex-col justify-end h-full" title={`${d.date}: ${d.besok} sidvisningar`}>
                      <div className="w-full bg-brand-accent/70 rounded-t" style={{ height: `${(d.besok / max) * 100}%`, minHeight: d.besok ? 2 : 0 }} />
                    </div>
                  );
                })}
              </div>
              {data.trafik.sidor.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-3">
                  {data.trafik.sidor.map((s) => (
                    <span key={s.sida} className="text-[11px] px-2 py-1 rounded bg-gray-50 text-brand-muted">
                      {s.sida} · {s.besok}
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {[
              { label: 'Samtal', value: data.totalt.samtal },
              { label: 'Frågor', value: data.totalt.fragor },
              { label: 'Fick bokningen förberedd', value: `${andel('bokningsutkast')} %` },
              { label: 'Lämnades över', value: `${andel('överlämnat')} %` },
            ].map((k) => (
              <div key={k.label} className="bg-white border border-gray-200 rounded-xl p-4">
                <div className="text-2xl font-semibold tabular-nums text-brand-dark">{k.value}</div>
                <div className="text-[11px] text-brand-muted mt-1">{k.label}</div>
              </div>
            ))}
          </div>

          <div className="bg-white border border-gray-200 rounded-xl p-4">
            <div className="flex items-center gap-2 mb-3">
              <TrendingUp className="w-4 h-4 text-brand-dark" />
              <div className="text-sm font-semibold text-brand-dark">Samtal per dag</div>
            </div>
            {data.dagar.length ? (
              <div className="flex items-end gap-1 h-28">
                {data.dagar.map((d) => (
                  <div key={d.date} className="flex-1 flex flex-col items-center justify-end h-full" title={`${d.date}: ${d.antalSamtal} samtal, ${d.antalFragor} frågor`}>
                    <div className="w-full bg-brand-dark/80 rounded-t" style={{ height: `${(d.antalSamtal / maxDag) * 100}%`, minHeight: d.antalSamtal ? 2 : 0 }} />
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-sm text-brand-muted">Ingen data ännu – den första hämtningen sker i natt.</div>
            )}
          </div>

          <div className="grid lg:grid-cols-2 gap-4">
            <div className="bg-white border border-gray-200 rounded-xl p-4">
              <div className="flex items-center gap-2 mb-3">
                <MessageCircle className="w-4 h-4 text-brand-dark" />
                <div className="text-sm font-semibold text-brand-dark">Vad samtalen gällde</div>
              </div>
              <Stapellista rader={data.amnen} />
            </div>
            <div className="bg-white border border-gray-200 rounded-xl p-4">
              <div className="flex items-center gap-2 mb-3">
                <HelpCircle className="w-4 h-4 text-brand-dark" />
                <div className="text-sm font-semibold text-brand-dark">Hur samtalen slutade</div>
              </div>
              <Stapellista rader={data.utfall} text={UTFALL_TEXT} />
            </div>
          </div>

          <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100">
              <div className="text-sm font-semibold text-brand-dark">Frågorna</div>
              <div className="flex flex-wrap gap-1 mt-2">
                <button
                  onClick={() => setAmnesfilter(null)}
                  className={`px-2 py-1 rounded text-xs ${!amnesfilter ? 'bg-brand-dark text-white' : 'bg-white border border-gray-200 text-brand-muted'}`}
                >
                  Alla
                </button>
                {data.amnen.map((a) => (
                  <button
                    key={a.namn}
                    onClick={() => setAmnesfilter(a.namn)}
                    className={`px-2 py-1 rounded text-xs ${amnesfilter === a.namn ? 'bg-brand-dark text-white' : 'bg-white border border-gray-200 text-brand-muted'}`}
                  >
                    {a.namn} ({a.antal})
                  </button>
                ))}
              </div>
            </div>
            <table className="w-full text-sm">
              <tbody>
                {fragor.slice(0, 200).map((f, i) => (
                  <tr key={i} className="border-b border-gray-50 align-top">
                    <td className="px-4 py-2 text-brand-muted text-xs whitespace-nowrap tabular-nums">
                      {new Date(f.tid).toLocaleString('sv-SE', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                    </td>
                    <td className="px-4 py-2 text-brand-dark">{f.text}</td>
                    <td className="px-4 py-2 text-xs text-brand-muted whitespace-nowrap">{f.amnen.join(', ')}</td>
                  </tr>
                ))}
                {!fragor.length && (
                  <tr>
                    <td className="px-4 py-3 text-brand-muted">Inga frågor under perioden.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <DialogSokning />
        </>
      )}
    </div>
  );
}

// ─── Sökbar dialog-vy (senaste 7 dagarna) ─────────────────────────────

interface DialogRad {
  samtalsId: string;
  date: string;
  importedAt: string;
  antalMeddelanden: number;
  forstaFraga: string;
  sistaFraga: string | null;
}
interface DialogSvar {
  sokterm: string | null;
  antal: number;
  dialoger: DialogRad[];
}
interface FullDialog {
  samtalsId: string;
  date: string;
  antalMeddelanden: number;
  meddelanden: Array<{ role: string; content: string; verktyg?: boolean }>;
}

function DialogSokning() {
  const [q, setQ] = useState('');
  const [dagar, setDagar] = useState<1 | 3 | 7>(7);
  const [data, setData] = useState<DialogSvar | null>(null);
  const [laddar, setLaddar] = useState(false);
  const [oppen, setOppen] = useState<string | null>(null);
  const [expanderad, setExpanderad] = useState<Record<string, FullDialog>>({});

  // Debounce sök så vi inte hamrar backend
  useEffect(() => {
    const t = setTimeout(() => {
      setLaddar(true);
      const params = new URLSearchParams({ dagar: String(dagar) });
      if (q.trim()) params.set('q', q.trim());
      api<DialogSvar>(`/api/chatt/dialoger?${params}`)
        .then(setData)
        .catch(() => setData({ sokterm: q, antal: 0, dialoger: [] }))
        .finally(() => setLaddar(false));
    }, 250);
    return () => clearTimeout(t);
  }, [q, dagar]);

  // Live: hämta listan igen var 10:e sekund medan fliken är öppen och synlig
  // (Mikaela 2026-09-29: ALLT live).
  useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      const params = new URLSearchParams({ dagar: String(dagar) });
      if (q.trim()) params.set('q', q.trim());
      api<DialogSvar>(`/api/chatt/dialoger?${params}`).then(setData).catch(() => {});
    }, 10_000);
    return () => clearInterval(id);
  }, [q, dagar]);

  const expandera = async (id: string) => {
    if (oppen === id) { setOppen(null); return; }
    setOppen(id);
    if (!expanderad[id]) {
      try {
        const full = await api<FullDialog>(`/api/chatt/dialoger?id=${encodeURIComponent(id)}`);
        setExpanderad((prev) => ({ ...prev, [id]: full }));
      } catch { /* svälj — dialog finns inte längre */ }
    }
  };

  return (
    <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-100">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <div className="text-sm font-semibold text-brand-dark">Hela dialoger</div>
            <div className="text-[11px] text-brand-muted mt-0.5">
              Söker i vad kunder OCH boten skriver · sparas 7 dagar · GDPR-känsligt
            </div>
          </div>
          <div className="flex items-center gap-1 text-xs">
            {([1, 3, 7] as const).map((n) => (
              <button
                key={n}
                onClick={() => setDagar(n)}
                className={`px-2.5 py-1 rounded ${dagar === n ? 'bg-brand-dark text-white' : 'bg-white border border-gray-200 text-brand-muted'}`}
              >
                {n === 1 ? 'Idag' : `${n} dagar`}
              </button>
            ))}
          </div>
        </div>
        <div className="mt-3 relative">
          <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder='Sök i dialogerna, t.ex. "flyttstädning", "återkomma", "kostnad"…'
            className="w-full pl-9 pr-3 py-2 border border-gray-200 rounded-lg text-sm"
          />
        </div>
      </div>

      {laddar && (
        <div className="px-4 py-3 flex items-center gap-2 text-brand-muted text-sm">
          <Loader className="w-4 h-4 animate-spin" /> Söker…
        </div>
      )}
      {!laddar && data && data.dialoger.length === 0 && (
        <div className="px-4 py-6 text-sm text-brand-muted text-center">
          {q.trim() ? `Ingen dialog matchar "${q}".` : 'Inga dialoger de senaste dagarna än.'}
        </div>
      )}

      <ul className="divide-y divide-gray-100">
        {(data?.dialoger ?? []).map((d) => (
          <li key={d.samtalsId} className="text-sm">
            <button
              onClick={() => expandera(d.samtalsId)}
              className="w-full text-left px-4 py-3 hover:bg-gray-50 flex items-start gap-3"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 text-[11px] text-brand-muted">
                  <span className="tabular-nums">
                    {new Date(d.importedAt).toLocaleString('sv-SE', {
                      day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
                    })}
                  </span>
                  <span>·</span>
                  <span>{d.antalMeddelanden} meddelanden</span>
                </div>
                <div className="text-brand-dark mt-1 truncate">{d.forstaFraga || <span className="italic text-brand-muted">Ingen text</span>}</div>
                {d.sistaFraga && (
                  <div className="text-brand-muted text-xs mt-0.5 truncate">→ {d.sistaFraga}</div>
                )}
              </div>
              {oppen === d.samtalsId ? <ChevronUp className="w-4 h-4 text-brand-muted mt-0.5" /> : <ChevronDown className="w-4 h-4 text-brand-muted mt-0.5" />}
            </button>
            {oppen === d.samtalsId && (
              <div className="bg-gray-50 border-t border-gray-100 px-4 py-3">
                {!expanderad[d.samtalsId] ? (
                  <div className="text-brand-muted text-xs flex items-center gap-2">
                    <Loader className="w-3 h-3 animate-spin" /> Hämtar hela samtalet…
                  </div>
                ) : (
                  <div className="space-y-2 max-h-[500px] overflow-y-auto">
                    {expanderad[d.samtalsId].meddelanden.map((m, i) => {
                      const isUser = m.role === 'user';
                      return (
                        <div key={i} className={`flex gap-2 ${isUser ? 'flex-row-reverse' : ''}`}>
                          <div className={`flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center ${isUser ? 'bg-brand-dark text-white' : 'bg-white border border-gray-200 text-brand-muted'}`}>
                            {isUser ? <User className="w-3 h-3" /> : <Bot className="w-3 h-3" />}
                          </div>
                          <div className={`max-w-[80%] px-3 py-2 rounded-lg text-sm whitespace-pre-wrap ${isUser ? 'bg-brand-dark text-white' : 'bg-white border border-gray-200 text-brand-dark'}`}>
                            {m.content || <span className="italic opacity-70">[tomt]</span>}
                            {m.verktyg && <span className="ml-2 text-[10px] uppercase tracking-wide opacity-70">verktyg</span>}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
