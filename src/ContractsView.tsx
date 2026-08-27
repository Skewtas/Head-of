/**
 * AVTAL — Contract management dashboard (Fas 1: skeleton).
 *
 * Nästa steg:
 *   Fas 2 — Upload existing (PDF/DOCX + metadata)
 *   Fas 3 — Skapa anställningsavtal från mall (6-stegs guide)
 *   Fas 4 — Signering via Visma Sign
 */
import React, { useEffect, useMemo, useState } from 'react';
import { FileText, AlertTriangle, CheckCircle, Send, Clock, Plus, Search } from 'lucide-react';
import { api } from './lib/api';

type Stats = {
  total: number;
  active: number;
  awaiting: number;
  expiring: number;
  expired: number;
};

type Contract = {
  id: number;
  title: string;
  category: string;
  status: string;
  startDate: string | null;
  endDate: string | null;
  ownerClerkId: string;
  updatedAt: string;
  person: { firstName: string; lastName: string } | null;
  externalCompanyName: string | null;
  ownCompany: { name: string };
  _count: { signers: number; versions: number; reminders: number };
};

const CATEGORY_LABEL: Record<string, string> = {
  ANSTALLNINGSAVTAL: 'Anställningsavtal',
  PROVANSTALLNING: 'Provanställning',
  TILLSVIDAREANSTALLNING: 'Tillsvidare',
  VISSTIDSANSTALLNING: 'Visstid',
  TIMANSTALLNING: 'Timanställning',
  ANDRING_ANSTALLNINGSVILLKOR: 'Ändring',
  LONEANDRING: 'Löneändring',
  SEKRETESSAVTAL: 'Sekretess',
  KONKURRENSAVTAL: 'Konkurrens',
  OVERENSKOMMELSE: 'Överenskommelse',
  AVSLUT_ANSTALLNING: 'Avslut',
  KUNDAVTAL: 'Kund',
  LEVERANTORSAVTAL: 'Leverantör',
  KONSULTAVTAL: 'Konsult',
  SAMARBETSAVTAL: 'Samarbete',
  HYRESAVTAL: 'Hyra',
  LEASINGAVTAL: 'Leasing',
  LICENSAVTAL: 'Licens',
  PUB_AVTAL: 'PUB',
  OVRIGT_AVTAL: 'Övrigt',
};

const STATUS_STYLE: Record<string, { label: string; bg: string; text: string }> = {
  DRAFT: { label: 'Utkast', bg: 'bg-gray-100', text: 'text-gray-700' },
  PENDING_APPROVAL: { label: 'Väntar godkännande', bg: 'bg-amber-100', text: 'text-amber-800' },
  READY_FOR_SIGNING: { label: 'Redo för signering', bg: 'bg-sky-100', text: 'text-sky-800' },
  SENT: { label: 'Skickat', bg: 'bg-blue-100', text: 'text-blue-800' },
  PARTIALLY_SIGNED: { label: 'Delvis signerat', bg: 'bg-yellow-100', text: 'text-yellow-800' },
  SIGNED: { label: 'Signerat', bg: 'bg-emerald-100', text: 'text-emerald-800' },
  ACTIVE: { label: 'Aktivt', bg: 'bg-emerald-50', text: 'text-emerald-700' },
  EXPIRING_SOON: { label: 'Löper ut snart', bg: 'bg-amber-100', text: 'text-amber-800' },
  EXPIRED: { label: 'Utgånget', bg: 'bg-red-100', text: 'text-red-800' },
  TERMINATED: { label: 'Avslutat', bg: 'bg-gray-100', text: 'text-gray-700' },
  ARCHIVED: { label: 'Arkiverat', bg: 'bg-gray-50', text: 'text-gray-500' },
};

export default function ContractsView() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [isSuperadmin, setIsSuperadmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string>('');

  useEffect(() => {
    (async () => {
      try {
        const [s, list] = await Promise.all([
          api<Stats>('/api/contracts/stats').catch(() => null),
          api<{ data: Contract[]; isSuperadmin: boolean }>('/api/contracts').catch(() => ({ data: [], isSuperadmin: false })),
        ]);
        if (s) setStats(s);
        setContracts(list.data);
        setIsSuperadmin(list.isSuperadmin);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const filtered = useMemo(() => {
    return contracts.filter((c) => {
      if (categoryFilter && c.category !== categoryFilter) return false;
      if (search) {
        const q = search.toLowerCase();
        const hay = [
          c.title,
          c.person ? `${c.person.firstName} ${c.person.lastName}` : '',
          c.externalCompanyName ?? '',
          c.ownCompany.name,
        ].join(' ').toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [contracts, search, categoryFilter]);

  return (
    <div className="p-8 bg-brand-bg min-h-[calc(100vh-64px)] space-y-6">
      <header className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-serif text-brand-dark">Avtal</h1>
          <p className="text-sm text-brand-muted mt-1">
            {isSuperadmin
              ? 'Du ser samtliga avtal (superadmin).'
              : 'Du ser dina egna avtal + de som delats med dig.'}
          </p>
        </div>
        <button
          className="flex items-center gap-2 px-4 py-2 bg-brand-dark text-white rounded-lg text-sm font-semibold hover:bg-brand-accent"
          disabled
          title="Kommer i Fas 3"
        >
          <Plus className="w-4 h-4" /> Nytt anställningsavtal
        </button>
      </header>

      {/* KPI-strip */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <KpiCard label="Totalt" value={stats?.total ?? '—'} icon={FileText} />
        <KpiCard label="Aktiva" value={stats?.active ?? '—'} icon={CheckCircle} accent="emerald" />
        <KpiCard label="Inväntar signering" value={stats?.awaiting ?? '—'} icon={Send} accent="sky" />
        <KpiCard label="Löper ut inom 60 dgr" value={stats?.expiring ?? '—'} icon={Clock} accent="amber" />
        <KpiCard label="Utgångna" value={stats?.expired ?? '—'} icon={AlertTriangle} accent="red" />
      </div>

      {/* Sök/filter */}
      <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-3">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="relative flex-1 min-w-[220px]">
            <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Sök på avtalsnamn, person eller företag…"
              className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:border-brand-accent"
            />
          </div>
          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className="px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:border-brand-accent"
          >
            <option value="">Alla kategorier</option>
            {Object.entries(CATEGORY_LABEL).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
        </div>

        {loading ? (
          <div className="p-6 text-center text-sm text-gray-400">Laddar…</div>
        ) : filtered.length === 0 ? (
          <div className="p-8 text-center text-sm text-brand-muted italic">
            {contracts.length === 0
              ? 'Inga avtal ännu. Ladda upp befintliga eller skapa nytt när Fas 2/3 är på plats.'
              : 'Inga avtal matchar filtret.'}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[10px] text-brand-muted uppercase tracking-wider border-b border-gray-200">
                  <th className="text-left pb-2 pl-2">Titel</th>
                  <th className="text-left pb-2">Motpart</th>
                  <th className="text-left pb-2">Kategori</th>
                  <th className="text-left pb-2">Företag</th>
                  <th className="text-left pb-2">Slutdatum</th>
                  <th className="text-left pb-2">Status</th>
                  <th className="text-right pb-2 pr-2">Signerare</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((c) => {
                  const st = STATUS_STYLE[c.status] || STATUS_STYLE.DRAFT;
                  const cat = CATEGORY_LABEL[c.category] || c.category;
                  const counterparty = c.person
                    ? `${c.person.firstName} ${c.person.lastName}`
                    : c.externalCompanyName || '—';
                  return (
                    <tr key={c.id} className="border-t border-gray-100 hover:bg-gray-50/50 cursor-pointer">
                      <td className="py-3 pl-2 font-medium text-brand-dark">{c.title}</td>
                      <td className="py-3 text-brand-dark">{counterparty}</td>
                      <td className="py-3 text-brand-muted">{cat}</td>
                      <td className="py-3 text-brand-muted">{c.ownCompany.name}</td>
                      <td className="py-3 text-brand-muted tabular-nums">
                        {c.endDate ? new Date(c.endDate).toLocaleDateString('sv-SE', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'}
                      </td>
                      <td className="py-3">
                        <span className={`inline-block px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${st.bg} ${st.text}`}>
                          {st.label}
                        </span>
                      </td>
                      <td className="py-3 pr-2 text-right text-brand-muted text-xs">
                        {c._count.signers > 0 ? `${c._count.signers} st` : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="text-[11px] text-brand-muted text-center">
        Fas 1: datamodell + behörigheter + tom vy. Fas 2 (upload befintliga PDF/DOCX) och Fas 3 (skapa anställningsavtal från mall) kommer i nästa steg.
      </div>
    </div>
  );
}

function KpiCard({
  label,
  value,
  icon: Icon,
  accent = 'gray',
}: {
  label: string;
  value: string | number;
  icon: React.ComponentType<{ className?: string }>;
  accent?: 'gray' | 'emerald' | 'sky' | 'amber' | 'red';
}) {
  const accentColor: Record<string, string> = {
    gray: 'text-brand-dark',
    emerald: 'text-emerald-700',
    sky: 'text-sky-700',
    amber: 'text-amber-700',
    red: 'text-red-700',
  };
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4">
      <div className="flex items-center gap-2 text-brand-muted text-[11px] uppercase tracking-wider font-semibold">
        <Icon className="w-3 h-3" /> {label}
      </div>
      <div className={`mt-2 text-2xl font-semibold ${accentColor[accent]}`}>{value}</div>
    </div>
  );
}
