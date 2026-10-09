/**
 * EKONOMI — gemensam ekonomisk uppföljning för Stodona AB och Stodona
 * Services AB. All beräkning sker i API:t (/api/ekonomi); den här vyn
 * visar bara resultatet och låter dig borra ned till konto och verifikation.
 *
 * Visningsregler:
 *  - null visas som "saknas", aldrig som 0.
 *  - Testdata visas alltid med en tydlig banderoll.
 *  - Belopp avrundas till hela kronor enbart i visningen.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronRight, CircleDashed, FlaskConical, Link2, RefreshCw, ShieldCheck, ShieldAlert, XCircle } from 'lucide-react';
import { api } from './lib/api';

type CompanyId = 'stodona_ab' | 'stodona_services';
const NAMES: Record<CompanyId, string> = { stodona_ab: 'Stodona AB', stodona_services: 'Stodona Services AB' };
const IDS: CompanyId[] = ['stodona_ab', 'stodona_services'];

const fmtKr = (ore: number | null | undefined) => (ore === null || ore === undefined ? 'saknas' : `${Math.round(ore / 100).toLocaleString('sv-SE')} kr`);
const fmtOre = (ore: number) => (ore / 100).toLocaleString('sv-SE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtPct = (v: number | null | undefined) => (v === null || v === undefined ? 'kan inte beräknas' : `${v.toLocaleString('sv-SE', { minimumFractionDigits: 1 })} %`);
const fmtTime = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString('sv-SE', { dateStyle: 'short', timeStyle: 'short' }) : 'aldrig');
const today = () => new Date().toISOString().slice(0, 10);
const lastMonth = () => {
  const d = new Date();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() - 1);
  return d.toISOString().slice(0, 7);
};

function Cell({ v, unit, strong }: { v: number | null; unit: string; strong?: boolean }) {
  const missing = v === null;
  return (
    <td className={`px-3 py-2 text-right tabular-nums whitespace-nowrap ${missing ? 'text-amber-700 italic' : v! < 0 ? 'text-red-700' : 'text-brand-dark'} ${strong ? 'font-semibold' : ''}`}>
      {unit === 'procent' ? fmtPct(v) : fmtKr(v)}
    </td>
  );
}

function Card({ title, children, tone }: { title: string; children: React.ReactNode; tone?: 'warn' }) {
  return (
    <div className={`bg-white rounded-2xl border p-5 ${tone === 'warn' ? 'border-amber-300' : 'border-gray-100'}`}>
      <div className="text-xs uppercase tracking-wider text-brand-muted mb-2">{title}</div>
      {children}
    </div>
  );
}

function Section({ title, children, defaultOpen = true, badge }: { title: string; children: React.ReactNode; defaultOpen?: boolean; badge?: React.ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="bg-white rounded-2xl border border-gray-100">
      <button onClick={() => setOpen(!open)} className="w-full flex items-center gap-2 px-5 py-4 text-left">
        {open ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
        <h3 className="text-lg font-serif flex-1">{title}</h3>
        {badge}
      </button>
      {open && <div className="px-5 pb-5">{children}</div>}
    </section>
  );
}

const STATUS_ICON: Record<string, React.ReactNode> = {
  ok: <CheckCircle2 size={16} className="text-green-600 shrink-0" />,
  varning: <AlertTriangle size={16} className="text-amber-600 shrink-0" />,
  fel: <XCircle size={16} className="text-red-600 shrink-0" />,
  ej_utford: <CircleDashed size={16} className="text-gray-400 shrink-0" />,
};
const STATUS_TEXT: Record<string, string> = { ok: 'OK', varning: 'Varning', fel: 'Differens', ej_utford: 'Ej utförd' };
const PERIOD_STATUS: Record<string, string> = { preliminar: 'Preliminär', avstamd: 'Avstämd', stangd: 'Stängd' };

// ── Borrning: konto → transaktioner ─────────────────────────────────────────
function Transactions({ company, account, from, to, source }: { company: CompanyId; account: string; from: string; to: string; source: string }) {
  const [data, setData] = useState<any>(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    api(`/api/ekonomi/transactions?company=${company}&account=${encodeURIComponent(account)}&from=${from}&to=${to}&source=${source}`).then(setData).catch((e) => setErr(e.message));
  }, [company, account, from, to, source]);
  if (err) return <div className="text-sm text-red-700 p-2">{err}</div>;
  if (!data) return <div className="text-sm text-brand-muted p-2">Hämtar transaktioner…</div>;
  return (
    <div className="bg-brand-bg/60 rounded-lg p-3 my-1">
      <div className="text-xs text-brand-muted mb-2">{data.rows.length} rader · bokföringens tecken (debet +, kredit −) · öppna underlaget i Fortnox via serie och nummer</div>
      <div className="max-h-72 overflow-auto">
        <table className="w-full text-xs">
          <thead className="text-brand-muted text-left">
            <tr><th className="py-1 pr-3">Datum</th><th className="pr-3">Ver.</th><th className="pr-3">Text</th><th className="pr-3">Underlag</th><th className="pr-3">Intern</th><th className="text-right">Belopp</th></tr>
          </thead>
          <tbody>
            {data.rows.map((r: any, i: number) => (
              <tr key={i} className="border-t border-gray-200/60">
                <td className="py-1 pr-3 whitespace-nowrap">{r.date}</td>
                <td className="pr-3 whitespace-nowrap font-mono">{r.series}{r.number}</td>
                <td className="pr-3">{r.text}</td>
                <td className="pr-3 whitespace-nowrap">{r.refType ? `${r.refType} ${r.refNumber ?? ''}` : '—'}</td>
                <td className="pr-3">{r.internalGroup ?? '—'}</td>
                <td className="text-right tabular-nums whitespace-nowrap">{fmtOre(r.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function AccountDrill({ accounts, period, source }: { accounts: any[]; period: { from: string; to: string }; source: string }) {
  const [open, setOpen] = useState<string | null>(null);
  if (!accounts.length) return <div className="text-sm text-brand-muted px-3 py-2">Inga konton med rörelse.</div>;
  return (
    <div className="px-3 py-2">
      {accounts.map((a) => {
        const k = `${a.companyId}|${a.account}`;
        return (
          <div key={k}>
            <button onClick={() => setOpen(open === k ? null : k)} className="w-full flex items-center gap-3 text-sm py-1 hover:bg-brand-bg/60 rounded px-1 text-left">
              {open === k ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              <span className="font-mono w-12">{a.account}</span>
              <span className="flex-1">{a.name} <span className="text-brand-muted">· {NAMES[a.companyId as CompanyId]}</span></span>
              {a.mappingStatus === 'omappad' && <span className="text-xs px-2 py-0.5 rounded-full bg-red-100 text-red-800">omappat</span>}
              {a.mappingStatus === 'regel' && <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-600" title="Placerat enligt standardregel för kontoklassen — inte bekräftat av dig">standardregel</span>}
              {a.isNew && <span className="text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-800">nytt konto</span>}
              {a.internal !== 0 && <span className="text-xs text-brand-muted">varav internt {fmtKr(a.internal)}</span>}
              <span className="tabular-nums w-32 text-right">{fmtKr(a.amount)}</span>
            </button>
            {open === k && <Transactions company={a.companyId} account={a.account} from={period.from} to={period.to} source={source} />}
          </div>
        );
      })}
    </div>
  );
}

// ── Huvudvy ─────────────────────────────────────────────────────────────────
export default function EkonomiView() {
  const [tab, setTab] = useState<'oversikt' | 'rapport' | 'kontroller' | 'installningar'>('oversikt');
  const [source, setSource] = useState<'live' | 'test'>('live');
  const [ptype, setPtype] = useState<'month' | 'range' | 'ytd' | 'r12' | 'fiscal'>('month');
  const [month, setMonth] = useState(lastMonth());
  const [from, setFrom] = useState(`${today().slice(0, 4)}-01-01`);
  const [to, setTo] = useState(today());
  const [asOf, setAsOf] = useState(today());
  const [fyCompany, setFyCompany] = useState<CompanyId>('stodona_ab');
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [openRow, setOpenRow] = useState<string | null>(null);

  const query = useMemo(() => {
    const q = new URLSearchParams({ source, type: ptype });
    if (ptype === 'month') q.set('month', month);
    if (ptype === 'range') { q.set('from', from); q.set('to', to); }
    if (ptype === 'ytd' || ptype === 'r12' || ptype === 'fiscal') q.set('asOf', asOf);
    if (ptype === 'fiscal') q.set('company', fyCompany);
    return q.toString();
  }, [source, ptype, month, from, to, asOf, fyCompany]);

  const load = useCallback(() => {
    setLoading(true);
    setError('');
    api(`/api/ekonomi/overview?${query}`)
      .then((d) => setData(d))
      .catch((e) => { setError(e.message); setData(null); })
      .finally(() => setLoading(false));
  }, [query]);
  useEffect(load, [load]);

  const row = (id: string) => data?.result.rows.find((r: any) => r.id === id);
  const prevRow = (id: string) => data?.previous.rows.find((r: any) => r.id === id);
  const fiscalOnly: CompanyId | null = data?.ownFiscalYearOnly ?? null;
  const v = data?.verification;
  const noLiveData = data && source === 'live' && data.companies.every((c: any) => !c.sync.lastSuccessAt);

  const delta = (id: string) => {
    const a = row(id)?.total, b = prevRow(id)?.total;
    if (a === null || a === undefined || b === null || b === undefined) return null;
    return a - b;
  };

  return (
    <div className="space-y-5 max-w-7xl">
      {/* Kontroller */}
      <div className="bg-white rounded-2xl border border-gray-100 p-4 flex flex-wrap items-end gap-3">
        <label className="text-xs text-brand-muted">Period
          <select value={ptype} onChange={(e) => setPtype(e.target.value as any)} className="block mt-1 border border-gray-200 rounded-lg px-2 py-1.5 text-sm text-brand-dark">
            <option value="month">Enskild månad</option>
            <option value="range">Valfritt datumintervall</option>
            <option value="ytd">Kalenderår hittills</option>
            <option value="r12">Rullande 12 månader</option>
            <option value="fiscal">Bolagets eget räkenskapsår</option>
          </select>
        </label>
        {ptype === 'month' && <label className="text-xs text-brand-muted">Månad<input type="month" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} className="block mt-1 border border-gray-200 rounded-lg px-2 py-1.5 text-sm text-brand-dark" /></label>}
        {ptype === 'range' && (<>
          <label className="text-xs text-brand-muted">Från<input type="date" value={from} onChange={(e) => e.target.value && setFrom(e.target.value)} className="block mt-1 border border-gray-200 rounded-lg px-2 py-1.5 text-sm text-brand-dark" /></label>
          <label className="text-xs text-brand-muted">Till<input type="date" value={to} onChange={(e) => e.target.value && setTo(e.target.value)} className="block mt-1 border border-gray-200 rounded-lg px-2 py-1.5 text-sm text-brand-dark" /></label>
        </>)}
        {(ptype === 'ytd' || ptype === 'r12' || ptype === 'fiscal') && <label className="text-xs text-brand-muted">Till och med<input type="date" value={asOf} onChange={(e) => e.target.value && setAsOf(e.target.value)} className="block mt-1 border border-gray-200 rounded-lg px-2 py-1.5 text-sm text-brand-dark" /></label>}
        {ptype === 'fiscal' && <label className="text-xs text-brand-muted">Bolag
          <select value={fyCompany} onChange={(e) => setFyCompany(e.target.value as CompanyId)} className="block mt-1 border border-gray-200 rounded-lg px-2 py-1.5 text-sm text-brand-dark">{IDS.map((id) => <option key={id} value={id}>{NAMES[id]}</option>)}</select>
        </label>}
        <div className="flex-1" />
        <div className="flex rounded-lg border border-gray-200 overflow-hidden text-sm">
          <button onClick={() => setSource('live')} className={`px-3 py-1.5 ${source === 'live' ? 'bg-brand-dark text-white' : 'text-brand-dark'}`}>Verklig data</button>
          <button onClick={() => setSource('test')} className={`px-3 py-1.5 flex items-center gap-1 ${source === 'test' ? 'bg-amber-500 text-white' : 'text-brand-dark'}`}><FlaskConical size={14} />Testdata</button>
        </div>
        <button onClick={load} className="p-2 rounded-lg border border-gray-200" title="Läs om"><RefreshCw size={16} className={loading ? 'animate-spin' : ''} /></button>
      </div>

      {data?.isTestData && (
        <div className="rounded-2xl bg-amber-100 border-2 border-amber-400 text-amber-900 px-5 py-3 font-semibold flex items-center gap-2">
          <FlaskConical size={18} /> TESTDATA — påhittade siffror för att visa hur uppföljningen fungerar. Detta är inte bolagens verkliga ekonomi.
        </div>
      )}
      {error && (
        <div className="rounded-2xl bg-red-50 border border-red-200 text-red-800 px-5 py-3 text-sm">
          {error}
          {source === 'live' && <> <button className="underline ml-2" onClick={() => setSource('test')}>Visa med testdata i stället</button></>}
        </div>
      )}
      {noLiveData && (
        <div className="rounded-2xl bg-white border border-gray-200 px-5 py-4 text-sm">
          <strong className="text-brand-dark">Ingen verklig data är importerad ännu.</strong>
          <p className="mt-1">Anslut båda bolagens Fortnox under <button className="underline" onClick={() => setTab('installningar')}>Inställningar</button>. Fram till dess visas alla verkliga värden som "saknas". Du kan titta på hur rapporterna ser ut med <button className="underline" onClick={() => setSource('test')}>testdata</button>.</p>
        </div>
      )}

      <div className="flex gap-1 border-b border-gray-200">
        {([['oversikt', 'Översikt'], ['rapport', 'Resultat och balans'], ['kontroller', 'Kontroller och status'], ['installningar', 'Inställningar']] as const).map(([id, label]) => (
          <button key={id} onClick={() => setTab(id)} className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${tab === id ? 'border-brand-dark text-brand-dark' : 'border-transparent text-brand-muted'}`}>{label}</button>
        ))}
      </div>

      {data && tab !== 'installningar' && (
        <div className={`rounded-2xl border px-5 py-3 text-sm flex flex-wrap items-center gap-x-6 gap-y-1 ${v.status === 'verifierad' ? 'bg-green-50 border-green-200' : 'bg-white border-gray-200'}`}>
          <span className="flex items-center gap-2 font-semibold text-brand-dark">
            {v.status === 'verifierad' ? <ShieldCheck size={18} className="text-green-700" /> : <ShieldAlert size={18} className="text-amber-600" />}
            {v.label}
          </span>
          <span>Period: <strong className="text-brand-dark">{data.period.label}</strong> ({data.period.from} – {data.period.to})</span>
          <span>Status: <strong className="text-brand-dark">{PERIOD_STATUS[v.periodStatus]}</strong></span>
          {data.companies.map((c: any) => (
            <span key={c.id} className={c.sync.lastError ? 'text-red-700' : ''}>{c.name}: uppdaterad {fmtTime(c.sync.lastSuccessAt)}{c.sync.lastError ? ' · senaste försök misslyckades' : ''}</span>
          ))}
          {v.blockers.length > 0 && <button className="underline" onClick={() => setTab('kontroller')}>{v.blockers.length} skäl till att rapporten inte är verifierad</button>}
        </div>
      )}

      {data && tab === 'oversikt' && <Oversikt data={data} row={row} prevRow={prevRow} delta={delta} fiscalOnly={fiscalOnly} />}

      {data && tab === 'rapport' && (
        <div className="space-y-5">
          <Section title="Resultatrapport" badge={<span className="text-xs text-brand-muted">klicka på en rad för konton och transaktioner</span>}>
            {fiscalOnly && <p className="text-sm mb-3">Perioden är {NAMES[fiscalOnly]}s eget räkenskapsår. Det andra bolagets siffror för samma kalenderperiod visas för jämförelse — bolagen har olika räkenskapsår.</p>}
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wider text-brand-muted border-b border-gray-200">
                    <th className="px-3 py-2"></th>
                    <th className="px-3 py-2 text-right">Stodona AB</th>
                    <th className="px-3 py-2 text-right">Stodona Services AB</th>
                    <th className="px-3 py-2 text-right">Elimineringar och justeringar</th>
                    <th className="px-3 py-2 text-right">Verksamheten totalt</th>
                    <th className="px-3 py-2 text-right text-gray-400">Totalt samma period fg. år</th>
                  </tr>
                </thead>
                <tbody>
                  {data.result.rows.map((r: any) => {
                    const strong = r.kind !== 'kategori';
                    const col3 = r.elimination === null && r.adjustment === null ? null : (r.elimination ?? 0) + (r.adjustment ?? 0);
                    const perBolag = !!r.note;
                    return (
                      <React.Fragment key={r.id}>
                        <tr onClick={() => r.kind === 'kategori' && setOpenRow(openRow === r.id ? null : r.id)} title={r.definition} className={`border-b border-gray-100 ${r.kind === 'kategori' ? 'cursor-pointer hover:bg-brand-bg/50' : 'bg-brand-bg/40'}`}>
                          <td className={`px-3 py-2 ${strong ? 'font-semibold text-brand-dark' : ''}`}>
                            {r.kind === 'kategori' && (openRow === r.id ? <ChevronDown size={14} className="inline mr-1" /> : <ChevronRight size={14} className="inline mr-1" />)}
                            {r.label}
                          </td>
                          <Cell v={r.ab} unit={r.unit} strong={strong} />
                          <Cell v={r.services} unit={r.unit} strong={strong} />
                          {r.unit === 'procent' || perBolag ? <td className="px-3 py-2 text-right text-gray-400">—</td> : (
                            <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap">
                              <span className={col3 === null ? 'text-amber-700 italic' : ''}>{fmtKr(col3)}</span>
                              {!!r.adjustment && <div className="text-xs text-brand-muted">varav justering {fmtKr(r.adjustment)}</div>}
                            </td>
                          )}
                          {perBolag ? <td className="px-3 py-2 text-right text-xs text-brand-muted" colSpan={2}>per bolag</td> : (<>
                            <Cell v={r.total} unit={r.unit} strong />
                            <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap text-gray-500">{r.unit === 'procent' ? fmtPct(prevRow(r.id)?.total) : fmtKr(prevRow(r.id)?.total)}</td>
                          </>)}
                        </tr>
                        {openRow === r.id && (
                          <tr><td colSpan={6} className="bg-white">
                            <div className="text-xs text-brand-muted px-3 pt-2">{r.definition}</div>
                            <AccountDrill accounts={data.result.accounts.filter((a: any) => a.category === r.id)} period={data.period} source={source} />
                          </td></tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <ul className="text-xs text-brand-muted mt-3 space-y-1 list-disc pl-5">
              <li>Bolagskolumnerna är respektive bolags bokföring, oförändrad. Intäkter visas positiva, kostnader negativa.</li>
              <li>Elimineringar tar bort båda sidor av interna affärer. Elimineringsdifferens i perioden: <strong>{fmtKr(data.result.eliminationDifference)}</strong> (ska vara 0 kr när bolagens interna bokningar tar ut varandra).</li>
              {IDS.map((id) => data.result.excludedResultTransfer[id] !== 0 && <li key={id}>{NAMES[id]}: bokslutsomföring av årets resultat ({fmtKr(data.result.excludedResultTransfer[id])} på konto 8990–8999) ingår inte i resultatet.</li>)}
              {data.result.accounts.filter((a: any) => a.category === 'OMAPPAT_OKAND').map((a: any) => <li key={a.companyId + a.account} className="text-red-700">Konto {a.account} i {NAMES[a.companyId as CompanyId]} ({fmtKr(a.amount)}) kan inte hänföras till resultat- eller balansräkning och ingår inte i någon rad. Mappa kontot under Inställningar.</li>)}
            </ul>
            {data.result.adjustments.length > 0 && (
              <div className="mt-4">
                <div className="text-sm font-semibold text-brand-dark mb-1">Rapportjusteringar i perioden (inte bokförda)</div>
                {data.result.adjustments.map((a: any) => (
                  <div key={a.adjustment.id} className="text-sm border-t border-gray-100 py-2">
                    <strong>{fmtKr(a.effectInPeriod)}</strong> · {NAMES[a.adjustment.companyId as CompanyId]} · {a.adjustment.month}{a.adjustment.reverseMonth ? ` (vänds ${a.adjustment.reverseMonth})` : ' (ingen vändning angiven)'}<br />
                    <span className="text-brand-muted">Källa: {a.adjustment.source}. Metod: {a.adjustment.method}. Motivering: {a.adjustment.motivation}. Hantering: {a.adjustment.handling}</span>
                  </div>
                ))}
              </div>
            )}
          </Section>

          <Section title={`Balansräkning per ${data.balance.date}`} defaultOpen={false}>
            {data.balance.reasons.map((r: string) => <div key={r} className="text-sm text-amber-800 mb-2">{r}</div>)}
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="text-left text-xs uppercase tracking-wider text-brand-muted border-b border-gray-200"><th className="px-3 py-2"></th><th className="px-3 py-2 text-right">Stodona AB</th><th className="px-3 py-2 text-right">Stodona Services AB</th><th className="px-3 py-2 text-right">Elimineringar</th><th className="px-3 py-2 text-right">Totalt</th></tr></thead>
                <tbody>
                  {data.balance.rows.map((r: any) => (
                    <React.Fragment key={r.id}>
                      <tr title={r.definition} onClick={() => r.kind === 'kategori' && setOpenRow(openRow === 'B' + r.id ? null : 'B' + r.id)} className={`border-b border-gray-100 ${r.kind === 'kategori' ? 'cursor-pointer hover:bg-brand-bg/50' : 'bg-brand-bg/40 font-semibold'}`}>
                        <td className="px-3 py-2">{r.label}</td>
                        <Cell v={r.ab} unit="ore" /><Cell v={r.services} unit="ore" />
                        {r.kind === 'info' ? <td className="px-3 py-2 text-right text-xs text-brand-muted" colSpan={2}>per bolag (olika räkenskapsår)</td> : (<><Cell v={r.elimination} unit="ore" /><Cell v={r.total} unit="ore" strong /></>)}
                      </tr>
                      {openRow === 'B' + r.id && <tr><td colSpan={5}><div className="text-xs text-brand-muted px-3 pt-2">{r.definition} Kontosaldon visas med bokföringens tecken.</div><AccountDrill accounts={data.balance.accounts.filter((a: any) => a.category === r.id)} period={{ from: '1900-01-01', to: data.balance.date }} source={source} /></td></tr>}
                    </React.Fragment>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-brand-muted mt-3">Saldo = ingående balans för det räkenskapsår som innehåller datumet + rörelser från årets början. Borrningen visar transaktioner i de räkenskapsår som är laddade för perioden.</p>
          </Section>
        </div>
      )}

      {data && tab === 'kontroller' && <Kontroller data={data} source={source} reload={load} />}
      {tab === 'installningar' && <Installningar onChanged={load} />}
    </div>
  );
}

// ── Översikt ────────────────────────────────────────────────────────────────
function Oversikt({ data, row, prevRow, delta, fiscalOnly }: any) {
  const Kpi = ({ title, id, sub }: { title: string; id: string; sub?: string }) => {
    const r = row(id);
    const d = delta(id);
    const isPct = r?.unit === 'procent';
    return (
      <Card title={title}>
        <div className={`text-3xl font-light ${r?.total === null ? 'text-amber-700' : 'text-brand-dark'}`}>{isPct ? fmtPct(r?.total) : fmtKr(r?.total)}</div>
        <div className="text-xs text-brand-muted mt-2">
          Samma period fg. år: {isPct ? fmtPct(prevRow(id)?.total) : fmtKr(prevRow(id)?.total)}
          {d !== null && <> · förändring <span className={d < 0 ? 'text-red-700' : 'text-green-700'}>{isPct ? `${d > 0 ? '+' : ''}${d.toLocaleString('sv-SE', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} procentenheter` : `${d > 0 ? '+' : ''}${fmtKr(d)}`}</span></>}
        </div>
        {sub && <div className="text-xs text-brand-muted mt-1">{sub}</div>}
      </Card>
    );
  };
  const rec = data.ledger.receivables;
  const pay = data.ledger.payables;
  const sumOrNull = (xs: (number | null)[]) => (xs.some((x) => x === null) ? null : xs.reduce((s: number, x) => s + (x as number), 0));
  return (
    <div className="space-y-5">
      {fiscalOnly && <div className="text-sm bg-white border border-gray-200 rounded-2xl px-5 py-3">Du tittar på {NAMES[fiscalOnly as CompanyId]}s eget räkenskapsår. Totalerna nedan avser samma kalenderperiod för båda bolagen.</div>}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        <Kpi title="Sålt till externa kunder" id="NETTOOMSATTNING" sub="Nettoomsättning exkl. moms, efter eliminering av intern fakturering." />
        <Kpi title="Personalkostnad totalt" id="PERSONAL" sub="Löner, avgifter och pensioner i båda bolagen (konto 7000–7699)." />
        <Kpi title="Rörelseresultat" id="RORELSERESULTAT" sub="Lönsamhet enligt bokföringen — inte samma sak som pengar på banken." />
        <Kpi title="Rörelsemarginal" id="RORELSEMARGINAL" sub="Rörelseresultat ÷ extern nettoomsättning." />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <Card title={`Pengar i respektive bolag per ${data.liquidity.date}`}>
          <table className="w-full text-sm">
            <tbody>
              {data.liquidity.perCompany.map((p: any) => (
                <tr key={p.companyId} className="border-b border-gray-100">
                  <td className="py-2 text-brand-dark">{NAMES[p.companyId as CompanyId]}</td>
                  <td className={`py-2 text-right text-xl font-light tabular-nums whitespace-nowrap ${p.balance === null ? 'text-amber-700' : 'text-brand-dark'}`}>{fmtKr(p.balance)}</td>
                  <td className="py-2 text-right text-xs text-brand-muted w-48">förändring i perioden {fmtKr(p.change)}</td>
                </tr>
              ))}
              <tr><td className="py-2 text-xs text-brand-muted">Summa (upplysning — inte fritt disponibelt mellan bolagen)</td><td className="py-2 text-right tabular-nums text-brand-muted">{fmtKr(data.liquidity.total)}</td><td className="py-2 text-right text-xs text-brand-muted">externt kassaflöde {fmtKr(data.liquidity.totalChange)}</td></tr>
            </tbody>
          </table>
          <ul className="text-xs text-brand-muted mt-2 list-disc pl-5">{data.liquidity.notes.map((n: string) => <li key={n}>{n}</li>)}</ul>
        </Card>

        <Card title={`Förfallna kundfordringar (externa) per ${data.ledger.asOf}`}>
          <div className={`text-3xl font-light ${sumOrNull(rec.map((r: any) => r.overdueTotal)) === null ? 'text-amber-700' : 'text-red-700'}`}>{fmtKr(sumOrNull(rec.map((r: any) => r.overdueTotal)))}</div>
          {rec.map((r: any) => (
            <div key={r.companyId} className="mt-3">
              <div className="text-sm text-brand-dark">{NAMES[r.companyId as CompanyId]}{!r.available && <span className="text-amber-700 italic"> — reskontra saknas</span>}</div>
              {r.available && (
                <div className="grid grid-cols-5 gap-2 text-xs mt-1">
                  {r.buckets.map((b: any) => <div key={b.label}><div className="text-brand-muted">{b.label}</div><div className="tabular-nums text-brand-dark">{fmtKr(b.amount)}</div><div className="text-brand-muted">{b.count} st</div></div>)}
                </div>
              )}
              {r.available && r.internalTotal !== 0 && <div className="text-xs text-brand-muted mt-1">Därutöver fordran på systerbolaget: {fmtKr(r.internalTotal)} (intern, ingår inte ovan).</div>}
            </div>
          ))}
        </Card>

        <Card title="Kända betalningar som väntar">
          {pay.map((r: any) => (
            <div key={r.companyId} className="mb-3">
              <div className="text-sm text-brand-dark">{NAMES[r.companyId as CompanyId]}: obetalda leverantörsfakturor <strong>{fmtKr(r.total)}</strong>{!r.available && <span className="text-amber-700 italic"> — reskontra saknas</span>}</div>
              {r.available && <div className="grid grid-cols-4 gap-2 text-xs mt-1">{r.buckets.map((b: any) => <div key={b.label}><div className="text-brand-muted">{b.label}</div><div className="tabular-nums text-brand-dark">{fmtKr(b.amount)}</div></div>)}</div>}
              {r.available && r.internalTotal !== 0 && <div className="text-xs text-brand-muted mt-1">Därutöver skuld till systerbolaget: {fmtKr(r.internalTotal)} (intern).</div>}
            </div>
          ))}
          <table className="w-full text-xs mt-2"><tbody>
            {data.ledger.bookedLiabilities.map((l: any) => <tr key={l.label} className="border-t border-gray-100"><td className="py-1">{l.label}</td><td className={`py-1 text-right tabular-nums ${l.amount === null ? 'text-amber-700 italic' : 'text-brand-dark'}`}>{fmtKr(l.amount)}</td></tr>)}
          </tbody></table>
          <ul className="text-xs text-brand-muted mt-2 list-disc pl-5">{data.ledger.notes.map((n: string) => <li key={n}>{n}</li>)}</ul>
        </Card>

        <Card title="Hur aktuella och fullständiga är uppgifterna?" tone={data.verification.blockers.length ? 'warn' : undefined}>
          {data.companies.map((c: any) => (
            <div key={c.id} className="text-sm mb-2">
              <div className="text-brand-dark font-medium">{c.name} <span className="font-normal text-brand-muted">({c.orgNumber})</span></div>
              <div>Senaste lyckade uppdatering: {fmtTime(c.sync.lastSuccessAt)}{c.sync.lastError && <span className="text-red-700"> · senaste försök misslyckades: {c.sync.lastError}</span>}</div>
              <div>Importerade räkenskapsår: {c.fiscalYears.filter((y: any) => y.importedAt).map((y: any) => `${y.from} – ${y.to}`).join(', ') || <span className="text-amber-700 italic">inga</span>}</div>
              {[...data.result.completeness[c.id].reasons, ...data.result.completeness[c.id].warnings].map((r: string) => <div key={r} className="text-amber-800">{r}</div>)}
            </div>
          ))}
          <div className="text-sm mt-2"><strong className="text-brand-dark">{data.verification.label}.</strong> {data.verification.blockers.length ? `${data.verification.blockers.length} skäl — se fliken Kontroller och status.` : ''}</div>
        </Card>
      </div>
      <p className="text-xs text-brand-muted">Kund- och projektlönsamhet visas inte: det kräver att intäkter, faktisk tid och kostnadsprinciper kan kopplas tillförlitligt, vilket ännu inte är kartlagt. Skatt beräknas inte på det gemensamma resultatet — bokförd skatt visas per bolag i resultatrapporten.</p>
    </div>
  );
}

// ── Kontroller och periodstatus ─────────────────────────────────────────────
function Kontroller({ data, source, reload }: { data: any; source: string; reload: () => void }) {
  const v = data.verification;
  const [busy, setBusy] = useState('');
  const mark = async (companyId: string, month: string, status: string) => {
    setBusy(companyId + month);
    try { await api('/api/ekonomi/period-status', { method: 'POST', body: JSON.stringify({ companyId, month, status }) }); reload(); }
    catch (e: any) { alert(e.message); }
    finally { setBusy(''); }
  };
  return (
    <div className="space-y-5">
      <Section title={`Varför är rapporten ${v.status === 'verifierad' ? 'verifierad' : 'inte verifierad'}?`}>
        {v.blockers.length === 0 ? <p className="text-sm">Alla blockerande kontroller är godkända och perioden är avstämd i båda bolagen.</p> : <ul className="text-sm list-disc pl-5 space-y-1">{v.blockers.map((b: string) => <li key={b}>{b}</li>)}</ul>}
      </Section>
      <Section title="Kontroller">
        <div className="divide-y divide-gray-100">
          {v.checks.map((c: any) => (
            <details key={c.id} className="py-2">
              <summary className="flex items-center gap-2 text-sm cursor-pointer list-none">
                {STATUS_ICON[c.status]}<span className="flex-1 text-brand-dark">{c.label}</span>
                {c.impact ? <span className="text-xs text-brand-muted">påverkan {fmtKr(c.impact)}</span> : null}
                <span className="text-xs w-20 text-right">{STATUS_TEXT[c.status]}{c.blocking ? '' : ' (info)'}</span>
              </summary>
              {c.details.length > 0 && <ul className="text-xs text-brand-muted mt-2 pl-8 list-disc space-y-1">{c.details.map((d: string, i: number) => <li key={i}>{d}</li>)}</ul>}
            </details>
          ))}
        </div>
        <p className="text-xs text-brand-muted mt-3">Alla kontroller görs på öret (tolerans 0 öre). Avrundning till hela kronor sker bara i visningen.</p>
      </Section>
      <Section title="Periodens status per månad och bolag">
        <ul className="text-xs text-brand-muted mb-3 space-y-1">{Object.values(data.statusMeaning).map((m: any) => <li key={m}>{m}</li>)}</ul>
        <table className="w-full text-sm">
          <thead><tr className="text-left text-xs uppercase tracking-wider text-brand-muted border-b border-gray-200"><th className="py-2">Månad</th><th>Bolag</th><th>Status</th><th>Låst i Fortnox</th><th></th></tr></thead>
          <tbody>
            {v.months.map((m: any) => (
              <tr key={m.companyId + m.month} className="border-b border-gray-100">
                <td className="py-2">{m.month}</td><td>{NAMES[m.companyId as CompanyId]}</td>
                <td>{PERIOD_STATUS[m.status]}{m.changedAfterMark && <span className="ml-2 text-xs px-2 py-0.5 rounded-full bg-red-100 text-red-800">ändrad efter avstämning</span>}</td>
                <td>{m.lockedInFortnox ? 'ja' : 'nej'}</td>
                <td className="text-right">
                  {source === 'live' && (m.status === 'preliminar' || m.changedAfterMark
                    ? <button disabled={!!busy} onClick={() => mark(m.companyId, m.month, 'avstamd')} className="text-xs px-3 py-1 rounded-lg border border-gray-300">Märk som avstämd</button>
                    : <button disabled={!!busy} onClick={() => mark(m.companyId, m.month, 'preliminar')} className="text-xs px-3 py-1 rounded-lg border border-gray-300">Återställ till preliminär</button>)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>
    </div>
  );
}

// ── Inställningar: anslutning, kartläggning, regler ─────────────────────────
const FACTS: [string, string][] = [
  ['rakenskapsar', 'Vilka räkenskapsår har respektive bolag (start- och slutmånad)?'],
  ['agarstruktur', 'Hur ser ägarstrukturen ut — äger ett bolag det andra, eller har de gemensam ägare?'],
  ['internfakturering', 'Hur faktureras personal och gemensamma kostnader mellan bolagen (underlag, frekvens, påslag, kund-/leverantörsnummer)?'],
  ['interna_konton', 'Vilka konton används för interna affärer, lån, räntor och avräkningar i respektive bolag?'],
  ['moms', 'Är internfaktureringen momsbelagd? Finns ej avdragsgill moms någonstans?'],
  ['personalperiodisering', 'Hur och när bokförs löner, semesterlöneskuld, pensioner och arbetsgivaravgifter (månadsvis eller vid bokslut)?'],
  ['kund_projekt_tid', 'Finns kund-, projekt- och tidsdata som kan kopplas till redovisningen (kostnadsställen/projekt i Fortnox, Timewave)?'],
  ['bokforingsstatus', 'Vem bokför, och när är en månad normalt färdigbokförd och avstämd i respektive bolag?'],
  ['historik', 'Hur långt tillbaka finns bokföring i Fortnox för respektive bolag?'],
];
const FACT_STATUS: Record<string, string> = { bekraftat: 'Bekräftat', preliminart: 'Preliminärt', obesvarat: 'Obesvarat' };

function Installningar({ onChanged }: { onChanged: () => void }) {
  const [st, setSt] = useState<any>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState('');
  const load = useCallback(() => api('/api/ekonomi/status').then(setSt).catch((e) => setErr(e.message)), []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const h = (e: MessageEvent) => { if (e.origin === window.location.origin && e.data?.type === 'EKONOMI_FORTNOX_DONE') load(); };
    window.addEventListener('message', h);
    return () => window.removeEventListener('message', h);
  }, [load]);

  const call = async (key: string, fn: () => Promise<any>) => {
    setBusy(key); setMsg('');
    try { const r = await fn(); await load(); onChanged(); return r; }
    catch (e: any) { setMsg(e.message); }
    finally { setBusy(''); }
  };
  const connect = async (company: string) => {
    try { const { url } = await api(`/api/ekonomi/fortnox/auth-url?company=${company}`); window.open(url, 'ekonomi_fortnox', 'width=640,height=760'); }
    catch (e: any) { setMsg(e.message); }
  };
  const sync = (company: string, years: string) => call(`sync${company}${years}`, async () => {
    // "all" importerar ett räkenskapsår per anrop tills inget återstår.
    for (let i = 0; i < 15; i++) {
      const r = await api('/api/ekonomi/sync', { method: 'POST', body: JSON.stringify({ company, years }) });
      if (!r.ok) { setMsg(`${NAMES[company as CompanyId]}: ${r.error}`); break; }
      if (years !== 'all' || !r.remaining?.length) break;
    }
  });

  const [rule, setRule] = useState<any>({ companyId: 'stodona_ab', type: 'account', account: '', ledger: 'supplier', counterpartyNumber: '', group: 'personaluthyrning', note: '' });
  const [map, setMap] = useState<any>({ companyId: '', account: '', category: 'PERSONAL' });
  const [adj, setAdj] = useState<any>({ companyId: 'stodona_services', month: lastMonth(), category: 'PERSONAL', amountKr: '', source: '', method: '', motivation: '', reverseMonth: '', handling: '' });

  if (err) return <div className="rounded-2xl bg-red-50 border border-red-200 text-red-800 px-5 py-3 text-sm">{err}</div>;
  if (!st) return <div className="text-sm text-brand-muted">Laddar…</div>;
  const envMissing = Object.entries(st.env).filter(([, ok]) => !ok).map(([k]) => ({ clientId: 'FORTNOX_EKONOMI_CLIENT_ID', clientSecret: 'FORTNOX_EKONOMI_CLIENT_SECRET', tokenKey: 'EKONOMI_TOKEN_KEY', appUrl: 'APP_URL' } as any)[k]);
  const inp = 'border border-gray-200 rounded-lg px-2 py-1.5 text-sm text-brand-dark';
  const btn = 'text-sm px-3 py-1.5 rounded-lg border border-gray-300 text-brand-dark disabled:opacity-50';
  const rr = st.categories.filter((c: any) => c.statement === 'RR');

  return (
    <div className="space-y-5">
      {msg && <div className="rounded-2xl bg-amber-50 border border-amber-200 text-amber-900 px-5 py-3 text-sm">{msg}</div>}

      <Section title="Fortnox-anslutningar (en per bolag, endast läsning)">
        {envMissing.length > 0 && <div className="text-sm text-amber-800 mb-3">Servern saknar miljövariabler: {envMissing.join(', ')}. Anslutning går inte förrän de är satta (se docs/ekonomi/README.md).</div>}
        <p className="text-sm mb-3">Behörigheter som begärs: {st.scopes.join(', ')}. Fortnox har inga rena läsbehörigheter — skrivskyddet ligger i den här appen, som bara gör läsande anrop.</p>
        <div className="grid md:grid-cols-2 gap-4">
          {st.companies.map((c: any) => (
            <div key={c.id} className="border border-gray-200 rounded-xl p-4 text-sm">
              <div className="font-semibold text-brand-dark">{c.name} <span className="font-normal text-brand-muted">{c.orgNumber}</span></div>
              <div className="mt-1">{c.connected ? <span className="text-green-700">Ansluten till "{c.fortnoxName}" sedan {fmtTime(c.connectedAt)}</span> : <span className="text-amber-700">Inte ansluten</span>}</div>
              <div>Senaste lyckade uppdatering: {fmtTime(c.lastSuccessAt)} · senaste försök: {fmtTime(c.lastAttemptAt)}</div>
              {c.lastError && <div className="text-red-700">Fel: {c.lastError}</div>}
              <div>Låst period i Fortnox t.o.m.: {c.lockedUntil ?? 'ingen'}</div>
              <div className="mt-2 text-xs text-brand-muted">Räkenskapsår: {c.fiscalYears.length ? c.fiscalYears.map((y: any) => `${y.from}–${y.to}${y.importedAt ? ' ✓' : ' (ej importerat)'}`).join(' · ') : 'okända tills första hämtningen'}</div>
              <div className="flex flex-wrap gap-2 mt-3">
                <button className={btn} onClick={() => connect(c.id)} disabled={envMissing.length > 0}><Link2 size={14} className="inline mr-1" />{c.connected ? 'Anslut om' : 'Anslut Fortnox'}</button>
                {c.connected && <>
                  <button className={btn} disabled={!!busy} onClick={() => sync(c.id, 'current')}>{busy === `sync${c.id}current` ? 'Hämtar…' : 'Hämta innevarande år'}</button>
                  <button className={btn} disabled={!!busy} onClick={() => sync(c.id, 'previous')}>{busy === `sync${c.id}previous` ? 'Hämtar…' : 'Hämta föregående år'}</button>
                  <button className={btn} disabled={!!busy} onClick={() => sync(c.id, 'all')}>{busy === `sync${c.id}all` ? 'Hämtar…' : 'Hämta all historik'}</button>
                  <button className={btn} disabled={!!busy} onClick={() => confirm('Koppla från? Importerad data ligger kvar.') && call('disc', () => api('/api/ekonomi/fortnox/disconnect', { method: 'POST', body: JSON.stringify({ company: c.id }) }))}>Koppla från</button>
                </>}
              </div>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Kartläggning av förutsättningar">
        <p className="text-sm mb-3">Inga antaganden görs i tysthet. Varje fråga är obesvarad tills du svarar; markera svaret som preliminärt eller bekräftat.</p>
        <div className="space-y-3">
          {FACTS.map(([id, q]) => {
            const f = st.facts[id] ?? { status: 'obesvarat', answer: '' };
            return <FactRow key={id} id={id} q={q} f={f} onSave={(body: any) => call('fact' + id, () => api(`/api/ekonomi/facts/${id}`, { method: 'PUT', body: JSON.stringify(body) }))} />;
          })}
        </div>
      </Section>

      <Section title="Regler för interna affärer" defaultOpen={false}>
        <p className="text-sm mb-3">En bokning räknas som intern bara om en regel här pekar ut den. Lägg en regel per bolag och sida (t.ex. intäktskontot i Services och kostnadskontot i AB, eller kund-/leverantörsnumret för systerbolaget). Samma gruppnamn på båda sidor gör att de matchas mot varandra.</p>
        <table className="w-full text-sm mb-3"><tbody>
          {st.config.internalRules.map((r: any) => (
            <tr key={r.id} className="border-b border-gray-100"><td className="py-1">{NAMES[r.companyId as CompanyId]}</td><td>{r.type === 'account' ? `Konto ${r.account}` : r.type === 'counterparty' ? `${r.ledger === 'customer' ? 'Kund' : 'Leverantör'} nr ${r.counterpartyNumber}` : `Ver. ${r.voucher?.series}${r.voucher?.number}`}</td><td>grupp: {r.group}</td><td className="text-brand-muted">{r.note}</td><td className="text-right"><button className="text-xs underline" onClick={() => call('delrule', () => api(`/api/ekonomi/internal-rules/${r.id}`, { method: 'DELETE' }))}>ta bort</button></td></tr>
          ))}
          {!st.config.internalRules.length && <tr><td className="text-amber-700 py-1">Inga regler ännu — ingenting elimineras.</td></tr>}
        </tbody></table>
        <div className="flex flex-wrap gap-2 items-end">
          <select className={inp} value={rule.companyId} onChange={(e) => setRule({ ...rule, companyId: e.target.value })}>{IDS.map((id) => <option key={id} value={id}>{NAMES[id]}</option>)}</select>
          <select className={inp} value={rule.type} onChange={(e) => setRule({ ...rule, type: e.target.value })}><option value="account">Konto</option><option value="counterparty">Motpart i reskontran</option></select>
          {rule.type === 'account' ? <input className={inp} placeholder="Kontonummer" value={rule.account} onChange={(e) => setRule({ ...rule, account: e.target.value })} /> : <>
            <select className={inp} value={rule.ledger} onChange={(e) => setRule({ ...rule, ledger: e.target.value })}><option value="customer">Kundnummer</option><option value="supplier">Leverantörsnummer</option></select>
            <input className={inp} placeholder="Nummer" value={rule.counterpartyNumber} onChange={(e) => setRule({ ...rule, counterpartyNumber: e.target.value })} />
          </>}
          <input className={inp} placeholder="Grupp" value={rule.group} onChange={(e) => setRule({ ...rule, group: e.target.value })} />
          <input className={`${inp} flex-1`} placeholder="Anteckning / underlag för regeln" value={rule.note} onChange={(e) => setRule({ ...rule, note: e.target.value })} />
          <button className={btn} disabled={!!busy} onClick={() => call('rule', () => api('/api/ekonomi/internal-rules', { method: 'POST', body: JSON.stringify(rule.type === 'account' ? { companyId: rule.companyId, type: 'account', account: rule.account, group: rule.group, note: rule.note } : { companyId: rule.companyId, type: 'counterparty', ledger: rule.ledger, counterpartyNumber: rule.counterpartyNumber, group: rule.group, note: rule.note }) }))}>Lägg till regel</button>
        </div>
      </Section>

      <Section title="Kontomappning" defaultOpen={false}>
        <p className="text-sm mb-2">Standardregeln placerar konton efter BAS-kontoplanens kontoklasser. Den är ett utgångsläge, inte bekräftad för era bolag. Lägg till en uttrycklig mappning för konton som ska ligga någon annanstans. Senast granskad: {fmtTime(st.config.mappingReviewedAt)}.</p>
        <details className="text-xs text-brand-muted mb-3"><summary className="cursor-pointer">Visa standardregler och definitioner</summary>
          <table className="mt-2 w-full"><tbody>{st.categories.map((c: any) => <tr key={c.id} className="border-t border-gray-100"><td className="py-1 pr-3 text-brand-dark whitespace-nowrap">{c.label}</td><td>{c.definition}</td></tr>)}</tbody></table>
        </details>
        <table className="w-full text-sm mb-3"><tbody>
          {st.config.mappingOverrides.map((o: any) => <tr key={(o.companyId ?? '*') + o.account} className="border-b border-gray-100"><td className="py-1">{o.companyId ? NAMES[o.companyId as CompanyId] : 'Båda bolagen'}</td><td className="font-mono">{o.account}</td><td>{st.categories.find((c: any) => c.id === o.category)?.label}</td><td className="text-right"><button className="text-xs underline" onClick={() => call('delmap', () => api('/api/ekonomi/mapping', { method: 'PUT', body: JSON.stringify({ companyId: o.companyId, account: o.account, category: null }) }))}>ta bort</button></td></tr>)}
        </tbody></table>
        <div className="flex flex-wrap gap-2 items-end">
          <select className={inp} value={map.companyId} onChange={(e) => setMap({ ...map, companyId: e.target.value })}><option value="">Båda bolagen</option>{IDS.map((id) => <option key={id} value={id}>{NAMES[id]}</option>)}</select>
          <input className={inp} placeholder="Kontonummer" value={map.account} onChange={(e) => setMap({ ...map, account: e.target.value })} />
          <select className={inp} value={map.category} onChange={(e) => setMap({ ...map, category: e.target.value })}>{st.categories.filter((c: any) => !c.id.startsWith('OMAPPAT')).map((c: any) => <option key={c.id} value={c.id}>{c.label}</option>)}</select>
          <button className={btn} disabled={!!busy || !map.account} onClick={() => call('map', () => api('/api/ekonomi/mapping', { method: 'PUT', body: JSON.stringify({ companyId: map.companyId || null, account: map.account, category: map.category }) }))}>Spara mappning</button>
          <button className={btn} disabled={!!busy} onClick={() => call('rev', () => api('/api/ekonomi/mapping/reviewed', { method: 'POST', body: '{}' }))}>Jag har granskat mappningen</button>
        </div>
      </Section>

      <Section title="Rapportjusteringar (periodiseringar som inte är bokförda)" defaultOpen={false}>
        <p className="text-sm mb-3">En justering ändrar aldrig bokföringen och visas i egen kolumn. Den kräver källa, metod, motivering och en vändningsmånad — månaden då den verkliga bokningen kommer in — så att samma kostnad inte räknas två gånger.</p>
        <table className="w-full text-sm mb-3"><tbody>
          {st.config.adjustments.map((a: any) => <tr key={a.id} className={`border-b border-gray-100 ${a.active ? '' : 'opacity-50 line-through'}`}><td className="py-1">{NAMES[a.companyId as CompanyId]}</td><td>{a.month}{a.reverseMonth ? ` → ${a.reverseMonth}` : ''}</td><td>{st.categories.find((c: any) => c.id === a.category)?.label}</td><td className="text-right tabular-nums">{fmtKr(a.amount)}</td><td className="text-brand-muted pl-3">{a.source}</td><td className="text-right">{a.active && <button className="text-xs underline" onClick={() => call('deladj', () => api(`/api/ekonomi/adjustments/${a.id}`, { method: 'DELETE' }))}>avaktivera</button>}</td></tr>)}
        </tbody></table>
        <div className="grid md:grid-cols-4 gap-2">
          <select className={inp} value={adj.companyId} onChange={(e) => setAdj({ ...adj, companyId: e.target.value })}>{IDS.map((id) => <option key={id} value={id}>{NAMES[id]}</option>)}</select>
          <select className={inp} value={adj.category} onChange={(e) => setAdj({ ...adj, category: e.target.value })}>{rr.filter((c: any) => !c.id.startsWith('OMAPPAT')).map((c: any) => <option key={c.id} value={c.id}>{c.label}</option>)}</select>
          <label className="text-xs text-brand-muted">Avser månad<input type="month" className={`${inp} block w-full`} value={adj.month} onChange={(e) => setAdj({ ...adj, month: e.target.value })} /></label>
          <label className="text-xs text-brand-muted">Vänds månad<input type="month" className={`${inp} block w-full`} value={adj.reverseMonth} onChange={(e) => setAdj({ ...adj, reverseMonth: e.target.value })} /></label>
          <input className={inp} placeholder="Resultatpåverkan i kr (kostnad = minus)" value={adj.amountKr} onChange={(e) => setAdj({ ...adj, amountKr: e.target.value })} />
          <input className={inp} placeholder="Källa / underlag" value={adj.source} onChange={(e) => setAdj({ ...adj, source: e.target.value })} />
          <input className={inp} placeholder="Metod" value={adj.method} onChange={(e) => setAdj({ ...adj, method: e.target.value })} />
          <input className={inp} placeholder="Motivering" value={adj.motivation} onChange={(e) => setAdj({ ...adj, motivation: e.target.value })} />
          <input className={`${inp} md:col-span-3`} placeholder="Hantering när bokföringen kommer in" value={adj.handling} onChange={(e) => setAdj({ ...adj, handling: e.target.value })} />
          <button className={btn} disabled={!!busy} onClick={() => {
            const kr = Number(String(adj.amountKr).replace(/\s/g, '').replace(',', '.'));
            if (!Number.isFinite(kr) || kr === 0) return setMsg('Ange ett belopp i kronor.');
            call('adj', () => api('/api/ekonomi/adjustments', { method: 'POST', body: JSON.stringify({ companyId: adj.companyId, month: adj.month, category: adj.category, amount: Math.round(kr * 100), source: adj.source, method: adj.method, motivation: adj.motivation, reverseMonth: adj.reverseMonth || null, handling: adj.handling }) }));
          }}>Lägg till justering</button>
        </div>
      </Section>

      <Section title="Första verkliga avstämningen" defaultOpen={false}>
        <p className="text-sm mb-3">Lösningen får kallas verifierad först när minst en gemensam period har stämts av mot båda bolagens resultat- och balansrapporter i Fortnox och mot de interna mellanhavandena. {st.config.initialVerification.done ? <strong className="text-green-700">Dokumenterad för {st.config.initialVerification.month} ({fmtTime(st.config.initialVerification.at)}).</strong> : <strong className="text-amber-700">Inte gjord ännu.</strong>}</p>
        <button className={btn} disabled={!!busy} onClick={() => {
          if (st.config.initialVerification.done) return call('iv', () => api('/api/ekonomi/initial-verification', { method: 'POST', body: JSON.stringify({ done: false }) }));
          const m = prompt('Vilken månad (ÅÅÅÅ-MM) har du stämt av mot Fortnox rapporter för båda bolagen?');
          if (m) call('iv', () => api('/api/ekonomi/initial-verification', { method: 'POST', body: JSON.stringify({ done: true, month: m }) }));
        }}>{st.config.initialVerification.done ? 'Återkalla' : 'Dokumentera genomförd avstämning'}</button>
      </Section>

      <Section title="Senaste hämtningar och upptäckta ändringar" defaultOpen={false}>
        <table className="w-full text-xs mb-4"><tbody>
          {st.runs.map((r: any) => <tr key={r.id} className="border-b border-gray-100"><td className="py-1">{fmtTime(r.startedAt)}</td><td>{NAMES[r.companyId as CompanyId]}</td><td className={r.status === 'failed' ? 'text-red-700' : ''}>{r.status === 'ok' ? 'lyckad' : r.status === 'failed' ? 'misslyckad' : 'pågår'}</td><td className="text-brand-muted">{r.error ?? (r.stats?.years ?? []).map((y: any) => `år ${y.fyId}: ${y.vouchers} ver., ${y.changes} ändringar`).join(' · ')}</td></tr>)}
          {!st.runs.length && <tr><td className="text-brand-muted">Inga hämtningar ännu.</td></tr>}
        </tbody></table>
        <div className="text-sm font-semibold text-brand-dark mb-1">Ändringar i redan importerad bokföring</div>
        <table className="w-full text-xs"><tbody>
          {st.changes.map((c: any) => <tr key={c.id} className="border-b border-gray-100"><td className="py-1">upptäckt {fmtTime(c.detectedAt)}</td><td>{NAMES[c.companyId as CompanyId]}</td><td className="font-mono">{c.series}{c.number}</td><td>{c.type === 'ny' ? 'efterregistrerad' : c.type === 'andrad' ? 'ändrad' : 'borttagen'}</td><td>ver.datum {c.date}</td><td className="text-brand-muted">{Object.entries(c.delta).map(([a, v]: any) => `${a}: ${fmtOre(v)}`).join(', ')}</td></tr>)}
          {!st.changes.length && <tr><td className="text-brand-muted">Inga ändringar upptäckta.</td></tr>}
        </tbody></table>
      </Section>
    </div>
  );
}

function FactRow({ q, f, onSave }: { id: string; q: string; f: any; onSave: (b: any) => void }) {
  const [answer, setAnswer] = useState(f.answer);
  const [status, setStatus] = useState(f.status);
  const dirty = answer !== f.answer || status !== f.status;
  return (
    <div className="border border-gray-200 rounded-xl p-3">
      <div className="flex items-start gap-3">
        <div className="flex-1 text-sm text-brand-dark">{q}</div>
        <span className={`text-xs px-2 py-0.5 rounded-full whitespace-nowrap ${f.status === 'bekraftat' ? 'bg-green-100 text-green-800' : f.status === 'preliminart' ? 'bg-amber-100 text-amber-800' : 'bg-gray-100 text-gray-600'}`}>{FACT_STATUS[f.status]}</span>
      </div>
      <textarea value={answer} onChange={(e) => setAnswer(e.target.value)} rows={2} placeholder="Svar…" className="w-full mt-2 border border-gray-200 rounded-lg px-2 py-1.5 text-sm text-brand-dark" />
      <div className="flex gap-2 mt-1 items-center">
        <select value={status} onChange={(e) => setStatus(e.target.value)} className="border border-gray-200 rounded-lg px-2 py-1 text-xs text-brand-dark">{Object.entries(FACT_STATUS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
        {dirty && <button onClick={() => onSave({ answer, status })} className="text-xs px-3 py-1 rounded-lg bg-brand-dark text-white">Spara</button>}
      </div>
    </div>
  );
}
