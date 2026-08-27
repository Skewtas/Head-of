/**
 * AVTAL — Contract management dashboard (Fas 1: skeleton).
 *
 * Nästa steg:
 *   Fas 2 — Upload existing (PDF/DOCX + metadata)
 *   Fas 3 — Skapa anställningsavtal från mall (6-stegs guide)
 *   Fas 4 — Signering via Visma Sign
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { FileText, AlertTriangle, CheckCircle, Send, Clock, Plus, Search, Upload, X, Loader } from 'lucide-react';
import { upload as blobUpload } from '@vercel/blob/client';
import { api } from './lib/api';
import ContractWizard from './ContractWizard';

// Vercel serverless-body cap är 4,5 MB. Alla större filer måste gå direkt
// till Blob-storage (upload() från @vercel/blob/client — signerad URL
// hämtas från /api/contracts-blob-upload).
const BASE64_MAX_BYTES = 4_000_000;
const BLOB_MAX_BYTES = 50 * 1024 * 1024;

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
  const [companies, setCompanies] = useState<{ id: number; name: string }[]>([]);
  const [isSuperadmin, setIsSuperadmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string>('');
  const [uploadOpen, setUploadOpen] = useState(false);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [missing, setMissing] = useState<{ totalActive: number; missing: any[]; missingCount: number } | null>(null);

  const reload = async () => {
    const [s, list, cos, miss] = await Promise.all([
      api<Stats>('/api/contracts/stats').catch(() => null),
      api<{ data: Contract[]; isSuperadmin: boolean }>('/api/contracts').catch(() => ({ data: [], isSuperadmin: false })),
      api<{ id: number; name: string }[]>('/api/contracts/companies').catch(() => []),
      api<{ totalActive: number; missing: any[]; missingCount: number }>('/api/contracts/missing-employees').catch(() => null),
    ]);
    if (s) setStats(s);
    setContracts(list.data);
    setIsSuperadmin(list.isSuperadmin);
    setCompanies(cos);
    if (miss) setMissing(miss);
  };

  useEffect(() => {
    (async () => {
      try { await reload(); } finally { setLoading(false); }
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
        <div className="flex gap-2">
          <button
            onClick={() => setUploadOpen(true)}
            className="flex items-center gap-2 px-4 py-2 bg-white border border-brand-dark text-brand-dark rounded-lg text-sm font-semibold hover:bg-gray-50"
          >
            <Upload className="w-4 h-4" /> Ladda upp befintligt
          </button>
          <button
            onClick={() => setWizardOpen(true)}
            disabled={companies.length === 0}
            className="flex items-center gap-2 px-4 py-2 bg-brand-dark text-white rounded-lg text-sm font-semibold hover:bg-brand-accent disabled:opacity-50"
            title={companies.length === 0 ? 'Kör migrationen först — behöver ett företag' : ''}
          >
            <Plus className="w-4 h-4" /> Nytt anställningsavtal
          </button>
        </div>
      </header>

      {uploadOpen && (
        <UploadModal
          companies={companies}
          onClose={() => setUploadOpen(false)}
          onDone={async () => {
            setUploadOpen(false);
            await reload();
          }}
        />
      )}

      {wizardOpen && (
        <ContractWizard
          companies={companies}
          onClose={() => setWizardOpen(false)}
          onDone={async () => {
            setWizardOpen(false);
            await reload();
          }}
        />
      )}

      {/* KPI-strip */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <KpiCard label="Totalt" value={stats?.total ?? '—'} icon={FileText} />
        <KpiCard label="Aktiva" value={stats?.active ?? '—'} icon={CheckCircle} accent="emerald" />
        <KpiCard label="Inväntar signering" value={stats?.awaiting ?? '—'} icon={Send} accent="sky" />
        <KpiCard label="Löper ut inom 60 dgr" value={stats?.expiring ?? '—'} icon={Clock} accent="amber" />
        <KpiCard label="Utgångna" value={stats?.expired ?? '—'} icon={AlertTriangle} accent="red" />
      </div>

      {/* Varning: aktiva Timewave-anställda utan aktivt anställningsavtal */}
      {missing && missing.missingCount > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 space-y-3">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-red-700 flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <h3 className="text-sm font-semibold text-red-900">
                {missing.missingCount} anställd{missing.missingCount === 1 ? '' : 'a'} utan aktivt anställningsavtal
              </h3>
              <p className="text-xs text-red-700/80 mt-0.5">
                Aktiva i Timewave men saknar signerat eller aktivt anställningsavtal i systemet. Ladda upp befintligt eller skapa ett nytt.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {missing.missing.slice(0, 20).map((p) => (
              <button
                key={p.timewaveEmployeeId}
                className="text-xs px-3 py-1.5 bg-white border border-red-200 rounded-lg hover:border-red-400 hover:bg-red-50 text-red-900 flex items-center gap-1.5"
                onClick={() => { /* TODO: pre-fill wizard with employee data */ setWizardOpen(true); }}
                title={`Skapa avtal för ${p.firstName} ${p.lastName}`}
              >
                {p.firstName} {p.lastName}
                {p.occupation && <span className="text-red-500 text-[10px]">· {p.occupation}%</span>}
              </button>
            ))}
            {missing.missingCount > 20 && (
              <span className="text-xs text-red-700 self-center">+{missing.missingCount - 20} till</span>
            )}
          </div>
        </div>
      )}

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

// ──────────────────────────────────────────────────────────────────
// Upload befintligt avtal — Fas 2
// ──────────────────────────────────────────────────────────────────

function UploadModal({
  companies,
  onClose,
  onDone,
}: {
  companies: { id: number; name: string }[];
  onClose: () => void;
  onDone: () => void;
}) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [title, setTitle] = useState('');
  const [category, setCategory] = useState('ANSTALLNINGSAVTAL');
  const [ownCompanyId, setOwnCompanyId] = useState<number | ''>(companies[0]?.id ?? '');
  const [personFirst, setPersonFirst] = useState('');
  const [personLast, setPersonLast] = useState('');
  const [personEmail, setPersonEmail] = useState('');
  const [externalCompany, setExternalCompany] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [alreadySigned, setAlreadySigned] = useState(true);
  const [signedAt, setSignedAt] = useState('');

  const readFileToBase64 = (f: File): Promise<string> =>
    new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = () => {
        const s = String(r.result || '');
        res(s.split(',')[1] || s);
      };
      r.onerror = () => rej(r.error);
      r.readAsDataURL(f);
    });

  const acceptFile = (f: File | null | undefined) => {
    if (!f) return;
    const ok = ['pdf', 'docx', 'doc'].some((e) => f.name.toLowerCase().endsWith('.' + e));
    if (!ok) { setErr('Endast PDF eller DOCX tillåts'); return; }
    if (f.size > BLOB_MAX_BYTES) { setErr('Filen är större än 50 MB'); return; }
    setErr(null);
    setFile(f);
    if (!title) setTitle(f.name.replace(/\.[^.]+$/, ''));
  };

  const submit = async () => {
    if (!file) { setErr('Välj en fil'); return; }
    if (!title || !category || !ownCompanyId) { setErr('Titel, kategori och företag krävs'); return; }
    setSaving(true); setErr(null);
    try {
      const fileMeta: any = {
        filename: file.name,
        contentType: file.type || 'application/pdf',
        sizeBytes: file.size,
      };

      if (file.size > BASE64_MAX_BYTES) {
        // Stor fil → Blob-storage (kringgår 4,5 MB Vercel-cap)
        const contentType = file.type || 'application/pdf';
        const path = `contracts/${Date.now()}-${sanitizeFilename(file.name)}`;
        const blob = await blobUpload(path, file, {
          access: 'public',
          handleUploadUrl: '/api/contracts-blob-upload',
          contentType,
        });
        fileMeta.blobUrl = blob.url;
      } else {
        // Liten fil → base64 direkt i requesten
        fileMeta.base64 = await readFileToBase64(file);
      }

      await api('/api/contracts/upload', {
        method: 'POST',
        body: JSON.stringify({
          title,
          category,
          ownCompanyId,
          person: (personFirst || personLast) ? {
            firstName: personFirst,
            lastName: personLast,
            email: personEmail || null,
          } : null,
          externalCompanyName: externalCompany || null,
          startDate: startDate || null,
          endDate: endDate || null,
          alreadySigned,
          signedAt: alreadySigned ? (signedAt || null) : null,
          file: fileMeta,
        }),
      });
      onDone();
    } catch (e: any) {
      setErr(e?.message ?? String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-white rounded-2xl max-w-2xl w-full shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
          <h3 className="text-lg font-serif text-brand-dark">Ladda upp befintligt avtal</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-brand-dark"><X className="w-5 h-5" /></button>
        </div>

        <div className="p-6 space-y-5 max-h-[75vh] overflow-y-auto">
          {/* Drop-zone */}
          <div
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault(); setDragOver(false);
              acceptFile(e.dataTransfer.files?.[0]);
            }}
            onClick={() => fileInput.current?.click()}
            className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition ${
              dragOver ? 'border-brand-accent bg-brand-accent/5' : 'border-gray-200'
            }`}
          >
            <input
              ref={fileInput}
              type="file"
              accept=".pdf,.docx,.doc,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              onChange={(e) => acceptFile(e.target.files?.[0])}
              className="hidden"
            />
            {file ? (
              <div className="text-sm text-brand-dark">
                <FileText className="w-6 h-6 mx-auto mb-2 text-brand-accent" />
                <div className="font-medium">{file.name}</div>
                <div className="text-xs text-brand-muted mt-1">{Math.round(file.size / 1024)} kB</div>
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); setFile(null); }}
                  className="text-xs text-red-600 hover:underline mt-2"
                >Ta bort</button>
              </div>
            ) : (
              <>
                <Upload className="w-6 h-6 mx-auto mb-2 text-gray-400" />
                <div className="text-sm text-brand-muted">Dra hit PDF/DOCX eller klicka för att välja</div>
                <div className="text-xs text-gray-400 mt-1">Max 50 MB (större filer laddas upp via Vercel Blob automatiskt)</div>
              </>
            )}
          </div>

          <Row label="Avtalsnamn" required>
            <input value={title} onChange={(e) => setTitle(e.target.value)} className={inp} placeholder="Ex: Anställningsavtal — Anna Andersson" />
          </Row>

          <div className="grid grid-cols-2 gap-4">
            <Row label="Kategori" required>
              <select value={category} onChange={(e) => setCategory(e.target.value)} className={inp}>
                {Object.entries(CATEGORY_LABEL).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </select>
            </Row>
            <Row label="Företag (vi)" required>
              <select
                value={ownCompanyId}
                onChange={(e) => setOwnCompanyId(Number(e.target.value))}
                className={inp}
              >
                {companies.length === 0 && <option value="">Inga företag — kör migration först</option>}
                {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </Row>
          </div>

          <div>
            <div className="text-[10px] font-bold uppercase tracking-wider text-brand-muted mb-2">Motpart</div>
            <div className="grid grid-cols-2 gap-3">
              <input value={personFirst} onChange={(e) => setPersonFirst(e.target.value)} placeholder="Förnamn" className={inp} />
              <input value={personLast} onChange={(e) => setPersonLast(e.target.value)} placeholder="Efternamn" className={inp} />
              <input value={personEmail} onChange={(e) => setPersonEmail(e.target.value)} placeholder="E-post (valfritt)" className={`${inp} col-span-2`} />
            </div>
            <div className="text-[10px] uppercase tracking-wider text-brand-muted mt-3 mb-2">— eller externt företag —</div>
            <input value={externalCompany} onChange={(e) => setExternalCompany(e.target.value)} placeholder="Företagsnamn (leverantör, hyresvärd…)" className={inp} />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <Row label="Startdatum">
              <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className={inp} />
            </Row>
            <Row label="Slutdatum">
              <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className={inp} />
            </Row>
          </div>

          <label className="flex items-center gap-2 text-sm text-brand-dark cursor-pointer">
            <input type="checkbox" checked={alreadySigned} onChange={(e) => setAlreadySigned(e.target.checked)} />
            Redan signerat
          </label>
          {alreadySigned && (
            <Row label="Signerat datum">
              <input type="date" value={signedAt} onChange={(e) => setSignedAt(e.target.value)} className={inp} />
            </Row>
          )}

          {err && (
            <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg p-2">
              {err}
            </div>
          )}
        </div>

        <div className="px-6 py-4 bg-gray-50 border-t border-gray-100 flex justify-end gap-3">
          <button onClick={onClose} className="px-4 py-2 text-sm font-semibold text-gray-500 hover:text-brand-dark">Avbryt</button>
          <button
            onClick={submit}
            disabled={saving || !file}
            className="px-5 py-2 bg-brand-dark text-white rounded-lg text-sm font-semibold hover:bg-brand-accent disabled:opacity-50 flex items-center gap-2"
          >
            {saving && <Loader className="w-4 h-4 animate-spin" />} Spara avtalet
          </button>
        </div>
      </div>
    </div>
  );
}

const inp = 'w-full px-3 py-2 border border-gray-200 rounded-lg outline-none focus:border-brand-accent text-sm';

function sanitizeFilename(name: string): string {
  return name
    .toLowerCase()
    .replace(/[åä]/g, 'a')
    .replace(/ö/g, 'o')
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function Row({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[10px] font-bold uppercase tracking-wider text-brand-muted mb-1">
        {label}{required && <span className="text-red-500 ml-1">*</span>}
      </label>
      {children}
    </div>
  );
}
